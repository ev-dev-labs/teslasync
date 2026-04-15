---
name: audit-violations
description: >
  Run a comprehensive engineering guideline violations audit on TeslaSync code.
  Use this skill when asked to audit, check, or validate code quality, or when
  checking for inline styles, raw HTML, wrong imports, or other violations.
allowed-tools: shell
---

# Audit Violations Skill

Run the `audit.sh` script from this skill's directory to perform a full violations scan.

## Usage

When asked to audit code for violations, run the audit script:

```bash
bash .github/skills/audit-violations/audit.sh [path]
```

- If no path is given, it audits all frontend pages (`web/src/features/`)
- If a path is given, it audits that specific file or directory

## What It Checks

The audit covers these categories:

1. **Static inline styles** — `style={{...var(--...}}` without dynamic expressions
2. **Raw HTML elements** — `<button>`, `<input>`, `<textarea>`, `<select>`, `<table>` outside components/ui/
3. **Direct library imports** — `from 'recharts'`, `from 'react-leaflet'` outside component barrels
4. **Old API imports** — `from '../api'` or `from '../../api'`
5. **Double prefix** — `/api/v1/` in hook URL strings
6. **camelCase params** — `vehicleId=` in URL strings
7. **TypeScript** — `npx tsc --noEmit` pass/fail

## Interpreting Results

- **0 violations** = file is clean
- Each violation shows: file, line number, rule ID, matched code
- Files inside `components/ui/`, `components/charts/`, `components/maps/` are EXCLUDED from raw HTML and library import checks (they are the shared components)
- Dynamic inline styles (ternary, computed, CHART_COLORS[i]) are NOT violations
