//
//  VampireDrainWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0105 · VampireDrainWidget (Apple)
//
//  The surface's internal composition: the drain-tone color mapping, the compact
//  single stat (web compact branch), the standard stat card (web StatCard), the
//  Swift Charts sparkline (web Sparkline), the recent-events feed + row (web
//  WidgetEventFeed / TimelineItem), and the empty states (web EmptyState). Built
//  over the shared design tokens — no exported view but `VampireDrainWidget`.
//

import Charts
import SwiftUI

// MARK: - Drain tone → token color (port of the web `drainColor`)

extension DrainTone {
    /// The design-token color for this severity (web green/amber/red).
    var color: Color {
        switch self {
        case .good: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .critical: Color.TS.statusDanger
        }
    }
}

// MARK: - Compact (1×2) — web compact branch (single big stat)

/// The compact layout's hero number: the average drain in %/day, tone-colored,
/// over a muted "/day" label (web `{fmtNumber(avg,1)}%` + `perDay`).
struct DrainCompactStat: View {
    let avgPerDay: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var tone: DrainTone {
        VampireDrainBuilder.drainTone(perDay: avgPerDay)
    }

    private var percent: String {
        VampireDrainNumberFormat.decimal(avgPerDay, fractionDigits: 1) + "%"
    }

    var body: some View {
        VStack(spacing: 2) {
            Text(verbatim: percent)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(tone.color)
                .contentTransition(.numericText())
                .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration), value: avgPerDay)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            VampireDrainStrings.text("widget.vampireDrain.perDay", "/day")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, minHeight: 44, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: VampireDrainAccessibility.statLabel(avgPerDay: avgPerDay, stats: nil)))
    }
}

// MARK: - Standard stat card — web `StatCard`

/// The standard layout's headline stat (web `StatCard`): a muted "Avg Drain"
/// label + tone-colored battery icon, the `{avg}%/day` value, and the
/// `{count} events · {hours}h total` sublabel when stats are present.
struct DrainStatCard: View {
    let avgPerDay: Double
    let stats: VampireDrainStatsInput?

    private var tone: DrainTone {
        VampireDrainBuilder.drainTone(perDay: avgPerDay)
    }

    private var sublabel: String? {
        guard let stats else { return nil }
        return VampireDrainStrings.eventCountSublabel(
            count: stats.eventCount ?? 0,
            totalHours: stats.totalHours ?? 0
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                VampireDrainStrings.text("widget.vampireDrain.avgDrain", "Avg Drain")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "battery.25")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(tone.color)
                    .accessibilityHidden(true)
            }
            Text(verbatim: VampireDrainStrings.percentPerDay(avgPerDay))
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let sublabel {
                Text(verbatim: sublabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: VampireDrainAccessibility.statLabel(avgPerDay: avgPerDay, stats: stats)))
    }
}

// MARK: - Sparkline (web `Sparkline` — wide only)

/// One plotted point in the sparkline series.
private struct DrainSparkPoint: Identifiable {
    let id: Int
    let value: Double
}

/// The wide-layout daily-drain trend (web `Sparkline`): a tone-colored line over
/// a fading area fill, captioned "Daily drain rate (last 30)". Swift Charts is
/// the native chart per the Apple HIG (web Recharts/SVG → Swift Charts).
struct DrainSparkline: View {
    let values: [Double]
    let tone: DrainTone

    private var points: [DrainSparkPoint] {
        values.enumerated().map { DrainSparkPoint(id: $0.offset, value: $0.element) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            VampireDrainStrings.text("widget.vampireDrain.trend", "Daily drain rate (last 30)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Chart(points) { point in
                AreaMark(x: .value("index", point.id), y: .value("rate", point.value))
                    .foregroundStyle(areaGradient)
                    .interpolationMethod(.catmullRom)
                LineMark(x: .value("index", point.id), y: .value("rate", point.value))
                    .foregroundStyle(tone.color)
                    .lineStyle(StrokeStyle(lineWidth: 1.5, lineCap: .round))
                    .interpolationMethod(.catmullRom)
            }
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .chartLegend(.hidden)
            .frame(height: 40)
            .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var areaGradient: LinearGradient {
        LinearGradient(
            colors: [tone.color.opacity(0.3), tone.color.opacity(0)],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}

// MARK: - Feed (web `WidgetEventFeed`)

/// The recent-events feed (web `WidgetEventFeed`): the model already sorts
/// newest-first and caps at 5. An empty list renders the inline empty state
/// ("No recent drain events"), never a blank panel.
struct DrainFeed: View {
    let items: [VampireDrainEventItem]

    var body: some View {
        if items.isEmpty {
            DrainFeedEmpty()
        } else {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element.id) { offset, item in
                    DrainFeedRow(item: item, isLast: offset == items.count - 1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Feed row — web `TimelineItem`

/// One feed entry: a tone-tinted battery marker on a connected timeline rail, the
/// drain title ("{battery}% · {duration}[ · Sentry]"), the "{rate}%/day" subtitle,
/// and a relative time. One VoiceOver element with a composed label.
struct DrainFeedRow: View {
    let item: VampireDrainEventItem
    var isLast = false

    private var relativeLabel: String {
        VampireDrainStrings.relativeTimeLabel(VampireDrainBuilder.relativeTime(for: item.timestamp))
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            rail
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                    Text(verbatim: VampireDrainStrings.eventTitle(item))
                        .font(Font.TS.bodySm)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: TSSpacing.sm)
                    Text(verbatim: relativeLabel)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .layoutPriority(1)
                }
                Text(verbatim: VampireDrainStrings.percentPerDay(item.drainPerDay))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
            }
            .padding(.bottom, isLast ? 0 : TSSpacing.md)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: VampireDrainAccessibility.rowLabel(for: item)))
    }

    private var rail: some View {
        VStack(spacing: 0) {
            ZStack {
                Circle().fill(item.tone.color.opacity(0.15)).frame(width: 24, height: 24)
                Image(systemName: "battery.25")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(item.tone.color)
            }
            if !isLast {
                Rectangle().fill(Color.TS.border).frame(width: 2).frame(maxHeight: .infinity)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Empty states (web `EmptyState`)

/// The full-size "no vampire drain data" empty view for the surface's empty phase
/// (web `EmptyState` — `No vampire drain data`). Never a blank panel.
struct DrainEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                VampireDrainStrings.text("widget.vampireDrain.noData", "No vampire drain data")
            } icon: {
                Image(systemName: "battery.25")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The inline "no recent drain events" empty used inside the feed (web feed
/// `emptyMessage`). Sized to the feed chrome rather than the whole surface.
struct DrainFeedEmpty: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "battery.25")
                .font(.system(size: 14))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            VampireDrainStrings.text("widget.vampireDrain.noEvents", "No recent drain events")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
