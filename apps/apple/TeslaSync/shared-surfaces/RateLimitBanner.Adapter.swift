//
//  RateLimitBanner.Adapter.swift
//  TeslaSync — P4 shared surface · 0134 · RateLimitBanner (Apple)
//
//  The testable, dependency-light core for the rate-limit / upstream-breaker banner — the SwiftUI
//  parity of `components/feedback/RateLimitBanner.tsx`. Everything here is pure (Foundation only):
//  the banner kind axis (web `state.kind`: 'rate-limited' | 'upstream-down') with its icon and copy
//  taxonomy (the port of the web `isRateLimit ? … : …` message ternary), the countdown helpers (the
//  web `remaining` decrement + the "{n}s" interpolation), and the VoiceOver summary builder. No
//  store, no bundle, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web `RateLimitBanner` is an event-driven presentational banner. It owns the
//  visibility (`useState`) and the per-second countdown; its data arrives via two document-level
//  CustomEvents (`teslasync:rate-limited` on a 429, `teslasync:upstream-down` on a 503 breaker-open),
//  and its only side effect is `useQueryClient().invalidateQueries()` on "Retry now". This core
//  reproduces that exact behaviour as pure values + functions; the event plumbing + the query
//  invalidation live behind the seams (RateLimitBanner.Seams.swift).
//
//  Naming note: every public symbol is `RateLimitBanner`-prefixed so it never collides with the
//  sibling `RateLimitStatusPanel` surface (which owns `RateLimitProjection` / `RateLimitSource` /
//  `RateLimitModel` / `RateLimitInput` / `RateLimitSeverity` / `RateLimitAccessibility`, …).
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias RateLimitBannerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Kind (web `state.kind`: 'rate-limited' | 'upstream-down')

/// The banner kind — the native mirror of the web `State.kind`. Drives the icon (web `Clock` vs
/// `AlertCircle`) and the message taxonomy (web `isRateLimit ? ratelimit.banner : upstream.banner`).
public enum RateLimitBannerKind: String, Sendable, Equatable, CaseIterable {
    /// Fired on a 429 — too many requests for a path scope (web `teslasync:rate-limited`).
    case rateLimited
    /// Fired on a 503 `UPSTREAM_BREAKER_OPEN` — the Tesla upstream is shed (web `teslasync:upstream-down`).
    case upstreamDown

    /// The SF Symbol that names the kind in the banner — the native mirror of the web lucide icon
    /// (`Clock` for rate-limit, `AlertCircle` for upstream). A plain string so the mapping is asserted
    /// without rendering; the tint is applied at the view boundary (P1/S9 tokens), never here.
    public var systemImageName: String {
        switch self {
        case .rateLimited: "clock"
        case .upstreamDown: "exclamationmark.circle"
        }
    }

    /// The i18n key for the banner message (web `t('ratelimit.banner', …)` / `t('upstream.banner', …)`).
    public var messageKey: String {
        switch self {
        case .rateLimited: "ratelimit.banner"
        case .upstreamDown: "upstream.banner"
        }
    }

    /// The English fallback template for the banner message — the verbatim web default, with the
    /// i18next `{{n}}` interpolation rewritten as the native `{n}` token. Substituted by
    /// `RateLimitBannerCountdown.text(seconds:template:)`.
    public var messageFallback: String {
        switch self {
        case .rateLimited: "Too many requests — pausing for {n}s"
        case .upstreamDown: "Tesla upstream unavailable — retry in {n}s"
        }
    }
}

// MARK: - Countdown (web `remaining` + the "{n}s" interpolation)

/// The pure countdown arithmetic + formatting — the native port of the web `remaining` value and its
/// 1-second `setInterval` decrement. The model owns the clock (the `RateLimitBannerTicker` seam);
/// this enum owns the value transitions + the message interpolation so they are asserted without a
/// timer.
public enum RateLimitBannerCountdown {
    /// The token the localized template carries for the remaining seconds — the native rewrite of the
    /// web i18next `{{n}}` interpolation contract.
    public static let secondsToken = "{n}"

    /// The initial countdown for a freshly-fired event — never negative (web
    /// `expiresAt = Date.now() + Math.max(0, retryAfterSec) * 1000`).
    public static func initial(retryAfterS: Int) -> Int {
        max(0, retryAfterS)
    }

    /// One countdown tick — decrement, clamped at zero (web `remaining` recomputed each second).
    public static func tick(_ secondsLeft: Int) -> Int {
        secondsLeft > 0 ? secondsLeft - 1 : 0
    }

    /// "Retry now" is enabled once the countdown has elapsed (web `disabled={remaining > 0}` → the
    /// button is enabled exactly when `remaining == 0`).
    public static func isRetryEnabled(secondsLeft: Int) -> Bool {
        secondsLeft <= 0
    }

    /// Substitutes the remaining seconds into the localized template (web `{ n: remaining }`).
    /// Tolerates a template missing the token, and never emits a negative number.
    public static func text(seconds: Int, template: String) -> String {
        template.replacingOccurrences(of: secondsToken, with: String(max(0, seconds)))
    }
}

// MARK: - Copy (web message ternary)

/// Builds the banner's user-facing message from the kind + the remaining seconds, resolving through
/// the P1/S10 facade — the native port of the web `isRateLimit ? t('ratelimit.banner', …) :
/// t('upstream.banner', …)` ternary. A pure function so the rendered line is asserted directly.
public enum RateLimitBannerCopy {
    /// The localized, interpolated banner line for a kind + countdown.
    public static func message(
        kind: RateLimitBannerKind,
        seconds: Int,
        resolve: RateLimitBannerResolve
    ) -> String {
        let template = resolve(kind.messageKey, kind.messageFallback)
        return RateLimitBannerCountdown.text(seconds: seconds, template: template)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the banner's combined VoiceOver content from already-localised parts, so the spoken text is
/// asserted without rendering the view. The web banner is `role="alert" aria-live="polite"` carrying
/// the single message line, so the spoken label is the interpolated message (which already contains
/// the countdown).
public enum RateLimitBannerAccessibility {
    /// The banner's spoken label — the message, trimmed. Kept as a seam (rather than inlined) so the
    /// a11y contract is unit tested independently of the SwiftUI view.
    public static func bannerLabel(message: String) -> String {
        message.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
