---
description: "Phase 7 — Add typed config for `email` notification channel"
---

# 🔵 Frontend 27 — Add typed config for `email` notification channel

> **Severity:** Architectural | **Priority:** Medium | **Prompt #:** 27 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/types/notifications.ts` (new on first prompt; extend after) |
| Depends on | 26-add-type-channel-telegram |
| Blocks | 28-add-type-channel-webhook |
| ADR refs | ADR-001, ADR-004 |


## Single Goal

Add the typed config interface for the `email` channel kind. Replaces the loose `config: Record<string, any>` previously on `NotificationChannel`.

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

Then add the `email`-specific child:

```typescript
export interface NotificationChannelEmail extends NotificationChannelBase {
  kind: 'email';
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  from_address: string;
  to_addresses: string[];
  use_tls: boolean;
}
```

Extend the `NotificationChannel` discriminated union to include this kind.

## Acceptance Criteria

- [ ] Channel interface present with literal `kind: 'email'`
- [ ] Fields (smtp_host/port/user/pass, from, to[], use_tls) typed, no jsonb
- [ ] Added to `NotificationChannel` union
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\types\notifications.ts -Pattern "kind: 'email'"
# Expected: >= 2 hits (interface + union)
```

## Out of Scope

- Don't update useNotifications hook (prompt 37)
- Don't add other channel kinds in this prompt

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): add typed config for email notification channel

Replaces loose Record<string,any> config with typed interface (smtp_host/port/user/pass, from, to[], use_tls).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
