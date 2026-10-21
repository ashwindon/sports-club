import type { Pace } from "./bowling";

export type DifficultyName = "easy" | "intermediate" | "hard";

/** Hits judged by the swing's timing instead of the bat's exact path (see Match). */
export interface TimingHits {
  /** How early (ms before the ball reaches the bat) a swing's fastest moment can be and still connect. */
  earlyMs: number;
  /** How late it can be. */
  lateMs: number;
  /** Slowest swing (bat spin, °/s) that counts as a swing at all. */
  minSpinDeg: number;
  /** Ball speed off the bat for the slowest and fastest swings, m/s. */
  minSpeed: number;
  maxSpeed: number;
  /** Launch angle for a perfectly timed hit, degrees; earlier goes higher, later lower. */
  loftDeg: number;
}

/** Real bat–ball contact (the bat's path must meet the ball). */
export interface RealContact {
  /** The ball's radius for collisions; a real one is 0.036 m. */
  radius: number;
  /** A bat this many ms late still meets the ball where it was. */
  lateMs: number;
  /** Multiplier on the ball's speed off the bat. */
  power: number;
  /** Extra launch angle, degrees. */
  loftDeg: number;
}

export interface Difficulty {
  label: string;
  /** Told to the player when they pick it. */
  blurb: string;
  /** The pace picked along with it (it can still be changed). */
  pace: Pace;
  contact?: RealContact;
  timing?: TimingHits;
  /** Fielders' catching, 1 = normal. */
  catching: number;
  /** How often each length is bowled: yorker, full, good length, short. */
  lengths: [number, number, number, number];
}

export const DIFFICULTIES: Record<DifficultyName, Difficulty> = {
  // Like Wii Sports: swing in time and you hit it. Swing speed is power,
  // timing is height (a touch early goes up) and, with the bat face, direction.
  easy: {
    label: "Easy",
    blurb: "Swing in time and you'll hit it. Swing hard for sixes.",
    pace: "slow",
    timing: { earlyMs: 170, lateMs: 70, minSpinDeg: 220, minSpeed: 30, maxSpeed: 44, loftDeg: 18 },
    catching: 0.45,
    lengths: [0.03, 0.42, 0.48, 0.07],
  },
  // The bat really has to meet the ball, but it's a big bat with extra punch;
  // a well-timed swing that just misses still gets something.
  intermediate: {
    label: "Intermediate",
    blurb: "Your bat has to meet the ball, but it's forgiving and hits hard.",
    pace: "medium",
    contact: { radius: 0.1, lateMs: 50, power: 1.25, loftDeg: 6 },
    timing: { earlyMs: 80, lateMs: 40, minSpinDeg: 450, minSpeed: 26, maxSpeed: 38, loftDeg: 10 },
    catching: 0.8,
    lengths: [0.08, 0.32, 0.45, 0.15],
  },
  hard: {
    label: "Hard",
    blurb: "A real-size ball and real physics. No help.",
    pace: "fast",
    contact: { radius: 0.036, lateMs: 0, power: 1, loftDeg: 0 },
    catching: 1,
    lengths: [0.1, 0.3, 0.45, 0.15],
  },
};
