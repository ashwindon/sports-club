import * as THREE from "three";

import { Effects } from "./effects";
import { createLights, createSky, setupRenderer } from "./environment";
import { createGround } from "./ground";
import { Stadium } from "./stadium";
import { setAnisotropy } from "./textures";

// World units are metres. y is up, the batter's popping crease is at z = 0
// and the bowler is down the pitch towards −z. Off side (right-hander) is +x.
const BATTER_STUMPS_Z = 1.22;
const BOWLER_STUMPS_Z = -18.9;

function stumps(z: number, withBails: boolean): THREE.Group {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0xf2e8d2, roughness: 0.45 });
  const geometry = new THREE.CylinderGeometry(0.017, 0.019, 0.711, 14);
  geometry.translate(0, 0.711 / 2, 0); // pivot at the base, so knocked stumps tip over
  for (const x of [-0.1143, 0, 0.1143]) {
    const stump = new THREE.Mesh(geometry, wood);
    stump.position.set(x, 0, z);
    stump.castShadow = true;
    group.add(stump);
  }
  if (withBails) {
    for (const x of [-0.057, 0.057]) {
      const bail = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.11, 8), wood);
      bail.rotation.z = Math.PI / 2;
      bail.position.set(x, 0.718, z);
      group.add(bail);
    }
  }
  return group;
}

const VIEWS = [
  // Over the batter's shoulder, down the pitch: the bowler, the ball and the bat in one frame.
  { name: "behind", position: [1.15, 2.55, 6.1], target: [0.05, 0.8, -10] },
  // Side-on, square of the wicket: shows a swing's whole arc.
  { name: "side-on", position: [5.2, 1.5, 0.2], target: [0.2, 1.0, 0] },
  // From the bowler's end, as the bowler sees the bat face.
  { name: "front", position: [0.3, 1.6, -4.2], target: [0.2, 0.95, 0.4] },
] as const;

export const VIEW_NAMES = VIEWS.map((v) => v.name);

/** Where the camera sits while it follows a hit: up behind the batter. */
const FOLLOW_FROM = new THREE.Vector3(0.6, 9, 16);

export interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  stadium: Stadium;
  effects: Effects;
  /** The batting view in use, an index into VIEW_NAMES. */
  readonly view: number;
  setView(index: number): void;
  /** Jumps to the next batting view and returns its name. */
  nextView(): string;
  /** Follow a point (the ball after a hit), or ease back to the batting view with null. */
  follow(target: THREE.Vector3 | null): void;
  /** A jolt of camera shake, 0–1. */
  shake(amount: number): void;
  knockStumps(): void;
  resetStumps(): void;
  /** Moves everything that moves by itself: camera, sky, crowd, effects. */
  update(now: number, dt: number): void;
}

export function createStage(container: HTMLElement): Stage {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  setupRenderer(renderer);
  setAnisotropy(renderer);
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const driftClouds = createSky(scene, renderer);
  createLights(scene);
  scene.add(createGround());

  const stadium = new Stadium();
  const effects = new Effects(BATTER_STUMPS_Z);
  const batterStumps = stumps(BATTER_STUMPS_Z, false);
  scene.add(stadium.group, effects.group, batterStumps, stumps(BOWLER_STUMPS_Z, true));

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 2000);
  const look = new THREE.Vector3();
  const wantPosition = new THREE.Vector3();
  const wantLook = new THREE.Vector3();
  const shakeOffset = new THREE.Vector3();
  let shakeLevel = 0;
  let following: THREE.Vector3 | null = null;
  let view = 0;
  const setView = (index: number, jump: boolean) => {
    view = index;
    wantPosition.fromArray(VIEWS[view].position);
    wantLook.fromArray(VIEWS[view].target);
    if (jump) {
      camera.position.copy(wantPosition);
      look.copy(wantLook);
      camera.lookAt(look);
    }
  };
  setView(0, true);

  const resize = () => {
    const { clientWidth: width, clientHeight: height } = container;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(container);
  resize();

  return {
    renderer,
    scene,
    camera,
    stadium,
    effects,
    get view() {
      return view;
    },
    setView(index) {
      setView(index, true);
    },
    nextView() {
      setView((view + 1) % VIEWS.length, true);
      return VIEWS[view].name;
    },
    follow(target) {
      following = target;
      if (!target) setView(view, false);
    },
    shake(amount) {
      shakeLevel = Math.max(shakeLevel, amount);
    },
    knockStumps() {
      batterStumps.children.forEach((stump, i) => {
        stump.rotation.set(0.45 + 0.4 * Math.random(), 0, (i - 1) * 0.35 * Math.random());
      });
      effects.knockBails();
      effects.dust(new THREE.Vector3(0, 0, BATTER_STUMPS_Z), 0.8);
    },
    resetStumps() {
      for (const stump of batterStumps.children) stump.rotation.set(0, 0, 0);
      effects.resetBails();
    },
    update(now, dt) {
      if (following) {
        wantPosition.copy(FOLLOW_FROM);
        wantLook.copy(following);
      }
      camera.position.sub(shakeOffset);
      camera.position.lerp(wantPosition, 1 - Math.exp(-dt * (following ? 2.5 : 4)));
      look.lerp(wantLook, 1 - Math.exp(-dt * (following ? 6 : 4)));
      shakeLevel *= Math.exp(-dt * 7);
      shakeOffset.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shakeLevel * 0.12);
      camera.position.add(shakeOffset);
      camera.lookAt(look);
      driftClouds(now / 1000);
      stadium.update(now, dt);
      effects.update(dt);
    },
  };
}
