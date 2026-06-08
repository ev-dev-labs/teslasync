//
//  WebhookChannelsSection.Seams.swift
//  TeslaSync — P4 feature view · 0218 · WebhookChannelsSection (Apple)
//
//  The telemetry seam (P1/S11 diagnostics), the i18n facade (P1/S10), the coalesced
//  source snapshot, the state-holder seam (P1/S8), and the in-memory source for
//  previews/tests — split from WebhookChannelsSection.Model.swift to respect the
//  house file-length limit. The `@Observable` view-model that consumes these lives
//  in WebhookChannelsSection.Model.swift.
//

import Foundation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there.
public protocol WebhookChannelsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogWebhookChannelsTelemetry: WebhookChannelsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "WebhookChannelsSection" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; the
/// per-surface table keeps each parallel surface prompt self-contained.
public enum WebhookStrings {
    public static let table = "WebhookChannelsSection"

    /// The localized string for `key`, falling back to the web English `value`.
    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// A `Text` resolved by key (verbatim so the resolved value is not re-interpreted
    /// as a SwiftUI format string).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolves `key` then substitutes each `{{token}}` (web i18next interpolation),
    /// e.g. `interpolate("…status", "Status {{status}}", ["status": "200"])`.
    public static func interpolate(
        _ key: String,
        _ fallback: String,
        _ replacements: [String: String]
    ) -> String {
        var result = string(key, fallback)
        for (token, value) in replacements {
            result = result.replacingOccurrences(of: "{{\(token)}}", with: value)
        }
        return result
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `WebhookChannelsSource`: the channel list +
/// its load status + the live-state connection + the last-update timestamp. The
/// model sorts the list and resolves the render phase + freshness from it.
public struct WebhookChannelsUpdate: Sendable, Equatable {
    public var status: WebhookLoadStatus
    public var channels: [WebhookChannel]
    public var connection: WebhookConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: WebhookLoadStatus = .loading,
        channels: [WebhookChannel] = [],
        connection: WebhookConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.channels = channels
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 notification-channel state holders (the `useWebhookChannels` query +
/// the save / delete / toggle / test mutations + the signature-preview utility);
/// previews + tests use `InMemoryWebhookChannelsSource`. The view never talks to the
/// network — every action returns through a `@MainActor` completion.
@MainActor
public protocol WebhookChannelsSource: AnyObject {
    var onUpdate: (@MainActor (WebhookChannelsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web refetch / the stale auto-refresh).
    func refresh()
    /// Creates or updates a channel (web `useSaveChannel`). Completes with `.success`
    /// when the channel cache is invalidated, or `.failure(message)` to surface in
    /// the form (web `onError`).
    func save(
        _ request: WebhookSaveRequest,
        completion: @escaping @MainActor (Result<Void, WebhookActionError>) -> Void
    )
    /// Permanently removes a channel (web `useDeleteChannel`).
    func delete(_ channelID: Int, completion: @escaping @MainActor (Result<Void, WebhookActionError>) -> Void)
    /// Flips a channel's enabled flag (web `useToggleChannel`). The resulting list is
    /// re-pushed through `onUpdate`.
    func toggle(_ channelID: Int)
    /// Fires a structured test event (web `useTestWebhookChannel`); always completes
    /// with a `WebhookTestOutcome` (success or structured/transport failure).
    func test(_ channelID: Int, completion: @escaping @MainActor (WebhookTestOutcome) -> Void)
    /// Computes the HMAC signature preview for a `(secret, body)` pair (web
    /// `useWebhookSignaturePreview`). Empty secret is guarded by the caller.
    func previewSignature(
        secret: String,
        body: String,
        completion: @escaping @MainActor (Result<String, WebhookActionError>) -> Void
    )
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()`, serves canned test outcomes + a canned signature, and records the
/// actions it received so tests can assert the model delegated correctly.
@MainActor
public final class InMemoryWebhookChannelsSource: WebhookChannelsSource {
    public var onUpdate: (@MainActor (WebhookChannelsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var savedRequests: [WebhookSaveRequest] = []
    public private(set) var deletedIDs: [Int] = []
    public private(set) var toggledIDs: [Int] = []
    public private(set) var testedIDs: [Int] = []
    public private(set) var previewedSecrets: [String] = []

    private let initial: WebhookChannelsUpdate?
    private let cannedTest: WebhookTestOutcome
    private let cannedSignature: Result<String, WebhookActionError>
    private let saveResult: Result<Void, WebhookActionError>
    private let deleteResult: Result<Void, WebhookActionError>
    private let autoRespond: Bool

    public init(
        initial: WebhookChannelsUpdate? = nil,
        cannedTest: WebhookTestOutcome = WebhookTestOutcome(success: true, statusCode: 200, latencyMs: 42),
        cannedSignature: Result<String, WebhookActionError> = .success("sha256=preview"),
        saveResult: Result<Void, WebhookActionError> = .success(()),
        deleteResult: Result<Void, WebhookActionError> = .success(()),
        autoRespond: Bool = true
    ) {
        self.initial = initial
        self.cannedTest = cannedTest
        self.cannedSignature = cannedSignature
        self.saveResult = saveResult
        self.deleteResult = deleteResult
        self.autoRespond = autoRespond
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

    public func save(
        _ request: WebhookSaveRequest,
        completion: @escaping @MainActor (Result<Void, WebhookActionError>) -> Void
    ) {
        savedRequests.append(request)
        if autoRespond { completion(saveResult) }
    }

    public func delete(_ channelID: Int, completion: @escaping @MainActor (Result<Void, WebhookActionError>) -> Void) {
        deletedIDs.append(channelID)
        if autoRespond { completion(deleteResult) }
    }

    public func toggle(_ channelID: Int) {
        toggledIDs.append(channelID)
    }

    public func test(_ channelID: Int, completion: @escaping @MainActor (WebhookTestOutcome) -> Void) {
        testedIDs.append(channelID)
        if autoRespond { completion(cannedTest) }
    }

    public func previewSignature(
        secret: String,
        body _: String,
        completion: @escaping @MainActor (Result<String, WebhookActionError>) -> Void
    ) {
        previewedSecrets.append(secret)
        if autoRespond { completion(cannedSignature) }
    }

    /// Pushes a query snapshot to the bound model (test / preview affordance).
    public func push(_ update: WebhookChannelsUpdate) {
        onUpdate?(update)
    }
}
