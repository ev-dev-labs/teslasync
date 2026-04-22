---
description: "Phase 7 — Update features/notifications for typed channel configs"
---

# 🟢 Frontend 43 — Update features/notifications for typed channel configs

> **Severity:** Foundational | **Priority:** High | **Prompt #:** 43 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | Files under `features/notifications` flagged by `tsc --noEmit` |
| Depends on | 42-fix-pages-telemetry |
| Blocks | 44-tsc-and-lint |
| ADR refs | ADR-001, ADR-002, ADR-004 |


## Single Goal

Rewrite channel CRUD forms so each channel kind renders its own typed input set. Replace any `channel.config.foo` with kind-narrowed access on the discriminated union.

## Recommendation

### Step 1 — capture worklist

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Select-String 'features/notifications' | Tee-Object -FilePath ..\.github\prompts\db-refactor\logs\phase-7-43-tsc.log
```

### Step 2 — find dead-field reads

```powershell
Select-String -Path src\features/notifications\**\*.tsx,src\features/notifications\**\*.ts -Pattern 'channel\.config|Record<string,\s*any>'
```

### Step 3 — apply replacement patterns

| Old | New |
|-----|-----|
| `channel.config.webhook_url` | `channel.kind === 'discord' \|\| channel.kind === 'slack' ? channel.webhook_url : ''` |
| `channel.config.bot_token` | `channel.kind === 'telegram' ? channel.bot_token : ''` |
| `<Input value={channel.config.smtp_host} />` | render only inside an `if (channel.kind === 'email')` branch |

Use a `switch (channel.kind)` block to render per-kind form fields.

### Sample pages to start from

- `web/src/features/notifications/pages/NotificationsPage.tsx`
- `web/src/features/notifications/pages/ChannelDetailPage.tsx`
- `web/src/features/notifications/components/*` (channel form components)

### Section rendering rule

Per project rules, every section panel MUST always render. When data is absent, show `<EmptyState message={t('...')} />` — never hide the panel with `{data && ...}`.

## Acceptance Criteria

- [ ] Zero `tsc --noEmit` errors originating from `src/features/notifications/`
- [ ] No `as any` introduced in this prompt's diff
- [ ] All sections render their panel shell with `EmptyState` fallback
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Select-String 'features/notifications'
# Expected: 0 hits
```

## Out of Scope

- Don't refactor unrelated pages
- Don't restyle / change Tailwind classes
- Don't run lint here (prompt 44)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): fix features/notifications pages after type refactor

Resolved tsc errors in features/notifications by switching reads to typed snapshot
cols / SignalObservation / AutomationFull / typed channel configs.
All sections show EmptyState when data absent.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/instructions/react-frontend.instructions.md` (null safety, EmptyState rules)
