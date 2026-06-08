//
//  AdvancedSettings.Model.swift
//  TeslaSync — P4 feature view · 0198 · AdvancedSettings (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for the
//  "Restore confirmation prompts" panel. The view binds through `AdvancedSettingsModel`; no
//  persistence I/O lives in the view. SwiftUI parity of
//  features/settings/components/AdvancedSettings.tsx.
//
//  The web component reads `listSilenced()` synchronously each render and bumps a `tick` after every
//  `unsilence` / `clearAllSilenced` so the panel re-reads `localStorage`. The native model owns that
//  lifecycle: it binds an `AdvancedSettingsStore` (the `UserDefaults`-backed parity of the web
//  `localStorage`), projects each snapshot into restore rows, resolves the render phase + freshness,
//  applies the restore / restore-all mutations, and emits `view.opened` once on first appearance.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), which is consent-gated and redacted there.
public protocol AdvancedSettingsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogAdvancedSettingsTelemetry: AdvancedSettingsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web t(key, default)

/// Resolves the surface's strings by key with the web English fallback, so the view holds no hardcoded
/// literals. Keys live in the "AdvancedSettings" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; the per-surface table keeps each parallel surface prompt
/// self-contained.
public enum AdvancedSettingsStrings {
    public static let table = "AdvancedSettings"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// SwiftUI `Text` from the catalog (the view holds no English literals).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolves the projector's injected, pre-localized copy from the catalog (web `useSilenceKeyLabel`).
    public static func copy() -> AdvancedSettingsCopy {
        AdvancedSettingsCopy(
            discardDraftLabel: string("advanced.restoreConfirms.keys.discardDraft", "Discard unsaved draft"),
            unsavedNavigationLabel: string(
                "advanced.restoreConfirms.keys.unsavedNavigation",
                "Leave page with unsaved changes"
            ),
            promptRole: string("advanced.restoreConfirms.promptRole", "Silenced prompt")
        )
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by an `AdvancedSettingsStore`: the persisted silence ids + their load
/// status, the live-state connection, and the last-read timestamp.
public struct AdvancedSettingsUpdate: Sendable, Equatable {
    public var status: AdvancedSettingsLoadStatus
    public var keys: [String]
    public var connection: AdvancedSettingsConnection
    public var updatedAt: Date?

    public init(
        status: AdvancedSettingsLoadStatus = .loading,
        keys: [String] = [],
        connection: AdvancedSettingsConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.keys = keys
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the persisted confirm-
/// silence store (the `UserDefaults` parity of the web `localStorage`); previews + tests use
/// `InMemoryConfirmSilenceStore`. The view never touches persistence directly.
@MainActor
public protocol AdvancedSettingsStore: AnyObject {
    var onUpdate: (@MainActor (AdvancedSettingsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-enable a single silenced prompt (web `unsilence(key)`), then re-emit the new set.
    func restore(_ key: String)
    /// Re-enable every silenced prompt (web `clearAllSilenced()`), then re-emit the empty set.
    func restoreAll()
    /// Re-read the persisted set (the error-state retry / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Binds an `AdvancedSettingsStore`, projects each snapshot into
/// restore rows, resolves a render `AdvancedSettingsPhase` + freshness, applies the restore /
/// restore-all mutations (web `handleRestore` / `handleRestoreAll`), and emits the `view.opened`
/// diagnostics event once on first appearance.
@MainActor
@Observable
public final class AdvancedSettingsModel {
    public private(set) var phase: AdvancedSettingsPhase = .loading
    public private(set) var connection: AdvancedSettingsConnection = .live
    public private(set) var projection: AdvancedSettingsProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let store: any AdvancedSettingsStore
    @ObservationIgnored private let telemetry: any AdvancedSettingsTelemetry
    @ObservationIgnored private let copy: AdvancedSettingsCopy
    @ObservationIgnored private var latestStatus: AdvancedSettingsLoadStatus = .loading
    @ObservationIgnored private var latestKeys: [String] = []
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        store: any AdvancedSettingsStore,
        telemetry: any AdvancedSettingsTelemetry = OSLogAdvancedSettingsTelemetry(),
        copy: AdvancedSettingsCopy = AdvancedSettingsStrings.copy()
    ) {
        self.store = store
        self.telemetry = telemetry
        self.copy = copy
        store.onUpdate = { [weak self] update in self?.apply(update) }
        recompute()
    }

    /// Whether there is at least one silenced prompt (web `silenced.length > 0`) — gates the header's
    /// "Restore all" action.
    public var hasSilencedPrompts: Bool {
        projection.hasRows
    }

    /// The spoken status of the restore list for the current phase.
    public var listAccessibilitySummary: String {
        AdvancedSettingsAccessibility.summary(
            for: phase,
            count: projection.rows.count,
            localize: AdvancedSettingsStrings.string
        )
    }

    /// The VoiceOver label for a row's restore button, naming the prompt it re-enables.
    public func restoreAccessibilityLabel(for row: SilencedPromptRow) -> String {
        AdvancedSettingsAccessibility.restoreLabel(for: row.label, localize: AdvancedSettingsStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AdvancedSettingsSurface.slug)
        store.start()
    }

    /// Stops observing the bound store.
    public func stop() {
        started = false
        store.stop()
    }

    /// Re-enables a single silenced prompt (web `handleRestore(key)` → `unsilence` + re-read).
    public func restore(_ row: SilencedPromptRow) {
        store.restore(row.id)
    }

    /// Re-enables every silenced prompt (web `handleRestoreAll` → `clearAllSilenced` + re-read).
    public func restoreAll() {
        store.restoreAll()
    }

    /// Re-reads the persisted set — the error-state retry action.
    public func refresh() {
        store.refresh()
    }

    private func apply(_ update: AdvancedSettingsUpdate) {
        latestStatus = update.status
        latestKeys = update.keys
        connection = update.connection
        updatedAt = update.updatedAt
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    private func recompute() {
        projection = AdvancedSettingsProjector.project(keys: latestKeys, copy: copy)
        phase = AdvancedSettingsProjector.resolvePhase(latestStatus, hasRows: projection.hasRows)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached rows and does not
    /// refetch (prompt "cached value + offline chip").
    private func handleAutoRefresh(for connection: AdvancedSettingsConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            store.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

// MARK: - UserDefaults store (web localStorage `teslasync:confirm-silence:v1`)

/// The persisted confirm-silence store — the `UserDefaults` parity of the web `confirmSilence.ts`
/// `localStorage` helpers. JSON-encoded under the exact web `STORAGE_KEY` so the on-disk payload is
/// identical, and (like the web `load()`) a missing or corrupt payload reads as an empty set rather
/// than surfacing an error. `UserDefaults` is thread-safe but not `Sendable`, so the `@unchecked` is
/// sound; the type is `@MainActor` to satisfy the seam.
@MainActor
public final class UserDefaultsConfirmSilenceStore: AdvancedSettingsStore {
    public var onUpdate: (@MainActor (AdvancedSettingsUpdate) -> Void)?

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func restore(_ key: String) {
        guard !key.isEmpty else { return }
        var keys = load()
        keys.removeAll { $0 == key }
        save(keys)
        emit()
    }

    public func restoreAll() {
        defaults.removeObject(forKey: AdvancedSettingsConfig.storageKey)
        emit()
    }

    public func refresh() {
        emit()
    }

    /// Reads the persisted ids, de-duped + sorted (web `listSilenced()`); a missing or non-array
    /// payload reads as empty, matching the web `load()` defensive `catch`.
    private func load() -> [String] {
        guard let raw = defaults.string(forKey: AdvancedSettingsConfig.storageKey),
              let data = raw.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data),
              let array = parsed as? [Any]
        else {
            return []
        }
        let strings = array.compactMap { $0 as? String }
        return Array(Set(strings)).sorted()
    }

    private func save(_ keys: [String]) {
        guard let data = try? JSONSerialization.data(withJSONObject: keys.sorted()),
              let raw = String(data: data, encoding: .utf8)
        else {
            return
        }
        defaults.set(raw, forKey: AdvancedSettingsConfig.storageKey)
    }

    private func emit() {
        onUpdate?(
            AdvancedSettingsUpdate(status: .loaded, keys: load(), connection: .live, updatedAt: Date())
        )
    }
}

// MARK: - In-memory store (previews + tests)

/// In-memory store for previews + unit tests. Holds the silenced ids, the configured load status (so a
/// `.loading` or `.failed` store reproduces those states), and the freshness, re-emitting after each
/// mutation. A test can also push an arbitrary snapshot via `push(_:)`.
@MainActor
public final class InMemoryConfirmSilenceStore: AdvancedSettingsStore {
    public var onUpdate: (@MainActor (AdvancedSettingsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var restoreAllCount = 0
    public private(set) var restoredKeys: [String] = []

    private var keys: [String]
    private let status: AdvancedSettingsLoadStatus
    private let connection: AdvancedSettingsConnection

    public init(
        keys: [String] = [],
        status: AdvancedSettingsLoadStatus = .loaded,
        connection: AdvancedSettingsConnection = .live
    ) {
        self.keys = keys
        self.status = status
        self.connection = connection
    }

    public func start() {
        startCount += 1
        emit()
    }

    public func stop() {
        stopCount += 1
    }

    public func restore(_ key: String) {
        restoredKeys.append(key)
        keys.removeAll { $0 == key }
        emit()
    }

    public func restoreAll() {
        restoreAllCount += 1
        keys.removeAll()
        emit()
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance for stale / offline transitions).
    public func push(_ update: AdvancedSettingsUpdate) {
        onUpdate?(update)
    }

    private func emit() {
        onUpdate?(
            AdvancedSettingsUpdate(status: status, keys: keys, connection: connection, updatedAt: Date())
        )
    }
}

// MARK: - Surface identity

public extension AdvancedSettings {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        AdvancedSettingsSurface.slug
    }
}
