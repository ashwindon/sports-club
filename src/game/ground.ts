import * as THREE from "three";

import {
  GROUND_CENTRE_Z,
  OUTFIELD_RADIUS,
  PITCH_STRIP_CENTRE_Z,
  PITCH_STRIP_LENGTH,
  PITCH_WIDTH,
  grassGrainTexture,
  outfieldTexture,
  pitchTexture,
} from "./textures";

/** The outfield (mown stripes, the square, the 30-yard circle) and the pitch with its creases. */
export function createGround(): THREE.Group {
  const group = new THREE.Group();

  const outfield = new THREE.Mesh(
    new THREE.CircleGeometry(OUTFIELD_RADIUS, 128),
    new THREE.MeshStandardMaterial({
      map: outfieldTexture(),
      bumpMap: grassGrainTexture(),
      bumpScale: 0.6,
      roughness: 0.95,
    }),
  );
  outfield.rotation.x = -Math.PI / 2;
  outfield.position.z = GROUND_CENTRE_Z;
  outfield.receiveShadow = true;

  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(PITCH_WIDTH, PITCH_STRIP_LENGTH),
    new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.92 }),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.set(0, 0.004, PITCH_STRIP_CENTRE_Z);
  pitch.receiveShadow = true;

  group.add(outfield, pitch);
  return group;
}
