//
//  Drawer.Model.swift
//  TeslaSync — P4 modal / dialog · 0013 · Drawer (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `Drawer` owns only its open/close +
//  focus-trap lifecycle; its body states belong to whatever `children` it hosts. The native surface
//  reproduces that lifecycle AND the hosted body's data lifecycle here: a `DrawerSource` pushes the
//  resolved rows + load / freshness status, and the model owns the resolved body phase, the reload-
//  failure banner, the stale auto-refresh, the dismissal command (web `onClose`), and the accessible
//  dialog label, emitting the P1/S11 `view.opened` event once per presentation. No networking lives in
//  the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `DrawerSource`, holds the latest rows +
/// freshness, exposes the resolved body phase + the reload-failure banner + the accessible dialog
/// label, and drives the dismissal command seam (web `onClose`).
@MainActor
@Observable
public final class DrawerModel {
    // Body rows + load / freshness (from the source)
    public private(set) var items: [DrawerContentItem] = []
    public private(set) var phase: DrawerPhase = .loading
    public private(set) var connection: DrawerConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    // MARK: Static presentation (web props)

    /// The host-supplied, already-localized panel title (web `title`). `nil` ⇒ no header (web
    /// `title && <header/>`).
    public let title: String?
    /// The side the panel anchors to + slides from (web `side`).
    public let edge: DrawerEdge
    /// Whether the footer action bar renders (web `footer &&` — the footer is an optional slot).
    public let showsFooter: Bool

    @ObservationIgnored private let source: any DrawerSource
    @ObservationIgnored private let telemetry: any DrawerTelemetry
    @ObservationIgnored private let onClose: @MainActor () -> Void
    @ObservationIgnored private let emptyMessageOverride: String?
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any DrawerSource,
        title: String? = nil,
        edge: DrawerEdge = .trailing,
        showsFooter: Bool = true,
        emptyMessage: String? = nil,
        telemetry: any DrawerTelemetry = OSLogDrawerTelemetry(),
        onClose: @escaping @MainActor () -> Void = {},
        localize: @escaping (String, String) -> String = DrawerStrings.string
    ) {
        self.source = source
        self.title = title
        self.edge = edge
        self.showsFooter = showsFooter
        emptyMessageOverride = emptyMessage
        self.telemetry = telemetry
        self.onClose = onClose
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived

    /// Whether the titled header renders (web `title && <header/>`).
    public var hasHeader: Bool {
        title != nil
    }

    /// The dialog's accessible label — web `aria-label={title || 'Panel'}`.
    public var dialogLabel: String {
        DrawerProjection.dialogLabel(title: title, localize: localize)
    }

    /// The reload-failure banner message kept while cached rows remain (web reload-with-children
    /// failure), else `nil`.
    public var reloadFailureMessage: String? {
        DrawerProjection.reloadFailure(status: latestStatus, hasItems: !items.isEmpty)
    }

    /// The empty-state copy: the host override (web parent-provided empty children) else the default.
    public var emptyMessage: String {
        emptyMessageOverride ?? localize("drawer.empty.default", "Nothing to show here yet")
    }

    /// The footer's item-count summary line.
    public var countSummary: String {
        DrawerProjection.countSummary(items.count, localize: localize)
    }

    /// The close affordance's VoiceOver label (web close `aria-label`).
    public var closeAccessibilityLabel: String {
        DrawerAccessibility.closeLabel(localize: localize)
    }

    /// The dismiss action's VoiceOver label (VoiceOver escape + scrim).
    public var dismissAccessibilityLabel: String {
        DrawerAccessibility.dismissLabel(localize: localize)
    }

    /// The per-state VoiceOver summary for the dialog.
    public var accessibilitySummary: String {
        DrawerAccessibility.summary(phase: phase, connection: connection, localize: localize)
    }

    @ObservationIgnored private var latestStatus: DrawerLoadStatus = .loading

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event once per presentation. Idempotent
    /// within a presentation; re-armed by `stop()` so a later re-present re-emits.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DrawerSurface.slug)
        source.start()
    }

    /// Stops observing the upstream body feed and re-arms the `view.opened` emission for the next
    /// presentation (web unmount).
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (the error-state retry / the stale auto-refresh).
    public func retry() {
        source.refresh()
    }

    // MARK: Command (web `onClose`)

    /// Dismisses the drawer — the single path shared by the scrim tap, the close "×", the footer
    /// action, and the Escape / VoiceOver-escape gesture (web `onClose`). The presenting host reacts by
    /// unmounting this surface, which drives `stop()` through `onDisappear`.
    public func dismiss() {
        onClose()
    }

    // MARK: Snapshot application

    private func apply(_ update: DrawerUpdate) {
        latestStatus = update.status
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        items = update.items
        phase = DrawerProjection.resolvePhase(status: update.status, hasItems: !update.items.isEmpty)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached rows on screen and does
    /// not refetch.
    private func handleAutoRefresh(for connection: DrawerConnection) {
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
