---
description: "Automation safety: loop detection — detect and break circular automation chains"
---

# Safety: Loop Detection

## Implementation
Create `internal/automation/safety/loop_detection.go`. Track currently-executing automations in a set. If automation A triggers B which triggers A → detect cycle and break with error. Also detect rapid-fire: if same automation fires >5 times in 1 minute → auto-pause and notify. Use a sliding window counter per automation ID.
