import AHRS from "ahrs";

import type { MotionSourceKind, Quat, Vec3 } from "../link/protocol";
import {
  DEG,
  angularVelocity,
  fromAxisAngle,
  fromDeviceOrientation,
  length,
  multiply,
  scale,
} from "../shared/quat";
import { SensorSignCheck } from "./sign-check";

export interface MotionReading {
  /** performance.now() when read, ms. */
  t: number;
  /** Phone axes → earth frame (z up). */
  q: Quat;
  /** Angular velocity in phone axes, rad/s. */
  w: Vec3;
}

export interface MotionSource {
  readonly kind: MotionSourceKind;
  start(onReading: (reading: MotionReading) => void): void;
  stop(): void;
  /** One line for the on-screen debug readout. */
  describe(): string;
}

/** devicemotion's readings in the spec's phone axes: accel in m/s², gyro in rad/s. */
function readDeviceMotion(event: DeviceMotionEvent): { accel: Vec3; gyro: Vec3 } | undefined {
  const a = event.accelerationIncludingGravity;
  const r = event.rotationRate;
  if (a?.x == null || a.y == null || a.z == null) return undefined;
  if (r?.alpha == null || r.beta == null || r.gamma == null) return undefined;
  // rotationRate is in deg/s, and names its axes alpha = z, beta = x, gamma = y.
  return { accel: [a.x, a.y, a.z], gyro: [r.beta * DEG, r.gamma * DEG, r.alpha * DEG] };
}

/** ahrs exports `init` at runtime but leaves it out of its type declarations. */
type Madgwick = AHRS & {
  init(ax: number, ay: number, az: number, mx: number, my: number, mz: number): void;
};

/**
 * Our own sensor fusion: gyroscope + accelerometer through a Madgwick filter.
 * The fallback for browsers that report motion but not orientation. It only
 * sees the ~60 samples a second the browser hands over, so fast swings leave
 * a few degrees of error each, and heading error never gets corrected.
 */
export class FusedMotionSource implements MotionSource {
  readonly kind = "fused";
  readonly signs = new SensorSignCheck();
  #filter: Madgwick | undefined;
  #lastT: number | undefined;
  #onReading: ((reading: MotionReading) => void) | undefined;
  #orientationTimer: number | undefined;

  #handleOrientation = (event: DeviceOrientationEvent) => {
    if (event.beta == null || event.gamma == null) return;
    clearTimeout(this.#orientationTimer);
    this.signs.orientation(event.beta, event.gamma);
  };

  #handleMotion = (event: DeviceMotionEvent) => {
    const raw = readDeviceMotion(event);
    if (!raw) return;
    const t = performance.now();
    // A sign that turned out wrong has already pulled the filter off course.
    if (this.signs.motion(t, raw.accel, raw.gyro)) this.#filter = undefined;

    const accel = scale(raw.accel, this.signs.accelSign / 9.81); // in g
    const gyro = scale(raw.gyro, this.signs.gyroSign);
    const dt = this.#lastT === undefined ? 1 / 60 : Math.min(Math.max((t - this.#lastT) / 1000, 0.004), 0.1);
    this.#lastT = t;

    if (!this.#filter) {
      this.#filter = new AHRS({ sampleInterval: 1000 / 60, algorithm: "Madgwick", beta: 0.2 }) as Madgwick;
      // Start from the tilt gravity gives us; heading is arbitrary (calibration fixes it).
      this.#filter.init(accel[0], accel[1], accel[2], 1, 0, 0);
    }
    // While the phone turns, the accelerometer also feels the turn (0.1 g is
    // enough to tilt the estimate by several degrees, without changing the
    // reading's size much), so feed it zeros, which the filter skips, and
    // trust the gyro alone. Tilt gets corrected in the calm between balls.
    const trustAccel = Math.abs(length(accel) - 1) < 0.1 && length(gyro) < 1;
    const [ax, ay, az] = trustAccel ? accel : [0, 0, 0];
    this.#filter.update(gyro[0], gyro[1], gyro[2], ax, ay, az, undefined, undefined, undefined, dt);

    const { w, x, y, z } = this.#filter.getQuaternion();
    this.#onReading?.({ t, q: [w, x, y, z], w: gyro });
  };

  start(onReading: (reading: MotionReading) => void): void {
    this.#onReading = onReading;
    this.#orientationTimer = window.setTimeout(() => (this.signs.noOrientation = true), 1500);
    addEventListener("deviceorientation", this.#handleOrientation);
    addEventListener("devicemotion", this.#handleMotion);
  }

  stop(): void {
    clearTimeout(this.#orientationTimer);
    removeEventListener("deviceorientation", this.#handleOrientation);
    removeEventListener("devicemotion", this.#handleMotion);
    this.#onReading = undefined;
    this.#filter = undefined;
    this.#lastT = undefined;
  }

  describe(): string {
    return this.signs.describe();
  }
}

/**
 * The phone's own orientation (CoreMotion on iOS, Android's rotation vector),
 * which fuses the raw sensors hundreds of times a second with per-device
 * calibration: more accurate than anything we can do with what reaches
 * JavaScript. Its Euler angles are recombined into one rotation, which is
 * exact, so the angles' gimbal lock near upright never shows.
 */
export class BrowserOrientationSource implements MotionSource {
  readonly kind = "browser";
  #gyro: Vec3 = [0, 0, 0];
  #onReading: ((reading: MotionReading) => void) | undefined;

  #handleMotion = (event: DeviceMotionEvent) => {
    // Only its magnitude is used (swing speed), so sign conventions don't matter.
    const raw = readDeviceMotion(event);
    if (raw) this.#gyro = raw.gyro;
  };

  #handleOrientation = (event: DeviceOrientationEvent) => {
    if (event.beta == null || event.gamma == null) return;
    const q = fromDeviceOrientation(event.alpha ?? 0, event.beta, event.gamma);
    this.#onReading?.({ t: performance.now(), q, w: this.#gyro });
  };

  start(onReading: (reading: MotionReading) => void): void {
    this.#onReading = onReading;
    addEventListener("devicemotion", this.#handleMotion);
    addEventListener("deviceorientation", this.#handleOrientation);
  }

  stop(): void {
    removeEventListener("devicemotion", this.#handleMotion);
    removeEventListener("deviceorientation", this.#handleOrientation);
    this.#onReading = undefined;
  }

  describe(): string {
    return "phone's own orientation";
  }
}

const smoothstep = (x: number) => {
  const c = Math.min(Math.max(x, 0), 1);
  return c * c * (3 - 2 * c);
};

/** Bat angle (radians, about the phone's x axis) at `s` seconds into a scripted swing. */
function scriptedSwingAngle(s: number): number | undefined {
  const backlift = 100 * DEG;
  const followThrough = -110 * DEG;
  if (s < 0.35) return backlift * smoothstep(s / 0.35);
  if (s < 0.5) return backlift;
  if (s < 0.75) return backlift + (followThrough - backlift) * smoothstep((s - 0.5) / 0.25);
  if (s < 1.35) return followThrough * (1 - smoothstep((s - 0.75) / 0.6));
  return undefined;
}

/**
 * A pretend phone for desktops without motion sensors: drag to tilt and turn
 * it, or play a scripted drive. Lets the whole pipeline be tested without a phone.
 */
export class SimulatedMotionSource implements MotionSource {
  readonly kind = "simulator";
  #yaw = 0;
  #tilt = 0;
  #swingStart: number | undefined;
  #previous: { t: number; q: Quat } | undefined;
  #timer: number | undefined;
  #dragFrom: { x: number; y: number } | undefined;

  constructor(pad: HTMLElement) {
    pad.addEventListener("pointerdown", (event) => {
      pad.setPointerCapture(event.pointerId);
      this.#dragFrom = { x: event.clientX, y: event.clientY };
    });
    pad.addEventListener("pointermove", (event) => {
      if (!this.#dragFrom) return;
      this.#yaw -= (event.clientX - this.#dragFrom.x) * 0.01;
      this.#tilt += (event.clientY - this.#dragFrom.y) * 0.01;
      this.#dragFrom = { x: event.clientX, y: event.clientY };
    });
    const endDrag = () => (this.#dragFrom = undefined);
    pad.addEventListener("pointerup", endDrag);
    pad.addEventListener("pointercancel", endDrag);
  }

  swing(): void {
    this.#swingStart = performance.now();
  }

  start(onReading: (reading: MotionReading) => void): void {
    this.#timer = window.setInterval(() => {
      const t = performance.now();
      let swingAngle = 0;
      if (this.#swingStart !== undefined) {
        const angle = scriptedSwingAngle((t - this.#swingStart) / 1000);
        if (angle === undefined) this.#swingStart = undefined;
        else swingAngle = angle;
      }
      // Turned by yaw about earth-up, stood upright (top edge up), then tilted
      // about its own x axis by the drag and the swing.
      const q = multiply(
        multiply(fromAxisAngle([0, 0, 1], this.#yaw), fromAxisAngle([1, 0, 0], 90 * DEG)),
        fromAxisAngle([1, 0, 0], this.#tilt + swingAngle),
      );
      const w = this.#previous
        ? angularVelocity(this.#previous.q, q, (t - this.#previous.t) / 1000)
        : ([0, 0, 0] as Vec3);
      this.#previous = { t, q };
      onReading({ t, q, w });
    }, 1000 / 60);
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#previous = undefined;
  }

  describe(): string {
    return `simulator · yaw ${Math.round(this.#yaw / DEG)}° · tilt ${Math.round(this.#tilt / DEG)}°`;
  }
}
