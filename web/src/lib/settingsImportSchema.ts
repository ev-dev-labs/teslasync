// Settings export/import shared schema.
//
// Mirrors the Go `database.SettingsBundle` wire shape so the SPA can
// validate uploaded files BEFORE shipping them to the import endpoint
// (early rejection avoids round-tripping a corrupt JSON for a 400).
//
// Field names are snake_case to match the Go JSON tags. Sensitive
// sections (Tesla refresh tokens, API keys, TOTP secrets, password
// hashes, notification-channel webhook URLs / SMTP passwords / bot
// tokens) are intentionally absent from the bundle — see the
// settings_serializer.go file-level docstring for the full list.

/** The schema_version this build emits + accepts. Bumped when sections are added/removed. */
export const SETTINGS_BUNDLE_SCHEMA_VERSION = 1;

/**
 * Section keys carried in the bundle. Each is independently optional
 * on import — a partial bundle (e.g. only alert_rules) is valid. The
 * SPA renders one collapsible panel per section in the dry-run preview.
 */
export const SETTINGS_BUNDLE_SECTION_KEYS = [
  'settings',
  'alert_rules',
  'geofences',
  'quiet_hours',
] as const;

export type SettingsBundleSectionKey = (typeof SETTINGS_BUNDLE_SECTION_KEYS)[number];

/**
 * Loosely-typed mirror of the Go `database.SettingsBundle`. We
 * deliberately type the section payloads as `unknown[]`/`unknown`
 * rather than re-declaring every field — the backend is the source of
 * truth for those, and tightening here would just create maintenance
 * coupling without catching real bugs (the wire is JSON either way).
 */
export interface SettingsBundle {
  schema_version: number;
  exported_at: string;
  sections: {
    settings?: Record<string, unknown>;
    alert_rules?: unknown[];
    geofences?: unknown[];
    quiet_hours?: unknown[];
  };
}

/** Per-section diff/apply summary returned by the import endpoint. */
export interface SettingsImportSectionResult {
  added: number;
  updated: number;
  skipped: number;
  conflicts?: string[];
}

/** Top-level import response (dry-run + apply share the same shape). */
export interface SettingsImportResult {
  dry_run: boolean;
  sections: Partial<Record<SettingsBundleSectionKey, SettingsImportSectionResult>>;
}

/**
 * Validate an unknown value parsed from a user-uploaded file. Returns
 * a normalised SettingsBundle on success or a string describing the
 * first validation failure encountered. Kept conservative — anything
 * the backend would reject is rejected here so we never round-trip a
 * known-bad upload.
 */
export function validateSettingsBundle(input: unknown): SettingsBundle | string {
  if (input == null || typeof input !== 'object') {
    return 'Bundle must be a JSON object';
  }
  const obj = input as Record<string, unknown>;

  const version = obj.schema_version;
  // `Number.isInteger` already rejects NaN, ±Infinity and non-integral
  // floats (e.g. 1.5), so it subsumes the old `Number.isFinite` guard while
  // also enforcing the "integer" half of the documented contract — a
  // fractional version previously slipped through to the confusing
  // "newer than this build supports" branch instead of this message.
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return 'schema_version must be a positive integer';
  }
  if (version > SETTINGS_BUNDLE_SCHEMA_VERSION) {
    return `schema_version ${version} is newer than this build supports (max ${SETTINGS_BUNDLE_SCHEMA_VERSION})`;
  }

  const exportedAt = obj.exported_at;
  if (typeof exportedAt !== 'string' || exportedAt.trim() === '') {
    return 'exported_at must be a non-empty ISO-8601 string';
  }

  const rawSections = obj.sections;
  if (rawSections == null || typeof rawSections !== 'object') {
    return 'sections must be a JSON object';
  }
  const sections = rawSections as Record<string, unknown>;

  for (const key of Object.keys(sections)) {
    if (!(SETTINGS_BUNDLE_SECTION_KEYS as readonly string[]).includes(key)) {
      return `Unknown section "${key}"`;
    }
  }

  if (sections.settings != null && typeof sections.settings !== 'object') {
    return 'sections.settings must be an object';
  }
  for (const k of ['alert_rules', 'geofences', 'quiet_hours'] as const) {
    if (sections[k] != null && !Array.isArray(sections[k])) {
      return `sections.${k} must be an array`;
    }
  }

  return {
    schema_version: version,
    exported_at: exportedAt,
    sections: {
      settings: sections.settings as Record<string, unknown> | undefined,
      alert_rules: sections.alert_rules as unknown[] | undefined,
      geofences: sections.geofences as unknown[] | undefined,
      quiet_hours: sections.quiet_hours as unknown[] | undefined,
    },
  };
}

/**
 * Build the user-facing filename for an export. The UTC date keeps
 * multiple exports distinguishable in the user's downloads folder
 * without exposing the hour (which would be locale-confusing).
 */
export function defaultExportFilename(now: Date = new Date()): string {
  // Guard against an invalid Date (e.g. `new Date('nope')`) — the getUTC*
  // accessors would otherwise return NaN and yield a literal
  // "teslasync-settings-NaNNaNNaN.json" that the browser would happily save.
  const when = Number.isNaN(now.getTime()) ? new Date() : now;
  const yyyy = when.getUTCFullYear();
  const mm = String(when.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(when.getUTCDate()).padStart(2, '0');
  return `teslasync-settings-${yyyy}${mm}${dd}.json`;
}

/**
 * Sum the per-section counts into a single triple. Used by the page to
 * label the Apply button ("Apply 5 changes") without re-deriving the
 * arithmetic in JSX.
 */
export function summariseImportResult(result: SettingsImportResult): {
  added: number;
  updated: number;
  skipped: number;
  total: number;
} {
  let added = 0;
  let updated = 0;
  let skipped = 0;
  // `result`/`sections` are typed non-null, but this value comes off the
  // wire — a truncated or partial API response must summarise to zeroes
  // rather than throw on `Object.values(undefined)`. Likewise a section
  // missing an individual count must contribute 0, never NaN (which would
  // poison the "Apply N changes" label the page derives from `total`).
  for (const sec of Object.values(result?.sections ?? {})) {
    if (sec == null) continue;
    added += sec.added ?? 0;
    updated += sec.updated ?? 0;
    skipped += sec.skipped ?? 0;
  }
  return { added, updated, skipped, total: added + updated };
}
