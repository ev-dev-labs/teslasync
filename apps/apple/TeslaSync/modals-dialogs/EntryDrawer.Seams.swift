//
//  EntryDrawer.Seams.swift
//  TeslaSync — P4 modal / dialog · 0018 · EntryDrawer (Apple)
//
//  The dependency seams the EntryDrawer view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S11 telemetry contract, the P1/S10 i18n facade (web
//  `useTranslation`), the absolute-timestamp date facade (web `TimeStamp format="absolute"`), the
//  clipboard seam (web `CopyButton` → `navigator.clipboard.writeText`), the replay action seam (web
//  `onReplay`), the coalesced source snapshot, the P1/S8 source protocol, the in-memory source for
//  previews/tests, and the VoiceOver string builders.
//

import Foundation
import OSLog

#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol EntryDrawerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug is a
/// static, non-identifying constant.
public struct OSLogEntryDrawerTelemetry: EntryDrawerTelemetry {
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
/// hardcoded literals. Keys live in the "EntryDrawer" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt
/// owns its own strings.
public enum EntryDrawerStrings {
    public static let table = "EntryDrawer"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// One-token substitution convenience (`{{token}}` → value) over the resolved string.
    public static func string(
        _ key: String,
        _ fallback: String,
        _ token: String,
        _ value: String
    ) -> String {
        string(key, fallback).replacingOccurrences(of: token, with: value)
    }
}

// MARK: - Date facade (web `TimeStamp format="absolute"`)

/// Resolves an instant into the absolute display copy the "Arrived" row renders. Production injects
/// a settings-backed implementation (locale + timezone + 12/24h from `useSettings`); previews/tests
/// use `DefaultEntryDrawerDateFormatting`.
public protocol EntryDrawerDateFormatting: Sendable {
    func absolute(_ date: Date) -> String
}

/// Bundle-free default rendering a medium date + short time (web `formatDateTime`, e.g.
/// "Apr 4, 2026 at 2:30 AM"). Stateless + `Sendable`; the locale + timezone are injectable so tests
/// are deterministic.
public struct DefaultEntryDrawerDateFormatting: EntryDrawerDateFormatting {
    private let localeIdentifier: String
    private let timeZone: TimeZone

    public init(localeIdentifier: String = "en_US", timeZone: TimeZone = .current) {
        self.localeIdentifier = localeIdentifier
        self.timeZone = timeZone
    }

    public func absolute(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

// MARK: - Clipboard seam (web `CopyButton` → clipboard)

/// Copies the active payload's text to the system clipboard (web `CopyButton`). The view-model
/// drives this; the default writes to the platform pasteboard, while tests inject a recorder.
public protocol EntryDrawerClipboard: Sendable {
    func copy(_ text: String)
}

/// Platform-pasteboard default (`UIPasteboard` on iOS / iPadOS, `NSPasteboard` on macOS). On any
/// other platform the copy is a no-op so the surface still links.
public struct SystemEntryDrawerClipboard: EntryDrawerClipboard {
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

// MARK: - Replay action seam (web `onReplay`)

/// The single command the drawer drives — re-publishing a DLQ entry to its source topic (web
/// `onReplay`). The default logs the intent without networking so previews render safely; the app
/// injects an adapter that drives the real `/system/dlq/{id}/replay` mutation.
public protocol EntryDrawerReplayAction: Sendable {
    func replay(id: Int64)
}

/// `os.Logger`-backed default that records the replay intent without networking.
public struct OSLogEntryDrawerReplayAction: EntryDrawerReplayAction {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "dlq-drawer")
    }

    public func replay(id: Int64) {
        logger.info("dlq-drawer.replay id=\(id, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by an `EntryDrawerSource`: the full-entry load status, the cached
/// summary row (web `summary` prop), the lazy-loaded full entry (web `full` prop), the server's
/// replay-enabled flag (web `replayEnabled`), the in-flight replay flag (web `replayInFlight`), the
/// live-state freshness, the refresh flag, and the last-updated timestamp.
public struct EntryDrawerUpdate: Sendable, Equatable {
    public var status: EntryDrawerLoadStatus
    public var summary: EntryDrawerSummary?
    public var full: EntryDrawerFull?
    public var replayEnabled: Bool
    public var replayInFlight: Bool
    public var connection: EntryDrawerConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: EntryDrawerLoadStatus = .loading,
        summary: EntryDrawerSummary? = nil,
        full: EntryDrawerFull? = nil,
        replayEnabled: Bool = true,
        replayInFlight: Bool = false,
        connection: EntryDrawerConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.summary = summary
        self.full = full
        self.replayEnabled = replayEnabled
        self.replayInFlight = replayInFlight
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 DLQ state
/// holders (the cached summary row + the `useDLQEntry(id)` lazy full fetch + the replay flags);
/// previews/tests use `InMemoryEntryDrawerSource`. The view never talks to the network.
@MainActor
public protocol EntryDrawerSource: AnyObject {
    var onUpdate: (@MainActor (EntryDrawerUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying full-entry fetch (the error-state retry / the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryEntryDrawerSource: EntryDrawerSource {
    public var onUpdate: (@MainActor (EntryDrawerUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: EntryDrawerUpdate?

    public init(initial: EntryDrawerUpdate? = nil) {
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
    public func push(_ update: EntryDrawerUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum EntryDrawerAccessibility {
    /// The dialog summary (web Drawer `title`): the entry-specific heading or the fallback.
    public static func summary(
        hasHead: Bool,
        id: Int64,
        localize: (String, String) -> String
    ) -> String {
        EntryDrawerProjection.title(hasHead: hasHead, id: id, localize: localize)
    }

    /// The header close button label (web Drawer close).
    public static func closeLabel(localize: (String, String) -> String) -> String {
        localize("common.close", "Close")
    }

    /// The replay button label (web `admin.dlq.drawer.replay`).
    public static func replayLabel(localize: (String, String) -> String) -> String {
        localize("admin.dlq.drawer.replay", "Replay")
    }

    /// The payload region label, naming the active tab so VoiceOver announces which blob is shown.
    public static func payloadLabel(
        tab: EntryDrawerTab,
        localize: (String, String) -> String
    ) -> String {
        localize(tab.labelKey, tab.labelFallback)
    }

    /// The copy button label, reflecting the copied state (web `Copy` / `Copied`).
    public static func copyLabel(
        copied: Bool,
        localize: (String, String) -> String
    ) -> String {
        copied
            ? localize("common.copyButton.copied", "Copied")
            : localize("common.copyButton.copy", "Copy")
    }
}
