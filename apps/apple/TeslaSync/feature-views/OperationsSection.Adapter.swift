//
//  OperationsSection.Adapter.swift
//  TeslaSync — P4 feature view · 0250 · OperationsSection (Apple)
//
//  The testable, dependency-free projection core for the system-status Operations
//  surface — the SwiftUI parity of
//  features/system/components/status/OperationsSection.tsx plus the web helpers it is
//  fed by: `fmtInt` / `fmtPercent` (lib/numberFormat.ts), `formatDateTime`
//  (lib/dateFormat.ts), and `getStatusIcon` / `statusTextClass` (the sibling status
//  `helpers.tsx`). Everything here is pure (no store, no bundle, no rendered view) so
//  the notification / audit models, the delivery-status classification, the success-rate
//  derivation, the locale number / percent / int / date formatting, and the VoiceOver
//  label composition are all unit tested in isolation.
//
//  Parity note: the numbers carried here are presentational counts (sent / failed /
//  channels) — no SI conversion applies, this is a dev-ops status panel.
//

import Foundation

// MARK: - Notification-stats model (web `NotificationStats` — the fields rendered here)

/// One notification-delivery snapshot — the native mirror of the web `NotificationStats`,
/// narrowed to the values the panel renders (totals sent / failed and the channel
/// enablement). Counts are carried as the raw upstream integers.
public struct NotificationStatsSnapshot: Equatable, Sendable {
    public var totalSent: Int
    public var sent: Int
    public var failed: Int
    public var totalChannels: Int
    public var enabledChannels: Int

    public init(
        totalSent: Int = 0,
        sent: Int = 0,
        failed: Int = 0,
        totalChannels: Int = 0,
        enabledChannels: Int = 0
    ) {
        self.totalSent = totalSent
        self.sent = sent
        self.failed = failed
        self.totalChannels = totalChannels
        self.enabledChannels = enabledChannels
    }
}

// MARK: - Notification-log model (web `NotificationLog` — the columns rendered here)

/// One notification-log row — the native mirror of the web `NotificationLog`, narrowed
/// to the four columns the delivery table renders (status · title · message · time).
/// `createdAt` is a `Date?` so the view formats it through `OperationsFormat.dateTime`
/// (the web `formatDateTime` em-dash branch covers a missing/invalid timestamp).
public struct NotificationLogItem: Identifiable, Equatable, Sendable {
    public let id: Int
    public let status: String
    public let title: String
    public let message: String
    public let createdAt: Date?

    public init(id: Int, status: String, title: String, message: String, createdAt: Date?) {
        self.id = id
        self.status = status
        self.title = title
        self.message = message
        self.createdAt = createdAt
    }

    /// The classified delivery status (drives the row icon + accent), web `getStatusIcon`.
    public var statusKind: OperationsStatusKind {
        OperationsStatusKind(raw: status)
    }
}

// MARK: - Audit-log model (web `AuditLog` — the columns rendered here)

/// One audit-log row — the native mirror of the web `AuditLog`, narrowed to the four
/// columns the audit table renders (time · action · resource · details).
public struct AuditLogItem: Identifiable, Equatable, Sendable {
    public let id: Int
    public let action: String
    public let resource: String
    public let details: String
    public let createdAt: Date?

    public init(id: Int, action: String, resource: String, details: String, createdAt: Date?) {
        self.id = id
        self.action = action
        self.resource = resource
        self.details = details
        self.createdAt = createdAt
    }
}

// MARK: - Status classification (web `helpers.tsx` getStatusIcon / statusTextClass)

/// The semantic tone a status maps to — the native, view-free mirror of the web
/// `statusTextClass`. The view maps this to the shared `TSTone` colour tokens so no
/// raw hex lives here.
public enum OperationsTone: String, Sendable, Equatable, CaseIterable {
    case neutral
    case success
    case warning
    case danger
}

/// The delivery-status classification the web `helpers.tsx` derives — the healthy /
/// pending / failed buckets (plus a `neutral` fallback) used for the row icon + text
/// colour. Mirrors `statusTextClass` / `getStatusIcon` case-for-case so a notification
/// `sent` / `pending` / `failed` / `deferred_dnd` status renders exactly as on the web.
public enum OperationsStatusKind: String, Sendable, Equatable, CaseIterable {
    case healthy
    case pending
    case failed
    case neutral

    /// Classifies a raw server status (case-insensitive), web `(status ?? '').toLowerCase()`.
    public init(raw: String) {
        switch raw.lowercased() {
        case "healthy", "ok", "online", "connected", "ready", "sent", "completed":
            self = .healthy
        case "degraded", "warning", "pending", "queued", "processing":
            self = .pending
        case "unhealthy", "offline", "error", "down", "failed":
            self = .failed
        default:
            self = .neutral
        }
    }

    /// The text / icon tone, web `statusTextClass` (green / amber / red / muted).
    public var tone: OperationsTone {
        switch self {
        case .healthy: .success
        case .pending: .warning
        case .failed: .danger
        case .neutral: .neutral
        }
    }

    /// The status SF Symbol, web `getStatusIcon` (CheckCircle / AlertTriangle / XCircle;
    /// the default branch is the triangle, matching the web fallback).
    public var symbolName: String {
        switch self {
        case .healthy: "checkmark.circle.fill"
        case .pending: "exclamationmark.triangle.fill"
        case .failed: "xmark.circle.fill"
        case .neutral: "exclamationmark.triangle.fill"
        }
    }
}

// MARK: - Success-rate derivation (web `successRate`)

/// The notification success rate, a pure function of the stats snapshot — the native
/// port of the web `notifStats && notifStats.total_sent > 0 ? (sent/total_sent)*100 :
/// 100`. With no stats (or nothing sent yet) the rate is a clean 100%.
public enum OperationsSuccessRate {
    public static func compute(_ stats: NotificationStatsSnapshot?) -> Double {
        guard let stats, stats.totalSent > 0 else { return 100 }
        return Double(stats.sent) / Double(stats.totalSent) * 100
    }

    /// The badge / gauge tone from the rate, web `successRate >= 95 ? 'success' :
    /// successRate >= 80 ? 'warning' : 'danger'`.
    public static func tone(for rate: Double) -> OperationsTone {
        if rate >= 95 { return .success }
        if rate >= 80 { return .warning }
        return .danger
    }
}

// MARK: - Number / int / percent / date formatting (ports of numberFormat.ts + dateFormat.ts)

/// Pure number, integer, percent, and date formatting ported from the web helpers so
/// the rounding, the grouping separators, and the em-dash sentinels match the source
/// exactly. The web global precision is 2 and `safeNumber` coerces non-finite input to
/// 0; both are reproduced here.
public enum OperationsFormat {
    /// The em-dash sentinel the web renders for a missing/non-applicable value.
    public static let dash = "—"

    /// Native port of `safeNumber` (numberFormat.ts): non-finite ⇒ 0.
    static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Native port of `fmtNumber(v, decimals)`: locale grouping, fixed fraction digits,
    /// half-away rounding (web `toLocaleString` default), `safeNumber` guard.
    public static func number(_ value: Double, decimals: Int = 2, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safe(value))) ?? "0"
    }

    /// Native port of `fmtInt(v)` — `fmtNumber(v, 0)` (locale grouping, no decimals).
    public static func int(_ value: Int, locale: Locale = .current) -> String {
        number(Double(value), decimals: 0, locale: locale)
    }

    /// Native port of `fmtPercent(v, decimals)` — `fmtNumber(v, decimals)` plus a trailing
    /// `%`. The web call sites here pass one decimal (`fmtPercent(successRate, 1)`).
    public static func percent(_ value: Double, decimals: Int = 1, locale: Locale = .current) -> String {
        number(value, decimals: decimals, locale: locale) + "%"
    }

    /// Native port of `formatDateTime(iso)` (dateFormat.ts): the em-dash fallback for a
    /// missing date, otherwise a locale-ordered "MMM d, yyyy, h:mm a"-style rendering
    /// (the web `month:'short', day:'numeric', year:'numeric', hour/minute:'2-digit'`).
    public static func dateTime(
        _ date: Date?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> String {
        guard let date else { return dash }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.setLocalizedDateFormatFromTemplate("yMMMdjmm")
        return formatter.string(from: date)
    }
}

// MARK: - Channel summary (web `${enabled_channels}/${total_channels}`)

/// The "enabled/total" channel string the web Channels metric card renders, kept as a
/// pure helper so the slash composition is asserted without a rendered view.
public enum OperationsChannels {
    public static func summary(_ stats: NotificationStatsSnapshot) -> String {
        "\(stats.enabledChannels)/\(stats.totalChannels)"
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Pure builders for the VoiceOver strings the views attach, composed from already
/// formatted/localised parts so the spoken content is asserted without a rendered view.
public enum OperationsAccessibility {
    /// The success-rate badge label: "{percent} success rate".
    public static func successRateLabel(percent: String, suffix: String) -> String {
        "\(percent) \(suffix)"
    }

    /// The notification-log row label: "{status}, {title}, {message}, {time}".
    public static func notificationRowLabel(
        status: String,
        title: String,
        message: String,
        time: String
    ) -> String {
        "\(status), \(title), \(message), \(time)"
    }

    /// The audit-log row label: "{time}, {action}, {resource}, {details}".
    public static func auditRowLabel(
        time: String,
        action: String,
        resource: String,
        details: String
    ) -> String {
        "\(time), \(action), \(resource), \(details)"
    }
}
