//
//  SLOTrackingCard.Seams.swift
//  TeslaSync — P4 feature view · 0253 · SLOTrackingCard (Apple)
//
//  The injectable seams the "Uptime & SLO" surface binds through, factored out of
//  `.Model` so production wiring, previews, and tests each supply their own
//  implementation and the view never touches the network or persistence: the
//  P1/S11 telemetry sink, the P1/S10 i18n facade, the personal-target persistence
//  store (web `localStorage`), the coalesced source snapshot, and the P1/S8 source
//  seam over the shared `/status/uptime?window=…` read — with in-memory doubles for
//  previews + tests. SwiftUI parity of
//  features/system/components/status/SLOTrackingCard.tsx.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there.
public protocol SLOTrackingTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogSLOTrackingTelemetry: SLOTrackingTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "SLOTrackingCard" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; the
/// per-surface table keeps each parallel surface prompt self-contained.
public enum SLOTrackingStrings {
    public static let table = "SLOTrackingCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Personal-target persistence seam (web `localStorage`)

/// The personal SLO target's persistence — the native port of the web
/// `localStorage` `teslasync.status.slo.target` round-trip. "Personal" means truly
/// local; the production app backs this with `UserDefaults`, while previews + tests
/// use the in-memory double. None of the persisted data is a credential.
@MainActor
public protocol SLOTargetStore: AnyObject {
    /// The persisted target, or `nil` when none was saved (web `getItem` → parse).
    func load() -> Double?
    /// Persists the chosen target (web `setItem(String(target))`).
    func save(_ target: Double)
}

/// `UserDefaults`-backed target store (production default). Mirrors the web key so
/// the value is recognizable across the platform's diagnostics.
@MainActor
public final class UserDefaultsSLOTargetStore: SLOTargetStore {
    /// The persistence key — the exact web `localStorage` key for cross-platform
    /// recognizability.
    public static let key = "teslasync.status.slo.target"

    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func load() -> Double? {
        guard defaults.object(forKey: Self.key) != nil else { return nil }
        return defaults.double(forKey: Self.key)
    }

    public func save(_ target: Double) {
        defaults.set(target, forKey: Self.key)
    }
}

/// In-memory target store used as the test/preview double.
@MainActor
public final class InMemorySLOTargetStore: SLOTargetStore {
    public private(set) var stored: Double?
    public private(set) var saveCount = 0

    public init(stored: Double? = nil) {
        self.stored = stored
    }

    public func load() -> Double? {
        stored
    }

    public func save(_ target: Double) {
        stored = target
        saveCount += 1
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `SLOTrackingSource`: the uptime query result
/// + the load status + the live-state connection + the sync timestamp.
public struct SLOTrackingUpdate: Sendable, Equatable {
    public var status: SLOLoadStatus
    /// The web `useQuery` result (`data`) for the active window, or `nil` while
    /// loading / on error / when the query resolved empty.
    public var snapshot: UptimeWindowDTO?
    public var connection: SLOConnection
    public var updatedAt: Date?

    public init(
        status: SLOLoadStatus = .loading,
        snapshot: UptimeWindowDTO? = nil,
        connection: SLOConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.snapshot = snapshot
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 uptime store (the `/status/uptime?window=…` read), re-keying on
/// `select(window:)` and projecting each emission to a `SLOTrackingUpdate`.
/// Previews + tests use `InMemorySLOTrackingSource`. The view never talks to the
/// network.
@MainActor
public protocol SLOTrackingSource: AnyObject {
    var onUpdate: (@MainActor (SLOTrackingUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the current window's read (the web auto-refetch). Wired to the
    /// error-state retry and the one-shot stale auto-refresh.
    func refresh()
    /// Re-keys the query to a new window (web `setWin` → `useQuery(['…', win])`).
    /// A fresh snapshot for that window arrives via `onUpdate`.
    func select(window: SLOWindow)
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Holds a per-window table of
/// snapshots, emits the active window's snapshot on `start()` / `select(window:)`,
/// counts lifecycle calls, and optionally pushes a follow-up snapshot to simulate
/// the refetch driven by `refresh()`.
@MainActor
public final class InMemorySLOTrackingSource: SLOTrackingSource {
    public var onUpdate: (@MainActor (SLOTrackingUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var selectedWindows: [SLOWindow] = []
    /// An optional snapshot pushed when `refresh()` runs (the web read refetch).
    public var refreshedUpdate: SLOTrackingUpdate?

    private var updates: [SLOWindow: SLOTrackingUpdate]
    private let fallback: SLOTrackingUpdate?
    private var currentWindow: SLOWindow

    public init(
        initial: SLOTrackingUpdate? = nil,
        window: SLOWindow = .d30,
        windowUpdates: [SLOWindow: SLOTrackingUpdate] = [:],
        refreshedUpdate: SLOTrackingUpdate? = nil
    ) {
        var table = windowUpdates
        if let initial, table[window] == nil { table[window] = initial }
        updates = table
        fallback = initial
        currentWindow = window
        self.refreshedUpdate = refreshedUpdate
    }

    public func start() {
        startCount += 1
        emitCurrent()
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
        if let refreshedUpdate { onUpdate?(refreshedUpdate) }
    }

    public func select(window: SLOWindow) {
        selectedWindows.append(window)
        currentWindow = window
        emitCurrent()
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: SLOTrackingUpdate) {
        onUpdate?(update)
    }

    private func emitCurrent() {
        if let update = updates[currentWindow] ?? fallback {
            onUpdate?(update)
        }
    }
}
