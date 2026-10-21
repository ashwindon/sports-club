// Just enough vector and quaternion maths for the phone page, which should
// not have to download three.js to send its orientation.
import type { Quat, Vec3 } from "../link/protocol";

export const DEG = Math.PI / 180;

export function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

export function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function multiply(a: Quat, b: Quat): Quat {
  const [aw, ax, ay, az] = a;
  const [bw, bx, by, bz] = b;
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

export function conjugate([w, x, y, z]: Quat): Quat {
  return [w, -x, -y, -z];
}

export function fromAxisAngle(axis: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [Math.cos(angle / 2), axis[0] * s, axis[1] * s, axis[2] * s];
}

/**
 * deviceorientation's angles (degrees, intrinsic Z-X'-Y'') as a rotation from
 * phone axes into the earth frame (z up), the same convention ahrs uses.
 */
export function fromDeviceOrientation(
  alpha: number,
  beta: number,
  gamma: number,
): Quat {
  return multiply(
    multiply(
      fromAxisAngle([0, 0, 1], alpha * DEG),
      fromAxisAngle([1, 0, 0], beta * DEG),
    ),
    fromAxisAngle([0, 1, 0], gamma * DEG),
  );
}

/** "Up" in phone axes, from deviceorientation's beta and gamma (degrees). */
export function upFromDeviceOrientation(beta: number, gamma: number): Vec3 {
  const b = beta * DEG;
  const g = gamma * DEG;
  return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];
}

/** Angular velocity in body axes that turns `from` into `to` over `dt` seconds. */
export function angularVelocity(from: Quat, to: Quat, dt: number): Vec3 {
  let delta = multiply(conjugate(from), to);
  if (delta[0] < 0) delta = [-delta[0], -delta[1], -delta[2], -delta[3]];
  const sinHalf = Math.hypot(delta[1], delta[2], delta[3]);
  if (sinHalf < 1e-9 || dt <= 0) return [0, 0, 0];
  const angle = 2 * Math.atan2(sinHalf, delta[0]);
  const k = angle / sinHalf / dt;
  return [delta[1] * k, delta[2] * k, delta[3] * k];
}
