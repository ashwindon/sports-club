import "./controller.css";

import type { ControllerLinkClient, ControllerLinkStatus } from "../link/controller-link";
import { joinControllerLink } from "../link/peerjs-link";
import type { Quat, Vec3 } from "../link/protocol";
import { DEG, length } from "../shared/quat";
import { BrowserOrientationSource, FusedMotionSource, SimulatedMotionSource } from "./motion";
import type { MotionReading, MotionSource } from "./motion";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const statusEl = $("link-status");
const startPanel = $("start-panel");
const startButton = $<HTMLButtonElement>("start");
const startError = $("start-error");
const playPanel = $("play-panel");
const calibrateButton = $<HTMLButtonElement>("calibrate");
const sourceField = $("source-field");
const sourceSelect = $<HTMLSelectElement>("source");
const simPanel = $("sim");

const STATUS_TEXT: Record<ControllerLinkStatus["state"], string> = {
  connecting: "Connecting to the game…",
  connected: "Connected to the game",
  reconnecting: "Reconnecting…",
  failed: "Couldn't connect",
};

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/** iOS asks for motion access, and only from inside a tap. Elsewhere this resolves at once. */
async function requestMotionPermission(): Promise<boolean> {
  type Requestable = { requestPermission?: () => Promise<PermissionState> };
  const motion = DeviceMotionEvent as unknown as Requestable;
  const orientation = DeviceOrientationEvent as unknown as Requestable;
  if (typeof motion.requestPermission !== "function") return true;
  const results = await Promise.all([
    motion.requestPermission(),
    orientation.requestPermission?.() ?? Promise.resolve("granted"),
  ]);
  return results.every((result) => result === "granted");
}

/** Waits up to a second for the first event of `type` that `isReal` accepts. */
function detectEvent<E extends Event>(
  type: "devicemotion" | "deviceorientation",
  isReal: (event: E) => boolean,
): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (found: boolean) => {
      clearTimeout(timer);
      removeEventListener(type, handler);
      resolve(found);
    };
    const handler = (event: Event) => {
      if (isReal(event as E)) done(true);
    };
    const timer = setTimeout(() => done(false), 1000);
    addEventListener(type, handler);
  });
}

/** Desktops fire these with nulls, or not at all. */
const detectGyro = () =>
  detectEvent<DeviceMotionEvent>("devicemotion", (event) => event.rotationRate?.alpha != null);
const detectOrientation = () =>
  detectEvent<DeviceOrientationEvent>("deviceorientation", (event) => event.beta != null);

/** Keeps the screen on; the browser drops the lock whenever the page is hidden. */
function keepScreenAwake(): void {
  if (!("wakeLock" in navigator)) return;
  const request = () => navigator.wakeLock.request("screen").catch(() => undefined);
  void request();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void request();
  });
}

function buzz(ms: number): void {
  // Browsers refuse to vibrate before the first tap; the game buzzes on connect, which can come first.
  if ("vibrate" in navigator && navigator.userActivation?.hasBeenActive !== false) navigator.vibrate(ms);
}

function showStatus(status: ControllerLinkStatus): void {
  statusEl.dataset.state = status.state;
  statusEl.textContent =
    status.state === "reconnecting"
      ? status.notice
      : status.state === "failed"
        ? `${STATUS_TEXT.failed}: ${status.error}`
        : STATUS_TEXT[status.state];
}

/** Sample rate, spin and sensor state, refreshed a few times a second. */
function startReadout(getSource: () => MotionSource) {
  let count = 0;
  let spin = 0;
  let peak = 0;
  let since = performance.now();
  setInterval(() => {
    const now = performance.now();
    $("rate").textContent = `${Math.round((count * 1000) / (now - since))} Hz`;
    $("spin").textContent = `${Math.round(spin)}°/s`;
    $("peak").textContent = `${Math.round(peak)}°/s`;
    $("sensors").textContent = getSource().describe();
    count = 0;
    since = now;
  }, 250);
  return {
    record(reading: MotionReading) {
      count += 1;
      spin = length(reading.w) / DEG;
      peak = Math.max(peak, spin);
    },
    resetPeak() {
      peak = 0;
    },
  };
}

async function start(link: ControllerLinkClient, forceSimulator: boolean): Promise<void> {
  startButton.disabled = true;
  startError.hidden = true;

  if (!forceSimulator) {
    const allowed = await requestMotionPermission().catch(() => false);
    if (!allowed) {
      startError.textContent = "Motion access was refused. Allow it in your browser settings, then reload.";
      startError.hidden = false;
      startButton.disabled = false;
      return;
    }
  }
  const [hasGyro, hasOrientation] = forceSimulator
    ? [false, false]
    : await Promise.all([detectGyro(), detectOrientation()]);
  const simulator = hasGyro ? undefined : new SimulatedMotionSource($("sim-pad"));
  if (simulator) {
    simPanel.hidden = false;
    sourceField.hidden = true;
    if (!forceSimulator && !isSecureContext) {
      startError.textContent = "Motion sensors need an https:// page. Using the simulator instead.";
      startError.hidden = false;
    }
  }

  keepScreenAwake();
  startPanel.hidden = true;
  playPanel.hidden = false;

  const sources = {
    fused: () => new FusedMotionSource(),
    browser: () => new BrowserOrientationSource(),
  };
  // The phone's own orientation is the better one (see BrowserOrientationSource);
  // our fusion is for browsers that don't report it.
  if (!hasOrientation) {
    sourceSelect.querySelector<HTMLOptionElement>("option[value=browser]")!.disabled = true;
    sourceSelect.value = "fused";
  }
  let source: MotionSource = simulator ?? sources[sourceSelect.value as keyof typeof sources]();
  let seq = 0;
  const readout = startReadout(() => source);

  const onReading = (reading: MotionReading) => {
    readout.record(reading);
    link.send({
      type: "motion",
      seq: seq++,
      t: round(reading.t, 1),
      q: reading.q.map((c) => round(c, 5)) as Quat,
      w: reading.w.map((c) => round(c, 3)) as Vec3,
    });
  };
  const sayHello = () =>
    link.send({ type: "hello", source: source.kind, userAgent: navigator.userAgent });

  source.start(onReading);
  sayHello();
  link.onStatus((status) => {
    if (status.state === "connected") sayHello();
  });

  sourceSelect.addEventListener("change", () => {
    source.stop();
    source = sources[sourceSelect.value as keyof typeof sources]();
    source.start(onReading);
    sayHello();
  });

  calibrateButton.addEventListener("click", () => {
    link.send({ type: "calibrate" });
    readout.resetPeak();
    buzz(30);
  });

  if (simulator) {
    $("sim-swing").addEventListener("click", () => simulator.swing());
    addEventListener("keydown", (event) => {
      if (event.code === "Space") {
        event.preventDefault();
        simulator.swing();
      }
    });
  }
}

function init(): void {
  const code = location.hash.slice(1);
  if (!code) {
    statusEl.textContent = "Open this page by scanning the QR code on the game screen.";
    startButton.disabled = true;
    return;
  }

  const link = joinControllerLink(code);
  showStatus(link.status);
  link.onStatus(showStatus);
  link.onMessage((message) => {
    if (message.type === "ping") link.send({ type: "pong", id: message.id, t: performance.now() });
    if (message.type === "buzz") buzz(message.ms);
  });

  const forceSimulator = new URLSearchParams(location.search).has("sim");
  startButton.addEventListener("click", () => void start(link, forceSimulator));
}

init();
