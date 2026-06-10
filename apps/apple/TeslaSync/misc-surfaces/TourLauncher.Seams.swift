//
//  TourLauncher.Seams.swift
//  TeslaSync — P4 misc surface · 0001 · TourLauncher (Apple)
//
//  The dependency seams the TourLauncher view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S11 telemetry contract, the tour-control seam (web
//  `dispatchTourStart` + `markTourListSeen`), the coalesced source snapshot, the P1/S8 source
//  protocol, the in-memory source for previews/tests, the P1/S10 i18n facade (web
//  `useTranslation`), and the VoiceOver string builders.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted there.
public protocol TourLauncherTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogTourLauncherTelemetry: TourLauncherTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Tour-control seam (web `dispatchTourStart` + `markTourListSeen`)

/// The launcher's command seam. `startTour` is the web `dispatchTourStart(def.id)` (Layout
/// promotes the tour to active state); `markListSeen` is the web `markTourListSeen()` recorded
/// when the launcher opens. Keeps the tour state machine out of the view; the production app
/// injects an adapter that drives the real tour engine, previews/tests use the logging / spy
/// defaults.
public protocol TourLauncherController: Sendable {
    func startTour(id: String)
    func markListSeen()
}

/// `os.Logger`-backed default that records the intents without driving a tour, so previews run
/// safely.
public struct OSLogTourLauncherController: TourLauncherController {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "onboarding")
    }

    public func startTour(id: String) {
        logger.info("tour.start id=\(id, privacy: .public) source=\(TourLauncherSurface.slug, privacy: .public)")
    }

    public func markListSeen() {
        logger.info("tour.listSeen source=\(TourLauncherSurface.slug, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `TourLauncherSource`: the load status, the registry
/// entries, the completed tour ids (web `isTourCompleted`), the current route (web
/// `useLocation().pathname`, used by `isRecommendedForRoute`), the live-state freshness, and the
/// in-flight flag.
public struct TourLauncherUpdate: Sendable, Equatable {
    public var status: TourLauncherLoadStatus
    public var entries: [TourCatalogEntry]
    public var completedIDs: Set<String>
    public var pathname: String
    public var connection: TourLauncherConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: TourLauncherLoadStatus = .loading,
        entries: [TourCatalogEntry] = [],
        completedIDs: Set<String> = [],
        pathname: String = "/",
        connection: TourLauncherConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.entries = entries
        self.completedIDs = completedIDs
        self.pathname = pathname
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state
/// holders — composing the tour registry (web `listTours`) with the completion store (web
/// `isTourCompleted` over `localStorage`) and the current route (web `useLocation`), plus a
/// refresh affordance and the "reset all tours" command (web `resetAllTours`). Previews/tests use
/// `InMemoryTourLauncherSource`. The view never reads persistence directly.
@MainActor
public protocol TourLauncherSource: AnyObject {
    var onUpdate: (@MainActor (TourLauncherUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-reads the registry + completion store (web refetch / the stale auto-refresh).
    func refresh()
    /// Clears every completion flag (web `resetAllTours()`) and re-pushes a fresh snapshot.
    func resetAllTours()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()`,
/// lets a test push further snapshots via `push(_:)`, and models `resetAllTours()` by clearing
/// the completed set on the most recent snapshot and re-pushing it.
@MainActor
public final class InMemoryTourLauncherSource: TourLauncherSource {
    public var onUpdate: (@MainActor (TourLauncherUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var resetCount = 0

    private let initial: TourLauncherUpdate?
    private var latest: TourLauncherUpdate?

    public init(initial: TourLauncherUpdate? = nil) {
        self.initial = initial
        latest = initial
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

    public func resetAllTours() {
        resetCount += 1
        guard var snapshot = latest else { return }
        snapshot.completedIDs = []
        push(snapshot)
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: TourLauncherUpdate) {
        latest = update
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "TourLauncher" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum TourLauncherStrings {
    public static let table = "TourLauncher"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a templated string, substituting positional arguments (web i18next `{{title}}`,
    /// modeled as `{{0}}`).
    public static func format(_ key: String, _ fallback: String, _ args: [String]) -> String {
        var result = string(key, fallback)
        for (index, value) in args.enumerated() {
            result = result.replacingOccurrences(of: "{{\(index)}}", with: value)
        }
        return result
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum TourLauncherAccessibility {
    /// The launcher summary: title + tour count.
    public static func summary(count: Int, localize: (String, String) -> String) -> String {
        let title = localize("tour.launcher.title", "Take a tour")
        return "\(title): \(count)"
    }

    /// One row's VoiceOver label: the title, then the recommended / completed status, then the
    /// description, so the row reads as a sentence.
    public static func rowLabel(_ row: TourRow, localize: (String, String) -> String) -> String {
        var parts = [row.title]
        if row.recommended {
            parts.append(localize("tour.launcher.recommendedHere", "Recommended for this page"))
        }
        if row.completed {
            parts.append(localize("tour.launcher.completed", "Completed"))
        }
        parts.append(row.description)
        return parts.joined(separator: ", ")
    }

    /// The Start / Replay button's accessibility label, with the tour title substituted (web
    /// `aria-label={t('tour.launcher.startAria', 'Start tour: {{title}}', { title })}`).
    public static func actionLabel(_ row: TourRow, localize: (String, String) -> String) -> String {
        let template = localize(row.action.accessibilityKey, row.action.accessibilityFallback)
        return template.replacingOccurrences(of: "{{0}}", with: row.title)
    }
}
