import QRCode from "qrcode";

const HOST_STORAGE_KEY = "sports-club-controller-host";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Addresses a phone could use to reach this page. Opened as localhost, the
 * page itself is unreachable from a phone, so offer this machine's LAN
 * addresses instead (Vite reads them at startup).
 */
function candidateHosts(): string[] {
  if (!LOOPBACK.has(location.hostname) || __LAN_ADDRESSES__.length === 0) {
    return [location.hostname];
  }
  return __LAN_ADDRESSES__;
}

function readStoredHost(): string | null {
  try {
    return localStorage.getItem(HOST_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeHost(host: string): void {
  try {
    localStorage.setItem(HOST_STORAGE_KEY, host);
  } catch {
    // Not remembering the choice is fine.
  }
}

/** Shows the QR code and link a phone opens to join, and keeps them current. */
export function createPairing(elements: {
  qr: HTMLCanvasElement;
  link: HTMLAnchorElement;
  hostField: HTMLElement;
  hostSelect: HTMLSelectElement;
}): { setCode(code: string): void } {
  const hosts = candidateHosts();
  const stored = readStoredHost();
  let host = stored && hosts.includes(stored) ? stored : hosts[0];
  let code: string | undefined;

  elements.hostField.hidden = hosts.length < 2;
  elements.hostSelect.replaceChildren(
    ...hosts.map((candidate) => new Option(candidate, candidate, false, candidate === host)),
  );

  const render = () => {
    if (!code) return;
    const url = new URL(`${import.meta.env.BASE_URL}controller.html`, location.href);
    url.hostname = host;
    url.hash = code;
    elements.link.href = elements.link.textContent = url.href;
    void QRCode.toCanvas(elements.qr, url.href, { width: 220, margin: 1 });
  };

  elements.hostSelect.addEventListener("change", () => {
    host = elements.hostSelect.value;
    storeHost(host);
    render();
  });

  return {
    setCode(next) {
      code = next;
      render();
    },
  };
}
