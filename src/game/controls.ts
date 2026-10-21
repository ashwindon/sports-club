// The control panel: real buttons with a visible state for everything you
// can change, the same actions on the keyboard, and a short message saying
// what just changed.
import type { Sounds } from "./audio";
import type { BatRig } from "./bat";
import { PACE_RANGES } from "./bowling";
import type { Pace } from "./bowling";
import { DIFFICULTIES } from "./difficulty";
import type { DifficultyName } from "./difficulty";
import type { Match } from "./match";
import type { Stage } from "./scene";

const PACE_LABELS: Record<Pace, string> = { slow: "Slow", medium: "Medium", fast: "Fast" };
const VIEW_LABELS = ["behind the batter", "side-on", "from the bowler's end"];

export interface ControlsDeps {
  match: Match;
  stage: Stage;
  rig: BatRig;
  sounds: Sounds;
  /** Calibrates the phone in use; false when no phone is connected. */
  calibrate(): boolean;
  stats: { readonly shown: boolean; toggle(): void };
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;

export function createControls(deps: ControlsDeps): { refresh(): void; toast(text: string): void } {
  const { match, stage, rig, sounds } = deps;
  const panel = $("controls");
  const showButton = $("ctl-show");
  const toastEl = $("toast");
  const calibrateButton = $("ctl-calibrate");
  let toastTimer: number | undefined;

  const toast = (text: string) => {
    toastEl.textContent = text;
    toastEl.hidden = false;
    toastEl.classList.remove("show");
    void toastEl.offsetWidth;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toastEl.hidden = true), 2800);
  };

  const actions = {
    calibrate() {
      if (!deps.calibrate()) {
        toast("Connect a phone first, then calibrate.");
        return;
      }
      toast("Calibrated ✓  The bat now faces the bowler.");
      calibrateButton.classList.add("done");
      window.setTimeout(() => calibrateButton.classList.remove("done"), 1400);
    },
    pause() {
      match.paused = !match.paused;
      toast(match.paused ? "Paused: no more balls after this one until you resume." : "Resumed: the bowler's coming in.");
    },
    newInnings() {
      match.newInnings();
      toast("New innings: 2 overs, 3 wickets.");
    },
    difficulty(name: DifficultyName) {
      match.difficulty = name;
      const d = DIFFICULTIES[name];
      toast(`${d.label}: ${d.blurb} Pace set to ${PACE_LABELS[d.pace].toLowerCase()}.`);
    },
    pace(pace: Pace) {
      match.pace = pace;
      const [lo, hi] = PACE_RANGES[pace];
      toast(`Bowling pace: ${PACE_LABELS[pace].toLowerCase()}, ${lo}–${hi} km/h, from the next ball.`);
    },
    view(index: number) {
      stage.setView(index);
      toast(`Camera: ${VIEW_LABELS[index]}.`);
    },
    async sound() {
      const on = await sounds.toggle();
      toast(on ? "Sound on." : "Sound off.");
      refresh();
    },
    stats() {
      deps.stats.toggle();
      toast(deps.stats.shown ? "Showing link and swing numbers." : "Numbers hidden.");
    },
    debug() {
      rig.debug = !rig.debug;
      toast(rig.debug ? "Debug on: arm-model line and bat-toe trail." : "Debug off.");
    },
    togglePanel() {
      panel.hidden = !panel.hidden;
      showButton.hidden = !panel.hidden;
    },
  };

  /** A row of mutually exclusive buttons; the chosen one is marked pressed. */
  const segmented = (id: string, current: () => string, choose: (value: string) => void) => {
    const group = $(id);
    group.addEventListener("click", (event) => {
      const value = (event.target as HTMLElement).closest("button")?.dataset.value;
      if (value === undefined) return;
      choose(value);
      refresh();
    });
    return () => {
      for (const button of group.querySelectorAll("button")) {
        button.setAttribute("aria-pressed", String(button.dataset.value === current()));
      }
    };
  };

  /** An on/off button, showing its state in words as well as colour. */
  const switchButton = (id: string, isOn: () => boolean, act: () => void | Promise<void>) => {
    const button = $(id);
    const state = button.querySelector(".ctl-state")!;
    button.addEventListener("click", () => {
      void act();
      refresh();
    });
    return () => {
      const on = isOn();
      button.setAttribute("aria-pressed", String(on));
      state.textContent = on ? "ON" : "OFF";
    };
  };

  const renderers = [
    segmented("ctl-difficulty", () => match.difficulty, (v) => actions.difficulty(v as DifficultyName)),
    segmented("ctl-pace", () => match.pace, (v) => actions.pace(v as Pace)),
    segmented("ctl-view", () => String(stage.view), (v) => actions.view(Number(v))),
    switchButton("ctl-pause", () => match.paused, actions.pause),
    switchButton("ctl-sound", () => sounds.on, actions.sound),
    switchButton("ctl-stats", () => deps.stats.shown, actions.stats),
    switchButton("ctl-debug", () => rig.debug, actions.debug),
    () => ($("ctl-difficulty-note").textContent = DIFFICULTIES[match.difficulty].blurb),
  ];
  function refresh(): void {
    for (const render of renderers) render();
  }

  // Messages sit just above the panel, however tall it is (or isn't, when hidden).
  const placeToast = () => {
    const height = panel.hidden ? showButton.offsetHeight : panel.offsetHeight;
    document.documentElement.style.setProperty("--controls-height", `${height + 10}px`);
  };
  new ResizeObserver(placeToast).observe(panel);
  new ResizeObserver(placeToast).observe(showButton);

  calibrateButton.addEventListener("click", actions.calibrate);
  $("ctl-new").addEventListener("click", () => {
    actions.newInnings();
    refresh();
  });
  $("ctl-hide").addEventListener("click", actions.togglePanel);
  showButton.addEventListener("click", actions.togglePanel);

  addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement).closest("select, input")) return;
    const key = event.key.toLowerCase();
    const paces: Record<string, Pace> = { "1": "slow", "2": "medium", "3": "fast" };
    const difficulties: Record<string, DifficultyName> = { e: "easy", i: "intermediate", h: "hard" };
    if (key === "c") actions.calibrate();
    else if (key === "p") actions.pause();
    else if (key === "r") actions.newInnings();
    else if (key in difficulties) actions.difficulty(difficulties[key]);
    else if (key in paces) actions.pace(paces[key]);
    else if (key === "v") actions.view((stage.view + 1) % VIEW_LABELS.length);
    else if (key === "s") actions.stats();
    else if (key === "d") actions.debug();
    else if (key === "m") actions.togglePanel();
    else return;
    refresh();
  });

  refresh();
  return { refresh, toast };
}
