//
//  FeedbackModal.Seams.swift
//  TeslaSync — P4 modal/dialog · 0004 · FeedbackModal (Apple)
//
//  The dependency seams the FeedbackModal view-model binds through, kept apart from the model for the
//  lint length budget: the P1/S11 telemetry contract (`view.opened`), the async submit control seam
//  (web `useSubmitFeedback().mutateAsync`), the coalesced source snapshot, the P1/S8 source protocol
//  that resolves the auto-attached diagnostics context + freshness, the in-memory source for
//  previews/tests, the P1/S10 i18n facade (web `useTranslation`), and the VoiceOver string builders.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted there.
public protocol FeedbackTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogFeedbackTelemetry: FeedbackTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Submit control seam (web `useSubmitFeedback`)

/// The error surfaced when a submission fails — the native parity of the web mutation's `onError`
/// (the modal renders the inline "Failed to submit feedback" alert; the toast is the app's concern).
public struct FeedbackSubmitError: Error, Sendable, Equatable {
    public let message: String

    public init(message: String) {
        self.message = message
    }
}

/// The dialog's submit seam — the native parity of `useSubmitFeedback().mutateAsync(payload)`. Keeps
/// the network client out of the view; the production app injects an adapter that drives the real
/// `POST /feedback` mutation, previews use a silent default, tests use a configurable spy.
public protocol FeedbackSubmitting: Sendable {
    /// Submits the feedback. Throws `FeedbackSubmitError` (or any `Error`) on failure so the model can
    /// surface the inline error and keep the form open (web `catch`).
    func submit(_ submission: FeedbackSubmission) async throws
}

/// `os.Logger`-backed default that records the submit intent without performing a network call, so
/// previews run safely.
public struct OSLogFeedbackSubmitter: FeedbackSubmitting {
    private let logger: Logger
    private let surface = FeedbackSurface.slug

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "feedback")
    }

    public func submit(_ submission: FeedbackSubmission) async throws {
        let category = submission.category.rawValue
        logger.info("feedback.submit category=\(category, privacy: .public) surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `FeedbackContextSource`: the load status, the resolved
/// diagnostics context (route + app version + client identity + captured errors + console tail), the
/// live-state freshness, and the in-flight flag.
public struct FeedbackContextUpdate: Sendable, Equatable {
    public var status: FeedbackContextStatus
    public var context: FeedbackContext?
    public var connection: FeedbackConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: FeedbackContextStatus = .loading,
        context: FeedbackContext? = nil,
        connection: FeedbackConnection = .live,
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
/// resolving the auto-attached context (the current route, the bundle app version, the device/OS
/// client-identity string, the captured-error ring, and the recent log tail) and the live-state
/// freshness, plus a refresh affordance. Previews/tests use `InMemoryFeedbackContextSource`. The view
/// never reads diagnostics directly.
@MainActor
public protocol FeedbackContextSource: AnyObject {
    var onUpdate: (@MainActor (FeedbackContextUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-resolves the diagnostics context + freshness (web refetch / the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryFeedbackContextSource: FeedbackContextSource {
    public var onUpdate: (@MainActor (FeedbackContextUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: FeedbackContextUpdate?

    public init(initial: FeedbackContextUpdate? = nil) {
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
    public func push(_ update: FeedbackContextUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "FeedbackModal" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings.
public enum FeedbackStrings {
    public static let table = "FeedbackModal"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// `string(_:_:)` with a single `{{0}}` token substituted (web i18next interpolation), used
    /// for the validation messages that embed the character bound.
    public static func string(_ key: String, _ fallback: String, count: Int) -> String {
        string(key, fallback).replacingOccurrences(of: "{{0}}", with: String(count))
    }

    /// `string(_:_:)` with the `{{count}}` token substituted (web `includeErrors` label).
    public static func string(_ key: String, _ fallback: String, errorCount: Int) -> String {
        string(key, fallback).replacingOccurrences(of: "{{count}}", with: String(errorCount))
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the
/// summaries are testable without a bundle.
public enum FeedbackAccessibility {
    /// The dialog summary: the modal title (web `Modal` `aria-labelledby` heading).
    public static func summary(localize: (String, String) -> String) -> String {
        localize("feedback.title", "Report a bug / Send feedback")
    }

    /// One auto-context row's VoiceOver label ("<label>: <value>"), substituting the resolved value.
    public static func contextRowLabel(label: String, value: String) -> String {
        "\(label): \(value)"
    }

    /// The submit button's VoiceOver label, reflecting the in-flight state (web label swap).
    public static func submitLabel(submitting: Bool, localize: (String, String) -> String) -> String {
        submitting
            ? localize("feedback.form.submitting", "Submitting…")
            : localize("feedback.form.submit", "Send feedback")
    }
}
