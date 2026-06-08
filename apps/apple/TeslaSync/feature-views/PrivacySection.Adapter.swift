//
//  PrivacySection.Adapter.swift
//  TeslaSync — P4 feature view · 0209 · PrivacySection (Apple)
//
//  The pure, dependency-free projection core for the Privacy settings surface — the
//  SwiftUI-agnostic parity of the web component's derived values: the tri-state consent
//  domain (web `lib/cookieConsent` `ConsentState`), the consent state label (web
//  `consentLabel`), the on/off consent body (web `requireConsent ? bodyOn : bodyOff`),
//  the stored-count counter (web `recentPages.storedCount`), the per-control disabled
//  predicates (web `disabled={…}`), the render-phase resolution, the status-banner
//  projection (the P4 states contract), and the VoiceOver summaries. Everything here is
//  pure + Foundation-only so it can be unit-tested without a store, a bundle, or a view.
//

import Foundation

// MARK: - Consent domain (web `lib/cookieConsent` `ConsentState`)

/// The tri-state cookie/GDPR consent value (web `ConsentState`). `unknown` is the
/// banner-still-pending / no-decision state (materialized by the absence of a stored
/// value in production), `accepted` / `declined` are explicit user decisions.
public enum PrivacyConsentState: String, Sendable, Equatable, CaseIterable {
    case unknown
    case accepted
    case declined

    /// The token persisted by the web store (`accepted` / `declined`; `unknown` is the
    /// absence of the key). Surfaced so the production store seam round-trips identically.
    public var storageValue: String? {
        switch self {
        case .unknown: nil
        case .accepted: "accepted"
        case .declined: "declined"
        }
    }

    /// Resolves a stored token to a state. Anything other than the two explicit decisions
    /// (incl. a missing value) is `unknown`, exactly like the web `getConsent` contract.
    public static func parse(_ raw: String?) -> PrivacyConsentState {
        switch raw {
        case "accepted": .accepted
        case "declined": .declined
        default: .unknown
        }
    }
}

/// The three consent mutations the surface offers (web `handleAcceptConsent` /
/// `handleDeclineConsent` / `handleResetConsent`).
public enum PrivacyConsentAction: String, Sendable, Equatable, CaseIterable {
    case accept
    case decline
    case reset
}

// MARK: - Render phase (web is always rendered; native loading skeleton precedes it)

/// The mutually-exclusive top-level render branches. The web section is always rendered;
/// the native `loading` skeleton shows only before the deployment consent policy first
/// resolves (the lone remote read), after which the always-on client-side controls show.
public enum PrivacyPhase: Sendable, Equatable {
    case loading
    case ready
}

/// Resolves the render phase from the consent-policy load status. A still-loading policy
/// holds the skeleton; a resolved (loaded) or failed policy reveals the section — on
/// failure `requireConsent` falls back to `false` (web `Boolean(undefined)`), the controls
/// stay usable, and the failure is surfaced by the status banner, never by hiding content.
public enum PrivacyPhaseResolver {
    public static func resolve(status: PrivacyEnvironmentStatus) -> PrivacyPhase {
        switch status {
        case .loading: .loading
        case .loaded, .failed: .ready
        }
    }
}

// MARK: - Status banner (the P4 states contract: error / stale / offline)

/// The visual tone of the consent-policy status banner.
public enum PrivacyBannerTone: Sendable, Equatable {
    case error
    case offline
    case stale
}

/// The projected status banner shown above the controls when the consent policy is
/// failed / offline / stale. `nil` when the policy is fresh + loaded. The cached
/// `requireConsent` flag stays applied beneath it (cached value never hidden).
public struct PrivacyStatusBanner: Sendable, Equatable {
    public let tone: PrivacyBannerTone
    public let messageKey: String
    public let messageFallback: String
    public let showsRetry: Bool

    public init(tone: PrivacyBannerTone, messageKey: String, messageFallback: String, showsRetry: Bool) {
        self.tone = tone
        self.messageKey = messageKey
        self.messageFallback = messageFallback
        self.showsRetry = showsRetry
    }

    /// The localized banner message resolved through the facade.
    public func message(_ localize: (String, String) -> String) -> String {
        localize(messageKey, messageFallback)
    }
}

// MARK: - Adapter (pure projection)

/// Pure projection + the web-parity derived values shared by the views and the tests.
/// No store, no bundle, no SwiftUI.
public enum PrivacyAdapter {
    /// Localizer shape — the web `t(key, default)` reduced to its two arguments.
    public typealias Localize = (String, String) -> String

    // MARK: Consent copy (web `consentLabel` + body)

    /// The consent state label (web `consentLabel`): the three-way switch over the
    /// stored decision.
    public static func consentStateLabel(_ state: PrivacyConsentState, localize: Localize) -> String {
        switch state {
        case .accepted:
            localize("consent.state.accepted", "Accepted — performance & error reporting on")
        case .declined:
            localize("consent.state.declined", "Declined — only essential storage in use")
        case .unknown:
            localize("consent.state.unknown", "Not decided — banner will appear on next visit")
        }
    }

    /// The consent section body (web `requireConsent ? bodyOn : bodyOff`).
    public static func consentBody(requireConsent: Bool, localize: Localize) -> String {
        if requireConsent {
            localize(
                "consent.section.bodyOn",
                "This deployment collects anonymous performance and error reports with your consent. "
                    + "Strictly necessary storage (auth, settings) is always on."
            )
        } else {
            localize(
                "consent.section.bodyOff",
                "This deployment does not require consent collection — these controls let you preview "
                    + "the user-facing flow."
            )
        }
    }

    // MARK: Recent pages (web counter + empty)

    /// Whether the recent-pages row is empty (web `count === 0`). Drives the friendly
    /// inline empty hint and the disabled clear button.
    public static func recentIsEmpty(count: Int) -> Bool {
        count <= 0
    }

    /// The stored-count counter (web `t('recentPages.storedCount', { count })`).
    public static func recentCountText(count: Int, localize: Localize) -> String {
        String(format: localize("recentPages.storedCount", "%lld entries stored"), max(0, count))
    }

    // MARK: Disabled predicates (web `disabled={…}`)

    /// The clear button is disabled when there is nothing to clear (web `count === 0`).
    public static func isClearDisabled(count: Int) -> Bool {
        recentIsEmpty(count: count)
    }

    /// A consent action button is disabled when its target state is already active (web
    /// `disabled={consent === 'accepted' | 'declined' | 'unknown'}`).
    public static func isConsentActionDisabled(_ action: PrivacyConsentAction, consent: PrivacyConsentState) -> Bool {
        switch action {
        case .accept: consent == .accepted
        case .decline: consent == .declined
        case .reset: consent == .unknown
        }
    }

    // MARK: Status banner

    /// Projects the consent-policy status banner. Offline (the root cause) takes
    /// precedence, then a hard failure (retryable), then a stale refresh (retryable);
    /// a fresh, loaded policy yields no banner.
    public static func statusBanner(
        status: PrivacyEnvironmentStatus,
        freshness: PrivacyFreshness
    ) -> PrivacyStatusBanner? {
        if freshness == .offline {
            return PrivacyStatusBanner(
                tone: .offline,
                messageKey: "privacy.status.offline",
                messageFallback: "Offline — showing the last known consent policy",
                showsRetry: false
            )
        }
        if case .failed = status {
            return PrivacyStatusBanner(
                tone: .error,
                messageKey: "privacy.status.error",
                messageFallback: "Couldn't check the deployment's consent policy",
                showsRetry: true
            )
        }
        if freshness == .stale {
            return PrivacyStatusBanner(
                tone: .stale,
                messageKey: "privacy.status.stale",
                messageFallback: "Refreshing the consent policy…",
                showsRetry: true
            )
        }
        return nil
    }

    // MARK: Accessibility summaries (testable seam)

    /// The VoiceOver summary for the recent-pages row: the title plus the count or the
    /// empty hint, so the row is announced as one coherent element.
    public static func recentAccessibility(count: Int, localize: Localize) -> String {
        let title = localize("recentPages.clearTitle", "Recently viewed pages")
        let detail = recentIsEmpty(count: count)
            ? localize("recentPages.emptyHint", "No recently viewed pages yet — pages you visit will appear here.")
            : recentCountText(count: count, localize: localize)
        return "\(title). \(detail)"
    }

    /// The VoiceOver summary for the consent row: the title plus the current decision
    /// label, so the row's state is announced without relying on the body copy.
    public static func consentAccessibility(consent: PrivacyConsentState, localize: Localize) -> String {
        let title = localize("consent.section.title", "Cookies & analytics consent")
        return "\(title). \(consentStateLabel(consent, localize: localize))"
    }
}
