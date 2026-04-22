---
description: "Phase 7 — Add typed config for `ntfy` notification channel"
---

# 🔵 Frontend 29 — Add typed config for `ntfy` notification channel

> **Severity:** Architectural | **Priority:** Medium | **Prompt #:** 29 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/notifications.ts` (new on first prompt; extend after) |
| Depends on | 28-add-type-channel-webhook |
| Blocks | 30-add-type-channel-pushover |
| ADR refs | ADR-001, ADR-004 |


## Single Goal

Add the typed config interface for the `ntfy` channel kind. Replaces the loose `config: Record<string, any>` previously on `NotificationChannel`.

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

Then add the `ntfy`-specific child:

```typescript
export interface NotificationChannelNtfy extends NotificationChannelBase {
  kind: 'ntfy';
  server_url: string;
  topic: string;
  priority: 1 | 2 | 3 | 4 | 5;
  username: string | null;
  password: string | null;
}
```

Extend the `NotificationChannel` discriminated union to include this kind.

## Acceptance Criteria

- [ ] Channel interface present with literal `kind: 'ntfy'`
- [ ] Fields (server_url, topic, priority, optional auth) typed, no jsonb
- [ ] Added to `NotificationChannel` union
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\notifications.ts -Pattern "kind: 'ntfy'"
# Expected: >= 2 hits (interface + union)
```

## Out of Scope

- Don't update useNotifications hook (prompt 37)
- Don't add other channel kinds in this prompt

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add typed config for ntfy notification channel

Replaces loose Record<string,any> config with typed interface (server_url, topic, priority, optional auth).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
