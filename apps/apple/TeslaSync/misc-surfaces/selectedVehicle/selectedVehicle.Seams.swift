//
//  selectedVehicle.Seams.swift
//  TeslaSync — P4 misc surface · 0003 · selectedVehicle (Apple)
//
//  The dependency seams the selectedVehicle store + view-model bind through, kept apart from
//  the model for the lint length budget: the persisted-id storage (web localStorage, the
//  native `UserDefaults` parity + an unavailable + an in-memory variant), the P1/S8 fleet
//  source (web `useVehicles()` + the URL params), the P1/S11 telemetry contract, and the
//  P1/S10 i18n facade (web `useTranslation`). No networking lives in the view.
//

import Foundation
import OSLog

// MARK: - Persisted-id storage (web localStorage)

/// The persisted selected-vehicle id store the `SelectedVehicleStore` reads / writes — the
/// native parity of the web `localStorage` access in `loadInitial` / `persist`. Kept behind a
/// seam so the store unit-tests against an in-memory double and the production app uses
/// `UserDefaults`. Main-actor isolated because the only writer is the main-actor store.
@MainActor
public protocol SelectedVehicleStorage: AnyObject {
    /// Whether durable writes are available (web: localStorage reachable). `false` makes the
    /// store report `.ephemeral` persistence (private-browsing / quota parity).
    var isAvailable: Bool { get }
    /// Reads + parses the persisted id (web `loadInitial`). `nil` when absent / corrupt.
    func read() -> Int?
    /// Persists the id, or clears it when `nil` (web `persist`). Returns whether the write
    /// reached durable storage.
    @discardableResult func write(_ id: Int?) -> Bool
    /// Registers a cross-scene change observer (web cross-tab `storage` event). The closure
    /// runs on the main actor whenever another scene / process mutates the same key.
    func beginObserving(_ onChange: @escaping @MainActor () -> Void)
    /// Removes the cross-scene observer.
    func endObserving()
}

/// `UserDefaults`-backed storage — the production parity of the web `localStorage` store.
/// Values are written as strings (web `String(id)`) for byte-identical round-tripping, and
/// `UserDefaults.didChangeNotification` provides the cross-scene sync the web gets from the
/// `storage` event.
@MainActor
public final class UserDefaultsSelectedVehicleStorage: SelectedVehicleStorage {
    private let defaults: UserDefaults
    private let key: String
    private nonisolated(unsafe) var token: (any NSObjectProtocol)?

    public let isAvailable: Bool

    public init(
        defaults: UserDefaults = .standard,
        key: String = SelectedVehicleStoreKeys.storageKey
    ) {
        self.defaults = defaults
        self.key = key
        isAvailable = true
    }

    public func read() -> Int? {
        guard defaults.object(forKey: key) != nil else { return nil }
        if let raw = defaults.string(forKey: key) {
            return SelectedVehicleStoreIdParser.parse(raw)
        }
        let numeric = defaults.integer(forKey: key)
        return numeric > 0 ? numeric : nil
    }

    @discardableResult
    public func write(_ id: Int?) -> Bool {
        if let id {
            defaults.set(String(id), forKey: key)
        } else {
            defaults.removeObject(forKey: key)
        }
        return true
    }

    public func beginObserving(_ onChange: @escaping @MainActor () -> Void) {
        endObserving()
        token = NotificationCenter.default.addObserver(
            forName: UserDefaults.didChangeNotification,
            object: defaults,
            queue: .main
        ) { _ in
            MainActor.assumeIsolated { onChange() }
        }
    }

    public func endObserving() {
        if let token {
            NotificationCenter.default.removeObserver(token)
        }
        token = nil
    }

    deinit {
        if let token {
            NotificationCenter.default.removeObserver(token)
        }
    }
}

/// Storage that is never available — the parity of the web private-browsing / quota / SSR
/// branch where `localStorage` access throws. Reads are `nil` and writes are dropped, so the
/// store reports `.ephemeral` persistence and keeps the selection in memory for the session.
@MainActor
public final class UnavailableSelectedVehicleStorage: SelectedVehicleStorage {
    public let isAvailable = false
    public init() {}
    public func read() -> Int? {
        nil
    }

    @discardableResult public func write(_: Int?) -> Bool {
        false
    }

    public func beginObserving(_: @escaping @MainActor () -> Void) {}
    public func endObserving() {}
}

/// In-memory storage for previews + unit tests. Holds the value directly and lets a test
/// simulate a cross-scene write (web `dispatchEvent(new StorageEvent(...))`) via
/// `simulateExternalChange(to:)`.
@MainActor
public final class InMemorySelectedVehicleStorage: SelectedVehicleStorage {
    public let isAvailable: Bool
    private var value: Int?
    private var onChange: (@MainActor () -> Void)?

    public init(initial: Int? = nil, isAvailable: Bool = true) {
        value = initial
        self.isAvailable = isAvailable
    }

    public func read() -> Int? {
        value
    }

    @discardableResult
    public func write(_ id: Int?) -> Bool {
        guard isAvailable else { return false }
        value = id
        return true
    }

    public func beginObserving(_ onChange: @escaping @MainActor () -> Void) {
        self.onChange = onChange
    }

    public func endObserving() {
        onChange = nil
    }

    /// Simulates another scene / tab mutating the same key (web cross-tab `storage` event).
    public func simulateExternalChange(to id: Int?) {
        value = id
        onChange?()
    }
}

// MARK: - Fleet source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `SelectedVehicleStoreFleetSource`: the fleet feed, the
/// URL-provided vehicle id (web `/vehicles/:id` + `?vehicle_id=N`), plus the live-state
/// freshness + last-update time the freshness chip / banner read.
public struct SelectedVehicleStoreUpdate: Sendable, Equatable {
    public var fleet: SelectedVehicleStoreFleetState
    public var urlVehicleId: Int?
    public var connection: SelectedVehicleStoreConnection
    public var updatedAt: Date?

    public init(
        fleet: SelectedVehicleStoreFleetState,
        urlVehicleId: Int? = nil,
        connection: SelectedVehicleStoreConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.fleet = fleet
        self.urlVehicleId = urlVehicleId
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view-model binds through for the fleet + URL selection. Production implements
/// this over the shared P1/S8 vehicles state holder (web `useVehicles()`) and the active
/// route's params; previews / tests use `InMemorySelectedVehicleStoreFleetSource`. The view
/// never talks to the network directly.
@MainActor
public protocol SelectedVehicleStoreFleetSource: AnyObject {
    var onUpdate: (@MainActor (SelectedVehicleStoreUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-reads the fleet (web refetch) — the error-state retry + the stale auto-refresh.
    func refresh()
}

/// In-memory fleet source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemorySelectedVehicleStoreFleetSource: SelectedVehicleStoreFleetSource {
    public var onUpdate: (@MainActor (SelectedVehicleStoreUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SelectedVehicleStoreUpdate?

    public init(initial: SelectedVehicleStoreUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: SelectedVehicleStoreUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted there.
public protocol SelectedVehicleStoreTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogSelectedVehicleStoreTelemetry: SelectedVehicleStoreTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "selectedVehicle" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel
/// prompt owns its own strings without editing the shared catalog.
public enum SelectedVehicleStoreStrings {
    public static let table = "selectedVehicle"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
