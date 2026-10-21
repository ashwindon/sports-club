import * as THREE from "three";

import type { Sounds } from "./audio";
import { BallView } from "./ball";
import { BLADE, GRIP_AT_STANCE } from "./bat";
import type { BatRig } from "./bat";
import { Bowler, RUN_UP_MS, launch, planDelivery } from "./bowling";
import type { DeliveryPlan, Pace } from "./bowling";
import { boost, findContact, isHittingMotion, rebound, timedShot } from "./collision";
import { DIFFICULTIES } from "./difficulty";
import type { Difficulty, DifficultyName } from "./difficulty";
import { BOUNDARY_RADIUS, Field, shotDirection } from "./field";
import type { Outcome } from "./field";
import type { Hud } from "./hud";
import { STUMPS_Z, hitsStumps, simulate } from "./physics";
import type { BallState, Trajectory, Vec3 } from "./physics";
import type { Stage } from "./scene";

/** Where and when the bat met the ball. */
interface Hit {
  /** Game time, ms. */
  t: number;
  ball: THREE.Vector3;
  /** Off an edge rather than the face. */
  edge: boolean;
}

const OVERS = 2;
const MAX_WICKETS = 3;
/** Quiet time between one ball's result clearing and the next run-up. */
const BETWEEN_BALLS_MS = 900;
const SHOW_RESULT_MS = 2600;
const SHOW_SUMMARY_MS = 7000;
const BEST_KEY = "sports-club-best";
const STANCE_STEP = new THREE.Vector3();
/** Height of the bat's sweet spot with the bat upright in the stance. */
const SWEET_SPOT_HEIGHT = GRIP_AT_STANCE.y + BLADE.toe + BLADE.sweetSpot;

interface Delivery {
  plan: DeliveryPlan;
  runUpStart: number;
  release: number;
  /** The ball as bowled, until the keeper takes it. */
  flight: Trajectory;
  /** When it would hit the stumps, if it would. */
  stumpsAt: number | undefined;
  /** When it reaches the batter's hands. */
  reachesBatAt: number;
  /** When it has gone past anywhere the bat could reach. */
  goneAt: number;
  /** The batter's footwork: into line (x), and up or down so the sweet spot meets the ball (y). */
  step: THREE.Vector3;
  /** Bat readings since just before release: game time and spin (°/s). */
  readings: { t: number; spin: number }[];
  contact?: Hit;
  /**
   * The hit's sound and text have played. A flag rather than a time check:
   * contact is only found once the bat reading arrives, by which time the
   * moment may already be on screen.
   */
  contactShown?: boolean;
  hit?: Trajectory;
  outcome?: Outcome;
  /** Bat readings have been checked against the ball up to here (game ms). */
  checkedTo: number;
  revealed: boolean;
  doneAt: number;
}

export interface MatchHooks {
  /** A phone is connected and the bat calibrated. */
  ready(): boolean;
  /**
   * How late the phone's readings arrive, ms. Everything is drawn this far
   * behind real time, so the ball on screen lines up with the bat on screen.
   */
  latency(): number;
  /** The bat met the ball; strength 0–1. */
  onHit(strength: number): void;
}

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeBest(runs: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(runs));
  } catch {
    // Not remembering the best score is fine.
  }
}

export class Match {
  readonly group = new THREE.Group();
  pace: Pace = DIFFICULTIES.easy.pace;
  paused = false;
  #difficulty: DifficultyName = "easy";

  readonly #rig: BatRig;
  readonly #hud: Hud;
  readonly #sounds: Sounds;
  readonly #stage: Stage;
  readonly #hooks: MatchHooks;
  readonly #ball = new BallView();
  readonly #bowler = new Bowler();
  readonly #field = new Field();
  #delivery: Delivery | undefined;
  /** Display time before which the next run-up may not start. */
  #nextAt = 0;
  /** How far behind real time things are drawn, fixed for each delivery. */
  #delay = 0;
  #lastDisplay = 0;
  #runs = 0;
  #wickets = 0;
  #balls = 0;
  #thisOver: string[] = [];
  #best = readBest();
  #summaryUntil: number | undefined;
  /** The headline on the stadium's big screen, cleared at the next ball. */
  #screenEvent: string | undefined;

  constructor(rig: BatRig, hud: Hud, sounds: Sounds, stage: Stage, hooks: MatchHooks) {
    this.#rig = rig;
    this.#hud = hud;
    this.#sounds = sounds;
    this.#stage = stage;
    this.#hooks = hooks;
    this.group.add(this.#ball.group, this.#bowler.group, this.#field.group);
    this.#bowler.reset();
    this.#showScore();
  }

  get difficulty(): DifficultyName {
    return this.#difficulty;
  }

  /** Changes difficulty from the next ball, along with that difficulty's pace. */
  set difficulty(name: DifficultyName) {
    this.#difficulty = name;
    this.pace = DIFFICULTIES[name].pace;
  }

  get #settings(): Difficulty {
    return DIFFICULTIES[this.#difficulty];
  }

  /** When the ball on its way reaches the batter (game ms), until it's been played. For tests and tuning. */
  get arrival(): number | undefined {
    const d = this.#delivery;
    return d && !d.outcome ? d.reachesBatAt : undefined;
  }

  newInnings(): void {
    this.#delivery = undefined;
    this.#runs = this.#wickets = this.#balls = 0;
    this.#thisOver = [];
    this.#summaryUntil = undefined;
    this.#nextAt = 0;
    this.#screenEvent = undefined;
    this.#ball.hide();
    this.#bowler.reset();
    this.#field.reset();
    this.#stage.resetStumps();
    this.#stage.follow(null);
    this.#hud.clearBanner();
    this.#hud.delivery("");
    this.#hud.speed(undefined);
    this.#showScore();
  }

  /**
   * Checks the bat's movement between two readings (game ms) against the ball;
   * `spinDeg` is how fast the bat was turning at the newer one. Call after
   * every reading, once the rig has it.
   */
  onBatReading(from: number, to: number, spinDeg: number): void {
    const d = this.#delivery;
    if (!d || d.outcome || to < d.release - 300) return;
    d.readings.push({ t: to, spin: spinDeg });
    const settings = this.#settings;

    // The bat's real path against the ball's.
    const start = Math.max(from, d.checkedTo, d.release);
    // Nothing to hit once the ball has hit the stumps.
    const end = Math.min(to, d.stumpsAt ?? Infinity, d.flight.tEnd);
    d.checkedTo = Math.max(d.checkedTo, to);
    if (settings.contact && end > start) {
      const contact = findContact(this.#rig, d.flight, start, end, settings.contact);
      if (contact) {
        const after = boost(rebound(contact), settings.contact.power, settings.contact.loftDeg);
        this.#launch(d, { t: contact.t, ball: contact.ball, edge: contact.edge }, after);
        return;
      }
    }
    if (settings.timing) this.#checkTiming(d);
  }

  /**
   * Timing hits: when a swing has just passed its fastest moment, and that
   * moment fell close enough to the ball reaching the bat, it's a hit. An
   * early swing connects when the ball arrives; a late one, where the ball is.
   */
  #checkTiming(d: Delivery): void {
    const timing = this.#settings.timing!;
    const readings = d.readings;
    if (readings.length < 2) return;
    const peak = readings[readings.length - 2];
    const now = readings[readings.length - 1];
    if (peak.spin < timing.minSpinDeg || now.spin >= peak.spin) return;
    const timingMs = peak.t - d.reachesBatAt;
    if (timingMs < -timing.earlyMs || timingMs > timing.lateMs) return;
    // A backlift or a waggle is fast too; only a swing led by the face counts.
    if (!isHittingMotion(this.#rig, peak.t)) return;

    const t = Math.max(d.reachesBatAt, peak.t);
    if (d.stumpsAt !== undefined && t > d.stumpsAt) return;
    const rotation = new THREE.Quaternion();
    if (!this.#rig.rotationAt(peak.t, rotation)) return;
    const ball = d.flight.positionAt(t);
    this.#launch(d, { t, ball: new THREE.Vector3(...ball), edge: false }, timedShot(timing, timingMs, peak.spin, rotation, ball));
  }

  /** Advances to real time `now` (ms); dt in seconds. */
  update(now: number, dt: number): void {
    const display = now - this.#delay;
    const last = this.#lastDisplay;
    this.#lastDisplay = display;
    const crossed = (t: number | undefined) => t !== undefined && last < t && t <= display;
    const d = this.#delivery;

    // The batter moves into position just before release, and back afterwards.
    const step = d && display >= d.release - 150 ? d.step : STANCE_STEP;
    this.#rig.step.lerp(step, 1 - Math.exp(-dt / 0.1));
    this.#rig.refresh();
    this.#field.update(display);

    if (this.#summaryUntil !== undefined) {
      if (display >= this.#summaryUntil) this.newInnings();
      return;
    }
    if (!d) {
      if (!this.paused && display >= this.#nextAt && this.#hooks.ready()) this.#startDelivery(now);
      return;
    }

    this.#bowler.pose(display - d.runUpStart);
    if (crossed(d.release)) {
      this.#hud.delivery(`${d.plan.speedKmh} km/h · ${d.plan.length}`);
      this.#hud.speed(d.plan.speedKmh);
    }

    // The ball: in the bowler's hand, then as bowled, then (after a hit) as
    // hit, stopping where it's caught or fielded.
    if (display < d.release) {
      if (display >= d.runUpStart) this.#ball.hold(this.#bowler.hand);
    } else {
      const p: Vec3 = [0, 0, 0];
      if (d.contact && d.hit && display >= d.contact.t) {
        const stop = d.outcome && d.outcome.kind !== "six" && d.outcome.kind !== "four" ? d.outcome.revealAt : Infinity;
        d.hit.positionAt(Math.min(display, stop), p);
        this.#ball.show(p);
        this.#stage.follow(this.#ball.position);
      } else {
        d.flight.positionAt(Math.min(display, d.stumpsAt ?? Infinity), p);
        this.#ball.show(p);
      }
    }

    const pitched = d.flight.bounces[0];
    if (crossed(pitched) && !(d.contact && d.contact.t < pitched)) {
      const p = d.flight.positionAt(pitched);
      this.#ball.markPitch(p[0], p[2]);
      this.#stage.effects.dust(new THREE.Vector3(...p), 0.6);
      this.#sounds.bounce();
    }
    if (d.contact && !d.contactShown && display >= d.contact.t) {
      d.contactShown = true;
      this.#showContact(d, d.contact);
    }
    if (d.hit) {
      for (const bounce of d.hit.bounces.slice(0, 3)) {
        if (!crossed(bounce)) continue;
        this.#stage.effects.dust(new THREE.Vector3(...d.hit.positionAt(bounce)), 0.4, 0x9cbf6c);
        this.#sounds.bounce();
      }
    }

    // A missed ball is decided once the bat readings for that moment are in
    // (or, if the phone has gone quiet, a little after).
    if (!d.outcome && !d.contact) {
      const batUpTo = this.#rig.latestTime;
      if (d.stumpsAt !== undefined) {
        if (batUpTo >= d.stumpsAt || display >= d.stumpsAt + 300) {
          d.outcome = { kind: "bowled", revealAt: d.stumpsAt, playedOn: false };
        }
      } else if (batUpTo >= d.goneAt || display >= d.goneAt + 300) {
        d.outcome = { kind: "dot", revealAt: d.flight.tEnd };
      }
    }

    if (d.outcome && !d.revealed && display >= d.outcome.revealAt) {
      d.revealed = true;
      d.doneAt = display + SHOW_RESULT_MS;
      this.#reveal(d, d.outcome);
    }
    if (d.revealed && display >= d.doneAt) this.#finish(display);
  }

  #startDelivery(now: number): void {
    this.#delay = Math.min(Math.max(this.#hooks.latency(), 0), 150);
    const display = now - this.#delay;
    this.#lastDisplay = display;
    if (this.#balls > 0 && this.#balls % 6 === 0 && this.#thisOver.length === 6) this.#thisOver = [];

    const plan = planDelivery(this.pace, Math.random, this.#settings.lengths);
    const runUpStart = display + 200;
    const release = runUpStart + RUN_UP_MS;
    const flight = simulate(launch(plan), release, 3, (p) => p[2] > 16.3);

    let stumpsAt: number | undefined;
    let goneAt = flight.tEnd;
    let reachesBatAt: number | undefined;
    const step = new THREE.Vector3();
    const p: Vec3 = [0, 0, 0];
    for (let i = 0; i < flight.count; i++) {
      const t = flight.timeAt(i);
      flight.positionAt(t, p);
      if (reachesBatAt === undefined && p[2] >= GRIP_AT_STANCE.z) {
        reachesBatAt = t;
        step.set(
          Math.min(Math.max(p[0] - GRIP_AT_STANCE.x, -0.6), 0.45),
          Math.min(Math.max(p[1] - SWEET_SPOT_HEIGHT, -0.12), 0.3),
          0,
        );
      }
      if (stumpsAt === undefined && hitsStumps(p[0], p[1], p[2])) stumpsAt = t;
      if (p[2] > STUMPS_Z + 0.4) {
        goneAt = t;
        break;
      }
    }

    this.#delivery = {
      plan,
      runUpStart,
      release,
      flight,
      stumpsAt,
      reachesBatAt: reachesBatAt ?? goneAt,
      goneAt,
      step,
      readings: [],
      checkedTo: release,
      revealed: false,
      doneAt: Infinity,
    };
    this.#screenEvent = undefined;
    this.#ball.hide();
    this.#field.reset();
    this.#field.prepare(runUpStart, release);
    this.#stage.resetStumps();
    this.#stage.follow(null);
    this.#hud.clearBanner();
    this.#hud.delivery("");
    this.#hud.speed(undefined);
    this.#showScore();
  }

  /** The ball leaves the bat: fly it, and work out where it ends up. */
  #launch(d: Delivery, contact: Hit, after: BallState): void {
    d.contact = contact;
    d.hit = simulate(after, contact.t, 9, (p) => Math.hypot(p[0], p[2] + 9.4) > BOUNDARY_RADIUS + 12);
    const outcome = this.#field.resolve(d.hit, this.#settings.catching);
    d.outcome = outcome;
    if (outcome.kind === "caught" || outcome.kind === "runs") {
      const from = contact.t + outcome.fielder.reaction * 1000;
      this.#field.chase(outcome.fielder, from, outcome.revealAt, outcome.at, outcome.kind === "caught");
    }
    this.#hooks.onHit(Math.min(Math.hypot(...after.v) / 40, 1));
  }

  #showContact(d: Delivery, contact: Hit): void {
    const after = d.hit!.velocityAt(contact.t);
    const kmh = Math.round(Math.hypot(...after) * 3.6);
    const strength = Math.min(kmh / 140, 1);
    this.#sounds.bat(strength);
    this.#stage.effects.flash(contact.ball, strength);
    if (strength > 0.5) this.#stage.shake(strength * 0.6);
    const how = contact.edge ? "edged" : "hit";
    this.#hud.delivery(`${d.plan.speedKmh} km/h · ${d.plan.length} · ${how} ${shotDirection(after)} at ${kmh} km/h`);
  }

  #reveal(d: Delivery, outcome: Outcome): void {
    let symbol: string;
    switch (outcome.kind) {
      case "six":
      case "four": {
        this.#runs += outcome.runs;
        symbol = String(outcome.runs);
        const where = d.hit ? shotDirection(d.hit.velocityAt(d.hit.t0)) : "";
        this.#hud.banner(
          outcome.kind === "six" ? "SIX!" : "FOUR!",
          outcome.kind === "six" ? `${outcome.distance} m, ${where}` : where,
          "boundary",
        );
        this.#sounds.crowd();
        this.#stage.stadium.cheer(outcome.kind === "six" ? 4 : 3);
        this.#screenEvent = outcome.kind === "six" ? "SIX!" : "FOUR!";
        break;
      }
      case "runs":
        this.#runs += outcome.runs;
        symbol = outcome.runs === 0 ? "•" : String(outcome.runs);
        this.#hud.banner(
          outcome.runs === 0 ? "No run" : `${outcome.runs} run${outcome.runs > 1 ? "s" : ""}`,
          `fielded by ${outcome.fielder.name}`,
        );
        break;
      case "caught":
        this.#wickets += 1;
        symbol = "W";
        this.#hud.banner("CAUGHT!", `by ${outcome.fielder.name}`, "wicket");
        this.#sounds.catch();
        this.#sounds.crowd();
        this.#stage.stadium.cheer(2.5);
        this.#screenEvent = "OUT!";
        break;
      case "bowled":
        this.#wickets += 1;
        symbol = "W";
        this.#hud.banner("BOWLED!", outcome.playedOn ? "played on" : "", "wicket");
        this.#stage.knockStumps();
        this.#sounds.stumps();
        this.#sounds.crowd();
        this.#stage.stadium.cheer(2.5);
        this.#screenEvent = "OUT!";
        break;
      case "dot":
        symbol = "•";
        this.#hud.banner("Dot ball", "beaten");
        this.#sounds.catch();
        break;
    }
    this.#balls += 1;
    this.#thisOver.push(symbol);
    this.#showScore();
  }

  #finish(display: number): void {
    this.#delivery = undefined;
    this.#ball.hide();
    this.#field.reset();
    this.#stage.follow(null);
    this.#nextAt = display + BETWEEN_BALLS_MS;

    if (this.#balls >= OVERS * 6 || this.#wickets >= MAX_WICKETS) {
      const record = this.#runs > this.#best;
      if (record) {
        this.#best = this.#runs;
        writeBest(this.#runs);
      }
      this.#hud.banner(
        `${this.#runs}/${this.#wickets}`,
        record ? "Innings over · new best!" : `Innings over · best ${this.#best}`,
        record ? "boundary" : "plain",
      );
      this.#summaryUntil = display + SHOW_SUMMARY_MS;
      return;
    }
    this.#hud.clearBanner();
    if (this.#balls % 6 === 0) {
      this.#hud.banner("End of the over", `${this.#runs}/${this.#wickets}`);
      this.#nextAt += 1500;
    }
  }

  #showScore(): void {
    this.#hud.score(this.#runs, this.#wickets, this.#balls, OVERS, this.#thisOver);
    this.#stage.stadium.showOnScreen({
      score: `${this.#runs}/${this.#wickets}`,
      overs: `${Math.floor(this.#balls / 6)}.${this.#balls % 6}`,
      thisOver: this.#thisOver,
      event: this.#screenEvent,
    });
  }
}
