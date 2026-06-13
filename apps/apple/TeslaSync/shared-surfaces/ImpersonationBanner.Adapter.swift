//
//  ImpersonationBanner.Adapter.swift
//  TeslaSync — P4 shared surface · 0123 · ImpersonationBanner (Apple)
//
//  The testable, dependency-light core for the admin impersonation banner — the SwiftUI parity of
//  `components/feedback/ImpersonationBanner.tsx`. The web component is a persistent (NOT dismissible)
//  amber sticky bar that surfaces whenever the calling browser carries a valid impersonation cookie:
//  it shows the impersonated subject, the remaining cookie lifetime (a once-a-second countdown), and
//  an "End impersonation" button. In open-mode installs the underlying hook returns `{ mode: 'open' }`
//  and the web banner renders nothing.
//
//  This file holds only pure, Foundation-only values: the discriminated status value (web
//  `useImpersonationStatus().data`), the verbatim-keyed copy (web `impersonation.banner.*`), the
//  countdown formatter (the native port of the web `formatRemaining` + the threshold select), the
//  title interpolation (web i18next `{{target}}`), and the VoiceOver label builder. No transport, no
//  store, no rendered view — each piece is unit tested in isolation. Tint / colour is applied at the
//  view boundary (P1/S9 tokens), never here. All names are `ImpersonationBanner`-prefixed so they do
//  not collide with the sibling `UserImpersonateButton` surface's `ImpersonationStatus` /
//  `ImpersonationConnection` types compiled into the same module.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias ImpersonationBannerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Impersonated subject (web active-status fields)

/// The active impersonation session's identity — the native value of the web active-status payload
/// (`{ mode: 'active', original_admin, target, expires_at }`). `target` is the impersonated subject
/// (rendered in the title); `originalAdmin` is the admin behind the session (carried for parity with
/// the web `data-original-admin` attribute, surfaced only to VoiceOver); `expiresAt` is the parsed
/// cookie-expiry instant the countdown ticks against (`nil` when the wire value was unparseable, web
/// `Number.isFinite(ts) ? ts : null`).
public struct ImpersonationBannerSubject: Sendable, Equatable {
    public let target: String
    public let originalAdmin: String
    public let expiresAt: Date?

    public init(target: String, originalAdmin: String, expiresAt: Date?) {
        self.target = target
        self.originalAdmin = originalAdmin
        self.expiresAt = expiresAt
    }
}

// MARK: - Status (web `useImpersonationStatus().data` discriminated union)

/// The resolved impersonation status — the native parity of the web discriminated union
/// `{ mode: 'open' } | { mode: 'inactive' } | { mode: 'active', … }`. `unavailable` is the open-mode
/// install (web `{ mode: 'open' }`, where the web banner renders nothing); `inactive` is forward-auth
/// with no active cookie; `active` carries the impersonated subject. A pure value so it flows through
/// the projection and is asserted directly.
public enum ImpersonationBannerStatus: Sendable, Equatable {
    case unavailable
    case inactive
    case active(ImpersonationBannerSubject)

    /// The active subject when impersonating, else `nil` (web `data?.mode === 'active' ? data : …`).
    public var activeSubject: ImpersonationBannerSubject? {
        if case let .active(subject) = self { return subject }
        return nil
    }
}

// MARK: - Copy (web `impersonation.banner.*`)

/// The localized copy keys for the banner — the verbatim port of the web `ImpersonationBanner`
/// strings. The title / body / countdown / button keys mirror the web source exactly; the i18next
/// `{{target}}` / `{{time}}` interpolation tokens are rewritten as the native `{target}` / `{time}`
/// tokens substituted by `ImpersonationBannerTitle` / `ImpersonationBannerCountdown`. Pure
/// (key, fallback) values resolved through the P1/S10 facade at the view boundary.
public enum ImpersonationBannerCopy {
    public static let titleKey = "impersonation.banner.title"
    public static let titleFallback = "Impersonating {target}"

    public static let bodyKey = "impersonation.banner.body"
    public static let bodyFallback =
        "You are viewing TeslaSync as another subject. End impersonation to restore your session."

    /// Web `t('impersonation.banner.endsIn', 'Expires in {{time}}', { time })`.
    public static let endsInKey = "impersonation.banner.endsIn"
    public static let endsInFallback = "Expires in {time}"

    /// Web `t('impersonation.banner.expired', 'Session expired')`.
    public static let expiredKey = "impersonation.banner.expired"
    public static let expiredFallback = "Session expired"

    /// Web `t('impersonation.banner.end', 'End impersonation')`.
    public static let endKey = "impersonation.banner.end"
    public static let endFallback = "End impersonation"

    /// Web `t('impersonation.banner.ending', 'Ending…')`.
    public static let endingKey = "impersonation.banner.ending"
    public static let endingFallback = "Ending…"
}

// MARK: - Title interpolation (web i18next `{{target}}`)

/// Substitutes the impersonated subject into the localized title template — the native parity of the
/// web `t('impersonation.banner.title', { target })` interpolation. Pure string work; tolerates a
/// template missing the token (the surviving text is returned unchanged).
public enum ImpersonationBannerTitle {
    /// The token the localized title template carries for the impersonated subject.
    public static let targetToken = "{target}"

    public static func text(target: String, template: String) -> String {
        template.replacingOccurrences(of: targetToken, with: target)
    }
}

// MARK: - Countdown (web `formatRemaining` + the threshold select)

/// Builds the remaining-lifetime countdown — the native port of the web `formatRemaining(ms)` plus
/// the `remaining > 1000 ? endsIn : expired` select. Pure, time-injected arithmetic so the format is
/// asserted without a running clock.
public enum ImpersonationBannerCountdown {
    /// The token the localized "expires in" template carries for the formatted remaining time.
    public static let timeToken = "{time}"

    /// The web threshold (ms): at or below this, the session reads as expired rather than counting.
    public static let expiryThresholdMillis = 1000

    /// Formats a millisecond remainder as "HHh MMm" / "MMm SSs" / "SSs" — the verbatim port of the
    /// web `formatRemaining`: clamp to zero, then the largest non-zero magnitude wins and the next
    /// unit is zero-padded to two digits.
    public static func format(millis: Int) -> String {
        let total = max(0, Int((Double(millis) / 1000).rounded(.down)))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        if hours > 0 {
            return String(format: "%dh %02dm", hours, minutes)
        }
        if minutes > 0 {
            return String(format: "%dm %02ds", minutes, seconds)
        }
        return String(format: "%ds", seconds)
    }

    /// The whole-millisecond remainder until `expiresAt`, measured from `now` (web `expiresMs - now`).
    public static func remainingMillis(expiresAt: Date, now: Date) -> Int {
        Int((expiresAt.timeIntervalSince(now) * 1000).rounded(.towardZero))
    }

    /// The countdown line, or `nil` when there is no parseable expiry (web `expiresMs === null`).
    /// Above the threshold it interpolates the formatted remainder into the localized "expires in"
    /// template; at or below it returns the localized "session expired" copy.
    public static func text(
        expiresAt: Date?,
        now: Date,
        endsInTemplate: String,
        expiredText: String
    ) -> String? {
        guard let expiresAt else { return nil }
        let remaining = remainingMillis(expiresAt: expiresAt, now: now)
        if remaining > expiryThresholdMillis {
            return endsInTemplate.replacingOccurrences(of: timeToken, with: format(millis: remaining))
        }
        return expiredText
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver string from already-localized parts, so the spoken content is
/// asserted without rendering the view (web `role="alert"` + `aria-live="polite"` region). The
/// composed sentence reads the impersonated-subject title, the explanatory body, and the live
/// countdown, never doubling a terminal period when a part already ends in one.
public enum ImpersonationBannerAccessibility {
    /// Folds the non-empty parts into one VoiceOver sentence with terminal-punctuation-safe joins.
    public static func sentence(_ parts: [String]) -> String {
        parts.filter { !$0.isEmpty }.reduce("") { accumulated, next in
            guard !accumulated.isEmpty else { return next }
            let endsTerminal = accumulated.last.map { ".!?".contains($0) } ?? false
            return accumulated + (endsTerminal ? " " : ". ") + next
        }
    }

    /// The banner region's spoken label: title, then body, then the countdown when present.
    public static func bannerLabel(title: String, body: String, countdown: String?) -> String {
        sentence([title, body, countdown ?? ""])
    }
}
