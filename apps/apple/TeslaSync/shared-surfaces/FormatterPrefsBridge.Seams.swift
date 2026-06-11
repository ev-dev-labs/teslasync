//
//  FormatterPrefsBridge.Seams.swift
//  TeslaSync — P4 shared surface · 0146 · FormatterPrefsBridge (Apple)
//
//  The dependency seams the bridge view-model binds through, kept apart from the model for the lint
//  length budget:
//    • the P1/S8 settings source (the native parity of `useSettingsQuery` — the `['settings']` query),
//    • the formatter-globals applier (the native parity of `setGlobalLocale` / `setGlobalPrecision` +
//      `getGlobalLocale` / `getGlobalPrecision`), and
//    • the settings-changed broadcast (the native parity of `subscribe(TOPICS.SETTINGS_CHANGED)` →
//      `qc.invalidateQueries(['settings'])`).
//  Each has its production implementation plus an in-memory / recording / manual double for previews
//  and tests. No HTTP lives in the view: the host pushes settings / connectivity changes through the
//  source, exactly like the web hooks own the query.
//

import Foundation
import os

// MARK: - Source protocol (P1/S8 seam — the settings query)

/// The seam the view binds through for the settings payload + its fetch lifecycle + connectivity — the
/// native parity of the web `useSettingsQuery`. The production app implements this over the shared
/// P1/S8 settings state holder (`LiveFormatterPrefsBridgeSource`); previews and tests use
/// `InMemoryFormatterPrefsBridgeSource`. `refresh()` is the native parity of the web
/// `qc.invalidateQueries(['settings'])` re-request.
@MainActor
public protocol FormatterPrefsBridgeSource: AnyObject {
    var onUpdate: (@MainActor (FormatterPrefsBridgeInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - Live source (production — the controlled settings feed)

/// The production source. Owns the settings payload plus the fetch lifecycle + connectivity and
/// re-emits the coalesced snapshot on every change. The host feeds settings updates via `update`
/// (the web parent re-render after `useSettingsQuery` resolves / refetches); the source performs no
/// networking itself.
@MainActor
public final class LiveFormatterPrefsBridgeSource: FormatterPrefsBridgeSource {
    public var onUpdate: (@MainActor (FormatterPrefsBridgeInput) -> Void)?

    private var status: FormatterPrefsBridgeStatus
    private var settings: FormatterPrefsBridgeSettings
    private var connection: FormatterPrefsBridgeConnection

    public init(
        status: FormatterPrefsBridgeStatus = .loading,
        settings: FormatterPrefsBridgeSettings = FormatterPrefsBridgeSettings(),
        connection: FormatterPrefsBridgeConnection = .live
    ) {
        self.status = status
        self.settings = settings
        self.connection = connection
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    /// Applies a settings / lifecycle / connectivity change (the web parent re-render) and re-emits.
    public func update(
        status: FormatterPrefsBridgeStatus? = nil,
        settings: FormatterPrefsBridgeSettings? = nil,
        connection: FormatterPrefsBridgeConnection? = nil
    ) {
        if let status { self.status = status }
        if let settings { self.settings = settings }
        if let connection { self.connection = connection }
        emit()
    }

    private func emit() {
        onUpdate?(FormatterPrefsBridgeInput(status: status, settings: settings, connection: connection))
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()`,
/// lets a test push further snapshots via `push(_:)`, and records call counts so the model's lifecycle
/// wiring (start / stop / refresh) can be asserted.
@MainActor
public final class InMemoryFormatterPrefsBridgeSource: FormatterPrefsBridgeSource {
    public var onUpdate: (@MainActor (FormatterPrefsBridgeInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private var current: FormatterPrefsBridgeInput?

    public init(initial: FormatterPrefsBridgeInput? = nil) {
        current = initial
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
        emit()
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: FormatterPrefsBridgeInput) {
        current = input
        emit()
    }

    private func emit() {
        if let current { onUpdate?(current) }
    }
}

// MARK: - Applier seam (native parity of `setGlobalLocale` / `setGlobalPrecision`)

/// The seam the model writes the resolved formatter prefs through — the native parity of the web
/// `setGlobalLocale` / `setGlobalPrecision` setters plus the `getGlobalLocale` / `getGlobalPrecision`
/// reads the bridge's de-dupe needs. `Sendable` so the same global store is safe to read from
/// formatters on any queue. The production app injects `FormatterPrefsBridgeGlobalsApplier` (writing
/// the process-wide store); tests inject `RecordingFormatterPrefsBridgeApplier`.
public protocol FormatterPrefsBridgeApplier: Sendable {
    /// Web `getGlobalLocale()`.
    func currentLocale() -> String
    /// Web `getGlobalPrecision()`.
    func currentPrecision() -> Int
    /// Web `setGlobalLocale(locale)`.
    func apply(locale: String)
    /// Web `setGlobalPrecision(decimals)`.
    func apply(precision: Int)
}

/// The production applier — reads + writes the process-wide `FormatterPrefsBridgeStore` (the parity of
/// the single web `numberFormat` module-globals instance). Defaults to the shared store; tests pass an
/// isolated one.
public struct FormatterPrefsBridgeGlobalsApplier: FormatterPrefsBridgeApplier {
    private let store: FormatterPrefsBridgeStore

    public init(store: FormatterPrefsBridgeStore = .shared) {
        self.store = store
    }

    public func currentLocale() -> String {
        store.locale
    }

    public func currentPrecision() -> Int {
        store.precision
    }

    public func apply(locale: String) {
        store.setLocale(locale)
    }

    public func apply(precision: Int) {
        store.setPrecision(precision)
    }
}

/// A recording applier for tests — stores the raw applied values as the "current" globals (so the
/// model's de-dupe can be exercised) and records every write so the apply-once / skip-redundant
/// behaviour is asserted without touching the shared store. `Sendable` via a lock so it satisfies the
/// applier seam under strict concurrency.
public final class RecordingFormatterPrefsBridgeApplier: FormatterPrefsBridgeApplier {
    private struct State {
        var locale: String
        var precision: Int
        var appliedLocales: [String]
        var appliedPrecisions: [Int]
    }

    private let state: OSAllocatedUnfairLock<State>

    public init(
        locale: String = FormatterPrefsBridgeLimits.fallbackLocale,
        precision: Int = FormatterPrefsBridgeLimits.defaultPrecision
    ) {
        state = OSAllocatedUnfairLock(
            initialState: State(locale: locale, precision: precision, appliedLocales: [], appliedPrecisions: [])
        )
    }

    public func currentLocale() -> String {
        state.withLock { $0.locale }
    }

    public func currentPrecision() -> Int {
        state.withLock { $0.precision }
    }

    public func apply(locale: String) {
        state.withLock {
            $0.locale = locale
            $0.appliedLocales.append(locale)
        }
    }

    public func apply(precision: Int) {
        state.withLock {
            $0.precision = precision
            $0.appliedPrecisions.append(precision)
        }
    }

    /// Every locale the model wrote, in order.
    public var appliedLocales: [String] {
        state.withLock { $0.appliedLocales }
    }

    /// Every precision the model wrote, in order.
    public var appliedPrecisions: [Int] {
        state.withLock { $0.appliedPrecisions }
    }
}

// MARK: - Broadcast seam (native parity of `subscribe(TOPICS.SETTINGS_CHANGED)`)

/// The seam the model subscribes to for cross-context settings-changed signals — the native parity of
/// the web `subscribe((msg) => { if (msg.type === TOPICS.SETTINGS_CHANGED) qc.invalidateQueries(...) })`.
/// On a signal the model calls `refresh()`, so a settings mutation made without going through the
/// source still re-reads the source of truth. The production app injects
/// `NotificationCenterFormatterPrefsBridgeBroadcast`; previews use the no-op double; tests use the
/// manual double.
@MainActor
public protocol FormatterPrefsBridgeBroadcast: AnyObject {
    var onSettingsChanged: (@MainActor () -> Void)? { get set }
    func start()
    func stop()
}

/// The production broadcast — observes a process-wide `settings.changed` notification (the native
/// cross-context channel; peer scenes/extensions post it after saving settings) and invokes
/// `onSettingsChanged` on the main actor, the parity of the web `BroadcastChannel` `settings.changed`
/// message handler.
@MainActor
public final class NotificationCenterFormatterPrefsBridgeBroadcast: FormatterPrefsBridgeBroadcast {
    /// The cross-context settings-changed channel — the native parity of `TOPICS.SETTINGS_CHANGED`.
    public static let settingsChangedNotification = Notification.Name("io.teslasync.settings.changed")

    public var onSettingsChanged: (@MainActor () -> Void)?

    private let center: NotificationCenter
    private nonisolated(unsafe) var observer: NSObjectProtocol?

    public init(center: NotificationCenter = .default) {
        self.center = center
    }

    public func start() {
        guard observer == nil else { return }
        observer = center.addObserver(
            forName: Self.settingsChangedNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.onSettingsChanged?()
            }
        }
    }

    public func stop() {
        if let observer {
            center.removeObserver(observer)
            self.observer = nil
        }
    }

    deinit {
        if let observer {
            center.removeObserver(observer)
        }
    }
}

/// A no-op broadcast for previews — never signals, so authoring the surface triggers no refetch.
@MainActor
public final class NoopFormatterPrefsBridgeBroadcast: FormatterPrefsBridgeBroadcast {
    public var onSettingsChanged: (@MainActor () -> Void)?
    public init() {}
    public func start() {}
    public func stop() {}
}

/// A manual broadcast for tests — records start/stop and fires the signal on demand via `fire()`, so
/// the model's "settings-changed → refresh" wiring is asserted deterministically.
@MainActor
public final class ManualFormatterPrefsBridgeBroadcast: FormatterPrefsBridgeBroadcast {
    public var onSettingsChanged: (@MainActor () -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0

    public init() {}

    public func start() {
        startCount += 1
    }

    public func stop() {
        stopCount += 1
    }

    /// Fires a settings-changed signal (no-op when nothing is subscribed).
    public func fire() {
        onSettingsChanged?()
    }
}
