// Players built from simple shapes and posed by naming where the pelvis,
// chest, head, hands and feet go: elbows and knees are solved with two-bone
// IK, and limbs are drawn between the joints. Animations then only have to
// move a handful of points.
import * as THREE from "three";

const UP = new THREE.Vector3(0, 1, 0);
const UPPER_ARM = 0.31;
const FOREARM = 0.3;
const THIGH = 0.46;
const SHIN = 0.46;

export interface Kit {
  shirt: number;
  trousers: number;
  skin: number;
  shoes?: number;
  /** A cap in this colour. */
  cap?: number;
  /** A helmet in this colour (instead of a cap). */
  helmet?: number;
  /** Batting pads over the shins. */
  pads?: boolean;
  /** Gloves in this colour. */
  gloves?: number;
}

/** Where the body's key points are, in world space. */
export interface Pose {
  pelvis: THREE.Vector3;
  chest: THREE.Vector3;
  head: THREE.Vector3;
  /** Horizontal direction the body faces. */
  facing: THREE.Vector3;
  /** Where the head looks, if not along `facing`. */
  look?: THREE.Vector3;
  handL: THREE.Vector3;
  handR: THREE.Vector3;
  footL: THREE.Vector3;
  footR: THREE.Vector3;
}

export function newPose(): Pose {
  const v = () => new THREE.Vector3();
  return { pelvis: v(), chest: v(), head: v(), facing: new THREE.Vector3(0, 0, -1), handL: v(), handR: v(), footL: v(), footR: v() };
}

/** Puts the middle joint of a two-bone limb (elbow, knee) so both bones keep their length, bending towards `pole`. */
function solveJoint(root: THREE.Vector3, end: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const toEnd = end.clone().sub(root);
  const distance = Math.min(Math.max(toEnd.length(), Math.abs(a - b) + 1e-3), a + b - 1e-3);
  const dir = toEnd.normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(a * a - along * along, 0));
  const bend = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (bend.lengthSq() < 1e-8) bend.set(dir.y, -dir.x, 0);
  bend.normalize();
  return out.copy(root).addScaledVector(dir, along).addScaledVector(bend, height);
}

/** A cylinder drawn between two points; geometry is 1 m tall so it can be scaled to fit. */
class Limb {
  readonly mesh: THREE.Mesh;
  constructor(radius: number, material: THREE.Material) {
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.9, 1, 12), material);
    this.mesh.castShadow = true;
  }
  place(a: THREE.Vector3, b: THREE.Vector3): void {
    const along = b.clone().sub(a);
    const length = along.length();
    this.mesh.position.copy(a).add(b).multiplyScalar(0.5);
    if (length > 1e-6) this.mesh.quaternion.setFromUnitVectors(UP, along.divideScalar(length));
    this.mesh.scale.set(1, Math.max(length, 1e-3), 1);
  }
}

function ball(radius: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 14, 10), material);
  mesh.castShadow = true;
  return mesh;
}

const material = (color: number, roughness = 0.75) => new THREE.MeshStandardMaterial({ color, roughness });

export class Puppet {
  readonly group = new THREE.Group();
  readonly pose = newPose();

  readonly #torso: THREE.Mesh;
  readonly #hips: THREE.Mesh;
  readonly #headGroup = new THREE.Group();
  readonly #neck: Limb;
  readonly #upperArms: [Limb, Limb];
  readonly #forearms: [Limb, Limb];
  readonly #thighs: [Limb, Limb];
  readonly #shins: [Limb, Limb];
  readonly #shoulders: [THREE.Mesh, THREE.Mesh];
  readonly #elbows: [THREE.Mesh, THREE.Mesh];
  readonly #knees: [THREE.Mesh, THREE.Mesh];
  readonly #hands: [THREE.Mesh, THREE.Mesh];
  readonly #feet: [THREE.Mesh, THREE.Mesh];
  readonly #shadow: THREE.Mesh;

  constructor(kit: Kit) {
    const shirt = material(kit.shirt);
    const trousers = material(kit.trousers);
    const skin = material(kit.skin, 0.6);
    const shoes = material(kit.shoes ?? 0xf2f2f2, 0.5);
    const legs = kit.pads ? material(0xf4f4ef, 0.6) : trousers;
    const hands = kit.gloves !== undefined ? material(kit.gloves, 0.7) : skin;

    this.#torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.3, 6, 16), shirt);
    this.#torso.castShadow = true;
    this.#hips = ball(0.15, trousers);
    this.#hips.scale.set(1.2, 0.85, 0.95);
    this.#neck = new Limb(0.05, skin);
    this.#upperArms = [new Limb(0.055, shirt), new Limb(0.055, shirt)];
    this.#forearms = [new Limb(0.045, skin), new Limb(0.045, skin)];
    this.#thighs = [new Limb(0.078, trousers), new Limb(0.078, trousers)];
    this.#shins = [new Limb(kit.pads ? 0.088 : 0.06, legs), new Limb(kit.pads ? 0.088 : 0.06, legs)];
    this.#shoulders = [ball(0.075, shirt), ball(0.075, shirt)];
    this.#elbows = [ball(0.05, shirt), ball(0.05, shirt)];
    this.#knees = [ball(kit.pads ? 0.095 : 0.07, legs), ball(kit.pads ? 0.095 : 0.07, legs)];
    this.#hands = kit.gloves !== undefined
      ? [this.#glove(hands), this.#glove(hands)]
      : [ball(0.05, hands), ball(0.05, hands)];
    this.#feet = [this.#shoe(shoes), this.#shoe(shoes)];

    this.#headGroup.add(ball(0.11, skin));
    if (kit.helmet !== undefined) this.#addHelmet(material(kit.helmet, 0.35));
    else if (kit.cap !== undefined) this.#addCap(material(kit.cap, 0.7));

    this.#shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.45, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    this.#shadow.rotation.x = -Math.PI / 2;

    this.group.add(
      this.#torso, this.#hips, this.#headGroup, this.#neck.mesh, this.#shadow,
      ...this.#upperArms.map((l) => l.mesh), ...this.#forearms.map((l) => l.mesh),
      ...this.#thighs.map((l) => l.mesh), ...this.#shins.map((l) => l.mesh),
      ...this.#shoulders, ...this.#elbows, ...this.#knees, ...this.#hands, ...this.#feet,
    );
  }

  #glove(material: THREE.Material): THREE.Mesh {
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.09), material);
    glove.castShadow = true;
    return glove;
  }

  #shoe(material: THREE.Material): THREE.Mesh {
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.27), material);
    shoe.castShadow = true;
    return shoe;
  }

  #addCap(material: THREE.Material): void {
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.116, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), material);
    crown.position.y = 0.01;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 16, 1, false, -Math.PI / 2, Math.PI), material);
    brim.position.set(0, 0.02, 0.06);
    this.#headGroup.add(crown, brim);
  }

  #addHelmet(material: THREE.Material): void {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.135, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.58), material);
    shell.position.y = 0.0;
    shell.castShadow = true;
    const peak = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 16, 1, false, -Math.PI / 2, Math.PI), material);
    peak.position.set(0, 0.03, 0.07);
    const grille = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.8, roughness: 0.3 });
    this.#headGroup.add(shell, peak);
    for (let i = 0; i < 3; i++) {
      const bar = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.006, 6, 20, Math.PI * 0.9), grille);
      bar.rotation.set(Math.PI / 2, 0, Math.PI * 0.05);
      bar.position.set(0, -0.03 - i * 0.035, 0.005);
      this.#headGroup.add(bar);
    }
  }

  /** Moves the shapes to match `pose`. */
  apply(): void {
    const p = this.pose;
    const facing = p.facing.clone().setY(0).normalize();
    const right = facing.clone().cross(UP).normalize();
    const shoulderL = p.chest.clone().addScaledVector(UP, 0.08).addScaledVector(right, -0.2);
    const shoulderR = p.chest.clone().addScaledVector(UP, 0.08).addScaledVector(right, 0.2);
    const hipL = p.pelvis.clone().addScaledVector(right, -0.1);
    const hipR = p.pelvis.clone().addScaledVector(right, 0.1);
    const ankleL = p.footL.clone().addScaledVector(UP, 0.09);
    const ankleR = p.footR.clone().addScaledVector(UP, 0.09);

    // Elbows bend down and out; knees bend forward.
    const elbowPole = (side: number) => UP.clone().negate().addScaledVector(right, 0.5 * side).addScaledVector(facing, -0.25);
    const kneePole = facing.clone().addScaledVector(UP, 0.1);
    const elbowL = solveJoint(shoulderL, p.handL, UPPER_ARM, FOREARM, elbowPole(-1), new THREE.Vector3());
    const elbowR = solveJoint(shoulderR, p.handR, UPPER_ARM, FOREARM, elbowPole(1), new THREE.Vector3());
    const kneeL = solveJoint(hipL, ankleL, THIGH, SHIN, kneePole, new THREE.Vector3());
    const kneeR = solveJoint(hipR, ankleR, THIGH, SHIN, kneePole, new THREE.Vector3());

    this.#upperArms[0].place(shoulderL, elbowL);
    this.#upperArms[1].place(shoulderR, elbowR);
    this.#forearms[0].place(elbowL, p.handL);
    this.#forearms[1].place(elbowR, p.handR);
    this.#thighs[0].place(hipL, kneeL);
    this.#thighs[1].place(hipR, kneeR);
    this.#shins[0].place(kneeL, ankleL);
    this.#shins[1].place(kneeR, ankleR);
    this.#shoulders[0].position.copy(shoulderL);
    this.#shoulders[1].position.copy(shoulderR);
    this.#elbows[0].position.copy(elbowL);
    this.#elbows[1].position.copy(elbowR);
    this.#knees[0].position.copy(kneeL);
    this.#knees[1].position.copy(kneeR);
    this.#hands[0].position.copy(p.handL);
    this.#hands[1].position.copy(p.handR);
    for (const [i, hand] of this.#hands.entries()) {
      const elbow = i === 0 ? elbowL : elbowR;
      hand.quaternion.setFromUnitVectors(UP, hand.position.clone().sub(elbow).normalize());
    }

    // Torso: up from the pelvis to the chest, broad across the shoulders.
    const spine = p.chest.clone().sub(p.pelvis);
    const height = spine.length();
    const yAxis = spine.normalize();
    const zAxis = facing.clone().addScaledVector(yAxis, -facing.dot(yAxis)).normalize();
    const xAxis = yAxis.clone().cross(zAxis);
    this.#torso.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    this.#torso.position.copy(p.pelvis).addScaledVector(yAxis, height * 0.55);
    this.#torso.scale.set(1.25, Math.max(height / 0.5, 0.6), 0.85);
    this.#hips.position.copy(p.pelvis);
    this.#hips.quaternion.copy(this.#torso.quaternion);

    const neckBase = p.chest.clone().addScaledVector(UP, 0.14);
    this.#neck.place(neckBase, p.head);
    this.#headGroup.position.copy(p.head);
    const look = (p.look ?? facing).clone().setY(0).normalize();
    this.#headGroup.lookAt(p.head.clone().add(look));

    const yaw = Math.atan2(facing.x, facing.z);
    for (const [i, foot] of this.#feet.entries()) {
      foot.position.copy(i === 0 ? p.footL : p.footR).addScaledVector(UP, 0.04).addScaledVector(facing, 0.05);
      foot.rotation.set(0, yaw, 0);
    }
    this.#shadow.position.set(p.pelvis.x, 0.012, p.pelvis.z);
  }
}

// ---- Poses. Each writes into a Pose, in a frame built from `base` (a point on
// the ground) and `facing`.

class Frame {
  readonly base = new THREE.Vector3();
  readonly forward = new THREE.Vector3();
  readonly right = new THREE.Vector3();
  set(base: THREE.Vector3, facing: THREE.Vector3): this {
    this.base.copy(base).setY(0);
    this.forward.copy(facing).setY(0).normalize();
    this.right.copy(this.forward).cross(UP).normalize();
    return this;
  }
  /** `forward` m ahead, `side` m to the right, `up` m above the ground. */
  at(out: THREE.Vector3, forward: number, side: number, up: number): THREE.Vector3 {
    return out.copy(this.base).addScaledVector(this.forward, forward).addScaledVector(this.right, side).setY(up);
  }
}
const frame = new Frame();

export function standPose(pose: Pose, base: THREE.Vector3, facing: THREE.Vector3, seconds: number): void {
  const f = frame.set(base, facing);
  const breathe = Math.sin(seconds * 1.7) * 0.008;
  pose.facing.copy(f.forward);
  pose.look = undefined;
  f.at(pose.pelvis, 0, 0, 0.97);
  f.at(pose.chest, 0.02, 0, 1.45 + breathe);
  f.at(pose.head, 0.03, 0, 1.72 + breathe);
  f.at(pose.handL, 0.05, -0.27, 0.98);
  f.at(pose.handR, 0.05, 0.27, 0.98);
  f.at(pose.footL, 0, -0.13, 0);
  f.at(pose.footR, 0, 0.13, 0);
}

/** A fielder's ready crouch as the ball is bowled: knees bent, hands low. */
export function readyPose(pose: Pose, base: THREE.Vector3, facing: THREE.Vector3): void {
  const f = frame.set(base, facing);
  pose.facing.copy(f.forward);
  pose.look = undefined;
  f.at(pose.pelvis, -0.06, 0, 0.8);
  f.at(pose.chest, 0.2, 0, 1.22);
  f.at(pose.head, 0.3, 0, 1.47);
  f.at(pose.handL, 0.35, -0.2, 0.62);
  f.at(pose.handR, 0.35, 0.2, 0.62);
  f.at(pose.footL, 0.05, -0.22, 0);
  f.at(pose.footR, 0.05, 0.22, 0);
}

/** Walking (intensity ≈ 0.15) to sprinting (1); `phase` advances 2π per two strides. */
export function runPose(pose: Pose, base: THREE.Vector3, facing: THREE.Vector3, phase: number, intensity: number): void {
  const f = frame.set(base, facing);
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const stride = 0.28 + 0.4 * intensity;
  const lift = 0.08 + 0.22 * intensity;
  const lean = 0.04 + 0.2 * intensity;
  const bob = Math.abs(c) * (0.02 + 0.04 * intensity);
  const swing = 0.15 + 0.25 * intensity;
  pose.facing.copy(f.forward);
  pose.look = undefined;
  f.at(pose.pelvis, 0, 0, 0.95 - 0.05 * intensity + bob);
  f.at(pose.chest, lean, 0, 1.43 - 0.06 * intensity + bob);
  f.at(pose.head, lean + 0.06, 0, 1.7 - 0.06 * intensity + bob);
  f.at(pose.footL, stride * s, -0.11, lift * Math.max(0, c));
  f.at(pose.footR, -stride * s, 0.11, lift * Math.max(0, -c));
  f.at(pose.handL, lean - swing * s, -0.25, 1.0 + 0.12 * intensity);
  f.at(pose.handR, lean + swing * s, 0.25, 1.0 + 0.12 * intensity);
}

/** Wicketkeeper crouched behind the stumps, gloves together. */
export function keeperPose(pose: Pose, base: THREE.Vector3, facing: THREE.Vector3): void {
  const f = frame.set(base, facing);
  pose.facing.copy(f.forward);
  pose.look = undefined;
  f.at(pose.pelvis, -0.12, 0, 0.58);
  f.at(pose.chest, 0.12, 0, 0.98);
  f.at(pose.head, 0.22, 0, 1.23);
  f.at(pose.handL, 0.45, -0.07, 0.55);
  f.at(pose.handR, 0.45, 0.07, 0.55);
  f.at(pose.footL, 0, -0.3, 0);
  f.at(pose.footR, 0, 0.3, 0);
}

/** Arms up, catching the ball at `at`. */
export function catchPose(pose: Pose, base: THREE.Vector3, facing: THREE.Vector3, at: THREE.Vector3): void {
  standPose(pose, base, facing, 0);
  const f = frame.set(base, facing);
  pose.handL.copy(at).addScaledVector(f.right, -0.06);
  pose.handR.copy(at).addScaledVector(f.right, 0.06);
}
