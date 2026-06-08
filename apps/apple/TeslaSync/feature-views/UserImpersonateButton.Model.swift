//
//  UserImpersonateButton.Model.swift
//  TeslaSync — P4 feature view · 0050 · UserImpersonateButton (Apple)
//
//  State-holder seams (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) for
//  the admin "Impersonate" control — the SwiftUI parity of
//  features/admin/components/UserImpersonateButton.tsx. The web component binds
//  `useStartImpersonation` (the start mutation) and is gated by the parent's
//  `useImpersonationStatus` / `useImpersonation`. The native surface binds both
//  through seams so the view performs no I/O: a status provider (gate + freshness)
//  and a start mutation. The view binds through `UserImpersonateButtonModel`.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable telemetry slug for the diagnostics `view.opened` event.
public enum UserImpersonateButtonSurface {
    public static let slug = "UserImpersonateButton"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the diagnostics `view.opened` event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared
/// core diagnostics pipeline (consent-gated + redacted there).
public protocol UserImpersonateButtonTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogUserImpersonateButtonTelemetry: UserImpersonateButtonTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Status seam (P1/S8 — web `useImpersonationStatus` / `useImpersonation`)

/// A status update delivered by the gating seam, mirroring the web query lifecycle
/// plus the transport-failure `offline` the native app surfaces so the last known
/// status can stay visible behind an offline chip.
public enum ImpersonationStatusEvent: Sendable, Equatable {
    case loading
    case loaded(ImpersonationStatus)
    case empty
    case failed(message: String)
    case offline(message: String)
}

/// The seam the view's model binds through for the gating status. The production
/// app implements this over the shared P1/S8 impersonation-status holder; previews
/// and tests inject `InMemoryImpersonationStatusProvider`. No I/O in the view.
@MainActor
public protocol ImpersonationStatusProviding: AnyObject {
    var onStatus: (@MainActor (ImpersonationStatusEvent) -> Void)? { get set }
    /// Begins the initial status load (web query mount).
    func load()
    /// Re-fetches the status (retry / freshness auto-refresh).
    func refresh()
}

// MARK: - Start seam (P1/S8 — web `useStartImpersonation`)

/// The settled outcome of the start mutation (web `startMut`), mirroring the shapes
/// the request collapses to: a started session, a server/validation error, and the
/// transport failure the native app surfaces as `offline`.
public enum ImpersonationStartOutcome: Sendable, Equatable {
    case started
    case failed(message: String)
    case offline(message: String)
}

/// The seam the model fires the confirmed start through (web
/// `startMut.mutate({ subject })`). The production app implements this over the
/// shared P1/S8 start-impersonation mutation holder (which is sudo-gated upstream);
/// previews and tests inject `InMemoryImpersonationStarter`.
@MainActor
public protocol ImpersonationStarting: AnyObject {
    var onStartOutcome: (@MainActor (ImpersonationStartOutcome) -> Void)? { get set }
    func start(subject: String)
}

// MARK: - View model

/// The surface's observable view-model. Owns the confirm-then-start flow (web
/// `useState(open)` + `ConfirmDialog`), the start lifecycle (web mutation status),
/// the gating availability projection, and the freshness (stale / offline) layered
/// on top so SwiftUI can render every state. No networking lives here — outcomes
/// arrive through the injected seams.
@MainActor
@Observable
public final class UserImpersonateButtonModel {
    /// The start lifecycle, mirroring the web mutation status.
    public enum ActionPhase: Equatable, Sendable {
        case idle
        case starting
        case started
        case failed(message: String)
    }

    /// The opaque proxy-issued subject to impersonate (web `props.subject`).
    public let subject: String
    /// The parent-owned disable decision (web `props.disabled`).
    public let disabledByParent: Bool

    public private(set) var statusPhase: ImpersonationStatusPhase = .loading
    public private(set) var actionPhase: ActionPhase = .idle
    public private(set) var isConfirmPresented = false
    public private(set) var lastStatusAt: Date?
    public private(set) var isOffline = false

    @ObservationIgnored private let statusProvider: any ImpersonationStatusProviding
    @ObservationIgnored private let starter: any ImpersonationStarting
    @ObservationIgnored private let telemetry: any UserImpersonateButtonTelemetry
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let stalenessWindow: TimeInterval
    @ObservationIgnored private let onStarted: (@MainActor (String) -> Void)?
    @ObservationIgnored private var didStart = false

    public init(
        subject: String,
        disabledByParent: Bool = false,
        statusProvider: any ImpersonationStatusProviding,
        starter: any ImpersonationStarting,
        telemetry: any UserImpersonateButtonTelemetry = OSLogUserImpersonateButtonTelemetry(),
        now: @escaping @Sendable () -> Date = { Date() },
        stalenessWindow: TimeInterval = 60,
        onStarted: (@MainActor (String) -> Void)? = nil
    ) {
        self.subject = subject
        self.disabledByParent = disabledByParent
        self.statusProvider = statusProvider
        self.starter = starter
        self.telemetry = telemetry
        self.now = now
        self.stalenessWindow = stalenessWindow
        self.onStarted = onStarted
        statusProvider.onStatus = { [weak self] event in self?.applyStatus(event) }
        starter.onStartOutcome = { [weak self] outcome in self?.applyStart(outcome) }
    }

    // MARK: Derived projections

    /// Whether the displayed status is older than the freshness window. Only a
    /// loaded status that is online can go stale.
    public var isStale: Bool {
        guard !isOffline, case .loaded = statusPhase, let lastStatusAt else { return false }
        return now().timeIntervalSince(lastStatusAt) > stalenessWindow
    }

    /// Freshness/connectivity projection (mirrors `LiveConnectionState`, ADR-013).
    public var connection: ImpersonationConnection {
        if isOffline { return .offline }
        if isStale { return .stale }
        return .live
    }

    /// The availability gate for the loaded status (web parent gate + `disabled`).
    /// `nil` until a status has loaded.
    public var availability: ImpersonationAvailability? {
        guard let status = statusPhase.status else { return nil }
        return ImpersonationAvailability.project(status: status, disabledByParent: disabledByParent)
    }

    /// Whether a confirm-then-start flow may begin right now (web `!disabled &&
    /// !isPending`), additionally gated on connectivity since the start is a
    /// network mutation.
    public var canStart: Bool {
        guard !isOffline, actionPhase != .starting else { return false }
        return availability?.canStart ?? false
    }

    /// Whether the action button is rendered disabled (web `disabled || isPending`).
    public var isButtonDisabled: Bool {
        !canStart
    }

    /// The current button label (web `isPending ? 'Starting…' : 'Impersonate'`).
    public var buttonLabel: ImpersonateButtonLabel {
        ImpersonateButtonLabel.project(isStarting: actionPhase == .starting)
    }

    // MARK: Lifecycle

    /// Emits the diagnostics `view.opened` event once and kicks off the initial
    /// status load. Idempotent (web query mount + effect).
    public func start() {
        guard !didStart else { return }
        didStart = true
        telemetry.viewOpened(surface: UserImpersonateButtonSurface.slug)
        statusProvider.load()
    }

    /// Re-fetches the gating status (web query retry / refetch).
    public func retryStatus() {
        statusPhase = .loading
        statusProvider.refresh()
    }

    // MARK: Confirm-then-start flow (web `open` state + `ConfirmDialog`)

    /// Opens the confirmation dialog (web `handleClick` → `setOpen(true)`). A no-op
    /// when the row cannot start a session, mirroring the web early return.
    public func requestStart() {
        guard canStart else { return }
        isConfirmPresented = true
    }

    /// Confirms the dialog and fires the start mutation (web `handleConfirm` →
    /// `setOpen(false)` + `startMut.mutate({ subject })`). Re-entrancy guarded.
    public func confirmStart() {
        guard actionPhase != .starting else { return }
        isConfirmPresented = false
        actionPhase = .starting
        starter.start(subject: subject)
    }

    /// Dismisses the dialog without starting (web `onCancel` → `setOpen(false)`).
    public func cancelStart() {
        isConfirmPresented = false
    }

    /// Retries a failed start by re-opening the confirmation (web would re-click).
    public func retryStart() {
        guard actionPhase != .starting else { return }
        actionPhase = .idle
        requestStart()
    }

    // MARK: Seam handlers

    private func applyStatus(_ event: ImpersonationStatusEvent) {
        switch event {
        case .loading:
            statusPhase = .loading
        case let .loaded(status):
            statusPhase = .loaded(status)
            lastStatusAt = now()
            isOffline = false
        case .empty:
            statusPhase = .empty
            lastStatusAt = now()
            isOffline = false
        case let .failed(message):
            statusPhase = .failed(message: message)
            isOffline = false
        case .offline:
            // Keep the last loaded status visible behind the offline chip; only
            // fall through to an offline-empty render when nothing was cached.
            isOffline = true
        }
    }

    private func applyStart(_ outcome: ImpersonationStartOutcome) {
        switch outcome {
        case .started:
            actionPhase = .started
            isOffline = false
            onStarted?(subject)
        case let .failed(message):
            actionPhase = .failed(message: message)
            isOffline = false
        case .offline:
            // Revert the in-flight start and surface the offline chip; the cached
            // status stays so the row can retry once connectivity returns.
            isOffline = true
            actionPhase = .idle
        }
    }
}

// MARK: - In-memory seams (previews + tests; the view never performs I/O)

/// Deterministic status provider for previews and unit/UI tests. Emits an optional
/// canned event on `load()` (when `autoEmits`), or is driven manually via `push(_:)`
/// to script multi-step flows (e.g. loaded → offline).
@MainActor
public final class InMemoryImpersonationStatusProvider: ImpersonationStatusProviding {
    public var onStatus: (@MainActor (ImpersonationStatusEvent) -> Void)?
    public private(set) var loadCount = 0
    public private(set) var refreshCount = 0

    private let initial: ImpersonationStatusEvent?
    private let refreshed: ImpersonationStatusEvent?
    private let autoEmits: Bool

    public init(
        initial: ImpersonationStatusEvent? = nil,
        refreshed: ImpersonationStatusEvent? = nil,
        autoEmits: Bool = true
    ) {
        self.initial = initial
        self.refreshed = refreshed
        self.autoEmits = autoEmits
    }

    public func load() {
        loadCount += 1
        if autoEmits, let initial {
            onStatus?(initial)
        }
    }

    public func refresh() {
        refreshCount += 1
        if autoEmits, let event = refreshed ?? initial {
            onStatus?(event)
        }
    }

    /// Delivers a status event to the bound model (deterministic test affordance).
    public func push(_ event: ImpersonationStatusEvent) {
        onStatus?(event)
    }
}

/// Deterministic start mutation for previews and unit/UI tests. Delivers an optional
/// canned outcome synchronously on `start(subject:)` (when `autoResponds`), or is
/// driven manually via `push(_:)`.
@MainActor
public final class InMemoryImpersonationStarter: ImpersonationStarting {
    public var onStartOutcome: (@MainActor (ImpersonationStartOutcome) -> Void)?
    public private(set) var startCount = 0
    public private(set) var lastSubject: String?

    private let outcome: ImpersonationStartOutcome?
    private let autoResponds: Bool

    public init(outcome: ImpersonationStartOutcome? = nil, autoResponds: Bool = true) {
        self.outcome = outcome
        self.autoResponds = autoResponds
    }

    public func start(subject: String) {
        startCount += 1
        lastSubject = subject
        if autoResponds, let outcome {
            onStartOutcome?(outcome)
        }
    }

    /// Delivers a start outcome to the bound model (deterministic test affordance).
    public func push(_ outcome: ImpersonationStartOutcome) {
        onStartOutcome?(outcome)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default[, { subject }])`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "UserImpersonateButton" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time. The web
/// source keys (`impersonation.button.*`, `impersonation.confirm.*`) are preserved
/// verbatim so a shared catalog resolves identically across web and native.
public enum UserImpersonateButtonStrings {
    public static let table = "UserImpersonateButton"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-interpolated string (web i18next `{{subject}}`).
    public static func format(_ key: String, _ fallbackFormat: String, _ argument: String) -> String {
        String(format: string(key, fallbackFormat), argument)
    }
}
