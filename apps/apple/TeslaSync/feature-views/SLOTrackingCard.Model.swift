//
//  SLOTrackingCard.Model.swift
//  TeslaSync — P4 feature view · 0253 · SLOTrackingCard (Apple)
//
//  The P1/S8 state holder for the personal "Uptime & SLO" surface. The view binds
//  through `SLOTrackingModel`; no networking lives in the view. SwiftUI parity of
//  features/system/components/status/SLOTrackingCard.tsx.
//
//  The web card keys ONE interval-refetched read on the selected window
//  (`useQuery(['status-uptime', win], … , refetchInterval: 60_000)`); changing the
//  window re-runs the query. The model owns the selected window + the editable
//  personal target (web `localStorage`, persisted through `SLOTargetStore`), and
//  drives the silent error-retry + one-shot stale auto-refresh — matching the web's
//  auto-refetch (there is no manual refresh button in the web card). The seams it
//  binds through (telemetry, i18n facade, target store, source) live in `.Seams`.
//

import Foundation
import Observation

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `SLOTrackingSource`,
/// projects each snapshot into the figure + render `SLOPhase`, owns the selected
/// window + the editable personal target (persisted through `SLOTargetStore`),
/// drives the error-state retry and the one-shot stale auto-refresh, and emits the
/// `view.opened` diagnostics event once on first appearance. `@Observable` for
/// fine-grained SwiftUI tracking.
@MainActor
@Observable
public final class SLOTrackingModel {
    public private(set) var phase: SLOPhase = .loading
    public private(set) var connection: SLOConnection = .live
    /// The active window's uptime figure, or `nil` when there is none yet.
    public private(set) var snapshot: UptimeWindowDTO?
    public private(set) var selectedWindow: SLOWindow
    /// The personal target percentage (web `target`), drives the figure tone.
    public private(set) var target: Double
    public private(set) var updatedAt: Date?
    /// Whether the inline target editor is open (web `editing`).
    public var isEditingTarget = false
    /// The in-progress target edit text (web `draftTarget`), bound to the field.
    public var draftTarget: String

    @ObservationIgnored private let source: any SLOTrackingSource
    @ObservationIgnored private let telemetry: any SLOTrackingTelemetry
    @ObservationIgnored private let targetStore: any SLOTargetStore
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SLOTrackingSource,
        telemetry: any SLOTrackingTelemetry = OSLogSLOTrackingTelemetry(),
        targetStore: any SLOTargetStore = InMemorySLOTargetStore(),
        initialWindow: SLOWindow = .d30,
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.targetStore = targetStore
        self.locale = locale
        selectedWindow = initialWindow
        let resolved = SLOTrackingProjection.loadTarget(targetStore.load())
        target = resolved
        draftTarget = SLOTrackingFormat.targetToken(resolved)
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived display values

    /// The big figure string (web `pct == null ? '—' : fmtPercent(pct, 2)`).
    public var percentText: String {
        SLOTrackingFormat.percent(snapshot?.uptimePercent, locale: locale)
    }

    /// The figure tone vs the personal target (web `tone`).
    public var tone: SLOTone {
        SLOTrackingProjection.tone(percent: snapshot?.uptimePercent, target: target)
    }

    /// The "Target …%" token rendered in the header (web `{target}`).
    public var targetToken: String {
        SLOTrackingFormat.targetToken(target)
    }

    /// The selected window's long label (web `WINDOW_LABEL[win]`).
    public var windowLabel: String {
        SLOTrackingStrings.string(selectedWindow.longLabelKey, selectedWindow.longLabelKey)
    }

    /// The "X / Y components healthy" subtitle clause (web component tally).
    public var componentsClause: String {
        SLOTrackingAccessibility.componentsClause(
            healthy: snapshot?.healthyCount,
            total: snapshot?.totalCount,
            localize: SLOTrackingStrings.string
        )
    }

    /// Whether the snapshot caveat should show (web non-`series` guard).
    public var showsCaveat: Bool {
        SLOTrackingProjection.showsCaveat(snapshot)
    }

    /// The caveat copy — the source note when present, else the default caveat
    /// (web `data.note ?? '…requires the heartbeat history backend…'`).
    public var caveatText: String {
        if let note = snapshot?.note, !note.isEmpty { return note }
        return SLOTrackingStrings.string(
            "Snapshot Caveat",
            """
            Per-window historical uptime requires the heartbeat history backend \
            (planned). This figure reflects the current snapshot.
            """
        )
    }

    /// Whether there is a figure to announce (drives the a11y summary branch).
    public var hasFigure: Bool {
        snapshot != nil
    }

    /// The VoiceOver summary for the live figure region (web `aria-live`).
    public var figureSummary: String {
        SLOTrackingAccessibility.figureSummary(
            percentText: percentText,
            windowLabel: windowLabel,
            componentsClause: componentsClause,
            hasFigure: hasFigure,
            localize: SLOTrackingStrings.string
        )
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SLOTrackingSurface.slug)
        source.start()
    }

    /// Stops observing the upstream read.
    public func stop() {
        started = false
        source.stop()
    }

    /// The error-state retry (web `QueryError` refetch): a silent re-fetch — the
    /// bound source pushes a fresh snapshot via `onUpdate`.
    public func retry() {
        source.refresh()
    }

    // MARK: Window selection (web `setWin`)

    /// Switches the active window (web `onClick={() => setWin(w)}`). No-op when the
    /// window is unchanged; otherwise shows the loading envelope and re-keys the
    /// bound read so a fresh figure arrives via `onUpdate`.
    public func selectWindow(_ window: SLOWindow) {
        guard window != selectedWindow else { return }
        selectedWindow = window
        phase = .loading
        source.select(window: window)
    }

    // MARK: Target editing (web `editing` / `handleSaveTarget`)

    /// Opens the inline target editor, seeding the draft with the current target
    /// (web `setEditing(true)`; the input shows `String(target)`).
    public func beginEditingTarget() {
        draftTarget = SLOTrackingFormat.targetToken(target)
        isEditingTarget = true
    }

    /// Commits the edited target (web `handleSaveTarget`): a valid `0 < n ≤ 100`
    /// is adopted + persisted; an invalid draft is rejected and the field reverts.
    /// Either way the editor closes.
    public func saveTarget() {
        if let parsed = SLOTrackingProjection.parseTarget(draftTarget) {
            target = parsed
            targetStore.save(parsed)
        }
        draftTarget = SLOTrackingFormat.targetToken(target)
        isEditingTarget = false
    }

    /// Discards the edit and closes the editor (web Cancel: `setEditing(false)` +
    /// `setDraftTarget(String(target))`).
    public func cancelEditingTarget() {
        draftTarget = SLOTrackingFormat.targetToken(target)
        isEditingTarget = false
    }

    // MARK: Snapshot application

    private func apply(_ update: SLOTrackingUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        snapshot = update.snapshot
        phase = SLOTrackingProjection.resolvePhase(update.status, hasSnapshot: update.snapshot != nil)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps
    /// the cached figure on screen and does not refetch. The auto-refresh is silent
    /// — the web has no toast on this surface.
    private func handleAutoRefresh(for connection: SLOConnection) {
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

// MARK: - Surface identity

public extension SLOTrackingCard {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        SLOTrackingSurface.slug
    }
}
