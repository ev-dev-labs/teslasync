import { describe, it, expect } from 'vitest';
import {
  INLINE_HELP_ALLOWLIST,
  isInlineHelpAllowed,
  type InlineHelpAllowedKey,
} from './inlineHelpAllowlist';

/**
 * The allowlist is a tiny data module, but it is load-bearing: the
 * `web/scripts/audit-inline-help.mjs` coverage gate reads it as *text* (a
 * regex over the source), and `isInlineHelpAllowed` is what tests / call
 * sites use to silence a `MISSING_HELP[…]` warning. These tests pin three
 * contracts:
 *   1. data hygiene    — the list stays deduped, trimmed, and well-formed;
 *   2. audit coupling  — every entry is shaped so the audit's extraction
 *                        regex (`/['"]([a-z][a-zA-Z0-9_.]+)['"]/g` +
 *                        `includes('.')`) can actually see it;
 *   3. lookup contract — `isInlineHelpAllowed` is a case-sensitive, exact,
 *                        pure membership test that agrees with the raw list.
 */

// Golden list — mirrors INLINE_HELP_ALLOWLIST 1:1. Duplicating it here is
// deliberate friction: adding/removing an allowlisted key forces a matching
// edit so a silent drift (e.g. a fat-fingered rename that breaks the audit)
// can never land unnoticed. The audit baseline records "excuses 9 i18n key(s)".
const EXPECTED_KEYS = [
  'automations.builder.name',
  'automations.builder.description',
  'notifications.alertStudio.editor.nameLabel',
  'notifications.alertStudio.editor.namePlaceholder',
  'notifications.channels.nameLabel',
  'automations.builder.enabled',
  'notifications.alertStudio.editor.enabledLabel',
  'notifications.channels.enabled',
  'notifications.channels.disabled',
] as const;

describe('INLINE_HELP_ALLOWLIST — data hygiene', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(INLINE_HELP_ALLOWLIST)).toBe(true);
    expect(INLINE_HELP_ALLOWLIST.length).toBeGreaterThan(0);
  });

  it('exactly matches the golden set (no drift, no dupes, same cardinality)', () => {
    // Set equality catches additions/removals; the length check catches
    // duplicate entries that a Set comparison would otherwise mask.
    expect([...INLINE_HELP_ALLOWLIST].sort()).toEqual([...EXPECTED_KEYS].sort());
    expect(INLINE_HELP_ALLOWLIST.length).toBe(EXPECTED_KEYS.length);
    expect(INLINE_HELP_ALLOWLIST.length).toBe(9);
  });

  it('contains no duplicate keys', () => {
    // A duplicate would double-count in the audit's informational tally and
    // signals a copy-paste slip in the source list.
    expect(new Set(INLINE_HELP_ALLOWLIST).size).toBe(INLINE_HELP_ALLOWLIST.length);
  });

  it('every entry is a non-empty, fully-trimmed string', () => {
    const bad = INLINE_HELP_ALLOWLIST.filter(
      (k) => typeof k !== 'string' || k.length === 0 || k.trim() !== k,
    );
    expect(bad).toEqual([]);
  });

  it('every entry is a dotted, namespaced i18n key (no spaces, slashes, or single-segment keys)', () => {
    const dottedI18nKey = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/;
    const invalid = INLINE_HELP_ALLOWLIST.filter((k) => !dottedI18nKey.test(k));
    expect(invalid).toEqual([]);
  });

  it('only allowlists the self-evident field families it documents (name / description / *Label / *Placeholder / enabled / disabled)', () => {
    // Guards the module's stated purpose: the allowlist absorbs *self-evident*
    // fields, not arbitrary help-worthy ones. A key whose last segment is not
    // one of these families is almost certainly a mistake.
    const selfEvidentLeaf =
      /(?:^|\.)(name|description|nameLabel|namePlaceholder|enabledLabel|enabled|disabled)$/;
    const suspicious = INLINE_HELP_ALLOWLIST.filter((k) => !selfEvidentLeaf.test(k));
    expect(suspicious).toEqual([]);
  });
});

describe('INLINE_HELP_ALLOWLIST — audit-script coupling', () => {
  // The exact regex from web/scripts/audit-inline-help.mjs (readAllowlist()).
  const AUDIT_KEY_RE = /['"]([a-z][a-zA-Z0-9_.]+)['"]/g;

  it('every key is extractable by the audit regex when quoted in the source', () => {
    // Simulate how the key appears in the .ts source (a single-quoted literal)
    // and confirm the audit would capture the whole key — not a truncated
    // prefix. A key starting uppercase or containing a `-` would be silently
    // dropped by the audit, so this coupling test is the real guard.
    for (const key of INLINE_HELP_ALLOWLIST) {
      AUDIT_KEY_RE.lastIndex = 0;
      const match = AUDIT_KEY_RE.exec(`'${key}'`);
      expect(match).not.toBeNull();
      expect(match?.[1]).toBe(key);
      // The audit only keeps captured keys that contain a dot.
      expect(key.includes('.')).toBe(true);
    }
  });

  it('extracts exactly the allowlisted keys from a reconstructed source array', () => {
    // Rebuild an array-literal snippet like the source and run the audit's
    // full extraction (regex + dot filter). It must yield the golden set.
    const snippet = `export const X = [\n${INLINE_HELP_ALLOWLIST.map(
      (k) => `  '${k}',`,
    ).join('\n')}\n] as const;`;
    const extracted: string[] = [];
    let m: RegExpExecArray | null;
    const re = new RegExp(AUDIT_KEY_RE.source, 'g');
    while ((m = re.exec(snippet)) !== null) {
      if (m[1].includes('.')) extracted.push(m[1]);
    }
    expect(extracted.sort()).toEqual([...EXPECTED_KEYS].sort());
  });
});

describe('isInlineHelpAllowed — membership contract', () => {
  it('returns true for every key in the allowlist', () => {
    for (const key of INLINE_HELP_ALLOWLIST) {
      expect(isInlineHelpAllowed(key)).toBe(true);
    }
  });

  it('agrees with the raw list for allowlisted keys and rejects everything else', () => {
    // The function must be a faithful proxy for `.includes` on the source list.
    for (const key of INLINE_HELP_ALLOWLIST) {
      expect(isInlineHelpAllowed(key)).toBe(INLINE_HELP_ALLOWLIST.includes(key));
    }
    const outsiders = [
      'automations.builder.trigger',
      'notifications.channels.webhookUrl',
      'settings.units.length',
      'totally.unknown.key',
    ];
    for (const key of outsiders) {
      expect(isInlineHelpAllowed(key)).toBe(false);
    }
  });

  it('pins two concrete allowlisted keys (name field + toggle) so a rename is caught', () => {
    expect(isInlineHelpAllowed('automations.builder.name')).toBe(true);
    expect(isInlineHelpAllowed('notifications.channels.disabled')).toBe(true);
  });

  it('is case-sensitive — a differently-cased key is NOT allowed', () => {
    expect(isInlineHelpAllowed('Automations.Builder.Name')).toBe(false);
    expect(isInlineHelpAllowed('AUTOMATIONS.BUILDER.NAME')).toBe(false);
    expect(isInlineHelpAllowed('notifications.channels.NAMELABEL')).toBe(false);
  });

  it('requires an exact match — prefixes, parents, and substrings are rejected', () => {
    // 'automations.builder' is a parent namespace of an allowlisted key but is
    // not itself allowed; partial matches must never leak through.
    expect(isInlineHelpAllowed('automations.builder')).toBe(false);
    expect(isInlineHelpAllowed('automations')).toBe(false);
    expect(isInlineHelpAllowed('automations.builder.nam')).toBe(false);
    expect(isInlineHelpAllowed('automations.builder.names')).toBe(false);
  });

  it('rejects keys padded with whitespace or a trailing dot (no trimming / fuzzy match)', () => {
    expect(isInlineHelpAllowed(' automations.builder.name')).toBe(false);
    expect(isInlineHelpAllowed('automations.builder.name ')).toBe(false);
    expect(isInlineHelpAllowed('automations.builder.name.')).toBe(false);
  });

  it('returns false for empty and whitespace-only strings', () => {
    expect(isInlineHelpAllowed('')).toBe(false);
    expect(isInlineHelpAllowed('   ')).toBe(false);
    expect(isInlineHelpAllowed('\t\n')).toBe(false);
  });

  it('is pure — repeated calls with the same key are stable and side-effect free', () => {
    const before = [...INLINE_HELP_ALLOWLIST];
    expect(isInlineHelpAllowed('automations.builder.enabled')).toBe(true);
    expect(isInlineHelpAllowed('automations.builder.enabled')).toBe(true);
    expect(isInlineHelpAllowed('nope')).toBe(false);
    // The lookup must not mutate the underlying list.
    expect([...INLINE_HELP_ALLOWLIST]).toEqual(before);
  });

  it('does not throw on unusual but valid string inputs', () => {
    expect(() => isInlineHelpAllowed('x'.repeat(5000))).not.toThrow();
    expect(isInlineHelpAllowed('x'.repeat(5000))).toBe(false);
    expect(isInlineHelpAllowed('🚗.emoji.key')).toBe(false);
  });
});

describe('InlineHelpAllowedKey — type round-trips its members', () => {
  it('accepts each allowlisted literal where an InlineHelpAllowedKey is required', () => {
    // If the source regressed to `: readonly string[]`, InlineHelpAllowedKey
    // would collapse to `string` and this identity round-trip would lose all
    // meaning. Exercising it with real literals documents the intended union.
    const identity = (k: InlineHelpAllowedKey): InlineHelpAllowedKey => k;
    expect(identity('automations.builder.name')).toBe('automations.builder.name');
    expect(identity('notifications.channels.enabled')).toBe(
      'notifications.channels.enabled',
    );
    expect(isInlineHelpAllowed(identity('notifications.channels.disabled'))).toBe(true);
  });
});
