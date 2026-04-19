---
description: "Add command history/audit log page with filters and timeline view"
---

# Command History Page

## Problem

Users can send commands but have no way to review what was sent, when, and whether
it succeeded. The Commands page shows a brief "✓ 2m ago" per command type but no
detailed log. Debugging failed commands requires checking backend logs.

## Current State

### Backend (already exists ✅)
```
GET /api/v1/vehicles/{vehicleID}/commands/history — full command log
GET /api/v1/vehicles/{vehicleID}/commands/latest  — most recent per command type
GET /api/v1/audit                                  — system audit log
```

**CommandLogEntry model:**
```typescript
interface CommandLogEntry {
  id: number;
  vehicle_id: number;
  command: string;
  params: string;       // JSON string
  status: string;       // 'success' | 'error'
  error: string;        // error message if failed
  created_at: string;   // ISO timestamp
}
```

### Frontend
- No dedicated history page — only inline status on Commands page tiles
- No API hook for command history — uses inline `request()` call

## Task

### Step 1: Create API Hook

Add to `web/src/api/hooks/useCommands.ts` (new file or add to existing):

```typescript
export function useCommandHistory(vehicleId: string | undefined, options?: {
  limit?: number;
  offset?: number;
  command?: string;  // filter by command name
  status?: string;   // filter by status
}) {
  return useQuery({
    queryKey: ['command-history', vehicleId, options],
    queryFn: () => {
      const params = new URLSearchParams();
      if (options?.limit) params.set('limit', String(options.limit));
      if (options?.offset) params.set('offset', String(options.offset));
      if (options?.command) params.set('command', options.command);
      if (options?.status) params.set('status', options.status);
      return request<CommandLogEntry[]>(`/vehicles/${vehicleId}/commands/history?${params}`);
    },
    enabled: !!vehicleId,
    staleTime: 10_000,
  });
}
```

### Step 2: Create Command History Page

Create `web/src/features/system/pages/CommandHistoryPage.tsx`:

**Layout:**
- PageContainer with title "Command History"
- Vehicle selector dropdown (if multiple vehicles)
- Filter bar: status filter (All / Success / Failed), command name search
- Timeline view of commands

**Sections:**

1. **Stats Row** — 4 StatCards:
   - Total commands (last 24h)
   - Success rate (%)
   - Most used command
   - Last command sent

2. **Filter Bar** — Row with:
   - Vehicle selector (if fleet > 1)
   - Status filter: All | Success | Failed (use TabNav or Badge toggles)
   - Command name search (Input)
   - Date range filter (DateRangeFilter from @/components/forms)

3. **Command Timeline** — Using Timeline/TimelineItem from @/components/data-display:
   ```tsx
   <Timeline>
     {commands.map(cmd => (
       <TimelineItem
         key={cmd.id}
         timestamp={cmd.created_at}
         icon={cmd.status === 'success' ? <CheckCircle /> : <XCircle />}
         variant={cmd.status === 'success' ? 'success' : 'danger'}
       >
         <div className="flex items-center justify-between">
           <span className="font-medium">{formatCommandName(cmd.command)}</span>
           <span className="text-xs text-white/40">{timeAgo(cmd.created_at)}</span>
         </div>
         {cmd.params && cmd.params !== '{}' && (
           <span className="text-xs text-white/40">Params: {cmd.params}</span>
         )}
         {cmd.error && (
           <span className="text-xs text-neon-red">{cmd.error}</span>
         )}
       </TimelineItem>
     ))}
   </Timeline>
   ```

4. **Pagination** — Use Pagination from @/components/ui

### Step 3: Add Route

In `web/src/App.tsx` (or router config), add route:
```tsx
const CommandHistoryPage = lazy(() => import('./features/system/pages/CommandHistoryPage'));
// Route: /commands/history
```

### Step 4: Add Navigation Link

Add "Command History" to the sidebar under CONTROL section (after Commands):
- Icon: `History` from lucide-react
- Link to `/commands/history`

Also add a "View History" link on the Commands page header (actions slot).

### Step 5: Helper Function

Create a `formatCommandName` utility that converts API command names to
human-readable labels:
```typescript
function formatCommandName(cmd: string): string {
  const map: Record<string, string> = {
    'lock': 'Lock',
    'unlock': 'Unlock',
    'climate_on': 'Climate ON',
    'climate_off': 'Climate OFF',
    'wake_up': 'Wake Up',
    'honk_horn': 'Horn',
    // ... all command names
  };
  return map[cmd] ?? cmd.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
```

## Verification

```bash
cd web && npx tsc --noEmit
```

- [ ] Page loads and shows command history for selected vehicle
- [ ] Filters work: status filter, command search, date range
- [ ] Timeline shows success (green) and failed (red) indicators
- [ ] Failed commands show error message
- [ ] Pagination works for long histories
- [ ] "View History" link works from Commands page

## Commit

```bash
git add -A
git commit -m "feat(web): add Command History page with timeline and filters

- Create useCommandHistory API hook
- Create CommandHistoryPage with stats, filters, and timeline view
- Add route /commands/history with lazy loading
- Add sidebar navigation link under CONTROL section
- Add formatCommandName utility for human-readable labels"
```
