// Ball flight: gravity, air drag and bounces, integrated in 1 ms steps and
// stored so any moment of a flight can be looked up again (the bat's samples
// arrive late, and are checked against where the ball was when they were taken).

export const BALL_RADIUS = 0.036;
export const GRAVITY = 9.81;
/** ½ρC_dA/m for a cricket ball (156 g, 72 mm, C_d ≈ 0.45), per metre. */
const DRAG = 0.007;
/** Integration step, seconds. */
export const STEP = 0.001;

/** Batter's stumps: three of them, centred on x = 0 at this z. */
export const STUMPS_Z = 1.22;
export const STUMPS_HALF_WIDTH = 0.1143 + 0.018;
export const STUMPS_HEIGHT = 0.711;

export type Vec3 = [number, number, number];

export interface BallState {
  p: Vec3;
  v: Vec3;
}

interface Surface {
  /** Fraction of vertical speed kept by a bounce. */
  restitution: number;
  /** Fraction of horizontal speed kept by a bounce. */
  grip: number;
}

const PITCH: Surface = { restitution: 0.55, grip: 0.88 };
const OUTFIELD: Surface = { restitution: 0.4, grip: 0.75 };
/** Slowdown of a ball rolling on grass, m/s². */
const ROLLING_DECEL = 1.4;

const surfaceAt = (x: number, z: number): Surface =>
  Math.abs(x) < 1.53 && z > -21 && z < 2.5 ? PITCH : OUTFIELD;

/** Does a ball centred here touch the batter's stumps? */
export function hitsStumps(x: number, y: number, z: number): boolean {
  return (
    Math.abs(z - STUMPS_Z) < 0.018 + BALL_RADIUS &&
    Math.abs(x) < STUMPS_HALF_WIDTH + BALL_RADIUS &&
    y < STUMPS_HEIGHT + BALL_RADIUS
  );
}

/** A flight sampled every STEP from `t0` (ms on the game clock). */
export class Trajectory {
  readonly t0: number;
  readonly count: number;
  /** Game-clock times (ms) at which the ball touched the ground. */
  readonly bounces: number[];
  /** True if the ball came to rest; false if the flight was cut short. */
  readonly stopped: boolean;
  readonly #p: Float32Array;
  readonly #v: Float32Array;

  constructor(t0: number, p: Float32Array, v: Float32Array, count: number, bounces: number[], stopped: boolean) {
    this.t0 = t0;
    this.#p = p;
    this.#v = v;
    this.count = count;
    this.bounces = bounces;
    this.stopped = stopped;
  }

  get tEnd(): number {
    return this.t0 + (this.count - 1) * STEP * 1000;
  }

  /** Position at game time t, interpolated; held at the ends outside the flight. */
  positionAt(t: number, out: Vec3 = [0, 0, 0]): Vec3 {
    return this.#sample(this.#p, t, out);
  }

  velocityAt(t: number, out: Vec3 = [0, 0, 0]): Vec3 {
    return this.#sample(this.#v, t, out);
  }

  /** Index of the first sample at or after game time t. */
  indexAt(t: number): number {
    return Math.min(this.count - 1, Math.max(0, Math.ceil((t - this.t0) / (STEP * 1000))));
  }

  timeAt(index: number): number {
    return this.t0 + index * STEP * 1000;
  }

  #sample(data: Float32Array, t: number, out: Vec3): Vec3 {
    const f = Math.min(Math.max((t - this.t0) / (STEP * 1000), 0), this.count - 1);
    const i = Math.min(Math.floor(f), this.count - 2);
    const k = Math.max(0, f - i);
    for (let axis = 0; axis < 3; axis++) {
      const a = data[i * 3 + axis];
      const b = data[Math.min(i + 1, this.count - 1) * 3 + axis];
      out[axis] = a + (b - a) * k;
    }
    return out;
  }
}

/**
 * Flies a ball from `start` at game time t0 until it stops, `until` says to
 * end, or `maxSeconds` pass.
 */
export function simulate(
  start: BallState,
  t0: number,
  maxSeconds: number,
  until?: (p: Vec3, v: Vec3) => boolean,
): Trajectory {
  const maxSteps = Math.ceil(maxSeconds / STEP) + 1;
  const ps = new Float32Array(maxSteps * 3);
  const vs = new Float32Array(maxSteps * 3);
  const p: Vec3 = [...start.p];
  const v: Vec3 = [...start.v];
  const bounces: number[] = [];
  let rolling = p[1] <= BALL_RADIUS && Math.abs(v[1]) < 0.6;
  let stopped = false;
  let count = 0;

  for (; count < maxSteps; ) {
    ps.set(p, count * 3);
    vs.set(v, count * 3);
    count++;
    if (until?.(p, v)) break;

    if (rolling) {
      const speed = Math.hypot(v[0], v[2]);
      if (speed < 0.3) {
        v[0] = v[1] = v[2] = 0;
        stopped = true;
        break;
      }
      const keep = Math.max(0, speed - ROLLING_DECEL * STEP) / speed;
      v[0] *= keep;
      v[2] *= keep;
      p[0] += v[0] * STEP;
      p[2] += v[2] * STEP;
      continue;
    }

    const speed = Math.hypot(v[0], v[1], v[2]);
    v[0] -= DRAG * speed * v[0] * STEP;
    v[1] -= (GRAVITY + DRAG * speed * v[1]) * STEP;
    v[2] -= DRAG * speed * v[2] * STEP;
    p[0] += v[0] * STEP;
    p[1] += v[1] * STEP;
    p[2] += v[2] * STEP;

    if (p[1] < BALL_RADIUS && v[1] < 0) {
      const surface = surfaceAt(p[0], p[2]);
      p[1] = BALL_RADIUS;
      v[1] = -v[1] * surface.restitution;
      v[0] *= surface.grip;
      v[2] *= surface.grip;
      bounces.push(t0 + count * STEP * 1000);
      if (v[1] < 0.6) {
        v[1] = 0;
        rolling = true;
      }
    }
  }
  return new Trajectory(t0, ps, vs, count, bounces, stopped);
}
