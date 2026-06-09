//
//  PresetGallery.Model.swift
//  TeslaSync — P4 feature view · 0085 · AutomationPresetGallery (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `PresetGallery` owns the
//  list query (`useAutomationPresets(category)`) plus the navigate-on-install action
//  (`useNavigate`). The native surface reproduces that lifecycle here: a
//  `AutomationPresetGallerySource` pushes the resolved items + load / freshness status, and the
//  model exposes the resolved `AutomationPresetGalleryPhase` for SwiftUI to switch over, drives the
//  install seam, and emits the P1/S11 `view.opened` event once on first appearance. No
//  networking lives in the view.
//

import Foundation
import Observation
import SwiftUI

/// The surface's observable view-model. Subscribes to a `AutomationPresetGallerySource`, holds the
/// latest items + freshness, exposes the resolved render phase, drives the install seam,
/// and emits the P1/S11 `view.opened` event once on first appearance.
@MainActor
@Observable
public final class AutomationPresetGalleryModel {
    // Load + freshness (from the source)
    public private(set) var phase: AutomationPresetGalleryPhase = .loading
    public private(set) var connection: AutomationPresetGalleryConnection = .live
    public private(set) var items: [AutomationPresetItem] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    /// The list-query failure message kept while cached items remain on screen, so the
    /// content branch can surface the web-equivalent inline error above the grid.
    public private(set) var loadFailure: String?

    @ObservationIgnored private let source: any AutomationPresetGallerySource
    @ObservationIgnored private let telemetry: any AutomationPresetGalleryTelemetry
    @ObservationIgnored private let navigator: any AutomationPresetGalleryNavigator
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any AutomationPresetGallerySource,
        telemetry: any AutomationPresetGalleryTelemetry = OSLogAutomationPresetGalleryTelemetry(),
        navigator: any AutomationPresetGalleryNavigator = OSLogAutomationPresetGalleryNavigator(),
        localize: @escaping (String, String) -> String = AutomationPresetGalleryStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.navigator = navigator
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (inline error, a11y, card copy)

    /// The inline list-error message shown above the populated grid, present only when
    /// items are on screen despite a failed reload (web cached-data refresh failure).
    public var inlineErrorMessage: String? {
        guard case .content = phase else { return nil }
        return loadFailure
    }

    /// The VoiceOver summary for the gallery.
    public var accessibilitySummary: String {
        AutomationPresetGalleryAccessibility.gallerySummary(count: items.count, localize: localize)
    }

    /// The localized trigger subtitle for a card (web `triggerLabel`).
    public func triggerLabel(for item: AutomationPresetItem) -> String {
        AutomationPresetGalleryProjection.triggerLabel(for: item.firstTriggerKind, localize: localize)
    }

    /// The localized action-count badge for a card (web `actionCount`).
    public func actionCountLabel(for item: AutomationPresetItem) -> String {
        AutomationPresetGalleryProjection.actionCountLabel(count: item.actionCount, localize: localize)
    }

    /// The VoiceOver label for a card.
    public func accessibilityLabel(for item: AutomationPresetItem) -> String {
        AutomationPresetGalleryAccessibility.cardLabel(item, localize: localize)
    }

    /// The VoiceOver label for a card's Install button (web button + the preset name).
    public func installAccessibilityLabel(for item: AutomationPresetItem) -> String {
        AutomationPresetGalleryProjection.installLabel(name: item.name, localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AutomationPresetGallerySurface.slug)
        source.start()
    }

    /// Stops observing the upstream presets feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Install (web `navigate('/automations/new?preset={id}')`)

    /// Opens the builder seeded with the preset (web Install button → `useNavigate`).
    public func install(_ item: AutomationPresetItem) {
        navigator.installPreset(id: item.id)
    }

    // MARK: Snapshot application

    private func apply(_ update: AutomationPresetGalleryUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        items = update.items
        loadFailure = Self.failureMessage(update.status)
        phase = AutomationPresetGalleryProjection.resolvePhase(status: update.status, itemCount: items.count)
        handleAutoRefresh(for: update.connection)
    }

    /// The failure message carried by a failed status, else `nil`.
    private static func failureMessage(_ status: AutomationPresetGalleryLoadStatus) -> String? {
        if case let .failed(message) = status { return message }
        return nil
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// items on screen and does not refetch.
    private func handleAutoRefresh(for connection: AutomationPresetGalleryConnection) {
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

// MARK: - Localization Text helper

public extension AutomationPresetGalleryStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values
    /// are never re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
