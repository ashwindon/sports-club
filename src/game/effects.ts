import * as THREE from "three";

import { softDotTexture } from "./textures";

interface Particle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  age: number;
  life: number;
  grow: number;
}

/** Dust puffs, the bat's impact flash, and flying bails. */
export class Effects {
  readonly group = new THREE.Group();
  readonly #particles: Particle[] = [];
  readonly #texture = softDotTexture();
  readonly #bails: { mesh: THREE.Mesh; home: THREE.Vector3; velocity: THREE.Vector3; spin: THREE.Vector3; flying: boolean }[] = [];

  constructor(stumpsZ: number) {
    const wood = new THREE.MeshStandardMaterial({ color: 0xf0e2c0, roughness: 0.5 });
    for (const x of [-0.057, 0.057]) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.11, 8), wood);
      mesh.rotation.z = Math.PI / 2;
      mesh.castShadow = true;
      const home = new THREE.Vector3(x, 0.718, stumpsZ);
      mesh.position.copy(home);
      this.group.add(mesh);
      this.#bails.push({ mesh, home, velocity: new THREE.Vector3(), spin: new THREE.Vector3(), flying: false });
    }
  }

  /** A puff of dust where the ball meets the ground. */
  dust(at: THREE.Vector3, amount = 1, color = 0xc9b07f): void {
    const count = Math.round(6 + 10 * amount);
    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.#texture, color, transparent: true, opacity: 0.55, depthWrite: false }),
      );
      sprite.position.copy(at).setY(0.05);
      sprite.scale.setScalar(0.08);
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.4 + Math.random() * 0.9) * amount;
      this.#spawn({
        sprite,
        velocity: new THREE.Vector3(Math.cos(angle) * speed, 0.4 + Math.random() * 0.8 * amount, Math.sin(angle) * speed),
        age: 0,
        life: 0.6 + Math.random() * 0.5,
        grow: 0.5 + Math.random() * 0.6,
      });
    }
  }

  /** A bright pop where bat meets ball. */
  flash(at: THREE.Vector3, strength: number): void {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.#texture, color: 0xfff6dd, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    sprite.position.copy(at);
    sprite.scale.setScalar(0.1);
    this.#spawn({ sprite, velocity: new THREE.Vector3(), age: 0, life: 0.16, grow: 4 + 6 * strength });
  }

  /** Sends the bails flying back off the stumps. */
  knockBails(): void {
    for (const bail of this.#bails) {
      bail.flying = true;
      bail.velocity.set((Math.random() - 0.5) * 2.5, 2.5 + Math.random() * 2, 2.5 + Math.random() * 3);
      bail.spin.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
    }
  }

  resetBails(): void {
    for (const bail of this.#bails) {
      bail.flying = false;
      bail.mesh.position.copy(bail.home);
      bail.mesh.rotation.set(0, 0, Math.PI / 2);
    }
  }

  update(dt: number): void {
    for (let i = this.#particles.length - 1; i >= 0; i--) {
      const p = this.#particles[i];
      p.age += dt;
      const u = p.age / p.life;
      if (u >= 1) {
        this.group.remove(p.sprite);
        p.sprite.material.dispose();
        this.#particles.splice(i, 1);
        continue;
      }
      p.velocity.multiplyScalar(1 - dt * 2.5);
      p.sprite.position.addScaledVector(p.velocity, dt);
      p.sprite.scale.setScalar(0.08 + p.grow * u * 0.5);
      p.sprite.material.opacity = (1 - u) * (p.life < 0.3 ? 0.9 : 0.55);
    }
    for (const bail of this.#bails) {
      if (!bail.flying) continue;
      bail.velocity.y -= 9.81 * dt;
      bail.mesh.position.addScaledVector(bail.velocity, dt);
      bail.mesh.rotation.x += bail.spin.x * dt;
      bail.mesh.rotation.y += bail.spin.y * dt;
      if (bail.mesh.position.y <= 0.01) {
        bail.mesh.position.y = 0.01;
        bail.flying = false;
      }
    }
  }

  #spawn(particle: Particle): void {
    this.#particles.push(particle);
    this.group.add(particle.sprite);
  }
}
