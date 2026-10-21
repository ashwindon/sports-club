// ControllerLink over WebRTC data channels: PeerJS for the connection,
// webrtc-remote-control for pairing a game with phones and for reconnecting
// after either page reloads.
import { Peer as PeerJs } from "peerjs";
import type { PeerOptions } from "peerjs";
import {
  ID_TAKEN_MAX_ATTEMPTS,
  onIdTakenBeforeOpen,
  reconnectDelay,
} from "@webrtc-remote-control/core";
import prepareMaster, {
  prepareUtils as prepareMasterUtils,
} from "@webrtc-remote-control/core/master";
import type { WrcMaster } from "@webrtc-remote-control/core/master";
import prepareRemote, {
  prepareUtils as prepareRemoteUtils,
} from "@webrtc-remote-control/core/remote";
import type { WrcRemote } from "@webrtc-remote-control/core/remote";

import { Emitter } from "../shared/emitter";
import type {
  ControllerLinkClient,
  ControllerLinkHost,
  ControllerLinkStatus,
} from "./controller-link";
import { isControllerMessage, isGameMessage } from "./protocol";
import type { ControllerMessage, GameMessage } from "./protocol";

// peerjs reads an undefined id as "allocate me one", but its declarations
// leave that overload out (see the webrtc-remote-control README).
const Peer = PeerJs as typeof PeerJs & {
  new (id: string | undefined, options?: PeerOptions): PeerJs;
};

function peerOptions(): PeerOptions {
  // STUN only: on the same Wi-Fi the phone and the game connect on local
  // addresses. Networks that block direct connections will need a TURN
  // server here before this goes public.
  const config: RTCConfiguration = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  };
  if (import.meta.env.VITE_PEER_SERVER === "public") {
    return { host: "0.peerjs.com", port: 443, path: "/", secure: true, config };
  }
  const secure = location.protocol === "https:";
  return {
    host: location.hostname,
    port: Number(location.port) || (secure ? 443 : 80),
    path: "/peerjs",
    secure,
    config,
  };
}

/**
 * Calls `onPeer` with a new Peer, and again with a replacement whenever the
 * signaling server refuses the id this tab kept from before a reload (it can
 * still hold the old socket for a while). After a few refusals it gives up on
 * the old id and takes a fresh one.
 */
function startPeer(
  getPeerId: () => string | undefined,
  onPeer: (peer: PeerJs) => void,
): void {
  let attempt = 0;
  const start = () => {
    const fresh = attempt >= ID_TAKEN_MAX_ATTEMPTS;
    const peer = new Peer(fresh ? undefined : getPeerId(), peerOptions());
    if (!fresh) {
      const stop = onIdTakenBeforeOpen(peer, () => {
        stop();
        setTimeout(start, reconnectDelay(attempt));
        attempt += 1;
      });
    }
    onPeer(peer);
  };
  start();
}

export function hostControllerLink(): ControllerLinkHost {
  const { bindConnection, getPeerId, humanizeError } = prepareMaster(
    prepareMasterUtils({ sessionStorageKey: "sports-club-game-peer-id" }),
  );
  const codes = new Emitter<[string]>();
  const connects = new Emitter<[string]>();
  const disconnects = new Emitter<[string]>();
  const messages = new Emitter<[string, ControllerMessage]>();
  const errors = new Emitter<[string]>();
  let peer: PeerJs | undefined;
  let master: WrcMaster | undefined;
  let code: string | undefined;

  startPeer(getPeerId, (next) => {
    peer = next;
    next.on("open", (id) => {
      code = id;
      codes.emit(id);
    });
    next.on("error", (error) => {
      // Handled by startPeer, which retries with a new Peer.
      if (error.type === "unavailable-id") return;
      errors.emit(humanizeError(error));
    });
    void bindConnection(next).then((api) => {
      master = api;
      api.on("remote.connect", ({ id }) => connects.emit(id));
      api.on("remote.disconnect", ({ id }) => disconnects.emit(id));
      api.on("data", ({ id }, data) => {
        if (isControllerMessage(data)) messages.emit(id, data);
      });
    });
  });

  return {
    onCode(listener) {
      if (code) listener(code);
      return codes.on(listener);
    },
    onConnect: (listener) => connects.on(listener),
    onDisconnect: (listener) => disconnects.on(listener),
    onMessage: (listener) => messages.on(listener),
    onError: (listener) => errors.on(listener),
    send(controllerId: string, message: GameMessage) {
      void master?.sendTo(controllerId, message);
    },
    close() {
      peer?.destroy();
    },
  };
}

export function joinControllerLink(code: string): ControllerLinkClient {
  const {
    bindConnection,
    getPeerId,
    humanizeError,
    isIgnorableError,
    reconnectNotice,
  } = prepareRemote(
    prepareRemoteUtils({ sessionStorageKey: "sports-club-controller-peer-id" }),
  );
  const statuses = new Emitter<[ControllerLinkStatus]>();
  const messages = new Emitter<[GameMessage]>();
  let status: ControllerLinkStatus = { state: "connecting" };
  let peer: PeerJs | undefined;
  let remote: WrcRemote | undefined;

  const setStatus = (next: ControllerLinkStatus) => {
    status = next;
    statuses.emit(next);
  };

  startPeer(getPeerId, (next) => {
    peer = next;
    next.on("error", (error) => {
      // Either provoked by the library's own reconnection loop, or handled
      // by startPeer retrying with a new Peer.
      if (isIgnorableError(error) || error.type === "unavailable-id") return;
      setStatus({ state: "failed", error: humanizeError(error) });
    });
    bindConnection(next, code).then(
      (api) => {
        remote = api;
        setStatus({ state: "connected" });
        api.on("remote.reconnecting", (payload) =>
          setStatus({ state: "reconnecting", notice: reconnectNotice(payload) }),
        );
        api.on("remote.reconnect", () => setStatus({ state: "connected" }));
        api.on("data", (_, data) => {
          if (isGameMessage(data)) messages.emit(data);
        });
      },
      (error: unknown) =>
        setStatus({ state: "failed", error: humanizeError(error as Error) }),
    );
  });

  return {
    get status() {
      return status;
    },
    onStatus: (listener) => statuses.on(listener),
    onMessage: (listener) => messages.on(listener),
    send(message: ControllerMessage) {
      if (status.state !== "connected") return;
      try {
        remote?.send(message);
      } catch {
        // The channel closed under us; the reconnection loop takes it from here.
      }
    },
    close() {
      peer?.destroy();
    },
  };
}
