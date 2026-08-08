export function toLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const value = new Date(iso);
  if (!Number.isFinite(value.getTime())) return '';
  const offsetMs = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function toISOStringOrNull(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function optionalPositiveNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function optionalPositiveInteger(value: string): number | null {
  const parsed = optionalPositiveNumber(value);
  return parsed != null && Number.isInteger(parsed) ? parsed : null;
}
