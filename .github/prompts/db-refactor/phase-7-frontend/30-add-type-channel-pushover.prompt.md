---
description: "Phase 7 — Add typed config for `pushover` notification channel"
---

# 🔵 Frontend 30 — Add typed config for `pushover` notification channel

> **Severity:** Architectural | **Priority:** Medium | **Prompt #:** 30 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/notifications.ts` (new on first prompt; extend after) |
| Depends on | 29-add-type-channel-ntfy |
| Blocks | 31-update-hook-vehicles |
| ADR refs | ADR-001, ADR-004 |


## Single Goal

Add the typed config interface for the `pushover` channel kind. Replaces the loose `config: Record<string, any>` previously on `NotificationChannel`.

## Recommendation

### Edit `web/src/types/notifications.ts`

If this is the first channel prompt, also add the parent shape:

```typescript
export type NotificationChannelKind =
  | 'discord' | 'slack' | 'telegram' | 'email' | 'webhook' | 'ntfy' | 'pushover';

export interface NotificationChannelBase {
  id: number;
  name: string;
  kind: NotificationChannelKind;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}
```

Then add the `pushover`-specific child:

```typescript
export interface NotificationChannelPushover extends NotificationChannelBase {
  kind: 'pushover';
  user_key: string;
  app_token: string;
  device: string | null;
  priority: -2 | -1 | 0 | 1 | 2;
}
```

Extend the `NotificationChannel` discriminated union to include this kind.

## Acceptance Criteria

- [ ] Channel interface present with literal `kind: 'pushover'`
- [ ] Fields (user_key, app_token, device, priority) typed, no jsonb
- [ ] Added to `NotificationChannel` union
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\notifications.ts -Pattern "kind: 'pushover'"
# Expected: >= 2 hits (interface + union)
```

## Out of Scope

- Don't update useNotifications hook (prompt 37)
- Don't add other channel kinds in this prompt

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add typed config for pushover notification channel

Replaces loose Record<string,any> config with typed interface (user_key, app_token, device, priority).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
