//
//  ReauthDialog.Seams.swift
//  TeslaSync — P4 modal/dialog · 0007 · ReauthDialog (Apple)
//
//  The dependency seams the ReauthDialog view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S11 telemetry contract, the credential-exchange service (web
//  `onSubmitCredential` — the POST /auth/reauth | /auth/totp/sudo network call), the queue-completion
//  control seam (web `onSubmit` → `resolveActive` / `onCancel` → `rejectActive`), the coalesced source
//  snapshot, the P1/S8 source protocol, the in-memory source for previews/tests, the P1/S10 i18n
//  facade (web `useTranslation`), and the VoiceOver string builders. No view reads HTTP or persistence
//  directly — it only ever talks to these seams.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared core `Telemetry.track(.screenView
/// (screen:…))` (ADR-016), consent-gated + redacted there.
public protocol ReauthTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogReauthTelemetry: ReauthTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Credential-exchange service (web `onSubmitCredential`)

/// The network seam for exchanging a credential for a sudo token — the native parity of the web
/// `onSubmitCredential` (POST /auth/reauth for password / shared-secret TOTP, POST /auth/totp/sudo for
/// per-user TOTP). Kept off the view so no HTTP lives in SwiftUI; the production app injects an adapter
/// over the resilient API client, previews/tests use the logging / spy defaults. A throw maps to
/// `.failure(code:message:)` so the model's existing error branch fires.
public protocol ReauthCredentialService: Sendable {
    func submit(_ body: ReauthSubmitBody) async -> ReauthSubmitOutcome
}

/// `os.Logger`-backed default that performs no network and reports "not configured", so previews never
/// hit a server. The production app injects the real adapter.
public struct OSLogReauthCredentialService: ReauthCredentialService {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "reauth")
    }

    public func submit(_ body: ReauthSubmitBody) async -> ReauthSubmitOutcome {
        let method = body.totpCode != nil ? "totp" : "password"
        logger.info("reauth.submit method=\(method, privacy: .public) (no service wired)")
        return .failure(code: ReauthErrorCode.notConfigured, message: "")
    }
}

// MARK: - Completion control seam (web `onSubmit` / `onCancel`)

/// The dialog's queue-completion seam. `complete` is the web `onSubmit(cred)` (the `request()` client
/// resolves the gated mutation with the minted credential); `cancel` is the web `onCancel` (rejects
/// with a `SudoCanceledError` the caller treats as a no-op). Keeps the challenge queue out of the view;
/// the production app injects an adapter that drives the real sudo queue, previews/tests use the
/// logging / spy defaults.
public protocol ReauthController: Sendable {
    func complete(_ credential: ReauthCredential)
    func cancel()
}

/// `os.Logger`-backed default that records the intents without touching a queue, so previews run
/// safely.
public struct OSLogReauthController: ReauthController {
    private let logger: Logger
    private let surface = ReauthSurface.slug

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "reauth")
    }

    public func complete(_ credential: ReauthCredential) {
        let mode = credential.mode.rawValue
        logger.info("reauth.complete mode=\(mode, privacy: .public) surface=\(surface, privacy: .public)")
    }

    public func cancel() {
        logger.info("reauth.cancel surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `ReauthChallengeSource`: the load status, the resolved challenge
/// context (the active path + auth mode + TOTP tab availability), the live-state freshness, and the
/// in-flight flag.
public struct ReauthChallengeUpdate: Sendable, Equatable {
    public var status: ReauthLoadStatus
    public var context: ReauthChallengeContext?
    public var connection: ReauthConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: ReauthLoadStatus = .loading,
        context: ReauthChallengeContext? = nil,
        connection: ReauthConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.context = context
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state holders —
/// composing the active sudo challenge (web `useReauthDialogState`), the resolved auth mode (web
/// `useSessionMonitor`), and the TOTP tab availability (web `useTOTPStatus`) into one context, plus the
/// live-state freshness and a refresh affordance. Previews/tests use `InMemoryReauthChallengeSource`.
@MainActor
public protocol ReauthChallengeSource: AnyObject {
    var onUpdate: (@MainActor (ReauthChallengeUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-resolves the challenge context + freshness (web refetch / the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryReauthChallengeSource: ReauthChallengeSource {
    public var onUpdate: (@MainActor (ReauthChallengeUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ReauthChallengeUpdate?

    public init(initial: ReauthChallengeUpdate? = nil) {
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
    public func push(_ update: ReauthChallengeUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "ReauthDialog" table, folded into the app `Localizable.xcstrings` catalog
/// at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum ReauthStrings {
    public static let table = "ReauthDialog"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum ReauthAccessibility {
    /// The dialog summary: the modal title for the resolved mode (web `aria-labelledby` heading).
    public static func summary(mode: ReauthMode, localize: (String, String) -> String) -> String {
        ReauthProjection.title(mode: mode, localize: localize)
    }

    /// One method tab's VoiceOver label, with the selected state appended so the tab reads its status
    /// (web tab `aria-selected`).
    public static func methodTabLabel(
        _ method: ReauthMethod,
        selected: Bool,
        localize: (String, String) -> String
    ) -> String {
        let name = ReauthProjection.methodLabel(method, localize: localize)
        guard selected else { return name }
        let selectedWord = localize("sudo.a11y.selected", "selected")
        return "\(name), \(selectedWord)"
    }

    /// The close affordance's VoiceOver label (web `Modal` "×").
    public static func closeLabel(localize: (String, String) -> String) -> String {
        localize("sudo.a11y.close", "Close")
    }
}
