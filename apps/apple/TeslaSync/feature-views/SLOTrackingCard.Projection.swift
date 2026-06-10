//
//  SLOTrackingCard.Projection.swift
//  TeslaSync — P4 feature view · 0253 · SLOTrackingCard (Apple)
//
//  The pure projection + formatting + accessibility core for the personal
//  "Uptime & SLO" surface — split out of `.Adapter` (transport DTOs + window
//  identity) so each file stays focused and within the lint length budget.
//  Everything here is Foundation-only and dependency-free, so the load-status →
//  phase resolution, the percentage-vs-target tone, the target clamp/parse rules
//  (web `loadTarget` / `handleSaveTarget`), the web number/percent formatters, and
//  the VoiceOver summaries are all unit-tested without a bundle or a rendered view.
//

import Foundation

// MARK: - Load status + connection + render phase

/// The bound source's load status for the uptime query (web `isLoading` /
/// resolved / `error`), projected by `resolvePhase`.
public enum SLOLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-state freshness (ADR-013): the uptime read refetches on a 60s interval, so
/// a snapshot can go `stale` (auto-refresh nudge) or `offline` (the cached figure
/// stays visible behind an offline chip). The web card has no freshness concept;
/// this is the prompt's stale / offline contract.
public enum SLOConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the data region should render. The web always renders the figure (showing
/// "—" while loading); the prompt widens that with explicit loading / error
/// envelopes and a friendly `empty` state when the query resolves with no figure.
public enum SLOPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

// MARK: - Percentage tone (web `tone` useMemo)

/// The semantic tone of the uptime figure relative to the personal target — the
/// native parity of the web `tone` memo (`green-300` / `amber-300` / `red-300` /
/// muted). Drives the big percentage color.
public enum SLOTone: String, Sendable, Equatable, CaseIterable, Identifiable {
    /// At or above target (web `pct >= target` → green).
    case onTarget
    /// Within one point below target (web `pct >= target - 1` → amber).
    case nearTarget
    /// More than a point below target (web default → red).
    case belowTarget
    /// No figure yet (web `pct == null` → muted).
    case unknown

    public var id: String {
        rawValue
    }
}

// MARK: - Projection core (pure)

/// The dependency-free projection from the uptime snapshot + the personal target to
/// view-ready values + a render phase. A faithful port of the web component's
/// `tone`, `loadTarget` / `handleSaveTarget`, and caveat logic.
public enum SLOTrackingProjection {
    /// The personal-target default (web `loadTarget()` returns 99 when unset/invalid).
    public static let defaultTarget: Double = 99

    /// Resolves the render phase from the load status and whether a figure exists.
    /// `content` shows the figure; `empty` is the friendly fallback only when the
    /// query resolved with no snapshot at all.
    public static func resolvePhase(_ status: SLOLoadStatus, hasSnapshot: Bool) -> SLOPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasSnapshot ? .content : .empty
        }
    }

    /// The percentage tone vs the target — the exact web ladder: `nil → unknown`,
    /// `>= target → onTarget`, `>= target - 1 → nearTarget`, else `belowTarget`.
    public static func tone(percent: Double?, target: Double) -> SLOTone {
        guard let percent else { return .unknown }
        if percent >= target { return .onTarget }
        if percent >= target - 1 { return .nearTarget }
        return .belowTarget
    }

    /// Clamps a candidate personal target to the web valid range, returning `nil`
    /// for anything outside it — the web `loadTarget` predicate
    /// `Number.isFinite(n) && n > 0 && n <= 100` (the caller substitutes
    /// `defaultTarget` for `nil`).
    public static func clampTarget(_ candidate: Double?) -> Double? {
        guard let candidate, candidate.isFinite, candidate > 0, candidate <= 100 else { return nil }
        return candidate
    }

    /// Loads a persisted target value, substituting the default when missing or out
    /// of range (web `loadTarget()`).
    public static func loadTarget(_ stored: Double?) -> Double {
        clampTarget(stored) ?? defaultTarget
    }

    /// Parses + validates an edited target draft the same way the web
    /// `handleSaveTarget` does: `Number(draft)` must be finite, `> 0`, and `<= 100`,
    /// else the edit is rejected (the caller reverts). Parsing is locale-invariant
    /// to mirror JS `Number()` on a `type="number"` input.
    public static func parseTarget(_ draft: String) -> Double? {
        let trimmed = draft.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, let value = Double(trimmed) else { return nil }
        return clampTarget(value)
    }

    /// Whether the snapshot caveat should show — the web guard
    /// `data?.historical_source && data.historical_source !== 'series'`.
    public static func showsCaveat(_ snapshot: UptimeWindowDTO?) -> Bool {
        guard let snapshot else { return false }
        return !snapshot.isSeries
    }
}

// MARK: - Formatting (web numberFormat helpers + JS String() parity)

/// Locale-aware percentage formatting + the locale-invariant target token — the
/// native parity of the web `fmtPercent(pct, 2)` and the `String(target)` /
/// `Number(draft)` round-trip on the `type="number"` target input. Pure + testable:
/// each entry point takes an explicit locale and returns the "—" em-dash fallback
/// for a missing figure (web `pct == null ? '—'`).
public enum SLOTrackingFormat {
    /// Locale-grouped decimal with a fixed fraction count (web `fmtNumber(v, d)`).
    public static func number(_ value: Double, fractionDigits: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: value))
            ?? String(format: "%.\(fractionDigits)f", value)
    }

    /// The uptime figure as a percentage string (web `fmtPercent(pct, 2)`), or the
    /// em-dash when there is no figure (web `pct == null ? '—'`).
    public static func percent(_ value: Double?, locale: Locale = .current) -> String {
        guard let value else { return SLOTrackingDisplay.emDash }
        return "\(number(value, fractionDigits: 2, locale: locale))%"
    }

    /// The personal-target token rendered next to "Target …%", locale-invariant to
    /// mirror the web `{target}` (JS `String(number)`): no grouping, "." decimal,
    /// trailing zeros dropped (so `99 → "99"`, `99.5 → "99.5"`).
    public static func targetToken(_ value: Double) -> String {
        if value == value.rounded() {
            return String(Int(value))
        }
        var text = String(value)
        if text.contains(".") {
            while text.hasSuffix("0") {
                text.removeLast()
            }
            if text.hasSuffix(".") {
                text.removeLast()
            }
        }
        return text
    }

    /// The component count rendered in the subtitle — React prints `{count}`
    /// verbatim (no grouping), so the small tallies render invariantly; a missing
    /// count is the em-dash (web `healthy_count ?? '—'`).
    public static func count(_ value: Int?) -> String {
        guard let value else { return SLOTrackingDisplay.emDash }
        return String(value)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without a
/// bundle, exactly like the view's P1/S10 facade.
public enum SLOTrackingAccessibility {
    /// The "X / Y components healthy" clause shared by the visible subtitle and the
    /// VoiceOver value (web ``{healthy ?? '—'} / {total ?? '—'} components healthy``).
    public static func componentsClause(
        healthy: Int?,
        total: Int?,
        localize: (String, String) -> String
    ) -> String {
        let suffix = localize("components healthy", "components healthy")
        return "\(SLOTrackingFormat.count(healthy)) / \(SLOTrackingFormat.count(total)) \(suffix)"
    }

    /// The live-region summary for the figure (web `aria-live="polite"` on the big
    /// number): the title, the percentage, the window label, and the component
    /// tally — or a friendly "unavailable" when there is no figure yet.
    public static func figureSummary(
        percentText: String,
        windowLabel: String,
        componentsClause: String,
        hasFigure: Bool,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("Uptime & SLO", "Uptime & SLO")
        guard hasFigure else {
            let unavailable = localize("Uptime unavailable", "Uptime unavailable")
            return "\(title): \(unavailable), \(windowLabel)"
        }
        let uptimeWord = localize("uptime", "uptime")
        return "\(title): \(percentText) \(uptimeWord), \(windowLabel), \(componentsClause)"
    }
}
