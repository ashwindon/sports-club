import * as THREE from "three";

import { GROUND_CENTRE_Z, boardTexture, floodlightTexture, screenTexture } from "./textures";
import type { ScreenInfo } from "./textures";

export const BOUNDARY_RADIUS = 62;
const BOARDS_RADIUS = 64.8;
const STAND_FRONT = 69;
const ROWS = 24;
const ROW_DEPTH = 0.85;
const ROW_RISE = 0.42;
const FRONT_WALL = 2.2;
const DEG = Math.PI / 180;

/** The stands leave the two ends open, behind the sightscreens. */
const STAND_ARCS: [number, number][] = [
  [16, 164],
  [196, 344],
];

/** A point on a circle round the middle of the ground; angle 0 is behind the batter (+z). */
function around(radius: number, angle: number, y = 0): THREE.Vector3 {
  return new THREE.Vector3(radius * Math.sin(angle), y, GROUND_CENTRE_Z + radius * Math.cos(angle));
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** Splits each stand arc into sections with aisles between them (radians). */
function sections(): [number, number][] {
  const out: [number, number][] = [];
  for (const [from, to] of STAND_ARCS) {
    const count = 4;
    const gap = 2.5;
    const span = (to - from - gap * (count - 1)) / count;
    for (let i = 0; i < count; i++) {
      const start = from + i * (span + gap);
      out.push([start * DEG, (start + span) * DEG]);
    }
  }
  return out;
}

/** Makes instanced crowd members bob, and jump while `cheer` is up. */
function cheering(material: THREE.MeshStandardMaterial, uniforms: { cheer: THREE.IUniform<number>; time: THREE.IUniform<number> }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCheer = uniforms.cheer;
    shader.uniforms.uTime = uniforms.time;
    shader.vertexShader =
      "uniform float uCheer;\nuniform float uTime;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float phase = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.61;
          transformed.x += sin(uTime * 1.3 + phase) * 0.03;
          transformed.y += uCheer * max(0.0, sin(uTime * 11.0 + phase * 3.0)) * 0.38;
        #endif`,
      );
  };
}

const SHIRTS = [0x1f6fb2, 0x1f6fb2, 0xe8c547, 0xffffff, 0xd2413a, 0x2e8b57, 0x13294b, 0xf08a24, 0x8e44ad, 0x1f6fb2, 0xe8c547];
const SKINS = [0xf1c7a5, 0xd9a07a, 0xb07a55, 0x8a5a3b, 0x5e3b26];

export class Stadium {
  readonly group = new THREE.Group();
  readonly #uniforms = { cheer: { value: 0 }, time: { value: 0 } };
  #cheerUntil = 0;
  readonly #screen = screenTexture();

  constructor() {
    this.#rope();
    this.#boards();
    this.#sightscreens();
    this.#stands();
    this.#floodlights();
    this.#bigScreen();
  }

  /** Gets the crowd on its feet for a while. */
  cheer(seconds = 2.5, now = performance.now()): void {
    this.#cheerUntil = now + seconds * 1000;
  }

  showOnScreen(info: ScreenInfo): void {
    this.#screen.draw(info);
  }

  update(now: number, dt: number): void {
    this.#uniforms.time.value = now / 1000;
    const target = now < this.#cheerUntil ? 1 : 0;
    this.#uniforms.cheer.value += (target - this.#uniforms.cheer.value) * (1 - Math.exp(-dt * 4));
  }

  #rope(): void {
    const rope = new THREE.Mesh(
      new THREE.TorusGeometry(BOUNDARY_RADIUS, 0.08, 8, 256),
      new THREE.MeshStandardMaterial({ color: 0xf3f3f3, roughness: 0.5 }),
    );
    rope.rotation.x = Math.PI / 2;
    rope.position.set(0, 0.08, GROUND_CENTRE_Z);
    this.group.add(rope);
  }

  #boards(): void {
    const messages: [string, string, string][] = [
      ["PHONE BAT CRICKET", "#0f8f8c", "#1f5fb8"],
      ["SWING YOUR PHONE", "#f08a24", "#d2413a"],
      ["HIT IT FOR SIX", "#7b3fb8", "#d23f8a"],
      ["NO BAT? NO PROBLEM", "#2e8b57", "#0f8f8c"],
      ["CALIBRATE · SWING · SCORE", "#13294b", "#1f6fb2"],
      ["PLAYED IN THE BROWSER", "#d2413a", "#f08a24"],
    ];
    const faces = messages.map(([text, from, to]) => {
      const map = boardTexture(text, from, to);
      return new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.5 });
    });
    const frame = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.7 });
    const geometry = new THREE.BoxGeometry(6.2, 0.95, 0.18);
    const count = Math.floor((2 * Math.PI * BOARDS_RADIUS) / 6.4);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      // Leave room for the sightscreens.
      const fromEnd = Math.min(Math.abs(angle), Math.abs(angle - Math.PI), Math.abs(angle - 2 * Math.PI));
      if (fromEnd < 10 * DEG) continue;
      const face = faces[i % faces.length];
      const board = new THREE.Mesh(geometry, [frame, frame, frame, frame, face, frame]);
      board.position.copy(around(BOARDS_RADIUS, angle, 0.48));
      board.lookAt(0, 0.48, GROUND_CENTRE_Z);
      this.group.add(board);
    }
  }

  #sightscreens(): void {
    const white = new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.8 });
    for (const angle of [0, Math.PI]) {
      const screen = new THREE.Group();
      const board = new THREE.Mesh(new THREE.BoxGeometry(20, 8, 0.4), white);
      board.position.y = 5;
      const base = new THREE.Mesh(new THREE.BoxGeometry(20.6, 1, 1.2), dark);
      base.position.y = 0.5;
      screen.add(board, base);
      screen.position.copy(around(BOARDS_RADIUS + 3, angle));
      screen.lookAt(0, 0, GROUND_CENTRE_Z);
      this.group.add(screen);
    }
  }

  #stands(): void {
    // Stepped terrace profile (radius, height), from the front wall up and over the back.
    const profile: THREE.Vector2[] = [new THREE.Vector2(STAND_FRONT, 0), new THREE.Vector2(STAND_FRONT, FRONT_WALL)];
    for (let k = 0; k < ROWS; k++) {
      const y = FRONT_WALL + k * ROW_RISE;
      profile.push(new THREE.Vector2(STAND_FRONT + (k + 1) * ROW_DEPTH, y));
      if (k < ROWS - 1) profile.push(new THREE.Vector2(STAND_FRONT + (k + 1) * ROW_DEPTH, y + ROW_RISE));
    }
    const back = STAND_FRONT + ROWS * ROW_DEPTH;
    profile.push(new THREE.Vector2(back, 20.5), new THREE.Vector2(back + 1, 20.5), new THREE.Vector2(back + 1, 0));

    const concrete = new THREE.MeshStandardMaterial({ color: 0xa9aeb8, roughness: 0.92, flatShading: true, side: THREE.DoubleSide });
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide });
    const columnMaterial = new THREE.MeshStandardMaterial({ color: 0x8d949e, roughness: 0.5, metalness: 0.4 });
    const columnGeometry = new THREE.CylinderGeometry(0.35, 0.35, 20.5, 10);
    const roofProfile = [new THREE.Vector2(back - 10, 18.6), new THREE.Vector2(back + 2, 21)];

    const rand = seeded(42);
    const seats: { position: THREE.Vector3; angle: number }[] = [];
    for (const [from, to] of sections()) {
      const stand = new THREE.Mesh(new THREE.LatheGeometry(profile, 48, from, to - from), concrete);
      stand.position.z = GROUND_CENTRE_Z;
      stand.receiveShadow = true;
      const roof = new THREE.Mesh(new THREE.LatheGeometry(roofProfile, 48, from, to - from), roofMaterial);
      roof.position.z = GROUND_CENTRE_Z;
      this.group.add(stand, roof);
      for (let a = from; a <= to; a += 8 * DEG) {
        const column = new THREE.Mesh(columnGeometry, columnMaterial);
        column.position.copy(around(back + 1.5, a, 10.25));
        this.group.add(column);
      }
      for (let k = 0; k < ROWS; k++) {
        const radius = STAND_FRONT + (k + 0.5) * ROW_DEPTH;
        const n = Math.floor((radius * (to - from)) / 0.62);
        for (let i = 0; i < n; i++) {
          if (rand() > 0.86) continue; // the odd empty seat
          const angle = from + ((i + 0.5) / n) * (to - from);
          seats.push({ position: around(radius, angle, FRONT_WALL + k * ROW_RISE), angle });
        }
      }
    }

    // The crowd: one instanced mesh of bodies, one of heads.
    const bodyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const headMaterial = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    cheering(bodyMaterial, this.#uniforms);
    cheering(headMaterial, this.#uniforms);
    const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 0.62, 0.34), bodyMaterial, seats.length);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 10, 8), headMaterial, seats.length);
    const placer = new THREE.Object3D();
    const color = new THREE.Color();
    seats.forEach(({ position, angle }, i) => {
      placer.position.copy(position).setY(position.y + 0.45);
      placer.rotation.set(0, angle + Math.PI, 0);
      placer.updateMatrix();
      bodies.setMatrixAt(i, placer.matrix);
      bodies.setColorAt(i, color.setHex(SHIRTS[Math.floor(rand() * SHIRTS.length)]));
      placer.position.setY(position.y + 0.92);
      placer.updateMatrix();
      heads.setMatrixAt(i, placer.matrix);
      heads.setColorAt(i, color.setHex(SKINS[Math.floor(rand() * SKINS.length)]));
    });
    this.group.add(bodies, heads);
  }

  #floodlights(): void {
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa2ad, roughness: 0.4, metalness: 0.6 });
    const lamps = floodlightTexture();
    const face = new THREE.MeshStandardMaterial({ map: lamps, emissiveMap: lamps, emissive: 0xffffff, emissiveIntensity: 0.9 });
    for (const angle of [50, 130, 230, 310]) {
      const base = around(104, angle * DEG);
      const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.1, 50, 12), metal);
      pylon.position.copy(base).setY(25);
      const head = new THREE.Mesh(new THREE.BoxGeometry(11, 6, 1.2), [metal, metal, metal, metal, face, metal]);
      head.position.copy(base).setY(51);
      head.lookAt(0, 0, GROUND_CENTRE_Z);
      this.group.add(pylon, head);
    }
  }

  #bigScreen(): void {
    const angle = 210 * DEG;
    const screen = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(23.5, 13.8, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.6 }),
    );
    const display = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 12.375),
      new THREE.MeshBasicMaterial({ map: this.#screen.texture, toneMapped: false }),
    );
    display.position.z = 0.41;
    const post = new THREE.Mesh(new THREE.BoxGeometry(2, 22, 1.5), new THREE.MeshStandardMaterial({ color: 0x8d949e, roughness: 0.5 }));
    post.position.set(0, -15, -0.6);
    screen.add(frame, display, post);
    screen.position.copy(around(92, angle, 30));
    screen.lookAt(0, 30, GROUND_CENTRE_Z);
    this.group.add(screen);
    this.#screen.draw({ score: "0/0", overs: "0.0", thisOver: [] });
  }
}
