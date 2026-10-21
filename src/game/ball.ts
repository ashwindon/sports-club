import * as THREE from "three";

import type { Vec3 } from "./physics";
import { ballTexture } from "./textures";

/** Drawn bigger than the real 36 mm radius: a true-size ball is a few pixels across from behind the batter. */
const DRAWN_RADIUS = 0.055;
const UP = new THREE.Vector3(0, 1, 0);
const TRAIL_LENGTH = 10;

/** The ball as seen: the ball, its shadow (which is how you judge its height), a short trail, and the pitch mark. */
export class BallView {
  readonly group = new THREE.Group();
  readonly #ball: THREE.Mesh;
  readonly #shadow: THREE.Mesh;
  readonly #trail: THREE.Line;
  readonly #trailPoints: THREE.Vector3[] = [];
  readonly #mark: THREE.Mesh;

  constructor() {
    this.#ball = new THREE.Mesh(
      new THREE.SphereGeometry(DRAWN_RADIUS, 24, 16),
      new THREE.MeshStandardMaterial({ map: ballTexture(), emissive: 0x3a0008, roughness: 0.35 }),
    );
    this.#ball.castShadow = true;

    this.#shadow = new THREE.Mesh(
      new THREE.CircleGeometry(DRAWN_RADIUS * 1.2, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.#shadow.rotation.x = -Math.PI / 2;

    this.#trail = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffd0d0, transparent: true, opacity: 0.55 }),
    );
    this.#trail.frustumCulled = false;

    this.#mark = new THREE.Mesh(
      new THREE.CircleGeometry(0.09, 20),
      new THREE.MeshBasicMaterial({ color: 0x6b4a2b, transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.#mark.rotation.x = -Math.PI / 2;

    this.group.add(this.#ball, this.#shadow, this.#trail, this.#mark);
    this.hide();
  }

  show([x, y, z]: Vec3): void {
    this.#ball.visible = this.#shadow.visible = this.#trail.visible = true;
    // Spin it as it travels, the seam tumbling over and over.
    const moved = new THREE.Vector3(x, y, z).sub(this.#ball.position);
    const distance = moved.length();
    if (distance > 1e-4 && distance < 3) {
      const axis = moved.cross(UP).normalize();
      if (axis.lengthSq() > 0.5) this.#ball.rotateOnWorldAxis(axis, -distance / DRAWN_RADIUS);
    }
    this.#ball.position.set(x, y, z);
    this.#shadow.position.set(x, 0.004, z);
    // Smaller and fainter the higher the ball is.
    const lift = Math.min(y / 4, 1);
    this.#shadow.scale.setScalar(1 + lift);
    (this.#shadow.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - lift * 0.7);

    this.#trailPoints.push(new THREE.Vector3(x, y, z));
    if (this.#trailPoints.length > TRAIL_LENGTH) this.#trailPoints.shift();
    this.#trail.geometry.setFromPoints(this.#trailPoints);
  }

  /** In the bowler's hand: no trail. */
  hold(at: THREE.Vector3): void {
    this.#ball.visible = this.#shadow.visible = true;
    this.#trail.visible = false;
    this.#trailPoints.length = 0;
    this.#ball.position.copy(at);
    this.#shadow.position.set(at.x, 0.004, at.z);
  }

  markPitch(x: number, z: number): void {
    this.#mark.visible = true;
    this.#mark.position.set(x, 0.003, z);
  }

  hide(): void {
    this.#ball.visible = this.#shadow.visible = this.#trail.visible = this.#mark.visible = false;
    this.#trailPoints.length = 0;
  }

  get position(): THREE.Vector3 {
    return this.#ball.position;
  }
}
