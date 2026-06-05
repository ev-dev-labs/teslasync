# `apps/shared/i18n` — neutral i18n catalog (ADR-014)

Single source of truth for native-app strings, derived from the web app's
`react-i18next` catalogs (`web/src/i18n/{en,ar,he}.json`). The web base locale (`en`) is the
canonical key set; native resources are **generated**, never hand-written (ADR-014).

```
apps/shared/i18n/
  catalog/
    _index.json            locale metadata + translation coverage
    en.json ar.json he.json neutral flat catalog (keyed by `translation.<dotted.key>`)
  generators/
    gen-i18n.ts            ingestor + Windows/.resw, Android/strings.xml, Apple/.xcstrings emitters + checker
    gen-i18n.ps1           runner (default = write, -Check = drift gate, -Gate = log)
    INTERPOLATION-MAPPING.md  token + plural mapping per platform
```

Generated native resources live under each platform tree:

```
apps/android/app/src/main/res/values{,-ar,-he}/strings.xml
apps/apple/Localization/Localizable.xcstrings
apps/windows/Strings/{en,ar,he}/Resources.resw
```

## Regenerate

```powershell
pwsh apps/shared/i18n/generators/gen-i18n.ps1          # rewrite catalog + resources
pwsh apps/shared/i18n/generators/gen-i18n.ps1 -Check   # completeness + drift gate (CI)
pwsh apps/shared/i18n/generators/gen-i18n.ps1 -Gate    # both + structured log
```

Translators edit the **web** catalogs (`web/src/i18n/*.json`); never edit the generated
files. CI (`-Check`) fails on any drift between the web source and the committed resources.
See [`generators/INTERPOLATION-MAPPING.md`](generators/INTERPOLATION-MAPPING.md) for the
token/plural mapping and the fallback-materialization policy for placeholder locales.
