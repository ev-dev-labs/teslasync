export const VISUAL_PARITY_STORAGE_KEY =
  'teslasync:native:visual-parity-shell:v0002';

interface VisualParityStorage {
  getItem(key: string): string | null;
}

function defaultStorage(): VisualParityStorage | undefined {
  return (globalThis as { localStorage?: VisualParityStorage }).localStorage;
}

export function isVisualParityShellEnabled(
  storage: VisualParityStorage | undefined = defaultStorage(),
): boolean {
  if (!storage) {
    return false;
  }

  try {
    return storage.getItem(VISUAL_PARITY_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}
