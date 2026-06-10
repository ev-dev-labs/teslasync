//
//  ShareDriveDialog.Seams.swift
//  TeslaSync — P4 modal / dialog · 0028 · ShareDriveDialog (Apple)
//
//  The dependency seams the ShareDriveDialog view-model binds through, kept apart from the model for
//  the lint length budget: the P1/S11 telemetry contract, the create / revoke control seam (web
//  `useCreateShareLink` + `useRevokeShareLink`), the clipboard seam (web `CopyButton`), the share-URL
//  builder (web `${window.location.origin}/s/${token}`), the expiry date formatter (web `formatDate`),
//  the coalesced links source snapshot, the P1/S8 source protocol, the in-memory source for
//  previews/tests, the P1/S10 i18n facade (web `useTranslation`), and the VoiceOver string builders.
//  Foundation + OSLog only — no view, no network.
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
/// the production app injects an adapter forwarding to the shared core `Telemetry.track(.screenView(…))`
/// (ADR-016), consent-gated + redacted there.
public protocol ShareDriveTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogShareDriveTelemetry: ShareDriveTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Create / revoke control seam (web `useCreateShareLink` / `useRevokeShareLink`)

/// The dialog's command seam. `create` is the web `createShare.mutateAsync(body)` (POST
/// `/drives/{id}/share`), reporting completion back through `onCreateResult` (resolve → the new token,
/// reject → the error). `revoke` is the web `revokeShare.mutateAsync(token)` (DELETE `/shares/{token}`),
/// reporting through `onRevokeResult`. Keeps the network out of the view; the production app injects an
/// adapter driving the real mutations, previews/tests use the defaults.
@MainActor
public protocol ShareDriveController: AnyObject {
    /// Delivers the create outcome (web resolve → `.success(token)`, reject → `.failure(message)`).
    var onCreateResult: (@MainActor (ShareCreateOutcome) -> Void)? { get set }
    /// Delivers the revoke outcome (web resolve → `.success`, reject → `.failure(message)`).
    var onRevokeResult: (@MainActor (ShareRevokeOutcome) -> Void)? { get set }
    func create(input: CreateShareInput, driveId: String)
    func revoke(token: String)
}

/// `os.Logger`-backed default that records the intents without a network call and optimistically
/// reports success (create mints a local token so the standalone surface reaches its result panel
/// rather than hanging). Production injects the real mutation adapter; previews/tests inject their own.
@MainActor
public final class OSLogShareDriveController: ShareDriveController {
    public var onCreateResult: (@MainActor (ShareCreateOutcome) -> Void)?
    public var onRevokeResult: (@MainActor (ShareRevokeOutcome) -> Void)?
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "sharing")
    }

    public func create(input _: CreateShareInput, driveId: String) {
        let slug = ShareDriveSurface.slug
        logger.info("share.create drive=\(driveId, privacy: .public) surface=\(slug, privacy: .public)")
        onCreateResult?(.success(token: Self.localToken()))
    }

    public func revoke(token: String) {
        logger.info("share.revoke token=\(token, privacy: .private)")
        onRevokeResult?(.success(token: token))
    }

    /// A locally-minted opaque token so the standalone/preview surface can render its result panel
    /// without a backend round-trip (production returns the server token).
    private static func localToken() -> String {
        UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    }
}

// MARK: - Clipboard seam (web `CopyButton` → navigator.clipboard.writeText)

/// Copies a share URL to the system clipboard (web `CopyButton`). The view-model drives this; the
/// default writes to the platform pasteboard, while tests inject a recorder.
public protocol ShareDriveClipboard: Sendable {
    func copy(_ text: String)
}

/// Platform-pasteboard default (`UIPasteboard` on iOS / iPadOS, `NSPasteboard` on macOS). On any other
/// platform the copy is a no-op so the surface still links.
public struct SystemShareDriveClipboard: ShareDriveClipboard {
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

// MARK: - Share-URL builder (web `${window.location.origin}/s/${token}`)

/// Composes a public share URL from a token (web `${window.location.origin}/s/${token}`). The
/// production app injects the configured public origin; previews/tests inject a deterministic one.
public protocol ShareDriveURLBuilding: Sendable {
    func url(forToken token: String) -> String
}

/// Default builder over a configured origin. The trailing slash is normalized so the result is always
/// `<origin>/s/<token>` exactly like the web composition.
public struct DefaultShareDriveURLBuilder: ShareDriveURLBuilding {
    private let origin: String

    public init(origin: String = "https://app.teslasync.io") {
        self.origin = origin
    }

    public func url(forToken token: String) -> String {
        let base = origin.hasSuffix("/") ? String(origin.dropLast()) : origin
        return "\(base)/s/\(token)"
    }
}

// MARK: - Expiry date formatter (web `formatDate`)

/// Formats a link's expiry instant for the "Expires {{date}}" row (web `formatDate(expires_at)` —
/// numeric year / short month / numeric day). Injected so tests/previews stay deterministic across
/// time zones + locales.
public protocol ShareDriveDateFormatting: Sendable {
    func medium(_ date: Date) -> String
}

/// `DateFormatter`-backed default (medium date, no time — web `toLocaleDateString({year:'numeric',
/// month:'short', day:'numeric'})` parity).
public struct DefaultShareDriveDateFormatting: ShareDriveDateFormatting {
    private let timeZone: TimeZone
    private let locale: Locale

    public init(timeZone: TimeZone = .current, locale: Locale = .current) {
        self.timeZone = timeZone
        self.locale = locale
    }

    public func medium(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `ShareDriveSource`: the list load status, the drive's existing
/// share links (web `existingShares ?? []`), the live-state freshness, the in-flight refresh flag, and
/// the last-updated timestamp.
public struct ShareDriveUpdate: Sendable, Equatable {
    public var status: ShareLinksLoadStatus
    public var links: [ShareLink]
    public var connection: ShareDriveConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: ShareLinksLoadStatus = .loading,
        links: [ShareLink] = [],
        connection: ShareDriveConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.links = links
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state holders —
/// resolving the drive's share links (web `useShareLinks`) + the live-state freshness, plus a refresh
/// affordance (web `invalidateQueries` after a create/revoke). Previews/tests use
/// `InMemoryShareDriveSource`. The view never reads the network directly.
@MainActor
public protocol ShareDriveSource: AnyObject {
    var onUpdate: (@MainActor (ShareDriveUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-resolves the links + freshness (web refetch / the stale auto-refresh / post-mutation refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and lets
/// a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryShareDriveSource: ShareDriveSource {
    public var onUpdate: (@MainActor (ShareDriveUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ShareDriveUpdate?

    public init(initial: ShareDriveUpdate? = nil) {
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
    public func push(_ update: ShareDriveUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "ShareDriveDialog" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum ShareDriveStrings {
    public static let table = "ShareDriveDialog"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the summaries
/// are testable without a bundle.
public enum ShareDriveAccessibility {
    /// The dialog container label (web `Modal` `aria-labelledby` heading → "Share Drive").
    public static func dialogLabel(localize: (String, String) -> String) -> String {
        localize("share.title", "Share Drive")
    }

    /// One link row's VoiceOver label: the title (or "Untitled share"), the view tally, and the expiry
    /// status, joined so the row reads as one summary.
    public static func rowLabel(
        title: String,
        views: String,
        expiry: String
    ) -> String {
        "\(title), \(views), \(expiry)"
    }
}
