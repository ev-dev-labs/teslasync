/**
 * P1/S10-0001 — Neutral i18n catalog + per-platform resource generator.
 *
 * Reads the web app translation catalogs (web/src/i18n/{en,ar,he}.json — a single
 * react-i18next namespace "translation" of nested keys) and emits:
 *
 *   apps/shared/i18n/catalog/<locale>.json   neutral flat catalog (keyed by namespace.key)
 *   apps/shared/i18n/catalog/_index.json      locale metadata + translation coverage
 *   apps/android/app/src/main/res/values-LOCALE/strings.xml
 *   apps/apple/Localization/Localizable.xcstrings
 *   apps/windows/Strings/<locale>/Resources.resw
 *
 * The web base locale (en) is the canonical key set (ADR-014). Placeholder locales
 * (ar/he — _meta only, zero translated keys) are MATERIALIZED with English fallback so
 * the native resource bundles are structurally complete, with every fallback entry
 * flagged `"translated": false` and the coverage logged loudly — never counted as a real
 * translation (honesty covenant: no red-as-green, no silent drift).
 *
 * Usage:
 *   npx tsx apps/shared/i18n/generators/gen-i18n.ts          # write catalog + resources
 *   npx tsx apps/shared/i18n/generators/gen-i18n.ts --check  # read/compare-only drift gate
 */

import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';

// ── paths ───────────────────────────────────────────────────────────────────
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const WEB_I18N = path.join(repoRoot, 'web', 'src', 'i18n');
const CATALOG_DIR = path.join(repoRoot, 'apps', 'shared', 'i18n', 'catalog');
const ANDROID_RES = path.join(repoRoot, 'apps', 'android', 'app', 'src', 'main', 'res');
const APPLE_DIR = path.join(repoRoot, 'apps', 'apple', 'Localization');
const WINDOWS_DIR = path.join(repoRoot, 'apps', 'windows', 'Strings');

// The web app registers all locales under one i18next namespace.
const NAMESPACE = 'translation';
const BASE_LOCALE = 'en';
// Locale generation order: base first, then the rest in declaration order.
const LOCALES = ['en', 'ar', 'he'];
// CLDR plural categories in canonical order.
const CLDR_ORDER = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
const PLURAL_SUFFIX_RE = /_(zero|one|two|few|many|other)$/;

type Platform = 'android' | 'apple' | 'windows';

interface Entry {
  key: string; // namespace-prefixed dotted key, e.g. translation.foo.bar
  tokens: string[]; // interpolation variables, canonical order (count first)
  plural: boolean;
  value?: string; // for non-plural
  forms?: Record<string, string>; // CLDR category -> string, for plural
}

interface LocaleMeta {
  locale: string;
  name: string;
  direction: 'ltr' | 'rtl';
  status: string; // base | placeholder | translated
}

// ── tiny utils ────────────────────────────────────────────────────────────────
function rel(abs: string): string {
  return path.relative(repoRoot, abs).split(path.sep).join('/');
}
function readJSON(file: string): any {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
// Deterministic JSON with sorted keys + 2-space indent + trailing newline.
function stableStringify(value: any): string {
  const seen = (v: any): any => {
    if (Array.isArray(v)) return v.map(seen);
    if (v && typeof v === 'object') {
      const out: Record<string, any> = {};
      for (const k of Object.keys(v).sort()) out[k] = seen(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(seen(value), null, 2) + '\n';
}
function extractTokens(s: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const tok = m[1].trim();
    if (!out.includes(tok)) out.push(tok);
  }
  return out;
}

// ── ingest one web locale into flat leaves ─────────────────────────────────────
function flattenLeaves(obj: any, prefix: string, out: Map<string, string>): void {
  for (const k of Object.keys(obj)) {
    if (prefix === '' && k === '_meta') continue;
    const key = prefix ? `${prefix}.${k}` : k;
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      flattenLeaves(v, key, out);
    } else if (typeof v === 'string') {
      out.set(key, v);
    } else {
      throw new Error(`unsupported non-string i18n value at ${key}: ${typeof v}`);
    }
  }
}

// Group i18next plural-suffixed leaves into plural entries; build canonical tokens.
function buildEntries(leaves: Map<string, string>): Map<string, Entry> {
  const plurals = new Map<string, Record<string, string>>();
  const singles = new Map<string, string>();
  for (const [leaf, val] of leaves) {
    const m = leaf.match(PLURAL_SUFFIX_RE);
    if (m) {
      const base = leaf.slice(0, leaf.length - m[0].length);
      const cat = m[1];
      if (!plurals.has(base)) plurals.set(base, {});
      plurals.get(base)![cat] = val;
    } else {
      singles.set(leaf, val);
    }
  }
  const entries = new Map<string, Entry>();
  // Plural entries first. In the web catalog an i18next plural base may ALSO have a
  // plain (non-suffixed) key — its v4 default/singular. Fold it into the plural forms
  // (fill a missing `other` or English `one`) and drop it from singles, so the string is
  // never lost and the count=1 grammar stays correct.
  for (const [base, forms] of plurals) {
    const plain = singles.get(base);
    if (plain !== undefined) {
      if (!forms['other']) forms['other'] = plain;
      if (!forms['one']) forms['one'] = plain;
      singles.delete(base);
    }
  }
  for (const [leaf, val] of singles) {
    const key = `${NAMESPACE}.${leaf}`;
    entries.set(key, { key, tokens: extractTokens(val), plural: false, value: val });
  }
  for (const [base, forms] of plurals) {
    const key = `${NAMESPACE}.${base}`;
    // Canonical token order: union across forms in CLDR order, with `count` first.
    const tokens: string[] = [];
    const pushTok = (t: string) => { if (!tokens.includes(t)) tokens.push(t); };
    for (const cat of CLDR_ORDER) {
      if (forms[cat]) extractTokens(forms[cat]).forEach(pushTok);
    }
    if (tokens.includes('count')) {
      tokens.splice(tokens.indexOf('count'), 1);
      tokens.unshift('count');
    }
    if (!forms['other']) {
      throw new Error(`plural group ${base} is missing the required "other" form`);
    }
    entries.set(key, { key, tokens, plural: true, forms });
  }
  return entries;
}

// ── catalog model ─────────────────────────────────────────────────────────────
interface LocaleCatalog {
  meta: LocaleMeta;
  entries: Map<string, Entry>; // resolved (translated or fallback) entries
  translated: Set<string>; // keys that came from this locale's own web file
}

function loadLocale(locale: string, baseEntries: Map<string, Entry>): LocaleCatalog {
  const file = path.join(WEB_I18N, `${locale}.json`);
  const raw = readJSON(file);
  const meta = raw._meta || {};
  const direction: 'ltr' | 'rtl' = meta.direction === 'rtl' ? 'rtl' : 'ltr';
  const status = locale === BASE_LOCALE ? 'base' : (meta.status || 'translated');
  const name = meta.name || (locale === BASE_LOCALE ? 'English' : locale);

  const leaves = new Map<string, string>();
  flattenLeaves(raw, '', leaves);
  const own = buildEntries(leaves);

  // Resolve: own entries where present, English fallback otherwise.
  const entries = new Map<string, Entry>();
  const translated = new Set<string>();
  for (const [key, baseEntry] of baseEntries) {
    if (own.has(key)) {
      entries.set(key, own.get(key)!);
      translated.add(key);
    } else {
      entries.set(key, baseEntry);
    }
  }
  // Detect extra keys not present in the base set (drift / typo).
  for (const key of own.keys()) {
    if (!baseEntries.has(key)) {
      throw new Error(`locale ${locale} has key not present in base ${BASE_LOCALE}: ${key}`);
    }
  }
  return { meta: { locale, name, direction, status }, entries, translated };
}

// ── placeholder substitution ───────────────────────────────────────────────────
const SENT_OPEN = '\uE000';
const SENT_CLOSE = '\uE001';

function placeholderFor(platform: Platform, token: string, idx: number, plural: boolean): string {
  const numeric = plural && token === 'count';
  switch (platform) {
    case 'android': return numeric ? `%${idx + 1}$d` : `%${idx + 1}$s`;
    case 'apple': return numeric ? `%${idx + 1}$d` : `%${idx + 1}$@`;
    case 'windows': return `{${idx}}`;
  }
}

// Replace {{tok}} with sentinels, escape literal text per platform, restore placeholders.
function renderValue(raw: string, tokens: string[], platform: Platform, plural: boolean): string {
  const hasTokens = tokens.length > 0;
  let s = raw.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, t) => {
    const idx = tokens.indexOf(String(t).trim());
    return `${SENT_OPEN}${idx}${SENT_CLOSE}`;
  });

  if (platform === 'android') {
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (hasTokens) s = s.replace(/%/g, '%%'); // only format strings need % escaping
    s = s.replace(/'/g, "\\'").replace(/"/g, '\\"');
    s = s.replace(/^([@?])/, '\\$1');
    s = s.replace(/\n/g, '\\n').replace(/\t/g, '\\t');
  } else if (platform === 'apple') {
    // Value is embedded via JSON.stringify later; only format-% needs doubling.
    if (hasTokens) s = s.replace(/%/g, '%%');
  } else {
    // windows resw element text
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (hasTokens) s = s.replace(/\{/g, '{{').replace(/\}/g, '}}'); // string.Format escaping
  }

  s = s.replace(new RegExp(`${SENT_OPEN}(\\d+)${SENT_CLOSE}`, 'g'), (_m, n) => {
    const idx = Number(n);
    return placeholderFor(platform, tokens[idx], idx, plural);
  });
  return s;
}

// ── Android naming (resource names are [a-zA-Z0-9_], cannot start with digit) ───
function androidName(key: string): string {
  let n = key.replace(/[^a-zA-Z0-9_]/g, '_');
  if (/^[0-9]/.test(n)) n = `_${n}`;
  return n;
}

// ── emitters ───────────────────────────────────────────────────────────────────
function coverageComment(prefix: string, suffix: string, lc: LocaleCatalog, total: number): string {
  const t = lc.meta.locale === BASE_LOCALE ? total : lc.translated.size;
  const f = total - t;
  return `${prefix} AUTO-GENERATED by apps/shared/i18n/generators/gen-i18n.ts — do not edit by hand.${suffix}\n` +
    `${prefix} locale=${lc.meta.locale} status=${lc.meta.status} dir=${lc.meta.direction} translated=${t} fallback=${f} of ${total}${suffix}`;
}

function emitAndroidStrings(lc: LocaleCatalog, sortedKeys: string[], total: number): string {
  const names = new Set<string>();
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="utf-8"?>');
  lines.push(coverageComment('<!--', ' -->', lc, total));
  lines.push('<resources>');
  for (const key of sortedKeys) {
    const e = lc.entries.get(key)!;
    const name = androidName(key);
    if (names.has(name)) {
      throw new Error(`android resource name collision: ${name} (from ${key})`);
    }
    names.add(name);
    if (e.plural) {
      lines.push(`  <plurals name="${name}">`);
      for (const cat of CLDR_ORDER) {
        if (!e.forms![cat]) continue;
        const v = renderValue(e.forms![cat], e.tokens, 'android', true);
        lines.push(`    <item quantity="${cat}">${v}</item>`);
      }
      lines.push('  </plurals>');
    } else {
      const v = renderValue(e.value!, e.tokens, 'android', false);
      lines.push(`  <string name="${name}">${v}</string>`);
    }
  }
  lines.push('</resources>');
  return lines.join('\n') + '\n';
}

function emitWindowsResw(lc: LocaleCatalog, sortedKeys: string[], total: number): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="utf-8"?>');
  lines.push(coverageComment('<!--', ' -->', lc, total));
  lines.push('<root>');
  // Minimal resw schema header (matches Visual Studio default Resources.resw).
  lines.push('  <resheader name="resmimetype"><value>text/microsoft-resx</value></resheader>');
  lines.push('  <resheader name="version"><value>2.0</value></resheader>');
  lines.push('  <resheader name="reader"><value>System.Resources.ResXResourceReader, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value></resheader>');
  lines.push('  <resheader name="writer"><value>System.Resources.ResXResourceWriter, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value></resheader>');
  const emitData = (name: string, value: string) => {
    lines.push(`  <data name="${name}" xml:space="preserve">`);
    lines.push(`    <value>${value}</value>`);
    lines.push('  </data>');
  };
  for (const key of sortedKeys) {
    const e = lc.entries.get(key)!;
    if (e.plural) {
      // resw has no native plurals: emit one entry per CLDR form; a code-side
      // resolver selects the form by count (see INTERPOLATION-MAPPING.md).
      for (const cat of CLDR_ORDER) {
        if (!e.forms![cat]) continue;
        emitData(`${key}.Plural.${cat}`, renderValue(e.forms![cat], e.tokens, 'windows', true));
      }
    } else {
      emitData(key, renderValue(e.value!, e.tokens, 'windows', false));
    }
  }
  lines.push('</root>');
  return lines.join('\n') + '\n';
}

function emitAppleXcstrings(catalogs: LocaleCatalog[], sortedKeys: string[]): string {
  const strings: Record<string, any> = {};
  for (const key of sortedKeys) {
    const localizations: Record<string, any> = {};
    for (const lc of catalogs) {
      const e = lc.entries.get(key)!;
      const translated = lc.translated.has(key) || lc.meta.locale === BASE_LOCALE;
      const state = translated ? 'translated' : 'needs_review';
      if (e.plural) {
        const plural: Record<string, any> = {};
        for (const cat of CLDR_ORDER) {
          if (!e.forms![cat]) continue;
          plural[cat] = { stringUnit: { state, value: renderValue(e.forms![cat], e.tokens, 'apple', true) } };
        }
        localizations[lc.meta.locale] = { variations: { plural } };
      } else {
        localizations[lc.meta.locale] = { stringUnit: { state, value: renderValue(e.value!, e.tokens, 'apple', false) } };
      }
    }
    strings[key] = { extractionState: 'manual', localizations };
  }
  const doc = { sourceLanguage: BASE_LOCALE, strings, version: '1.0' };
  // Xcode writes String Catalogs with sorted keys + 2-space indent; match that.
  return stableStringify(doc);
}

// ── neutral catalog files ──────────────────────────────────────────────────────
function catalogFile(lc: LocaleCatalog, sortedKeys: string[]): string {
  const entries: Record<string, any> = {};
  for (const key of sortedKeys) {
    const e = lc.entries.get(key)!;
    const translated = lc.translated.has(key) || lc.meta.locale === BASE_LOCALE;
    const rec: any = { tokens: e.tokens, translated };
    if (!translated) rec.fallbackFrom = BASE_LOCALE;
    if (e.plural) { rec.plural = true; rec.forms = e.forms; }
    else { rec.value = e.value; }
    entries[key] = rec;
  }
  return stableStringify({
    locale: lc.meta.locale,
    name: lc.meta.name,
    direction: lc.meta.direction,
    status: lc.meta.status,
    namespaces: [NAMESPACE],
    entryCount: sortedKeys.length,
    entries,
  });
}

// ── build all outputs in memory (single source for write + check) ───────────────
interface BuildResult {
  files: Map<string, string>; // relPath -> content
  baseEntries: Map<string, Entry>;
  catalogs: LocaleCatalog[];
  leafCount: number;
}

function build(): BuildResult {
  // Base = en.
  const baseLeaves = new Map<string, string>();
  flattenLeaves(readJSON(path.join(WEB_I18N, `${BASE_LOCALE}.json`)), '', baseLeaves);
  const baseEntries = buildEntries(baseLeaves);
  const sortedKeys = [...baseEntries.keys()].sort();

  const catalogs = LOCALES.map((l) => loadLocale(l, baseEntries));
  const total = sortedKeys.length;
  const files = new Map<string, string>();

  // Neutral catalog + index.
  for (const lc of catalogs) {
    files.set(rel(path.join(CATALOG_DIR, `${lc.meta.locale}.json`)), catalogFile(lc, sortedKeys));
  }
  const index = {
    baseLocale: BASE_LOCALE,
    namespaces: [NAMESPACE],
    generatedFrom: rel(WEB_I18N),
    entryCount: total,
    locales: catalogs.map((lc) => ({
      locale: lc.meta.locale,
      name: lc.meta.name,
      direction: lc.meta.direction,
      status: lc.meta.status,
      sourceKeyCount: lc.meta.locale === BASE_LOCALE ? total : lc.translated.size,
      effectiveKeyCount: total,
      translatedCount: lc.meta.locale === BASE_LOCALE ? total : lc.translated.size,
      fallbackCount: lc.meta.locale === BASE_LOCALE ? 0 : total - lc.translated.size,
    })),
  };
  files.set(rel(path.join(CATALOG_DIR, '_index.json')), stableStringify(index));

  // Android: values/ = base, values-<locale>/ = others.
  for (const lc of catalogs) {
    const dir = lc.meta.locale === BASE_LOCALE ? 'values' : `values-${lc.meta.locale}`;
    files.set(rel(path.join(ANDROID_RES, dir, 'strings.xml')), emitAndroidStrings(lc, sortedKeys, total));
  }
  // Windows: one resw per locale.
  for (const lc of catalogs) {
    files.set(rel(path.join(WINDOWS_DIR, lc.meta.locale, 'Resources.resw')), emitWindowsResw(lc, sortedKeys, total));
  }
  // Apple: single String Catalog with every locale.
  files.set(rel(path.join(APPLE_DIR, 'Localizable.xcstrings')), emitAppleXcstrings(catalogs, sortedKeys));

  return { files, baseEntries, catalogs, leafCount: baseLeaves.size };
}

// ── structural validation of generated artifacts (parse, don't trust) ──────────
function validate(b: BuildResult): string[] {
  const errs: string[] = [];
  // Apple xcstrings must be valid JSON with sourceLanguage + at least one plural variation.
  const xc = b.files.get(rel(path.join(APPLE_DIR, 'Localizable.xcstrings')))!;
  try {
    const doc = JSON.parse(xc);
    if (doc.sourceLanguage !== BASE_LOCALE) errs.push('xcstrings: wrong sourceLanguage');
    if (!doc.strings || typeof doc.strings !== 'object') errs.push('xcstrings: missing strings');
    const hasPlural = Object.values(doc.strings).some(
      (s: any) => s.localizations?.en?.variations?.plural?.other?.stringUnit,
    );
    if (!hasPlural) errs.push('xcstrings: no plural variation emitted');
  } catch (e) {
    errs.push(`xcstrings: invalid JSON (${(e as Error).message})`);
  }
  // Android files must contain <resources> and at least one <plurals> in base.
  const baseAndroid = b.files.get(rel(path.join(ANDROID_RES, 'values', 'strings.xml')))!;
  if (!/<resources>/.test(baseAndroid)) errs.push('android: missing <resources>');
  if (!/<plurals /.test(baseAndroid)) errs.push('android: no <plurals> emitted');
  // Windows resw must be well-formed root with data + plural entries.
  const baseResw = b.files.get(rel(path.join(WINDOWS_DIR, 'en', 'Resources.resw')))!;
  if (!/<root>/.test(baseResw)) errs.push('windows: missing <root>');
  if (!/\.Plural\.other/.test(baseResw)) errs.push('windows: no plural entries emitted');
  // Catalog completeness: every locale catalog key set == base key set.
  const baseKeys = new Set(b.baseEntries.keys());
  for (const lc of b.catalogs) {
    const keys = new Set(lc.entries.keys());
    if (keys.size !== baseKeys.size) {
      errs.push(`completeness: locale ${lc.meta.locale} has ${keys.size} keys, base has ${baseKeys.size}`);
    }
    for (const k of baseKeys) {
      if (!keys.has(k)) errs.push(`completeness: locale ${lc.meta.locale} missing ${k}`);
    }
  }
  return errs;
}

function printCoverage(b: BuildResult): void {
  console.log(`web base locale=${BASE_LOCALE} leaves=${b.leafCount} grouped_entries=${b.baseEntries.size}`);
  for (const lc of b.catalogs) {
    const t = lc.meta.locale === BASE_LOCALE ? b.baseEntries.size : lc.translated.size;
    const f = b.baseEntries.size - t;
    console.log(
      `locale=${lc.meta.locale} status=${lc.meta.status} dir=${lc.meta.direction} ` +
      `translated=${t} fallback=${f} effective=${b.baseEntries.size}`,
    );
  }
}

// ── main ───────────────────────────────────────────────────────────────────────
function main(): void {
  const check = process.argv.includes('--check');
  let b: BuildResult;
  try {
    b = build();
  } catch (e) {
    console.error(`[FAIL] build error: ${(e as Error).message}`);
    process.exit(1);
  }

  const errs = validate(b);
  if (errs.length) {
    for (const e of errs) console.error(`[FAIL] ${e}`);
    process.exit(1);
  }

  if (check) {
    // Read/compare-only: never write, so drift in committed files surfaces.
    const diffs: string[] = [];
    for (const [relPath, content] of b.files) {
      const abs = path.join(repoRoot, relPath);
      if (!fs.existsSync(abs)) { diffs.push(`missing ${relPath}`); continue; }
      if (fs.readFileSync(abs, 'utf8') !== content) diffs.push(`drift ${relPath}`);
    }
    printCoverage(b);
    if (diffs.length) {
      for (const d of diffs) console.error(`[FAIL] ${d}`);
      console.error(`COMPLETE_RESULT=DRIFT files=${diffs.length}`);
      process.exit(1);
    }
    console.log(`COMPLETE_RESULT=OK files=${b.files.size} entries=${b.baseEntries.size}`);
    process.exit(0);
  }

  // Write mode.
  for (const [relPath, content] of b.files) {
    const abs = path.join(repoRoot, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  printCoverage(b);
  console.log(`GEN_RESULT=OK files=${b.files.size} entries=${b.baseEntries.size}`);
  process.exit(0);
}

main();
