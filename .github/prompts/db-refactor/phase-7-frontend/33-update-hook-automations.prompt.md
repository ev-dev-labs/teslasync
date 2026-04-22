---
description: "Phase 7 — `useAutomation` returns AutomationFull; add `useCreateAutomationFull`, `useUpdateAutomationFull`"
---

# 🔵 Frontend 33 — `useAutomation` returns AutomationFull; add `useCreateAutomationFull`, `useUpdateAutomationFull`

> **Severity:** Architectural | **Priority:** High | **Prompt #:** 33 of 44

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `web/src/api/hooks/useAutomations.ts` |
| Depends on | 32-update-hook-telemetry |
| Blocks | 34-update-hook-driving |
| ADR refs | ADR-004 |


## Single Goal

Switch single-automation read to `AutomationFull`. Add CTI-aware create/update mutations that accept the composite shape.

## Recommendation

### Edit `web/src/api/hooks/useAutomations.ts`

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import type {
  Automation, AutomationFull, AutomationStep,
} from '../types';

// List unchanged (returns Automation[] parents)
export function useAutomations() {
  return useQuery({
    queryKey: ['automations'],
    queryFn: () => request<Automation[]>('/automations'),
    staleTime: 30_000,
  });
}

export function useAutomation(id: number | string | undefined) {
  return useQuery({
    queryKey: ['automation', id],
    queryFn: () => request<AutomationFull>(`/automations/${id}`),
    enabled: !!id,
  });
}

export type AutomationFullInput = Omit<AutomationFull,
  'id' | 'created_at' | 'updated_at' | 'triggers' | 'conditions' | 'actions'> & {
  triggers: Omit<AutomationStep, 'id' | 'automation_id' | 'created_at'>[];
  conditions: Omit<AutomationStep, 'id' | 'automation_id' | 'created_at'>[];
  actions: Omit<AutomationStep, 'id' | 'automation_id' | 'created_at'>[];
};

export function useCreateAutomationFull() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AutomationFullInput) =>
      request<AutomationFull>('/automations', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automations'] }),
  });
}

export function useUpdateAutomationFull() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: AutomationFullInput }) =>
      request<AutomationFull>(`/automations/${id}`, { method: 'PUT', body: input }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['automations'] });
      qc.invalidateQueries({ queryKey: ['automation', vars.id] });
    },
  });
}
```

Drop any legacy mutations that took `trigger_config`/`conditions: any`/`actions: any`.

## Acceptance Criteria

- [ ] `useAutomation` returns `AutomationFull`
- [ ] `useCreateAutomationFull` and `useUpdateAutomationFull` exist and accept CTI shape
- [ ] No `trigger_config` / `conditions: any` / `actions: any` in this file
- [ ] No `/api/v1/` prefix
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\web
Select-String -Path src\api\hooks\useAutomations.ts -Pattern 'AutomationFull'
# Expected: >= 3 hits
Select-String -Path src\api\hooks\useAutomations.ts -Pattern 'trigger_config|conditions:\s*any|actions:\s*any'
# Expected: 0 hits
```

## Out of Scope

- Don't update automation pages here (prompt 41)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add web/
git commit -m "web(db-refactor): useAutomation returns AutomationFull; add CTI mutations

Composite read shape with 3 step lanes; create/update accept the same
shape minus server-managed fields.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
