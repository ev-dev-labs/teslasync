//
//  WidgetCatalogueDialog.Seams.swift
//  TeslaSync — P4 modal / dialog · 0026 · WidgetCatalogueDialog (Apple)
//
//  The dependency seams the WidgetCatalogueDialog view-model binds through, kept apart from the model
//  for the lint length budget: the P1/S11 telemetry contract, the action seam (web `onAdd` + `onClose`),
//  the coalesced source snapshot (the catalogue + the active-widget set + freshness), the P1/S8 source
//  protocol, the in-memory source for previews/tests, the P1/S10 i18n facade (web routes copy through
//  `t('dashboard.catalogue…')`; native routes every string through a key, with `{{token}}`
//  interpolation), and the VoiceOver string builders.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent-gated
/// + redacted there).
public protocol WidgetCatalogueTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a static,
/// non-identifying constant.
public struct OSLogWidgetCatalogueTelemetry: WidgetCatalogueTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Action seam (web `onAdd` / `onClose`)

/// The two commands the catalogue drives — adding the picked widget to the active dashboard (web
/// `onAdd(widgetId)`) and dismissing (web `onClose()`). The default logs the intent without networking so
/// previews render safely; the production app injects an adapter over the real dashboard-layout
/// `addWidgets` reducer + the sheet dismissal.
public protocol WidgetCatalogueActions: Sendable {
    func add(widgetID: String)
    func close()
}

/// `os.Logger`-backed default that records the intents without mutating a layout or dismissing.
public struct OSLogWidgetCatalogueActions: WidgetCatalogueActions {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "telemetry")
    }

    public func add(widgetID: String) {
        logger.info(
            """
            dashboard.catalogue.add surface=\(WidgetCatalogueSurface.slug, privacy: .public) \
            widget=\(widgetID, privacy: .public)
            """
        )
    }

    public func close() {
        logger.info("dashboard.catalogue.close surface=\(WidgetCatalogueSurface.slug, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `WidgetCatalogueSource`: the load status, the catalogue entries
/// (web `WIDGET_REGISTRY`; delivered through the source so the view stays source-driven), the active
/// widget ids (web `activeWidgetIds` prop), the live-state freshness, the in-flight refresh flag, and the
/// last-updated timestamp.
public struct WidgetCatalogueUpdate: Sendable, Equatable {
    public var status: WidgetCatalogueLoadStatus
    public var entries: [WidgetCatalogueEntry]
    public var activeWidgetIDs: [String]
    public var connection: WidgetCatalogueConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: WidgetCatalogueLoadStatus = .loading,
        entries: [WidgetCatalogueEntry] = [],
        activeWidgetIDs: [String] = [],
        connection: WidgetCatalogueConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.entries = entries
        self.activeWidgetIDs = activeWidgetIDs
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }

    /// The production snapshot: the full native registry as the catalogue, with the supplied active set +
    /// freshness. Mirrors the web reading the static `WIDGET_REGISTRY` while the dashboard supplies the
    /// active ids.
    public static func live(
        activeWidgetIDs: [String],
        connection: WidgetCatalogueConnection = .live,
        updatedAt: Date? = nil
    ) -> WidgetCatalogueUpdate {
        WidgetCatalogueUpdate(
            status: .loaded,
            entries: WidgetCatalogue.all,
            activeWidgetIDs: activeWidgetIDs,
            connection: connection,
            updatedAt: updatedAt
        )
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state holders — the
/// widget registry plus the active dashboard's widget set — and reports live-state freshness.
/// Previews/tests use `InMemoryWidgetCatalogueSource`. The view never talks to the network.
@MainActor
public protocol WidgetCatalogueSource: AnyObject {
    var onUpdate: (@MainActor (WidgetCatalogueUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the active-widget-set query (the error-state retry / the stale refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and lets a
/// test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryWidgetCatalogueSource: WidgetCatalogueSource {
    public var onUpdate: (@MainActor (WidgetCatalogueUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: WidgetCatalogueUpdate?

    public init(initial: WidgetCatalogueUpdate? = nil) {
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
    public func push(_ update: WidgetCatalogueUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t('dashboard.catalogue…')` → keyed strings

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "WidgetCatalogueDialog" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings. Supports
/// the web `{{token}}` interpolation used by the subtitle / result-count / add labels.
public enum WidgetCatalogueStrings {
    public static let table = "WidgetCatalogueDialog"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a key then substitutes `{{token}}` tokens (web `t(key, fallback, { token: value })`).
    public static func string(
        _ key: String,
        _ fallback: String,
        _ tokens: [String: String]
    ) -> String {
        interpolate(string(key, fallback), tokens)
    }

    /// Substitutes `{{name}}` style tokens from the token map. Pure + bundle-free for testability.
    public static func interpolate(_ template: String, _ tokens: [String: String]) -> String {
        var result = template
        for (token, value) in tokens {
            result = result.replacingOccurrences(of: "{{\(token)}}", with: value)
        }
        return result
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the summaries
/// are testable without a bundle.
public enum WidgetCatalogueAccessibility {
    /// The dialog's container label (web Modal `title`).
    public static func dialogLabel(localize: (String, String) -> String) -> String {
        localize("dashboard.catalogue.title", "Widget catalogue")
    }

    /// One entry's Add-button label (web `aria-label={t('dashboard.catalogue.addLabel', 'Add {{name}}
    /// widget', { name })}`); when already added it reads the "Added" state so VoiceOver users hear why
    /// the control is disabled.
    public static func addLabel(
        name: String,
        isAdded: Bool,
        localize: (String, String) -> String
    ) -> String {
        if isAdded {
            let added = localize("dashboard.added", "Added")
            return "\(name), \(added)"
        }
        let template = localize("dashboard.catalogue.addLabel", "Add {{name}} widget")
        return WidgetCatalogueStrings.interpolate(template, ["name": name])
    }

    /// One catalogue row's container label: the widget name, the category, and the "Added" state when on
    /// the layout — so a single swipe summarises the row.
    public static func rowLabel(
        name: String,
        categoryLabel: String,
        isAdded: Bool,
        localize: (String, String) -> String
    ) -> String {
        var parts = [name, categoryLabel]
        if isAdded { parts.append(localize("dashboard.added", "Added")) }
        return parts.joined(separator: ", ")
    }
}
