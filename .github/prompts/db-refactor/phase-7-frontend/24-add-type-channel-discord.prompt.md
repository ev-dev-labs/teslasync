---
description: "Phase 7 — Add typed config for `discord` notification channel"
---

# 🔵 Frontend 24 — Add typed config for `discord` notification channel

> **Severity:** Architectural | **Priority:** Medium | **Prompt #:** 24 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/notifications.ts` (new on first prompt; extend after) |
| Depends on | 23-add-type-step-action-set-state |
| Blocks | 25-add-type-channel-slack |
| ADR refs | ADR-001, ADR-004 |


## Single Goal

Add the typed config interface for the `discord` channel kind. Replaces the loose `config: Record<string, any>` previously on `NotificationChannel`.

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

Then add the `discord`-specific child:

```typescript
export interface NotificationChannelDiscord extends NotificationChannelBase {
  kind: 'discord';
  webhook_url: string;
  username: string | null;
  avatar_url: string | null;
}
```

Extend the `NotificationChannel` discriminated union to include this kind.

## Acceptance Criteria

- [ ] Channel interface present with literal `kind: 'discord'`
- [ ] Fields (webhook_url, username, avatar_url) typed, no jsonb
- [ ] Added to `NotificationChannel` union
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\notifications.ts -Pattern "kind: 'discord'"
# Expected: >= 2 hits (interface + union)
```

## Out of Scope

- Don't update useNotifications hook (prompt 37)
- Don't add other channel kinds in this prompt

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add typed config for discord notification channel

Replaces loose Record<string,any> config with typed interface (webhook_url, username, avatar_url).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
