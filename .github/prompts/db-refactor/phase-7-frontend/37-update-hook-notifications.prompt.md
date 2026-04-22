---
description: "Phase 7 — `NotificationChannel.config` typed per-kind; finalize union"
---

# 🔵 Frontend 37 — `NotificationChannel.config` typed per-kind; finalize union

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 37 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/api/hooks/useNotifications.ts`, `web/src/types/notifications.ts` |
| Depends on | 36-update-hook-trips |
| Blocks | 38-update-hook-vehicle-systems |
| ADR refs | ADR-001, ADR-004 |


## Single Goal

Finalize the `NotificationChannel` discriminated union (covering all 7 kinds from prompts 24–30) and update hook return types so `config: Record<string, any>` is gone.

## Recommendation

### Edit `web/src/types/notifications.ts`

Append (if not already done by prompt 30):

```typescript
export type NotificationChannel =
  | NotificationChannelDiscord
  | NotificationChannelSlack
  | NotificationChannelTelegram
  | NotificationChannelEmail
  | NotificationChannelWebhook
  | NotificationChannelNtfy
  | NotificationChannelPushover;
```

### Edit `web/src/api/types.ts`

```typescript
export type {
  NotificationChannel, NotificationChannelKind, NotificationChannelBase,
  NotificationChannelDiscord, NotificationChannelSlack, NotificationChannelTelegram,
  NotificationChannelEmail, NotificationChannelWebhook,
  NotificationChannelNtfy, NotificationChannelPushover,
} from '@/types/notifications';
```

### Edit `web/src/api/hooks/useNotifications.ts`

Replace any `Record<string, any>` config field on the hook return types with the new `NotificationChannel` union. Mutations that create/update channels should accept a discriminated input (`Omit<NotificationChannel, 'id' | 'created_at' | 'updated_at'>`).

## Acceptance Criteria

- [ ] `NotificationChannel` union covers exactly 7 kinds
- [ ] Re-exported from `api/types.ts`
- [ ] Hook contains 0 `Record<string, any>` references
- [ ] No `/api/v1/` prefix in URLs
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\notifications.ts -Pattern 'export type NotificationChannel\b'
# Expected: 1 hit
Select-String -Path src\api\hooks\useNotifications.ts -Pattern 'Record<string,\s*any>'
# Expected: 0 hits
```

## Out of Scope

- Don't update notifications pages (prompt 43)
- Don't add new channel kinds beyond the 7

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): useNotifications uses typed channel discriminated union

All 7 channel kinds (discord/slack/telegram/email/webhook/ntfy/pushover)
now typed; loose Record<string,any> eliminated.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
