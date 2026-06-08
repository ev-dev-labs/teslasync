//
//  DrivingSection.Views.swift
//  TeslaSync — P4 feature view · 0075 · DrivingSection (Apple)
//
//  The presentational chrome for the "Driving" section: the panel header + freshness chip, the
//  stale / offline connectivity banner, the glass-panel container, the four mini-stat tiles (web
//  `MiniStat`), and the Top Drive card (web success `Badge` + labelled grid). All copy resolves
//  through the P1/S10 facade; all chrome is token-driven (P1/S9). The chart and the load-state
//  chrome live in DrivingSection.Chart.swift / DrivingSection.States.swift.
//

import SwiftUI

// MARK: - Header (web `<Car/> Driving`)

/// The section header: the web `<span class="…text-lg font-bold"><Car/> Driving</span>` with a car
/// glyph (web lucide `Car`) and the live-state freshness chip.
struct DrivingSectionHeader: View {
    let connection: DrivingSectionConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "car.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            DrivingSectionStrings.text("analytics.weeklyDigest.drivingSection", "Driving")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            DrivingSectionFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct DrivingSectionFreshnessChip: View {
    let connection: DrivingSectionConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            DrivingSectionStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(DrivingSectionStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: DrivingSectionConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "analytics.weeklyDigest.driving.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "analytics.weeklyDigest.driving.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "analytics.weeklyDigest.driving.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not live, so cached
/// content is clearly labelled (web `DataFreshness` intent).
struct DrivingSectionConnectivityBanner: View {
    let connection: DrivingSectionConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline
            ? "analytics.weeklyDigest.driving.offlineBanner"
            : "analytics.weeklyDigest.driving.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded weekly digest"
            : "Reconnecting — weekly digest may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            DrivingSectionStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Glass panel container (web `<GlassPanel>`)

/// The web `GlassPanel` surface used for the nested chart / top-drive cards and the mini-stat tiles:
/// the semantic surface fill clipped to the panel radius with the glass-border stroke.
struct DrivingGlassPanel<Content: View>: View {
    private let padding: CGFloat
    private let content: Content

    init(padding: CGFloat = TSSpacing.lg, @ViewBuilder content: () -> Content) {
        self.padding = padding
        self.content = content()
    }

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

// MARK: - Mini-stat tiles (web `MiniStat`)

/// One mini-stat tile (web `MiniStat`): a leading glyph, a label, and a value. For the
/// efficiency-change tile the glyph is the trend arrow tinted emerald (improving) or red (worsening).
struct DrivingStatTile: View {
    let stat: DrivingStat

    var body: some View {
        DrivingGlassPanel(padding: TSSpacing.md) {
            HStack(spacing: TSSpacing.md) {
                icon
                    .frame(width: 18, height: 18)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: stat.label)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                    Text(verbatim: stat.value)
                        .font(Font.TS.body)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                        .monospacedDigit()
                }
                Spacer(minLength: 0)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: stat.accessibilityLabel))
    }

    @ViewBuilder
    private var icon: some View {
        switch stat.kind {
        case .avgEfficiency:
            Image(systemName: "chart.bar.fill").foregroundStyle(Color.TS.textMuted)
        case .totalDrivingTime:
            Image(systemName: "clock.fill").foregroundStyle(Color.TS.textMuted)
        case .efficiencyChange:
            Image(systemName: stat.trend == .down ? "arrow.down.right" : "arrow.up.right")
                .foregroundStyle(stat.trendTone == .positive ? Color.TS.statusSuccess : Color.TS.statusDanger)
        case .drives:
            Image(systemName: "waveform.path.ecg").foregroundStyle(Color.TS.textMuted)
        }
    }
}

/// The responsive grid of the four mini-stat tiles (web `grid grid-cols-1 sm:grid-cols-2
/// lg:grid-cols-4`): an adaptive grid that collapses to fewer columns on narrow widths.
struct DrivingStatsGrid: View {
    let stats: [DrivingStat]

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(stats) { stat in
                DrivingStatTile(stat: stat)
            }
        }
    }
}

// MARK: - Top Drive card (web success `Badge` + labelled grid)

/// The Top Drive panel (web `metrics.topDrive` branch): a success `Badge` and a labelled grid of the
/// drive's Date / Distance / Duration / Efficiency, or its own `EmptyState` when there is no drive.
struct DrivingTopDrivePanel: View {
    let card: DrivingTopDriveCard?

    var body: some View {
        DrivingGlassPanel {
            if let card {
                content(card)
            } else {
                DrivingTopDriveEmpty()
            }
        }
    }

    private func content(_ card: DrivingTopDriveCard) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            DrivingTopDriveBadge(text: card.badge)
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.lg)],
                alignment: .leading,
                spacing: TSSpacing.md
            ) {
                ForEach(card.rows) { row in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: row.label)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                        Text(verbatim: row.value)
                            .font(Font.TS.body)
                            .fontWeight(.semibold)
                            .foregroundStyle(Color.TS.textPrimary)
                            .monospacedDigit()
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: card.accessibilityLabel))
    }
}

/// The web success `<Badge variant="success" size="sm">Top Drive</Badge>` — an emerald-tinted chip.
struct DrivingTopDriveBadge: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.statusSuccess)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 4)
            .background(Color.TS.statusSuccess.opacity(0.16), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.statusSuccess.opacity(0.35), lineWidth: 1))
    }
}

/// The Top Drive empty state (web `<EmptyState message={t('…noTopDrive')}>`): never a blank box.
struct DrivingTopDriveEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                DrivingSectionStrings.text(
                    "analytics.weeklyDigest.noTopDrive",
                    "No top drive is available for this week yet."
                )
            } icon: {
                Image(systemName: "trophy")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 140)
    }
}
