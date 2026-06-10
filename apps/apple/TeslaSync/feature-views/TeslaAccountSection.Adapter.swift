//
//  TeslaAccountSection.Adapter.swift
//  TeslaSync — P4 feature view · 0216 · TeslaAccountSection (Apple)
//
//  The pure, dependency-free projection core for the Tesla-account settings surface — the
//  SwiftUI-agnostic parity of web/src/features/settings/components/TeslaAccountSection.tsx. Everything
//  here is Foundation-only (no store, no SwiftUI, no bundle) so the status ladder (connected /
//  disconnected / not-connected), the ISO token-expiry parsing, the "expires within 7 days"
//  arithmetic, the token-expiry datetime formatting, the synced-count copy, and the VoiceOver
//  summaries are all unit tested in isolation against the exact web logic.
//
//  Parity notes (reproduced verbatim from the web source — do NOT "fix" the arithmetic):
//    • statusKind: `authenticated && !pillDisconnected` ⇒ connected; else `pillDisconnected` ⇒
//      disconnected; else ⇒ notConnected.
//    • action set: `!authenticated` ⇒ the Connect button; else the Refresh / Sync / Re-authorize /
//      Disconnect set (note: this branch ignores `pillDisconnected`, exactly like the web).
//    • expiringSoon: only when authenticated && a parseable expiry && `0 < remaining ≤ 7 days`;
//      days = max(1, ceil(remaining / 1 day)).
//

import Foundation

// MARK: - Status kind (web status-row branch)

/// The three account situations the web status row styles for. Drives the status glyph, the status
/// label tone, and (for `disconnected`) the reconnect detail line.
public enum TeslaAccountStatusKind: String, Sendable, Equatable, CaseIterable {
    case connected
    case disconnected
    case notConnected
}

// MARK: - Token expiry (web `auth.expires_at`, tri-state)

/// The resolved token-expiry input — the native mirror of the web `auth.expires_at` handling. The web
/// distinguishes a missing string (falsy `!auth.expires_at`) from a present-but-unparseable one
/// (`Number.isNaN(Date.parse(...))`); both suppress the "expires soon" pill but render different
/// token-expiry copy, so the distinction is preserved here.
public enum TeslaAccountExpiry: Sendable, Equatable {
    case none
    case unparseable
    case at(Date)
}

// MARK: - ISO-8601 parsing (web `new Date(...)`)

/// Pure port of the web `auth.expires_at` handling: a `nil`/empty string is "no expiry" (web falsy
/// `!auth.expires_at`), an unparseable string is `unparseable` (web `Number.isNaN`), otherwise the
/// parsed instant. Internet-date-time with and without fractional seconds is accepted, covering the
/// backend's RFC-3339 `/auth/status` payloads.
public enum TeslaAccountDate {
    public static func expiry(from raw: String?) -> TeslaAccountExpiry {
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

    /// The token-expiry datetime label (web `formatDateTime(auth.expires_at)`): a locale-ordered
    /// "MMM d, y, h:mm a" rendering of the parsed instant. Locale + time zone are injectable so the
    /// adapter tests are deterministic; production uses the device locale + zone.
    public static func formatExpiry(
        _ date: Date,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("yMMMdjm")
        return formatter.string(from: date)
    }
}

// MARK: - Status + expiry arithmetic (web `statusKind` / `expiringSoon`)

/// Pure status/expiry logic — the native port of the web status-row branch + the `expiringSoon`
/// IIFE. One day is 86 400 s; the day count uses `ceil` toward +∞ exactly like the web
/// `Math.ceil`, and the `max(1, …)` floor matches the web so a token expiring in a few hours still
/// reads "Expires in 1d".
public enum TeslaAccountLogic {
    static let secondsPerDay: Double = 24 * 60 * 60
    static let expiringWindowDays = 7

    /// Web status-row branch: `authenticated && !pillDisconnected` ⇒ connected; else
    /// `pillDisconnected` ⇒ disconnected; else ⇒ notConnected. A `nil` (unknown) authenticated flag
    /// is treated as not-authenticated, matching the web falsy `auth?.authenticated`.
    public static func statusKind(authenticated: Bool?, pillDisconnected: Bool) -> TeslaAccountStatusKind {
        if authenticated == true, !pillDisconnected { return .connected }
        if pillDisconnected { return .disconnected }
        return .notConnected
    }

    /// Web action-set branch: `!auth?.authenticated` shows the Connect button; otherwise the
    /// authenticated control set. Note this intentionally ignores `pillDisconnected`, exactly like
    /// the web — a token-expired pill still shows the Refresh / Sync / Re-authorize / Disconnect set.
    public static func isAuthenticated(_ authenticated: Bool?) -> Bool {
        authenticated == true
    }

    /// Web `expiringSoon` IIFE — the soft-warning day count, or `nil` when the token is missing /
    /// unparseable / already expired / more than the 7-day window out. `days = max(1, ceil(remaining
    /// / 1 day))`.
    public static func expiringSoonDays(
        authenticated: Bool?,
        expiry: TeslaAccountExpiry,
        now: Date
    ) -> Int? {
        guard authenticated == true, case let .at(exp) = expiry else { return nil }
        let remaining = exp.timeIntervalSince(now)
        let windowSeconds = Double(expiringWindowDays) * secondsPerDay
        guard remaining > 0, remaining <= windowSeconds else { return nil }
        return max(1, Int(ceil(remaining / secondsPerDay)))
    }
}

// MARK: - Integer formatting (port of numberFormat.ts `fmtInt`)

/// Locale-grouped integer formatting for the day + vehicle counts embedded in the copy — a small
/// port of the web `fmtInt` (half-up, no fraction digits). Locale is injectable for deterministic
/// tests.
public enum TeslaAccountNumber {
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

/// Builds the VoiceOver summary for the status row from already-localized parts, so the spoken
/// content is asserted without rendering the view: "{title}, {status}. {detail}". The detail is
/// omitted (no trailing ". ") when empty so the not-connected row reads cleanly.
public enum TeslaAccountAccessibility {
    public static func summary(title: String, status: String, detail: String) -> String {
        let trimmed = detail.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return "\(title), \(status)."
        }
        return "\(title), \(status). \(trimmed)"
    }
}
