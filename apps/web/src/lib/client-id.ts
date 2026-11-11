let fallbackSequence = 0;

/** UI row identities and request idempotency keys only; never authentication secrets. */
export function createClientId(): string {
  const browserCrypto = globalThis.crypto;
  if (typeof browserCrypto?.randomUUID === "function") return browserCrypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof browserCrypto?.getRandomValues === "function") {
    // getRandomValues remains available on the course's HTTP IP deployment.
    browserCrypto.getRandomValues(bytes);
  } else {
    // Older/restricted browsers still need stable local identities. The server
    // creates authoritative record IDs and enforces authorization separately.
    const local = `${Date.now().toString(16).padStart(12, "0").slice(-12)}${(++fallbackSequence).toString(16).padStart(8, "0").slice(-8)}`;
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = index < 10 ? Number.parseInt(local.slice(index * 2, index * 2 + 2), 16) : Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
