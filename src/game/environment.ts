import * as THREE from "three";

/** Where the afternoon sun is: behind the batter's left shoulder, so faces and bat are lit. */
export const SUN_DIRECTION = new THREE.Vector3(-0.42, 0.7, 0.58).normalize();

export function setupRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
}

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    vec4 world = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
    gl_Position.z = gl_Position.w; // always at the far plane
  }
`;

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 below;
  uniform vec3 sunDirection;
  uniform float time;
  varying vec3 vDirection;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDirection);
    float h = d.y;
    vec3 color = h > 0.0 ? mix(horizon, zenith, pow(h, 0.5)) : mix(horizon, below, pow(-h, 0.4));
    if (h > 0.0) {
      // Fair-weather clouds, flattened towards the horizon.
      vec2 uv = d.xz / (h + 0.12) * 1.4 + vec2(time * 0.004, 0.0);
      float cloud = smoothstep(0.52, 0.78, fbm(uv));
      color = mix(color, vec3(1.0, 0.99, 0.97), cloud * 0.75 * smoothstep(0.02, 0.3, h));
    }
    float sun = max(dot(d, sunDirection), 0.0);
    color += vec3(1.0, 0.92, 0.75) * (pow(sun, 900.0) * 6.0 + pow(sun, 18.0) * 0.18);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function skyMesh(radius: number): THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 24),
    new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        zenith: { value: new THREE.Color(0x2f6fc4) },
        horizon: { value: new THREE.Color(0xcfe4f3) },
        below: { value: new THREE.Color(0x8aa58a) },
        sunDirection: { value: SUN_DIRECTION.clone() },
        time: { value: 0 },
      },
    }),
  );
}

/**
 * A gradient sky with clouds, and image-based lighting baked from it so every
 * surface picks up the sky's colour. Returns a function to drift the clouds.
 */
export function createSky(scene: THREE.Scene, renderer: THREE.WebGLRenderer): (seconds: number) => void {
  const sky = skyMesh(1500);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.add(skyMesh(500));
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(400, 32),
    new THREE.MeshBasicMaterial({ color: 0x3d7a33 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1;
  envScene.add(ground);
  scene.environment = pmrem.fromScene(envScene, 0.03, 0.1, 1000).texture;
  scene.environmentIntensity = 0.6;
  pmrem.dispose();

  scene.fog = new THREE.Fog(0xcfe4f3, 180, 900);
  return (seconds) => {
    sky.material.uniforms.time.value = seconds;
  };
}

/** The sun (with sharp shadows over the middle of the ground) and a little sky fill. */
export function createLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xd6ebff, 0x35562a, 0.35));
  const sun = new THREE.DirectionalLight(0xfff0d6, 2.7);
  const focus = new THREE.Vector3(0, 0, -6);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(90).add(focus);
  sun.target.position.copy(focus);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 10, far: 200 });
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);
}
