import * as THREE from "three";

import { BALL_RADIUS, GRAVITY, STUMPS_Z } from "./physics";
import type { BallState, Vec3 } from "./physics";
import { Puppet, runPose, standPose } from "./puppet";
import type { Kit } from "./puppet";

export type Pace = "slow" | "medium" | "fast";

export const PACE_RANGES: Record<Pace, [number, number]> = {
  slow: [70, 85],
  medium: [85, 105],
  fast: [110, 135],
};

/** Distance of the bounce in front of the batter's stumps, metres, and how often each is bowled. */
const LENGTHS = [
  { name: "yorker", range: [0.6, 1.6], weight: 0.1 },
  { name: "full", range: [2, 4], weight: 0.3 },
  { name: "good length", range: [4.5, 7], weight: 0.45 },
  { name: "short", range: [7.5, 10], weight: 0.15 },
] as const;

/** Right-arm over the wicket, released from just behind the far popping crease (where the bowler's hand is). */
const RELEASE: Vec3 = [0.25, 2.08, -17.7];

export interface DeliveryPlan {
  speedKmh: number;
  length: (typeof LENGTHS)[number]["name"];
  /** Where the ball would pass the batter's stumps (x), if nothing stopped it. Off side is +x. */
  lineX: number;
  /** Where it pitches. */
  bounce: { x: number; z: number };
}

const between = (random: () => number, [lo, hi]: readonly [number, number]) => lo + (hi - lo) * random();

/**
 * Picks the next ball. `weights` (yorker, full, good length, short) overrides
 * how often each length comes.
 */
export function planDelivery(
  pace: Pace,
  random: () => number = Math.random,
  weights: readonly number[] = LENGTHS.map((l) => l.weight),
): DeliveryPlan {
  let pick = random() * weights.reduce((sum, w) => sum + w, 0);
  const length = LENGTHS.find((_, i) => (pick -= weights[i]) < 0) ?? LENGTHS[2];
  const bounceZ = STUMPS_Z - between(random, length.range);
  // Mostly around off stump (x ≈ 0.11), from middle-and-leg to a foot outside off.
  const lineX = 0.11 + (random() - random()) * 0.22;
  const [rx, , rz] = RELEASE;
  const bounceX = rx + ((lineX - rx) * (bounceZ - rz)) / (STUMPS_Z - rz);
  return {
    speedKmh: Math.round(between(random, PACE_RANGES[pace])),
    length: length.name,
    lineX,
    bounce: { x: bounceX, z: bounceZ },
  };
}

/** Where a ball launched like this first lands, ignoring everything but gravity and drag. */
function landingZ(start: BallState): number {
  const p: Vec3 = [...start.p];
  const v: Vec3 = [...start.v];
  const dt = 0.001;
  for (let i = 0; i < 3000; i++) {
    const speed = Math.hypot(v[0], v[1], v[2]);
    v[0] -= 0.007 * speed * v[0] * dt;
    v[1] -= (GRAVITY + 0.007 * speed * v[1]) * dt;
    v[2] -= 0.007 * speed * v[2] * dt;
    p[0] += v[0] * dt;
    p[1] += v[1] * dt;
    p[2] += v[2] * dt;
    if (p[1] <= BALL_RADIUS) return p[2];
  }
  return p[2];
}

/** The release that makes the ball pitch where the plan says, at the planned speed. */
export function launch(plan: DeliveryPlan): BallState {
  const speed = plan.speedKmh / 3.6;
  const [rx, ry, rz] = RELEASE;
  const dx = plan.bounce.x - rx;
  const dz = plan.bounce.z - rz;
  const flat = Math.hypot(dx, dz);
  const make = (angle: number): BallState => ({
    p: [rx, ry, rz],
    v: [(dx / flat) * speed * Math.cos(angle), speed * Math.sin(angle), (dz / flat) * speed * Math.cos(angle)],
  });
  // Steeper down lands shorter; bisect on the release angle.
  let lo = -0.45;
  let hi = 0.2;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (landingZ(make(mid)) < plan.bounce.z) lo = mid;
    else hi = mid;
  }
  return make((lo + hi) / 2);
}

export const RUN_UP_MS = 2200;
const RUN_UP_START_Z = -31;
/** Where the bowler's feet are at release; the hand is then up at RELEASE. */
const RELEASE_BODY_Z = -18.05;
const BOWLER_X = 0.45;
/** The delivery stride, from the last running step to release. */
const STRIDE_MS = 380;
const UP = new THREE.Vector3(0, 1, 0);
const FACING = new THREE.Vector3(0, 0, 1);
/** Facing the batter, the bowler's right is −x. */
const RIGHT = new THREE.Vector3(-1, 0, 0);
const ARM = 0.58;

/** Distance run in after `ms`, picking up speed into the crease. */
function runUpZ(ms: number): number {
  const u = Math.min(Math.max(ms, 0) / RUN_UP_MS, 1);
  return RUN_UP_START_Z + (RELEASE_BODY_Z - RUN_UP_START_Z) * (u * u * 0.3 + u * 0.7);
}

/** One running cycle (two strides) per 2.4 m. */
const stridePhase = (distance: number) => (distance * Math.PI * 2) / 2.4;

export const BOWLING_KIT: Kit = { shirt: 0x13806b, trousers: 0x13806b, skin: 0x8a5a3b, cap: 0x0b4f43, shoes: 0xf2f2f2 };

/** The bowler: runs in, delivers from the hand, follows through off the pitch. */
export class Bowler {
  readonly puppet = new Puppet(BOWLING_KIT);
  readonly #base = new THREE.Vector3();

  get group(): THREE.Group {
    return this.puppet.group;
  }

  /** Where the ball is while the bowler still has it. */
  get hand(): THREE.Vector3 {
    return this.puppet.pose.handR;
  }

  /** Poses the bowler `ms` after the run-up started; the ball leaves the hand at RUN_UP_MS. */
  pose(ms: number): void {
    const p = this.puppet.pose;
    const strideStart = RUN_UP_MS - STRIDE_MS;
    if (ms < strideStart) {
      const z = runUpZ(ms);
      this.#base.set(BOWLER_X, 0, z);
      runPose(p, this.#base, FACING, stridePhase(z - RUN_UP_START_Z), 0.55 + 0.4 * (ms / RUN_UP_MS));
    } else if (ms < RUN_UP_MS + 250) {
      this.#delivery((ms - strideStart) / STRIDE_MS, ms);
    } else {
      // Follow-through: slowing down and veering off the pitch.
      const s = Math.min((ms - RUN_UP_MS - 250) / 1000, 1.3);
      const z = RELEASE_BODY_Z + 0.75 + 4.2 * s - 1.6 * s * s;
      this.#base.set(BOWLER_X + s * 0.8, 0, z);
      if (s >= 1.3) standPose(p, this.#base, FACING, ms / 1000);
      else runPose(p, this.#base, FACING, stridePhase(z - RUN_UP_START_Z), Math.max(0.15, 0.7 - 0.45 * s));
    }
    this.puppet.apply();
  }

  /** u = 0 at the start of the stride, 1 at release. */
  #delivery(u: number, ms: number): void {
    const p = this.puppet.pose;
    const after = Math.max(0, ms - RUN_UP_MS) / 1000;
    this.#base.set(BOWLER_X, 0, runUpZ(ms) + after * 3);
    const at = (out: THREE.Vector3, forward: number, side: number, up: number) =>
      out.copy(this.#base).addScaledVector(FACING, forward).addScaledVector(RIGHT, side).setY(up);
    const settle = Math.min(u, 1);
    // Leaning back as the arm loads, then driving forward through release.
    const lean = -0.12 + 0.4 * Math.min(Math.max((u - 0.6) / 0.6, 0), 1);
    p.facing.copy(FACING);
    p.look = undefined;
    at(p.pelvis, 0, 0, 0.94 - 0.08 * settle);
    at(p.chest, lean, 0, 1.47 - 0.03 * settle);
    p.head.copy(p.chest).addScaledVector(UP, 0.26).addScaledVector(FACING, 0.05);
    // Front foot reaches out and plants; back foot drags up after release.
    at(p.footL, 0.55, -0.08, Math.max(0, 0.25 * (1 - u * 2)));
    at(p.footR, -0.45, 0.1, u > 0.9 ? Math.min(0.3, (u - 0.9) * 0.75) : 0);
    // Bowling arm wheels over: hanging down (0), back, up, release at 200°, down across.
    const angle = 3.49 * u;
    const shoulder = p.chest.clone().addScaledVector(UP, 0.08).addScaledVector(RIGHT, 0.2);
    p.handR.copy(shoulder).addScaledVector(UP, -ARM * Math.cos(angle)).addScaledVector(FACING, -ARM * Math.sin(angle));
    // Front arm reaches high, then pulls down as the bowling arm comes over.
    const pull = Math.min(Math.max((u - 0.55) / 0.5, 0), 1);
    const high = at(new THREE.Vector3(), 0.4, -0.28, 1.95);
    const low = at(new THREE.Vector3(), -0.05, -0.32, 0.95);
    p.handL.lerpVectors(high, low, pull);
  }

  reset(): void {
    this.pose(0);
  }
}
