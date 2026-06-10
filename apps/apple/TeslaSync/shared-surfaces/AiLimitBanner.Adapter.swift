//
//  AiLimitBanner.Adapter.swift
//  TeslaSync — P4 shared surface · 0025 · AiLimitBanner (Apple)
//
//  The testable, dependency-light core for the AI rate-limit / cost-cap banner — the SwiftUI
//  parity of `components/ai/AiLimitBanner.tsx`. Everything here is pure (Foundation only): the
//  banner severity axis (web `variant` derived from `bannerLevel`), the reason→copy taxonomy
//  (the port of the web `titleForReason` / `descriptionForReason` switch tables), the countdown
//  helpers (the web `secondsLeft` tick + the "Try again in Ns" line), and the VoiceOver summary
//  builder. No store, no bundle, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web `AiLimitBanner` is a fully-controlled presentational banner. The parent
//  owns the data (the `limit` field from `useAiStream`, modelled here by the module-level
//  `AiLimitInfo`) and the handlers ("Use baseline" / "Retry" / dismiss). Its only internal state
//  is the per-second `secondsLeft` countdown; its only logic is the reason taxonomy + the variant
//  selection. This core reproduces that exact behaviour as pure values + functions.
//
//  ADR-015 invariants reproduced (from the web header):
//    §I3 Baseline intact   — when `baselineAvailable`, the "Use baseline" affordance is offered.
//    §I9 Reason visible     — the reason taxonomy renders as a short, stable, searchable phrase.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a
/// bundle: the production app passes the P1/S10 facade, while tests pass the identity-fallback
/// resolver.
public typealias AiLimitBannerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Severity (web `variant`: 'info' | 'warning' | 'danger')

/// The banner severity — the native mirror of the web `AlertBanner` `variant`. Derived from the
/// `AiLimitInfo.bannerLevel` exactly as the web component does: `'critical' → danger`,
/// `'warn' → warning`, anything else (including `''`) → `info`.
public enum AiLimitSeverity: String, Sendable, Equatable, CaseIterable {
    case info
    case warning
    case danger

    /// Maps the backend `bannerLevel` string to a severity (web variant ternary).
    public static func forBannerLevel(_ bannerLevel: String) -> AiLimitSeverity {
        switch bannerLevel {
        case "critical": .danger
        case "warn": .warning
        default: .info
        }
    }

    /// The SF Symbol that names the severity in the banner — kept here (a plain string) so the
    /// mapping is asserted without rendering. The tint is applied at the view boundary (P1/S9
    /// tokens), never here.
    public var systemImageName: String {
        switch self {
        case .info: "info.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .danger: "exclamationmark.octagon.fill"
        }
    }
}

// MARK: - Reason copy (web `titleForReason` / `descriptionForReason`)

/// One reason's user-facing copy — the (key, English fallback) pair for the short heading and the
/// body description, so the taxonomy is a pure value the view resolves through the P1/S10 facade.
public struct AiLimitCopy: Sendable, Equatable {
    public let titleKey: String
    public let titleFallback: String
    public let descriptionKey: String
    public let descriptionFallback: String

    public init(titleKey: String, titleFallback: String, descriptionKey: String, descriptionFallback: String) {
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.descriptionKey = descriptionKey
        self.descriptionFallback = descriptionFallback
    }
}

/// The reason taxonomy — the port of the web `titleForReason` + `descriptionForReason` switch
/// tables as a static lookup keyed by reason. Alias reasons (the web grouped `case a, b:` labels)
/// are folded onto a canonical key by `normalized(_:)`; an unknown reason falls back to the generic
/// copy so a forward-compatible client still renders something sane (web `default` branch). New
/// backend reasons MUST be added to `table` AND the P1/S10 catalog.
public enum AiLimitReasonCopy {
    /// The combined heading + body copy for a reason (web `titleForReason` + `descriptionForReason`).
    public static func copy(for reason: String) -> AiLimitCopy {
        table[normalized(reason)] ?? generic
    }

    /// Folds the web's grouped reasons onto one canonical key (`output_tokens` → `input_tokens`,
    /// `unknown_feature_id` → `missing_feature_id`), mirroring the shared `case a, b:` branches.
    private static func normalized(_ reason: String) -> String {
        switch reason {
        case "output_tokens": "input_tokens"
        case "unknown_feature_id": "missing_feature_id"
        default: reason
        }
    }

    /// The forward-compatible fallback (web `default`).
    private static let generic = AiLimitCopy(
        titleKey: "ai.limit.title.generic",
        titleFallback: "Helix temporarily unavailable",
        descriptionKey: "ai.limit.desc.generic",
        descriptionFallback: "Helix features are temporarily unavailable. The non-Helix baseline "
            + "continues to work."
    )

    /// The reason → copy table (the canonical keys after `normalized(_:)`).
    private static let table: [String: AiLimitCopy] = [
        "cost_cap": AiLimitCopy(
            titleKey: "ai.limit.title.costCap",
            titleFallback: "Daily cost cap reached",
            descriptionKey: "ai.limit.desc.costCap",
            descriptionFallback: "You have reached your daily Helix cost limit. Helix features will "
                + "resume tomorrow or after you raise the cap in Settings."
        ),
        "cost_cap_unavailable": AiLimitCopy(
            titleKey: "ai.limit.title.costCapUnavailable",
            titleFallback: "Cost cap check unavailable",
            descriptionKey: "ai.limit.desc.costCapUnavailable",
            descriptionFallback: "Could not read your Helix usage history. Failing closed for safety."
        ),
        "settings_unavailable": AiLimitCopy(
            titleKey: "ai.limit.title.settingsUnavailable",
            titleFallback: "Helix settings unavailable",
            descriptionKey: "ai.limit.desc.settingsUnavailable",
            descriptionFallback: "Could not load your Helix settings. Helix is paused until settings "
                + "are reachable."
        ),
        "burst": AiLimitCopy(
            titleKey: "ai.limit.title.burst",
            titleFallback: "Too many Helix requests at once",
            descriptionKey: "ai.limit.desc.burst",
            descriptionFallback: "Too many Helix requests are in flight. The limiter is keeping the "
                + "system responsive."
        ),
        "per_minute": AiLimitCopy(
            titleKey: "ai.limit.title.perMinute",
            titleFallback: "Helix rate limit hit",
            descriptionKey: "ai.limit.desc.perMinute",
            descriptionFallback: "You have sent more Helix requests than allowed per minute. The "
                + "window resets shortly."
        ),
        "per_day": AiLimitCopy(
            titleKey: "ai.limit.title.perDay",
            titleFallback: "Daily Helix usage limit reached",
            descriptionKey: "ai.limit.desc.perDay",
            descriptionFallback: "You have used your daily Helix request budget. The budget resets "
                + "at UTC midnight."
        ),
        "input_tokens": AiLimitCopy(
            titleKey: "ai.limit.title.tokens",
            titleFallback: "Helix token quota exhausted",
            descriptionKey: "ai.limit.desc.tokens",
            descriptionFallback: "Your Helix token quota for this minute is exhausted. Try a shorter "
                + "prompt."
        ),
        "provider_unavailable": AiLimitCopy(
            titleKey: "ai.limit.title.providerUnavailable",
            titleFallback: "Helix provider unavailable",
            descriptionKey: "ai.limit.desc.providerUnavailable",
            descriptionFallback: "The Helix provider is not responding. The system will retry "
                + "automatically."
        ),
        "missing_feature_id": AiLimitCopy(
            titleKey: "ai.limit.title.featureMisconfigured",
            titleFallback: "Helix feature misconfigured",
            descriptionKey: "ai.limit.desc.featureMisconfigured",
            descriptionFallback: "This page is missing a Helix feature registration. Please report "
                + "this to your administrator."
        )
    ]
}

// MARK: - Countdown (web `secondsLeft` + the "Try again in Ns" line)

/// The pure countdown arithmetic + formatting — the native port of the web `secondsLeft` state and
/// its `setInterval` decrement. The model owns the clock (the `AiLimitTicker` seam); this enum owns
/// the value transitions so they are asserted without a timer.
public enum AiLimitCountdown {
    /// The token the localized template carries for the remaining seconds — matches the web
    /// `t('ai.limit.retryIn', …, { seconds })` interpolation contract.
    public static let secondsToken = "{seconds}"

    /// Retry is ready once the countdown has reached zero (web `secondsLeft <= 0`).
    public static func isRetryReady(secondsLeft: Int) -> Bool {
        secondsLeft <= 0
    }

    /// One countdown tick — decrement, clamped at zero (web `(s) => (s > 0 ? s - 1 : 0)`).
    public static func tick(_ secondsLeft: Int) -> Int {
        secondsLeft > 0 ? secondsLeft - 1 : 0
    }

    /// The initial countdown for a freshly-applied limit — never negative (web
    /// `setSecondsLeft(info.retryAfterS)`).
    public static func initial(retryAfterS: Int) -> Int {
        max(0, retryAfterS)
    }

    /// Builds the "Try again in Ns" line by substituting the remaining seconds into the localized
    /// template (web `Try again in ${secondsLeft}s`). Tolerates a template missing the token.
    public static func retryInText(seconds: Int, template: String) -> String {
        template.replacingOccurrences(of: secondsToken, with: String(max(0, seconds)))
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the banner's combined VoiceOver label from already-localised parts, so the spoken content
/// is asserted without rendering the view. Reads the title, the description, and — while counting
/// down — the remaining-time line, as one sentence.
public enum AiLimitBannerAccessibility {
    /// "{title}. {description}" and, when a countdown line is present, "… {countdown}", so VoiceOver
    /// announces the heading, the reason, and the wait in one pass. Parts that already end in
    /// terminal punctuation are joined with a single space so the sentence never doubles a period.
    public static func bannerLabel(title: String, description: String, countdown: String?) -> String {
        var parts = [title, description]
        if let countdown, !countdown.isEmpty {
            parts.append(countdown)
        }
        return parts.reduce(into: "") { accumulated, part in
            guard !part.isEmpty else { return }
            guard !accumulated.isEmpty else {
                accumulated = part
                return
            }
            let endsWithTerminal = accumulated.last.map { ".!?".contains($0) } ?? false
            accumulated += (endsWithTerminal ? " " : ". ") + part
        }
    }
}
