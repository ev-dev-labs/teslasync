//
//  TeslaAuthCard.Model.swift
//  TeslaSync — P4 feature view · 0258 · TeslaAuthCard (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  Tesla-auth status card. The web source is a pure presentational component fed three props
//  (`authenticated`, `expiresAt`, `now`) by the page; there is no hook. The native surface keeps the
//  same shape: the page composes a `TeslaAuthSource` over the shared auth-status holder + the
//  page-level clock tick and pushes `TeslaAuthInput` snapshots; the view binds through
//  `TeslaAuthModel` and never touches the network.
//
//  States (every one renders — no hidden surface): loading (skeleton chrome, initial fetch), empty
//  (web 'unknown' — resolved but no concrete auth value, a friendly never-blank card), error
//  (retryable "couldn't load"), data (the four concrete severities: connected / expiring / expired /
//  disconnected). The orthogonal connection axis (live / stale / offline) drives a freshness chip +
//  banner with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the Swift sources hold no
/// hardcoded prose. Keys live in the "TeslaAuthCard" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. In tests / preview bundles (where the table
/// is absent) `NSLocalizedString` returns the `value:` fallback, keeping the projection deterministic.
public enum TeslaAuthStrings {
    public static let table = "TeslaAuthCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-templated key and substitutes the positional arguments. The template is
    /// localized first, so translators control word order around the (locale-formatted) numbers.
    public static func format(_ key: String, _ fallback: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallback), arguments: args)
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the header chip +
/// banner. `live` hides the banner; `stale` / `offline` show it.
public enum TeslaAuthConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there).
public protocol TeslaAuthTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
/// The slug is a static, non-identifying constant.
public struct OSLogTeslaAuthTelemetry: TeslaAuthTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (web props + P4 leaf axes)

/// One coalesced snapshot of the card's inputs — the native mirror of the web props
/// (`authenticated`, `expiresAt`, `now`) plus the P4 leaf loading / error / connectivity axes.
/// `expiresAtRaw` is carried as the raw ISO string so the projection reproduces the web's
/// missing-vs-unparseable distinction.
public struct TeslaAuthInput: Sendable, Equatable {
    public var authenticated: Bool?
    public var expiresAtRaw: String?
    public var now: Date
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: TeslaAuthConnection

    public init(
        authenticated: Bool? = nil,
        expiresAtRaw: String? = nil,
        now: Date = Date(),
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: TeslaAuthConnection = .live
    ) {
        self.authenticated = authenticated
        self.expiresAtRaw = expiresAtRaw
        self.now = now
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Presentation (resolved card content for empty + data phases)

/// The resolved, view-ready card content — the native mirror of the web render (accent + shield +
/// badge + detail + CTA). Every field is pre-localized + pre-formatted so the view is a pure
/// function of this value. Shared by the `empty` (unknown) and `data` (concrete) phases.
public struct TeslaAuthPresentation: Sendable, Equatable {
    public let severity: TeslaAuthSeverity
    public let accent: TeslaAuthTone.Accent
    public let symbol: String
    public let badgeLabel: String
    public let detail: String
    public let ctaLabel: String
    public let isReauthenticate: Bool
    public let accessibilitySummary: String

    public init(
        severity: TeslaAuthSeverity,
        accent: TeslaAuthTone.Accent,
        symbol: String,
        badgeLabel: String,
        detail: String,
        ctaLabel: String,
        isReauthenticate: Bool,
        accessibilitySummary: String
    ) {
        self.severity = severity
        self.accent = accent
        self.symbol = symbol
        self.badgeLabel = badgeLabel
        self.detail = detail
        self.ctaLabel = ctaLabel
        self.isReauthenticate = isReauthenticate
        self.accessibilitySummary = accessibilitySummary
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved render branch. `loading` / `error` are the P4 leaf chrome; `empty` carries the web
/// 'unknown' card (resolved but no concrete value, never blank); `data` carries the four concrete
/// severities. Both content phases hold a fully resolved `TeslaAuthPresentation`.
public struct TeslaAuthResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case error(String)
        case empty(TeslaAuthPresentation)
        case data(TeslaAuthPresentation)
    }

    public let phase: Phase

    public init(phase: Phase) {
        self.phase = phase
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the auth-status holder
/// composed with the page-level clock + live-state holder; previews and tests use
/// `InMemoryTeslaAuthSource`. The view never talks to the network.
@MainActor
public protocol TeslaAuthSource: AnyObject {
    var onUpdate: (@MainActor (TeslaAuthInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The card's observable view-model. Subscribes to a `TeslaAuthSource`, recomputes the resolved
/// projection, exposes the render `phase` + the resolved presentation + the `connection` axis, emits
/// `view.opened` once on first presentation, and auto-refreshes once when the feed transitions to
/// stale.
@MainActor
@Observable
public final class TeslaAuthModel {
    public private(set) var resolved: TeslaAuthResolved =
        TeslaAuthProjection.resolve(TeslaAuthInput(isLoading: true))
    public private(set) var connection: TeslaAuthConnection = .live

    public var phase: TeslaAuthResolved.Phase {
        resolved.phase
    }

    /// The resolved card content for the content phases (empty / data); `nil` while loading or in
    /// the error state — drives the accent bar tone in the view.
    public var presentation: TeslaAuthPresentation? {
        switch resolved.phase {
        case let .data(value), let .empty(value):
            value
        default:
            nil
        }
    }

    @ObservationIgnored private let source: any TeslaAuthSource
    @ObservationIgnored private let telemetry: any TeslaAuthTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any TeslaAuthSource,
        telemetry: any TeslaAuthTelemetry = OSLogTeslaAuthTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the upstream feed. Idempotent. `view.opened` is emitted on the first applied
    /// snapshot so the event fires exactly once the surface is actually presented.
    public func start() {
        guard !started else { return }
        started = true
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: TeslaAuthInput) {
        resolved = TeslaAuthProjection.resolve(input, locale: locale)
        connection = input.connection
        maybeEmitOpen()
        handleAutoRefresh(for: input.connection)
    }

    private func maybeEmitOpen() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: TeslaAuthCard.surfaceSlug)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for connection: TeslaAuthConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryTeslaAuthSource: TeslaAuthSource {
    public var onUpdate: (@MainActor (TeslaAuthInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TeslaAuthInput?

    public init(initial: TeslaAuthInput? = nil) {
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

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: TeslaAuthInput) {
        onUpdate?(input)
    }
}
