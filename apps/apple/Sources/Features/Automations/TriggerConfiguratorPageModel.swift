import Foundation
import Observation

// Native SwiftUI parity model for `web/src/features/automations/pages/TriggerConfigurator.tsx`.
//
// The web `TriggerConfigurator` is a controlled editor the parent `AutomationBuilder` page owns: it
// is fed a `trigger` prop and hands the edited trigger back through `onChange`, switching its body on
// `trigger.kind` (schedule / event / geofence / signal). Its one data dependency is the
// `useGeofences()` query (`GET /geofences`) that fills the geofence picker. As a self-contained P7
// page this native unit owns the editable trigger itself through this `@Observable` model and
// resolves the geofence query through an injectable provider seam (default = representative local
// state); no networking lives in the view (ADR-004).
//
// The pure projection logic — the discriminated `AutomationTrigger` union, the
// `CronExpression.build/parse` schedule helpers, the `TriggerAdapter` weekday + value coercions, the
// `createDefault` seeds, and the option catalogs — is REUSED from the module-public P4 layer
// (`TriggerConfigurator.Adapter.swift` / `.Catalog.swift`) so there is one source of truth; only the
// localization boundary differs (this page resolves every string from `Localizable.xcstrings`).

// MARK: - Localization facade (web `t(key, default)` → Localizable.xcstrings)

/// Resolves the page's copy by key from the platform `Localizable.xcstrings` catalog, with the web
/// English value as a safety fallback if a key is somehow absent (a missing dynamic key resolves to
/// itself). Keys match the web names verbatim.
enum TriggerConfiguratorPageStrings {
    static func localize(_ key: String, _ fallback: String) -> String {
        let value = String(localized: String.LocalizationValue(key), bundle: .main)
        return value == key ? fallback : value
    }
}

// MARK: - Geofence data source (web `useGeofences` → GET /geofences)

/// One resolved result of the geofence query — the native mirror of the `useGeofences` success /
/// error the web reads off the hook. `GET /geofences` is a one-shot fetch (not a live SSE source), so
/// no staleness overlay is modeled (ADR-013 applies only to live streams).
public enum TriggerConfiguratorGeofenceLoad: Sendable, Equatable {
    case success([Geofence])
    case failure(String)
}

/// The seam that supplies the geofence picker's data (web `useGeofences`). Production implements it
/// over the shared generated client (`GET /geofences`); previews + tests use the in-module stubs.
public protocol TriggerConfiguratorGeofenceProviding: Sendable {
    func load() async -> TriggerConfiguratorGeofenceLoad
}

/// Representative geofences for the default page (web `useGeofences` happy path).
public struct DefaultTriggerConfiguratorGeofenceData: TriggerConfiguratorGeofenceProviding {
    public init() {}

    public func load() async -> TriggerConfiguratorGeofenceLoad {
        .success([
            Geofence(id: "1", name: "Home"),
            Geofence(id: "2", name: "Work"),
            Geofence(id: "3", name: "Supercharger — Downtown")
        ])
    }
}

/// A no-geofences seam for the empty-state preview / test (web `useGeofences` returns `[]`).
public struct EmptyTriggerConfiguratorGeofenceData: TriggerConfiguratorGeofenceProviding {
    public init() {}

    public func load() async -> TriggerConfiguratorGeofenceLoad {
        .success([])
    }
}

/// A failing seam for the error-state preview / test (web `useGeofences` `error`).
public struct FailingTriggerConfiguratorGeofenceData: TriggerConfiguratorGeofenceProviding {
    private let message: String

    public init(message: String = "Could not reach the server.") {
        self.message = message
    }

    public func load() async -> TriggerConfiguratorGeofenceLoad {
        .failure(message)
    }
}

// MARK: - Geofence render state (manifest data states + no-blank-region robustness)

/// The geofence picker's typed render state. `empty` and `success` are the manifest-declared data
/// states (no geofences vs at least one); `loading` and `error` are added so the picker never renders
/// blank (HIG redacted control / inline error + retry). The web silently maps `geofences ?? []`; the
/// native surface renders each branch distinctly.
public enum TriggerConfiguratorPageGeofenceState: Sendable, Equatable {
    case loading
    case empty
    case success
    case error(String)
}

// MARK: - State holder (P1/S8 layer)

/// The configurator page's observable view-model. Owns the editable `trigger` (web controlled prop),
/// projects the geofence query into a typed render state, and applies every web edit rule through the
/// reused pure core, re-publishing the trigger on each change. Pure form logic — no networking lives
/// here.
@MainActor
@Observable
public final class TriggerConfiguratorPageModel {
    /// The trigger being edited (web `trigger` prop / `onChange` value).
    public private(set) var trigger: AutomationTrigger

    /// The resolved geofence-picker render state (loading / empty / success / error).
    public private(set) var geofenceState: TriggerConfiguratorPageGeofenceState = .loading

    /// The loaded geofences (web `useGeofences` data, `?? []`).
    public private(set) var geofences: [Geofence] = []

    @ObservationIgnored private let geofenceProvider: any TriggerConfiguratorGeofenceProviding

    public init(
        trigger: AutomationTrigger = .createDefault(.geofence),
        geofenceProvider: any TriggerConfiguratorGeofenceProviding = DefaultTriggerConfiguratorGeofenceData()
    ) {
        self.trigger = trigger
        self.geofenceProvider = geofenceProvider
    }

    // MARK: Load / refresh (web useGeofences fetch / refetch)

    /// Loads the geofences (web initial `useGeofences` query).
    public func load() async {
        let result = await geofenceProvider.load()
        apply(result)
    }

    /// Re-fetches the geofences (web `refetch`, wired to the picker error retry + pull-to-refresh).
    public func refresh() async {
        geofenceState = .loading
        await load()
    }

    private func apply(_ result: TriggerConfiguratorGeofenceLoad) {
        switch result {
        case let .success(list):
            geofences = list
            geofenceState = list.isEmpty ? .empty : .success
        case let .failure(message):
            geofences = []
            geofenceState = .error(message)
        }
    }

    /// Pushes an externally-changed trigger in (web controlled re-render).
    public func apply(trigger: AutomationTrigger) {
        self.trigger = trigger
    }

    // MARK: Trigger kind (web host type picker → createDefaultTrigger)

    /// Web type-picker change: reseed a fresh default trigger of the chosen kind
    /// (`createDefaultTrigger(kind)`).
    public func setTriggerKind(_ kind: TriggerKind) {
        guard kind != trigger.kind else { return }
        trigger = .createDefault(kind)
    }

    // MARK: Schedule edits (web `case 'trigger_schedule'`)

    /// Web simple-mode time change: rebuild the cron from the new time + current days.
    public func setScheduleTime(hour: Int, minute: Int) {
        guard case let .schedule(cronExpr, timezone) = trigger else { return }
        let days = CronExpression.parse(cronExpr)?.days ?? []
        trigger = .schedule(cronExpr: CronExpression.build(hour: hour, minute: minute, days: days), timezone: timezone)
    }

    /// Web `handleDayToggle` applied to the current schedule, rebuilding the cron.
    public func toggleScheduleDay(_ day: Int) {
        guard case let .schedule(cronExpr, timezone) = trigger else { return }
        let parsed = CronExpression.parse(cronExpr)
        let hour = parsed?.hour ?? 8
        let minute = parsed?.minute ?? 0
        let days = TriggerAdapter.toggleDay(parsed?.days ?? [], day)
        trigger = .schedule(cronExpr: CronExpression.build(hour: hour, minute: minute, days: days), timezone: timezone)
    }

    /// Web advanced-mode raw cron edit.
    public func setScheduleCron(_ expr: String) {
        guard case let .schedule(_, timezone) = trigger else { return }
        trigger = .schedule(cronExpr: expr, timezone: timezone)
    }

    /// Web mode toggle. A simple expression is kept verbatim (the web sets `cron_expr` to the same
    /// value); a non-parseable expression is reset to the canonical `0 8 * * *` simple seed — exactly
    /// the web ternary.
    public func toggleScheduleMode() {
        guard case let .schedule(cronExpr, timezone) = trigger else { return }
        let isSimple = CronExpression.parse(cronExpr) != nil
        trigger = .schedule(cronExpr: isSimple ? cronExpr : "0 8 * * *", timezone: timezone)
    }

    public func setScheduleTimezone(_ timezone: String) {
        guard case let .schedule(cronExpr, _) = trigger else { return }
        trigger = .schedule(cronExpr: cronExpr, timezone: timezone)
    }

    // MARK: Event edits (web `case 'trigger_event'`)

    public func setEventType(_ eventType: VehicleEventType) {
        guard case .event = trigger else { return }
        trigger = .event(eventType)
    }

    // MARK: Geofence edits (web `case 'trigger_geofence'`)

    public func setGeofencePlace(_ placeID: Int) {
        guard case let .geofence(_, event, dwell) = trigger else { return }
        trigger = .geofence(placeID: placeID, event: event, dwellMinutes: dwell)
    }

    /// Web geofence-event change: switching to `dwell` seeds `dwell_minutes ?? 5`; any other event
    /// clears it (`undefined`).
    public func setGeofenceEvent(_ event: GeofenceEvent) {
        guard case let .geofence(placeID, _, dwell) = trigger else { return }
        let nextDwell = event == .dwell ? (dwell ?? GeofenceEventCatalog.defaultDwellMinutes) : nil
        trigger = .geofence(placeID: placeID, event: event, dwellMinutes: nextDwell)
    }

    public func setDwellMinutes(_ minutes: Int) {
        guard case let .geofence(placeID, event, _) = trigger else { return }
        trigger = .geofence(placeID: placeID, event: event, dwellMinutes: max(1, minutes))
    }

    // MARK: Signal edits (web `case 'trigger_signal'`)

    /// Web signal change: pick the default operator + value for the new signal's type.
    public func setSignal(_ signal: String) {
        guard case .signal = trigger else { return }
        let next = if SignalCatalog.boolFieldKeys.contains(signal) {
            SignalTrigger(signal: signal, op: .equals, value: .bool(true))
        } else if signal == "state" {
            SignalTrigger(signal: signal, op: .equals, value: .text("online"))
        } else {
            SignalTrigger(signal: signal, op: .lessThan, value: .number(20))
        }
        trigger = .signal(next)
    }

    /// Web operator change: `changed` drops the value; any other operator re-coerces the current
    /// display value into the new operator's shape.
    public func setOperator(_ op: SignalOperator) {
        guard case let .signal(current) = trigger else { return }
        if op == .changed {
            trigger = .signal(SignalTrigger(signal: current.signal, op: op, value: .none))
            return
        }
        let value = TriggerAdapter.signalValue(
            signal: current.signal,
            op: op,
            rawValue: TriggerAdapter.displayValue(for: current)
        )
        trigger = .signal(SignalTrigger(signal: current.signal, op: op, value: value))
    }

    /// Web value-field change: coerce the raw string into the typed value (web `signalValueFromInput`).
    public func setSignalValue(_ rawValue: String) {
        guard case let .signal(current) = trigger else { return }
        let value = TriggerAdapter.signalValue(signal: current.signal, op: current.op, rawValue: rawValue)
        trigger = .signal(SignalTrigger(signal: current.signal, op: current.op, value: value))
    }

    /// Web "Fire on any change" toggle: on → `changed`; off → re-coerce as `=` over the current
    /// display value.
    public func setChangedOnly(_ checked: Bool) {
        guard case let .signal(current) = trigger else { return }
        if checked {
            trigger = .signal(SignalTrigger(signal: current.signal, op: .changed, value: .none))
            return
        }
        let value = TriggerAdapter.signalValue(
            signal: current.signal,
            op: .equals,
            rawValue: TriggerAdapter.displayValue(for: current)
        )
        trigger = .signal(SignalTrigger(signal: current.signal, op: .equals, value: value))
    }
}
