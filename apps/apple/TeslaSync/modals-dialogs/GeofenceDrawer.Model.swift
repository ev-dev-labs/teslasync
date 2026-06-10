//
//  GeofenceDrawer.Model.swift
//  TeslaSync — P4 modal/dialog · 0011 · GeofenceDrawer (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `GeofenceDrawer` is a passive
//  leaflet-draw controller: it reads the parent map + persisted `fences`, wires the draw / edit /
//  delete events, and calls `onCreate` / `onEdit` / `onDelete`. The native surface reproduces that
//  whole lifecycle here — a `GeofenceDrawerSource` pushes the resolved fences + allowed modes + map
//  focus + freshness, and the model owns the resolved `GeofenceDrawerPhase`, the renderable overlays
//  + describe rows, the interactive `GeofenceDraft`, and the create / edit / delete command seams.
//  No persistence access and no geofence mutation live in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `GeofenceDrawerSource`, holds the latest
/// fences + freshness, owns the interactive draw draft, exposes the resolved render phase + the
/// renderable overlays + describe rows, drives the create / edit / delete command seams, and emits
/// the P1/S11 `view.opened` event once on first appearance.
@MainActor
@Observable
public final class GeofenceDrawerModel {
    // Load + freshness (from the source)
    public private(set) var phase: GeofenceDrawerPhase = .loading
    public private(set) var connection: GeofenceDrawerConnection = .live
    public private(set) var fences: [GeofenceItem] = []
    public private(set) var renderables: [GeofenceRenderable] = []
    public private(set) var rows: [GeofenceRow] = []
    public private(set) var modes: [GeofenceDrawerMode] = GeofenceDrawerMode.defaultModes
    public private(set) var center: GeofencePoint?
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    /// The query failure message kept while a cached snapshot remains on screen, so the live surface
    /// can show the inline error above the map (web reload-failure-with-cached-data).
    public private(set) var loadFailure: String?

    // Interactive draw state
    public private(set) var draft: GeofenceDraft = .start(mode: .circle)
    public private(set) var editingFenceID: String?
    public private(set) var focusedFenceID: String?

    @ObservationIgnored private let source: any GeofenceDrawerSource
    @ObservationIgnored private let telemetry: any GeofenceDrawerTelemetry
    @ObservationIgnored private let controller: any GeofenceDrawerController
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any GeofenceDrawerSource,
        telemetry: any GeofenceDrawerTelemetry = OSLogGeofenceDrawerTelemetry(),
        controller: any GeofenceDrawerController = OSLogGeofenceDrawerController(),
        localize: @escaping (String, String) -> String = GeofenceDrawerStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.controller = controller
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived

    /// Whether an edit is in progress (the toolbar Add becomes "Save").
    public var isEditing: Bool {
        editingFenceID != nil
    }

    /// Whether the active draft can be committed (web create/edit enablement).
    public var canCommitDraft: Bool {
        draft.canCommit
    }

    /// The step-by-step hint guiding the active draw.
    public var draftHint: String {
        GeofenceDrawerAccessibility.draftHint(draft, localize: localize)
    }

    /// The inline reload error shown above the live surface (web cached-data-with-failure), present
    /// only while a cached snapshot is on screen despite a failed reload.
    public var inlineErrorMessage: String? {
        switch phase {
        case .content, .empty: loadFailure
        case .loading, .error: nil
        }
    }

    /// The VoiceOver summary for the dialog.
    public var accessibilitySummary: String {
        GeofenceDrawerAccessibility.summary(localize: localize)
    }

    /// One draw-mode control's VoiceOver label (name + selected status).
    public func modeAccessibilityLabel(for mode: GeofenceDrawerMode) -> String {
        GeofenceDrawerAccessibility.modeLabel(mode, selected: mode == draft.mode, localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: GeofenceDrawerSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-resolves the fences + freshness (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Draw commands (web leaflet-draw create / edit)

    /// Selects a draw mode, ending any edit and starting a fresh shape (web toolbar mode switch).
    public func selectMode(_ mode: GeofenceDrawerMode) {
        editingFenceID = nil
        draft = draft.settingMode(mode)
    }

    /// Adds a tapped map coordinate to the active draft (web draw click).
    public func addPoint(_ point: GeofencePoint) {
        guard point.isValid else { return }
        draft = draft.adding(point)
    }

    /// Sets the circle radius in meters (the slider; web circle drag radius).
    public func setRadius(_ radius: Double) {
        draft = draft.settingRadius(radius)
    }

    /// Removes the most recent point (toolbar Undo).
    public func undoPoint() {
        draft = draft.removingLast()
    }

    /// Clears the active draft + ends any edit (toolbar Cancel).
    public func clearDraft() {
        editingFenceID = nil
        draft = draft.cleared()
    }

    /// Loads an existing fence into the draft for editing (web edit handler).
    public func beginEdit(id: String) {
        guard let item = fences.first(where: { $0.id == id }), let loaded = Self.draft(from: item) else { return }
        editingFenceID = id
        focusedFenceID = id
        draft = loaded
    }

    /// Focuses a fence so the map can center on it (the list → map link).
    public func focusFence(id: String) {
        focusedFenceID = id
    }

    /// Commits the active draft: edits when a fence is loaded (web `onEdit`), else creates (web
    /// `onCreate`). No-op when the draft can't yet commit; clears the draft afterwards.
    public func commitDraft() {
        guard let geometry = draft.geometry() else { return }
        if let id = editingFenceID {
            controller.edit(id: id, geofence: geometry)
        } else {
            controller.create(geometry)
        }
        editingFenceID = nil
        draft = draft.cleared()
    }

    /// Deletes a persisted fence (web on-map trash → `onDelete`).
    public func deleteFence(id: String) {
        controller.delete(id: id)
        if editingFenceID == id { clearDraft() }
        if focusedFenceID == id { focusedFenceID = nil }
    }

    // MARK: Snapshot application

    private func apply(_ update: GeofenceDrawerUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        center = update.center
        modes = GeofenceDrawerProjection.modes(from: update.modes)
        let resolvedFences = update.fences ?? []
        fences = resolvedFences
        renderables = GeofenceDrawerProjection.renderables(from: resolvedFences)
        rows = GeofenceDrawerProjection.rows(from: resolvedFences, localize: localize)
        loadFailure = Self.failureMessage(update.status)
        phase = GeofenceDrawerProjection.resolvePhase(status: update.status, fences: update.fences)
        reconcileDraftMode()
        handleAutoRefresh(for: update.connection)
    }

    /// Keeps the draft mode within the allowed set when not editing (a removed mode falls back to
    /// the first allowed one); never clobbers an in-progress edit.
    private func reconcileDraftMode() {
        guard editingFenceID == nil, !modes.contains(draft.mode) else { return }
        draft = GeofenceDraft.start(mode: modes.first ?? .circle)
    }

    /// Builds a draft from an existing fence (circle → center + radius; ring → polygon vertices).
    private static func draft(from item: GeofenceItem) -> GeofenceDraft? {
        switch GeofenceGeometry.renderKind(for: item) {
        case let .circle(center, radius):
            GeofenceDraft(mode: .circle, points: [center], radiusMeters: radius)
        case let .polygon(ring):
            GeofenceDraft(mode: .polygon, points: ring)
        case .none:
            nil
        }
    }

    /// The failure message carried by a failed status, else `nil`.
    private static func failureMessage(_ status: GeofenceDrawerLoadStatus) -> String? {
        if case let .failed(message) = status { return message }
        return nil
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached snapshot and does not
    /// refetch.
    private func handleAutoRefresh(for connection: GeofenceDrawerConnection) {
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
