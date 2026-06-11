//
//  RequiresAuth.Model.swift
//  TeslaSync — P4 shared surface · 0137 · RequiresAuth (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `RequiresAuth` binds `useAuthMode` (a
//  long-staleTime `/system/auth-mode` query) and renders either the wrapped section or the
//  vendor-neutral lock notice. The native surface reproduces that whole lifecycle here: a
//  `RequiresAuthSource` pushes the resolved contract snapshot + load / freshness status, the model
//  resolves the gate + render phase + lock notice copy, owns a one-shot stale auto-refresh, and emits
//  the P1/S11 `view.opened` event once on first appearance. No networking lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `RequiresAuthSource`, holds the latest
/// contract snapshot + freshness, resolves the gate (mount the section vs the lock notice) + the
/// render phase, and exposes the interpolated title / body copy + the stable per-capability selector.
@MainActor
@Observable
public final class RequiresAuthModel {
    /// The capability flag the wrapped section needs (web `capability`).
    public let capability: RequiresAuthCapability
    /// The already-translated, user-facing feature name interpolated into the copy (web `feature`).
    public let feature: String

    // Source state (web `useAuthMode`)
    public private(set) var loadStatus: RequiresAuthLoadStatus = .loading
    public private(set) var connection: RequiresAuthConnection = .live
    public private(set) var updatedAt: Date?
    public private(set) var snapshot: AuthModeSnapshot?

    // Resolved render state
    public private(set) var gate: RequiresAuthGate = .locked
    public private(set) var render: RequiresAuthRender = .loading

    @ObservationIgnored private let source: any RequiresAuthSource
    @ObservationIgnored private let telemetry: any RequiresAuthTelemetry
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        capability: RequiresAuthCapability,
        feature: String,
        source: any RequiresAuthSource,
        telemetry: any RequiresAuthTelemetry = OSLogRequiresAuthTelemetry(),
        localize: @escaping (String, String) -> String = RequiresAuthStrings.string
    ) {
        self.capability = capability
        self.feature = feature
        self.source = source
        self.telemetry = telemetry
        self.localize = localize
        recompute()
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived display

    /// The interpolated lock notice title (web `t('requiresAuth.title', { feature })`).
    public var title: String {
        RequiresAuthCopy.title(feature: feature, localize: localize)
    }

    /// The interpolated lock notice body — the operator-hint template when a `providerHint` is
    /// present, else the generic provider-list template (web `bodyWithHint` / `body`).
    public var body: String {
        RequiresAuthCopy.body(
            feature: feature,
            providerHint: snapshot?.providerHint,
            localize: localize
        )
    }

    /// The stable per-capability selector (web `requiresAuthEmptyTestId`), set as the lock notice's
    /// accessibility identifier so UI tests can assert the section is gated.
    public var testID: String {
        RequiresAuthProjection.testID(capability: capability)
    }

    // MARK: Accessibility

    /// The lock notice's combined VoiceOver label (title sentence + body).
    public var lockNoticeAccessibilityLabel: String {
        RequiresAuthAccessibility.lockNoticeSummary(
            feature: feature,
            providerHint: snapshot?.providerHint,
            localize: localize
        )
    }

    /// The loading-chrome VoiceOver label.
    public var loadingAccessibilityLabel: String {
        RequiresAuthAccessibility.loadingLabel(localize: localize)
    }

    /// The error-chrome VoiceOver label (failure title + transport message).
    public func errorAccessibilityLabel(message: String) -> String {
        RequiresAuthAccessibility.errorLabel(message: message, localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RequiresAuthSurface.slug)
        source.start()
    }

    /// Stops observing the upstream contract feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying contract poll (the error-state retry / stale refresh).
    public func refresh() {
        source.refresh()
    }

    // MARK: Snapshot application

    private func apply(_ update: RequiresAuthUpdate) {
        loadStatus = update.status
        connection = update.connection
        updatedAt = update.updatedAt
        snapshot = update.snapshot
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    /// Re-derives the gate + render phase from the current snapshot + load status.
    private func recompute() {
        gate = RequiresAuthProjection.resolveGate(snapshot: snapshot, capability: capability)
        render = RequiresAuthProjection.resolveRender(
            status: loadStatus,
            snapshot: snapshot,
            capability: capability
        )
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached snapshot on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: RequiresAuthConnection) {
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
