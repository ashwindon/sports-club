import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/barlow-condensed/800.css";
import "@fontsource/barlow-condensed/800-italic.css";
import "@fontsource/barlow-condensed/900-italic.css";
import "./game.css";

import { hostControllerLink } from "../link/peerjs-link";
import type { ControllerMessage, MotionSourceKind, Quat } from "../link/protocol";
import { Sounds } from "./audio";
import { BatRig } from "./bat";
import { Batter } from "./batter";
import { createControls } from "./controls";
import { Hud } from "./hud";
import { Match } from "./match";
import { createPairing } from "./pairing";
import { createStage } from "./scene";
import { LinkStats, SwingTracker } from "./stats";
import type { Swing } from "./stats";

const RAD_TO_DEG = 180 / Math.PI;
const SOURCE_LABELS: Record<MotionSourceKind, string> = {
  fused: "gyro + accel (ahrs)",
  browser: "phone's orientation",
  simulator: "simulator",
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

interface Phone {
  stats: LinkStats;
  source?: MotionSourceKind;
  lastQ?: Quat;
}

const stage = createStage($("stage"));
const rig = new BatRig();
const batter = new Batter();
stage.scene.add(rig.group, batter.puppet.group);
const sounds = new Sounds();

const statusEl = $("game-status");
const pairingCard = $("pairing");
const pairBody = $("pair-body");
const pairToggle = $<HTMLButtonElement>("pair-toggle");
const statsCard = $("stats");
// On smaller screens the numbers would cover the pitch; S brings them back.
let showStats = innerWidth >= 1100;

const pairing = createPairing({
  qr: $<HTMLCanvasElement>("qr"),
  link: $<HTMLAnchorElement>("controller-link"),
  hostField: $("host-field"),
  hostSelect: $<HTMLSelectElement>("host"),
});

const phones = new Map<string, Phone>();
const swings = new SwingTracker();
let activeId: string | undefined;
let spinDeg = 0;
let toeSpeed = 0;

function setStatus(text: string, tone?: "ok" | "error"): void {
  statusEl.textContent = text;
  if (tone) statusEl.dataset.tone = tone;
  else delete statusEl.dataset.tone;
}

function renderPhones(): void {
  const count = phones.size;
  pairingCard.classList.toggle("compact", count > 0);
  if (count === 0) {
    setStatus("Waiting for a phone…");
    pairBody.hidden = false;
    pairToggle.hidden = true;
    statsCard.hidden = true;
    return;
  }
  setStatus(`${count} phone${count > 1 ? "s" : ""} connected`, "ok");
  pairBody.hidden = true;
  pairToggle.hidden = false;
  pairToggle.textContent = "Pair another phone";
  statsCard.hidden = !showStats;
}

const describeSwing = (swing: Swing | undefined) =>
  swing
    ? `${Math.round(swing.peakToeKmh)} km/h · ${Math.round(swing.peakSpinDeg)}°/s${swing.gyroMaxedOut ? " · gyro maxed" : ""}`
    : "–";

function renderStats(): void {
  const phone = activeId ? phones.get(activeId) : undefined;
  if (!phone) return;
  const s = phone.stats.snapshot();
  const ms = (value: number | undefined) => (value === undefined ? "–" : `${Math.round(value)} ms`);
  $("s-source").textContent = phone.source ? SOURCE_LABELS[phone.source] : "–";
  $("s-rate").textContent = `${s.rateHz} Hz`;
  $("s-latency").textContent = ms(s.latencyMs);
  $("s-rtt").textContent = ms(s.rttMs);
  $("s-gap").textContent = ms(s.maxGapMs);
  $("s-lost").textContent = `${s.lost} / ${s.late}`;
  $("s-spin").textContent = `${Math.round(spinDeg)}°/s`;
  $("s-toe").textContent = `${Math.round(toeSpeed * 3.6)} km/h`;
  $("s-last").textContent = describeSwing(swings.last);
  $("s-last").classList.toggle("warn", Boolean(swings.last?.gyroMaxedOut));
  $("s-best").textContent = describeSwing(swings.best);
}

function phoneFor(id: string): Phone {
  let phone = phones.get(id);
  if (!phone) {
    phone = { stats: new LinkStats() };
    phones.set(id, phone);
    renderPhones();
  }
  return phone;
}

/** Takes the phone's current pose as the stance; false if that phone hasn't sent any motion yet. */
function calibrate(id: string | undefined): boolean {
  const phone = id ? phones.get(id) : undefined;
  if (!id || !phone?.lastQ) return false;
  rig.calibrate(phone.lastQ);
  swings.reset();
  link.send(id, { type: "buzz", ms: 40 });
  return true;
}

function handleMessage(id: string, message: ControllerMessage): void {
  const phone = phoneFor(id);
  const now = performance.now();
  switch (message.type) {
    case "hello":
      // A (re)started phone page has a new clock and a new sequence.
      phone.stats = new LinkStats();
      phone.source = message.source;
      activeId ??= id;
      break;
    case "pong":
      phone.stats.pong(message.id, message.t, now);
      break;
    case "calibrate":
      if (calibrate(id)) controls.toast("Calibrated ✓  The bat now faces the bowler.");
      break;
    case "motion": {
      if (phone.stats.sample(message.seq, message.t, now).stale) break;
      activeId = id;
      phone.lastQ = message.q;
      // When the phone took the reading, on our clock. Until the clocks have
      // been compared, arrival time stands in. Kept in order, so a clock
      // correction can't send the bat back in time.
      const previous = rig.latestTime;
      const t = Math.max(phone.stats.gameTime(message.t) ?? now, previous + 0.1);
      const [wx, wy, wz] = message.w;
      spinDeg = Math.hypot(wx, wy, wz) * RAD_TO_DEG;
      toeSpeed = rig.update(message.q, t);
      match.onBatReading(previous, t, spinDeg);
      const maxAxisDeg = Math.max(Math.abs(wx), Math.abs(wy), Math.abs(wz)) * RAD_TO_DEG;
      swings.update(t, spinDeg, maxAxisDeg, toeSpeed);
      break;
    }
  }
}

const link = hostControllerLink();

const match = new Match(rig, new Hud(), sounds, stage, {
  ready: () => phones.size > 0 && rig.calibrated,
  latency: () => (activeId ? (phones.get(activeId)?.stats.snapshot().latencyMs ?? 0) : 0),
  onHit: (strength) => {
    if (activeId) link.send(activeId, { type: "buzz", ms: Math.round(25 + 50 * strength) });
  },
});
stage.scene.add(match.group);

let lastFrame = performance.now();
stage.renderer.setAnimationLoop(() => {
  const now = performance.now();
  // Capped, so a backgrounded tab doesn't make the camera leap when it returns.
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  match.update(now, dt);
  batter.update(rig);
  stage.update(now, dt);
  stage.renderer.render(stage.scene, stage.camera);
});

link.onCode((code) => {
  pairing.setCode(code);
  if (phones.size === 0) setStatus("Waiting for a phone…");
});
link.onError((message) => setStatus(message, "error"));
link.onConnect((id) => {
  phoneFor(id);
  link.send(id, { type: "buzz", ms: 60 });
});
link.onDisconnect((id) => {
  phones.delete(id);
  if (activeId === id) activeId = phones.keys().next().value;
  renderPhones();
});
link.onMessage(handleMessage);

setInterval(() => {
  for (const [id, phone] of phones) link.send(id, { type: "ping", id: phone.stats.ping(performance.now()) });
}, 500);
const controls = createControls({
  match,
  stage,
  rig,
  sounds,
  calibrate: () => calibrate(activeId),
  stats: {
    get shown() {
      return showStats;
    },
    toggle() {
      showStats = !showStats;
      renderPhones();
    },
  },
});

setInterval(() => {
  renderStats();
  // Sound can switch on from any click, so keep its button honest.
  controls.refresh();
}, 250);

pairToggle.addEventListener("click", () => {
  pairBody.hidden = !pairBody.hidden;
  pairingCard.classList.toggle("compact", pairBody.hidden);
  pairToggle.textContent = pairBody.hidden ? "Pair another phone" : "Hide pairing";
});

if (import.meta.env.DEV) {
  // Handy from the devtools console while tuning.
  Object.assign(window, { game: { stage, rig, phones, swings, link, match } });
}
