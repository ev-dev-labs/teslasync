//
//  LayoutManager.Model.swift
//  TeslaSync — P4 feature view · 0125 · LayoutManager (Apple)
//
//  Surface identity (P1/S11 diagnostics slug), the telemetry seam (P1/S11
//  `view.opened`), the i18n facade (P1/S10), and the pure input value types for
//  the SwiftUI parity of web/src/features/dashboard/components/LayoutManager.tsx.
//
//  The web component is purely presentational: it receives a `dashboards` array
//  (the `SavedDashboard` shape), the `activeId`, and eight callbacks
//  (onSwitch / onCreate / onRename / onDelete / onReorder / onDuplicate /
//  onOpenSettings / onOpenTemplates?). It performs no I/O and uses only
//  `useTranslation('dashboard')`. The native surface mirrors that exactly: it
//  binds no store and does no networking — the parent dashboard page maps the
//  shared S8 layout holder into `SavedLayoutData` and supplies the callbacks.
//  The card carries only the four fields this switcher reads from `SavedDashboard`
//  (`id`, `name`, `icon`, `isDefault`); the rest of that shape (widgets, layouts,
//  vehicleId, timestamps, settings) is the dashboard page's concern, not this leaf's.
//

import Foundation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable, non-identifying identity for the `LayoutManager` feature view. The
/// slug is the value emitted with the P1/S11 `view.opened` diagnostics contract
/// and is referenced by both the view and its tests so the two never drift.
public enum LayoutManagerSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "LayoutManager"

    /// Reports the surface becoming visible. Factored out of the view's `.task`
    /// so it is unit-testable without a rendering host.
    public static func reportOpen(to telemetry: any LayoutManagerTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The view reports its
/// appearance through this protocol so production wiring, previews, and tests can
/// each supply their own sink. It is `Sendable` (members non-isolated) so the
/// view can emit from its `.task` without a main-actor hop.
public protocol LayoutManagerTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is
/// a static, non-identifying constant logged verbatim; no layout name or payload
/// is ever recorded.
public struct OSLogLayoutManagerTelemetry: LayoutManagerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback so the
/// view holds no hardcoded literals. Keys live in the "LayoutManager" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time. The
/// web source keys (`dashboard.*`) are preserved verbatim so a shared catalog
/// resolves identically across web and native.
public enum LayoutManagerStrings {
    public static let table = "LayoutManager"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-interpolated string (web i18next `{{name}}`).
    public static func format(_ key: String, _ fallbackFormat: String, _ argument: String) -> String {
        String(format: string(key, fallbackFormat), argument)
    }
}

// MARK: - Input value type (web `SavedDashboard` subset the switcher reads)

/// The pure, `Equatable` projection of one saved dashboard for the switcher — the
/// four fields the web `LayoutManager` reads off `SavedDashboard` (`id`, `name`,
/// `icon`, `isDefault`). The parent maps the shared S8 holder into this; the leaf
/// never touches the network. `id` is the web string id (a UUID/slug), so it is
/// kept as `String` for byte-for-byte identity parity with the web key.
public struct SavedLayoutData: Equatable, Sendable, Identifiable {
    public let id: String
    public let name: String
    /// The web `d.icon` (an emoji); `nil` falls back to the web default 📊.
    public let icon: String?
    /// The web `d.isDefault` — the protected layout that cannot be deleted.
    public let isDefault: Bool

    public init(id: String, name: String, icon: String? = nil, isDefault: Bool = false) {
        self.id = id
        self.name = name
        self.icon = icon
        self.isDefault = isDefault
    }
}

// MARK: - Freshness (live / stale / offline) for the parent's layouts query

/// Freshness of the saved-layouts read (web-side a TanStack query). The switcher
/// keeps its cached tabs visible and surfaces a stale/offline chip rather than
/// hiding the strip, mirroring the layered live-state contract (ADR-013).
public enum LayoutLiveConnection: Equatable, Sendable {
    case live
    case stale
    case offline

    public var isStale: Bool {
        self == .stale
    }

    public var isOffline: Bool {
        self == .offline
    }
}

// MARK: - Surface state (every state renders — no hidden surfaces)

/// The render state of the switcher. The web component is always `loaded`; the
/// native surface additionally renders the load/empty/error chrome required of
/// every P4 surface so the parent never has to special-case the first paint or a
/// failed layouts read.
public enum LayoutManagerState: Equatable, Sendable {
    /// Initial fetch of the saved layouts — skeleton tab chrome.
    case loading
    /// Resolved with no saved layouts — friendly empty state plus the New Layout
    /// affordance, never a blank box.
    case empty
    /// The saved-layouts read failed — message + retry affordance.
    case error(message: String?)
    /// Layouts resolved — the full switcher strip, with the active id highlighted.
    case loaded(layouts: [SavedLayoutData], activeID: String)

    /// The resolved layouts, if any (convenience for the view/tests).
    public var layouts: [SavedLayoutData] {
        if case let .loaded(layouts, _) = self { return layouts }
        return []
    }

    /// The active layout id, if resolved (convenience for the view/tests).
    public var activeID: String? {
        if case let .loaded(_, activeID) = self { return activeID }
        return nil
    }
}

// MARK: - Action seam (web `onSwitch` / `onCreate` / … / `onOpenTemplates?`)

/// The callbacks the switcher invokes — the native port of the web component's
/// nine props. No mutation logic lives in the leaf: the parent owns the
/// store-backed effects, exactly like the web component. `onOpenTemplates` is
/// optional (web `onOpenTemplates?`): when present, "New Layout" opens the
/// template gallery instead of the inline create field. `onRetry` backs the
/// native error state and has no web analogue (the parent owns the query there).
/// A plain value bag (used from the MainActor view and constructed in tests).
public struct LayoutManagerActions {
    public let onSwitch: (String) -> Void
    public let onCreate: (String) -> Void
    public let onRename: (String, String) -> Void
    public let onDelete: (String) -> Void
    public let onReorder: (Int, Int) -> Void
    public let onDuplicate: (String) -> Void
    public let onOpenSettings: (String) -> Void
    public let onOpenTemplates: (() -> Void)?
    public let onRetry: () -> Void

    public init(
        onSwitch: @escaping (String) -> Void,
        onCreate: @escaping (String) -> Void,
        onRename: @escaping (String, String) -> Void,
        onDelete: @escaping (String) -> Void,
        onReorder: @escaping (Int, Int) -> Void,
        onDuplicate: @escaping (String) -> Void,
        onOpenSettings: @escaping (String) -> Void,
        onOpenTemplates: (() -> Void)? = nil,
        onRetry: @escaping () -> Void = {}
    ) {
        self.onSwitch = onSwitch
        self.onCreate = onCreate
        self.onRename = onRename
        self.onDelete = onDelete
        self.onReorder = onReorder
        self.onDuplicate = onDuplicate
        self.onOpenSettings = onOpenSettings
        self.onOpenTemplates = onOpenTemplates
        self.onRetry = onRetry
    }

    /// Whether "New Layout" opens the template gallery (web `onOpenTemplates`
    /// provided) rather than the inline create field.
    public var hasTemplates: Bool {
        onOpenTemplates != nil
    }
}
