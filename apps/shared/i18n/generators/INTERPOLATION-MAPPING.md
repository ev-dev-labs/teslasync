# Interpolation & plural token mapping (P1/S10 · ADR-014)

The neutral i18n catalog (`apps/shared/i18n/catalog/`) is derived from the web app's
`react-i18next` catalogs (`web/src/i18n/{en,ar,he}.json`). It preserves the web
interpolation tokens (`{{name}}`) and i18next plural forms (`key_one` / `key_other`).
Each platform resource is generated from this neutral catalog by
`apps/shared/i18n/generators/gen-i18n.ts`, mapping the neutral tokens to that platform's
native format. This document is the authoritative mapping.

## Namespace

The web app registers every locale under a **single** `react-i18next` namespace,
`translation`. The catalog preserves it as a key prefix: a web key `achievements.unlocked`
becomes the neutral key `translation.achievements.unlocked`. New namespaces (if the web app
adds any) flow through automatically as new prefixes.

## Token ordering (deterministic)

Each catalog entry carries a canonical `tokens` array — the interpolation variables in
order of first appearance. For plural entries the order is the union across all CLDR forms,
and the plural-controlling `count` token is forced to index `0`. Positional placeholders are
assigned from this array, so a repeated token always resolves to the same argument index and
the order never diverges between plural forms.

## Interpolation mapping

| Neutral (web)        | Android (`strings.xml`) | Apple (`.xcstrings`) | Windows (`.resw`)        |
|----------------------|-------------------------|----------------------|--------------------------|
| `{{name}}` (string)  | `%1$s`, `%2$s`, …       | `%1$@`, `%2$@`, …    | `{0}`, `{1}`, … (`string.Format`) |
| `{{count}}` (plural) | `%1$d`                  | `%1$d`               | `{0}`                    |

- **Android** and **Apple** use 1-based positional specifiers (`%N$…`). **Windows** uses
  0-based `string.Format` indices (`{N}`).
- In a **plural** entry the `count` token is rendered as an integer specifier (`%1$d` /
  `{0}`); all other tokens are rendered as string specifiers.

## Escaping

Generation escapes literal text per platform, then injects the placeholders above (so the
placeholders themselves are never re-escaped):

- **Android** — `& < >` → XML entities; in format strings literal `%` → `%%`; `'`/`"` →
  `\'`/`\"`; a leading `@`/`?` → `\@`/`\?`; tabs/newlines → `\t`/`\n`.
- **Apple** — values are stored as JSON strings (`.xcstrings`), so quoting is handled by JSON
  encoding; in format strings literal `%` → `%%`.
- **Windows** — `& < >` → XML entities; in format strings literal `{`/`}` → `{{`/`}}`
  (`string.Format` escaping).

## Plurals

The web uses i18next suffixes (`key_one`, `key_other`). The neutral catalog groups them into
one entry with `forms` keyed by **CLDR category** (`zero` `one` `two` `few` `many` `other`).
Only `other` is required; English supplies `one`/`other` today, and translators may add the
extra Arabic/Hebrew categories later without touching the generator.

When a plural base **also** has a plain (non-suffixed) key in the web catalog — its i18next
v4 default/singular (e.g. `export.jobDrawer.activeCount` alongside
`export.jobDrawer.activeCount_other`) — the generator folds that plain value into the plural
forms (filling a missing `other`, and the English `one`) and drops the standalone key. This
keeps the count=1 grammar correct and never loses a string.

| Platform | Plural mechanism |
|----------|------------------|
| **Android** | Native `<plurals name="…"><item quantity="one|other|…">…</item></plurals>`. |
| **Apple**   | Native String Catalog `variations.plural.{one,other,…}` per localization. |
| **Windows** | `.resw` has **no** native plural element. The generator emits one flat entry per form, named `<key>.Plural.<category>` (e.g. `translation.bulk.selected.Plural.one`). The app resolves the form at runtime by picking the CLDR category for the count via `Windows.Globalization.NumberFormatting` / .NET `CultureInfo`, then loading `…​.Plural.<category>`. |

## Untranslated locales (fallback materialization)

`ar` and `he` are **placeholder** locales in the web app (their JSON contains only `_meta`;
all keys fall back to English via i18next `fallbackLng`). Native platforms need a complete
resource bundle, so the generator **materializes** the English fallback for every missing key
and flags it honestly:

- Neutral catalog entry: `"translated": false`, `"fallbackFrom": "en"`.
- Apple `.xcstrings`: `"state": "needs_review"` on the fallback localization.
- Android/Windows: a coverage comment header (`translated=… fallback=… of …`).
- `catalog/_index.json`: per-locale `translatedCount` vs `fallbackCount`.

The completeness check is therefore **structurally** green (every base key exists for every
locale) while translation coverage for `ar`/`he` is reported as `0 translated`. Replacing a
fallback with a real translation in the web catalog automatically flips the flag on the next
generation; CI (`gen-i18n.ps1 -Check`) fails on any drift.
