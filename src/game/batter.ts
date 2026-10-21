import * as THREE from "three";

import { GRIP_AT_STANCE } from "./bat";
import type { BatRig } from "./bat";
import { Puppet } from "./puppet";
import type { Kit } from "./puppet";

export const BATTING_KIT: Kit = {
  shirt: 0x1d2a5c,
  trousers: 0x1d2a5c,
  skin: 0xc48a63,
  shoes: 0xf2f2f2,
  helmet: 0x1d2a5c,
  pads: true,
  gloves: 0xf2f2f2,
};

/** Side-on to the off side (+x), turned a little towards the bowler. */
const FACING = new THREE.Vector3(1, 0, -0.45).normalize();
/** Eyes on the bowler. */
const LOOK = new THREE.Vector3(0.3, 0, -1).normalize();
const REST_HANDS = GRIP_AT_STANCE.clone().add(new THREE.Vector3(0, -0.01, 0));

/**
 * The batter: gloves wherever the bat's handle is (the phone decides that),
 * the body leaning after them, and the footwork the game adds for each ball.
 */
export class Batter {
  readonly puppet = new Puppet(BATTING_KIT);
  readonly #follow = new THREE.Vector3();

  update(rig: BatRig): void {
    const p = this.puppet.pose;
    const step = rig.step;
    const crouch = Math.min(step.y, 0);
    const rise = Math.max(step.y, 0);
    const x = step.x - 0.05;

    // The upper body leans a little after the hands as the bat swings.
    this.#follow
      .copy(rig.topHand)
      .add(rig.bottomHand)
      .multiplyScalar(0.5)
      .sub(REST_HANDS)
      .sub(step)
      .clampLength(0, 0.4)
      .multiplyScalar(0.3);

    p.facing.copy(FACING);
    p.look = LOOK;
    p.footL.set(x + 0.05, 0, -0.38);
    p.footR.set(x - 0.05, 0, 0.22);
    p.pelvis.set(x - 0.02, 0.88 + crouch * 0.6 + rise * 0.3, -0.08);
    p.chest.set(x + 0.17, 1.25 + crouch * 0.8 + rise * 0.8, -0.1).add(this.#follow);
    p.head.copy(p.chest).add(new THREE.Vector3(0.08, 0.27, -0.06));
    // Right-hander: left hand on top of the handle.
    p.handL.copy(rig.topHand);
    p.handR.copy(rig.bottomHand);
    this.puppet.apply();
  }
}
