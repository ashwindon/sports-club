// Local PeerJS signaling server. Phones and the game only use it to find each
// other; once WebRTC connects, motion data flows directly between them.
// Vite proxies https://<host>:5173/peerjs to this port (see vite.config.ts).
import { PeerServer } from "peer";

const port = 9000;

PeerServer({ port, path: "/peerjs", proxied: true }, () => {
  console.log(`PeerJS signaling server listening on http://localhost:${port}/peerjs`);
});
