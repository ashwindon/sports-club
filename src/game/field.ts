import * as THREE from "three";

import { BOWLING_KIT } from "./bowling";
import { STUMPS_Z, hitsStumps } from "./physics";
import type { Trajectory, Vec3 } from "./physics";
import { Puppet, catchPose, keeperPose, readyPose, runPose, standPose } from "./puppet";
import { BOUNDARY_RADIUS } from "./stadium";
import { GROUND_CENTRE_Z } from "./textures";

export { BOUNDARY_RADIUS };

interface FielderSpot {
  name: string;
  x: number;
  z: number;
  /** Close catchers barely move but react fast. */
  close?: boolean;
  /** Seconds before they move, if not the usual. */
  reaction?: number;
  /** Not drawn here (the bowler has a figure of their own). */
  hidden?: boolean;
  keeper?: boolean;
}

// A standard field to a right-hander against pace (off side is +x).
const SPOTS: FielderSpot[] = [
  { name: "the keeper", x: 0.3, z: 16.5, close: true, keeper: true },
  { name: "slip", x: 1.9, z: 17, close: true },
  { name: "gully", x: 8, z: 10, close: true },
  { name: "point", x: 24, z: 1 },
  { name: "cover", x: 21, z: -15 },
  { name: "mid-off", x: 9, z: -28 },
  { name: "mid-on", x: -9, z: -28 },
  { name: "midwicket", x: -22, z: -12 },
  { name: "square leg", x: -25, z: 2 },
  { name: "fine leg", x: -20, z: 42 },
  // Off to the side after the follow-through, and still off balance.
  { name: "the bowler", x: 1.4, z: -15.5, reaction: 0.6, hidden: true },
];

const KEEPER_KIT = { ...BOWLING_KIT, pads: true, gloves: 0xd7b04a };
/** How far outfielders walk in as the bowler runs up. */
const WALK_IN = 3;
const STUMPS = new THREE.Vector3(0, 0, STUMPS_Z);

export interface Fielder {
  name: string;
  home: THREE.Vector3;
  /** Where they are when the ball is bowled, after walking in. */
  ready: THREE.Vector3;
  close: boolean;
  keeper: boolean;
  reaction: number;
  puppet: Puppet | undefined;
}

export type Outcome =
  | { kind: "six" | "four"; runs: 6 | 4; revealAt: number; distance: number }
  | { kind: "runs"; runs: number; revealAt: number; fielder: Fielder; at: Vec3 }
  | { kind: "caught"; revealAt: number; fielder: Fielder; at: Vec3 }
  | { kind: "bowled"; revealAt: number; playedOn: boolean }
  | { kind: "dot"; revealAt: number };

/** Time from the batter starting a run to completing it, seconds. */
const SECONDS_PER_RUN = 3;
const THROW_SPEED = 25;
const RUN_SPEED = 6.5;
const REACTION = 0.3;

/** Shot direction in cricket terms, from the ball's initial horizontal velocity. */
export function shotDirection(v: Vec3): string {
  // 0° straight back past the bowler, positive towards the off side.
  const angle = (Math.atan2(v[0], -v[2]) * 180) / Math.PI;
  const a = Math.abs(angle);
  if (a < 15) return "straight";
  if (a > 150) return "behind";
  const off = angle > 0;
  if (a < 35) return off ? "mid-off" : "mid-on";
  if (a < 65) return off ? "cover" : "midwicket";
  if (a < 105) return off ? "point" : "square leg";
  return off ? "third man" : "fine leg";
}

const towardsStumps = (from: THREE.Vector3) => STUMPS.clone().sub(from).setY(0).normalize();

export class Field {
  readonly group = new THREE.Group();
  readonly fielders: Fielder[];
  #timeline: { walkFrom: number; release: number } | undefined;
  #chase:
    | { fielder: Fielder; from: number; to: number; target: THREE.Vector3; caught: boolean; phase: number; last: THREE.Vector3 }
    | undefined;

  constructor() {
    this.fielders = SPOTS.map((spot) => {
      const home = new THREE.Vector3(spot.x, 0, spot.z);
      const ready = spot.close || spot.hidden ? home.clone() : home.clone().addScaledVector(towardsStumps(home), WALK_IN);
      const puppet = spot.hidden ? undefined : new Puppet(spot.keeper ? KEEPER_KIT : BOWLING_KIT);
      if (puppet) this.group.add(puppet.group);
      const reaction = spot.reaction ?? (spot.close ? 0.12 : REACTION);
      return { name: spot.name, home, ready, close: Boolean(spot.close), keeper: Boolean(spot.keeper), reaction, puppet };
    });
    this.update(0);
  }

  /** The bowler runs in from `runUpStart` and lets go at `release` (game ms): fielders walk in meanwhile. */
  prepare(runUpStart: number, release: number): void {
    this.#timeline = { walkFrom: runUpStart + 500, release };
  }

  /** Sends a fielder from where they're standing to `target`, arriving at game time `to`. */
  chase(fielder: Fielder, from: number, to: number, target: Vec3, caught: boolean): void {
    this.#chase = {
      fielder,
      from,
      to,
      target: new THREE.Vector3(...target),
      caught,
      phase: 0,
      last: fielder.ready.clone(),
    };
  }

  /** Poses everyone for game time t. */
  update(t: number): void {
    const seconds = t / 1000;
    const timeline = this.#timeline;
    for (const fielder of this.fielders) {
      const puppet = fielder.puppet;
      if (!puppet) continue;
      const pose = puppet.pose;
      const chase = this.#chase?.fielder === fielder && t >= this.#chase.from ? this.#chase : undefined;

      if (chase) {
        const u = Math.min((t - chase.from) / Math.max(chase.to - chase.from, 1), 1);
        const ground = chase.target.clone().setY(0);
        const at = fielder.ready.clone().lerp(ground, u);
        const heading = ground.clone().sub(fielder.ready).setY(0);
        const facing = heading.lengthSq() > 0.01 ? heading.normalize() : towardsStumps(at);
        if (u < 1) {
          chase.phase += (at.distanceTo(chase.last) * Math.PI * 2) / 2.4;
          runPose(pose, at, facing, chase.phase, 1);
        } else if (chase.caught) {
          catchPose(pose, at, towardsStumps(at), chase.target);
        } else {
          readyPose(pose, at, facing);
        }
        chase.last.copy(at);
      } else if (fielder.keeper) {
        if (timeline && t >= timeline.walkFrom) keeperPose(pose, fielder.home, towardsStumps(fielder.home));
        else standPose(pose, fielder.home, towardsStumps(fielder.home), seconds);
      } else if (timeline && t >= timeline.release) {
        readyPose(pose, fielder.ready, towardsStumps(fielder.ready));
      } else if (timeline && t >= timeline.walkFrom) {
        const u = (t - timeline.walkFrom) / Math.max(timeline.release - timeline.walkFrom, 1);
        const at = fielder.home.clone().lerp(fielder.ready, u);
        runPose(pose, at, towardsStumps(at), (fielder.home.distanceTo(at) * Math.PI * 2) / 1.3, 0.12);
      } else {
        standPose(pose, fielder.home, towardsStumps(fielder.home), seconds + fielder.home.x);
      }
      puppet.apply();
    }
  }

  reset(): void {
    this.#chase = undefined;
    this.#timeline = undefined;
  }

  /**
   * Plays out a hit: the first catch, stop or boundary along the flight
   * decides it. Fielders react after their reaction time and run at RUN_SPEED.
   * `catching` below 1 shortens their reach for catches and slows them to react.
   */
  resolve(flight: Trajectory, catching = 1): Outcome {
    const t0 = flight.t0;
    const firstBounce = flight.bounces[0] ?? Infinity;
    const p: Vec3 = [0, 0, 0];
    const v: Vec3 = [0, 0, 0];
    const step = 10; // samples, i.e. 10 ms

    // Played on: an inside edge that carries back into the stumps.
    for (let i = 0; i < Math.min(flight.count, 500); i += 2) {
      flight.positionAt(flight.timeAt(i), p);
      if (hitsStumps(p[0], p[1], p[2])) return { kind: "bowled", revealAt: flight.timeAt(i), playedOn: true };
    }

    for (let i = 0; i < flight.count; i += step) {
      const t = flight.timeAt(i);
      const seconds = (t - t0) / 1000;
      flight.positionAt(t, p);
      const inAir = t < firstBounce;
      // A hard-hit ball has to come almost straight at you to be held.
      const hard = Math.hypot(...flight.velocityAt(t, v)) > 25;

      if (Math.hypot(p[0], p[2] - GROUND_CENTRE_Z) >= BOUNDARY_RADIUS) {
        const distance = Math.round(Math.hypot(p[0], p[2] - STUMPS_Z));
        return inAir
          ? { kind: "six", runs: 6, revealAt: t, distance }
          : { kind: "four", runs: 4, revealAt: t, distance };
      }

      for (const fielder of this.fielders) {
        const speed = fielder.close ? 3 : RUN_SPEED;
        const arms = inAir ? (hard ? 0.9 : 1.3) * catching : hard ? 0.7 : 1.0;
        const reaction = fielder.reaction + (inAir ? (1 - catching) * 0.4 : 0);
        const reach = arms + speed * Math.max(0, seconds - reaction);
        const away = Math.hypot(p[0] - fielder.ready.x, p[2] - fielder.ready.z);
        if (away > reach) continue;
        if (inAir && p[1] >= 0.1 && p[1] <= (fielder.close ? 2.3 : 2.7)) {
          return { kind: "caught", revealAt: t, fielder, at: [...p] };
        }
        if (!inAir && p[1] < 1) return this.#runs(fielder, t, seconds, p);
      }
    }

    // Stopped (or flight cut short) before anyone got there: the nearest fielder runs to it.
    const end = flight.tEnd;
    flight.positionAt(end, p);
    let nearest = this.fielders[0];
    let best = Infinity;
    for (const fielder of this.fielders) {
      const d = Math.hypot(p[0] - fielder.ready.x, p[2] - fielder.ready.z);
      if (d < best) [nearest, best] = [fielder, d];
    }
    const arrive = Math.max((end - t0) / 1000, REACTION + Math.max(0, best - 1) / RUN_SPEED);
    return this.#runs(nearest, t0 + arrive * 1000, arrive, p);
  }

  #runs(fielder: Fielder, t: number, seconds: number, p: Vec3): Outcome {
    // Runs completed by the time the throw gets back, less a second to get going.
    const throwBack = Math.hypot(p[0], p[2] - STUMPS_Z) / THROW_SPEED + 0.5;
    const runs = Math.min(3, Math.max(0, Math.floor((seconds + throwBack - 1) / SECONDS_PER_RUN)));
    return { kind: "runs", runs, revealAt: t, fielder, at: [...p] };
  }
}
