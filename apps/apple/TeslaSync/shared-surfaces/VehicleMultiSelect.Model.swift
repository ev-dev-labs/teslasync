//
//  VehicleMultiSelect.Model.swift
//  TeslaSync — P4 shared surface · 0163 · VehicleMultiSelect (Apple)
//
//  The i18n facade (P1/S10) and the observable state-holder (P1/S8) for the Alert Studio multi-vehicle
//  picker. The web `<VehicleMultiSelect>` is a controlled component: it takes its `value` + `vehicles` +
//  `errorKey` + `disabled` as props and routes every edit back out through `onChange`; its only hooks are
//  `useTranslation` (the `vehicles*` keys) and `useId` (the trigger / popover / error element ids). The native
//  peer keeps that contract — the host's current fleet + selection arrive through ``VehicleMultiSelectSource``
//  snapshots, and a toggle routes back out through the host-supplied `onChange` closure — while the holder
//  owns the popover-open + remembered-subset interaction state (web `open` + `previousSpecificRef`), derives
//  the view-ready projection, drives the P4 leaf phases (loading / content / empty / error) + the freshness
//  axis, and emits `view.opened` exactly once.
//

import Foundation
import Observation

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded prose.
/// The nine `notifications.alertStudio.editor.vehicles*` keys are the verbatim peers of the web `t()` calls;
/// the `vehicleMultiSelect.*` keys are the native chrome / a11y additions the P4 leaf states + freshness axis
/// need. Keys live in the "VehicleMultiSelect" table, folded into the app `Localizable.xcstrings` at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping the
/// labels deterministic.
public enum VehicleMultiSelectStrings {
    public static let table = "VehicleMultiSelect"

    public static let string: VehicleMultiSelectResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Replaces `{{token}}` markers — the native port of i18next interpolation.
    static func interpolate(_ template: String, _ values: [String: String]) -> String {
        var result = template
        for (key, value) in values {
            result = result.replacingOccurrences(of: "{{\(key)}}", with: value)
        }
        return result
    }

    // MARK: Web `t()` keys (verbatim)

    /// The trigger label for the fleet sentinel (web `vehiclesSummaryAll`).
    static func summaryAll(_ localize: VehicleMultiSelectResolve = string) -> String {
        localize("notifications.alertStudio.editor.vehiclesSummaryAll", "All vehicles")
    }

    /// The trigger label for a specific-but-empty selection (web `vehiclesSummaryNone`).
    static func summaryNone(_ localize: VehicleMultiSelectResolve = string) -> String {
        localize("notifications.alertStudio.editor.vehiclesSummaryNone", "No vehicles selected")
    }

    /// The single-vehicle trigger label (web `vehiclesSummaryOne` — "{{name}}").
    static func summaryOne(name: String, _ localize: VehicleMultiSelectResolve = string) -> String {
        interpolate(localize("notifications.alertStudio.editor.vehiclesSummaryOne", "{{name}}"), ["name": name])
    }

    /// The strict-subset trigger label (web `vehiclesSummaryPartial` — "{{count}} of {{total}} vehicles").
    static func summaryPartial(count: Int, total: Int, _ localize: VehicleMultiSelectResolve = string) -> String {
        interpolate(
            localize("notifications.alertStudio.editor.vehiclesSummaryPartial", "{{count}} of {{total}} vehicles"),
            ["count": String(count), "total": String(total)]
        )
    }

    /// The all-known-selected trigger label (web `vehiclesSummaryCount` — "{{count}} vehicles").
    static func summaryCount(_ count: Int, _ localize: VehicleMultiSelectResolve = string) -> String {
        interpolate(
            localize("notifications.alertStudio.editor.vehiclesSummaryCount", "{{count}} vehicles"),
            ["count": String(count)]
        )
    }

    /// The empty-fleet help line under the disabled trigger (web `vehiclesEmptyFleetHelp`).
    static func emptyFleetHelp(_ localize: VehicleMultiSelectResolve = string) -> String {
        localize(
            "notifications.alertStudio.editor.vehiclesEmptyFleetHelp",
            "Add a vehicle in Settings → Vehicles to use this rule."
        )
    }

    /// The All-sentinel popover row (web `vehiclesAllOption`).
    static func allOption(_ localize: VehicleMultiSelectResolve = string) -> String {
        localize("notifications.alertStudio.editor.vehiclesAllOption", "All vehicles (current + future)")
    }

    /// One unknown-id popover row label (web `vehiclesUnknownLabel` — "Vehicle #{{id}}").
    static func unknownLabel(id: Int, _ localize: VehicleMultiSelectResolve = string) -> String {
        interpolate(
            localize("notifications.alertStudio.editor.vehiclesUnknownLabel", "Vehicle #{{id}}"),
            ["id": String(id)]
        )
    }

    /// The trailing badge on an unknown-id row (web `vehiclesUnknownBadge`).
    static func unknownBadge(_ localize: VehicleMultiSelectResolve = string) -> String {
        localize("notifications.alertStudio.editor.vehiclesUnknownBadge", "Unknown")
    }

    // MARK: Web inline fallback, routed through the facade (web `vehicleLabel` base `Vehicle #${id}`)

    /// The in-fleet label fallback for a vehicle with no name and no model (web inline `Vehicle #${v.id}`).
    static func fleetFallbackName(id: Int, _ localize: VehicleMultiSelectResolve = string) -> String {
        interpolate(localize("vehicleMultiSelect.fleetFallbackName", "Vehicle #{{id}}"), ["id": String(id)])
    }

    // MARK: Native chrome / a11y additions

    static func popoverA11y(_ localize: VehicleMultiSelectResolve = string) -> String {
        localize("vehicleMultiSelect.popoverA11y", "Choose vehicles")
    }

    static func triggerA11yHint(_ localize: VehicleMultiSelectResolve = string) -> String {
        localize("vehicleMultiSelect.triggerHint", "Opens the vehicle picker")
    }

    static func optionSelected(_ localize: VehicleMultiSelectResolve = string) -> String {
        localize("vehicleMultiSelect.optionSelected", "Selected")
    }

    static func optionNotSelected(_ localize: VehicleMultiSelectResolve = string) -> String {
        localize("vehicleMultiSelect.optionNotSelected", "Not selected")
    }

    static func loadingA11y(_ localize: VehicleMultiSelectResolve = string) -> String {
        localize("vehicleMultiSelect.loadingA11y", "Loading vehicles")
    }

    static func errorTitle(_ localize: VehicleMultiSelectResolve = string) -> String {
        localize("vehicleMultiSelect.errorTitle", "Couldn't load vehicles")
    }

    static func retry(_ localize: VehicleMultiSelectResolve = string) -> String {
        localize("vehicleMultiSelect.retry", "Retry")
    }

    static func live(_ localize: VehicleMultiSelectResolve = string) -> String {
        localize("vehicleMultiSelect.live", "Live")
    }

    static func stale(_ localize: VehicleMultiSelectResolve = string) -> String {
        localize("vehicleMultiSelect.stale", "Stale")
    }

    static func offline(_ localize: VehicleMultiSelectResolve = string) -> String {
        localize("vehicleMultiSelect.offline", "Offline")
    }

    static func staleA11y(_ localize: VehicleMultiSelectResolve = string) -> String {
        localize("vehicleMultiSelect.staleA11y", "Stale — tap to refresh")
    }

    static func offlineA11y(_ localize: VehicleMultiSelectResolve = string) -> String {
        localize("vehicleMultiSelect.offlineA11y", "Offline — showing the last fleet")
    }
}

// MARK: - VehicleMultiSelectModel (P1/S8) — selection state + derivation

/// The surface's observable state-holder. Owns the bound fleet (web `vehicles`), the controlled selection (web
/// `value`), the validation `errorKey` + `disabled` props, the popover-open + remembered-subset interaction
/// state (web `open` + `previousSpecificRef`), and the P4 phase + connectivity; derives the view-ready
/// ``VehicleMultiSelectProjection`` + the localized trigger summary + the inline error text; routes the
/// All-sentinel / per-vehicle toggles through the host's `onChange` (the web `onChange` prop); auto-refreshes
/// once on a stale transition; and emits `view.opened` exactly once.
@MainActor
@Observable
public final class VehicleMultiSelectModel {
    public private(set) var vehicles: [VehicleMultiSelectVehicle] = []
    public private(set) var value: VehicleMultiSelectValue = .allSticky
    public private(set) var errorKey: String?
    public private(set) var disabled = false
    public private(set) var phase: VehicleMultiSelectPhase = .loading
    public private(set) var connection: VehicleMultiSelectConnection = .live
    /// Whether the popover is open (web `open`). View-bound; toggled by the trigger.
    public private(set) var isOpen = false

    @ObservationIgnored private let source: any VehicleMultiSelectSource
    @ObservationIgnored private let onChange: @MainActor (VehicleMultiSelectValue) -> Void
    @ObservationIgnored private let telemetry: any VehicleMultiSelectTelemetry
    @ObservationIgnored let localize: VehicleMultiSelectResolve
    /// The remembered specific subset for the D13 toggle-OFF restore (web `previousSpecificRef`).
    @ObservationIgnored private var previousSpecific: [Int] = []
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefresh = false

    public init(
        source: any VehicleMultiSelectSource,
        onChange: @escaping @MainActor (VehicleMultiSelectValue) -> Void = { _ in },
        telemetry: any VehicleMultiSelectTelemetry = OSLogVehicleMultiSelectTelemetry(),
        localize: @escaping VehicleMultiSelectResolve = VehicleMultiSelectStrings.string
    ) {
        self.source = source
        self.onChange = onChange
        self.telemetry = telemetry
        self.localize = localize
        previousSpecific = value.selectedIDs
        source.onUpdate = { [weak self] snapshot in self?.ingest(snapshot) }
    }

    // MARK: Derived reads

    /// The resolved, view-ready picker — a pure function of the current value + fleet (web render output). The
    /// localized fleet-fallback + unknown labels are supplied to the pure projector.
    public var projection: VehicleMultiSelectProjection {
        VehicleMultiSelectProjector.projection(
            value: value,
            vehicles: vehicles,
            fallbackName: { [localize] id in VehicleMultiSelectStrings.fleetFallbackName(id: id, localize) },
            unknownLabel: { [localize] id in VehicleMultiSelectStrings.unknownLabel(id: id, localize) }
        )
    }

    /// The localized trigger summary text (web `triggerSummary`).
    public var summaryText: String {
        switch projection.summary {
        case .all:
            VehicleMultiSelectStrings.summaryAll(localize)
        case .none:
            VehicleMultiSelectStrings.summaryNone(localize)
        case let .one(name):
            VehicleMultiSelectStrings.summaryOne(name: name, localize)
        case let .partial(count, total):
            VehicleMultiSelectStrings.summaryPartial(count: count, total: total, localize)
        case let .count(count):
            VehicleMultiSelectStrings.summaryCount(count, localize)
        }
    }

    /// The resolved inline validation error text (web `errorKey ? t(errorKey) : null`), or `nil` when valid.
    public var errorText: String? {
        guard let errorKey, !errorKey.isEmpty else { return nil }
        return localize(errorKey, errorKey)
    }

    /// Whether the inline validation error is shown (web `hasError`).
    public var hasError: Bool {
        errorText != nil
    }

    /// Whether the trigger is interactive (web `disabled || isFleetEmpty`, negated).
    public var isTriggerEnabled: Bool {
        !disabled && !projection.isFleetEmpty && phase != .loading
    }

    // MARK: Lifecycle

    /// Begins the surface, emits `view.opened` once, and starts the source. Idempotent across appear churn.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: VehicleMultiSelectSurface.slug)
        }
        source.start()
    }

    /// Marks the surface inactive. The once-only `view.opened` contract is preserved.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the host's current fleet (web refetch) — the error-state retry + the freshness chip refresh.
    public func refresh() {
        source.refresh()
    }

    // MARK: Source ingestion

    /// Folds a pushed snapshot into the fleet + selection + validation + phase + connectivity, remembers the
    /// specific subset for the D13 restore (web `previousSpecificRef` effect), closes the popover when the
    /// fleet drops to empty, and auto-refreshes once on a stale read (reset after a live read).
    private func ingest(_ snapshot: VehicleMultiSelectSnapshot) {
        vehicles = snapshot.vehicles
        value = snapshot.value
        errorKey = snapshot.errorKey
        disabled = snapshot.disabled
        connection = snapshot.connection
        if case let .specific(ids) = snapshot.value {
            previousSpecific = ids
        }
        if snapshot.isLoading {
            phase = .loading
        } else if let message = snapshot.errorMessage {
            phase = .error(message)
        } else {
            phase = snapshot.vehicles.isEmpty ? .empty : .content
        }
        if snapshot.vehicles.isEmpty { isOpen = false }
        switch snapshot.connection {
        case .stale:
            guard !didAutoRefresh else { return }
            didAutoRefresh = true
            source.refresh()
        case .live:
            didAutoRefresh = false
        case .offline:
            break
        }
    }

    // MARK: Interactions (web `onClick` / `onChange`)

    /// Opens / closes the popover (web trigger `onClick={() => setOpen((v) => !v)}`). A no-op when the trigger
    /// is not interactive, so a disabled / empty-fleet / loading trigger never reveals the list.
    public func toggleOpen() {
        guard isTriggerEnabled else { return }
        isOpen.toggle()
    }

    /// Sets the popover-open state (the `.popover(isPresented:)` binding setter — outside-tap / escape close).
    public func setOpen(_ open: Bool) {
        isOpen = open && isTriggerEnabled
    }

    /// Toggle the All sentinel — restores the remembered subset when on, else moves to the fleet sentinel (web
    /// `handleToggleAll`), routing the result through the host `onChange`.
    public func toggleAll() {
        onChange(VehicleMultiSelectProjector.toggleAll(value, previousSpecific: previousSpecific))
    }

    /// Toggle one vehicle — add / remove it (web `handleToggleVehicle`), routing through the host `onChange`.
    public func toggleVehicle(id: Int) {
        onChange(VehicleMultiSelectProjector.toggleVehicle(value, id: id))
    }
}
