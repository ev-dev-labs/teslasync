---
description: "Automation condition: conflict detection — warn if another automation contradicts this one"
---

# Condition: Conflict Detection

## Overview
Not a runtime condition but a **design-time check**. When creating/editing an automation, scan all other enabled automations for potential conflicts:
- Same trigger time + opposite actions (lock at 10 PM vs unlock at 10:05 PM)
- Same trigger event + contradicting commands
- Overlapping geofence triggers with conflicting actions

## Implementation
Create `internal/automation/condition/conflict.go`:
```go
func DetectConflicts(ctx context.Context, automation *models.Automation, allAutomations []*models.Automation) []Conflict
```

Return a list of `Conflict{AutomationID, AutomationName, Reason}` warnings. These are displayed in the UI builder as yellow warnings — they don't block creation but alert the user.

## Integration
Call on automation create/update API. Return conflicts in the response for the UI to display.
