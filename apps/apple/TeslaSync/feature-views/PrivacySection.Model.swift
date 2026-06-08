//
//  PrivacySection.Model.swift
//  TeslaSync — P4 feature view · 0209 · PrivacySection (Apple)
//
//  The seams the view binds through, the observable view-model, and the
//  per-surface i18n facade — the SwiftUI parity of
//  web/src/features/settings/components/PrivacySection.tsx.
//
//  The web surface composes four client/remote seams: the deployment consent
//  policy (`useVersionInfo().require_cookie_consent`), the client-side recent-pages
//  LRU (`lib/recentPages`), the tri-state cookie consent store (`lib/cookieConsent`),
//  and the confirm-silence store the clear action gates on (`lib/confirmSilence`),
//  surfacing toasts via `useToast`. This file reproduces each as a P1/S8 state-holder
//  seam (no networking, no `UserDefaults`, no bundle access in the view), wires the
//  P1/S11 telemetry contract, exposes the P1/S10 facade, and owns the confirm-sheet +
//  toast presentation. Previews/tests drive the model with the in-memory seams below.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Diagnostics surface identity (P1/S11)

/// The surface slug emitted with the `view.opened` diagnostics event. Kept here so
/// the model + tests reference it without importing SwiftUI.
public enum PrivacyDiagnostics {
    public static let surface = "PrivacySection"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core
/// `Telemetry.track(.screenView(screen:…))`, which is consent-gated and redacted there.
public protocol PrivacyTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
/// The slug is a static, non-identifying constant; no path, title, or id is recorded.
public struct OSLogPrivacyTelemetry: PrivacyTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "PrivacySection" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time; kept per-surface so
/// each parallel prompt owns its strings without editing the shared catalog.
public enum PrivacyStrings {
    public static let table = "PrivacySection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%lld`-templated string and substitutes the count (web i18next
    /// `t(key, { count })`). Used for the "N entries stored" counter.
    public static func count(_ key: String, _ fallback: String, _ value: Int) -> String {
        String(format: string(key, fallback), value)
    }

    /// Convenience that wraps the resolved string in a verbatim `Text` (so call sites in
    /// SwiftUI views never inline a literal).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Consent policy freshness (the P4 states contract)

/// The freshness of the cached deployment consent policy (the web `useVersionInfo`
/// query, surfaced through the P4 states contract). `stale` shows a refreshing chip +
/// triggers one auto-refresh; `offline` shows an offline chip; in both cases the cached
/// `requireConsent` flag stays applied and the client-side controls stay usable.
public enum PrivacyFreshness: Sendable, Equatable {
    case fresh
    case stale
    case offline
}

/// The load status of the deployment consent policy, mirroring the shared `LoadableState`
/// the production source projects from the `/system/version` `Resource<T>`.
public enum PrivacyEnvironmentStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// One coalesced snapshot of the deployment consent policy — the web
/// `versionQuery` result reduced to the single flag the surface reads
/// (`require_cookie_consent`) plus its load/freshness envelope.
public struct PrivacyEnvironmentUpdate: Sendable, Equatable {
    public var status: PrivacyEnvironmentStatus
    public var freshness: PrivacyFreshness
    public var requireConsent: Bool
    public var updatedAt: Date?

    public init(
        status: PrivacyEnvironmentStatus = .loading,
        freshness: PrivacyFreshness = .fresh,
        requireConsent: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.freshness = freshness
        self.requireConsent = requireConsent
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seams (P1/S8 layer)

/// The deployment consent-policy feed (web `useVersionInfo`). Production implements
/// this over the shared `/system/version` state holder; previews/tests use
/// `InMemoryPrivacyEnvironmentSource`. The view never talks to the network.
@MainActor
public protocol PrivacyEnvironmentSource: AnyObject {
    var onUpdate: (@MainActor (PrivacyEnvironmentUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The client-side recent-pages LRU feed (web `lib/recentPages`: `getRecentPages`,
/// `clearRecentPages`, `subscribeRecentPages`). Pushes the current entry count on start
/// and after every mutation so the counter live-updates exactly like the web subscriber.
@MainActor
public protocol RecentPagesStore: AnyObject {
    var onChange: (@MainActor (Int) -> Void)? { get set }
    func start()
    func stop()
    /// Wipes the recent-page history (web `clearRecentPages`). Fires `onChange` with 0.
    func clear()
}

/// The tri-state cookie-consent store (web `lib/cookieConsent`: `getConsent`,
/// `setConsent`, `clearConsent`, `subscribeConsent`). Pushes the current state on start
/// and after every mutation (incl. cross-tab/banner-driven changes in production).
@MainActor
public protocol ConsentStore: AnyObject {
    var onChange: (@MainActor (PrivacyConsentState) -> Void)? { get set }
    func start()
    func stop()
    /// Records an explicit decision (web `setConsent('accepted' | 'declined')`).
    func set(_ state: PrivacyConsentState)
    /// Clears any decision so the state returns to `unknown` (web `clearConsent`).
    func reset()
}

/// The confirm-silence store (web `lib/confirmSilence`: `isSilenced`, `silence`). Lets
/// the user opt out of the clear confirmation; once silenced the clear runs immediately.
@MainActor
public protocol ConfirmSilenceStore: AnyObject {
    func isSilenced(_ key: String) -> Bool
    func silence(_ key: String)
}

// MARK: - Toast (web `useToast().success`)

/// One transient success toast (web `toast.success(message)`). Carries a fresh id so a
/// repeated identical message still re-triggers the auto-dismissing presentation.
public struct PrivacyToast: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let message: String

    public init(id: UUID = UUID(), message: String) {
        self.id = id
        self.message = message
    }
}

// MARK: - View-model (P1/S8 binding)

/// The surface's observable view-model. Subscribes to the four seams, resolves the
/// render `phase` (web is always rendered; the loading skeleton shows only before the
/// consent policy first resolves), owns the confirm-sheet + toast presentation, and
/// exposes the projected state for SwiftUI to switch over. Emits the `view.opened`
/// diagnostics event once on first start.
@MainActor
@Observable
public final class PrivacyModel {
    public private(set) var phase: PrivacyPhase = .loading
    public private(set) var status: PrivacyEnvironmentStatus = .loading
    public private(set) var freshness: PrivacyFreshness = .fresh
    public private(set) var requireConsent = false
    public private(set) var recentCount = 0
    public private(set) var consent: PrivacyConsentState = .unknown
    public private(set) var updatedAt: Date?

    /// Whether the clear-recent-pages confirmation sheet is presented (web `confirmOpen`).
    public var confirmPresented = false
    /// The "Don't ask again" toggle inside the confirmation sheet (web `dontAskAgain`).
    public var dontAskAgain = false
    /// The active success toast, or `nil` (web `toast`).
    public private(set) var toast: PrivacyToast?

    @ObservationIgnored private let environment: any PrivacyEnvironmentSource
    @ObservationIgnored private let recentPages: any RecentPagesStore
    @ObservationIgnored private let consentStore: any ConsentStore
    @ObservationIgnored private let silenceStore: any ConfirmSilenceStore
    @ObservationIgnored private let telemetry: any PrivacyTelemetry
    @ObservationIgnored private let localize: (String, String) -> String
    @ObservationIgnored private let silenceKey: String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    /// The stable action id the clear confirmation silences under (web
    /// `CONFIRM_SILENCE_KEY = 'clear-recent-pages'`).
    public static let confirmSilenceKey = "clear-recent-pages"

    public init(
        environment: any PrivacyEnvironmentSource,
        recentPages: any RecentPagesStore,
        consentStore: any ConsentStore,
        silenceStore: any ConfirmSilenceStore,
        telemetry: any PrivacyTelemetry = OSLogPrivacyTelemetry(),
        localize: @escaping (String, String) -> String = PrivacyStrings.string,
        silenceKey: String = PrivacyModel.confirmSilenceKey
    ) {
        self.environment = environment
        self.recentPages = recentPages
        self.consentStore = consentStore
        self.silenceStore = silenceStore
        self.telemetry = telemetry
        self.localize = localize
        self.silenceKey = silenceKey
        environment.onUpdate = { [weak self] update in self?.apply(update) }
        recentPages.onChange = { [weak self] count in self?.recentCount = max(0, count) }
        consentStore.onChange = { [weak self] state in self?.consent = state }
    }

    // MARK: Lifecycle

    /// Begins observing every seam and emits the `view.opened` diagnostics event once.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: PrivacyDiagnostics.surface)
        environment.start()
        recentPages.start()
        consentStore.start()
    }

    /// Stops observing every upstream seam.
    public func stop() {
        started = false
        environment.stop()
        recentPages.stop()
        consentStore.stop()
    }

    /// Forces a consent-policy refresh (cached flag stays applied). Wired to the status
    /// banner retry and the stale auto-refresh.
    public func refresh() {
        environment.refresh()
    }

    // MARK: Recent pages (web clear flow + ConfirmDialog silence machinery)

    /// Requests a recent-pages clear. When the action was previously silenced the clear
    /// runs immediately (web: silenced ConfirmDialog fires `onConfirm` without rendering);
    /// otherwise the confirmation sheet is presented.
    public func requestClearRecentPages() {
        guard recentCount > 0 else { return }
        if silenceStore.isSilenced(silenceKey) {
            performClear()
            return
        }
        dontAskAgain = false
        confirmPresented = true
    }

    /// Confirms the clear from the sheet (web `handleConfirmClick`): persists the silence
    /// opt-in first, then wipes the list and toasts.
    public func confirmClearRecentPages() {
        if dontAskAgain {
            silenceStore.silence(silenceKey)
        }
        confirmPresented = false
        performClear()
    }

    /// Dismisses the confirmation sheet without clearing (web `onCancel`).
    public func cancelClearRecentPages() {
        confirmPresented = false
    }

    private func performClear() {
        recentPages.clear()
        showToast(localize("recentPages.cleared", "Recent pages cleared"))
    }

    // MARK: Consent (web accept / decline / reset)

    /// Applies a consent action and toasts the result (web `handleAcceptConsent` /
    /// `handleDeclineConsent` / `handleResetConsent`).
    public func performConsent(_ action: PrivacyConsentAction) {
        switch action {
        case .accept:
            consentStore.set(.accepted)
            consent = .accepted
            showToast(localize("consent.toast.accepted", "Consent granted"))
        case .decline:
            consentStore.set(.declined)
            consent = .declined
            showToast(localize("consent.toast.declined", "Consent withdrawn"))
        case .reset:
            consentStore.reset()
            consent = .unknown
            showToast(localize("consent.toast.reset", "Consent reset — banner will reappear"))
        }
    }

    // MARK: Toast

    /// Clears the active toast (called by the view once its auto-dismiss elapses).
    public func dismissToast() {
        toast = nil
    }

    private func showToast(_ message: String) {
        toast = PrivacyToast(message: message)
    }

    // MARK: Apply (consent-policy snapshot)

    private func apply(_ update: PrivacyEnvironmentUpdate) {
        status = update.status
        freshness = update.freshness
        requireConsent = update.requireConsent
        updatedAt = update.updatedAt
        phase = PrivacyPhaseResolver.resolve(status: update.status)
        handleAutoRefresh(for: update.freshness)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// fresh again so a later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for freshness: PrivacyFreshness) {
        switch freshness {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            environment.refresh()
        case .fresh:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}
