//
//  TeslaAuthCard.Projection.swift
//  TeslaSync — P4 feature view · 0258 · TeslaAuthCard (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted from
//  the state holder so the web component body (the severity ladder, the detail copy, the CTA label)
//  plus the P4 leaf contract stay unit testable in isolation (no store, no SwiftUI).
//
//  Web branch order (reproduced):
//    isLoading & nothing resolved → loading skeleton (P4 leaf)
//    explicit fetch error         → retryable error (P4 leaf)
//    severity == unknown          → empty (web 'unknown' card — friendly, never blank)
//    otherwise                    → data (connected / expiring / expired / disconnected)
//

import Foundation

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `TeslaAuthCard` render plus the P4 leaf contract. Unit tested across loading / error / empty /
/// data, every severity, and every detail bucket.
public enum TeslaAuthProjection {
    public static func resolve(
        _ input: TeslaAuthInput,
        locale: Locale = .current
    ) -> TeslaAuthResolved {
        // Initial fetch — nothing resolved yet (P4 leaf loading skeleton). A background refresh that
        // still carries a known auth signal is NOT loading; it keeps rendering the card.
        if input.isLoading, input.authenticated == nil, input.expiresAtRaw == nil, input.errorMessage == nil {
            return TeslaAuthResolved(phase: .loading)
        }
        // Explicit fetch failure → retryable error (P4 leaf; the web has no error branch — it is the
        // sanctioned leaf enhancement so the operator can re-request).
        if let message = input.errorMessage, !message.isEmpty {
            return TeslaAuthResolved(phase: .error(message))
        }

        let expiry = TeslaAuthDate.expiry(from: input.expiresAtRaw)
        let severity = TeslaAuthLogic.severity(
            authenticated: input.authenticated,
            expiry: expiry,
            now: input.now
        )
        let presentation = presentation(
            severity: severity,
            expiry: expiry,
            now: input.now,
            locale: locale
        )

        // Web 'unknown' (no concrete auth value) is the card's friendly "empty" surface; the four
        // concrete severities are the data surface. Both render the same chrome, never a blank box.
        if severity == .unknown {
            return TeslaAuthResolved(phase: .empty(presentation))
        }
        return TeslaAuthResolved(phase: .data(presentation))
    }

    // MARK: Presentation (web TONE + detail + CTA + a11y summary)

    static func presentation(
        severity: TeslaAuthSeverity,
        expiry: TeslaAuthExpiry,
        now: Date,
        locale: Locale
    ) -> TeslaAuthPresentation {
        let tone = TeslaAuthTone.tone(for: severity)
        let badgeLabel = TeslaAuthStrings.string(tone.badgeLabelKey, tone.badgeLabelFallback)
        let detailKind = TeslaAuthLogic.detail(severity: severity, expiry: expiry, now: now)
        let detail = detailText(detailKind, locale: locale)
        let isReauth = TeslaAuthLogic.isReauthenticate(severity)
        let ctaLabel = isReauth
            ? TeslaAuthStrings.string("teslaAuth.cta.reauthenticate", "Re-authenticate")
            : TeslaAuthStrings.string("teslaAuth.cta.manage", "Manage")
        let title = TeslaAuthStrings.string("teslaAuth.title", "Tesla account")
        let summary = TeslaAuthAccessibility.summary(title: title, status: badgeLabel, detail: detail)
        return TeslaAuthPresentation(
            severity: severity,
            accent: tone.accent,
            symbol: tone.symbol,
            badgeLabel: badgeLabel,
            detail: detail,
            ctaLabel: ctaLabel,
            isReauthenticate: isReauth,
            accessibilitySummary: summary
        )
    }

    // MARK: Detail copy (web `detail` strings)

    /// Resolves the detail bucket to localized copy — the native port of the web `detail` strings.
    /// The embedded day counts are locale-formatted; the `%@d` short form keeps the unit
    /// translator-owned.
    static func detailText(_ kind: TeslaAuthDetailKind, locale: Locale) -> String {
        switch kind {
        case .disconnected:
            return TeslaAuthStrings.string(
                "teslaAuth.detail.disconnected",
                "No Tesla account is currently connected."
            )
        case .expiryUnknown:
            return TeslaAuthStrings.string(
                "teslaAuth.detail.expiryUnknown",
                "Token expiry unknown — re-authenticate to refresh."
            )
        case .unparseable:
            return TeslaAuthStrings.string(
                "teslaAuth.detail.unparseable",
                "Token expiry unparseable."
            )
        case .expiredToday:
            return TeslaAuthStrings.string(
                "teslaAuth.detail.expiredToday",
                "Expired today — re-authenticate to resume Fleet API calls."
            )
        case let .expiredDaysAgo(days):
            let short = TeslaAuthStrings.format(
                "teslaAuth.unit.daysShort",
                "%@d",
                TeslaAuthNumber.integer(days, locale: locale)
            )
            return TeslaAuthStrings.format(
                "teslaAuth.detail.expiredAgo",
                "Expired %@ ago — re-authenticate to resume Fleet API calls.",
                short
            )
        case .expiresLaterToday:
            return TeslaAuthStrings.string(
                "teslaAuth.detail.expiresLaterToday",
                "Token expires later today."
            )
        case .expiresInOneDay:
            return TeslaAuthStrings.string(
                "teslaAuth.detail.expiresInOneDay",
                "Token expires in 1 day."
            )
        case let .expiresInDays(days):
            return TeslaAuthStrings.format(
                "teslaAuth.detail.expiresInDays",
                "Token expires in %@ days.",
                TeslaAuthNumber.integer(days, locale: locale)
            )
        }
    }
}
