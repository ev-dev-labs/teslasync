//
//  ChargingScheduleWidget.Timeline.swift
//  TeslaSync — P4 dashboard widget · 0023 · ChargingScheduleWidget (Apple)
//
//  The native subviews that compose the surface: the freshness chip (web
//  `DataFreshness`), the mode + pending badges (web `Badge`), the scheduled-times
//  timeline (web `Timeline`) with its dot/icon/connector rows, the tall
//  current-level / status detail row, and the compact charge-limit hero (web
//  `WidgetBigNumber`-style). They lean on the shared design tokens so they read
//  identically to the rest of the app.
//

import SwiftUI

// MARK: - Tone → token color

/// Maps the adapter's semantic tones to the shared design tokens, so the view
/// layer carries no raw colors. The timeline tones mirror the web per-item
/// `color` (`#22c55e` / `#3b82f6` / `#f59e0b`); the mode tones mirror the web
/// `Badge` variants (success / neutral / warning).
enum ChargingScheduleTone {
    static func color(_ tone: ChargingScheduleTimelineItem.Tone) -> Color {
        switch tone {
        case .start: Color.TS.statusSuccess
        case .departure: Color.TS.chartSeriesSpeed
        case .limit: Color.TS.chartSeriesEnergy
        }
    }

    static func color(_ tone: ChargingScheduleModeTone) -> Color {
        switch tone {
        case .success: Color.TS.statusSuccess
        case .neutral: Color.TS.textMuted
        case .warning: Color.TS.statusWarning
        }
    }
}

// MARK: - Freshness chip (web `DataFreshness`)

/// The live / stale / offline freshness chip shown in the header, mirroring the
/// shared `DataFreshness` dot the web `WidgetShell` renders.
struct ChargingScheduleFreshnessChip: View {
    let connection: ChargingScheduleConnection

    var body: some View {
        let tone: Color
        let label: String
        switch connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = ChargingScheduleStrings.string("widget.chargingSchedule.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = ChargingScheduleStrings.string("widget.chargingSchedule.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = ChargingScheduleStrings.string("widget.chargingSchedule.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Connectivity banner (web stale / offline shell states)

/// The stale / offline banner shown above the content when the feed is not live,
/// so the cached schedule stays visible with an honest freshness cue.
struct ChargingScheduleConnectivityBanner: View {
    let connection: ChargingScheduleConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline
            ? "widget.chargingSchedule.offlineBanner"
            : "widget.chargingSchedule.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last synced schedule"
            : "Reconnecting — schedule may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            ChargingScheduleStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Mode badge (web `Badge` variant + dot)

/// The schedule-mode chip — the native port of the web `<Badge variant dot>`.
/// A tone-tinted capsule with a leading dot and the localized mode label.
struct ChargingScheduleModeBadge: View {
    let mode: ChargingScheduleMode

    var body: some View {
        let tone = ChargingScheduleTone.color(mode.tone)
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: mode.label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(tone)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(tone.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: mode.label))
    }
}

/// The "Pending" chip shown alongside the mode badge — the web second
/// `<Badge variant="warning">`.
struct ChargingSchedulePendingBadge: View {
    var body: some View {
        let tone = Color.TS.statusWarning
        return ChargingScheduleStrings.text("widget.chargingSchedule.pending", "Pending")
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 3)
            .background(tone.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.25), lineWidth: 1))
            .accessibilityElement(children: .combine)
    }
}

// MARK: - Timeline (web `Timeline`)

/// The scheduled-times timeline — a native port of the web `Timeline`. The rows
/// arrive already formatted by the adapter; this view draws the dot/icon, the
/// connecting line, and the title/time/subtitle for each.
struct ChargingScheduleTimeline: View {
    let items: [ChargingScheduleTimelineItem]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                ChargingScheduleTimelineRow(item: item, isLast: index == items.count - 1)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// One timeline row: a tone-bordered icon dot, the connecting line down to the
/// next row, the event title with its trailing time, and the optional "Pending"
/// subtitle (web `TimelineItem`). Honors a 44pt minimum hit target.
struct ChargingScheduleTimelineRow: View {
    let item: ChargingScheduleTimelineItem
    let isLast: Bool

    var body: some View {
        let tone = ChargingScheduleTone.color(item.tone)
        return HStack(alignment: .top, spacing: TSSpacing.md) {
            ZStack {
                Circle()
                    .fill(Color.TS.surface)
                    .overlay(Circle().strokeBorder(tone, lineWidth: 2))
                Image(systemName: item.iconSystemName)
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(tone)
            }
            .frame(width: 22, height: 22)
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                    Text(verbatim: item.title)
                        .font(Font.TS.body)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(verbatim: item.time)
                        .font(Font.TS.caption)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textMuted)
                }
                if let subtitle = item.subtitle {
                    Text(verbatim: subtitle)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .padding(.bottom, isLast ? 0 : TSSpacing.lg)
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .background(alignment: .topLeading) {
            if !isLast {
                Rectangle()
                    .fill(Color.TS.border)
                    .frame(width: 1.5)
                    .padding(.top, 24)
                    .padding(.leading, 10.25)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var accessibilityLabel: String {
        if let subtitle = item.subtitle {
            return "\(item.title). \(item.time). \(subtitle)"
        }
        return "\(item.title). \(item.time)"
    }
}

// MARK: - Tall detail row (web `Current Level` / `Status` grid)

/// The standard layout's bottom detail row — the web `isTall && state` grid: the
/// current battery level and the live charging status, divided from the timeline
/// by a hairline border.
struct ChargingScheduleDetailRow: View {
    let batteryLevel: Int
    let isCharging: Bool

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            detail(
                labelKey: "widget.chargingSchedule.currentLevel",
                labelFallback: "Current Level",
                value: ChargingScheduleFormat.percent(batteryLevel)
            )
            detail(
                labelKey: "widget.chargingSchedule.status",
                labelFallback: "Status",
                value: isCharging
                    ? ChargingScheduleStrings.string("widget.charging", "Charging")
                    : ChargingScheduleStrings.string("widget.notCharging", "Not Charging")
            )
        }
        .padding(.top, TSSpacing.sm)
        .overlay(alignment: .top) {
            Rectangle().fill(Color.TS.border).frame(height: 1)
        }
        .accessibilityElement(children: .combine)
    }

    private func detail(labelKey: String, labelFallback: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            ChargingScheduleStrings.text(labelKey, labelFallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Compact charge-limit hero (web `WidgetBigNumber`-style)

/// The compact layout's charge-limit hero — the web `size.cols <= 1 &&
/// size.rows <= 1` branch: a big percentage (or em-dash) over the uppercase
/// "Charge Limit" label. Animates value changes and honors Reduce Motion.
struct ChargingScheduleCompactLimit: View {
    let limitText: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: limitText)
                .font(Font.TS.display)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .contentTransition(.numericText())
                .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration), value: limitText)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            ChargingScheduleStrings.text("widget.chargingSchedule.limit", "Charge Limit")
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: ChargingScheduleAccessibility.compactSummary(limitText: limitText))
        )
    }
}
