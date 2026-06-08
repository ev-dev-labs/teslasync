//
//  FSMStateDiagram.RegistryData.swift
//  TeslaSync — P4 feature view · 0229 · FSMStateDiagram (Apple)
//
//  The ported FSM data tables (web `src/types/fsm/*`): the ordered state lists, the
//  resolved per-state semantic colours (theme variant merged with the web `overrides`,
//  reduced to the `dot`/`text` hue the diagram actually paints), and the raw ordered
//  transition pairs (`*_TRANSITIONS`, from/to only) the registry dedupes into edges.
//  Pure data — no logic, no SwiftUI. Kept beside `FSMRegistry` so the eight FSMs stay
//  a single source of truth mirroring the web registry.
//

import Foundation

/// Ported per-FSM static data (states · colours · transition pairs) for the eight
/// registered FSM types. The colour for each state is the web theme variant merged with
/// its `overrides`, collapsed to the hue the diagram paints (`dot`/`text`): e.g. vehicle
/// `charging` (warning + cyan override) → `.cyan`, `gave_up` (danger + red-500) →
/// `.strongDanger`, automation `disabled` (danger + 50%) → `.faded`.
enum FSMRegistryData {
    // MARK: Vehicle (web vehicle.ts)

    static let vehicleStates = [
        "online", "driving", "charging", "parked", "updating", "asleep", "offline"
    ]

    static let vehicleColors: [String: FSMStateColor] = [
        "online": .success,
        "driving": .success,
        "charging": .cyan,
        "parked": .purple,
        "updating": .indigo,
        "asleep": .neutral,
        "offline": .neutral
    ]

    static let vehicleTransitions: [FSMEdge] = [
        FSMEdge("online", "driving"), FSMEdge("online", "driving"), FSMEdge("online", "driving"),
        FSMEdge("online", "charging"), FSMEdge("online", "parked"), FSMEdge("online", "asleep"),
        FSMEdge("online", "offline"), FSMEdge("online", "asleep"), FSMEdge("online", "offline"),
        FSMEdge("driving", "parked"), FSMEdge("driving", "charging"), FSMEdge("driving", "online"),
        FSMEdge("driving", "parked"), FSMEdge("driving", "offline"), FSMEdge("driving", "offline"),
        FSMEdge("charging", "driving"), FSMEdge("charging", "driving"), FSMEdge("charging", "parked"),
        FSMEdge("charging", "driving"), FSMEdge("charging", "online"), FSMEdge("charging", "asleep"),
        FSMEdge("charging", "offline"), FSMEdge("charging", "offline"),
        FSMEdge("parked", "driving"), FSMEdge("parked", "driving"), FSMEdge("parked", "driving"),
        FSMEdge("parked", "charging"), FSMEdge("parked", "online"), FSMEdge("parked", "asleep"),
        FSMEdge("parked", "offline"), FSMEdge("parked", "asleep"), FSMEdge("parked", "offline"),
        FSMEdge("asleep", "online"), FSMEdge("asleep", "online"), FSMEdge("asleep", "charging"),
        FSMEdge("asleep", "driving"), FSMEdge("asleep", "driving"), FSMEdge("asleep", "driving"),
        FSMEdge("asleep", "parked"), FSMEdge("asleep", "offline"), FSMEdge("asleep", "offline"),
        FSMEdge("offline", "online"), FSMEdge("offline", "online"), FSMEdge("offline", "charging"),
        FSMEdge("offline", "driving"), FSMEdge("offline", "driving"), FSMEdge("offline", "driving"),
        FSMEdge("offline", "parked"), FSMEdge("offline", "asleep"), FSMEdge("offline", "asleep")
    ]

    // MARK: Drive session (web drive-session.ts)

    static let driveSessionStates = ["pending", "active", "ending", "completed", "recovered"]

    static let driveSessionColors: [String: FSMStateColor] = [
        "pending": .warning,
        "active": .success,
        "ending": .orange,
        "completed": .indigo,
        "recovered": .purple
    ]

    static let driveSessionTransitions: [FSMEdge] = [
        FSMEdge("pending", "active"), FSMEdge("pending", "recovered"), FSMEdge("active", "ending"),
        FSMEdge("active", "recovered"), FSMEdge("ending", "completed"), FSMEdge("ending", "completed"),
        FSMEdge("recovered", "active"), FSMEdge("recovered", "ending")
    ]

    // MARK: Charge session (web charge-session.ts)

    static let chargeSessionStates = ["pending", "active", "completing", "done", "recovered"]

    static let chargeSessionColors: [String: FSMStateColor] = [
        "pending": .warning,
        "active": .cyan,
        "completing": .info,
        "done": .success,
        "recovered": .purple
    ]

    static let chargeSessionTransitions: [FSMEdge] = [
        FSMEdge("pending", "active"), FSMEdge("pending", "recovered"), FSMEdge("active", "completing"),
        FSMEdge("active", "completing"), FSMEdge("active", "recovered"), FSMEdge("completing", "done"),
        FSMEdge("completing", "done"), FSMEdge("recovered", "active"), FSMEdge("recovered", "completing")
    ]

    // MARK: Command (web command.ts)

    static let commandStates = [
        "queued", "waking", "wake_confirmed", "wake_timeout", "sending",
        "succeeded", "failed", "timed_out", "retrying", "gave_up"
    ]

    static let commandColors: [String: FSMStateColor] = [
        "queued": .neutral,
        "waking": .warning,
        "wake_confirmed": .info,
        "wake_timeout": .orange,
        "sending": .info,
        "succeeded": .success,
        "failed": .danger,
        "timed_out": .orange,
        "retrying": .purple,
        "gave_up": .strongDanger
    ]

    static let commandTransitions: [FSMEdge] = [
        FSMEdge("queued", "sending"), FSMEdge("queued", "waking"), FSMEdge("queued", "gave_up"),
        FSMEdge("waking", "wake_confirmed"), FSMEdge("waking", "wake_timeout"),
        FSMEdge("wake_confirmed", "sending"), FSMEdge("wake_timeout", "waking"),
        FSMEdge("wake_timeout", "gave_up"), FSMEdge("sending", "succeeded"),
        FSMEdge("sending", "failed"), FSMEdge("sending", "timed_out"), FSMEdge("failed", "retrying"),
        FSMEdge("failed", "gave_up"), FSMEdge("timed_out", "retrying"), FSMEdge("timed_out", "gave_up"),
        FSMEdge("retrying", "sending")
    ]

    // MARK: Notification (web notification.ts)

    static let notificationStates = [
        "created", "sending", "delivered", "partial", "failed", "retrying", "dead"
    ]

    static let notificationColors: [String: FSMStateColor] = [
        "created": .neutral,
        "sending": .info,
        "delivered": .success,
        "partial": .warning,
        "failed": .danger,
        "retrying": .purple,
        "dead": .strongDanger
    ]

    static let notificationTransitions: [FSMEdge] = [
        FSMEdge("created", "sending"), FSMEdge("sending", "delivered"), FSMEdge("sending", "partial"),
        FSMEdge("sending", "failed"), FSMEdge("partial", "sending"), FSMEdge("partial", "dead"),
        FSMEdge("failed", "retrying"), FSMEdge("failed", "dead"), FSMEdge("retrying", "sending")
    ]

    // MARK: Alert cooldown (web alert-cooldown.ts)

    static let alertCooldownStates = ["armed", "fired", "suppressed"]

    static let alertCooldownColors: [String: FSMStateColor] = [
        "armed": .success,
        "fired": .danger,
        "suppressed": .warning
    ]

    static let alertCooldownTransitions: [FSMEdge] = [
        FSMEdge("armed", "fired"), FSMEdge("fired", "suppressed"), FSMEdge("fired", "armed"),
        FSMEdge("suppressed", "suppressed"), FSMEdge("suppressed", "armed")
    ]

    // MARK: Automation (web automation.ts)

    static let automationStates = [
        "idle", "evaluating", "executing", "succeeded", "partial",
        "failed", "retrying", "gave_up", "skipped", "cooldown", "disabled"
    ]

    static let automationColors: [String: FSMStateColor] = [
        "idle": .neutral,
        "evaluating": .cyan,
        "executing": .warning,
        "succeeded": .success,
        "partial": .warning,
        "failed": .danger,
        "retrying": .warning,
        "gave_up": .strongDanger,
        "skipped": .neutral,
        "cooldown": .purple,
        "disabled": .faded
    ]

    static let automationTransitions: [FSMEdge] = [
        FSMEdge("idle", "evaluating"), FSMEdge("evaluating", "executing"),
        FSMEdge("evaluating", "skipped"), FSMEdge("executing", "succeeded"),
        FSMEdge("executing", "partial"), FSMEdge("executing", "failed"), FSMEdge("failed", "retrying"),
        FSMEdge("retrying", "executing"), FSMEdge("retrying", "gave_up"),
        FSMEdge("succeeded", "cooldown"), FSMEdge("succeeded", "idle"), FSMEdge("partial", "cooldown"),
        FSMEdge("partial", "idle"), FSMEdge("gave_up", "idle"), FSMEdge("gave_up", "disabled"),
        FSMEdge("skipped", "idle"), FSMEdge("cooldown", "idle"), FSMEdge("disabled", "idle")
    ]

    // MARK: Telemetry connection (web telemetry-connection.ts)

    static let telemetryConnectionStates = [
        "unknown", "connecting", "streaming", "stale", "disconnected", "polling_only"
    ]

    static let telemetryConnectionColors: [String: FSMStateColor] = [
        "unknown": .neutral,
        "connecting": .warning,
        "streaming": .success,
        "stale": .warning,
        "disconnected": .danger,
        "polling_only": .info
    ]

    static let telemetryConnectionTransitions: [FSMEdge] = [
        FSMEdge("unknown", "connecting"), FSMEdge("unknown", "polling_only"),
        FSMEdge("connecting", "streaming"), FSMEdge("connecting", "stale"),
        FSMEdge("connecting", "disconnected"), FSMEdge("streaming", "stale"),
        FSMEdge("streaming", "disconnected"), FSMEdge("stale", "streaming"),
        FSMEdge("stale", "disconnected"), FSMEdge("disconnected", "streaming"),
        FSMEdge("polling_only", "streaming")
    ]
}
