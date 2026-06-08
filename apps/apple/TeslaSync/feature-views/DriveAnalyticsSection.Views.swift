//
//  DriveAnalyticsSection.Views.swift
//  TeslaSync — P4 feature view · 0166 · DriveAnalyticsSection (Apple)
//
//  The presentational chrome for the "Drive Analytics" section: the header + freshness chip, the
//  stale / offline connectivity banner, the date range picker (web `RangePicker`), the glass-panel
//  container (web `GlassPanel`), and the titled chart panel (web `ChartContainer`). All copy resolves
//  through the P1/S10 facade; all chrome is token-driven (P1/S9). The charts and the load-state chrome
//  live in DriveAnalyticsSection.Charts.swift / DriveAnalyticsSection.States.swift.
//

import SwiftUI

// MARK: - Header (web `<h2>Drive Analytics</h2>`)

/// The section header: the web `Drive Analytics` heading with a leading glyph and the live-state
/// freshness chip.
struct DriveAnalyticsSectionHeader: View {
    let connection: DriveAnalyticsSectionConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "chart.bar.xaxis")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            DriveAnalyticsSectionStrings.text("dynamics.driveAnalytics", "Drive Analytics")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            DriveAnalyticsSectionFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct DriveAnalyticsSectionFreshnessChip: View {
    let connection: DriveAnalyticsSectionConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            DriveAnalyticsSectionStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(DriveAnalyticsSectionStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: DriveAnalyticsSectionConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "dynamics.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "dynamics.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "dynamics.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not live, so cached
/// content is clearly labelled (web `DataFreshness` intent).
struct DriveAnalyticsSectionConnectivityBanner: View {
    let connection: DriveAnalyticsSectionConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "dynamics.offlineBanner" : "dynamics.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded drive analytics"
            : "Reconnecting — drive analytics may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            DriveAnalyticsSectionStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Date range picker (web `RangePicker`)

/// The from/to date range filter — the native parity of the web `RangePicker` (`value={{ start, end }}`,
/// `onChange`). Two compact `DatePicker`s drive the bound window; changing either re-runs the query.
struct DriveAnalyticsSectionRangeFilter: View {
    @Binding var start: Date
    @Binding var end: Date

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            field(key: "dynamics.range.from", fallback: "From", selection: $start)
            field(key: "dynamics.range.to", fallback: "To", selection: $end)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func field(key: String, fallback: String, selection: Binding<Date>) -> some View {
        let label = DriveAnalyticsSectionStrings.string(key, fallback)
        return VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            DatePicker(
                selection: selection,
                displayedComponents: [.date]
            ) {
                Text(verbatim: label)
            }
            .labelsHidden()
            .datePickerStyle(.compact)
            .accessibilityLabel(Text(verbatim: label))
        }
    }
}

// MARK: - Glass panel container (web `<GlassPanel>`)

/// The web `GlassPanel` surface used for the chart cards: the semantic surface fill clipped to the panel
/// radius with the glass-border stroke.
struct DriveAnalyticsSectionGlassPanel<Content: View>: View {
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

// MARK: - Titled chart panel (web `ChartContainer`)

/// The web `ChartContainer`: a glass panel with a title + subtitle header above the chart content.
struct DriveAnalyticsSectionPanel<Content: View>: View {
    let titleKey: String
    let titleFallback: String
    let subtitleKey: String
    let subtitleFallback: String
    @ViewBuilder let content: () -> Content

    var body: some View {
        DriveAnalyticsSectionGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                VStack(alignment: .leading, spacing: 2) {
                    DriveAnalyticsSectionStrings.text(titleKey, titleFallback)
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    DriveAnalyticsSectionStrings.text(subtitleKey, subtitleFallback)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                content()
            }
        }
    }
}
