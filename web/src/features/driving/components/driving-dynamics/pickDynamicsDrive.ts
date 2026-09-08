import type { Drive } from '@/types/driving';

export function isOpenDrive(drive: Drive | null | undefined): boolean {
  if (!drive) return false;
  return drive.live === true || drive.endTs == null || drive.endTs === '';
}

/** Prefer the URL drive, else an in-progress session, else the newest start. */
export function pickDynamicsDrive(
  drives: Drive[],
  requestedId?: string | null,
): Drive | null {
  const items = drives ?? [];
  if (items.length === 0) return null;
  const wanted = requestedId?.trim();
  if (wanted) {
    const match = items.find((drive) => String(drive.id) === wanted);
    if (match) return match;
  }
  const open = items.find((drive) => isOpenDrive(drive));
  if (open) return open;
  return [...items].sort((a, b) => (b.startTs ?? '').localeCompare(a.startTs ?? ''))[0] ?? null;
}

export function mergeOpenDrives(rangeDrives: Drive[], latestDrives: Drive[]): Drive[] {
  const byId = new Map<number, Drive>();
  for (const drive of latestDrives ?? []) {
    if (isOpenDrive(drive)) byId.set(drive.id, drive);
  }
  for (const drive of rangeDrives ?? []) {
    byId.set(drive.id, drive);
  }
  return [...byId.values()].sort((a, b) => (b.startTs ?? '').localeCompare(a.startTs ?? ''));
}

/** Inclusive drive window; +1s so the API's exclusive RFC3339 end keeps the last sample. */
export function motorWindowForDrive(
  drive: Drive,
  now: Date = new Date(),
): { start: string; end: string } | null {
  const start = drive.startTs;
  if (!start) return null;
  const rawEnd = isOpenDrive(drive) || !drive.endTs ? now.toISOString() : drive.endTs;
  const endMs = Date.parse(rawEnd);
  if (!Number.isFinite(endMs)) return null;
  return { start, end: new Date(endMs + 1000).toISOString() };
}
