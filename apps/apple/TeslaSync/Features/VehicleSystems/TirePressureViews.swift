//
//  TirePressureViews.swift
//  TeslaSync — P4 feature view · P7 · TirePressure (Apple) — Shared UI + panels
//
//  The shared HIG furniture (the `GlassPanel` peer, the section badge, the status
//  badge, the `MetricCard` peer, the staleness chip) plus three panels: the TPMS
//  warning banner (web GlassPanel 1), the four summary `MetricCard`s
//  (Avg / Min / Warning-Count / Last-Updated) and the "Current Readings" gauges
//  panel (web GlassPanel 2) with its per-corner gauge card (web GlassPanel 3).
//  Materials stand in for the web glass (ADR-005); every color/typography value
//  comes from the generated design tokens (P2); every string from the catalog.
//

import SwiftUI

// MARK: - Shared furniture (web GlassPanel / Badge)

/// The frosted card that stands in for the web `GlassPanel`.
struct TirePressureCard<Content: View>: View {
    var padding: CGFloat = TSSpacing.xl
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.lg))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg)
                    .stroke(Color.TS.border, lineWidth: 1)
            )
    }
}

/// Section header: an SF Symbol next to an info pill (web icon + `Badge` info).
struct TirePressureSectionHeader: View {
    let systemImage: String
    let title: String
    var tone: TirePressureTone = .info

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            Text(title)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(tone.color)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs)
                .background(tone.color.opacity(0.15), in: Capsule())
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(title))
    }
}

/// Small status pill (web `Badge` with optional leading dot).
struct TirePressureStatusBadge: View {
    let text: String
    let tone: TirePressureTone
    var showsDot = false

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if showsDot {
                Circle()
                    .fill(tone.color)
                    .frame(width: 6, height: 6)
                    .accessibilityHidden(true)
            }
            Text(text)
                .font(Font.TS.label)
                .fontWeight(.semibold)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .foregroundStyle(tone.color)
        .background(tone.color.opacity(0.15), in: Capsule())
    }
}

/// The summary metric tile (web `MetricCard`): leading icon, big value, caption.
struct TirePressureMetricCard: View {
    let label: String
    let value: String
    let systemImage: String
    let accent: Color

    var body: some View {
        TirePressureCard(padding: TSSpacing.lg) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Image(systemName: systemImage)
                    .font(Font.TS.panel)
                    .foregroundStyle(accent)
                    .accessibilityHidden(true)
                Text(value)
                    .font(Font.TS.title)
                    .foregroundStyle(Color.TS.textPrimary)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(label)
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(label): \(value)"))
    }
}

/// Subtle chip surfaced when the last refresh is older than two minutes (ADR-013).
struct TirePressureStalenessChip: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "clock.badge.exclamationmark")
            Text(String(localized: "translation.common.staleData", defaultValue: "Data may be out of date"))
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.statusWarning)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.statusWarning.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

// MARK: - GlassPanel 1 — TPMS warning banner

/// The TPMS warning banner (web GlassPanel 1) — only shown when a warning is
/// active, tinted red for a hard warning and amber for a soft one.
struct TirePressureWarningBanner: View {
    let isHard: Bool

    private var tone: TirePressureTone { isHard ? .danger : .warning }

    private var text: String {
        isHard
            ? String(localized: "translation.Hard Warning Active", defaultValue: "Hard Warning Active")
            : String(localized: "translation.Soft Warning Active", defaultValue: "Soft Warning Active")
    }

    var body: some View {
        TirePressureCard(padding: TSSpacing.md) {
            HStack(spacing: TSSpacing.md) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(tone.color)
                    .accessibilityHidden(true)
                TirePressureStatusBadge(text: text, tone: tone)
                Spacer(minLength: 0)
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg)
                .stroke(tone.color.opacity(0.4), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(text))
    }
}

// MARK: - Summary row — Avg / Min / Warning-Count / Last-Updated MetricCards

/// The four summary `MetricCard`s (web GlassPanel anonymous summary grid).
struct TirePressureSummaryRow: View {
    let summary: TirePressureSummary?
    let unit: TirePressureUnit
    let lastUpdated: Date?

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
            TirePressureMetricCard(
                label: String(localized: "translation.Avg Pressure", defaultValue: "Avg Pressure"),
                value: averageText,
                systemImage: "gauge.with.dots.needle.50percent",
                accent: Color.TS.statusInfo
            )
            TirePressureMetricCard(
                label: String(localized: "translation.Min Pressure", defaultValue: "Min Pressure"),
                value: minimumText,
                systemImage: "arrow.down.right.circle",
                accent: Color.TS.statusSuccess
            )
            TirePressureMetricCard(
                label: String(localized: "translation.Warning Count", defaultValue: "Warning Count"),
                value: "\(summary?.warningCount ?? 0)",
                systemImage: "exclamationmark.triangle",
                accent: Color.TS.statusWarning
            )
            TirePressureMetricCard(
                label: String(localized: "translation.Last Updated", defaultValue: "Last Updated"),
                value: lastUpdatedText,
                systemImage: "clock",
                accent: Color.TS.chartSeriesPower
            )
        }
    }

    private var averageText: String {
        guard let summary else { return "—" }
        return TirePressureFormat.valueWithUnit(summary.averagePascals, unit: unit)
    }

    private var minimumText: String {
        guard let summary else { return "—" }
        return TirePressureFormat.valueWithUnit(summary.minimumPascals, unit: unit)
    }

    private var lastUpdatedText: String {
        guard let lastUpdated else { return "—" }
        return TirePressureFormat.dateTime(lastUpdated)
    }
}

// MARK: - GlassPanel 2 — "Current Readings" gauges panel

/// The four-corner gauge panel (web GlassPanel 2), header badge + adaptive grid
/// of per-corner gauge cards.
struct TirePressureGaugesPanel: View {
    let latest: TirePressureReading?
    let unit: TirePressureUnit
    let gaugeMaximum: Double
    let isLoading: Bool

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.lg)]

    var body: some View {
        TirePressureCard {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TirePressureSectionHeader(
                    systemImage: "gauge.with.dots.needle.bottom.50percent",
                    title: String(localized: "translation.Current Readings", defaultValue: "Current Readings")
                )
                LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
                    ForEach(TirePosition.allCases) { position in
                        TirePressureGaugeCard(
                            position: position,
                            pascals: latest?.pascals(for: position) ?? 0,
                            unit: unit,
                            gaugeMaximum: gaugeMaximum,
                            isLoading: isLoading
                        )
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - GlassPanel 3 — per-corner gauge card

/// A single corner's gauge card (web GlassPanel 3): the radial gauge plus a
/// status badge, or a redacted skeleton while the latest reading reloads.
struct TirePressureGaugeCard: View {
    let position: TirePosition
    let pascals: Double
    let unit: TirePressureUnit
    let gaugeMaximum: Double
    let isLoading: Bool

    private var status: TirePressureStatus {
        TirePressureMath.status(forPascals: pascals)
    }

    var body: some View {
        TirePressureCard(padding: TSSpacing.lg) {
            VStack(spacing: TSSpacing.md) {
                if isLoading {
                    gaugeSkeleton
                } else {
                    TirePressureRadialGauge(
                        value: TirePressureConvert.fromPascals(pascals, to: unit),
                        maximum: gaugeMaximum,
                        label: position.label,
                        unit: unit.label,
                        tone: status.tone
                    )
                    TirePressureStatusBadge(text: status.label, tone: status.tone)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    // The reload skeleton (web `<Skeleton height={120} />`).
    private var gaugeSkeleton: some View {
        VStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(Color.TS.surface)
                .frame(width: 120, height: 120)
            Capsule()
                .fill(Color.TS.surface)
                .frame(width: 64, height: 16)
        }
        .redacted(reason: .placeholder) // parity:allow native shimmer for the gauge reload state
    }
}
