//
//  helpers.Adapter.swift
//  TeslaSync — P4 feature view · 0245 · helpers (Apple)
//
//  The testable projection core for the status `helpers` surface — the SwiftUI
//  parity of web/src/features/system/components/status/helpers.tsx. That web module
//  is a pure utility leaf: it classifies a free-form status string into a colour /
//  icon / badge treatment and formats an uptime (seconds) and a byte count. This file
//  ports those six exported helpers verbatim so the rounding, the case-folding, the
//  classification sets, and the unit ladders match the source exactly — all pure and
//  dependency-free (no store, no bundle, no rendered view) so every branch is unit
//  tested in isolation. The SwiftUI-facing tone/colour mapping lives in
//  `helpers.Views.swift`; this layer stays Foundation-only.
//
//  Faithful-divergence note (no silent drift): the web source's success set for
//  `getStatusColor` / `statusTextClass` / `getStatusIcon` includes "connected", but
//  `statusToBadgeVariant`'s success set does NOT. So a "connected" status renders the
//  green check glyph yet a neutral badge. That asymmetry is reproduced here via two
//  classifications — `kind(for:)` (colour + icon) and `badgeKind(for:)` (badge) — and
//  pinned by a dedicated test.
//

import Foundation

// MARK: - Status classification (web switch groups in helpers.tsx)

/// The semantic group a status string folds into — the native mirror of the web
/// helpers' four `switch` outcomes (`getStatusColor` / `statusTextClass` /
/// `getStatusIcon` / `statusToBadgeVariant`). Drives the surface's tone, the SF
/// Symbol, and the badge variant.
public enum StatusKind: String, Sendable, Equatable, CaseIterable {
    case success
    case warning
    case danger
    case neutral

    /// The SF Symbol for the group — the native mirror of the web lucide glyphs
    /// (`CheckCircle` / `AlertTriangle` / `XCircle`, with the `default` branch using
    /// `AlertTriangle`). Neutral therefore shares the warning triangle, matching the
    /// web `getStatusIcon` default.
    public var symbolName: String {
        switch self {
        case .success: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .danger: "xmark.circle.fill"
        case .neutral: "exclamationmark.triangle.fill"
        }
    }
}

/// The faithful Swift port of the web status helpers (helpers.tsx). Every method is a
/// pure function of its input so the classification sets and the formatters are unit
/// tested without a view or a bundle.
public enum StatusHelpers {
    /// Web `(status ?? '').toLowerCase()` — lower-cases for case-insensitive matching.
    /// A Swift `String` is never nil, so the empty string simply falls through to the
    /// neutral / default branch, exactly as the web `?? ''` guard does.
    public static func normalize(_ status: String) -> String {
        status.lowercased()
    }

    /// The colour / icon classification — the shared success / warning / danger sets
    /// of `getStatusColor`, `statusTextClass`, and `getStatusIcon`. The success set
    /// includes "connected" (unlike the badge classification below).
    public static func kind(for status: String) -> StatusKind {
        switch normalize(status) {
        case "healthy", "ok", "online", "connected", "ready", "sent", "completed":
            .success
        case "degraded", "warning", "pending", "queued", "processing":
            .warning
        case "unhealthy", "offline", "error", "down", "failed":
            .danger
        default:
            .neutral
        }
    }

    /// The badge classification — the web `statusToBadgeVariant` switch. Its success
    /// set intentionally OMITS "connected" (the web source's asymmetry), so a
    /// "connected" status maps to a neutral badge while `kind(for:)` maps it to
    /// success. Reproduced verbatim; pinned by `StatusBadgeKindTests`.
    public static func badgeKind(for status: String) -> StatusKind {
        switch normalize(status) {
        case "healthy", "ok", "online", "ready", "sent", "completed":
            .success
        case "degraded", "warning", "pending", "queued", "processing":
            .warning
        case "unhealthy", "offline", "error", "down", "failed":
            .danger
        default:
            .neutral
        }
    }

    /// The SF Symbol for a status — the native parity of `getStatusIcon` (the glyph
    /// only; the tint is applied at the view boundary from `kind(for:)`).
    public static func symbolName(for status: String) -> String {
        kind(for: status).symbolName
    }

    /// A human display fallback for an arbitrary status token (used when the i18n
    /// catalog has no `helpers.status.<token>` entry): the token with an upper-cased
    /// first character, e.g. "queued" → "Queued".
    public static func displayFallback(_ status: String) -> String {
        guard let first = status.first else { return status }
        return first.uppercased() + status.dropFirst()
    }
}

// MARK: - Formatting (ports of formatUptime / formatBytes in helpers.tsx)

/// Pure uptime + byte formatting ported from the web helpers so the integer wording
/// and the 1024-based size ladder match the source. `formatUptime` is
/// locale-independent (the web builds the string from integer parts); `formatBytes`
/// routes through a locale number formatter to mirror the web `fmtNumber(v, 1)`.
public enum StatusFormat {
    /// The byte-size units, smallest-first — the web `['B','KB','MB','GB','TB']`.
    static let byteUnits = ["B", "KB", "MB", "GB", "TB"]

    /// Web `safeNumber` parity (numberFormat.ts): non-finite input coerces to 0.
    static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of `formatUptime(seconds)`:
    /// `days = floor(s/86400)`, `hours = floor((s%86400)/3600)`,
    /// `mins = floor((s%3600)/60)`, then `Xd Yh Zm` / `Yh Zm` / `Zm`. Non-finite or
    /// negative input is clamped to 0 (the web passes a monotonic uptime and adds no
    /// guard; the clamp keeps the native call site total).
    public static func formatUptime(_ seconds: Double) -> String {
        let total = Int(max(safe(seconds), 0).rounded(.down))
        let days = total / 86400
        let hours = (total % 86400) / 3600
        let mins = (total % 3600) / 60
        if days > 0 { return "\(days)d \(hours)h \(mins)m" }
        if hours > 0 { return "\(hours)h \(mins)m" }
        return "\(mins)m"
    }

    /// Native port of `formatBytes(bytes)`: `0 → "0 B"`, otherwise
    /// `i = floor(log(bytes)/log(1024))` selects the unit and the value is
    /// `fmtNumber(bytes / 1024^i, 1)`. The exponent is clamped to the unit table so a
    /// petabyte-scale value still renders against `TB` rather than indexing past the
    /// array (the web would print `undefined`); non-finite / non-positive input
    /// returns `"0 B"`.
    public static func formatBytes(_ bytes: Double, locale: Locale = .current) -> String {
        guard bytes.isFinite, bytes > 0 else { return "0 B" }
        let base = 1024.0
        let exponent = Int((log(bytes) / log(base)).rounded(.down))
        let index = min(max(exponent, 0), byteUnits.count - 1)
        let value = bytes / pow(base, Double(index))
        return number(value, decimals: 1, locale: locale) + " " + byteUnits[index]
    }

    /// Native port of `fmtNumber(value, decimals)`: locale grouping, fixed fraction
    /// digits, half-away rounding (the web `toLocaleString` default), `safeNumber`
    /// guard.
    static func number(_ value: Double, decimals: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }
}

// MARK: - Legend row (one demonstrated status sample)

/// One resolved legend row — a status token rendered with its icon (from
/// `kind`), its localized display name (`labelKey` + `labelFallback`), and its badge
/// variant (from `badgeKind`). The label is carried as an i18n key + English fallback
/// so the view holds no literals; the classification is pre-computed so the view is a
/// pure function of this value.
public struct StatusLegendRow: Identifiable, Equatable, Sendable {
    public let id: String
    public let token: String
    public let labelKey: String
    public let labelFallback: String
    public let kind: StatusKind
    public let badgeKind: StatusKind

    public init(
        id: String,
        token: String,
        labelKey: String,
        labelFallback: String,
        kind: StatusKind,
        badgeKind: StatusKind
    ) {
        self.id = id
        self.token = token
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.kind = kind
        self.badgeKind = badgeKind
    }
}

/// Builds the legend rows from the surface's status samples — one row per token, in
/// order, each classified through `StatusHelpers` for its icon tone and badge variant.
public enum StatusHelpersRows {
    public static func rows(for samples: [String]) -> [StatusLegendRow] {
        samples.enumerated().map { index, token in
            let normalized = StatusHelpers.normalize(token)
            return StatusLegendRow(
                id: "\(index)-\(normalized)",
                token: token,
                labelKey: "helpers.status.\(normalized)",
                labelFallback: StatusHelpers.displayFallback(token),
                kind: StatusHelpers.kind(for: token),
                badgeKind: StatusHelpers.badgeKind(for: token)
            )
        }
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the surface from already-localised parts, so the
/// spoken content is asserted without rendering the view.
public enum StatusHelpersAccessibility {
    /// The per-legend-row spoken label: "{status}, {variant}".
    public static func legendRowLabel(status: String, variant: String) -> String {
        "\(status), \(variant)"
    }

    /// The formatting-row spoken label: "{label}: {value}".
    public static func metricLabel(label: String, value: String) -> String {
        "\(label): \(value)"
    }
}
