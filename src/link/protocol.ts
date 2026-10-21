/** Quaternion as [w, x, y, z]. */
export type Quat = [number, number, number, number];
export type Vec3 = [number, number, number];

/** Where the phone's motion comes from. */
export type MotionSourceKind = "fused" | "browser" | "simulator";

/** Phone → game. */
export type ControllerMessage =
  | { type: "hello"; source: MotionSourceKind; userAgent: string }
  | {
      type: "motion";
      seq: number;
      /** When the sensors were read, on the phone's clock (performance.now() ms). */
      t: number;
      /** Phone orientation: rotates phone axes into an earth frame with z up. Heading is arbitrary. */
      q: Quat;
      /** Angular velocity in the phone's own axes, rad/s. */
      w: Vec3;
    }
  | { type: "calibrate" }
  | { type: "pong"; id: number; t: number };

/** Game → phone. */
export type GameMessage =
  | { type: "ping"; id: number }
  | { type: "buzz"; ms: number };

const CONTROLLER_TYPES = new Set(["hello", "motion", "calibrate", "pong"]);
const GAME_TYPES = new Set(["ping", "buzz"]);

function hasType(data: unknown, types: Set<string>): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    types.has((data as { type?: unknown }).type as string)
  );
}

export function isControllerMessage(data: unknown): data is ControllerMessage {
  return hasType(data, CONTROLLER_TYPES);
}

export function isGameMessage(data: unknown): data is GameMessage {
  return hasType(data, GAME_TYPES);
}
