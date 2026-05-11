---
applyTo: "web/**"
---

# Frontend SI Cutover Instructions

These rules apply to ANY change in `web/src/**` after phase-43. They translate
ADR-005 into per-edit guardrails. Violations are caught by the audit gate that
every phase-43 prompt and every future PR runs.

## Prohibited Patterns

```
❌ 1. UI DELETION without explicit user approval
   - Pages, routes, components, hooks are PRESERVED.
   - If a page cannot be ported, BLOCK and surface the missing data source.
   - <EmptyState> is not a substitute for porting.

❌ 2. SI ASSUMPTIONS inside hooks
   - Hooks return raw SI values from the API.
   - Conversion to display units happens at the render boundary via
     lib/unitConversion.ts informed by hooks/useUnits.ts user preference.

❌ 3. DISPLAY UNIT ASSUMPTIONS inside lib/unitConversion.ts
   - Every conversion fn assumes SI input. Document the SI input unit in
     the JSDoc. Never accept "miles or km" — accept meters and convert.

❌ 4. DIRECT API URL CONSTRUCTION
   - Use the request<T>() client at api/client.ts.
   - Hook URLs MUST NOT include /api/v1/ (the client adds it).
   - Query params MUST be snake_case (backend convention).

❌ 5. UNTYPED SSE / EventSource USAGE
   - The typed envelope from phase-42 prompt 0072 is consumed via
     api/sseClient.ts. Direct EventSource construction is forbidden in
     pages/components.

❌ 6. RAW HTML elements (use shared components)
   - <button>, <input>, <table>, <select>, <textarea> are forbidden.
   - Use @/components/ui/{Button,Input,DataTable,Select,Textarea}.

❌ 7. DIRECT recharts/leaflet/framer-motion imports
   - Always import from @/components/charts, @/components/maps,
     @/components/motion barrels.

❌ 8. INLINE STYLES with static CSS variables
   - style={{ color: 'var(--text-primary)' }} → className="text-white/90".
   - Exception: dynamic computed values (ternary, CHART_COLORS[i]).

❌ 9. NEON TEXT for body content
   - text-neon-{cyan|green|amber|...} for body text is forbidden.
   - Use text-{cyan|emerald|amber|...}-300 instead. Neon-on-chip is OK
     when the chip has a matching bg-neon-{X}/10+ backplate.
```

## Required Patterns

```
✅ 1. PORT every page to new SI shapes
   - Read the new Go struct's JSON tags from the regenerated phase-42 code.
   - Update the corresponding api/types.ts interface.
   - Update the page to render new field names + use lib/unitConversion.ts
     for display.

✅ 2. NULL-SAFE field access
   - All optional fields: value ?? 0, label ?? '—', items ?? [].
   - Hook data: const items = data ?? [] before iterating.

✅ 3. i18n EVERY user-visible string
   - <h2>{t('battery.health.title', 'Battery Health')}</h2>
   - The fallback English MUST appear in web/src/i18n/en.json under the
     same key.

✅ 4. PRESERVE engineering principles
   - DRY: extract shared patterns when seen 2+ times.
   - SOLID: one component per file, props instead of mutation.
   - Loading + Error + Empty states for every data source.

✅ 5. BLOCK rather than silently regress
   - If a port is impossible, the prompt's gate must STATUS=BLOCKED with
     a clear "cannot port because..." entry in the log.
```

## Verification at Every Gate

Each phase-43 prompt's gate runs:
1. `cd web && npx tsc --noEmit` (must exit 0)
2. `cd web && npm run build` (must exit 0)
3. Inline grep for the 9 prohibited patterns (must find zero matches in the
   files this prompt touched)
4. `git status --porcelain` (only allowed files changed)

The audit failure mode is BLOCK, not warn. Phase-43 cannot complete with any
prompt at STATUS=BLOCKED.
