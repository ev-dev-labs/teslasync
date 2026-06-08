//
//  RateLimitStatusPanel.Adapter.swift
//  TeslaSync — P4 feature view · 0038 · RateLimitStatusPanel (Apple)
//
//  The testable projection core for the Rate-limit budgets panel — the SwiftUI
//  parity of features/admin/components/RateLimitStatusPanel.tsx plus the leaf
//  formatters it leans on (fmtNumber, formatRelative, formatDurationMsLong) and the
//  per-row maths the web `RateLimitRow` does inline (bar fraction, refill countdown,
//  window phrasing). Everything here is pure + dependency-free (no store, no bundle,
//  no rendered view) so the wire decode, the number/duration/relative formatting,
//  the row projection, and the VoiceOver summaries are all unit tested in isolation.
//

import Foundation

// MARK: - Severity (web `RateLimitSeverity` union + SEVERITY_COLOR / tone map)

/// The colour band the backend reports per scope (web `'ok' | 'warn' | 'critical'`).
/// Decoding is lenient: an unrecognised band degrades to `.warn` (amber, "needs a
/// look") rather than throwing, so a future backend value never blanks the panel —
/// the web `SEVERITY_COLOR[severity]` lookup would render an undefined colour there.
public enum RateLimitSeverity: String, Sendable, Equatable, CaseIterable, Decodable {
    case ok
    case warn
    case critical

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = RateLimitSeverity(rawValue: raw) ?? .warn
    }

    /// Lenient mapping from an arbitrary backend string (web template-literal key).
    public static func parse(_ raw: String) -> RateLimitSeverity {
        RateLimitSeverity(rawValue: raw) ?? .warn
    }
}

// MARK: - Wire models (web `ScopeBudget` / `RateLimitStatusResponse`)

/// One scope row from GET /api/v1/system/rate-limits (web `ScopeBudget`). Optional
/// fields are pointers in the Go model, so `resetAt` / `detail` are optionals here;
/// the snake_case `CodingKeys` mirror the JSON tags exactly (the camelCase-vs-
/// snake_case mismatch is a recurring bug source, so it is covered by a decode test).
public struct RateLimitScope: Identifiable, Equatable, Sendable, Decodable {
    public let id: String
    public let name: String
    public let current: Double
    public let limit: Double
    public let windowSeconds: Int
    public let resetAt: Date?
    public let severity: RateLimitSeverity
    public let detail: String?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case current
        case limit
        case windowSeconds = "window_seconds"
        case resetAt = "reset_at"
        case severity
        case detail
    }

    public init(
        id: String,
        name: String,
        current: Double,
        limit: Double,
        windowSeconds: Int,
        resetAt: Date? = nil,
        severity: RateLimitSeverity,
        detail: String? = nil
    ) {
        self.id = id
        self.name = name
        self.current = current
        self.limit = limit
        self.windowSeconds = windowSeconds
        self.resetAt = resetAt
        self.severity = severity
        self.detail = detail
    }
}

/// The GET /api/v1/system/rate-limits envelope (web `RateLimitStatusResponse`).
public struct RateLimitStatusResponse: Equatable, Sendable, Decodable {
    public let generatedAt: Date?
    public let scopes: [RateLimitScope]

    enum CodingKeys: String, CodingKey {
        case generatedAt = "generated_at"
        case scopes
    }

    public init(generatedAt: Date?, scopes: [RateLimitScope]) {
        self.generatedAt = generatedAt
        self.scopes = scopes
    }

    /// Decodes the response from raw API bytes (production source path). ISO-8601
    /// instants (`generated_at`, `reset_at`) decode via `.iso8601`; tests build
    /// values directly. Returns `nil` only when the bytes are not the expected JSON.
    public static func decode(_ data: Data) -> RateLimitStatusResponse? {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(RateLimitStatusResponse.self, from: data)
    }
}

// MARK: - Number formatting (web `fmtNumber`)

/// Locale-aware number formatter mirroring the web `fmtNumber(v, decimals, locale)`:
/// grouped decimal with a fixed fraction width. The web global defaults (precision
/// 2, `en-US`) are reproduced so the usage readout matches "1.00 / 5.00" out of the
/// box; both are overridable to track `useSettings` at the display boundary.
public enum RateLimitNumberFormat {
    public static func format(
        _ value: Double,
        decimals: Int = 2,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        let safe = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: safe)) ?? String(safe)
    }
}

// MARK: - Duration formatting (web `formatDurationMsLong`)

/// Long human duration mirroring `formatDurationMsLong(ms)`: the em-dash sentinel
/// for nullish/non-positive input, `"<n>ms"` under a second, `"<s.s>s"` under a
/// minute, else `"<m>m <s>s"`. Used for the "Refills in …" countdown.
public enum RateLimitDuration {
    public static let dash = "—"

    public static func long(_ milliseconds: Double?) -> String {
        guard let milliseconds, milliseconds.isFinite, milliseconds > 0 else { return dash }
        if milliseconds < 1000 {
            return "\(Int(milliseconds))ms"
        }
        let seconds = milliseconds / 1000
        if seconds < 60 {
            return String(format: "%.1fs", seconds)
        }
        let minutes = Int(seconds / 60)
        let remainder = (seconds.truncatingRemainder(dividingBy: 60)).rounded()
        return "\(minutes)m \(Int(remainder))s"
    }
}

// MARK: - Relative time (web `formatRelative`)

/// Relative timestamp mirroring `formatRelative(iso)`: `"just now"` under a minute,
/// then `"<n>m ago"` / `"<n>h ago"` / `"<n>d ago"`, falling back to a medium
/// absolute date at a week or more. `now` is injected so the rollover thresholds are
/// deterministic under test.
public enum RateLimitRelative {
    public static let dash = "—"

    public static func format(
        _ date: Date?,
        now: Date = Date(),
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let date else { return dash }
        let seconds = Int(now.timeIntervalSince(date))
        if seconds < 60 { return "just now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        if days < 7 { return "\(days)d ago" }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }
}

// MARK: - Row projection (web `RateLimitRow` inline maths)

/// The view-ready projection of one scope — the native mirror of the per-row
/// `useMemo` maths in the web `RateLimitRow`: the clamped bar fraction, the refill
/// countdown in milliseconds (only when the bucket refills in the future), and the
/// flags that drive the window phrasing + bottom-meta visibility. Labels themselves
/// stay in the view so they resolve through the i18n facade.
public struct RateLimitRowProjection: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let current: Double
    public let limit: Double
    public let windowSeconds: Int
    public let severity: RateLimitSeverity
    public let detail: String?
    public let fraction: Double
    public let resetMilliseconds: Double?

    public init(
        id: String,
        name: String,
        current: Double,
        limit: Double,
        windowSeconds: Int,
        severity: RateLimitSeverity,
        detail: String?,
        fraction: Double,
        resetMilliseconds: Double?
    ) {
        self.id = id
        self.name = name
        self.current = current
        self.limit = limit
        self.windowSeconds = windowSeconds
        self.severity = severity
        self.detail = detail
        self.fraction = fraction
        self.resetMilliseconds = resetMilliseconds
    }

    /// `true` when the window is a token-bucket snapshot (web `!window_seconds ||
    /// window_seconds <= 0` → "Live snapshot"), else a rolling window.
    public var isInstantWindow: Bool {
        windowSeconds <= 0
    }

    /// `true` when the bottom-meta row renders (web `scope.detail || resetLabel`).
    public var hasMeta: Bool {
        !(detail?.isEmpty ?? true) || resetMilliseconds != nil
    }

    /// Projects a scope into a row VM. `max = limit > 0 ? limit : 1` and the bar
    /// fraction is clamped to 0...1 (web `Math.min(value / max * 100, 100)` plus the
    /// bar's own lower clamp). The refill countdown is `reset_at - now`, dropped when
    /// nonpositive or non-finite (web `if (!Number.isFinite(ms) || ms <= 0) null`).
    public static func make(_ scope: RateLimitScope, now: Date) -> RateLimitRowProjection {
        let max = scope.limit > 0 ? scope.limit : 1
        let ratio = scope.current / max
        let fraction = Swift.min(Swift.max(ratio.isFinite ? ratio : 0, 0), 1)

        var resetMilliseconds: Double?
        if let resetAt = scope.resetAt {
            let milliseconds = resetAt.timeIntervalSince(now) * 1000
            resetMilliseconds = (milliseconds.isFinite && milliseconds > 0) ? milliseconds : nil
        }

        return RateLimitRowProjection(
            id: scope.id,
            name: scope.name,
            current: scope.current,
            limit: scope.limit,
            windowSeconds: scope.windowSeconds,
            severity: scope.severity,
            detail: (scope.detail?.isEmpty ?? true) ? nil : scope.detail,
            fraction: fraction,
            resetMilliseconds: resetMilliseconds
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the combined VoiceOver phrase for a row from its already-resolved display
/// strings. Pure + public so the spoken content is asserted without rendering the
/// view; the view supplies the i18n-resolved name / severity / usage / window /
/// refill fragments and empties are dropped so the phrase never reads a stray comma.
public enum RateLimitAccessibility {
    public static func rowSummary(
        name: String,
        severity: String,
        usage: String,
        window: String,
        reset: String?
    ) -> String {
        [name, severity, usage, window, reset]
            .compactMap { fragment in
                guard let fragment, !fragment.isEmpty else { return nil }
                return fragment
            }
            .joined(separator: ", ")
    }
}
