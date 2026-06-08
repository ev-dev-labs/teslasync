//
//  NotificationSettings.Model.swift
//  TeslaSync — P4 feature view · 0208 · NotificationSettings (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for the settings
//  "Notifications" feature view. The view binds through `NotificationSettingsModel`; no networking lives in
//  the view. SwiftUI parity of features/settings/components/NotificationSettings.tsx.
//
//  The web component composes six reads/writes — `useWebPush` (permission + request), `useNotificationListener`
//  (event prefs), `useSettings` + `useSaveSettings` (tab signals), and `useNotificationSoundPrefs`
//  (master / per-channel / volume / test). The native surface folds all of that behind a
//  `NotificationSettingsSource` so every prompt-required state (loading / empty / error / stale / offline /
//  content) renders here and every mutation is a single delegated call.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol NotificationSettingsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogNotificationSettingsTelemetry: NotificationSettingsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no hardcoded
/// literals. Keys live in the "NotificationSettings" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; the per-surface table keeps each parallel surface prompt self-contained.
public enum NotificationSettingsStrings {
    public static let table = "NotificationSettings"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// SwiftUI `Text` from the catalog (the view holds no English literals).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolves a string and substitutes the `{{name}}` token (web `t(key, default, { name })`).
    public static func string(_ key: String, _ fallback: String, name: String) -> String {
        string(key, fallback).replacingOccurrences(of: "{{name}}", with: name)
    }

    /// Resolves the projector's injected, pre-localized copy: the seven channel labels and the `Test …`
    /// VoiceOver template (the labels the web reads via `t()`).
    public static func copy() -> NotificationSettingsCopy {
        let labels = Dictionary(
            uniqueKeysWithValues: NotificationSoundCategory.allCases.map { category in
                (category, string("notificationSounds.category.\(category.rawValue)", category.defaultLabel))
            }
        )
        return NotificationSettingsCopy(
            categoryLabels: labels,
            testAccessibilityTemplate: string("notificationSounds.testAria", "Test {{name}} sound")
        )
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `NotificationSettingsSource`: the load status, the read input, the
/// live-state connection, the in-flight flag, and the last-update timestamp.
public struct NotificationSettingsUpdate: Sendable, Equatable {
    public var status: NotificationSettingsLoadStatus
    public var input: NotificationSettingsInput?
    public var connection: NotificationSettingsConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: NotificationSettingsLoadStatus = .loading,
        input: NotificationSettingsInput? = nil,
        connection: NotificationSettingsConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.input = input
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared P1/S8 state holders
/// — composing the OS authorization (web `useWebPush`), the event-pref store (web `useNotificationListener`),
/// the settings query + save mutation (web `useSettings` / `useSaveSettings`), and the sound-pref store +
/// player (web `useNotificationSoundPrefs` / `playNotificationSound`). Previews + tests use
/// `InMemoryNotificationSettingsSource`. The view never talks to the network directly.
@MainActor
public protocol NotificationSettingsSource: AnyObject {
    var onUpdate: (@MainActor (NotificationSettingsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying settings read (web parent refetch / the stale auto-refresh).
    func refresh()

    /// Web `requestPermission()` — prompts for OS notification authorization.
    func requestAuthorization()
    /// Web `setPushPrefs(prev => ({ ...prev, alerts }))`.
    func setEventAlerts(_ enabled: Bool)
    /// Web `setPushPrefs(prev => ({ ...prev, exportStatus }))`.
    func setEventExportCompletions(_ enabled: Bool)
    /// Web `updateTabSetting('tab_badge_enabled', value)`.
    func setTabBadge(_ enabled: Bool)
    /// Web `updateTabSetting('critical_flash_enabled', value)`.
    func setTabCriticalFlash(_ enabled: Bool)
    /// Web `handleMasterToggle(next)`.
    func setSoundsEnabled(_ enabled: Bool)
    /// Web `setNotificationSoundPrefs({ perCategory: { [category]: checked } })`.
    func setSoundChannel(_ category: NotificationSoundCategory, _ enabled: Bool)
    /// Web `setNotificationSoundPrefs({ volume })` — `volume` is the `[0, 1]` unit value.
    func setVolume(_ unit: Double)
    /// Web `handleTestSound(category)`.
    func testSound(_ category: NotificationSoundCategory)
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `NotificationSettingsSource`, projects each
/// snapshot into the render-ready projection, exposes a `NotificationSettingsPhase` + freshness for SwiftUI
/// to switch over, forwards every mutation to the source, and emits the `view.opened` diagnostics event once
/// on first appearance.
@MainActor
@Observable
public final class NotificationSettingsModel {
    public private(set) var phase: NotificationSettingsPhase = .loading
    public private(set) var connection: NotificationSettingsConnection = .live
    public private(set) var projection: NotificationSettingsProjection = .empty
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any NotificationSettingsSource
    @ObservationIgnored private let telemetry: any NotificationSettingsTelemetry
    @ObservationIgnored private let copy: NotificationSettingsCopy
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any NotificationSettingsSource,
        telemetry: any NotificationSettingsTelemetry = OSLogNotificationSettingsTelemetry(),
        copy: NotificationSettingsCopy = NotificationSettingsStrings.copy()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.copy = copy
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The combined VoiceOver summary for the whole surface.
    public var accessibilitySummary: String {
        NotificationSettingsAccessibility.sectionSummary(for: projection, localize: NotificationSettingsStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: NotificationSettingsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream reads.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the settings read (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Mutations (each forwards to the source; the source re-emits the new snapshot)

    public func requestAuthorization() {
        source.requestAuthorization()
    }

    public func setAlerts(_ enabled: Bool) {
        source.setEventAlerts(enabled)
    }

    public func setExportCompletions(_ enabled: Bool) {
        source.setEventExportCompletions(enabled)
    }

    public func setTabBadge(_ enabled: Bool) {
        source.setTabBadge(enabled)
    }

    public func setTabCriticalFlash(_ enabled: Bool) {
        source.setTabCriticalFlash(enabled)
    }

    public func setSoundsEnabled(_ enabled: Bool) {
        source.setSoundsEnabled(enabled)
    }

    public func setSoundChannel(_ category: NotificationSoundCategory, _ enabled: Bool) {
        source.setSoundChannel(category, enabled)
    }

    public func setVolume(_ unit: Double) {
        source.setVolume(unit)
    }

    public func testSound(_ category: NotificationSoundCategory) {
        source.testSound(category)
    }

    private func apply(_ update: NotificationSettingsUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        if let input = update.input {
            projection = NotificationSettingsProjector.project(input: input, copy: copy)
        } else {
            projection = .empty
        }
        phase = NotificationSettingsProjector.resolvePhase(update.status, hasContent: projection.hasContent)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline keeps the cached values on screen and does not
    /// refetch.
    private func handleAutoRefresh(for connection: NotificationSettingsConnection) {
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

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Holds a mutable input + status/connection, applies every
/// mutation locally (so toggles flip in previews and tests), and records the authorization requests + tested
/// channels so the wiring can be asserted. Emits the current snapshot on `start()` and after each mutation.
@MainActor
public final class InMemoryNotificationSettingsSource: NotificationSettingsSource {
    public var onUpdate: (@MainActor (NotificationSettingsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var authorizationRequests = 0
    public private(set) var testedChannels: [NotificationSoundCategory] = []

    private var status: NotificationSettingsLoadStatus
    /// Optional so the source can model a resolved-but-empty read (`status == .loaded`, `input == nil`),
    /// which drives the empty envelope — every present input renders the panel (the channel list is always
    /// non-empty).
    private var input: NotificationSettingsInput?
    private var connection: NotificationSettingsConnection
    private var updatedAt: Date?

    public init(
        status: NotificationSettingsLoadStatus = .loaded,
        input: NotificationSettingsInput? = NotificationSettingsInput(),
        connection: NotificationSettingsConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.input = input
        self.connection = connection
        self.updatedAt = updatedAt
    }

    public func start() {
        startCount += 1
        emit()
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func requestAuthorization() {
        authorizationRequests += 1
        // Emulate the user allowing the OS prompt (web `requestPermission()` resolving to `'granted'`).
        if input?.authorization == .notDetermined {
            input?.authorization = .granted
        }
        emit()
    }

    public func setEventAlerts(_ enabled: Bool) {
        input?.eventPrefs.alerts = enabled
        emit()
    }

    public func setEventExportCompletions(_ enabled: Bool) {
        input?.eventPrefs.exportCompletions = enabled
        emit()
    }

    public func setTabBadge(_ enabled: Bool) {
        guard input?.tabSettings != nil else { return } // web `!settings` no-op guard
        input?.tabSettings?.badgeEnabled = enabled
        emit()
    }

    public func setTabCriticalFlash(_ enabled: Bool) {
        guard input?.tabSettings != nil else { return }
        input?.tabSettings?.criticalFlashEnabled = enabled
        emit()
    }

    public func setSoundsEnabled(_ enabled: Bool) {
        input?.soundPrefs.enabled = enabled
        emit()
    }

    public func setSoundChannel(_ category: NotificationSoundCategory, _ enabled: Bool) {
        input?.soundPrefs.perCategory[category] = enabled
        emit()
    }

    public func setVolume(_ unit: Double) {
        input?.soundPrefs.volume = NotificationVolumeMath.clampUnit(unit)
        emit()
    }

    public func testSound(_ category: NotificationSoundCategory) {
        testedChannels.append(category)
    }

    /// Pushes an externally-built snapshot (the freshness / load-state test affordance).
    public func push(_ update: NotificationSettingsUpdate) {
        status = update.status
        input = update.input
        connection = update.connection
        updatedAt = update.updatedAt
        onUpdate?(update)
    }

    private func emit() {
        onUpdate?(
            NotificationSettingsUpdate(
                status: status,
                input: input,
                connection: connection,
                refreshing: false,
                updatedAt: updatedAt
            )
        )
    }
}

// MARK: - Surface identity

public extension NotificationSettings {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        NotificationSettingsSurface.slug
    }
}
