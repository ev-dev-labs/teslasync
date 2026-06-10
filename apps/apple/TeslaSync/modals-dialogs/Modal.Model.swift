//
//  Modal.Model.swift
//  TeslaSync — P4 modal/dialog · 0014 · Modal (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `Modal` keeps its open/close in caller
//  state and wraps arbitrary `children`; this model owns the same presentation configuration (open,
//  title, ariaLabel, size) plus the bound body lifecycle a `ModalSource` pushes — the resolved
//  `ModalBodyPhase`, the live-state freshness, the dismiss command seam (web `onClose`), and the
//  P1/S11 `view.opened` diagnostics emission. No network and no host-dismissal live in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `ModalSource`, exposes the resolved body
/// phase + freshness, resolves the dialog's accessibility labelling (web `aria-labelledby` /
/// `aria-label`), drives the dismiss command seam, and emits the `view.opened` event once on first
/// appearance.
@MainActor
@Observable
public final class ModalModel {
    /// Whether the overlay is presented (web `open`). A host binds its own presentation state to
    /// this; `close()` flips it false after handing off to the dismiss seam.
    public private(set) var isPresented: Bool

    /// The dialog title (web `title`) — labels the dialog and renders the header + close button.
    public let title: String?

    /// The accessibility label used when there is no visible title (web `ariaLabel`).
    public let ariaLabel: String?

    /// The width preset applied at/above the `sm` breakpoint (web `size`).
    public let size: ModalSize

    public private(set) var bodyPhase: ModalBodyPhase = .loading
    public private(set) var connection: ModalConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ModalSource
    @ObservationIgnored private let telemetry: any ModalTelemetry
    @ObservationIgnored private let controller: any ModalDismissController
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        isPresented: Bool = true,
        title: String? = nil,
        ariaLabel: String? = nil,
        size: ModalSize = .medium,
        source: any ModalSource,
        telemetry: any ModalTelemetry = OSLogModalTelemetry(),
        controller: any ModalDismissController = OSLogModalDismissController(),
        localize: @escaping (String, String) -> String = ModalStrings.string
    ) {
        self.isPresented = isPresented
        self.title = title
        self.ariaLabel = ariaLabel
        self.size = size
        self.source = source
        self.telemetry = telemetry
        self.controller = controller
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived

    /// The resolved dialog labelling (web `aria-labelledby` vs `aria-label`).
    public var label: ModalLabel {
        ModalProjection.resolveLabel(title: title, ariaLabel: ariaLabel)
    }

    /// Whether the titled header (heading + close button) renders (web `title && (<header/>)`).
    public var showsHeader: Bool {
        ModalProjection.showsHeader(title: title)
    }

    /// The dialog's VoiceOver label (web heading text / `aria-label` / a generic fallback).
    public var accessibilityLabel: String {
        ModalAccessibility.dialogLabel(for: label, localize: localize)
    }

    /// The VoiceOver summary for the current body phase.
    public var bodyAccessibilitySummary: String {
        ModalAccessibility.summary(for: bodyPhase, localize: localize)
    }

    /// Whether the body is showing cached content with no connectivity (drives the offline banner).
    public var isOffline: Bool {
        connection == .offline
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ModalSurface.slug)
        source.start()
    }

    /// Stops observing the upstream body feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-loads the modal body (web content refetch) — the error-state retry + stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    // MARK: Commands (web `onClose`)

    /// Dismisses the modal: hands off to the dismiss seam (host pops the presentation) and flips the
    /// local `isPresented` so a directly-bound surface collapses immediately. Invoked by the scrim,
    /// the close button, the swipe-down, and Esc — the web `onClose` fan-in.
    public func close() {
        controller.dismiss()
        isPresented = false
    }

    // MARK: Snapshot application

    private func apply(_ update: ModalUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        bodyPhase = ModalProjection.resolvePhase(status: update.status, hasContent: update.hasContent)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached body on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: ModalConnection) {
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
