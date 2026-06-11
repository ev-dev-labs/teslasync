//
//  CookieConsentBanner.Adapter.swift
//  TeslaSync — P4 shared surface · 0115 · CookieConsentBanner (Apple)
//
//  The testable, dependency-light core for the cookie / GDPR consent banner — the SwiftUI parity of
//  `components/feedback/CookieConsentBanner.tsx`. Everything here is pure (Foundation only): the
//  tri-state consent domain (web `lib/cookieConsent` `ConsentState` — `getConsent` / `setConsent`),
//  the two-line visibility guard (the web `if (!requireConsent) return null; if (consent !== 'unknown')
//  return null`), the informed-consent category catalog (the two `<li>` cards), the Manage / Hide
//  disclosure title, the P4 freshness status-chip projection (offline → error → stale precedence), and
//  the VoiceOver summaries. No store, no bundle, no rendered view, so each piece is unit tested in
//  isolation.
//
//  Parity note: the web `CookieConsentBanner` is GDPR / CNIL-style. Non-essential reporting is OFF by
//  default until an explicit "Accept all"; strictly necessary storage is "Always on" and exempt under
//  the ePrivacy directive. Dismissing without choosing is NOT consent — there is deliberately no
//  dismiss affordance, so the only way the banner goes away is an explicit Accept / Decline. This core
//  reproduces that exact behaviour as pure values + functions.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias CookieConsentResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Consent domain (web `lib/cookieConsent` `ConsentState`)

/// The tri-state cookie / GDPR consent value (web `ConsentState`). `unknown` is the no-decision state
/// (materialized in production by the absence of the stored key); `accepted` / `declined` are explicit
/// user decisions. Only `unknown` keeps the banner on screen — the visibility guard below.
public enum ConsentDecision: String, Sendable, Equatable, CaseIterable {
    case unknown
    case accepted
    case declined

    /// The token persisted by the web store (`accepted` / `declined`; `unknown` is the absence of the
    /// key). Surfaced so the production store seam round-trips identically to `lib/cookieConsent`.
    public var storageValue: String? {
        switch self {
        case .unknown: nil
        case .accepted: "accepted"
        case .declined: "declined"
        }
    }

    /// Resolves a stored token to a decision. Anything other than the two explicit decisions (incl. a
    /// missing value) is `unknown`, exactly like the web `getConsent` contract.
    public static func parse(_ raw: String?) -> ConsentDecision {
        switch raw {
        case "accepted": .accepted
        case "declined": .declined
        default: .unknown
        }
    }
}

/// The two explicit choices the banner offers (web `handleAccept` / `handleDecline`). There is no
/// `reset` here — that lives in Settings → Privacy, not in the banner.
public enum ConsentChoice: String, Sendable, Equatable, CaseIterable {
    case accept
    case decline

    /// The decision a choice records (web `setConsent('accepted' | 'declined')`).
    public var decision: ConsentDecision {
        switch self {
        case .accept: .accepted
        case .decline: .declined
        }
    }
}

// MARK: - Visibility guard (web two-line `return null`)

/// Whether the banner is shown. `dormant` renders nothing (the native parity of the web
/// `return null` — a non-blocking bottom overlay is simply not presented, never a blank box);
/// `presented` shows the full card.
public enum CookieConsentVisibility: String, Sendable, Equatable, CaseIterable {
    case dormant
    case presented
}

/// The pure visibility projection — the verbatim port of the web guard
/// `if (!requireConsent) return null; if (consent !== 'unknown') return null`. The banner is presented
/// ONLY when the deployment requires consent AND the user has not yet decided.
public enum CookieConsentGuard {
    public static func resolve(requireConsent: Bool, decision: ConsentDecision) -> CookieConsentVisibility {
        guard requireConsent else { return .dormant }
        guard decision == .unknown else { return .dormant }
        return .presented
    }
}

// MARK: - Informed-consent catalog (web's two `<li>` cards)

/// One informed-consent category card — the (key, English fallback) pairs for the title + body plus
/// whether it carries the "Always on" badge (strictly-necessary storage, exempt under the ePrivacy
/// directive). A pure value the view resolves through the P1/S10 facade.
public struct ConsentCategory: Sendable, Equatable, Identifiable {
    public let id: String
    public let titleKey: String
    public let titleFallback: String
    public let bodyKey: String
    public let bodyFallback: String
    public let alwaysOn: Bool

    public init(
        id: String,
        titleKey: String,
        titleFallback: String,
        bodyKey: String,
        bodyFallback: String,
        alwaysOn: Bool
    ) {
        self.id = id
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.bodyKey = bodyKey
        self.bodyFallback = bodyFallback
        self.alwaysOn = alwaysOn
    }
}

/// The two informed-consent cards shown when "Manage preferences" is expanded — the verbatim port of
/// the web details `<ul>`: strictly-necessary storage ("Always on") and performance / error reporting.
public enum ConsentCatalog {
    public static let essential = ConsentCategory(
        id: "essential",
        titleKey: "consent.category.essential.title",
        titleFallback: "Strictly necessary",
        bodyKey: "consent.category.essential.body",
        bodyFallback: "Authentication, session, theme, and saved drafts. Required for the app to work "
            + "and exempt from consent under the ePrivacy directive.",
        alwaysOn: true
    )

    public static let analytics = ConsentCategory(
        id: "analytics",
        titleKey: "consent.category.analytics.title",
        titleFallback: "Performance & error reporting",
        bodyKey: "consent.category.analytics.body",
        bodyFallback: "Anonymous Core Web Vitals (page-load timings) and uncaught error reports sent to "
            + "this TeslaSync instance to help operators diagnose issues. No third parties involved.",
        alwaysOn: false
    )

    /// The ordered category list (essential first, exactly as the web `<ul>` renders them).
    public static let categories: [ConsentCategory] = [essential, analytics]
}

// MARK: - Disclosure (web "Manage preferences" / "Hide details")

/// The Manage / Hide disclosure copy — the port of the web ternary
/// `showDetails ? t('hideDetails') : t('manage')`.
public enum ConsentDisclosure {
    public static func titleKey(expanded: Bool) -> String {
        expanded ? "consent.banner.hideDetails" : "consent.banner.manage"
    }

    public static func titleFallback(expanded: Bool) -> String {
        expanded ? "Hide details" : "Manage preferences"
    }

    public static func title(expanded: Bool, localize: CookieConsentResolve) -> String {
        localize(titleKey(expanded: expanded), titleFallback(expanded: expanded))
    }
}

// MARK: - Consent-policy freshness (the P4 states contract)

/// The freshness of the cached deployment consent policy (the web `useVersionInfo` query, surfaced
/// through the P4 states contract). `stale` shows a refreshing chip + triggers one auto-refresh;
/// `offline` shows an offline chip; in both cases the cached `requireConsent` flag stays applied.
public enum ConsentPolicyFreshness: String, Sendable, Equatable, CaseIterable {
    case fresh
    case stale
    case offline
}

/// The load status of the deployment consent policy, mirroring the shared `LoadableState` the
/// production source projects from the `/system/version` `Resource<T>`.
public enum ConsentPolicyStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

// MARK: - Status chip (the P4 states contract: error / stale / offline)

/// The visual tone of the consent-policy status chip.
public enum ConsentStatusTone: String, Sendable, Equatable, CaseIterable {
    case error
    case offline
    case stale
}

/// The projected status chip shown above the actions when the consent policy is failed / offline /
/// stale while the banner is presented. `nil` when the policy is fresh + loaded. The cached
/// `requireConsent` flag stays applied beneath it (cached value never hidden).
public struct ConsentStatusChip: Sendable, Equatable {
    public let tone: ConsentStatusTone
    public let messageKey: String
    public let messageFallback: String
    public let showsRetry: Bool

    public init(tone: ConsentStatusTone, messageKey: String, messageFallback: String, showsRetry: Bool) {
        self.tone = tone
        self.messageKey = messageKey
        self.messageFallback = messageFallback
        self.showsRetry = showsRetry
    }

    /// The localized chip message resolved through the facade.
    public func message(_ localize: CookieConsentResolve) -> String {
        localize(messageKey, messageFallback)
    }
}

// MARK: - Adapter (pure projection shared by the views + tests)

/// Pure projection + the web-parity derived values shared by the views and the tests. No store, no
/// bundle, no SwiftUI.
public enum CookieConsentAdapter {
    /// Projects the consent-policy status chip. Offline (the root cause) takes precedence, then a hard
    /// failure (retryable), then a stale refresh (retryable); a fresh, loaded policy yields no chip.
    public static func statusChip(
        status: ConsentPolicyStatus,
        freshness: ConsentPolicyFreshness
    ) -> ConsentStatusChip? {
        if freshness == .offline {
            return ConsentStatusChip(
                tone: .offline,
                messageKey: "consent.status.offline",
                messageFallback: "Offline — showing the last known consent policy",
                showsRetry: false
            )
        }
        if case .failed = status {
            return ConsentStatusChip(
                tone: .error,
                messageKey: "consent.status.error",
                messageFallback: "Couldn't check the deployment's consent policy",
                showsRetry: true
            )
        }
        if freshness == .stale {
            return ConsentStatusChip(
                tone: .stale,
                messageKey: "consent.status.stale",
                messageFallback: "Refreshing the consent policy…",
                showsRetry: true
            )
        }
        return nil
    }

    // MARK: Accessibility summaries (testable seam)

    /// The non-modal dialog's VoiceOver group label — the title plus the body, so the banner is
    /// announced as one coherent element (web `role="dialog"` + `aria-labelledby` / `aria-describedby`).
    public static func dialogLabel(localize: CookieConsentResolve) -> String {
        let title = localize("consent.banner.title", "Cookies & analytics")
        let body = localize(
            "consent.banner.body",
            "TeslaSync uses strictly necessary storage to keep you signed in and to remember your "
                + "preferences. With your consent, we also collect anonymous performance and error "
                + "reports to improve the app. You can change your mind any time in Settings → Privacy."
        )
        return "\(title). \(body)"
    }

    /// The VoiceOver summary for one informed-consent category: the title, the "Always on" note when
    /// applicable, and the body, so each card is announced as a single element.
    public static func categoryAccessibility(_ category: ConsentCategory, localize: CookieConsentResolve) -> String {
        let title = localize(category.titleKey, category.titleFallback)
        let body = localize(category.bodyKey, category.bodyFallback)
        guard category.alwaysOn else { return "\(title). \(body)" }
        let alwaysOn = localize("consent.category.alwaysOn", "Always on")
        return "\(title). \(alwaysOn). \(body)"
    }
}
