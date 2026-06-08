//
//  NotificationStatsWidget.Components.swift
//  TeslaSync — P4 dashboard widget · 0069 · NotificationStatsWidget (Apple)
//
//  The Apple-idiomatic view pieces the surface composes: the freshness chip, the
//  stat grid + tile (web `WidgetStatGrid`/`StatCard`), the status chip (web
//  `Badge` with a leading glyph), the recent-delivery log table (web `DataTable`),
//  the loading skeleton, and the compact big-number. All strings resolve through
//  the P1/S10 facade; all colors/spacing come from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Freshness chip

/// Header chip flagging live / stale / offline data (web freshness indicator).
struct NotificationStatsFreshnessChip: View {
    let freshness: NotificationStatsFreshness

    private var tone: TSTone {
        switch freshness {
        case .live: .success
        case .stale: .warning
        case .offline: .neutral
        }
    }

    private var symbol: String {
        switch freshness {
        case .live: "clock"
        case .stale: "clock.badge.exclamationmark"
        case .offline: "wifi.slash"
        }
    }

    private var label: String {
        switch freshness {
        case .live: NotificationStatsStrings.string("widget.notificationStats.live", "Live")
        case .stale: NotificationStatsStrings.string("widget.notificationStats.stale", "Stale")
        case .offline: NotificationStatsStrings.string("widget.notificationStats.offline", "Offline")
        }
    }

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: symbol).font(.caption2)
            Text(verbatim: label).font(Font.TS.caption)
        }
        .foregroundStyle(tone.color)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Stat trend + tile + grid (web `StatCard` / `WidgetStatGrid`)

/// A sign-colored trend chip (web `StatCard` trend arrow).
struct NotificationStatTrendView: View {
    let trend: NotificationStatTrend
    let label: String

    private var tone: Color {
        switch trend {
        case .up: Color.TS.statusSuccess
        case .down: Color.TS.statusDanger
        case .flat: Color.TS.textMuted
        }
    }

    private var symbol: String {
        switch trend {
        case .up: "arrow.up.right"
        case .down: "arrow.down.right"
        case .flat: "minus"
        }
    }

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: symbol).font(.caption2)
            Text(verbatim: label).font(Font.TS.caption).fontWeight(.medium).lineLimit(1)
        }
        .foregroundStyle(tone)
    }
}

/// One stat tile (web `StatCard` rendered compactly for a dashboard cell).
struct NotificationStatTile: View {
    let item: NotificationStatItem

    private var accessibilityText: String {
        let value = item.unit.map { "\(item.value)\($0)" } ?? item.value
        return "\(item.label), \(value)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: item.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.xs)
                Image(systemName: item.systemImage)
                    .font(.caption2)
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(verbatim: item.value)
                    .font(Font.TS.panel)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(item.valueIsDanger ? Color.TS.statusDanger : Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if let unit = item.unit {
                    Text(verbatim: unit).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                }
            }
            if let trend = item.trend, let trendLabel = item.trendLabel {
                NotificationStatTrendView(trend: trend, label: trendLabel)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .padding(TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

/// The responsive stat grid (web `WidgetStatGrid`).
struct NotificationStatGrid: View {
    let stats: [NotificationStatItem]
    let columns: Int

    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: max(1, columns))
    }

    var body: some View {
        LazyVGrid(columns: gridColumns, spacing: TSSpacing.sm) {
            ForEach(stats) { NotificationStatTile(item: $0) }
        }
    }
}

// MARK: - Status chip (web `Badge` with leading glyph)

/// A delivery-status chip styled like the shared `TSBadge`, extended with the
/// leading state glyph the web row shows (CheckCircle / XCircle / Clock) and a
/// pre-localized label — which the shared `TSBadge` (taking a `LocalizedStringKey`
/// only) cannot express.
struct NotificationStatusChip: View {
    let status: NotificationLogStatus
    let label: String

    private var tone: TSTone {
        switch status {
        case .sent: .success
        case .failed: .danger
        case .pending, .deferredDnd, .unknown: .warning
        }
    }

    private var symbol: String? {
        switch status {
        case .sent: "checkmark.circle.fill"
        case .failed: "xmark.circle.fill"
        case .pending: "clock"
        case .deferredDnd, .unknown: nil
        }
    }

    var body: some View {
        HStack(spacing: 3) {
            if let symbol {
                Image(systemName: symbol).font(.system(size: 9, weight: .semibold))
            }
            Text(verbatim: label).font(Font.TS.caption).fontWeight(.medium).lineLimit(1)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Recent-delivery log table (web `DataTable`)

/// The compact recent-delivery table (web `DataTable` with channel/type/status/time).
struct NotificationLogTable: View {
    let rows: [NotificationLogRowItem]

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Color.TS.border)
            ForEach(rows) { row in
                NotificationLogTableRow(row: row)
                if row.id != rows.last?.id {
                    Divider().overlay(Color.TS.border.opacity(0.5))
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            headerCell("widget.notificationStats.channel", "Channel")
                .frame(maxWidth: .infinity, alignment: .leading)
            headerCell("widget.notificationStats.type", "Type")
                .frame(maxWidth: .infinity, alignment: .leading)
            headerCell("widget.notificationStats.status", "Status")
                .frame(width: 76, alignment: .leading)
            headerCell("widget.notificationStats.time", "Time")
                .frame(width: 64, alignment: .trailing)
        }
        .padding(.vertical, TSSpacing.xs)
    }

    private func headerCell(_ key: String, _ fallback: String) -> some View {
        NotificationStatsStrings.text(key, fallback)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .textCase(.uppercase)
            .lineLimit(1)
    }
}

/// One recent-delivery row.
struct NotificationLogTableRow: View {
    let row: NotificationLogRowItem

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: row.channel)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: row.type)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            NotificationStatusChip(status: row.status, label: row.statusLabel)
                .frame(width: 76, alignment: .leading)
            Text(verbatim: row.timeText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .frame(width: 64, alignment: .trailing)
        }
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton + compact big-number

/// Skeleton chrome shown during the initial fetch (web `Skeleton`).
struct NotificationStatsLoadingView: View {
    let columns: Int
    let showsTable: Bool

    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: max(2, columns))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            LazyVGrid(columns: gridColumns, spacing: TSSpacing.sm) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 56, cornerRadius: TSRadius.sm)
                }
            }
            if showsTable {
                ForEach(0 ..< 3, id: \.self) { _ in
                    TSSkeleton(height: 18, cornerRadius: TSRadius.sm)
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(NotificationStatsStrings.text(
            "widget.notificationStats.loading",
            "Loading notification stats"
        ))
    }
}

/// The compact single-number layout (web `isCompact` branch): the delivery rate.
struct NotificationStatsBigNumber: View {
    let projection: NotificationStatsProjection

    var body: some View {
        VStack(spacing: 2) {
            Text(verbatim: projection.deliveryRatePercentText)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            NotificationStatsStrings.text("widget.notificationStats.deliveryRate", "Delivery Rate")
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            if let failedText = projection.failedCompactText {
                Text(verbatim: failedText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
