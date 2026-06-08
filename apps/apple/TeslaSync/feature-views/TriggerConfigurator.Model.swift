//
//  TriggerConfigurator.Model.swift
//  TeslaSync — P4 feature view · 0086 · TriggerConfigurator (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the automation trigger configurator. The view binds through
//  `TriggerConfiguratorModel`, which owns the editable trigger (the web controlled
//  `trigger` prop) and hands every edit back through `onChange` (the web `onChange`
//  callback). The one data dependency — the web `useGeofences()` query — is bound through
//  the `GeofenceSource` seam, projected into loading / error / empty / data plus the
//  freshness + connectivity overlays the P4 states contract requires. No networking lives
//  in the view.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; production injects an adapter that forwards to
/// the shared-core `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated there.
public protocol TriggerConfiguratorTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogTriggerConfiguratorTelemetry: TriggerConfiguratorTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "TriggerConfigurator" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time.
public enum TCStrings {
    public static let table = "TriggerConfigurator"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Geofence query snapshot (web useGeofences state)

/// One coalesced snapshot of the geofence query — the native mirror of the fields the web
/// component reads off `useGeofences` (`isLoading`, `error`, `data`) plus the `isStale` /
/// `isOffline` freshness + connectivity flags the production state-holder derives from the
/// TanStack query meta + network reachability. The view reacts to this struct, never HTTP.
public struct GeofenceInput: Sendable, Equatable {
    public var isLoading: Bool
    public var isFetching: Bool
    public var errorMessage: String?
    public var geofences: [Geofence]?
    public var isStale: Bool
    public var isOffline: Bool

    public init(
        isLoading: Bool = false,
        isFetching: Bool = false,
        errorMessage: String? = nil,
        geofences: [Geofence]? = nil,
        isStale: Bool = false,
        isOffline: Bool = false
    ) {
        self.isLoading = isLoading
        self.isFetching = isFetching
        self.errorMessage = errorMessage
        self.geofences = geofences
        self.isStale = isStale
        self.isOffline = isOffline
    }
}

/// The resolved, view-ready geofence-picker state: the mutually-exclusive phase plus the
/// freshness / connectivity overlays the data + empty branches carry.
public struct GeofenceResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case error(String)
        case empty
        case data
    }

    public let phase: Phase
    public let geofences: [Geofence]
    public let isFetching: Bool
    public let isStale: Bool
    public let isOffline: Bool

    public init(
        phase: Phase,
        geofences: [Geofence],
        isFetching: Bool,
        isStale: Bool,
        isOffline: Bool
    ) {
        self.phase = phase
        self.geofences = geofences
        self.isFetching = isFetching
        self.isStale = isStale
        self.isOffline = isOffline
    }
}

/// Pure projection from the query snapshot to the resolved picker state. `error` takes
/// precedence over cached data; the stale / offline flags only annotate branches that have
/// content. Unit tested across every branch.
public enum GeofenceProjection {
    public static func resolve(_ input: GeofenceInput) -> GeofenceResolved {
        let geofences = input.geofences ?? []
        let hasContent = input.geofences != nil
        let phase: GeofenceResolved.Phase = if input.isLoading {
            .loading
        } else if let message = input.errorMessage, !message.isEmpty {
            .error(message)
        } else if geofences.isEmpty {
            .empty
        } else {
            .data
        }
        return GeofenceResolved(
            phase: phase,
            geofences: geofences,
            isFetching: input.isFetching,
            isStale: hasContent && input.isStale,
            isOffline: hasContent && input.isOffline
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the model binds through. Production implements it over the shared
/// state-holder / TanStack-parity query layer (the web `useGeofences`); previews and tests
/// use `InMemoryGeofenceSource`. `refresh()` maps to the hook's `refetch`.
@MainActor
public protocol GeofenceSource: AnyObject {
    var onUpdate: (@MainActor (GeofenceInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryGeofenceSource: GeofenceSource {
    public var onUpdate: (@MainActor (GeofenceInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: GeofenceInput?

    public init(initial: GeofenceInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: GeofenceInput) {
        onUpdate?(input)
    }
}

// MARK: - State holder (P1/S8 layer)

/// The configurator's observable view-model. Owns the editable `trigger` (web controlled
/// prop), exposes the resolved geofence-picker state, applies every web edit rule, and
/// emits each change through `onChange`. Emits the `view.opened` diagnostics event once.
@MainActor
@Observable
public final class TriggerConfiguratorModel {
    /// The trigger being edited (web `trigger` prop). Every mutation re-emits via `onChange`.
    public private(set) var trigger: AutomationTrigger

    /// The resolved geofence-picker state (loading / error / empty / data + overlays).
    public private(set) var geofencePhase: GeofenceResolved.Phase = .loading
    public private(set) var geofences: [Geofence] = []
    public private(set) var geofencesFetching = false
    public private(set) var geofencesStale = false
    public private(set) var geofencesOffline = false

    @ObservationIgnored private let source: any GeofenceSource
    @ObservationIgnored private let telemetry: any TriggerConfiguratorTelemetry
    @ObservationIgnored private let onChange: @MainActor (AutomationTrigger) -> Void
    @ObservationIgnored private var started = false

    public init(
        trigger: AutomationTrigger,
        source: any GeofenceSource,
        telemetry: any TriggerConfiguratorTelemetry = OSLogTriggerConfiguratorTelemetry(),
        onChange: @escaping @MainActor (AutomationTrigger) -> Void = { _ in }
    ) {
        self.trigger = trigger
        self.source = source
        self.telemetry = telemetry
        self.onChange = onChange
        source.onUpdate = { [weak self] input in self?.applyGeofences(input) }
    }

    // MARK: Lifecycle

    /// Begins observing geofences and emits the `view.opened` event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TriggerConfiguratorSurface.slug)
        source.start()
    }

    /// Stops observing the upstream geofence feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-fetches the geofences (wired to the picker error retry).
    public func refreshGeofences() {
        source.refresh()
    }

    /// Pushes an externally-changed trigger in (web controlled re-render).
    public func apply(trigger: AutomationTrigger) {
        self.trigger = trigger
    }

    private func applyGeofences(_ input: GeofenceInput) {
        let resolved = GeofenceProjection.resolve(input)
        geofencePhase = resolved.phase
        geofences = resolved.geofences
        geofencesFetching = resolved.isFetching
        geofencesStale = resolved.isStale
        geofencesOffline = resolved.isOffline
    }

    private func emit(_ next: AutomationTrigger) {
        trigger = next
        onChange(next)
    }

    // MARK: Schedule edits

    /// Web simple-mode time change: rebuild the cron from the new time + current days.
    public func setScheduleTime(hour: Int, minute: Int) {
        guard case let .schedule(cronExpr, timezone) = trigger else { return }
        let days = CronExpression.parse(cronExpr)?.days ?? []
        emit(.schedule(cronExpr: CronExpression.build(hour: hour, minute: minute, days: days), timezone: timezone))
    }

    /// Web `handleDayToggle` applied to the current schedule, rebuilding the cron.
    public func toggleScheduleDay(_ day: Int) {
        guard case let .schedule(cronExpr, timezone) = trigger else { return }
        let parsed = CronExpression.parse(cronExpr)
        let hour = parsed?.hour ?? 8
        let minute = parsed?.minute ?? 0
        let days = TriggerAdapter.toggleDay(parsed?.days ?? [], day)
        emit(.schedule(cronExpr: CronExpression.build(hour: hour, minute: minute, days: days), timezone: timezone))
    }

    /// Web advanced-mode raw cron edit.
    public func setScheduleCron(_ expr: String) {
        guard case let .schedule(_, timezone) = trigger else { return }
        emit(.schedule(cronExpr: expr, timezone: timezone))
    }

    /// Web mode toggle. A simple expression is kept verbatim (the web sets `cron_expr` to
    /// the same value); a non-parseable expression is reset to the canonical `0 8 * * *`
    /// simple seed — exactly the web ternary, faithfully reproduced.
    public func toggleScheduleMode() {
        guard case let .schedule(cronExpr, timezone) = trigger else { return }
        let isSimple = CronExpression.parse(cronExpr) != nil
        emit(.schedule(cronExpr: isSimple ? cronExpr : "0 8 * * *", timezone: timezone))
    }

    public func setScheduleTimezone(_ timezone: String) {
        guard case let .schedule(cronExpr, _) = trigger else { return }
        emit(.schedule(cronExpr: cronExpr, timezone: timezone))
    }

    // MARK: Event edits

    public func setEventType(_ eventType: VehicleEventType) {
        guard case .event = trigger else { return }
        emit(.event(eventType))
    }

    // MARK: Geofence edits

    public func setGeofencePlace(_ placeID: Int) {
        guard case let .geofence(_, event, dwell) = trigger else { return }
        emit(.geofence(placeID: placeID, event: event, dwellMinutes: dwell))
    }

    /// Web geofence-event change: switching to `dwell` seeds `dwell_minutes ?? 5`, any other
    /// event clears it (`undefined`).
    public func setGeofenceEvent(_ event: GeofenceEvent) {
        guard case let .geofence(placeID, _, dwell) = trigger else { return }
        let nextDwell = event == .dwell ? (dwell ?? GeofenceEventCatalog.defaultDwellMinutes) : nil
        emit(.geofence(placeID: placeID, event: event, dwellMinutes: nextDwell))
    }

    public func setDwellMinutes(_ minutes: Int) {
        guard case let .geofence(placeID, event, _) = trigger else { return }
        emit(.geofence(placeID: placeID, event: event, dwellMinutes: max(1, minutes)))
    }

    // MARK: Signal edits

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
        emit(.signal(next))
    }

    /// Web operator change: `changed` drops the value; any other operator re-coerces the
    /// current display value into the new operator's shape.
    public func setOperator(_ op: SignalOperator) {
        guard case let .signal(current) = trigger else { return }
        if op == .changed {
            emit(.signal(SignalTrigger(signal: current.signal, op: op, value: .none)))
            return
        }
        let value = TriggerAdapter.signalValue(
            signal: current.signal,
            op: op,
            rawValue: TriggerAdapter.displayValue(for: current)
        )
        emit(.signal(SignalTrigger(signal: current.signal, op: op, value: value)))
    }

    /// Web value-field change: coerce the raw string into the typed value (web
    /// `signalValueFromInput`).
    public func setSignalValue(_ rawValue: String) {
        guard case let .signal(current) = trigger else { return }
        let value = TriggerAdapter.signalValue(signal: current.signal, op: current.op, rawValue: rawValue)
        emit(.signal(SignalTrigger(signal: current.signal, op: current.op, value: value)))
    }

    /// Web "Fire on any change" toggle: on → `changed`; off → re-coerce as `=` over the
    /// current display value.
    public func setChangedOnly(_ checked: Bool) {
        guard case let .signal(current) = trigger else { return }
        if checked {
            emit(.signal(SignalTrigger(signal: current.signal, op: .changed, value: .none)))
            return
        }
        let value = TriggerAdapter.signalValue(
            signal: current.signal,
            op: .equals,
            rawValue: TriggerAdapter.displayValue(for: current)
        )
        emit(.signal(SignalTrigger(signal: current.signal, op: .equals, value: value)))
    }
}
