// Textures painted on canvases at startup: no image files to load or license.
import * as THREE from "three";

let maxAnisotropy = 8;

/** Call once with the renderer, so textures can use its best filtering. */
export function setAnisotropy(renderer: THREE.WebGLRenderer): void {
  maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
}

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return [c, c.getContext("2d")!];
}

function toTexture(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(c);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

/** A tiny deterministic random, so the ground looks the same every load. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** Sprinkles little darker and lighter flecks over an area. */
function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, colors: string[], size: number, rand: () => number) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    ctx.fillRect(rand() * w, rand() * h, size * (0.5 + rand()), size * (0.5 + rand()));
  }
}

export const GROUND_CENTRE_Z = -9.4;
export const OUTFIELD_RADIUS = 95;
const BATTER_STUMPS_Z = 1.22;
const BOWLER_STUMPS_Z = -18.9;

/**
 * The outfield as seen from above: mowing stripes along the pitch, the lighter
 * square in the middle, and the dashed 30-yard circle.
 */
export function outfieldTexture(): THREE.CanvasTexture {
  const size = 2048;
  const [c, ctx] = canvas(size, size);
  const rand = seeded(11);
  // World (x, z) to canvas pixels, matching a CircleGeometry laid flat.
  const px = (x: number) => ((x / OUTFIELD_RADIUS + 1) / 2) * size;
  const pz = (z: number) => (((z - GROUND_CENTRE_Z) / OUTFIELD_RADIUS + 1) / 2) * size;
  const metre = size / (2 * OUTFIELD_RADIUS);

  ctx.fillStyle = "#3f7f34";
  ctx.fillRect(0, 0, size, size);
  const stripe = 7;
  for (let x = -OUTFIELD_RADIUS; x < OUTFIELD_RADIUS; x += stripe) {
    const odd = Math.round(x / stripe) % 2 === 0;
    ctx.fillStyle = odd ? "#4a8f3b" : "#3b7a31";
    ctx.fillRect(px(x), 0, stripe * metre + 1, size);
  }
  speckle(ctx, size, size, 60000, ["rgba(20,60,15,0.18)", "rgba(120,170,80,0.14)", "rgba(30,80,25,0.12)"], 2.2, rand);

  // The square: a lighter, closer-mown block either side of the pitch.
  ctx.fillStyle = "rgba(175, 205, 120, 0.22)";
  ctx.fillRect(px(-11), pz(BOWLER_STUMPS_Z - 4), 22 * metre, (BATTER_STUMPS_Z - BOWLER_STUMPS_Z + 8) * metre);

  // 30-yard circle: half-circles round each set of stumps, joined by straight lines.
  const r = 27.43;
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 0.18 * metre;
  ctx.setLineDash([1.6 * metre, 1.3 * metre]);
  ctx.beginPath();
  ctx.arc(px(0), pz(BATTER_STUMPS_Z), r * metre, 0, Math.PI);
  ctx.lineTo(px(-r), pz(BOWLER_STUMPS_Z));
  ctx.arc(px(0), pz(BOWLER_STUMPS_Z), r * metre, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.stroke();
  return toTexture(c);
}

/** Fine grass grain, tiled many times over the outfield as a bump map. */
export function grassGrainTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const rand = seeded(5);
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, 9000, ["#6a6a6a", "#9a9a9a", "#747474", "#8c8c8c"], 1.6, rand);
  const texture = toTexture(c, false);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(140, 140);
  return texture;
}

export const PITCH_WIDTH = 3.05;
export const PITCH_STRIP_LENGTH = 24.56;
export const PITCH_STRIP_CENTRE_Z = -8.84;

/**
 * The pitch from above: dry and worn where the bowlers land and the batters
 * stand, with the creases painted on.
 */
export function pitchTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 2048;
  const [c, ctx] = canvas(w, h);
  const rand = seeded(23);
  const top = PITCH_STRIP_CENTRE_Z - PITCH_STRIP_LENGTH / 2;
  const py = (z: number) => ((z - top) / PITCH_STRIP_LENGTH) * h;
  const px = (x: number) => (x / PITCH_WIDTH + 0.5) * w;
  const metre = w / PITCH_WIDTH;

  const base = ctx.createLinearGradient(0, 0, w, 0);
  base.addColorStop(0, "#a9a26a");
  base.addColorStop(0.15, "#cdb684");
  base.addColorStop(0.5, "#d6bf8d");
  base.addColorStop(0.85, "#cdb684");
  base.addColorStop(1, "#a9a26a");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  speckle(ctx, w, h, 26000, ["rgba(120,95,55,0.18)", "rgba(240,225,190,0.16)", "rgba(110,120,60,0.1)"], 2, rand);

  // Scuffed, darker patches where feet land.
  for (const z of [0.2, -1.2, -16.5, -18.0]) {
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = `rgba(105, 80, 45, ${0.06 + rand() * 0.08})`;
      ctx.beginPath();
      ctx.ellipse(px((rand() - 0.5) * 1.6), py(z + (rand() - 0.5) * 1.8), (0.1 + rand() * 0.25) * metre, (0.15 + rand() * 0.4) * metre, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Hairline cracks.
  ctx.strokeStyle = "rgba(90, 70, 40, 0.25)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 40; i++) {
    let x = rand() * w;
    let y = rand() * h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) ctx.lineTo((x += (rand() - 0.5) * 18), (y += (rand() - 0.5) * 30));
    ctx.stroke();
  }

  // Creases (5 cm white lines) at both ends.
  ctx.fillStyle = "#f7f4ea";
  const line = 0.05 * metre;
  for (const [stumps, popping, dir] of [
    [BATTER_STUMPS_Z, 0, 1],
    [BOWLER_STUMPS_Z, BOWLER_STUMPS_Z + 1.22, -1],
  ] as const) {
    ctx.fillRect(0, py(popping) - line / 2, w, line); // popping crease, full width
    ctx.fillRect(px(-1.32), py(stumps) - line / 2, 2.64 * metre, line); // bowling crease
    for (const x of [-1.32, 1.32]) {
      // Return creases, from the popping crease back past the stumps.
      const a = py(popping);
      const b = py(stumps + dir * 1.22);
      ctx.fillRect(px(x) - line / 2, Math.min(a, b), line, Math.abs(b - a));
    }
    for (const x of [-0.89, 0.89]) {
      // Wide guidelines: short marks from the popping crease towards the stumps.
      const a = py(popping);
      const b = py(popping + dir * 0.6);
      ctx.fillRect(px(x) - line / 3, Math.min(a, b), line * 0.66, Math.abs(b - a));
    }
  }
  return toTexture(c);
}

/** Red leather with a raised cream seam round the middle (equirectangular). */
export function ballTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 128);
  const rand = seeded(3);
  ctx.fillStyle = "#b5122a";
  ctx.fillRect(0, 0, 256, 128);
  speckle(ctx, 256, 128, 2500, ["rgba(70,0,10,0.25)", "rgba(230,80,90,0.12)"], 1.5, rand);
  ctx.fillStyle = "#efe2c8";
  ctx.fillRect(0, 60, 256, 2);
  ctx.fillRect(0, 66, 256, 2);
  ctx.fillStyle = "#d9c7a6";
  for (let x = 0; x < 256; x += 4) {
    ctx.fillRect(x, 57, 2, 2);
    ctx.fillRect(x + 2, 69, 2, 2);
  }
  return toTexture(c);
}

/** Ribbed rubber for the bat handle. */
export function gripTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 256);
  ctx.fillStyle = "#7d1220";
  ctx.fillRect(0, 0, 64, 256);
  ctx.fillStyle = "#4e0a14";
  for (let y = 0; y < 256; y += 16) ctx.fillRect(0, y, 64, 6);
  return toTexture(c);
}

const AD_FONT = `"Barlow Condensed", "Arial Narrow", sans-serif`;

/**
 * An LED advertising board. Redrawn once the web font has loaded, so the
 * first frame isn't stuck with the fallback face.
 */
export function boardTexture(text: string, from: string, to: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(1024, 128);
  const texture = toTexture(c);
  const draw = () => {
    const gradient = ctx.createLinearGradient(0, 0, 1024, 0);
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1024, 128);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    for (let x = 0; x < 1024; x += 6) ctx.fillRect(x, 0, 1, 128);
    ctx.font = `italic 800 92px ${AD_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, 512, 68, 980);
    texture.needsUpdate = true;
  };
  draw();
  void document.fonts?.load(`italic 800 92px "Barlow Condensed"`).then(draw, () => undefined);
  return texture;
}

/** A floodlight head: rows of bright lamps. */
export function floodlightTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 128);
  ctx.fillStyle = "#1b1f26";
  ctx.fillRect(0, 0, 256, 128);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      const gradient = ctx.createRadialGradient(18 + x * 31, 18 + y * 31, 1, 18 + x * 31, 18 + y * 31, 13);
      gradient.addColorStop(0, "#ffffff");
      gradient.addColorStop(0.6, "#fff6d8");
      gradient.addColorStop(1, "rgba(255,240,200,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(4 + x * 31, 4 + y * 31, 28, 28);
    }
  }
  return toTexture(c);
}

/** A soft round blob, for dust puffs and flashes. */
export function softDotTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.55)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c);
}

export interface ScreenInfo {
  score: string;
  overs: string;
  thisOver: string[];
  event?: string;
}

/** The stadium's big screen. Returns the texture and a function to redraw it. */
export function screenTexture(): { texture: THREE.CanvasTexture; draw(info: ScreenInfo): void } {
  const [c, ctx] = canvas(1024, 576);
  const texture = toTexture(c);
  const draw = (info: ScreenInfo) => {
    const bg = ctx.createLinearGradient(0, 0, 0, 576);
    bg.addColorStop(0, "#0d2238");
    bg.addColorStop(1, "#06111d");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1024, 576);
    ctx.fillStyle = "#e8c547";
    ctx.fillRect(0, 0, 1024, 14);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#8fb3d6";
    ctx.font = `700 54px ${AD_FONT}`;
    ctx.fillText("PHONE BAT CRICKET", 48, 90);
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 210px ${AD_FONT}`;
    ctx.fillText(info.score, 48, 300);
    ctx.fillStyle = "#c9d9ea";
    ctx.font = `600 64px ${AD_FONT}`;
    ctx.fillText(`OVERS ${info.overs}`, 52, 380);
    info.thisOver.forEach((ball, i) => {
      const x = 76 + i * 92;
      ctx.fillStyle = ball === "W" ? "#e2483a" : ball === "4" || ball === "6" ? "#e8c547" : "#24405e";
      ctx.beginPath();
      ctx.arc(x, 470, 38, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ball === "4" || ball === "6" ? "#1a1503" : "#ffffff";
      ctx.font = `800 48px ${AD_FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(ball, x, 487);
      ctx.textAlign = "left";
    });
    if (info.event) {
      ctx.fillStyle = "#e8c547";
      ctx.font = `italic 900 150px ${AD_FONT}`;
      ctx.textAlign = "right";
      ctx.fillText(info.event, 990, 300, 520);
    }
    texture.needsUpdate = true;
  };
  return { texture, draw };
}
