//
//  AcknowledgeAlertDialog.Seams.swift
//  TeslaSync — P4 modal/dialog · 0017 · AcknowledgeAlertDialog (Apple)
//
//  The dependency seams the AcknowledgeAlertDialog view-model binds through, kept apart from the model
//  for the lint length budget: the P1/S11 telemetry contract, the acknowledge service (web
//  `onSubmit(note)` — the gated POST the parent fires), the dismissal control seam (web `onSubmit`
//  success / `onClose`), the coalesced alert snapshot, the P1/S8 source protocol, the in-memory source
//  for previews/tests, the P1/S10 i18n facade (web `useTranslation`), and the VoiceOver string builders.
//  No view reads HTTP or persistence directly — it only ever talks to these seams.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared core `Telemetry.track(.screenView
/// (screen:…))` (ADR-016), consent-gated + redacted there.
public protocol AckAlertTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogAckAlertTelemetry: AckAlertTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Acknowledge service (web `onSubmit`)

/// The seam that records the acknowledgement — the native parity of the web `onSubmit(note)`, which the
/// parent page wires to the gated `PATCH /alerts/{id}` mutation. Kept off the view so no HTTP lives in
/// SwiftUI; the production app injects an adapter over the resilient API client, previews/tests use the
/// logging / spy defaults. A thrown/rejected mutation maps to `.failure(message:)` so the model's inline
/// error branch fires (web parity: the parent surfaces the failure; the native client shows it inline).
public protocol AckAlertService: Sendable {
    func acknowledge(_ body: AckAlertSubmitBody) async -> AckAlertSubmitOutcome
}

/// `os.Logger`-backed default that performs no network and reports success, so previews resolve without
/// a server. The production app injects the real adapter.
public struct OSLogAckAlertService: AckAlertService {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "alerts")
    }

    public func acknowledge(_ body: AckAlertSubmitBody) async -> AckAlertSubmitOutcome {
        logger.info("alerts.ack noteLength=\(body.note.count, privacy: .public) (no service wired)")
        return .success
    }
}

// MARK: - Dismissal control seam (web `onSubmit` success / `onClose`)

/// The dialog's dismissal seam. `complete` is the web post-`onSubmit` close (the parent acknowledges,
/// then closes the dialog and shows its toast/undo); `cancel` is the web `onClose` (close with no
/// mutation). Keeps the presenting host out of the view; the production app injects an adapter that
/// drives the real navigation, previews/tests use the logging / spy defaults.
public protocol AckAlertController: Sendable {
    func complete()
    func cancel()
}

/// `os.Logger`-backed default that records the intents without touching navigation, so previews run
/// safely.
public struct OSLogAckAlertController: AckAlertController {
    private let logger: Logger
    private let surface = AckAlertSurface.slug

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "alerts")
    }

    public func complete() {
        logger.info("alerts.ack.complete surface=\(surface, privacy: .public)")
    }

    public func cancel() {
        logger.info("alerts.ack.cancel surface=\(surface, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by an `AckAlertSource`: the load status, the resolved alert context
/// (the target row + its optional title), the live-state freshness, and the in-flight flag.
public struct AckAlertUpdate: Sendable, Equatable {
    public var status: AckAlertLoadStatus
    public var context: AckAlertContext?
    public var connection: AckAlertConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: AckAlertLoadStatus = .loading,
        context: AckAlertContext? = nil,
        connection: AckAlertConnection = .live,
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
/// resolving the alert row that opened the dialog (web `alertTitle` + id) plus the live-state freshness
/// and a refresh affordance. Previews/tests use `InMemoryAckAlertSource`.
@MainActor
public protocol AckAlertSource: AnyObject {
    var onUpdate: (@MainActor (AckAlertUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-resolves the alert context + freshness (web refetch / the stale auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and lets
/// a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryAckAlertSource: AckAlertSource {
    public var onUpdate: (@MainActor (AckAlertUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AckAlertUpdate?

    public init(initial: AckAlertUpdate? = nil) {
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
    public func push(_ update: AckAlertUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "AcknowledgeAlertDialog" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum AckAlertStrings {
    public static let table = "AcknowledgeAlertDialog"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected localizer so the summaries
/// are testable without a bundle.
public enum AckAlertAccessibility {
    /// The dialog summary: the modal title, with the alert title appended for context when present (web
    /// `aria-labelledby` heading + the subtitle line).
    public static func summary(title: String?, localize: (String, String) -> String) -> String {
        let dialogTitle = AckAlertProjection.dialogTitle(localize: localize)
        guard let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return dialogTitle
        }
        return "\(dialogTitle), \(title)"
    }

    /// The close affordance's VoiceOver label (web `Modal` "×").
    public static func closeLabel(localize: (String, String) -> String) -> String {
        localize("alerts.ack.a11y.close", "Close")
    }

    /// The note field's VoiceOver value: the live character count toward the limit, so the field reads
    /// its remaining budget (web `aria-describedby` hint widened for VoiceOver).
    public static func noteCountLabel(note: String, localize: (String, String) -> String) -> String {
        let template = localize("alerts.ack.a11y.count", "{{count}} of {{max}} characters")
        return template
            .replacingOccurrences(of: "{{count}}", with: String(AckAlertProjection.length(note)))
            .replacingOccurrences(of: "{{max}}", with: String(AckAlertProjection.noteMaxLength))
    }
}
