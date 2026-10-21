// The game and the phone only ever talk through these two interfaces, so the
// transport underneath (PeerJS today; Trystero, a WebSocket relay or an
// AirConsole build later) can be swapped without touching either page.
import type { Unsubscribe } from "../shared/emitter";
import type { ControllerMessage, GameMessage } from "./protocol";

/** The game screen's end. Any number of phones can join one game. */
export interface ControllerLinkHost {
  /** Fires with the code a phone needs to join, and again if it ever changes. */
  onCode(listener: (code: string) => void): Unsubscribe;
  onConnect(listener: (controllerId: string) => void): Unsubscribe;
  onDisconnect(listener: (controllerId: string) => void): Unsubscribe;
  onMessage(
    listener: (controllerId: string, message: ControllerMessage) => void,
  ): Unsubscribe;
  onError(listener: (message: string) => void): Unsubscribe;
  send(controllerId: string, message: GameMessage): void;
  close(): void;
}

export type ControllerLinkStatus =
  | { state: "connecting" }
  | { state: "connected" }
  | { state: "reconnecting"; notice: string }
  | { state: "failed"; error: string };

/** The phone's end. */
export interface ControllerLinkClient {
  readonly status: ControllerLinkStatus;
  onStatus(listener: (status: ControllerLinkStatus) => void): Unsubscribe;
  onMessage(listener: (message: GameMessage) => void): Unsubscribe;
  /** Dropped while not connected: a stale motion sample is worse than none. */
  send(message: ControllerMessage): void;
  close(): void;
}
