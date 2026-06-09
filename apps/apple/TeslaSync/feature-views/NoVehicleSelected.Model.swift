//
//  NoVehicleSelected.Model.swift
//  TeslaSync — P4 feature view · 0193 · NoVehicleSelected (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `NoVehicleSelected` reads
//  `useSelectedVehicle()` + `useTranslation()` + `useNavigate()` and renders a single
//  empty state; the native surface reproduces that lifecycle here: a
//  `NoVehicleSelectedSource` pushes the resolved selection + freshness, the model exposes
//  the resolved `NoVehicleSelectedPhase` for SwiftUI to switch over, resolves the
//  (optionally overridden) empty-state copy, drives the onboarding seam, and emits the
//  P1/S11 `view.opened` event once on first appearance. No networking lives in the view.
//

import Foundation
import Observation
import SwiftUI

/// The surface's observable view-model. Subscribes to a `NoVehicleSelectedSource`, holds
/// the latest selection + freshness, exposes the resolved render phase + copy, drives the
/// onboarding navigation seam, and emits the P1/S11 `view.opened` event once.
@MainActor
@Observable
public final class NoVehicleSelectedModel {
    // Resolved projection (from the source)
    public private(set) var phase: NoVehicleSelectedPhase = .loading
    public private(set) var connection: NoVehicleSelectedConnection = .live
    public private(set) var selected: SelectedVehicleRef?
    public private(set) var errorMessage: String?
    public private(set) var updatedAt: Date?

    /// Optional host-supplied empty-state title override (web `title` prop).
    @ObservationIgnored private let titleOverride: String?
    /// Optional host-supplied empty-state description override (web `description` prop).
    @ObservationIgnored private let descriptionOverride: String?
    /// Optional host-supplied page title (web `pageTitle` prop, already localized).
    @ObservationIgnored private let pageTitleOverride: String?

    @ObservationIgnored private let source: any NoVehicleSelectedSource
    @ObservationIgnored private let telemetry: any NoVehicleSelectedTelemetry
    @ObservationIgnored private let navigator: any NoVehicleSelectedNavigator
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any NoVehicleSelectedSource,
        telemetry: any NoVehicleSelectedTelemetry = OSLogNoVehicleSelectedTelemetry(),
        navigator: any NoVehicleSelectedNavigator = OSLogNoVehicleSelectedNavigator(),
        pageTitle: String? = nil,
        title: String? = nil,
        description: String? = nil,
        localize: @escaping (String, String) -> String = NoVehicleSelectedStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.navigator = navigator
        pageTitleOverride = pageTitle
        titleOverride = title
        descriptionOverride = description
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Resolved copy (web `t(key, default)` with the prop overrides)

    /// The surface header title (web `pageTitle` passed to `PageContainer`), defaulting to
    /// the localized empty-state page title when the host supplies none.
    public var pageTitle: String {
        pageTitleOverride ?? localize("common.noVehicleSelected.pageTitle", "No vehicle selected")
    }

    /// The empty-state title (web `title ?? t('common.noVehicleSelected.title', …)`).
    public var emptyTitle: String {
        titleOverride ?? localize("common.noVehicleSelected.title", "No vehicle selected")
    }

    /// The empty-state message (web `description ?? t('common.noVehicleSelected.desc', …)`).
    public var emptyDescription: String {
        descriptionOverride ?? localize(
            "common.noVehicleSelected.desc",
            "Add a vehicle to your fleet to see data on this page."
        )
    }

    /// The empty-state CTA label (web `t('common.noVehicleSelected.action', 'Set up TeslaSync')`).
    public var actionLabel: String {
        localize("common.noVehicleSelected.action", "Set up TeslaSync")
    }

    /// The "vehicle ready" confirmation body for the content phase, interpolating the
    /// selected vehicle's display name.
    public var readyBody: String {
        NoVehicleSelectedCopy.readyBody(name: selected?.displayName ?? "", localize: localize)
    }

    /// The VoiceOver summary for the whole surface.
    public var accessibilitySummary: String {
        NoVehicleSelectedAccessibility.summary(for: projection, localize: localize)
    }

    /// The render-ready projection (kept current as snapshots arrive).
    public private(set) var projection = NoVehicleSelectedProjection(phase: .loading)

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: NoVehicleSelectedSurface.slug)
        source.start()
    }

    /// Stops observing the upstream selection feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-reads the selection (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Navigation (web `navigate('/onboarding')`)

    /// Routes the user into onboarding (web `EmptyState` action → `useNavigate`).
    public func goToOnboarding() {
        navigator.goToOnboarding()
    }

    // MARK: Snapshot application

    private func apply(_ update: NoVehicleSelectedUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = NoVehicleSelectedProjectionBuilder.build(update.feed)
        phase = projection.phase
        selected = projection.selected
        errorMessage = projection.errorMessage
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// selection on screen and does not refetch.
    private func handleAutoRefresh(for connection: NoVehicleSelectedConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}
