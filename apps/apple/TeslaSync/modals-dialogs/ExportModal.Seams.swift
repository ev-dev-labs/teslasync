//
//  ExportModal.Seams.swift
//  TeslaSync — P4 modal / dialog · 0023 · ExportModal (Apple)
//
//  The dependency seams the ExportModal view-model binds through, kept apart from the model for the lint
//  length budget: the P1/S11 telemetry contract, the clipboard seam (web `CopyButton` →
//  navigator.clipboard.writeText), the download action seam (web `onDownload`), the share-URL origin
//  provider (web `window.location.origin`), the "Updated {date}" formatter (web `useDateFormat`'s
//  `formatDate`), the coalesced source snapshot (the exported dashboard + freshness), the P1/S8 source
//  protocol, the in-memory source for previews/tests, the P1/S10 i18n facade (web `useTranslation`), and
//  the VoiceOver string builders. Foundation + OSLog only — no view, no network.
//

import Foundation
import OSLog
#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter forwarding to the shared-core diagnostics sink (consent-gated +
/// redacted there).
public protocol ExportTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a static,
/// non-identifying constant.
public struct OSLogExportTelemetry: ExportTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Clipboard seam (web `CopyButton`)

/// Copies a string to the system clipboard (web `CopyButton` → `navigator.clipboard.writeText`). The
/// view-model drives this; the default writes to the platform pasteboard, while tests inject a recorder.
public protocol ExportClipboard: Sendable {
    func copy(_ text: String)
}

/// Platform-pasteboard default (`UIPasteboard` on iOS / iPadOS, `NSPasteboard` on macOS). On any other
/// platform the copy is a no-op so the surface still links.
public struct SystemExportClipboard: ExportClipboard {
    public init() {}

    public func copy(_ text: String) {
        #if canImport(UIKit)
            UIPasteboard.general.string = text
        #elseif canImport(AppKit)
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(text, forType: .string)
        #endif
    }
}

// MARK: - Download action seam (web `onDownload`)

/// The JSON-file download request the modal hands off (web `onDownload`, which builds + clicks a
/// `Blob`-backed `<a download>`): the suggested file name and the pretty-printed JSON payload.
public struct ExportDownloadRequest: Sendable, Equatable {
    public let fileName: String
    public let json: String

    public init(fileName: String, json: String) {
        self.fileName = fileName
        self.json = json
    }
}

/// The single command the modal drives — handing the JSON file off for download (web `onDownload`). The
/// default logs the intent without touching the file system so previews render safely; the production
/// app injects an adapter that writes the file / presents a share sheet or save panel.
public protocol ExportActions: Sendable {
    func download(_ request: ExportDownloadRequest)
}

/// `os.Logger`-backed default that records the download intent without persisting a file.
public struct OSLogExportActions: ExportActions {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "export")
    }

    public func download(_ request: ExportDownloadRequest) {
        logger.info(
            """
            dashboard.export.download surface=\(ExportSurface.slug, privacy: .public) \
            bytes=\(request.json.utf8.count, privacy: .public)
            """
        )
    }
}

// MARK: - Share-URL origin (web `window.location.origin`)

/// Provides the public origin the share URL is built against (web `window.location.origin`). The
/// production app injects the configured app origin; previews/tests inject a deterministic one.
public protocol ExportURLOriginProviding: Sendable {
    func origin() -> String
}

/// Default provider over a configured origin (web `window.location.origin`).
public struct DefaultExportURLOrigin: ExportURLOriginProviding {
    private let value: String

    public init(origin: String = "https://app.teslasync.io") {
        value = origin
    }

    public func origin() -> String {
        value
    }
}

// MARK: - "Updated {date}" formatter (web `useDateFormat().formatDate`)

/// Formats the dashboard's last-updated instant for the "Updated {date}" line (web
/// `formatDate(dashboard.updatedAt)` — numeric year / short month / numeric day). Injected so
/// tests/previews stay deterministic across time zones + locales.
public protocol ExportDateFormatting: Sendable {
    func format(_ date: Date) -> String
}

/// `DateFormatter`-backed default (medium date, no time — web
/// `toLocaleDateString({year:'numeric', month:'short', day:'numeric'})` parity).
public struct DefaultExportDateFormatting: ExportDateFormatting {
    private let timeZone: TimeZone
    private let locale: Locale

    public init(timeZone: TimeZone = .current, locale: Locale = .current) {
        self.timeZone = timeZone
        self.locale = locale
    }

    public func format(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by an `ExportSource`: the load status, the dashboard being exported (web
/// `dashboard` prop; `nil` once resolved means it was not found), the live-state freshness, the in-flight
/// refresh flag, and the last-updated timestamp.
public struct ExportUpdate: Sendable, Equatable {
    public var status: ExportLoadStatus
    public var dashboard: DashboardExportDescriptor?
    public var connection: ExportConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: ExportLoadStatus = .loading,
        dashboard: DashboardExportDescriptor? = nil,
        connection: ExportConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.dashboard = dashboard
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state holders — the
/// selected dashboard plus its live-state freshness — and reports a refresh affordance. Previews/tests
/// use `InMemoryExportSource`. The view never talks to the network.
@MainActor
public protocol ExportSource: AnyObject {
    var onUpdate: (@MainActor (ExportUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-resolves the dashboard + freshness (the error-state retry / the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and lets a
/// test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryExportSource: ExportSource {
    public var onUpdate: (@MainActor (ExportUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ExportUpdate?

    public init(initial: ExportUpdate? = nil) {
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
    public func push(_ update: ExportUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t('export…')` → keyed strings

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "ExportModal" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; kept per-surface so each parallel prompt owns its own strings.
public enum ExportStrings {
    public static let table = "ExportModal"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Convenience for body interpolation (`{{count}}` / `{{date}}` / `{{size}}`): resolves then
    /// substitutes one `{{token}}` occurrence with the supplied value.
    public static func string(
        _ key: String,
        _ fallback: String,
        token: String,
        value: String
    ) -> String {
        string(key, fallback).replacingOccurrences(of: "{{\(token)}}", with: value)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the summaries
/// are testable without a bundle.
public enum ExportAccessibility {
    /// The dialog container's label (web Modal `title`).
    public static func dialogLabel(localize: (String, String) -> String) -> String {
        localize("export.title", "Export Dashboard")
    }

    /// The summary block's combined VoiceOver label: the dashboard name, the widget tally, and the size.
    public static func summaryLabel(
        name: String,
        widgetCount: String,
        size: String
    ) -> String {
        "\(name), \(widgetCount), \(size)"
    }
}
