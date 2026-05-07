/**
 * Generates a v4 UUID even when `crypto.randomUUID` is unavailable.
 *
 * `crypto.randomUUID` is restricted to secure contexts (HTTPS or
 * literal `localhost`). When TeslaSync is accessed via a LAN IP
 * (e.g. http://192.168.1.42:3002) or a custom hostname over plain
 * HTTP, Chrome / Edge / Firefox make `crypto.randomUUID` undefined
 * even on the latest browser versions. `crypto.getRandomValues` IS
 * available in non-secure contexts (it has been since 2011), so we
 * use it to construct a v4 UUID per RFC 4122 ourselves.
 *
 * The `Math.random` branch is the absolute last resort, reached only
 * when `crypto` is missing entirely (e.g. a sandboxed iframe with the
 * Permissions Policy disabling Web Crypto). It is NOT cryptographically
 * secure and must not be used for secrets — but for uniqueness-only IDs
 * (tab IDs, list keys, devtools sample output) it is acceptable.
 */
export function safeRandomUUID(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* ITP / locked iframe — drop through to the constructed-UUID branch */
  }

  const bytes = new Uint8Array(16)
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes)
    } else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
    }
  } catch {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }

  /* RFC 4122 §4.4: set the version field to 0100xxxx (v4) in byte 6
   * and the variant field to 10xxxxxx in byte 8. */
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex: string[] = []
  for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'))
  return (
    `${hex[0]}${hex[1]}${hex[2]}${hex[3]}-` +
    `${hex[4]}${hex[5]}-` +
    `${hex[6]}${hex[7]}-` +
    `${hex[8]}${hex[9]}-` +
    `${hex[10]}${hex[11]}${hex[12]}${hex[13]}${hex[14]}${hex[15]}`
  )
}
