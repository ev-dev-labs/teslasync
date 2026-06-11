//
//  KeyboardShortcutsModal.Seams.swift
//  TeslaSync — P4 modal/dialog · 0006 · KeyboardShortcutsModal (Apple)
//
//  The dependency seams the KeyboardShortcutsModal view-model binds through, kept apart from the model
//  for the lint length budget: the P1/S11 telemetry contract, the filter-persistence seam (web
//  `sessionStorage`), the dismissal control seam (web `onClose`), the coalesced registry snapshot, the
//  P1/S8 source protocol + an in-memory source for previews/tests, the P1/S10 i18n facade (web
//  `useTranslation`), and the VoiceOver string builders. No view reads the store, persistence, or
//  navigation directly — it only ever talks to these seams.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared core `Telemetry.track(.screenView
/// (screen:…))` (ADR-016), consent-gated + redacted there.
public protocol KBShortcutsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogKBShortcutsTelemetry: KBShortcutsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Filter persistence seam (web `sessionStorage`)

/// Persists the All / Global / This page choice — the native parity of the web `FILTER_STORAGE_KEY`
/// `sessionStorage` read/write. The default uses `UserDefaults.standard` keyed by the same web key;
/// previews/tests use the in-memory store. Kept off the view so no persistence lives in SwiftUI.
public protocol KBShortcutsFilterStore: Sendable {
    func load() -> KBShortcutsFilter
    func save(_ mode: KBShortcutsFilter)
}

/// `UserDefaults`-backed default. The web persists in `sessionStorage` (per-tab); iOS/macOS have no
/// tab session, so the closest faithful store is `UserDefaults` under the same key — `all` still reads
/// back as the default when nothing was ever written. `@unchecked Sendable` is sound: `UserDefaults` is
/// documented thread-safe, and the stored handle is only ever read/written through its atomic API.
public struct UserDefaultsKBShortcutsFilterStore: KBShortcutsFilterStore, @unchecked Sendable {
    private let defaults: UserDefaults

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    public func load() -> KBShortcutsFilter {
        KBShortcutsProjection.parseFilter(defaults.string(forKey: KBShortcutsProjection.storageKey))
    }

    public func save(_ mode: KBShortcutsFilter) {
        defaults.set(KBShortcutsProjection.encode(mode), forKey: KBShortcutsProjection.storageKey)
    }
}

/// In-memory filter store for previews + unit tests; lock-guarded for the `Sendable` seam.
public final class InMemoryKBShortcutsFilterStore: KBShortcutsFilterStore, @unchecked Sendable {
    private let lock = NSLock()
    private var mode: KBShortcutsFilter

    public init(initial: KBShortcutsFilter = .all) {
        mode = initial
    }

    public func load() -> KBShortcutsFilter {
        lock.withLock { mode }
    }

    public func save(_ mode: KBShortcutsFilter) {
        lock.withLock { self.mode = mode }
    }
}

// MARK: - Dismissal control seam (web `onClose`)

/// The cheat sheet's dismissal seam — the native parity of the web `onClose` prop (the "×" / Esc close).
/// Keeps the presenting host out of the view; the production app injects an adapter that drives the real
/// navigation, previews/tests use the logging / spy defaults.
public protocol KBShortcutsController: Sendable {
    func dismiss()
}

/// `os.Logger`-backed default that records the intent without touching navigation, so previews run safely.
public struct OSLogKBShortcutsController: KBShortcutsController {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "shortcuts")
    }

    public func dismiss() {
        logger.info("shortcuts.dismiss surface=\(KBShortcutsSurface.slug, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `KBShortcutsSource`: the load status, the registry entries (web
/// `useAllShortcuts`), the current pathname (web `useLocation`, used by the route gate), the live-state
/// freshness, and the in-flight flag.
public struct KBShortcutsUpdate: Sendable, Equatable {
    public var status: KBShortcutsLoadStatus
    public var entries: [KBShortcutEntry]
    public var pathname: String
    public var connection: KBShortcutsConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: KBShortcutsLoadStatus = .loading,
        entries: [KBShortcutEntry] = [],
        pathname: String = "/",
        connection: KBShortcutsConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.entries = entries
        self.pathname = pathname
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state holders —
/// the shortcut registry snapshot plus the current route and the live-state freshness + a refresh
/// affordance. Previews/tests use `InMemoryKBShortcutsSource`.
@MainActor
public protocol KBShortcutsSource: AnyObject {
    var onUpdate: (@MainActor (KBShortcutsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-resolves the registry snapshot + freshness (web refetch / the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and lets
/// a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryKBShortcutsSource: KBShortcutsSource {
    public var onUpdate: (@MainActor (KBShortcutsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: KBShortcutsUpdate?

    public init(initial: KBShortcutsUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { push(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: KBShortcutsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "KeyboardShortcutsModal" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum KBShortcutsStrings {
    public static let table = "KeyboardShortcutsModal"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (VoiceOver builders)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the summaries
/// are testable without a bundle.
public enum KBShortcutsAccessibility {
    /// The dialog summary: the modal title (web `aria-labelledby` heading).
    public static func summary(localize: (String, String) -> String) -> String {
        KBShortcutsProjection.title(localize: localize)
    }

    /// The close affordance's VoiceOver label (web `Modal` "×").
    public static func closeLabel(localize: (String, String) -> String) -> String {
        localize("shortcuts.a11y.close", "Close")
    }

    /// The filter control's VoiceOver label (web `role="tablist" aria-label`).
    public static func filterLabel(localize: (String, String) -> String) -> String {
        localize("shortcuts.a11y.filter", "Filter shortcuts")
    }

    /// A shortcut row's VoiceOver label: the description followed by its keys spoken as a combination,
    /// e.g. "Open command palette, Control plus K" (web `<kbd>` chips joined by "+").
    public static func rowLabel(
        description: String,
        keys: [String],
        localize: (String, String) -> String
    ) -> String {
        let spoken = keysValue(keys, localize: localize)
        return spoken.isEmpty ? description : "\(description), \(spoken)"
    }

    /// The keys of a shortcut spoken as a combination — the chip tokens joined by the localized "plus"
    /// connector (web renders a "+" glyph between chips).
    public static func keysValue(_ keys: [String], localize: (String, String) -> String) -> String {
        let connector = localize("shortcuts.a11y.keySeparator", "plus")
        return keys.joined(separator: " \(connector) ")
    }
}
