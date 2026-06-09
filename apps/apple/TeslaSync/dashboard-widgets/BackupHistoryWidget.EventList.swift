//
//  BackupHistoryWidget.EventList.swift
//  TeslaSync — P4 dashboard widget · 0008 · BackupHistoryWidget (Apple)
//
//  The native subviews that compose the surface: the freshness chip (web
//  `DataFreshness`), the stale / offline connectivity banner, the stat tile (web
//  `StatCard`), the duration badge (web `Badge variant="neutral"`), the outage
//  events list with its per-row timestamp + duration, and the self-contained
//  loading skeleton bar. They lean on the shared design tokens so they read
//  identically to the rest of the app.
//

import SwiftUI

// MARK: - Freshness chip (web `DataFreshness`)

/// The live / stale / offline freshness chip shown in the header, mirroring the
/// shared `DataFreshness` dot the web `WidgetShell` renders.
struct BackupHistoryFreshnessChip: View {
    let connection: BackupHistoryConnection

    var body: some View {
        let tone: Color
        let label: String
        switch connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = BackupHistoryStrings.string("widget.backupHistory.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = BackupHistoryStrings.string("widget.backupHistory.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = BackupHistoryStrings.string("widget.backupHistory.offline", "Offline")
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
/// so cached events stay visible with an honest freshness cue.
struct BackupHistoryConnectivityBanner: View {
    let connection: BackupHistoryConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline
            ? "widget.backupHistory.offlineBanner"
            : "widget.backupHistory.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last synced events"
            : "Reconnecting — events may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            BackupHistoryStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Stat tile (web `StatCard`)

/// One summary statistic — the native port of the web `StatCard`
/// (`label` over `value`). Animates value changes and honors Reduce Motion.
struct BackupHistoryStatTile: View {
    let label: String
    let value: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(verbatim: value)
                .font(Font.TS.section)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .contentTransition(.numericText())
                .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration), value: value)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label). \(value)"))
    }
}

// MARK: - Duration badge (web `Badge` variant="neutral")

/// The per-event duration chip — the native port of the web row `Badge`
/// (`variant="neutral"`). Renders the already-formatted duration verbatim.
struct BackupHistoryDurationBadge: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.textMuted.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.textMuted.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Skeleton bar (self-contained loading indicator)

/// A single rounded skeleton bar for the loading chrome. Self-contained (no
/// shared skeleton dependency); pulses gently and stays still under Reduce
/// Motion.
struct BackupHistorySkeletonBar: View {
    var width: CGFloat?
    var height: CGFloat = 36
    var cornerRadius: CGFloat = TSRadius.md
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(Color.TS.border.opacity(pulse ? 0.45 : 0.25))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true)) {
                    pulse = true
                }
            }
            .accessibilityHidden(true)
    }
}

// MARK: - Outage events list (web event list)

/// The outage events list — a native port of the web event list. The rows arrive
/// already sorted (newest first) and capped by the caller; each renders its
/// timestamp, an optional "Duration: …" subtitle (standard layout), and a
/// duration badge. Honors the web 44pt minimum hit target.
struct BackupHistoryEventList: View {
    let rows: [BackupHistoryRow]
    let showSubtitle: Bool
    let durationLabel: String

    var body: some View {
        ScrollView {
            LazyVStack(spacing: TSSpacing.xs) {
                ForEach(rows) { row in
                    BackupHistoryEventRow(row: row, showSubtitle: showSubtitle, durationLabel: durationLabel)
                }
            }
        }
    }
}

/// One outage row: a bolt glyph · the event timestamp (with an optional
/// "Duration: …" subtitle) · the duration badge, over a subtle surface.
struct BackupHistoryEventRow: View {
    let row: BackupHistoryRow
    let showSubtitle: Bool
    let durationLabel: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.chartSeriesEnergy)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: row.timeText)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if showSubtitle {
                    Text(verbatim: "\(durationLabel): \(row.durationText)")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            BackupHistoryDurationBadge(text: row.durationText)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(minHeight: 44)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: BackupHistoryAccessibility.eventLabel(time: row.timeText, duration: row.durationText))
        )
    }
}
