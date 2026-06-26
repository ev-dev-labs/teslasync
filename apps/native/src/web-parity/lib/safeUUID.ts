/* eslint-disable no-bitwise */
// Native parity port of web/src/lib/safeUUID.ts.
//
// Generates a v4 UUID without depending on a secure-context `crypto.randomUUID`.
// The web rationale (LAN-IP / plain-HTTP contexts where browsers null out
// `crypto.randomUUID`) does not apply on React Native, but the same defensive
// ladder is preserved so TAB_ID generation never throws: prefer
// `crypto.randomUUID`, fall back to `crypto.getRandomValues`, and finally to
// `Math.random` when no global `crypto` exists (the common Hermes case).
//
// The `Math.random` branch is NOT cryptographically secure and must not be used
// for secrets — but for uniqueness-only IDs (the broadcast TAB_ID, list keys) it
// is acceptable, matching the web contract.
//
// Web -> native: the bare `crypto` global reference is read through `globalThis`
// (with a narrow optional type) because the React Native TypeScript lib set does
// not declare the DOM `crypto`. Behaviour is otherwise identical.

interface MaybeCrypto {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

function getCrypto(): MaybeCrypto | undefined {
  return (globalThis as { crypto?: MaybeCrypto }).crypto;
}

export function safeRandomUUID(): string {
  try {
    const c = getCrypto();
    if (c && typeof c.randomUUID === 'function') {
      return c.randomUUID();
    }
  } catch {
    /* locked-down global — drop through to the constructed-UUID branch */
  }

  const bytes = new Uint8Array(16);
  try {
    const c = getCrypto();
    if (c && typeof c.getRandomValues === 'function') {
      c.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
  } catch {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  /* RFC 4122 §4.4: set the version field to 0100xxxx (v4) in byte 6
   * and the variant field to 10xxxxxx in byte 8. */
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    hex.push(bytes[i].toString(16).padStart(2, '0'));
  }
  return (
    `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-` +
    `${hex[4]}${hex[5]}-` +
    `${hex[6]}${hex[7]}-` +
    `${hex[8]}${hex[9]}-` +
    `${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
  );
}
