import type { Vec3 } from "../link/protocol";
import { cross, dot, length, scale, upFromDeviceOrientation } from "../shared/quat";

const GRAVITY = 9.81;
/** Agreeing still samples needed before trusting the accelerometer's sign. */
const ACCEL_VOTES = 15;
/** Accumulated agreement (rad²/s) needed before trusting the gyroscope's sign. */
const GYRO_EVIDENCE = 0.5;

/**
 * Browsers don't agree on which way motion sensor axes point: iOS Safari has
 * reported gravity with the opposite sign to Android and the spec. Rather than
 * guess from the user agent, this checks each sensor against something that
 * must hold, and flips the ones that disagree.
 *
 * - Accelerometer: held still, it measures "up". deviceorientation's beta and
 *   gamma say independently where up is, in the phone's own axes.
 * - Gyroscope: a fixed direction seen from a turning phone turns the other
 *   way, so the change in "up" must match −ω × up.
 */
export class SensorSignCheck {
  accelSign: 1 | -1 = 1;
  gyroSign: 1 | -1 = 1;
  accelChecked = false;
  gyroChecked = false;
  /** Set when no deviceorientation event arrives, so the accelerometer can't be checked. */
  noOrientation = false;

  #up: Vec3 | undefined;
  #accelVotes = 0;
  #gyroEvidence = 0;
  #prevUp: Vec3 | undefined;
  #prevT = 0;

  orientation(beta: number, gamma: number): void {
    this.#up = upFromDeviceOrientation(beta, gamma);
  }

  /**
   * Feed one raw sample (accel in m/s², gyro in rad/s, t in ms). Returns true
   * when this sample flipped a sign, so filters built on the old one should restart.
   */
  motion(t: number, accel: Vec3, gyro: Vec3): boolean {
    const g = length(accel) / GRAVITY;
    let flipped = false;

    if (!this.accelChecked && this.#up && Math.abs(g - 1) < 0.1 && length(gyro) < 0.3) {
      this.#accelVotes += Math.sign(dot(accel, this.#up));
      if (Math.abs(this.#accelVotes) >= ACCEL_VOTES) {
        this.accelChecked = true;
        this.accelSign = this.#accelVotes > 0 ? 1 : -1;
        flipped = this.accelSign === -1;
      }
    }

    if (!this.gyroChecked && (this.accelChecked || this.noOrientation)) {
      const up = scale(accel, this.accelSign / length(accel));
      const dt = (t - this.#prevT) / 1000;
      if (this.#prevUp && Math.abs(g - 1) < 0.15 && dt > 0 && dt < 0.1) {
        const upRate = scale(
          [up[0] - this.#prevUp[0], up[1] - this.#prevUp[1], up[2] - this.#prevUp[2]],
          1 / dt,
        );
        this.#gyroEvidence += dot(upRate, scale(cross(gyro, up), -1)) * dt;
        if (Math.abs(this.#gyroEvidence) >= GYRO_EVIDENCE) {
          this.gyroChecked = true;
          this.gyroSign = this.#gyroEvidence > 0 ? 1 : -1;
          flipped ||= this.gyroSign === -1;
        }
      }
      this.#prevUp = up;
      this.#prevT = t;
    }

    return flipped;
  }

  describe(): string {
    const show = (sign: number, checked: boolean) =>
      `${sign > 0 ? "+" : "−"}${checked ? " ✓" : " (checking…)"}`;
    const accel = this.noOrientation && !this.accelChecked
      ? `${this.accelSign > 0 ? "+" : "−"} (can't check)`
      : show(this.accelSign, this.accelChecked);
    return `accel ${accel} · gyro ${show(this.gyroSign, this.gyroChecked)}`;
  }
}
