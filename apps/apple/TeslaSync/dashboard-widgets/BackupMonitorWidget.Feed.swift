//
//  BackupMonitorWidget.Feed.swift
//  TeslaSync — P4 dashboard widget · 0009 · BackupMonitorWidget (Apple)
//
//  The native subviews that compose the surface: the 2×2 stat tiles (web
//  `StatCard`), the special status tile (label + badge, red-tinted on failure),
//  the per-status chip (web `Badge`), the wide "Recent Runs" rows, the compact
//  latest badge, and the freshness chip. They lean on the shared design tokens
//  so they read identically to the rest of the app. The `BackupTone → Color`
//  mapping lives here (the view layer) so the projection stays renderer-agnostic.
//

import SwiftUI

// MARK: - Tone → palette (web statusVariant tone → design tokens)

extension BackupTone {
    /// The design-token color for this tone — the semantic mapping of the web
    /// `statusVariant` (success/warning/danger) onto the generated `Color.TS`
    /// palette.
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        }
    }
}

// MARK: - Stat tile (web `StatCard`)

/// One labelled metric tile — a native port of the web `StatCard`: a small
/// uppercase muted label over its value, on a faint glass card.
struct BackupStatTile: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Text(verbatim: value)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(value)"))
    }
}

// MARK: - Status tile (web Status `StatCard` + Badge + red-on-fail background)

/// The 4th grid tile: a "Status" label over the status `Badge`. The web tints
/// the whole tile red when the latest run failed (`bg-red-500/10`); reproduced
/// here as a faint danger fill.
struct BackupStatusTile: View {
    let label: String
    let statusLabel: String
    let tone: BackupTone
    let showsFailedBackground: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            BackupStatusChip(label: statusLabel, tone: tone)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.sm)
        .background(tileBackground, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(statusLabel)"))
    }

    private var tileBackground: Color {
        showsFailedBackground ? Color.TS.statusDanger.opacity(0.1) : Color.TS.surface
    }
}

// MARK: - Status chip (web `Badge`)

/// The tinted capsule label for a status, styled with the same tokens as the
/// shared `TSBadge` (which takes a `LocalizedStringKey`, so it cannot resolve
/// this surface's per-table string — hence the small specialization).
struct BackupStatusChip: View {
    let label: String
    let tone: BackupTone

    var body: some View {
        Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .lineLimit(1)
    }
}

// MARK: - Recent runs list (web wide-layout list)

/// The wide-layout "Recent Runs" list — the last five backups, each with a status
/// dot, an absolute timestamp, a "size · duration" detail, and a status chip.
struct BackupRecentRunsList: View {
    let title: String
    let rows: [BackupRunRow]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: title)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: TSSpacing.xs) {
                    ForEach(rows) { row in BackupRecentRunRow(row: row) }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

/// One "Recent Runs" row.
struct BackupRecentRunRow: View {
    let row: BackupRunRow

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(row.statusTone.color)
                .frame(width: 8, height: 8)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: row.timeText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(verbatim: row.detailText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.xs)
            BackupStatusChip(label: row.statusLabel, tone: row.statusTone)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .frame(minHeight: 44)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: BackupMonitorAccessibility.rowSummary(row)))
    }
}

// MARK: - Compact latest badge (web compact `size.cols <= 1` branch)

/// The compact (1-column) summary: a status dot, the latest "last backup"
/// relative time, and the "Last backup" caption — a native port of the web
/// compact branch.
struct BackupCompactRow: View {
    let latest: BackupLatest
    let lastBackupLabel: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(latest.statusTone.color)
                .frame(width: 10, height: 10)
                .shadow(color: latest.statusTone.color.opacity(0.4), radius: 3)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: latest.lastBackupRelative)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(verbatim: lastBackupLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: BackupMonitorAccessibility.compactSummary(latest)))
    }
}

// MARK: - Freshness chip (web `DataFreshness`)

/// The live / stale / offline freshness chip shown in the header, mirroring the
/// shared `DataFreshness` dot the web `WidgetShell` renders.
struct BackupFreshnessChip: View {
    let connection: BackupMonitorConnection

    var body: some View {
        let tone: Color
        let label: String
        switch connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = BackupMonitorStrings.string("widget.backupMonitor.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = BackupMonitorStrings.string("widget.backupMonitor.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = BackupMonitorStrings.string("widget.backupMonitor.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}
