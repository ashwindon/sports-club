import * as THREE from "three";

import type { Quat } from "../link/protocol";
import { gripTexture } from "./textures";

const UP = new THREE.Vector3(0, 1, 0);
/** ahrs's earth frame has z up; ours has y up. */
const EARTH_TO_WORLD = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
/** Bat at address: upright, face towards the bowler (−z). Phone axes are bat axes. */
const STANCE = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
const STANCE_INVERSE = STANCE.clone().invert();

// Arm model: the phone only knows its orientation, so the hands' position is
// inferred. They hang from the shoulders and swing partway round with the bat.
const SHOULDERS = new THREE.Vector3(0.3, 1.42, 0.1);
export const GRIP_AT_STANCE = new THREE.Vector3(0.35, 0.86, -0.18);
const ARM_FOLLOW = 0.6;

const HANDLE_TOP = 0.13;
const BLADE_TOP = -0.15;
const TOE = -0.71;
const TRAIL_SECONDS = 0.5;
const TRAIL_POINTS = 64;
/** How far back bat poses are kept, so late-arriving checks can look them up. */
const HISTORY_MS = 1500;

/** The blade as a box in bat axes, for collision. The face is the +z side. */
export const BLADE = {
  halfWidth: 0.054,
  halfThickness: 0.018,
  top: BLADE_TOP,
  toe: TOE,
  /** Where it hits hardest, measured up the blade from the toe. */
  sweetSpot: 0.18,
} as const;

/** The blade's outline: rounded toe, sloping shoulders up to the handle. */
function bladeShape(): THREE.Shape {
  const w = BLADE.halfWidth;
  const r = 0.025;
  const shape = new THREE.Shape();
  shape.moveTo(-w, BLADE_TOP - 0.035);
  shape.lineTo(-w, TOE + r);
  shape.quadraticCurveTo(-w, TOE, -w + r, TOE);
  shape.lineTo(w - r, TOE);
  shape.quadraticCurveTo(w, TOE, w, TOE + r);
  shape.lineTo(w, BLADE_TOP - 0.035);
  shape.quadraticCurveTo(w, BLADE_TOP, 0.02, BLADE_TOP + 0.01);
  shape.lineTo(-0.02, BLADE_TOP + 0.01);
  shape.quadraticCurveTo(-w, BLADE_TOP, -w, BLADE_TOP - 0.035);
  return shape;
}

/** Bat built in phone axes: +y towards the handle, +z out of the face. Origin at the hands. */
function buildBat(): THREE.Group {
  const bat = new THREE.Group();
  const face = new THREE.MeshStandardMaterial({ color: 0xf0d9a8, roughness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0xd9b47a, roughness: 0.55 });
  const spine = new THREE.MeshStandardMaterial({ color: 0xc89f63, roughness: 0.6 });
  const grip = new THREE.MeshStandardMaterial({ map: gripTexture(), roughness: 0.85 });
  const add = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    bat.add(mesh);
  };

  // Extruded and bevelled, then centred so the faces sit at ±halfThickness.
  const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape(), {
    depth: 0.022,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.005,
    bevelSegments: 3,
    curveSegments: 10,
  });
  bladeGeometry.translate(0, 0, -0.011);
  add(new THREE.Mesh(bladeGeometry, [face, wood]));

  // The raised spine down the back.
  const ridge = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), spine);
  ridge.scale.set(0.03, 0.25, 0.022);
  ridge.position.set(0, TOE + 0.27, -0.016);
  add(ridge);

  const handleLength = HANDLE_TOP - BLADE_TOP;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.016, handleLength, 16), grip);
  handle.position.y = BLADE_TOP + handleLength / 2;
  add(handle);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), grip);
  knob.position.y = HANDLE_TOP;
  add(knob);
  return bat;
}

export class BatRig {
  readonly bat = buildBat();
  readonly group = new THREE.Group();
  /** Bat toe in world space, as of the last update. */
  readonly toe = new THREE.Vector3();
  /** Where the batter's top and bottom hands hold the handle, world space. */
  readonly topHand = new THREE.Vector3();
  readonly bottomHand = new THREE.Vector3();
  calibrated = false;
  /**
   * How far the batter has moved from the stance: sideways (x) into line, and
   * up or down (y) to meet the ball's height. The phone can't measure
   * footwork, so the game does it for each delivery.
   */
  readonly step = new THREE.Vector3();

  #heading = new THREE.Quaternion();
  #phone = new THREE.Quaternion();
  #batRotation = new THREE.Quaternion();
  /** Recent bat rotations by game time (ms), oldest first. */
  #history: { t: number; rotation: THREE.Quaternion }[] = [];
  #arm: THREE.Line;
  #trail: THREE.Line;
  #trailDots: THREE.Points;
  #trailSamples: { t: number; p: THREE.Vector3 }[] = [];
  #previousToe: { t: number; p: THREE.Vector3 } | undefined;

  constructor() {
    this.#arm = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([SHOULDERS, GRIP_AT_STANCE]),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
    );
    const trailGeometry = new THREE.BufferGeometry();
    trailGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3));
    trailGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3));
    trailGeometry.setDrawRange(0, 0);
    this.#trail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({ vertexColors: true }));
    // One dot per sample, so the gaps between 60 Hz readings are visible mid-swing.
    this.#trailDots = new THREE.Points(trailGeometry, new THREE.PointsMaterial({ vertexColors: true, size: 0.03 }));
    this.#trail.frustumCulled = this.#trailDots.frustumCulled = false;
    this.group.add(this.bat, this.#arm, this.#trail, this.#trailDots);
    this.debug = false;
    this.#placeBat(STANCE);
  }

  /** Shows the arm model's line and the toe's trail (one dot per reading), for tuning. */
  set debug(on: boolean) {
    this.#arm.visible = this.#trail.visible = this.#trailDots.visible = on;
  }

  get debug(): boolean {
    return this.#arm.visible;
  }

  /**
   * Treat the phone's current pose as the stance: turn the world about "up"
   * until the phone's screen (the bat's face) points at the bowler. Tilt is
   * left alone, since gravity already measures it correctly.
   */
  calibrate(phone: Quat): void {
    const q = this.#toWorld(phone, new THREE.Quaternion());
    const face = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    let heading: number;
    if (Math.hypot(face.x, face.z) > 0.3) {
      heading = Math.PI - Math.atan2(face.x, face.z);
    } else {
      // Phone held flat: line up its side edge instead.
      const side = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      heading = -Math.PI / 2 - Math.atan2(side.x, side.z);
    }
    this.#heading.setFromAxisAngle(UP, heading);
    this.calibrated = true;
  }

  /** Moves the bat to a phone reading taken at game time t (ms); returns the toe's speed in m/s. */
  update(phone: Quat, t: number): number {
    if (!this.calibrated) this.calibrate(phone);
    this.#batRotation.copy(this.#heading).multiply(this.#toWorld(phone, this.#phone));
    this.#history.push({ t, rotation: this.#batRotation.clone() });
    while (this.#history.length > 2 && t - this.#history[0].t > HISTORY_MS) this.#history.shift();
    this.#placeBat(this.#batRotation);

    const toe = this.toe.clone();
    let speed = 0;
    if (this.#previousToe && t > this.#previousToe.t) {
      speed = toe.distanceTo(this.#previousToe.p) / ((t - this.#previousToe.t) / 1000);
    }
    this.#previousToe = { t, p: toe };
    this.#pushTrail(t, toe);
    return speed;
  }

  /** Game time (ms) of the newest bat reading, or -Infinity before the first. */
  get latestTime(): number {
    return this.#history.at(-1)?.t ?? -Infinity;
  }

  /**
   * The bat's rotation at game time t, interpolated between the readings
   * either side. False when t is outside the readings kept.
   */
  rotationAt(t: number, out: THREE.Quaternion): boolean {
    const history = this.#history;
    if (history.length === 0 || t < history[0].t || t > history[history.length - 1].t) return false;
    let i = history.length - 1;
    while (i > 0 && history[i - 1].t > t) i--;
    const after = history[i];
    const before = history[Math.max(0, i - 1)];
    const span = after.t - before.t;
    out.copy(before.rotation).slerp(after.rotation, span > 0 ? (t - before.t) / span : 1);
    return true;
  }

  /** Where the hands are for a given bat rotation: the arm model, plus the batter's footwork. */
  gripFor(rotation: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 {
    const fromStance = rotation.clone().multiply(STANCE_INVERSE);
    const armSwing = new THREE.Quaternion().slerp(fromStance, ARM_FOLLOW);
    return out.copy(GRIP_AT_STANCE).sub(SHOULDERS).applyQuaternion(armSwing).add(SHOULDERS).add(this.step);
  }

  /** Redraws the latest reading, e.g. after `step` changed. */
  refresh(): void {
    this.#placeBat(this.#history.at(-1)?.rotation ?? STANCE);
  }

  #toWorld(phone: Quat, out: THREE.Quaternion): THREE.Quaternion {
    const [w, x, y, z] = phone;
    return out.set(x, y, z, w).premultiply(EARTH_TO_WORLD);
  }

  #placeBat(rotation: THREE.Quaternion): void {
    const grip = this.gripFor(rotation, this.bat.position);
    this.bat.quaternion.copy(rotation);
    this.toe.set(0, TOE, 0).applyQuaternion(rotation).add(grip);
    this.topHand.set(0, 0.05, 0).applyQuaternion(rotation).add(grip);
    this.bottomHand.set(0, -0.075, 0).applyQuaternion(rotation).add(grip);
    const shoulders = SHOULDERS.clone().add(this.step);
    (this.#arm.geometry as THREE.BufferGeometry).setFromPoints([shoulders, grip]);
  }

  #pushTrail(t: number, p: THREE.Vector3): void {
    this.#trailSamples.push({ t, p });
    while (
      this.#trailSamples.length > TRAIL_POINTS ||
      (this.#trailSamples.length > 0 && t - this.#trailSamples[0].t > TRAIL_SECONDS * 1000)
    ) {
      this.#trailSamples.shift();
    }
    const geometry = this.#trail.geometry;
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colors = geometry.getAttribute("color") as THREE.BufferAttribute;
    this.#trailSamples.forEach((sample, i) => {
      const fade = (i + 1) / this.#trailSamples.length;
      positions.setXYZ(i, sample.p.x, sample.p.y, sample.p.z);
      colors.setXYZ(i, 1, 0.55 + 0.45 * fade, 0.2 * fade);
    });
    positions.needsUpdate = colors.needsUpdate = true;
    geometry.setDrawRange(0, this.#trailSamples.length);
  }
}
