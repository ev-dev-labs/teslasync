---
description: "Automation action: auto-wake — automatically wake vehicle before sending commands"
---

# Action: Auto-Wake Dependency

## Overview
Many commands require the vehicle to be awake. The action executor should automatically detect when a vehicle is asleep and wake it before sending the command, without the user needing to add an explicit "wake" action.

## Implementation
In `internal/automation/action/command.go`, before executing any command:
1. Check vehicle state from DB/cache
2. If `state == "asleep"` or `state == "offline"`:
   a. Send `wake_up` command
   b. Poll vehicle state every 5s for up to 30s
   c. If awake → proceed with command
   d. If timeout → fail action with "vehicle did not wake up"
3. Log the wake attempt in the action results as a sub-action

This mirrors the existing `CommandHandler` FSM behavior (wake → send) but at the automation engine level.
