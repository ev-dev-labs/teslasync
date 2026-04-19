---
description: "MQTT Command Subscription: receive and execute vehicle commands from HA and MQTT clients"
---

# MQTT Command Subscription

## Problem

MQTT communication is currently **one-way** — TeslaSync publishes state, but cannot
receive commands from external systems. Home Assistant users want to lock/unlock,
start climate, and honk horn from their HA dashboard or automations. Node-RED users
want to build custom flows that send Tesla commands. Any MQTT client should be able
to trigger vehicle actions.

## Current State

```
internal/mqtt/mqtt.go               — Client with Publish() only, no Subscribe() for commands
internal/mqtt/subscriber.go         — Existing subscriber for Fleet Telemetry (inbound signals)
internal/api/command_handler.go     — HTTP command handler (reuse for MQTT commands)
internal/api/apikey_middleware.go    — API key auth (already exists)
```

### Existing Command Flow (HTTP)
```
Frontend → POST /api/v1/vehicles/{id}/command → CommandHandler.SendCommand()
  → Tesla API → result → command_logs table → toast notification
```

MQTT commands will use the **same execution path** — just a new entry point.

## Task

### Step 1: Create MQTT Command Subscriber

Create `internal/mqtt/command_subscriber.go`:

```go
package mqtt

import (
    "context"
    "encoding/json"
    "fmt"
    "strings"
    "sync"
    "time"

    pahomqtt "github.com/eclipse/paho.mqtt.golang"
    "github.com/rs/zerolog/log"
)

// CommandRequest represents an incoming MQTT command.
type CommandRequest struct {
    Command string            `json:"command"`
    Params  map[string]string `json:"params,omitempty"`
}

// CommandResult is published after command execution.
type CommandResult struct {
    Command    string `json:"command"`
    Success    bool   `json:"success"`
    Error      string `json:"error,omitempty"`
    DurationMs int64  `json:"duration_ms"`
    Timestamp  string `json:"timestamp"`
}

// CommandExecutor is the interface for executing vehicle commands.
// Implemented by the API command handler.
type CommandExecutor interface {
    ExecuteByVIN(ctx context.Context, vin string, command string, params map[string]string) (bool, string, error)
}

// CommandSubscriber listens for vehicle commands on MQTT and executes them.
type CommandSubscriber struct {
    client      pahomqtt.Client
    prefix      string
    publisher   *Client
    executor    CommandExecutor
    allowlist   map[string]bool
    rateLimiter *commandRateLimiter
    ctx         context.Context
}

// CommandSubscriberConfig configures the MQTT command subscriber.
type CommandSubscriberConfig struct {
    Allowlist       []string      // commands allowed via MQTT (empty = use default safe list)
    RateLimit       int           // max commands per minute per vehicle (default: 10)
    WakeRateLimit   int           // max wake commands per 5 minutes per vehicle (default: 2)
    AutoWake        bool          // automatically wake vehicle before command (default: true)
    DedupWindow     time.Duration // ignore duplicate commands within this window (default: 5s)
}
```

### Step 2: Default Safe Command Allowlist

```go
// DefaultCommandAllowlist contains commands safe to execute from MQTT.
// Dangerous commands (erase_user_data, remote_start) are NOT included.
var DefaultCommandAllowlist = []string{
    // Security
    "lock", "unlock", "wake_up",
    "sentry_on", "sentry_off",

    // Climate
    "climate_on", "climate_off",
    "set_temps",
    "seat_heater",
    "steering_wheel_heater",

    // Charging
    "charge_start", "charge_stop",
    "charge_port_open", "charge_port_close",
    "set_charge_limit",
    "set_charging_amps",

    // Alerts
    "honk_horn", "flash_lights",

    // Doors
    "actuate_trunk",  // frunk/trunk

    // Windows
    "vent_windows", "close_windows",

    // Media
    "media_toggle_playback",
    "media_next_track", "media_prev_track",
    "media_volume_up", "media_volume_down",
}

// ExplicitlyDenied are commands that can NEVER be executed via MQTT
// regardless of allowlist configuration.
var ExplicitlyDenied = []string{
    "erase_user_data",
    "remote_start",
    "speed_limit_clear_pin_admin",
    "clear_pin_to_drive_admin",
}
```

### Step 3: Subscribe to Command Topics

```go
func (s *CommandSubscriber) Start() error {
    // Subscribe to both topic formats:

    // Format 1: JSON payload on main command topic
    //   teslasync/{VIN}/command → {"command":"lock","params":{...}}
    topic1 := fmt.Sprintf("%s/+/command", s.prefix)

    // Format 2: Topic-per-command (simpler for HA)
    //   teslasync/{VIN}/command/lock → (empty or "true")
    //   teslasync/{VIN}/command/set_temps → "22"
    topic2 := fmt.Sprintf("%s/+/command/+", s.prefix)

    s.client.Subscribe(topic1, 1, s.handleJSONCommand)
    s.client.Subscribe(topic2, 1, s.handleSimpleCommand)

    log.Info().
        Str("json_topic", topic1).
        Str("simple_topic", topic2).
        Int("allowlist_size", len(s.allowlist)).
        Msg("MQTT command subscriber started")

    return nil
}
```

### Step 4: Command Handlers

```go
// handleJSONCommand processes: teslasync/{VIN}/command → {"command":"lock"}
func (s *CommandSubscriber) handleJSONCommand(client pahomqtt.Client, msg pahomqtt.Message) {
    // Extract VIN from topic: {prefix}/{VIN}/command
    parts := strings.Split(msg.Topic(), "/")
    if len(parts) < 3 {
        return
    }
    vin := parts[len(parts)-2]

    var req CommandRequest
    if err := json.Unmarshal(msg.Payload(), &req); err != nil {
        log.Warn().Err(err).Str("topic", msg.Topic()).Msg("MQTT command: invalid JSON payload")
        s.publishResult(vin, "unknown", false, "invalid JSON payload")
        return
    }

    s.executeCommand(vin, req.Command, req.Params)
}

// handleSimpleCommand processes: teslasync/{VIN}/command/{cmdName} → optional params
func (s *CommandSubscriber) handleSimpleCommand(client pahomqtt.Client, msg pahomqtt.Message) {
    // Extract VIN and command from topic: {prefix}/{VIN}/command/{cmdName}
    parts := strings.Split(msg.Topic(), "/")
    if len(parts) < 4 {
        return
    }
    vin := parts[len(parts)-3]
    command := parts[len(parts)-1]

    // Payload is optional params (simple value or JSON)
    var params map[string]string
    payload := strings.TrimSpace(string(msg.Payload()))
    if payload != "" && payload != "true" {
        // Try JSON params first
        if err := json.Unmarshal(msg.Payload(), &params); err != nil {
            // Single value — infer param name from command
            params = inferParams(command, payload)
        }
    }

    s.executeCommand(vin, command, params)
}

// inferParams maps a single payload value to the correct parameter name
// based on the command type.
func inferParams(command, value string) map[string]string {
    switch command {
    case "set_temps":
        return map[string]string{"driver_temp": value, "passenger_temp": value}
    case "set_charge_limit":
        return map[string]string{"percent": value}
    case "set_charging_amps":
        return map[string]string{"amps": value}
    case "seat_heater":
        return map[string]string{"level": value}
    default:
        return nil
    }
}
```

### Step 5: Command Execution with Safety

```go
func (s *CommandSubscriber) executeCommand(vin, command string, params map[string]string) {
    // 1. Check explicitly denied
    for _, denied := range ExplicitlyDenied {
        if command == denied {
            log.Warn().Str("vin", vin).Str("command", command).Msg("MQTT command: explicitly denied")
            s.publishResult(vin, command, false, "command not allowed via MQTT")
            return
        }
    }

    // 2. Check allowlist
    if !s.allowlist[command] {
        log.Warn().Str("vin", vin).Str("command", command).Msg("MQTT command: not in allowlist")
        s.publishResult(vin, command, false, "command not in MQTT allowlist")
        return
    }

    // 3. Rate limit
    if !s.rateLimiter.Allow(vin, command) {
        log.Warn().Str("vin", vin).Str("command", command).Msg("MQTT command: rate limited")
        s.publishResult(vin, command, false, "rate limited")
        return
    }

    // 4. Dedup check
    if s.rateLimiter.IsDuplicate(vin, command) {
        log.Debug().Str("vin", vin).Str("command", command).Msg("MQTT command: duplicate suppressed")
        return
    }

    // 5. Publish status
    s.publishStatus(vin, fmt.Sprintf("executing %s...", command))

    // 6. Execute via the same handler the HTTP API uses
    start := time.Now()
    ctx, cancel := context.WithTimeout(s.ctx, 60*time.Second)
    defer cancel()

    success, errMsg, err := s.executor.ExecuteByVIN(ctx, vin, command, params)
    duration := time.Since(start).Milliseconds()

    if err != nil {
        errMsg = err.Error()
    }

    s.publishResult(vin, command, success, errMsg)

    log.Info().
        Str("vin", vin).
        Str("command", command).
        Bool("success", success).
        Int64("duration_ms", duration).
        Str("source", "mqtt").
        Msg("MQTT command executed")
}
```

### Step 6: Result Publishing

```go
func (s *CommandSubscriber) publishResult(vin, command string, success bool, errMsg string) {
    result := CommandResult{
        Command:   command,
        Success:   success,
        Timestamp: time.Now().UTC().Format(time.RFC3339),
    }
    if errMsg != "" {
        result.Error = errMsg
    }

    // Publish to both general and per-command result topics (retained)
    s.publisher.PublishJSON(vin+"/command/result", result)
    s.publisher.PublishJSON(vin+"/command/result/"+command, result)
}

func (s *CommandSubscriber) publishStatus(vin, status string) {
    s.publisher.Publish(vin+"/command/status", status)
}
```

### Step 7: Rate Limiter

Create `internal/mqtt/command_rate_limiter.go`:

```go
type commandRateLimiter struct {
    mu          sync.Mutex
    counts      map[string]*vehicleRateState  // VIN → rate state
    maxPerMin   int
    dedupWindow time.Duration
}

type vehicleRateState struct {
    commands    []time.Time           // sliding window of command timestamps
    lastCommand map[string]time.Time  // last execution per command name (dedup)
}

func (rl *commandRateLimiter) Allow(vin, command string) bool {
    rl.mu.Lock()
    defer rl.mu.Unlock()

    state := rl.getOrCreate(vin)

    // Clean old entries (older than 1 minute)
    cutoff := time.Now().Add(-1 * time.Minute)
    cleaned := state.commands[:0]
    for _, t := range state.commands {
        if t.After(cutoff) {
            cleaned = append(cleaned, t)
        }
    }
    state.commands = cleaned

    if len(state.commands) >= rl.maxPerMin {
        return false
    }

    state.commands = append(state.commands, time.Now())
    return true
}

func (rl *commandRateLimiter) IsDuplicate(vin, command string) bool {
    rl.mu.Lock()
    defer rl.mu.Unlock()

    state := rl.getOrCreate(vin)
    if last, ok := state.lastCommand[command]; ok {
        if time.Since(last) < rl.dedupWindow {
            return true
        }
    }
    state.lastCommand[command] = time.Now()
    return false
}
```

### Step 8: Wire CommandExecutor in Command Handler

Add an `ExecuteByVIN` method to the existing `CommandHandler` that looks up
the vehicle by VIN (instead of by ID from HTTP path):

```go
// In internal/api/command_handler.go:
func (h *CommandHandler) ExecuteByVIN(ctx context.Context, vin string, command string, params map[string]string) (bool, string, error) {
    // Look up vehicle by VIN
    vehicle, err := h.vehicleRepo.GetByVIN(ctx, vin)
    if err != nil || vehicle == nil {
        return false, "vehicle not found", fmt.Errorf("vehicle not found for VIN %s", vin)
    }

    // Auto-wake if needed
    if vehicle.State == "asleep" || vehicle.State == "offline" {
        if _, err := h.teslaClient.WakeUp(ctx, vehicle.ID); err != nil {
            return false, "wake failed", err
        }
        // Wait for wake
        time.Sleep(5 * time.Second)
    }

    // Execute using existing command infrastructure
    return h.executeCommand(ctx, vehicle.ID, command, params, "mqtt")
}
```

### Step 9: HA Discovery for Controllable Entities

In prompt 01 (HA Auto-Discovery), add **command topics** to entities that support control:

```json
// Lock entity with command support:
{
  "name": "Tesla Lock",
  "unique_id": "teslasync_VIN_lock",
  "state_topic": "teslasync/VIN/Locked",
  "command_topic": "teslasync/VIN/command/lock",
  "payload_lock": "true",
  "payload_unlock": "true",
  "state_locked": "true",
  "state_unlocked": "false",
  "device": { ... }
}

// Climate switch with command support:
{
  "name": "Tesla Climate",
  "unique_id": "teslasync_VIN_climate",
  "state_topic": "teslasync/VIN/HvacPower",
  "command_topic": "teslasync/VIN/command",
  "payload_on": "{\"command\":\"climate_on\"}",
  "payload_off": "{\"command\":\"climate_off\"}",
  "device": { ... }
}
```

This means HA users get **toggle switches** in their dashboard that work bidirectionally.

### Step 10: Configuration

Add to `config.go`:
```go
type MQTTConfig struct {
    // ... existing ...
    CommandsEnabled    bool     // MQTT_COMMANDS_ENABLED (default: false)
    CommandAllowlist   []string // MQTT_COMMAND_ALLOWLIST (comma-separated, default: safe list)
    CommandRateLimit   int      // MQTT_COMMAND_RATE_LIMIT (default: 10 per min)
    CommandAutoWake    bool     // MQTT_COMMAND_AUTO_WAKE (default: true)
    CommandDedupSecs   int      // MQTT_COMMAND_DEDUP_SECONDS (default: 5)
}
```

Update all deployment targets:
1. **docker-compose.yml**
2. **helm configmap.yaml**
3. **helm values.yaml**

### Step 11: Publish Available Commands

On startup, publish the list of available commands:

```go
func (s *CommandSubscriber) PublishAvailableCommands(vin string) {
    commands := make([]string, 0, len(s.allowlist))
    for cmd := range s.allowlist {
        commands = append(commands, cmd)
    }
    sort.Strings(commands)
    s.publisher.PublishJSON(vin+"/command/available", commands)
}
```

### Step 12: Logging & Metrics

- Log all MQTT commands to the existing `command_logs` table with `source: "mqtt"`
- Add Prometheus counter: `teslasync_mqtt_commands_total{command, vin, success}`
- Add Prometheus counter: `teslasync_mqtt_commands_rejected_total{reason}` (rate_limited, denied, not_allowed)

### Step 13: Unit Tests

Create `internal/mqtt/command_subscriber_test.go`:

- Test allowlist enforcement (allowed, denied, explicitly denied)
- Test rate limiting (under limit, over limit, window reset)
- Test dedup (same command within window, different command)
- Test JSON payload parsing
- Test simple topic parsing with param inference
- Test result publishing format
- Test VIN extraction from topics

## Verification

```bash
# Build
CGO_ENABLED=0 go build ./cmd/teslasync

# Tests
go test -count=1 ./internal/mqtt/...

# Manual test with mosquitto:
# 1. Enable: MQTT_COMMANDS_ENABLED=true
# 2. Send command:
mosquitto_pub -h localhost -t "teslasync/5YJ3E1EA1NF123456/command" \
  -m '{"command":"lock"}'
# 3. Check result:
mosquitto_sub -h localhost -t "teslasync/5YJ3E1EA1NF123456/command/result" -C 1
# Should show: {"command":"lock","success":true,...}

# 4. Test simple topic format:
mosquitto_pub -h localhost -t "teslasync/5YJ3E1EA1NF123456/command/honk_horn" -m ""

# 5. Test rate limit:
for i in $(seq 1 15); do
  mosquitto_pub -h localhost -t "teslasync/VIN/command/flash_lights" -m ""
done
# 11th+ should get rate limited result
```

## Commit

```bash
git add -A
git commit -m "feat(mqtt): add bidirectional MQTT command subscription

- Subscribe to teslasync/{VIN}/command (JSON) and teslasync/{VIN}/command/{cmd} (simple)
- Execute via existing CommandHandler.ExecuteByVIN (same path as HTTP)
- Safe default allowlist (25 commands), explicitly deny dangerous commands
- Rate limiting (10/min/vehicle), duplicate suppression (5s window)
- Auto-wake sleeping vehicles before command execution
- Publish result to teslasync/{VIN}/command/result (retained)
- Configurable via MQTT_COMMANDS_ENABLED (default: false)"
```

## What NOT To Change

- Do not modify the existing MQTT Subscriber (Fleet Telemetry ingestion)
- Do not change how PublishVehicleData works
- Do not add MQTT commands to the notification or export workers — commands go through API only
- Do not allow dangerous commands (erase, remote_start) via MQTT regardless of config
