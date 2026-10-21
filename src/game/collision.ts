import * as THREE from "three";

import { BLADE } from "./bat";
import type { BatRig } from "./bat";
import type { TimingHits } from "./difficulty";
import type { BallState, Trajectory, Vec3 } from "./physics";

const DEG = Math.PI / 180;
const SWEET_SPOT_POINT = new THREE.Vector3(0, BLADE.toe + BLADE.sweetSpot, 0);

/** Small enough that neither a quick ball nor a whipped bat skips through the other. */
const SUBSTEP_MS = 0.5;
const BALL_MASS = 0.156;
/** The bat as the ball feels it, held loosely in the hands: less than its 1.2 kg. */
const BAT_MASS = 0.8;
const SWEET_SPOT = BLADE.sweetSpot;

export interface Contact {
  /** Game time of the hit, ms. */
  t: number;
  ball: THREE.Vector3;
  ballVelocity: THREE.Vector3;
  /** Unit normal of the bat surface that was hit, pointing at the ball. */
  normal: THREE.Vector3;
  /** Velocity of the bat at the point that was hit. */
  batVelocity: THREE.Vector3;
  /** Off an edge rather than the face (or the back). */
  edge: boolean;
  /** How far up the blade from the toe, metres. */
  fromToe: number;
}

const rotation = new THREE.Quaternion();
const inverse = new THREE.Quaternion();
const grip = new THREE.Vector3();
const local = new THREE.Vector3();
const ball: Vec3 = [0, 0, 0];
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/** World velocity of a point fixed on the bat (bat axes, from the hands) at game time t. */
export function pointVelocity(rig: BatRig, point: THREE.Vector3, t: number): THREE.Vector3 {
  const at = (time: number) => {
    const r = new THREE.Quaternion();
    if (!rig.rotationAt(time, r)) return undefined;
    return point.clone().applyQuaternion(r).add(rig.gripFor(r, new THREE.Vector3()));
  };
  let t0 = t - 2;
  let t1 = t + 2;
  let p0 = at(t0);
  let p1 = at(t1);
  if (!p1) [t1, p1] = [t, at(t)];
  if (!p0) [t0, p0] = [t, at(t)];
  if (!p0 || !p1 || t1 <= t0) return new THREE.Vector3();
  return p1.sub(p0).divideScalar((t1 - t0) / 1000);
}

/** How the contact check forgives: a bigger ball, and a bat that's a little late. */
export interface Forgiveness {
  /** The ball's radius for bat collisions; a real one is 36 mm. */
  radius: number;
  /**
   * A bat this many ms late still meets the ball where it was. Early swings
   * need no help: the bat sweeps forward through the ball's path anyway.
   */
  lateMs: number;
}

/**
 * The first moment in (from, to] (game ms) when the blade touches the ball
 * while closing on it.
 */
export function findContact(
  rig: BatRig,
  flight: Trajectory,
  from: number,
  to: number,
  forgiveness: Forgiveness,
): Contact | undefined {
  const start = Math.max(from, flight.t0);
  const end = Math.min(to, flight.tEnd);
  if (end <= start) return undefined;
  const steps = Math.ceil((end - start) / SUBSTEP_MS);

  for (let i = 1; i <= steps; i++) {
    const t = start + ((end - start) * i) / steps;
    if (!rig.rotationAt(t, rotation)) continue;
    rig.gripFor(rotation, grip);
    for (let late = 0; late <= forgiveness.lateMs; late += 2.5) {
      const contact = touch(rig, flight, t, t - late, forgiveness.radius);
      if (contact) return contact;
    }
  }
  return undefined;
}

/** Does the bat as it is at time t (rotation and grip already set) touch the ball as it was at `ballTime`? */
function touch(rig: BatRig, flight: Trajectory, t: number, ballTime: number, radius: number): Contact | undefined {
  if (ballTime < flight.t0) return undefined;
  flight.positionAt(ballTime, ball);
  local.set(ball[0] - grip.x, ball[1] - grip.y, ball[2] - grip.z);
  // The blade reaches at most ~0.75 m from the hands.
  if (local.lengthSq() > 1) return undefined;
  local.applyQuaternion(inverse.copy(rotation).invert());

  const cx = clamp(local.x, -BLADE.halfWidth, BLADE.halfWidth);
  const cy = clamp(local.y, BLADE.toe, BLADE.top);
  const cz = clamp(local.z, -BLADE.halfThickness, BLADE.halfThickness);
  if (Math.hypot(local.x - cx, local.y - cy, local.z - cz) > radius) return undefined;

  // Face (or back) unless the ball is beyond the side of the blade; then the
  // normal swings round towards the side, and the ball flies off at an angle.
  const edge = Math.abs(local.x) > BLADE.halfWidth;
  const normal = edge
    ? new THREE.Vector3(local.x - cx, 0, local.z - cz)
    : new THREE.Vector3(0, 0, Math.sign(local.z) || 1);
  if (local.y < BLADE.toe) normal.y = local.y - BLADE.toe;
  if (normal.lengthSq() < 1e-9) normal.set(0, 0, 1);
  normal.normalize().applyQuaternion(rotation);

  const batVelocity = pointVelocity(rig, new THREE.Vector3(cx, cy, cz), t);
  const ballVelocity = new THREE.Vector3(...flight.velocityAt(ballTime));
  // Already separating (say, the bat chasing a ball it can't catch): not a hit.
  if (ballVelocity.clone().sub(batVelocity).dot(normal) >= 0) return undefined;

  return {
    t,
    ball: new THREE.Vector3(...ball),
    ballVelocity,
    normal,
    batVelocity,
    edge,
    fromToe: cy - BLADE.toe,
  };
}

/**
 * Is the bat at game time t swinging to hit, rather than lifting back? The
 * sweet spot must be moving at least `minSpeed` m/s, and not backwards:
 * `minLead` is the least cosine allowed between its motion and the face's
 * direction (1 = straight at the bowler face-first, −1 = the backlift).
 */
export function isHittingMotion(rig: BatRig, t: number, minSpeed = 1.5, minLead = -0.2): boolean {
  const rotation = new THREE.Quaternion();
  if (!rig.rotationAt(t, rotation)) return false;
  const velocity = pointVelocity(rig, SWEET_SPOT_POINT, t);
  const speed = velocity.length();
  if (speed < minSpeed) return false;
  const face = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
  return velocity.dot(face) / speed >= minLead;
}

/**
 * A hit judged by timing rather than the bat's exact path. `timingMs` is how
 * far the swing's fastest moment was from the ball reaching the bat (negative
 * = early). Swing speed gives power; early lofts it and pulls it to leg, late
 * keeps it down and steers it to the off side; the bat face adds the rest.
 */
export function timedShot(
  timing: TimingHits,
  timingMs: number,
  spinDeg: number,
  batRotation: THREE.Quaternion,
  from: Vec3,
  random: () => number = Math.random,
): BallState {
  const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
  const strength = clamp((spinDeg - timing.minSpinDeg) / Math.max(1100 - timing.minSpinDeg, 1), 0, 1);
  const window = timingMs < 0 ? timing.earlyMs : timing.lateMs;
  const quality = 1 - Math.min(Math.abs(timingMs) / window, 1);
  const speed = (timing.minSpeed + (timing.maxSpeed - timing.minSpeed) * Math.sqrt(strength)) * (0.8 + 0.2 * quality);

  const elevation = (timing.loftDeg + clamp(-timingMs / 70, -1, 1.6) * 16 + (random() - 0.5) * 6) * DEG;
  const face = new THREE.Vector3(0, 0, 1).applyQuaternion(batRotation);
  // 0° is straight back past the bowler, positive towards the off side.
  const faceAngle = Math.hypot(face.x, face.z) > 0.2 ? Math.atan2(face.x, -face.z) / DEG : 0;
  const angle = clamp(clamp(faceAngle, -90, 90) * 0.6 + (timingMs / 60) * 28 + (random() - 0.5) * 12, -80, 80) * DEG;

  const flat = speed * Math.cos(elevation);
  return {
    p: [from[0], Math.max(from[1], 0.25), from[2]],
    v: [flat * Math.sin(angle), speed * Math.sin(elevation), -flat * Math.cos(angle)],
  };
}

/** More speed (×power) and a higher launch (+loftDeg) for a ball leaving the bat. */
export function boost(state: BallState, power: number, loftDeg: number): BallState {
  const [vx, vy, vz] = state.v;
  const flat = Math.hypot(vx, vz);
  const speed = Math.hypot(vx, vy, vz) * power;
  const elevation = Math.min(Math.atan2(vy, flat) + loftDeg * DEG, 60 * DEG);
  const k = flat > 1e-6 ? (speed * Math.cos(elevation)) / flat : 0;
  return { p: state.p, v: [vx * k, speed * Math.sin(elevation), vz * k] };
}

/**
 * The ball's state just after a hit: an impulse along the normal, with
 * bounciness falling off away from the sweet spot, and the bat's recoil.
 */
export function rebound(contact: Contact): BallState {
  const restitution = 0.5 - 0.22 * Math.min(1, Math.abs(contact.fromToe - SWEET_SPOT) / 0.3);
  const impulse = ((1 + restitution) * BAT_MASS) / (BAT_MASS + BALL_MASS);
  const relative = contact.ballVelocity.clone().sub(contact.batVelocity);
  const along = relative.dot(contact.normal);
  const across = relative.clone().addScaledVector(contact.normal, -along);
  const v = contact.ballVelocity
    .clone()
    .addScaledVector(contact.normal, -impulse * along)
    // A little grip on the face takes some of the sideways speed off.
    .addScaledVector(across, -0.15);
  const p = contact.ball.clone().addScaledVector(contact.normal, 0.005);
  return { p: [p.x, p.y, p.z], v: [v.x, v.y, v.z] };
}
