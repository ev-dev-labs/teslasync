# i18n Guidelines

**Status:** active · **Owner:** frontend platform · **Phase 40 / Prompt 24**

This document is the source of truth for how user-facing strings are
translated in the TeslaSync web frontend. Read this before adding new UI
components or API hooks that emit messages.

## Why this exists

The frontend is built around **`react-i18next`**. The English bundle
(`web/src/i18n/en.json`) is the only language we currently ship, but the
i18next infrastructure lets us drop in `es.json`, `de.json`, `fr.json`, etc.
Every untranslated literal in the source is a string we cannot translate.
The repo's `.github/copilot-instructions.md` lists "hardcoded English
strings" as a prohibited pattern (rule #5).

## Workflow at a glance

| What you do                                        | Tool / file                          |
| -------------------------------------------------- | ------------------------------------ |
| Add a translatable string                          | `t('namespace.key', 'English text')` |
| Auto-add the key to `en.json`                      | `npm run i18n:extract` (see below)   |
| Validate every used key resolves                   | `npm run i18n:validate`              |
| Generate a coverage report                         | `pwsh ../scripts/i18n-coverage.ps1`  |
| Suppress a single line that is *not* translatable  | trailing `// i18n-ignore` comment    |

## Rules

### 1. Always pair a key with an English fallback

```tsx
// ✅ Default value renders even before en.json gets the key.
<h2>{t('battery.health.title', 'Battery Health')}</h2>

// ❌ No fallback — if the key is missing the user sees the literal string
//    "battery.health.title".
<h2>{t('battery.health.title')}</h2>
```

The validator (`scripts/i18n-validate-keys.mjs`) reads the fallback from the
second argument and uses it to populate `en.json` when you run `--extract`.

### 2. One key per user-facing string

A single key per visible label. Don't share a key between unrelated UI
locations — they may diverge in translation.

```jsonc
// en.json (good)
{
  "page": {
    "battery": {
      "title": "Battery Health",
      "subtitle": "Cell-level health and degradation"
    }
  }
}
```

### 3. Namespace by feature, not by component

Mirror the `web/src/features/<domain>` layout in your namespace tree.

| Layer in source               | Namespace prefix             |
| ----------------------------- | ---------------------------- |
| `web/src/features/battery/…`  | `page.battery.*`             |
| `web/src/components/charts/…` | `chart.*` / `annotation.*`   |
| Cross-cutting actions         | `common.*` (Save, Cancel, …) |
| Toast messages                | `toast.*`                    |
| Alert severities              | `alert.severity.*`           |
| Errors                        | `error.*`                    |
| Navigation labels             | `nav.*`                      |

A key like `widget.charge.label` is fine because the widget namespace is a
shared feature. A key like `MyButtonComponent.label` is **not** fine —
component names are implementation detail and they get refactored.

### 4. Never concatenate translated fragments

Use placeholders, not string concatenation. Word order varies between
languages.

```tsx
// ✅
t('greeting', 'Hello {{name}}', { name: user.displayName })

// ❌
t('greeting', 'Hello') + ' ' + user.displayName
```

### 5. Plurals via i18next pluralization

```jsonc
// en.json
{
  "vehicle": {
    "count_one":   "{{count}} vehicle",
    "count_other": "{{count}} vehicles"
  }
}
```

```tsx
t('vehicle.count', { count: vehicles.length })
```

### 6. Toast / EmptyState / ConfirmDialog must use `t()`

Mutation hooks use `useMutationToast()` from
`@/api/hooks/_toastHelpers` — pass an i18n key plus a fallback. Empty
states accept the translated string directly.

```tsx
const { success, error } = useMutationToast();
return useMutation({
  mutationFn: (id) => request(`/vehicles/${id}`, { method: 'DELETE' }),
  onSuccess: () => success('toast.vehicle.delete.success', 'Vehicle removed'),
  onError:   (e) => error(e, 'toast.vehicle.delete.error', 'Failed to remove vehicle'),
});
```

```tsx
<EmptyState message={t('battery.cells.empty', 'No cell data available')} />
```

### 7. Never translate technical identifiers

Do not put i18n calls around any of these:

- Signal names (`battery_level`, `charge_state`, etc.)
- FSM state names (`driving`, `charging`, `online`, …)
- Database enum values
- API endpoint paths
- CSS class strings

Use `// i18n-ignore` if a literal is genuinely untranslatable (a debug
label visible only in dev tools, a CSS classname, etc.) — the audit script
will skip lines containing that comment.

### 8. Keep `en.json` alphabetically clean

When you add a new section, sort sibling keys alphabetically inside their
parent namespace. This keeps merge conflicts trivial when multiple
contributors add keys at once.

## Tooling

### `npm run i18n:validate` — strict CI check

Cross-references every `t('key', …)` call against `web/src/i18n/en.json`.
Reports two numbers:

- **Missing keys** — keys used in code but not defined in the bundle.
  These render the fallback in production but cannot be translated.
- **Unused keys** — keys defined in the bundle but never referenced.
  Safe to remove unless they are looked up dynamically.

Exits with status 1 if `--strict` is passed and any key is missing. CI
runs the script in **non-strict** mode initially so the team can drive
the count down without blocking PRs. Promote to `--strict` once the
baseline reaches zero.

### `npm run i18n:extract` — populate `en.json` from fallbacks

Walks every `t('key', 'fallback')` call in `web/src/` and inserts the key
into `en.json` using the fallback string as the English value. Already-
defined keys are left untouched, and key paths that would collide with an
existing string value are skipped (with a count of skips reported).

Run this every time you add a batch of new `t()` calls, or as a one-shot
catch-up sweep after merging from main.

### `pwsh scripts/i18n-coverage.ps1` — generate the audit report

Writes `docs/audits/i18n-coverage.md` with five categories of finding
(raw text in JSX, raw JSX prop literals, raw feedback-component
literals, missing keys, unused keys) and a top-20 worst-offender file
list. Re-run after each adoption sweep to track progress.

### ESLint rule (planned)

`eslint-plugin-i18next` is installed but the rule
`i18next/no-literal-string` is currently **disabled** in
`web/.eslintrc.cjs` — flipping it on across the whole tree would generate
hundreds of warnings that break `--max-warnings 0`. The plan is to
enable it as a `warn` per-directory once each feature folder reaches
zero raw literals in the coverage report. To preview what the rule would
flag in your area, copy the override block at the bottom of
`web/.eslintrc.cjs` and add your path.

## Adopting a new feature

1. Open the feature's directory and run the coverage script:

   ```powershell
   pwsh scripts/i18n-coverage.ps1
   ```

2. Find the file in the worst-offender table. For each raw literal:
   - Pick a key under the appropriate namespace (`page.<feature>.<role>`).
   - Wrap the literal in `t('namespace.key', 'Original English')`.
3. Run `npm run i18n:extract` to add the new keys to `en.json`.
4. Run `npm run i18n:validate` to confirm zero missing keys.
5. Re-run the coverage script — the file's count should drop to ~0.

## Out of scope for this document

- Translating the strings into other languages — the bundle is shipped
  in English only. `es.json` / `de.json` / `fr.json` etc. are a separate
  follow-up that depends on this coverage being complete.
- Localised number / date / currency formatting — those are handled by
  the `Currency`, `DateTime`, and `fmtNumber` helpers (see the existing
  format components in `@/components/data-display`).
- Translating signal names, FSM state names, or DB enum values — those
  are technical identifiers and stay in English everywhere.
