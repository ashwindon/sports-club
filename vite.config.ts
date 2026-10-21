import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { createLogger, defineConfig } from "vite";

const PEER_SERVER_PORT = 9000;

/**
 * A phone that locks its screen or closes the tab drops its signaling socket,
 * and Vite's proxy logs that as a red stack trace. It's routine (the phone
 * reconnects), so leave it out rather than have it look like a crash.
 */
function quietLogger() {
  const logger = createLogger();
  const error = logger.error.bind(logger);
  logger.error = (msg, options) => {
    const code = (options?.error as NodeJS.ErrnoException | null | undefined)?.code;
    if (msg.includes("ws proxy") && code === "ECONNRESET") return;
    error(msg, options);
  };
  return logger;
}

/**
 * IPv4 addresses a phone on the same Wi-Fi could use to reach this machine,
 * most likely first. Windows lists virtual adapters (WSL, Hyper-V, VPNs) next
 * to the real one, so home-router ranges are sorted ahead of the rest.
 */
function lanAddresses(): string[] {
  const rank = (ip: string) =>
    ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : 2;
  return Object.values(networkInterfaces())
    .flat()
    .filter((net) => net && net.family === "IPv4" && !net.internal)
    .map((net) => net!.address)
    .sort((a, b) => rank(a) - rank(b));
}

export default defineConfig(({ command, mode }) => ({
  // Phones only expose motion sensors to secure pages, so the dev server is
  // HTTPS with a self-signed certificate (accept the warning once per device).
  // `--mode http` skips it, for desktop-only testing: localhost counts as
  // secure without HTTPS, but phones on the LAN get no sensors that way.
  plugins: mode === "http" ? [] : [basicSsl()],
  customLogger: quietLogger(),
  define: {
    // Only the dev server needs them: a deployed page is reached by its own address.
    __LAN_ADDRESSES__: JSON.stringify(command === "serve" ? lanAddresses() : []),
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      // The PeerJS signaling server runs as its own process (`npm run dev:peer`)
      // and is reached through this proxy, so the phone talks to one secure
      // origin instead of a second, plain-HTTP port it would refuse.
      "/peerjs": {
        target: `http://localhost:${PEER_SERVER_PORT}`,
        ws: true,
      },
    },
  },
  build: {
    // three.js alone is most of the game bundle.
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      input: {
        game: resolve(import.meta.dirname, "index.html"),
        controller: resolve(import.meta.dirname, "controller.html"),
      },
    },
  },
}));
