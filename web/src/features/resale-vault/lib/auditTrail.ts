/**
 * Local audit trail.
 *
 * An append-only local log of vault activity (key lifecycle events, report
 * signing/export/import/verification). Purely local bookkeeping — it is
 * NOT part of the cryptographic proof chain and is never embedded in a
 * signed report. It exists so a user can review "what did this vault do"
 * over time.
 *
 * Same persistence strategy as `signingKeyRepository.ts`: mirrored to
 * IndexedDB when available, otherwise held in an in-memory array for the
 * lifetime of the tab. This module intentionally does NOT re-probe
 * structured-clone support itself — plain JSON audit rows never contain a
 * CryptoKey, so a plain `isIndexedDbAvailable()` check is sufficient here
 * (unlike the CryptoKey-specific probe in `signingKeyRepository.ts`).
 */
import { isIndexedDbAvailable, openVaultDb, idbPut, idbGetAll, STORE_AUDIT_LOG } from './vaultDb';
import type { AuditAction, AuditEntry } from './types';

const MAX_ENTRIES = 500;

let memoryLog: AuditEntry[] = [];
let hydrated = false;

function newEntryId(): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '');
  return `audit_${b64}`;
}

async function hydrateIfNeeded(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  if (!isIndexedDbAvailable()) return;
  try {
    const db = await openVaultDb();
    const rows = await idbGetAll<AuditEntry>(db, STORE_AUDIT_LOG);
    db.close();
    memoryLog = rows.sort((a, b) => a.ts.localeCompare(b.ts));
  } catch {
    // Best-effort only — an empty local log is a safe, honest starting
    // state if hydration fails; it never blocks core vault functionality.
  }
}

async function persist(entry: AuditEntry): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  try {
    const db = await openVaultDb();
    await idbPut<AuditEntry>(db, STORE_AUDIT_LOG, entry);
    db.close();
  } catch {
    // Non-fatal: the in-memory log already has the entry for this session.
  }
}

/** Appends a new audit entry. Never throws — logging failures must not block the underlying vault action. */
export async function recordAuditEvent(action: AuditAction, detail: string): Promise<AuditEntry> {
  await hydrateIfNeeded();
  const entry: AuditEntry = { id: newEntryId(), ts: new Date().toISOString(), action, detail };
  memoryLog = [...memoryLog, entry].slice(-MAX_ENTRIES);
  await persist(entry);
  return entry;
}

/**
 * Returns all audit entries, newest first. Reverses insertion order before
 * the (stable) sort so that entries created within the same millisecond —
 * common for near-instant synchronous actions — still come out in true
 * most-recent-first order instead of an arbitrary tie order.
 */
export async function listAuditEvents(): Promise<AuditEntry[]> {
  await hydrateIfNeeded();
  return [...memoryLog].reverse().sort((a, b) => b.ts.localeCompare(a.ts));
}

/** Test-only: clears in-memory audit state so tests start from a clean slate. */
export function __resetAuditTrailForTests(): void {
  memoryLog = [];
  hydrated = false;
}
