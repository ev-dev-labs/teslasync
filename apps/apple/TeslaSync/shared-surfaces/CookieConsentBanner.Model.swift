//
//  CookieConsentBanner.Model.swift
//  TeslaSync — P4 shared surface · 0115 · CookieConsentBanner (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), the input
//  snapshot, the resolved view-state, the pure projection, and the observable view-model for the
//  cookie / GDPR consent banner. The view binds through `CookieConsentModel`; no networking lives in
//  the view. The web component reads three things: the deployment consent policy
//  (`useVersionInfo().require_cookie_consent`), the tri-state cookie consent (`lib/cookieConsent`), and
//  pushes the policy flag into two optional reporters (`setVitalsConsentRequirement` /
//  `setErrorReporterConsentRequirement`). The native model keeps the same contract: a policy source +
//  a decision store feed the model, it derives the visibility (the web `return null` guard) + the P4
//  freshness chip, mirrors the policy flag into the reporter sink on every change, and forwards the
//  Accept / Decline choices to the store.
//

import Foundation
import Observation
import OSLog

// MARK: - Diagnostics surface identity (P1/S11)

/// The surface slug emitted with the `view.opened` diagnostics event. Kept here so the model + tests
/// reference it without importing SwiftUI.
public enum CookieConsentDiagnostics {
    public static let surface = "CookieConsentBanner"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent-
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol CookieConsentTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogCookieConsentTelemetry: CookieConsentTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Reporter consent sink (web `setVitalsConsentRequirement` / `setErrorReporterConsentRequirement`)

/// The optional reporters the banner pushes the deployment consent flag into, so they gate their POSTs
/// on the user's stored consent (web `useEffect([requireConsent])`). The production app injects an
/// adapter that forwards to the Web-Vitals + error reporters; previews/tests record the values.
/// A no-op default keeps the model usable where reporters are not wired (web's "always send" baseline).
public protocol ReporterConsentSink: Sendable {
    func setConsentRequirement(_ required: Bool)
}

/// The no-op reporter sink — the native parity of an install where the reporters default to the legacy
/// "always send" baseline (web no-op when the flag is off).
public struct NoopReporterConsentSink: ReporterConsentSink {
    public init() {}
    public func setConsentRequirement(_: Bool) {}
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "CookieConsentBanner" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum CookieConsentStrings {
    public static let table = "CookieConsentBanner"

    public static let string: CookieConsentResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Input snapshot (controlled policy + decision)

/// One coalesced snapshot of the deployment consent policy — the web `versionQuery` result reduced to
/// the single flag the surface reads (`require_cookie_consent`) plus its load / freshness envelope.
public struct ConsentPolicyUpdate: Sendable, Equatable {
    public var status: ConsentPolicyStatus
    public var freshness: ConsentPolicyFreshness
    public var requireConsent: Bool
    public var updatedAt: Date?

    public init(
        status: ConsentPolicyStatus = .loading,
        freshness: ConsentPolicyFreshness = .fresh,
        requireConsent: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.freshness = freshness
        self.requireConsent = requireConsent
        self.updatedAt = updatedAt
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — a pure value so the view is a function of it and snapshot tests
/// assert it directly. `visibility` selects whether the card renders at all (web `return null`);
/// `statusChip` is the P4 freshness chrome shown above the actions when the policy is degraded.
public struct CookieConsentResolved: Sendable, Equatable {
    public let visibility: CookieConsentVisibility
    public let requireConsent: Bool
    public let decision: ConsentDecision
    public let showDetails: Bool
    public let statusChip: ConsentStatusChip?

    public init(
        visibility: CookieConsentVisibility,
        requireConsent: Bool,
        decision: ConsentDecision,
        showDetails: Bool,
        statusChip: ConsentStatusChip?
    ) {
        self.visibility = visibility
        self.requireConsent = requireConsent
        self.decision = decision
        self.showDetails = showDetails
        self.statusChip = statusChip
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the policy + decision + disclosure + freshness to the resolved view-state — the
/// native port of the web banner's render logic: the two-line `return null` guard and the informed-
/// consent disclosure, plus the P4 status chip (only meaningful while the banner is presented). Unit
/// tested across every branch.
public enum CookieConsentProjection {
    public static func resolve(
        requireConsent: Bool,
        decision: ConsentDecision,
        showDetails: Bool,
        status: ConsentPolicyStatus,
        freshness: ConsentPolicyFreshness
    ) -> CookieConsentResolved {
        let visibility = CookieConsentGuard.resolve(requireConsent: requireConsent, decision: decision)
        // The freshness chip only matters while the card is on screen — a dormant overlay shows nothing.
        let chip = visibility == .presented
            ? CookieConsentAdapter.statusChip(status: status, freshness: freshness)
            : nil
        return CookieConsentResolved(
            visibility: visibility,
            requireConsent: requireConsent,
            decision: decision,
            showDetails: showDetails,
            statusChip: chip
        )
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `ConsentPolicySource` (web `useVersionInfo`)
/// and a `ConsentDecisionStore` (web `lib/cookieConsent`), recomputes the resolved projection, exposes
/// the visibility + resolved view-state, mirrors the policy flag into the `ReporterConsentSink` on
/// every change (web `useEffect([requireConsent])`), forwards the Accept / Decline choices, owns the
/// inline disclosure toggle, and auto-refreshes once when the policy transitions to stale.
@MainActor
@Observable
public final class CookieConsentModel {
    public private(set) var resolved = CookieConsentResolved(
        visibility: .dormant,
        requireConsent: false,
        decision: .unknown,
        showDetails: false,
        statusChip: nil
    )

    /// The inline "Manage preferences" disclosure (web `showDetails`).
    public private(set) var showDetails = false

    public var visibility: CookieConsentVisibility {
        resolved.visibility
    }

    public var isPresented: Bool {
        resolved.visibility == .presented
    }

    @ObservationIgnored private let policy: any ConsentPolicySource
    @ObservationIgnored private let store: any ConsentDecisionStore
    @ObservationIgnored private let reporters: any ReporterConsentSink
    @ObservationIgnored private let telemetry: any CookieConsentTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false
    @ObservationIgnored private var requireConsent = false
    @ObservationIgnored private var decision: ConsentDecision = .unknown
    @ObservationIgnored private var status: ConsentPolicyStatus = .loading
    @ObservationIgnored private var freshness: ConsentPolicyFreshness = .fresh

    public init(
        policy: any ConsentPolicySource,
        store: any ConsentDecisionStore,
        reporters: any ReporterConsentSink = NoopReporterConsentSink(),
        telemetry: any CookieConsentTelemetry = OSLogCookieConsentTelemetry()
    ) {
        self.policy = policy
        self.store = store
        self.reporters = reporters
        self.telemetry = telemetry
        policy.onUpdate = { [weak self] update in self?.apply(update) }
        store.onChange = { [weak self] decision in self?.applyDecision(decision) }
    }

    /// Begins observing both seams and emits the `view.opened` diagnostics event once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: CookieConsentDiagnostics.surface)
        policy.start()
        store.start()
    }

    /// Stops observing both upstream seams.
    public func stop() {
        started = false
        policy.stop()
        store.stop()
    }

    /// Forces a consent-policy refresh (cached flag stays applied). Wired to the status-chip retry and
    /// the stale auto-refresh.
    public func refresh() {
        policy.refresh()
    }

    /// Toggles the inline informed-consent disclosure (web `setShowDetails((v) => !v)`).
    public func toggleDetails() {
        showDetails.toggle()
        recompute()
    }

    /// Records an explicit consent decision and reflects it immediately (web `handleAccept` /
    /// `handleDecline`): the store persists it, and the banner unmounts because the decision is no
    /// longer `unknown`. Dismissing without choosing is intentionally not offered.
    public func choose(_ choice: ConsentChoice) {
        store.set(choice.decision)
        applyDecision(choice.decision)
    }

    private func apply(_ update: ConsentPolicyUpdate) {
        requireConsent = update.requireConsent
        status = update.status
        freshness = update.freshness
        // Mirror the deployment flag into the optional reporters on every policy change so a mid-session
        // resolve, or a Settings → Privacy reset that re-surfaces the banner, propagates before the next
        // metric / error fires (web `useEffect([requireConsent])`).
        reporters.setConsentRequirement(update.requireConsent)
        recompute()
        handleAutoRefresh(for: update.freshness)
    }

    private func applyDecision(_ next: ConsentDecision) {
        decision = next
        recompute()
    }

    private func recompute() {
        resolved = CookieConsentProjection.resolve(
            requireConsent: requireConsent,
            decision: decision,
            showDetails: showDetails,
            status: status,
            freshness: freshness
        )
    }

    /// Stale → one guarded auto-refresh; reset once fresh again so a later stale episode re-triggers
    /// exactly once. Offline keeps the cached flag and does not auto-refresh.
    private func handleAutoRefresh(for freshness: ConsentPolicyFreshness) {
        switch freshness {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            policy.refresh()
        case .fresh:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}
