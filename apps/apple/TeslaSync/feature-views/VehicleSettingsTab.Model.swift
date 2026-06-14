//
//  VehicleSettingsTab.Model.swift
//  TeslaSync — P4 feature view · 0308 · VehicleSettingsTab (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the per-vehicle settings surface — the SwiftUI parity of
//  features/vehicles/components/VehicleSettingsTab.tsx. The view binds through
//  `VehicleSettingsTabModel`; no networking lives in the view. The web component is
//  driven by `useVehicleSettings` (the resolver feed), `useUpsertVehicleSetting`
//  (the PUT mutation), and `useResetVehicleSetting` (the DELETE mutation); this model
//  folds the read feed into a `phase` + per-row editable state and exposes the two
//  mutations as a save/reset seam.
//
//  States: the web section is `isLoading ? skeleton : isError ? error : <rows>`. On
//  top of that this surface honours the P4 leaf contract: a `phase` (loading / empty /
//  error / data), an orthogonal `connection` axis (live / stale / offline) surfaced as
//  a freshness chip + banner with a one-shot auto-refresh on the stale transition, and
//  per-row save/reset lifecycles backing the web `isPending` buttons + inline
//  validation.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol VehicleSettingsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogVehicleSettingsTelemetry: VehicleSettingsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the
/// header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum VehicleSettingsConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Per-row action lifecycle (web mutation `isPending`)

/// One row's mutation lifecycle — the native mirror of the web `useMutation` status
/// that drives a button (`isPending` → "Saving…" / "Resetting…").
public enum RowActionPhase: Sendable, Equatable {
    case idle
    case inFlight
}

/// The settled result of a save/reset the source reports back — the native mirror of
/// the web mutation resolving to success (refetch) or an error toast.
public enum VehicleSettingOutcome: Sendable, Equatable {
    case saveSucceeded
    case saveFailed(String)
    case resetSucceeded
    case resetFailed(String)
}

// MARK: - State-holder seam (P1/S8 layer; never HTTP from the view)

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 vehicle-settings state holder (the resolver feed) and its upsert/reset
/// mutations; previews and tests use `InMemoryVehicleSettingsSource`. The view never
/// talks to the network directly.
@MainActor
public protocol VehicleSettingsSource: AnyObject {
    var onUpdate: (@MainActor (VehicleSettingsInput) -> Void)? { get set }
    var onOutcome: (@MainActor (String, VehicleSettingOutcome) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    func upsert(key: String, value: VehicleSettingValue)
    func reset(key: String)
}

// MARK: - Per-row view state

/// One row's full editable state — the descriptor, its resolved source, the live draft
/// vs its hydrated baseline (for the dirty check), the inline validation + action error
/// slots, and the two mutation phases. A pure value the view renders.
public struct RowViewState: Identifiable, Equatable, Sendable {
    public let descriptor: VehicleSettingDescriptor
    public internal(set) var source: EffectiveSettingSource
    public internal(set) var draft: RowDraft
    public internal(set) var baseline: RowDraft
    public internal(set) var validationError: String?
    public internal(set) var actionError: String?
    public internal(set) var savePhase: RowActionPhase
    public internal(set) var resetPhase: RowActionPhase
    /// The last effective value seen from the feed (drives the re-hydrate-on-change
    /// rule — web `useEffect([initialDraft])`).
    var effectiveValue: String?

    public var id: String {
        descriptor.key
    }

    /// The draft differs from its hydrated baseline (web dirty form).
    public var isDirty: Bool {
        draft != baseline
    }

    /// Only `override` rows can be reset (web `source === 'override'`).
    public var isOverride: Bool {
        source == .override
    }

    /// Save is offered only when edited and not already saving (web button gate).
    public var canSave: Bool {
        isDirty && savePhase == .idle
    }

    /// Reset is offered only for overrides not already resetting (web button gate).
    public var canReset: Bool {
        isOverride && resetPhase == .idle
    }
}

// MARK: - View model

/// The surface's observable view-model. Subscribes to a `VehicleSettingsSource`,
/// projects the read feed into a `phase` + ordered per-row editable state, exposes the
/// `connection` axis, drives the per-row save/reset lifecycles + inline validation, and
/// auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class VehicleSettingsTabModel {
    public private(set) var resolved: VehicleSettingsResolved =
        VehicleSettingsProjection.resolve(VehicleSettingsInput(isLoading: true))
    public private(set) var connection: VehicleSettingsConnection = .live
    public private(set) var rows: [RowViewState] = []

    @ObservationIgnored private let source: any VehicleSettingsSource
    @ObservationIgnored private let telemetry: any VehicleSettingsTelemetry
    @ObservationIgnored private let descriptors: [VehicleSettingDescriptor]
    @ObservationIgnored private var started = false

    public init(
        source: any VehicleSettingsSource,
        telemetry: any VehicleSettingsTelemetry = OSLogVehicleSettingsTelemetry(),
        descriptors: [VehicleSettingDescriptor] = VehicleSettingsCatalog.descriptors
    ) {
        self.source = source
        self.telemetry = telemetry
        self.descriptors = descriptors
        source.onUpdate = { [weak self] input in self?.apply(input) }
        source.onOutcome = { [weak self] key, outcome in self?.applyOutcome(key: key, outcome: outcome) }
    }

    /// The current render phase (web render gate + P4 leaf contract).
    public var phase: VehicleSettingsResolved.Phase {
        resolved.phase
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: VehicleSettingsTab.surfaceSlug)
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

    /// Edits one row's draft (web per-row `setDraft`). Clears that row's prior
    /// validation + action error so the user gets a clean retry. Text drafts are
    /// clamped to the descriptor's `maxLength`.
    public func edit(key: String, draft: RowDraft) {
        guard let index = rows.firstIndex(where: { $0.descriptor.key == key }) else { return }
        rows[index].draft = clamp(draft, for: rows[index].descriptor)
        rows[index].validationError = nil
        rows[index].actionError = nil
    }

    /// Validates + persists one row (web `handleSave` → `useUpsertVehicleSetting`).
    /// Invalid/empty drafts set the inline error and short-circuit; a valid draft moves
    /// the row into `saving` and hands the typed value to the seam.
    public func save(key: String) {
        guard let index = rows.firstIndex(where: { $0.descriptor.key == key }) else { return }
        guard rows[index].canSave else { return }
        let row = rows[index]
        switch VehicleSettingsDraft.parse(row.descriptor, row.draft) {
        case .empty:
            rows[index].validationError = VehicleSettingsStrings.string(
                "vehicleSettings.validation.required", "Value is required."
            )
        case let .invalid(messageKey, fallback):
            rows[index].validationError = VehicleSettingsStrings.string(messageKey, fallback)
        case let .ok(value):
            rows[index].validationError = nil
            rows[index].actionError = nil
            rows[index].savePhase = .inFlight
            source.upsert(key: key, value: value)
        }
    }

    /// Resets one row to its inherited default (web `handleReset` →
    /// `useResetVehicleSetting`). A no-op unless the row is an override.
    public func reset(key: String) {
        guard let index = rows.firstIndex(where: { $0.descriptor.key == key }) else { return }
        guard rows[index].canReset else { return }
        rows[index].actionError = nil
        rows[index].resetPhase = .inFlight
        source.reset(key: key)
    }

    private func apply(_ input: VehicleSettingsInput) {
        resolved = VehicleSettingsProjection.resolve(input, descriptors: descriptors)
        mergeRows(resolved.rows)

        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    /// Merges the freshly resolved rows into the editable state, preserving in-flight
    /// drafts when a row's effective value is unchanged and re-hydrating it (web
    /// `useEffect([initialDraft])`) when it changes — e.g. after a save/reset refetch.
    private func mergeRows(_ resolvedRows: [ResolvedRow]) {
        rows = resolvedRows.map { row in
            let baseline = VehicleSettingsDraft.initialDraft(for: row.descriptor, value: row.value)
            guard
                let existing = rows.first(where: { $0.descriptor.key == row.descriptor.key }),
                existing.effectiveValue == row.value
            else {
                // First sight or the effective value changed → re-hydrate the row.
                return RowViewState(
                    descriptor: row.descriptor,
                    source: row.source,
                    draft: baseline,
                    baseline: baseline,
                    validationError: nil,
                    actionError: nil,
                    savePhase: .idle,
                    resetPhase: .idle,
                    effectiveValue: row.value
                )
            }
            // Effective value unchanged → keep the user's draft + error + phases, but
            // refresh the resolved source (override⇄inherited can flip without a value
            // change) and the baseline.
            var preserved = existing
            preserved.source = row.source
            preserved.baseline = baseline
            return preserved
        }
    }

    private func applyOutcome(key: String, outcome: VehicleSettingOutcome) {
        guard let index = rows.firstIndex(where: { $0.descriptor.key == key }) else { return }
        switch outcome {
        case .saveSucceeded:
            rows[index].savePhase = .idle
            rows[index].actionError = nil
        case .saveFailed:
            rows[index].savePhase = .idle
            rows[index].actionError = VehicleSettingsStrings.string(
                "vehicleSettings.errors.save", "Failed to save setting."
            )
        case .resetSucceeded:
            rows[index].resetPhase = .idle
            rows[index].actionError = nil
        case .resetFailed:
            rows[index].resetPhase = .idle
            rows[index].actionError = VehicleSettingsStrings.string(
                "vehicleSettings.errors.reset", "Failed to reset setting."
            )
        }
    }

    private func clamp(_ draft: RowDraft, for descriptor: VehicleSettingDescriptor) -> RowDraft {
        guard case let .text(value) = draft, let maxLength = descriptor.maxLength, value.count > maxLength else {
            return draft
        }
        return .text(String(value.prefix(maxLength)))
    }
}

// MARK: - In-memory source (previews + tests; the view never performs I/O)

/// In-memory source for previews + unit/UI tests. Seed it with an initial input, then
/// drive it manually via `push(_:)` / `pushOutcome(key:outcome:)` to script multi-step
/// save/reset flows. Records call counts + the last upsert/reset for assertions.
@MainActor
public final class InMemoryVehicleSettingsSource: VehicleSettingsSource {
    public var onUpdate: (@MainActor (VehicleSettingsInput) -> Void)?
    public var onOutcome: (@MainActor (String, VehicleSettingOutcome) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var upsertCount = 0
    public private(set) var resetCount = 0
    public private(set) var lastUpsert: (key: String, value: VehicleSettingValue)?
    public private(set) var lastReset: String?

    private let initial: VehicleSettingsInput?

    public init(initial: VehicleSettingsInput? = nil) {
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

    public func upsert(key: String, value: VehicleSettingValue) {
        upsertCount += 1
        lastUpsert = (key, value)
    }

    public func reset(key: String) {
        resetCount += 1
        lastReset = key
    }

    /// Pushes a settings snapshot to the bound model (test/preview affordance).
    public func push(_ input: VehicleSettingsInput) {
        onUpdate?(input)
    }

    /// Pushes a save/reset outcome to the bound model (test/preview affordance).
    public func pushOutcome(key: String, outcome: VehicleSettingOutcome) {
        onOutcome?(key, outcome)
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for a row from already-localised parts, so the spoken
/// content is asserted without rendering the view.
public enum VehicleSettingsAccessibility {
    /// The row header spoken label: "{label}, {source}".
    public static func rowLabel(label: String, source: String) -> String {
        "\(label), \(source)"
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "VehicleSettingsTab" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time. The web source
/// keys (`vehicleSettings.*`) are preserved verbatim so a shared catalog resolves
/// identically across web and native.
public enum VehicleSettingsStrings {
    public static let table = "VehicleSettingsTab"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
