---
description: "Software Update FSM: track OTA update lifecycle from available → installed/failed"
---

# Software Update FSM

## Problem

TeslaSync receives software update signals (`SoftwareUpdateVersion`,
`SoftwareUpdateDownloadPercentComplete`, `SoftwareUpdateInstallationPercentComplete`,
`SoftwareUpdateScheduledStartTime`) but has no formal lifecycle tracking. Users see
raw percentages with no context — "Is it downloading? Installing? Stuck?" The
`software_updates` table only tracks version changes (inserted on `InsertIfChanged`),
not the progression through update phases.

## Current State

### Signals Available
```
SoftwareUpdateVersion                       — string (e.g. "2026.12.3")
SoftwareUpdateDownloadPercentComplete       — float (0-100)
SoftwareUpdateInstallationPercentComplete   — float (0-100)
SoftwareUpdateExpectedDurationMinutes       — float
SoftwareUpdateScheduledStartTime            — string (timestamp)
```

### Current Handling (telemetry_handler.go:2374-2486)
- Signals stored as `vehicle_config` snapshot via `vehicleConfigRepo.Insert()`
- Version change detected via `InsertIfChanged()` → logged as `state: 'installed'`
- No state machine, no transition tracking, no progress lifecycle

### Existing FSM Infrastructure
```
internal/fsm/
  command/machine.go           — pattern to follow (State type, transitions, FSM struct)
internal/database/
  fsm_transition_repo.go       — Insert() for transition logging
migrations/000047              — fsm_transitions table schema
web/src/types/fsm.ts           — FSM_STATES, STATE_COLORS, FSMType union
```

## Task

### Step 1: Define States and Triggers

Create `internal/fsm/update/state.go`:

```go
package update

type State string

const (
    // No update available or unknown
    NoUpdate     State = "no_update"

    // Update available but not started
    Available    State = "available"

    // Scheduled — user has set a time for installation
    Scheduled    State = "scheduled"

    // Downloading firmware from Tesla servers
    Downloading  State = "downloading"

    // Download complete, waiting for install conditions (parked, not charging on some models)
    Downloaded   State = "downloaded"

    // Installing firmware — vehicle must remain parked
    Installing   State = "installing"

    // Installation complete, awaiting reboot/confirmation
    Installed    State = "installed"

    // Download or installation failed
    Failed       State = "failed"
)

type Trigger string

const (
    TriggerVersionAvailable   Trigger = "version_available"    // new version detected
    TriggerScheduleSet        Trigger = "schedule_set"         // user scheduled install time
    TriggerDownloadStarted    Trigger = "download_started"     // download_pct > 0
    TriggerDownloadComplete   Trigger = "download_complete"    // download_pct == 100
    TriggerInstallStarted     Trigger = "install_started"      // install_pct > 0
    TriggerInstallComplete    Trigger = "install_complete"     // install_pct == 100 or version changed
    TriggerDownloadFailed     Trigger = "download_failed"      // download_pct stuck or reset
    TriggerInstallFailed      Trigger = "install_failed"       // install_pct stuck or error
    TriggerVersionChanged     Trigger = "version_changed"      // new current version != previous
    TriggerNoUpdate           Trigger = "no_update"            // update signals cleared
)
```

### State Diagram
```
                     ┌──────────────────────────────────┐
                     ▼                                  │
  no_update ──► available ──► scheduled ──► downloading ──► downloaded ──► installing ──► installed
                   │              │              │                             │              │
                   │              │              ▼                             ▼              │
                   │              │           failed ◄────────────────────── failed           │
                   │              │                                                           │
                   └──────────────┴───────────────────────────────────────────────────────────┘
                                                    (version_changed → no_update)
```

### Step 2: Create the FSM Machine

Create `internal/fsm/update/machine.go`:

Follow the `command/machine.go` pattern:

```go
type UpdateFSM struct {
    mu               sync.Mutex
    state            State
    vehicleID        int64
    targetVersion    string           // version being downloaded/installed
    currentVersion   string           // currently running version
    downloadPct      float64
    installPct       float64
    scheduledStart   *time.Time
    expectedDuration int              // minutes
    stateEnteredAt   time.Time
    createdAt        time.Time
    completedAt      *time.Time
    logger           zerolog.Logger
}
```

**Key methods:**
- `ProcessSignals(signals map[string]interface{})` — called on each telemetry batch,
  detects state transitions from signal values
- `Transition(trigger Trigger) error` — validates and executes state transition
- `State() State` — returns current state
- `Snapshot() map[string]interface{}` — returns context for transition logging

**Transition detection logic in `ProcessSignals`:**
```go
func (f *UpdateFSM) ProcessSignals(signals map[string]interface{}) {
    f.mu.Lock()
    defer f.mu.Unlock()

    version := stringSignal(signals, "SoftwareUpdateVersion")
    downloadPct := floatSignal(signals, "SoftwareUpdateDownloadPercentComplete")
    installPct := floatSignal(signals, "SoftwareUpdateInstallationPercentComplete")
    scheduledStart := stringSignal(signals, "SoftwareUpdateScheduledStartTime")
    expectedDur := intSignal(signals, "SoftwareUpdateExpectedDurationMinutes")

    // Detect state transitions based on signal values
    switch f.state {
    case NoUpdate:
        if version != "" && version != f.currentVersion {
            f.targetVersion = version
            f.transition(TriggerVersionAvailable)
        }

    case Available:
        if scheduledStart != "" {
            f.transition(TriggerScheduleSet)
        }
        if downloadPct > 0 {
            f.transition(TriggerDownloadStarted)
        }

    case Scheduled:
        if downloadPct > 0 {
            f.transition(TriggerDownloadStarted)
        }

    case Downloading:
        f.downloadPct = downloadPct
        if downloadPct >= 100 {
            f.transition(TriggerDownloadComplete)
        }

    case Downloaded:
        if installPct > 0 {
            f.transition(TriggerInstallStarted)
        }

    case Installing:
        f.installPct = installPct
        if installPct >= 100 {
            f.transition(TriggerInstallComplete)
        }

    case Installed:
        // Reset after version has been installed for a while
        f.currentVersion = f.targetVersion
        f.targetVersion = ""
        f.transition(TriggerNoUpdate)
    }

    // Global: version changed while in any update state = install complete
    if version != "" && version != f.currentVersion && f.state != NoUpdate && f.state != Available {
        f.currentVersion = version
        f.transition(TriggerVersionChanged)
    }
}
```

### Step 3: Integrate into FSM Handler

In `internal/api/fsm_handler.go`:

- Add `updates map[int64]*update.UpdateFSM` to `FSMHandler`
- Create/get FSM per vehicle when update signals arrive
- Log transitions to `fsm_transitions` table with `fsm_type: "software_update"`
- Include in `FSMHandler.Stats()` response

### Step 4: Wire Signal Processing

In `internal/api/telemetry_handler.go`, in the `trackVehicleConfig()` function
(around line 2374), after extracting software update signals:

```go
// Process through Software Update FSM
if h.fsmHandler != nil {
    h.fsmHandler.ProcessUpdateSignals(vehicleID, signals)
}
```

### Step 5: Register in FSM Debugger

#### Backend
Add `"software_update"` to the list of valid `fsm_type` values in:
- `fsm_transition_repo.go` — query filters
- Router FSM endpoints — type validation

#### Frontend
In `web/src/types/fsm.ts`:

Add to `FSM_STATES`:
```typescript
software_update: ['no_update', 'available', 'scheduled', 'downloading', 'downloaded', 'installing', 'installed', 'failed'],
```

Add to `STATE_COLORS`:
```typescript
software_update: {
  no_update:    { bg: 'bg-gray-500/10',   text: 'text-gray-400',   dot: 'bg-gray-400' },
  available:    { bg: 'bg-blue-500/10',   text: 'text-blue-400',   dot: 'bg-blue-400' },
  scheduled:    { bg: 'bg-purple-500/10', text: 'text-purple-400', dot: 'bg-purple-400' },
  downloading:  { bg: 'bg-cyan-500/10',   text: 'text-cyan-400',   dot: 'bg-cyan-400' },
  downloaded:   { bg: 'bg-teal-500/10',   text: 'text-teal-400',   dot: 'bg-teal-400' },
  installing:   { bg: 'bg-amber-500/10',  text: 'text-amber-400',  dot: 'bg-amber-400' },
  installed:    { bg: 'bg-green-500/10',  text: 'text-green-400',  dot: 'bg-green-400' },
  failed:       { bg: 'bg-red-500/10',    text: 'text-red-400',    dot: 'bg-red-400' },
},
```

Add `'software_update'` to the `FSMType` union type.

### Step 6: Add to Software Updates Page

In the existing Software Updates page (if one exists) or in the vehicle detail view,
show the current update state:

```tsx
<StatCard
  label={t('update.status', 'Update Status')}
  value={updateState}  // "Downloading 42%", "Installing 78%", "No Update"
  icon={<Download className="h-4 w-4" />}
/>
```

When in `downloading` or `installing` state, show a progress bar:
```tsx
{(state === 'downloading' || state === 'installing') && (
  <MetricBar
    label={state === 'downloading' ? t('Downloading') : t('Installing')}
    value={state === 'downloading' ? downloadPct : installPct}
    max={100}
  />
)}
```

### Step 7: MQTT Publishing (Optional)

Publish update state transitions to MQTT for Home Assistant integration:

```go
// In transition handler:
h.mqttClient.Publish(vin+"/software_update/state", string(newState))
h.mqttClient.Publish(vin+"/software_update/version", targetVersion)
h.mqttClient.Publish(vin+"/software_update/progress", fmt.Sprintf("%d", pct))
```

### Step 8: Unit Tests

Create `internal/fsm/update/machine_test.go`:

Table-driven tests covering:
- Full happy path: no_update → available → downloading → downloaded → installing → installed → no_update
- Scheduled path: available → scheduled → downloading → ...
- Download failure: downloading → failed
- Install failure: installing → failed
- Version jump: downloading → version_changed → installed (OTA completed during install)
- No-op: signals with no state change
- Concurrent signal processing safety

## Verification

```bash
# Build
CGO_ENABLED=0 go build ./cmd/teslasync

# Tests
go test -count=1 -v ./internal/fsm/update/...

# Full test suite
go test -count=1 ./internal/...

# Frontend types
cd web && npx tsc --noEmit
```

- [ ] FSM transitions logged to `fsm_transitions` with `fsm_type = 'software_update'`
- [ ] FSM debugger shows software_update in the type dropdown
- [ ] State diagram renders with correct colors
- [ ] Download/install progress visible in transition context snapshots

## Commit

```bash
git add -A
git commit -m "feat(fsm): add Software Update FSM for OTA update lifecycle tracking

- Define 8 states: no_update → available → scheduled → downloading → downloaded → installing → installed / failed
- Create UpdateFSM with signal-driven transition detection
- Integrate with FSM handler and transition logging
- Register in FSM debugger (backend + frontend state/color definitions)
- Add unit tests for all transition paths
- Publish update state to MQTT for Home Assistant"
```

## What NOT To Change

- Do not modify the existing `software_updates` table — it tracks version history, not lifecycle
- Do not change how `trackVehicleConfig()` stores vehicle config snapshots
- Do not modify other FSMs (vehicle, command, drive, charge)
- Do not add new migrations for the FSM itself — reuse the existing `fsm_transitions` table
