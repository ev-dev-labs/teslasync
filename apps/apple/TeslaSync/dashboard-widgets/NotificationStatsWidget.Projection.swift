//
//  NotificationStatsWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0069 · NotificationStatsWidget (Apple)
//
//  The cached→projection adapter (a faithful port of the web source's
//  `coreStats` / `recentLogs` / `formatLogTime` memoized derivations and number
//  formatting) plus the per-state presentation resolver. Pure value logic — no
//  SwiftUI, no networking — so every render branch is unit-testable.
//

import Foundation

// MARK: - Projection output value types

/// A stat-grid trend arrow (web `StatGridItem.trend`). `positive` mirrors the web
/// `StatCard` mapping `positive: direction === 'up'`.
public enum NotificationStatTrend: String, Equatable, Sendable {
    case up
    case down
    case flat

    public var positive: Bool {
        self == .up
    }
}

/// One stat tile (web `StatGridItem` → `StatCard`). Labels/trend copy are
/// pre-localized through the P1/S10 facade so the view renders verbatim.
public struct NotificationStatItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let value: String
    public let unit: String?
    public let systemImage: String
    public let trend: NotificationStatTrend?
    public let trendLabel: String?
    public let valueIsDanger: Bool
}

/// One recent-delivery row (web `DataTable<NotificationLog>` row).
public struct NotificationLogRowItem: Identifiable, Equatable, Sendable {
    public let id: Int
    public let channel: String
    public let type: String
    public let status: NotificationLogStatus
    public let statusLabel: String
    public let timeText: String
}

/// The fully-resolved render model for the loaded state (web's derived view).
public struct NotificationStatsProjection: Equatable, Sendable {
    public let isCompact: Bool
    public let isWide: Bool
    public let deliveryRateText: String
    public let deliveryRatePercentText: String
    public let failedCount: Int
    public let failedCompactText: String?
    public let stats: [NotificationStatItem]
    public let recentLogs: [NotificationLogRowItem]
}

// MARK: - Projection build (cached → projection)

public extension NotificationStatsProjection {
    /// Builds the projection from a coalesced snapshot, reproducing the web
    /// source's `isCompact`/`isWide` breakpoints, `coreStats`, `recentLogs`
    /// (sort-desc + slice), and `formatLogTime`.
    static func make(
        from data: NotificationStatsData,
        size: DashboardWidgetSize,
        now: Date = Date(),
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> NotificationStatsProjection {
        let isCompact = size.cols <= 1
        let isWide = size.cols >= 3
        let stats = data.stats
        let rate = stats.deliveryRate
        let rateText = fixed(rate, 1, locale: locale)

        return NotificationStatsProjection(
            isCompact: isCompact,
            isWide: isWide,
            deliveryRateText: rateText,
            deliveryRatePercentText: rateText + "%",
            failedCount: stats.failed,
            failedCompactText: stats.failed > 0
                ? "\(groupedInt(stats.failed, locale: locale)) "
                + NotificationStatsStrings.string("widget.notificationStats.failedLabel", "failed")
                : nil,
            stats: statItems(for: stats, locale: locale),
            recentLogs: recentRows(
                from: data.logs,
                limit: isCompact ? 3 : 5,
                now: now,
                locale: locale,
                timeZone: timeZone
            )
        )
    }

    // MARK: Core stats (web `coreStats`)

    private static func statItems(for stats: NotificationStats, locale: Locale) -> [NotificationStatItem] {
        let totalSent = stats.totalSent
        let failed = stats.failed
        let rate = stats.deliveryRate

        return [
            NotificationStatItem(
                id: "totalSent",
                label: NotificationStatsStrings.string("widget.notificationStats.totalSent", "Total Sent (7d)"),
                value: groupedInt(totalSent, locale: locale),
                unit: nil,
                systemImage: "paperplane.fill",
                trend: totalSent > 0 ? .up : .flat,
                trendLabel: totalSent > 0 ? groupedInt(totalSent, locale: locale) : nil,
                valueIsDanger: false
            ),
            NotificationStatItem(
                id: "deliveryRate",
                label: NotificationStatsStrings.string("widget.notificationStats.deliveryRate", "Delivery Rate"),
                value: fixed(rate, 1, locale: locale),
                unit: "%",
                systemImage: "checkmark.circle.fill",
                trend: rate >= 95 ? .up : (rate > 0 ? .down : .flat),
                trendLabel: rate >= 95
                    ? NotificationStatsStrings.string("widget.notificationStats.healthy", "Healthy")
                    : nil,
                valueIsDanger: false
            ),
            NotificationStatItem(
                id: "failed",
                label: NotificationStatsStrings.string("widget.notificationStats.failed", "Failed"),
                value: groupedInt(failed, locale: locale),
                unit: nil,
                systemImage: "exclamationmark.triangle.fill",
                trend: failed > 0 ? .down : .flat,
                trendLabel: failed > 0
                    ? NotificationStatsStrings.string("widget.notificationStats.needsAttention", "Needs attention")
                    : nil,
                valueIsDanger: failed > 0
            ),
            NotificationStatItem(
                id: "activeChannels",
                label: NotificationStatsStrings.string("widget.notificationStats.activeChannels", "Active Channels"),
                value: groupedInt(stats.enabledChannels, locale: locale),
                unit: nil,
                systemImage: "dot.radiowaves.left.and.right",
                trend: nil,
                trendLabel: nil,
                valueIsDanger: false
            )
        ]
    }

    // MARK: Recent logs (web `recentLogs`)

    private static func recentRows(
        from logs: [NotificationLog],
        limit: Int,
        now: Date,
        locale: Locale,
        timeZone: TimeZone
    ) -> [NotificationLogRowItem] {
        let emDash = "—"
        return logs
            .sorted { ($0.createdAt ?? .distantPast) > ($1.createdAt ?? .distantPast) }
            .prefix(limit)
            .map { log in
                NotificationLogRowItem(
                    id: log.id,
                    channel: log.title.isEmpty ? emDash : log.title,
                    type: log.message.isEmpty ? emDash : log.message,
                    status: log.status,
                    statusLabel: statusLabel(log.status),
                    timeText: log.createdAt.map {
                        relativeTime(from: $0, now: now, locale: locale, timeZone: timeZone)
                    } ?? emDash
                )
            }
    }
}

// MARK: - Formatting helpers (web `fmtInt` / `fmtNumber` / `formatLogTime`)

public extension NotificationStatsProjection {
    /// Grouped integer, locale-aware (web `fmtInt`).
    static func groupedInt(_ value: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// Fixed-fraction number, coercing non-finite to 0 (web `fmtNumber` + `safeNumber`).
    static func fixed(_ value: Double?, _ digits: Int, locale: Locale) -> String {
        let safe = (value?.isFinite == true) ? value! : 0
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(digits)f", safe)
    }

    /// Relative-then-absolute timestamp (web `formatLogTime`): "Just now", "Nm ago",
    /// "Nh ago", else the locale date-time.
    static func relativeTime(
        from date: Date,
        now: Date,
        locale: Locale,
        timeZone: TimeZone = .current
    ) -> String {
        let minutes = Int((now.timeIntervalSince(date) / 60).rounded(.down))
        if minutes < 1 {
            return NotificationStatsStrings.string("widget.notificationStats.justNow", "Just now")
        }
        if minutes < 60 {
            return NotificationStatsStrings.count("widget.notificationStats.minutesAgo", "%lldm ago", minutes)
        }
        let hours = minutes / 60
        if hours < 24 {
            return NotificationStatsStrings.count("widget.notificationStats.hoursAgo", "%lldh ago", hours)
        }
        return absoluteDateTime(date, locale: locale, timeZone: timeZone)
    }

    /// The localized absolute fallback (web `formatDateTime`).
    static func absoluteDateTime(_ date: Date, locale: Locale, timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// The localized status token the chip shows (web Badge body `{log.status}`).
    static func statusLabel(_ status: NotificationLogStatus) -> String {
        switch status {
        case .sent: NotificationStatsStrings.string("widget.notificationStats.statusValue.sent", "sent")
        case .failed: NotificationStatsStrings.string("widget.notificationStats.statusValue.failed", "failed")
        case .pending: NotificationStatsStrings.string("widget.notificationStats.statusValue.pending", "pending")
        case .deferredDnd:
            NotificationStatsStrings.string("widget.notificationStats.statusValue.deferred", "deferred_dnd")
        case .unknown: "—"
        }
    }
}

// MARK: - Freshness + presentation (every state)

/// Freshness chrome shown in the header (web freshness indicator).
public enum NotificationStatsFreshness: Equatable, Sendable {
    case live
    case stale
    case offline
}

/// The mutually-exclusive surface for the current data state — exhaustive so each
/// branch is unit-tested (loading / empty / offline-no-data / error / content).
public enum NotificationStatsPresentation: Equatable, Sendable {
    case loading
    case empty
    case offlineNoData
    case error(retryable: Bool)
    case content(NotificationStatsProjection, freshness: NotificationStatsFreshness, refreshing: Bool)
}

public extension NotificationStatsPresentation {
    /// Pure mapping from the cache-then-network load state (ADR-013) to a
    /// render-ready presentation, keeping any cached value visible behind a
    /// refresh/error and adding the prompt's stale + offline chrome — the web
    /// shell only branches on loading/error/`stats` presence, this is a superset.
    static func resolve(
        state: NotificationStatsLoadState<NotificationStatsData>,
        size: DashboardWidgetSize,
        now: Date = Date(),
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> NotificationStatsPresentation {
        func project(_ data: NotificationStatsData) -> NotificationStatsProjection {
            NotificationStatsProjection.make(from: data, size: size, now: now, locale: locale, timeZone: timeZone)
        }

        switch state {
        case .idle:
            return .loading
        case let .loading(cached, stale):
            guard let cached else { return .loading }
            return .content(project(cached), freshness: stale ? .stale : .live, refreshing: true)
        case let .loaded(data, stale):
            return .content(project(data), freshness: stale ? .stale : .live, refreshing: false)
        case .empty:
            return .empty
        case let .failed(error, cached, stale):
            if error == .offline {
                guard let cached else { return .offlineNoData }
                return .content(project(cached), freshness: .offline, refreshing: false)
            }
            if let cached {
                return .content(project(cached), freshness: stale ? .stale : .live, refreshing: false)
            }
            return .error(retryable: error.isRetryable)
        }
    }
}
