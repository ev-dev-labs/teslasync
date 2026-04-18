---
description: "Automations UI: list page with automation cards, toggles, history log, and live activity"
---

# Page: Automations List

## Overview
Create `web/src/features/automations/pages/AutomationsListPage.tsx` — the main automations hub.

## Layout
```
┌──────────────────────────────────────────────────────────┐
│ ⚡ Automations                    [+ Create] [Import]    │
├──────────────────────────────────────────────────────────┤
│ Stats: 12 total · 8 active · 3 paused · 1 disabled      │
├──────────────────────────────────────────────────────────┤
│ Filter: [All ▼] [All Triggers ▼] [Search...]             │
├──────────────────────────────────────────────────────────┤
│ ┌─ Morning Commute Prep ─────── [ON] ── ⚡ ── [⋯] ────┐ │
│ │ 🕐 Weekdays at 7:15 AM → 🚗 Falcon                  │ │
│ │ Climate ON → Wait 10s → Seat Heat Driver              │ │
│ │ IF: Outside temp < 40°F                               │ │
│ │ Last: ✓ 2h ago · Runs: 142 · Fails: 2                │ │
│ │ ⚠ Conflict with "Night Security" (lock vs unlock)     │ │
│ └──────────────────────────────────────────────────────┘ │
│ ... more cards ...                                       │
├──────────────────────────────────────────────────────────┤
│ 📋 Recent Activity (live via SSE)                        │
│ ✓ Morning Commute Prep — 7:15 AM — 1.2s — 3 actions     │
│ ✗ Garage Door — yesterday — HomeLink failed              │
│ ⊘ Smart Charging — skipped — battery already > 80%       │
│ [View All History]                                       │
└──────────────────────────────────────────────────────────┘
```

## Components
- **AutomationCard** — name, trigger summary, action chain preview, conditions, last run status, run count, toggle, kebab menu (edit, duplicate, test run, export, delete, undo last)
- **Activity feed** — live SSE subscription showing recent executions
- **Stats bar** — total, active, paused, disabled, auto-disabled (red warning)
- **Filters** — by trigger type, by vehicle, search by name

## Hooks
```typescript
useAutomations()                    // GET /automations
useAutomationHistory(limit)         // GET /automations/history
useToggleAutomation(id)             // PATCH /automations/{id}/toggle
useDeleteAutomation(id)             // DELETE /automations/{id}
useAutomationSSE()                  // EventSource /automations/events
```

## Route
```typescript
const AutomationsListPage = lazy(() => import('./features/automations/pages/AutomationsListPage'));
<Route path="/automations" element={<AutomationsListPage />} />
```

Add "Automations" to the sidebar nav under CONTROL section.

## Verification
```bash
cd web && npx tsc --noEmit
# audit_code for violations
```
