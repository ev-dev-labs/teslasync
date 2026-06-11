//
//  SavedViewMenu.Model.swift
//  TeslaSync — P4 shared surface · 0102 · SavedViewMenu (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), the
//  connectivity axis, the input snapshot, and the surface metadata for the saved-views menu. The view
//  binds through `SavedViewMenuModel`; no networking lives in the view. The web `SavedViewMenu` reads
//  `useSavedViews(route)`, derives the active + default view, auto-applies the default once on mount,
//  and owns the popover / save / rename / delete / manage dialog state. The native model keeps the
//  same contract: a read source emits the current views snapshot plus the parent's loading / error /
//  connectivity state, a mutation seam performs create / update / delete / setDefault, and the
//  projection derives the render phase so the view is a pure function of the resolved state. The
//  dialog + mutation orchestration lives in `SavedViewMenu.Actions.swift` (lint length budget).
//

import Foundation
import Observation
import OSLog

// MARK: - Surface metadata (so the model is testable without the SwiftUI View)

/// Surface identity shared by the model (telemetry) and the SwiftUI `SavedViewMenu` view, so the
/// model can emit `view.opened` with a stable slug without depending on the view type (mirrors the
/// `ChartExportMenuMeta` precedent).
public enum SavedViewMenuMeta {
    public static let surfaceSlug = "SavedViewMenu"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol SavedViewMenuTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogSavedViewMenuTelemetry: SavedViewMenuTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound saved-views feed — the orthogonal connectivity axis rendered as the
/// freshness chip. `live` hides the chip; `stale` / `offline` show it.
public enum SavedViewMenuConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props: route + currentQuery + useSavedViews result + onApply)

/// One coalesced snapshot of the menu's inputs — the native mirror of the web `route` / `currentQuery`
/// props and the `useSavedViews(route)` result, plus the parent's lifecycle (`isLoading`, an error
/// message, connectivity) and the `onApply` callback that re-applies a view's querystring (the empty
/// string clears the URL). Main-actor only (the `onApply` callback drives SwiftUI navigation state),
/// so it is intentionally not `Sendable` and never crosses an actor boundary.
public struct SavedViewMenuInput {
    public var views: [SavedView]
    public var route: String
    public var currentQuery: String
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: SavedViewMenuConnection
    public var onApply: @MainActor (String) -> Void

    public init(
        views: [SavedView] = [],
        route: String = "",
        currentQuery: String = "",
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: SavedViewMenuConnection = .live,
        onApply: @escaping @MainActor (String) -> Void = { _ in }
    ) {
        self.views = views
        self.route = route
        self.currentQuery = currentQuery
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
        self.onApply = onApply
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `SavedViewMenuSource`, recomputes the
/// resolved projection, owns the popover + save / rename / delete / manage dialog state, performs the
/// mutations through a `SavedViewMenuMutating` seam, exposes the render `phase`, the resolved
/// view-state, and the `connection` axis, emits `view.opened` once, auto-applies the default view once
/// on first resolved snapshot, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class SavedViewMenuModel {
    public private(set) var resolved: SavedViewMenuResolved
    public private(set) var connection: SavedViewMenuConnection = .live

    // Dialog state (web `open` / `saveOpen` / `renameTarget` / `deleteTarget` / `manageOpen`).
    public var isMenuPresented = false
    public var isSaveDialogPresented = false
    public var isManagePresented = false
    public var renameTarget: SavedViewRow?
    public var deleteTarget: SavedViewRow?

    // Per-mutation in-flight flags (web `isPending` per hook — drives the dialog button spinners).
    public private(set) var isSaving = false
    public private(set) var isRenaming = false
    public private(set) var isDeleting = false

    public var phase: SavedViewMenuResolved.Phase {
        resolved.phase
    }

    let source: any SavedViewMenuSource
    let mutations: any SavedViewMenuMutating
    @ObservationIgnored var input: SavedViewMenuInput?
    @ObservationIgnored private let telemetry: any SavedViewMenuTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoApply = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SavedViewMenuSource,
        mutations: any SavedViewMenuMutating = LiveSavedViewMenuMutations(),
        telemetry: any SavedViewMenuTelemetry = OSLogSavedViewMenuTelemetry()
    ) {
        self.source = source
        self.mutations = mutations
        self.telemetry = telemetry
        resolved = SavedViewMenuProjection.resolve(SavedViewMenuInput(isLoading: true))
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event exactly once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: SavedViewMenuMeta.surfaceSlug)
        }
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Applies a saved view's querystring — web `handleApply`: re-apply, close the popover, announce.
    public func apply(_ row: SavedViewRow) {
        input?.onApply(row.query)
        isMenuPresented = false
        announce(SavedViewMenuFormat.appliedAnnouncement(name: row.name, strings: strings))
    }

    /// Clears the applied view — web `handleClear`: re-apply the empty querystring + announce.
    public func clearApplied() {
        input?.onApply("")
        announce(SavedViewMenuFormat.clearedAnnouncement(strings: strings))
    }

    /// Toggles the popover (web trigger button `setOpen((v) => !v)`).
    public func toggleMenu() {
        isMenuPresented.toggle()
    }

    // MARK: Snapshot handling

    func apply(_ input: SavedViewMenuInput) {
        self.input = input
        connection = input.connection
        pruneTargets(for: input)
        recompute()
        autoApplyDefaultIfNeeded(for: input)
        handleAutoRefresh(for: input.connection)
    }

    func recompute() {
        guard let input else { return }
        resolved = SavedViewMenuProjection.resolve(input)
    }

    /// Drops a rename / delete target whose row vanished after an update (web menu closing after a
    /// destructive action so a stale target can't linger).
    private func pruneTargets(for input: SavedViewMenuInput) {
        let ids = Set(input.views.map(\.id))
        if let renameTarget, !ids.contains(renameTarget.id) { self.renameTarget = nil }
        if let deleteTarget, !ids.contains(deleteTarget.id) { self.deleteTarget = nil }
    }

    /// Web auto-apply: the first time a default view is present, mark as applied; only re-apply when
    /// the URL has no querystring (never override a deep-link). No default yet → retry on a later
    /// snapshot (matches the web `if (!defaultView) return;` before the ref is set).
    private func autoApplyDefaultIfNeeded(for input: SavedViewMenuInput) {
        guard !didAutoApply else { return }
        guard let defaultView = input.views.first(where: { $0.isDefault }) else { return }
        didAutoApply = true
        guard input.currentQuery.isEmpty else { return }
        input.onApply(defaultView.query)
    }

    /// Stale → one guarded refresh on the transition; reset once live so a later stale episode
    /// re-triggers exactly once. Offline never auto-refreshes.
    private func handleAutoRefresh(for connection: SavedViewMenuConnection) {
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

    // MARK: Mutation-flag plumbing (used by SavedViewMenu.Actions)

    func setSaving(_ value: Bool) {
        isSaving = value
    }

    func setRenaming(_ value: Bool) {
        isRenaming = value
    }

    func setDeleting(_ value: Bool) {
        isDeleting = value
    }

    private var announcer: ((String) -> Void)?

    /// Injects the live-region announcer (web `useAnnouncer`). The view wires this to the shared
    /// `AnnouncerRegion` so applied / cleared changes are spoken; absent in previews / tests.
    public func bindAnnouncer(_ announce: @escaping (String) -> Void) {
        announcer = announce
    }

    func announce(_ message: String) {
        announcer?(message)
    }

    var strings: SavedViewMenuResolve {
        SavedViewMenuStrings.string
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "SavedViewMenu" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings.
public enum SavedViewMenuStrings {
    public static let table = "SavedViewMenu"

    /// The name-field prompt key — kept verbatim for i18n parity with the web source.
    static let namePromptKey = "savedViews.namePlaceholder" // parity:allow web input prompt i18n key

    public static let string: SavedViewMenuResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
