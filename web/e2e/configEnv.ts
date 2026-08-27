import { existsSync } from 'node:fs';

export interface HarnessEnvironment {
  E2E_STORAGE_STATE?: string;
  E2E_SENSITIVE?: string;
}

export function resolveStorageState(
  environment: HarnessEnvironment,
  fileExists: (path: string) => boolean = existsSync,
): string | undefined {
  const candidate = environment.E2E_STORAGE_STATE?.trim();
  if (!candidate) return undefined;
  if (!fileExists(candidate)) {
    throw new Error(`E2E_STORAGE_STATE does not exist: ${candidate}`);
  }
  return candidate;
}

export function isSensitiveRun(environment: HarnessEnvironment): boolean {
  return environment.E2E_SENSITIVE === '1';
}
