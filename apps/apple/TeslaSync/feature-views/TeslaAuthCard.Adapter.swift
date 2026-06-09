//
//  TeslaAuthCard.Adapter.swift
//  TeslaSync — P4 feature view · 0258 · TeslaAuthCard (Apple)
//
//  The testable, dependency-free projection core for the Tesla-auth status card — the SwiftUI parity
//  of features/system/components/status/TeslaAuthCard.tsx. Everything here is pure Foundation (no
//  store, no SwiftUI, no bundle) so the severity ladder (healthy → expiring → expired), the ISO
//  token-expiry parsing, the day-countdown arithmetic, the CTA selection, and the VoiceOver summary
//  are all unit tested in isolation against the exact web arithmetic.
//
//  Parity notes (reproduced verbatim from the web source — do NOT "fix" the arithmetic):
//    • severityFor: authenticated === false ⇒ disconnected; missing / unparseable expiry ⇒ unknown;
//      days = floor((exp - now) / 1d): days < 0 ⇒ expired, days <= 7 ⇒ warn, else ok.
//    • detail: disconnected ⇒ "No Tesla account is currently connected."; no expiry ⇒ "Token expiry
//      unknown …"; unparseable ⇒ "Token expiry unparseable."; past ⇒ "Expired today / {n}d ago …";
//      future ⇒ "later today" / "in 1 day" / "in {n} days".
//    • CTA: expired || disconnected ⇒ "Re-authenticate", else "Manage".
//

import Foundation

// MARK: - Severity ladder (web `Severity`)

/// The five auth situations the web card styles for, in worsening order. Drives the accent bar, the
/// shield glyph, the badge tone, and the CTA label.
public enum TeslaAuthSeverity: String, Sendable, Equatable, CaseIterable {
    case ok
    case warn
    case expired
    case disconnected
    case unknown
}

// MARK: - Token expiry (web `expiresAt` prop, tri-state)

/// The resolved token-expiry input — the native mirror of the web `expiresAt` string handling. The
/// web distinguishes a missing string (`!expiresAt`) from a present-but-unparseable one
/// (`!Number.isFinite(Date.parse(expiresAt))`); both yield `unknown` severity but different detail
/// copy, so the distinction is preserved here.
public enum TeslaAuthExpiry: Sendable, Equatable {
    case none
    case unparseable
    case at(Date)
}

// MARK: - ISO-8601 parsing (web `Date.parse`)

/// Pure port of the web `expiresAt` handling: a `nil`/empty string is "no expiry" (web falsy
/// `!expiresAt`), an unparseable string is `unparseable` (web `!Number.isFinite`), otherwise the
/// parsed instant. Internet-date-time with and without fractional seconds is accepted, covering the
/// backend's RFC-3339 `/auth/status` payloads.
public enum TeslaAuthDate {
    public static func expiry(from raw: String?) -> TeslaAuthExpiry {
        guard let raw, !raw.isEmpty else { return .none }
        guard let date = parse(raw) else { return .unparseable }
        return .at(date)
    }

    static func parse(_ raw: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: raw) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: raw)
    }
}

// MARK: - Detail buckets (web `detail` branches)

/// The day bucket the web detail copy distinguishes — extracted so the branch selection is unit
/// tested without any localization. The associated `Int` is the (already floored) whole-day count.
public enum TeslaAuthDetailKind: Sendable, Equatable {
    case disconnected
    case expiryUnknown
    case unparseable
    case expiredToday
    case expiredDaysAgo(Int)
    case expiresLaterToday
    case expiresInOneDay
    case expiresInDays(Int)
}

// MARK: - Severity + detail arithmetic (web `severityFor` / `detail`)

/// Pure severity/detail/CTA logic — the native port of the web `severityFor` + `detail` + the CTA
/// ternary. One day is 86 400 s; the day count uses floor toward −∞ exactly like the web
/// `Math.floor`, so the boundary behaviour (≤ 7 days ⇒ warn, < 0 ⇒ expired) matches bit-for-bit.
public enum TeslaAuthLogic {
    static let secondsPerDay: Double = 24 * 60 * 60

    /// Web `severityFor(authenticated, expiresAt, now)`.
    public static func severity(
        authenticated: Bool?,
        expiry: TeslaAuthExpiry,
        now: Date
    ) -> TeslaAuthSeverity {
        if authenticated == false { return .disconnected }
        switch expiry {
        case .none, .unparseable:
            return .unknown
        case let .at(exp):
            let days = floorDays(exp.timeIntervalSince(now))
            if days < 0 { return .expired }
            if days <= 7 { return .warn }
            return .ok
        }
    }

    /// Web `detail` — the `disconnected` short-circuit mirrors the web ordering (the
    /// account-not-connected copy wins even when an expiry happens to be present).
    public static func detail(
        severity: TeslaAuthSeverity,
        expiry: TeslaAuthExpiry,
        now: Date
    ) -> TeslaAuthDetailKind {
        if severity == .disconnected { return .disconnected }
        switch expiry {
        case .none:
            return .expiryUnknown
        case .unparseable:
            return .unparseable
        case let .at(exp):
            let interval = exp.timeIntervalSince(now)
            if interval < 0 {
                let ago = floorDays(-interval)
                return ago == 0 ? .expiredToday : .expiredDaysAgo(ago)
            }
            let days = floorDays(interval)
            if days == 0 { return .expiresLaterToday }
            if days == 1 { return .expiresInOneDay }
            return .expiresInDays(days)
        }
    }

    /// Web CTA ternary: expired/disconnected ⇒ "Re-authenticate", else "Manage".
    public static func isReauthenticate(_ severity: TeslaAuthSeverity) -> Bool {
        severity == .expired || severity == .disconnected
    }

    static func floorDays(_ interval: TimeInterval) -> Int {
        Int(floor(interval / secondsPerDay))
    }
}

// MARK: - Tone descriptor (web `TONE` map, SwiftUI-free)

/// The per-severity visual descriptor — the SwiftUI-free port of the web `TONE` map + the lucide
/// shield glyph. The `accent` is mapped to a concrete `Color` at the view boundary (Views.swift);
/// the badge label is carried as a localization key + web fallback so the projection resolves it
/// through the P1/S10 facade rather than embedding English here.
public struct TeslaAuthTone: Sendable, Equatable {
    public enum Accent: String, Sendable, Equatable, CaseIterable {
        case success
        case warning
        case danger
        case neutral
    }

    public let accent: Accent
    public let symbol: String
    public let badgeLabelKey: String
    public let badgeLabelFallback: String

    public init(accent: Accent, symbol: String, badgeLabelKey: String, badgeLabelFallback: String) {
        self.accent = accent
        self.symbol = symbol
        self.badgeLabelKey = badgeLabelKey
        self.badgeLabelFallback = badgeLabelFallback
    }

    /// Web `TONE[severity]` — bar/icon/badge tone + the lucide shield SF Symbol peer
    /// (ShieldCheck → checkmark.shield, ShieldAlert → exclamationmark.shield, ShieldX → xmark.shield).
    public static func tone(for severity: TeslaAuthSeverity) -> TeslaAuthTone {
        switch severity {
        case .ok:
            TeslaAuthTone(
                accent: .success,
                symbol: "checkmark.shield.fill",
                badgeLabelKey: "teslaAuth.status.connected",
                badgeLabelFallback: "Connected"
            )
        case .warn:
            TeslaAuthTone(
                accent: .warning,
                symbol: "exclamationmark.shield.fill",
                badgeLabelKey: "teslaAuth.status.expiresSoon",
                badgeLabelFallback: "Expires soon"
            )
        case .expired:
            TeslaAuthTone(
                accent: .danger,
                symbol: "xmark.shield.fill",
                badgeLabelKey: "teslaAuth.status.tokenExpired",
                badgeLabelFallback: "Token expired"
            )
        case .disconnected:
            TeslaAuthTone(
                accent: .danger,
                symbol: "xmark.shield.fill",
                badgeLabelKey: "teslaAuth.status.notConnected",
                badgeLabelFallback: "Not connected"
            )
        case .unknown:
            TeslaAuthTone(
                accent: .neutral,
                symbol: "exclamationmark.shield.fill",
                badgeLabelKey: "teslaAuth.status.unknown",
                badgeLabelFallback: "Unknown"
            )
        }
    }
}

// MARK: - Integer formatting (port of numberFormat.ts `fmtInt`)

/// Locale-grouped integer formatting for the day counts embedded in the detail copy — a small port
/// of the web `fmtInt` (half-up, no fraction digits). Locale is injectable for deterministic tests.
public enum TeslaAuthNumber {
    public static func integer(_ value: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary from already-localized parts, so the spoken content is asserted
/// without rendering the view: "{title}, {status}. {detail}".
public enum TeslaAuthAccessibility {
    public static func summary(title: String, status: String, detail: String) -> String {
        "\(title), \(status). \(detail)"
    }
}
