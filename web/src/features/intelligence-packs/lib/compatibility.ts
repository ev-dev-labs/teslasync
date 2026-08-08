/**
 * App-version / pack-version compatibility resolver.
 *
 * Uses simple `major.minor.patch` semver comparison (no pre-release/build
 * metadata — manifests are restricted to that shape by
 * `manifestValidator.ts`'s `SEMVER_RE`). A pack declares
 * `appCompatibility.minAppVersion` (required) and `.maxAppVersion`
 * (optional inclusive upper bound, `null` = unbounded).
 */

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemver(input: string): Semver | null {
  const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(input.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** -1 if a<b, 0 if equal, 1 if a>b. */
export function compareSemver(a: Semver, b: Semver): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/**
 * Resolves the running app version. Build tooling stamps
 * `import.meta.env.VITE_APP_VERSION` from `package.json` (see
 * `VersionSegment.tsx` for the same pattern elsewhere in the app); local
 * `vite dev` without that env var, or an unparsable value, falls back to
 * the literal `'dev'`.
 */
export function currentAppVersion(): string {
  return import.meta.env.VITE_APP_VERSION || 'dev';
}

export interface CompatibilityResult {
  compatible: boolean;
  reason: string;
}

export interface PackAppCompatibilityInput {
  minAppVersion: string;
  maxAppVersion: string | null;
}

/**
 * Checks whether `appVersion` satisfies a pack's declared compatibility
 * range. An unparsable `appVersion` (e.g. the `'dev'` fallback above, or a
 * `vite dev` run without `VITE_APP_VERSION`) is treated as
 * "compatibility unknown" — `compatible: true` with an explicit
 * `reason`, rather than a hard failure that would block local development.
 */
export function isAppVersionCompatible(compat: PackAppCompatibilityInput, appVersion: string = currentAppVersion()): CompatibilityResult {
  const app = parseSemver(appVersion);
  if (!app) {
    return { compatible: true, reason: `App version "${appVersion}" is not a parsable semver (dev build) — compatibility check skipped.` };
  }
  const min = parseSemver(compat.minAppVersion);
  if (!min) {
    return { compatible: false, reason: `Pack declares an invalid minAppVersion "${compat.minAppVersion}".` };
  }
  if (compareSemver(app, min) < 0) {
    return { compatible: false, reason: `Requires app version >= ${compat.minAppVersion} (running ${appVersion}).` };
  }
  if (compat.maxAppVersion != null) {
    const max = parseSemver(compat.maxAppVersion);
    if (!max) {
      return { compatible: false, reason: `Pack declares an invalid maxAppVersion "${compat.maxAppVersion}".` };
    }
    if (compareSemver(app, max) > 0) {
      return { compatible: false, reason: `Requires app version <= ${compat.maxAppVersion} (running ${appVersion}).` };
    }
  }
  return { compatible: true, reason: `Compatible with app version ${appVersion}.` };
}
