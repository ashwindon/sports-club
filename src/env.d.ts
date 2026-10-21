/// <reference types="vite/client" />

/** Filled in by vite.config.ts: this machine's LAN IPv4 addresses, best guess first. */
declare const __LAN_ADDRESSES__: string[];

interface ImportMetaEnv {
  /** "public" uses PeerJS's hosted signaling server instead of our local one. */
  readonly VITE_PEER_SERVER?: "local" | "public";
}
