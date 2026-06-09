//
//  ScheduledMaintenanceCard.Model.swift
//  TeslaSync — P4 feature view · 0251 · ScheduledMaintenanceCard (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the toast seam (web `useToast`),
//  and the i18n facade (P1/S10) for the operator-grade scheduled-maintenance card — the SwiftUI
//  parity of features/system/components/status/ScheduledMaintenanceCard.tsx. The web component
//  reads `useMaintenanceState()` and drives `useUpdateMaintenance()` (schedule + clear), surfacing
//  outcomes through `useToast`; this model folds those into one observable view-model with a
//  schedule / clear async seam. No networking lives in the view.
//
//  States (every one renders — no hidden surface): loading (skeleton), scheduler (the never-blank
//  idle), active (message + until + Clear), error (retry). The orthogonal connection axis
//  (live / stale / offline) drives a freshness chip + banner with a one-shot stale auto-refresh.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the Swift sources hold
/// no hardcoded prose. Keys live in the "ScheduledMaintenanceCard" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. In tests / preview bundles (where the table
/// is absent) `NSLocalizedString` returns the `value:` fallback, keeping the projection
/// deterministic.
public enum ScheduledMaintenanceStrings {
    public static let table = "ScheduledMaintenanceCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-templated key and substitutes the positional arguments. The template is
    /// localized first, so translators control word order around the (locale-formatted) values.
    public static func format(_ key: String, _ fallback: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallback), arguments: args)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol ScheduledMaintenanceTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event. The slug is a static, non-identifying constant.
public struct OSLogScheduledMaintenanceTelemetry: ScheduledMaintenanceTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Toast seam (web `useToast`)

/// Surfaces an operator-facing success / error toast — the native mirror of the web `useToast()`
/// `{ success, error }`. The default logs via `os.Logger`; the production app injects an adapter
/// forwarding to the shared toast presenter.
public protocol ScheduledMaintenanceToasting: Sendable {
    func success(_ message: String)
    func error(_ message: String)
}

/// `os.Logger`-backed default that records toast intents without a presenter (previews / headless).
public struct OSLogScheduledMaintenanceToast: ScheduledMaintenanceToasting {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "toast") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func success(_ message: String) {
        logger.info("toast.success \(message, privacy: .public)")
    }

    public func error(_ message: String) {
        logger.error("toast.error \(message, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer; never HTTP from the view)

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// maintenance state holder (`useMaintenanceState`) and the update mutation (`useUpdateMaintenance`);
/// previews and tests use `InMemoryScheduledMaintenanceSource`. `submit(_:)` is the web
/// `mutation.mutateAsync` (schedule + clear share the slot).
@MainActor
public protocol ScheduledMaintenanceSource: AnyObject {
    var onUpdate: (@MainActor (ScheduledMaintenanceInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    func submit(_ request: MaintenanceUpdateRequest) async -> MaintenanceMutationResult
}

// MARK: - View model

/// The card's observable view-model. Subscribes to a `ScheduledMaintenanceSource`, recomputes the
/// resolved projection, exposes the render `phase` + ring tone + header flags + the `connection`
/// axis, emits `view.opened` once on start, drives the schedule / clear mutations (with toast
/// feedback + an `isMutating` gate), and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class ScheduledMaintenanceModel {
    public private(set) var resolved: ScheduledMaintenanceResolved =
        ScheduledMaintenanceProjection.resolve(ScheduledMaintenanceInput(isLoading: true))
    public private(set) var connection: ScheduledMaintenanceConnection = .live
    public private(set) var isMutating = false

    public var phase: ScheduledMaintenanceResolved.Phase {
        resolved.phase
    }

    public var ringTone: MaintenanceRingTone {
        resolved.ringTone
    }

    public var headerActive: Bool {
        resolved.headerActive
    }

    public var headerWithin24h: Bool {
        resolved.headerWithin24h
    }

    @ObservationIgnored private let source: any ScheduledMaintenanceSource
    @ObservationIgnored private let telemetry: any ScheduledMaintenanceTelemetry
    @ObservationIgnored private let toast: any ScheduledMaintenanceToasting
    @ObservationIgnored private let formatter: any MaintenanceDateFormatting
    @ObservationIgnored private var started = false

    public init(
        source: any ScheduledMaintenanceSource,
        telemetry: any ScheduledMaintenanceTelemetry = OSLogScheduledMaintenanceTelemetry(),
        toast: any ScheduledMaintenanceToasting = OSLogScheduledMaintenanceToast(),
        formatter: any MaintenanceDateFormatting = SystemMaintenanceDateFormatter()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.toast = toast
        self.formatter = formatter
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ScheduledMaintenanceCard.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    // MARK: Mutations (web handleSchedule / handleClear)

    /// Validates + submits a new maintenance window (web `handleSchedule`). Returns `true` when the
    /// window was scheduled so the caller can dismiss + reset the inline form. Validation failures
    /// and mutation errors surface a toast and return `false`.
    public func schedule(start: Date?, durationText: String, message: String) async -> Bool {
        guard !isMutating else { return false }
        switch MaintenanceScheduleMath.buildRequest(
            start: start,
            durationText: durationText,
            message: message,
            formatter: formatter
        ) {
        case let .failure(error):
            toast.error(ScheduledMaintenanceStrings.string(error.key, error.fallback))
            return false
        case let .success(request):
            return await submit(
                request,
                successKey: "scheduled.toast.scheduled",
                successFallback: "Maintenance window scheduled.",
                failureKey: "scheduled.toast.failSchedule",
                failureFallback: "Failed to schedule"
            )
        }
    }

    /// Clears the active maintenance window (web `handleClear`).
    @discardableResult
    public func clear() async -> Bool {
        guard !isMutating else { return false }
        return await submit(
            .clear,
            successKey: "scheduled.toast.cleared",
            successFallback: "Maintenance cleared.",
            failureKey: "scheduled.toast.failClear",
            failureFallback: "Failed to clear maintenance"
        )
    }

    private func submit(
        _ request: MaintenanceUpdateRequest,
        successKey: String,
        successFallback: String,
        failureKey: String,
        failureFallback: String
    ) async -> Bool {
        isMutating = true
        let result = await source.submit(request)
        isMutating = false
        switch result {
        case .success:
            toast.success(ScheduledMaintenanceStrings.string(successKey, successFallback))
            return true
        case let .failure(message):
            let resolved = message.isEmpty
                ? ScheduledMaintenanceStrings.string(failureKey, failureFallback)
                : message
            toast.error(resolved)
            return false
        }
    }

    private func apply(_ input: ScheduledMaintenanceInput) {
        resolved = ScheduledMaintenanceProjection.resolve(input, formatter: formatter)
        let previous = connection
        connection = input.connection
        // Stale → one guarded auto-refresh on the transition into stale (prompt "stale chip +
        // auto-refresh"); a sustained stale feed does not re-fire until it recovers to live/offline.
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - In-memory source (previews + tests; the view never performs I/O)

/// In-memory source for previews + unit tests. Seed it with an initial input and a canned mutation
/// result, or drive it manually via `push(_:)` to script flows.
@MainActor
public final class InMemoryScheduledMaintenanceSource: ScheduledMaintenanceSource {
    public var onUpdate: (@MainActor (ScheduledMaintenanceInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var submitCount = 0
    public private(set) var lastRequest: MaintenanceUpdateRequest?

    private let initial: ScheduledMaintenanceInput?
    private let mutationResult: MaintenanceMutationResult

    public init(
        initial: ScheduledMaintenanceInput? = nil,
        mutationResult: MaintenanceMutationResult = .success(.ok)
    ) {
        self.initial = initial
        self.mutationResult = mutationResult
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

    public func submit(_ request: MaintenanceUpdateRequest) async -> MaintenanceMutationResult {
        submitCount += 1
        lastRequest = request
        return mutationResult
    }

    /// Pushes a maintenance snapshot to the bound model (test/preview affordance).
    public func push(_ input: ScheduledMaintenanceInput) {
        onUpdate?(input)
    }
}
