/**
 * Signing key repository.
 *
 * Owns generation, persistence, rotation, and revocation of the browser's
 * local ECDSA P-256 signing key(s). The private key is generated
 * `extractable: false` and is NEVER exported, logged, or exposed outside
 * this module — only the public JWK and opaque `CryptoKey` handles leave
 * it (and the `CryptoKey` handle only goes to `reportSigner.ts`, in the
 * same trust boundary).
 *
 * Persistence strategy:
 *   - On first use, probe whether this browser can durably store a
 *     non-extractable `CryptoKey` in IndexedDB (some older engines throw
 *     `DataCloneError` structured-cloning a CryptoKey). See
 *     `detectKeyPersistenceCapability()`.
 *   - When supported, every key pair + the key registry are mirrored to
 *     IndexedDB so they survive a reload.
 *   - When NOT supported (no IndexedDB, or the probe fails), everything
 *     lives in an in-memory module cache only. This is the explicit
 *     "secure session" limitation the spec requires: the key works for the
 *     lifetime of the tab, but a reload loses it — callers MUST surface
 *     `capability.reason` to the user rather than pretending persistence
 *     happened.
 */
import { requireSubtleCrypto } from './cryptoAvailability';
import {
  isIndexedDbAvailable,
  openVaultDb,
  idbPut,
  idbGet,
  idbGetAll,
  idbDelete,
  STORE_SIGNING_KEYS,
  STORE_KEY_REGISTRY,
} from './vaultDb';
import type { EcPublicJwk, SigningKeyRecord, VaultKeyCapability } from './types';

const EC_PARAMS: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };

interface StoredKeyPairRow {
  key_id: string;
  private_key: CryptoKey;
  public_key: CryptoKey;
}

/** In-memory L1 cache of live CryptoKeyPair handles, used regardless of IndexedDB support. */
const memoryKeyPairs = new Map<string, { privateKey: CryptoKey; publicKey: CryptoKey }>();
/** In-memory registry cache, source of truth when IndexedDB is unsupported. */
let memoryRegistry: SigningKeyRecord[] = [];
let hydrated = false;
let capabilityCache: VaultKeyCapability | null = null;

function newKeyId(): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '');
  return `key_${b64}`;
}

async function generateEcdsaKeyPair(): Promise<CryptoKeyPair> {
  const subtle = requireSubtleCrypto();
  // `extractable: false` applies only to the private half of the pair —
  // per the Web Crypto spec, the public key of a generated pair is always
  // extractable regardless of this flag, which is exactly what we need:
  // the private key can never be exported, while the public key can be
  // exported as JWK and embedded in every signed report.
  return (await subtle.generateKey(EC_PARAMS, false, ['sign', 'verify'])) as CryptoKeyPair;
}

async function exportPublicJwk(publicKey: CryptoKey): Promise<EcPublicJwk> {
  const subtle = requireSubtleCrypto();
  const jwk = await subtle.exportKey('jwk', publicKey);
  return jwk as EcPublicJwk;
}

/**
 * Attempts a full round-trip: generate a throwaway key pair, store it in
 * IndexedDB, read it back, and confirm what comes back is still a usable
 * `CryptoKey`. This is the only reliable way to detect the structured-clone
 * support this feature depends on — feature-sniffing alone (e.g. "does
 * `indexedDB` exist") is not sufficient because some engines expose the API
 * but fail specifically on non-extractable `CryptoKey` values.
 */
async function probeIndexedDbCryptoKeyPersistence(): Promise<boolean> {
  if (!isIndexedDbAvailable()) return false;
  const probeId = `__probe__${Date.now()}_${Math.random().toString(36).slice(2)}`;
  try {
    const pair = await generateEcdsaKeyPair();
    const db = await openVaultDb();
    try {
      await idbPut<StoredKeyPairRow>(db, STORE_SIGNING_KEYS, {
        key_id: probeId,
        private_key: pair.privateKey,
        public_key: pair.publicKey,
      });
      const readBack = await idbGet<StoredKeyPairRow>(db, STORE_SIGNING_KEYS, probeId);
      return !!readBack && typeof readBack.private_key === 'object' && readBack.private_key !== null;
    } finally {
      await idbDelete(db, STORE_SIGNING_KEYS, probeId).catch(() => undefined);
      db.close();
    }
  } catch {
    return false;
  }
}

/** Detects (and memoizes) whether this browser can durably persist the signing key. */
export async function detectKeyPersistenceCapability(): Promise<VaultKeyCapability> {
  if (capabilityCache) return capabilityCache;
  if (!isIndexedDbAvailable()) {
    capabilityCache = {
      supported: false,
      reason:
        'IndexedDB is not available in this browser/context. Your signing key will only ' +
        'exist for this browser session and will be lost when the tab is closed or reloaded.',
    };
    return capabilityCache;
  }
  try {
    const ok = await probeIndexedDbCryptoKeyPersistence();
    capabilityCache = ok
      ? { supported: true, reason: null }
      : {
          supported: false,
          reason:
            'This browser could not durably store your signing key in IndexedDB (the ' +
            'structured-clone of a non-extractable CryptoKey failed). Your signing key will ' +
            'only exist for this browser session and will be lost on reload.',
        };
  } catch (err) {
    capabilityCache = {
      supported: false,
      reason: `IndexedDB capability probe failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return capabilityCache;
}

/** Test-only: clears the memoized capability so a test can re-probe under different global stubs. */
export function __resetKeyRepositoryForTests(): void {
  capabilityCache = null;
  memoryKeyPairs.clear();
  memoryRegistry = [];
  hydrated = false;
}

async function hydrateFromIndexedDbIfNeeded(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const capability = await detectKeyPersistenceCapability();
  if (!capability.supported) return;
  try {
    const db = await openVaultDb();
    const registryRows = await idbGetAll<SigningKeyRecord>(db, STORE_KEY_REGISTRY);
    const keyRows = await idbGetAll<StoredKeyPairRow>(db, STORE_SIGNING_KEYS);
    db.close();
    memoryRegistry = registryRows.sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const row of keyRows) {
      if (row.key_id.startsWith('__probe__')) continue;
      memoryKeyPairs.set(row.key_id, { privateKey: row.private_key, publicKey: row.public_key });
    }
  } catch {
    // Best-effort hydration only — if it fails, the vault behaves as if
    // this were a fresh session (the user can generate a new key).
  }
}

async function persistRegistryEntry(record: SigningKeyRecord): Promise<void> {
  const capability = await detectKeyPersistenceCapability();
  if (!capability.supported) return;
  try {
    const db = await openVaultDb();
    await idbPut<SigningKeyRecord>(db, STORE_KEY_REGISTRY, record);
    db.close();
  } catch {
    // Non-fatal: the in-memory registry (source of truth for this session)
    // already has the record; a failed mirror write just means the next
    // reload starts fresh, same as the "unsupported" case.
  }
}

async function persistKeyPair(keyId: string, pair: { privateKey: CryptoKey; publicKey: CryptoKey }): Promise<boolean> {
  const capability = await detectKeyPersistenceCapability();
  if (!capability.supported) return false;
  try {
    const db = await openVaultDb();
    await idbPut<StoredKeyPairRow>(db, STORE_SIGNING_KEYS, {
      key_id: keyId,
      private_key: pair.privateKey,
      public_key: pair.publicKey,
    });
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** Generates a brand-new signing key, makes it the active key, and returns its public record. */
export async function generateSigningKey(): Promise<SigningKeyRecord> {
  await hydrateFromIndexedDbIfNeeded();
  const pair = await generateEcdsaKeyPair();
  const keyId = newKeyId();
  const publicJwk = await exportPublicJwk(pair.publicKey);
  memoryKeyPairs.set(keyId, { privateKey: pair.privateKey, publicKey: pair.publicKey });
  const persisted = await persistKeyPair(keyId, pair);

  const record: SigningKeyRecord = {
    key_id: keyId,
    public_jwk: publicJwk,
    created_at: new Date().toISOString(),
    revoked_at: null,
    revoked_reason: null,
    rotated_from: null,
    persisted,
  };
  memoryRegistry = [...memoryRegistry, record];
  await persistRegistryEntry(record);
  return record;
}

/**
 * Lists all known keys (metadata only — no private key material), newest
 * first. Reverses insertion order before the (stable) sort so that keys
 * created within the same millisecond still come out in true
 * most-recent-first order instead of an arbitrary tie order.
 */
export async function listSigningKeys(): Promise<SigningKeyRecord[]> {
  await hydrateFromIndexedDbIfNeeded();
  return [...memoryRegistry].reverse().sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** The most recently created, non-revoked key — or null if none exists yet. */
export async function getActiveSigningKeyRecord(): Promise<SigningKeyRecord | null> {
  const keys = await listSigningKeys();
  return keys.find((k) => k.revoked_at === null) ?? null;
}

/**
 * Returns the live `CryptoKey` handle for signing. Returns null when the
 * key is known in the registry but its private material is not resident in
 * this session (e.g. persistence was unsupported and the tab reloaded) —
 * callers must treat that as "generate a new key", not throw a confusing
 * low-level error.
 */
export async function getPrivateKeyHandle(keyId: string): Promise<CryptoKey | null> {
  await hydrateFromIndexedDbIfNeeded();
  return memoryKeyPairs.get(keyId)?.privateKey ?? null;
}

async function markRevoked(keyId: string, reason: string): Promise<SigningKeyRecord | null> {
  await hydrateFromIndexedDbIfNeeded();
  const idx = memoryRegistry.findIndex((k) => k.key_id === keyId);
  if (idx === -1) return null;
  const updated: SigningKeyRecord = { ...memoryRegistry[idx]!, revoked_at: new Date().toISOString(), revoked_reason: reason };
  memoryRegistry = [...memoryRegistry.slice(0, idx), updated, ...memoryRegistry.slice(idx + 1)];
  await persistRegistryEntry(updated);
  return updated;
}

/** Revokes a key by id with an explicit reason. Revoked keys remain in the registry (and remain verifiable) but are no longer used for new signatures. */
export async function revokeSigningKey(keyId: string, reason: string): Promise<SigningKeyRecord | null> {
  return markRevoked(keyId, reason);
}

/**
 * Rotates the active key: revokes it (reason 'rotated') and generates a
 * fresh key linked via `rotated_from`. Reports already signed with the old
 * key remain independently verifiable (their signature embeds the public
 * JWK inline) — rotation only changes which key is used for FUTURE
 * signatures.
 */
export async function rotateSigningKey(reason = 'rotated'): Promise<SigningKeyRecord> {
  const current = await getActiveSigningKeyRecord();
  if (current) {
    await markRevoked(current.key_id, reason);
  }
  const next = await generateSigningKey();
  if (!current) return next;
  const linked: SigningKeyRecord = { ...next, rotated_from: current.key_id };
  const idx = memoryRegistry.findIndex((k) => k.key_id === next.key_id);
  if (idx !== -1) memoryRegistry = [...memoryRegistry.slice(0, idx), linked, ...memoryRegistry.slice(idx + 1)];
  await persistRegistryEntry(linked);
  return linked;
}
