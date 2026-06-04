# ADR-014 — Localization (i18n) parity across platforms

**Status:** Accepted · 2026-06 · Supersedes: none

## Context

The web app localizes via `react-i18next` with translation keys; "no hardcoded English
strings" is a standing rule. Native apps must match the same locales and every user-facing
string, while using each platform's native localization system.

## Decision

- **Source of truth:** the web app's translation catalogs (`web/src/**/locales` keys) are
  the canonical key set. P1 extracts them into a neutral catalog under `apps/shared/i18n/`.
- **Per-platform generation:** the neutral catalog is generated into native resources:
  - Android → `res/values*/strings.xml`
  - Windows → `.resw` (Resources.resw) / `ResourceManager`
  - Apple → String Catalogs (`.xcstrings`)
- **Rule:** every user-facing string uses a key resolved through the native i18n API. The
  placeholder-grep gate (ADR-011) flags string literals in UI as violations.
- **Formatting:** locale-aware number/date/unit formatting flows through the shared core
  (SI converters + `useUnits` equivalent), not ad-hoc per screen.

## Consequences

- ✅ One key set, all platforms in sync; new web strings become parity gaps automatically.
- ✅ Native pluralization, RTL, and locale switching handled by each OS.
- ⚠️ A generation step must keep `.xml`/`.resw`/`.xcstrings` derived from the neutral catalog;
  CI flags drift. Translators edit the neutral catalog, not per-platform files.
- ⚠️ Unit display (mi/km, °C/°F) is user-preference, applied at the display boundary (SI in,
  preference out) — consistent with the SI-canonical backend (Phase-48).

## Alternatives rejected

- **Independent per-platform string files:** drift; the web↔native gap reappears.
- **Hardcode English, translate later:** violates the standing rule + ADR-011.
