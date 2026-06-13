//
//  MaintenanceBanner.Adapter.swift
//  TeslaSync — P4 shared surface · 0127 · MaintenanceBanner (Apple)
//
//  The testable, dependency-light core for the maintenance / degraded-mode banner — the SwiftUI parity
//  of `components/feedback/MaintenanceBanner.tsx`. Everything here is pure (Foundation only): the
//  service-mode taxonomy (the web `data.mode` → render branch), the dismissal fingerprint (the web
//  `fingerprint(mode, message, until, updatedAt)`), the `Date.parse(until)` → epoch-millis bridge, the
//  remaining-window classification + `formatRemaining` short-form duration, the `{{time}}`
//  interpolation, the title / body / countdown / dismiss copy builders (every `t('serviceMode.banner.*',
//  …)` call, including the `message.trim() || default` branch), and the VoiceOver label builder. No
//  query store, no bundle, no rendered view, so each piece is unit tested in isolation.
//
//  Parity note: the web surface polls `/system/health` (via `useSystemHealth`) and renders a sticky
//  banner only when the resolved `mode` is `"degraded"` or `"maintenance"`. It shows a live countdown to
//  `maintenance_until` and supports a per-snapshot dismissal keyed on `maintenance_updated_at` (or a
//  deterministic fingerprint of mode/message/until when updated_at is absent), so a freshly-pushed
//  banner re-surfaces while a stale dismissal stays dismissed. This core reproduces those pure
//  derivations as values and functions; the SwiftUI chrome layers on top in the sibling view files, and
//  the health snapshot arrives through the P1/S8 source seam (never read directly by the view).
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias MaintenanceBannerResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Service mode (web `data.mode`)

/// The resolved service mode the backend emits on `/system/health` — the native mirror of the web
/// `SystemHealth['mode']` union (`'ok' | 'degraded' | 'maintenance'`). `ok` hides the banner; the other
/// two surface it. Unknown / future raw values fall through to `ok` (the web default — the banner stays
/// hidden rather than rendering an unknown state).
public enum MaintenanceBannerServiceMode: String, Sendable, Equatable, CaseIterable {
    case ok
    case degraded
    case maintenance

    /// Maps the backend `mode` string to a case (web `data?.mode ?? 'ok'`). Case-sensitive, matching
    /// the web `===` comparison; unknown / absent values resolve to `.ok`.
    public static func forRaw(_ raw: String) -> MaintenanceBannerServiceMode {
        MaintenanceBannerServiceMode(rawValue: raw) ?? .ok
    }

    /// Web `mode !== 'ok'` — the banner is shown for this mode.
    public var isActive: Bool {
        self != .ok
    }

    /// Web `isMaintenance = mode === 'maintenance'` — selects the wrench icon + amber tone + the
    /// maintenance copy, versus the degraded triangle + sky tone.
    public var isMaintenance: Bool {
        self == .maintenance
    }

    /// The SF Symbol that names the mode — kept here (a plain string) so the mapping is asserted without
    /// rendering. The tint is applied at the view boundary (P1/S9 tokens), never here. Web `Wrench` →
    /// `wrench.and.screwdriver.fill`; web `AlertTriangle` → `exclamationmark.triangle.fill`.
    public var systemImageName: String {
        switch self {
        case .maintenance: "wrench.and.screwdriver.fill"
        case .degraded: "exclamationmark.triangle.fill"
        case .ok: "checkmark.circle.fill"
        }
    }
}

// MARK: - Dismissal fingerprint (web `fingerprint(...)`)

/// Builds the per-snapshot dismissal fingerprint — the verbatim port of the web `fingerprint`:
///
///     function fingerprint(mode, message, until, updatedAt) {
///       if (updatedAt) return `u:${updatedAt}`
///       return `s:${mode}|${message}|${until}`
///     }
///
/// A non-empty `updatedAt` keys the dismissal on the operator's update instant; otherwise a
/// deterministic composite of mode/message/until is used. Pure + public so the keying is asserted
/// directly (it is the contract that makes "dismiss this banner, but re-surface a freshly-pushed one"
/// honest).
public enum MaintenanceBannerFingerprint {
    public static func make(mode: String, message: String, until: String, updatedAt: String) -> String {
        if !updatedAt.isEmpty {
            return "u:\(updatedAt)"
        }
        return "s:\(mode)|\(message)|\(until)"
    }
}

// MARK: - Instant parsing (web `Date.parse(until)`)

/// Parses the `maintenance_until` ISO-8601 timestamp to epoch milliseconds — the native parity of the
/// web `Date.parse(until)` guarded by `Number.isFinite`. Tolerates the RFC-3339 forms the Go backend
/// emits (with or without fractional seconds, `Z` or numeric offset). An empty or unparseable value
/// returns `nil` (web `untilMs === null`), which suppresses the countdown. Pure + public so the parse is
/// asserted without a view.
public enum MaintenanceBannerInstant {
    /// Returns the epoch-millisecond value of the timestamp, or `nil` when empty / unparseable. The
    /// formatters are built locally (not cached in a `static let`) because `ISO8601DateFormatter` is not
    /// `Sendable` — a shared static instance is a data race under Swift 6 strict concurrency, and this
    /// runs at most once per health snapshot (the parsed millis are cached on the payload thereafter).
    public static func parseMs(_ iso: String) -> Double? {
        let trimmed = iso.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        for options in [
            ISO8601DateFormatter.Options([.withInternetDateTime, .withFractionalSeconds]),
            ISO8601DateFormatter.Options([.withInternetDateTime])
        ] {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = options
            if let date = formatter.date(from: trimmed) {
                return date.timeIntervalSince1970 * 1000
            }
        }
        return nil
    }
}

// MARK: - Remaining-window classification (web countdown if-ladder)

/// The three countdown branches — the native mirror of the web render's remaining-time ladder:
///
///     const remaining = untilMs - now
///     if (remaining > 1000)  → 'Ends in {{time}}'
///     else if (remaining > -1000) → 'Ending now'
///     else → 'Window has ended; refresh to confirm.'
///
/// Keyed by the same ±1000 ms thresholds so the native countdown flips at the identical instants.
public enum MaintenanceBannerRemaining: Sendable, Equatable {
    case upcoming
    case endingNow
    case ended

    /// Classifies a remaining-millisecond delta into a branch (web thresholds verbatim).
    public static func classify(remainingMs: Double) -> MaintenanceBannerRemaining {
        if remainingMs > 1000 {
            return .upcoming
        }
        if remainingMs > -1000 {
            return .endingNow
        }
        return .ended
    }
}

// MARK: - Duration short-form (web `formatRemaining`)

/// Renders a remaining-millisecond delta as the web short form — the verbatim port of `formatRemaining`:
///
///     hours > 0 → "Hh MMm"   (minutes zero-padded to 2)
///     minutes > 0 → "Mm SSs"  (seconds zero-padded to 2)
///     else → "Ss"
///
/// Negative / sub-second inputs clamp to `0` (web `Math.max(0, Math.floor(ms / 1000))`). Pure + public
/// so each branch is asserted without a clock.
public enum MaintenanceBannerDuration {
    public static func format(ms: Double) -> String {
        let total = max(0, Int((ms / 1000).rounded(.down)))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let seconds = total % 60
        if hours > 0 {
            return "\(hours)h \(pad(minutes))m"
        }
        if minutes > 0 {
            return "\(minutes)m \(pad(seconds))s"
        }
        return "\(seconds)s"
    }

    private static func pad(_ value: Int) -> String {
        String(format: "%02d", value)
    }
}

// MARK: - i18next interpolation (web `t(key, { time })`)

/// Replaces `{{token}}` markers with their values — the native parity of the web i18next interpolation
/// the banner relies on for the `{{time}}` substitution in the countdown copy. Pure + public so the
/// substitution is asserted directly.
public enum MaintenanceBannerInterpolation {
    public static func apply(_ template: String, _ values: [String: String]) -> String {
        var output = template
        for (token, value) in values {
            output = output.replacingOccurrences(of: "{{\(token)}}", with: value)
        }
        return output
    }
}

// MARK: - Copy (web `t('serviceMode.banner.*', …)` + `t('common.dismiss', …)`)

/// Builds the banner's copy — the native port of the web render's `t()` calls:
///
///     title = isMaintenance ? t('serviceMode.banner.maintenanceTitle', 'Scheduled maintenance')
///                           : t('serviceMode.banner.degradedTitle', 'Service is degraded')
///     body  = message.trim() || (isMaintenance
///               ? t('serviceMode.banner.defaultMaintenance', 'Maintenance is in progress. …')
///               : t('serviceMode.banner.defaultDegraded', 'Some features may be slow …'))
///     countdown (per the remaining branch): endsIn '{{time}}' / endingNow / ended
///     dismiss = t('common.dismiss', 'Dismiss')
///
/// Pure + public so every branch is unit tested.
public enum MaintenanceBannerMessage {
    /// Web title branch — the maintenance vs degraded headline.
    public static func title(
        isMaintenance: Bool,
        strings: MaintenanceBannerResolve = MaintenanceBannerStrings.string
    ) -> String {
        isMaintenance
            ? strings("serviceMode.banner.maintenanceTitle", "Scheduled maintenance")
            : strings("serviceMode.banner.degradedTitle", "Service is degraded")
    }

    /// Web body branch: the operator message when non-blank (trimmed), else the per-mode default copy.
    public static func body(
        isMaintenance: Bool,
        message: String,
        strings: MaintenanceBannerResolve = MaintenanceBannerStrings.string
    ) -> String {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            return trimmed
        }
        return isMaintenance
            ? strings(
                "serviceMode.banner.defaultMaintenance",
                "Maintenance is in progress. Live data may be paused."
            )
            : strings(
                "serviceMode.banner.defaultDegraded",
                "Some features may be slow or unavailable while we work on it."
            )
    }

    /// Web countdown branch — resolves the remaining delta to its localized line. `upcoming`
    /// interpolates the `formatRemaining` short form into `'Ends in {{time}}'`.
    public static func countdown(
        remainingMs: Double,
        strings: MaintenanceBannerResolve = MaintenanceBannerStrings.string
    ) -> String {
        switch MaintenanceBannerRemaining.classify(remainingMs: remainingMs) {
        case .upcoming:
            let template = strings("serviceMode.banner.endsIn", "Ends in {{time}}")
            return MaintenanceBannerInterpolation.apply(
                template,
                ["time": MaintenanceBannerDuration.format(ms: remainingMs)]
            )
        case .endingNow:
            return strings("serviceMode.banner.endingNow", "Ending now")
        case .ended:
            return strings("serviceMode.banner.ended", "Window has ended; refresh to confirm.")
        }
    }

    /// Web `t('common.dismiss', 'Dismiss')` — the dismiss control's accessibility label.
    public static func dismiss(strings: MaintenanceBannerResolve = MaintenanceBannerStrings.string) -> String {
        strings("common.dismiss", "Dismiss")
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the banner's VoiceOver label from the already-localised title + body + optional countdown, so
/// the spoken content is asserted without rendering. Mirrors the web banner (`role` alert/status,
/// `aria-live="polite"`) announcing its title, body, and countdown in one pass, while the dismiss
/// control stays individually focusable with its own label.
public enum MaintenanceBannerAccessibility {
    /// Joins the title + body + countdown into one spoken sentence, collapsing whitespace in each part
    /// (a wrapped body never reads a double space, the ends are trimmed) and dropping empty parts so no
    /// stray separator is spoken.
    public static func bannerLabel(title: String, body: String, countdown: String?) -> String {
        [collapse(title), collapse(body), collapse(countdown ?? "")]
            .filter { !$0.isEmpty }
            .joined(separator: ". ")
    }

    private static func collapse(_ text: String) -> String {
        text
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }
}
