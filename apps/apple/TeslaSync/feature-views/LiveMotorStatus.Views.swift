//
//  LiveMotorStatus.Views.swift
//  TeslaSync — P4 feature view · 0157 · LiveMotorStatus (Apple)
//
//  The presentational subviews composed by `LiveMotorStatus`: the four status cards (web
//  `Grid cols 2/sm:4`), the nine inline metrics (web `grid cols 2/sm:3/lg:4` of `InlineMetric`), the
//  freshness chip, and the loading skeleton. All consume the P1/S10 facade-resolved strings carried
//  on the projection + the shared P1/S9 tokens — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web Tailwind tints map to design tokens —
//  cyan-400 → accent, purple-400 → chartSeriesPower, green-400 → statusSuccess, the text-primary
//  value → textPrimary, red-400 → chartSeriesTemperature, amber-400 → statusWarning, and the muted
//  HV-isolation state → textMuted (see `LiveMotorAccent`).
//

import SwiftUI

// MARK: - Accent → design token (web Tailwind tint → P1/S9 token)

extension LiveMotorAccent {
    /// The design-token colour for the web tint this accent represents.
    var color: Color {
        switch self {
        case .cyan: Color.TS.accent
        case .power: Color.TS.chartSeriesPower
        case .success: Color.TS.statusSuccess
        case .primary: Color.TS.textPrimary
        case .temperature: Color.TS.chartSeriesTemperature
        case .warning: Color.TS.statusWarning
        case .muted: Color.TS.textMuted
        }
    }
}

// MARK: - Status card tile (web `rounded-lg bg-white/[0.03] border` label + bold value)

/// One top status card: an uppercase muted label over a bold, colour-coded value (web Shift State /
/// Power / Regen / Source). The value already carries the web-formatted string (or the em-dash).
struct LiveMotorStatusCardTile: View {
    let card: LiveMotorStatusCard

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: card.label)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.5)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
            Text(verbatim: card.value)
                .font(Font.TS.panel)
                .fontWeight(.bold)
                .foregroundStyle(card.accent.color)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .padding(.horizontal, TSSpacing.sm)
        .background(
            Color.TS.textPrimary.opacity(0.04),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: LiveMotorAccessibility.tile(card.label, card.value)))
    }
}

// MARK: - Inline metric (web `InlineMetric icon + value + label`)

/// One inline metric: the tinted SF Symbol (web lucide icon) beside the value + muted label. The web
/// renders these inline (`icon value label`); native stacks the value over the label so a long pair
/// ("5,230 RPM" / "Front Motor RPM") never truncates inside a compact two-column grid cell.
struct LiveMotorMetricRow: View {
    let metric: LiveMotorMetric

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: metric.systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(metric.accent.color)
                .frame(width: 16)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: metric.value)
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: metric.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: LiveMotorAccessibility.tile(metric.label, metric.value)))
    }
}

// MARK: - Content grid (web status-card grid + inline-metric grid)

/// The populated body: the four status cards (web `Grid cols 2/sm:4`) above the nine inline metrics
/// (web `grid cols 2/sm:3/lg:4`), both width-adaptive so they reflow from a compact iPhone to iPad /
/// macOS.
struct LiveMotorStatusGrid: View {
    let projection: LiveMotorProjection

    private let cardColumns = [GridItem(.adaptive(minimum: 132), spacing: TSSpacing.sm, alignment: .top)]
    private let metricColumns = [GridItem(.adaptive(minimum: 156), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            LazyVGrid(columns: cardColumns, alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(projection.cards) { LiveMotorStatusCardTile(card: $0) }
            }
            LazyVGrid(columns: metricColumns, alignment: .leading, spacing: TSSpacing.md) {
                ForEach(projection.metrics) { LiveMotorMetricRow(metric: $0) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Freshness chip (P4 leaf freshness axis)

/// The header freshness affordance: a tinted dot + label shown while fetching or when the bound
/// source is stale / offline. Live + idle hides it (the surface header is then just the title).
struct LiveMotorFreshnessChip: View {
    let connection: LiveMotorConnection
    let isFetching: Bool
    let updatedAt: Date?

    private var descriptor: (tone: Color, label: String) {
        switch connection {
        case .offline:
            (Color.TS.textMuted, LiveMotorStatusStrings.string("drivetrain.motor.offline", "Offline"))
        case .stale:
            (Color.TS.statusWarning, LiveMotorStatusStrings.string("drivetrain.motor.stale", "Stale"))
        case .live:
            (Color.TS.accent, LiveMotorStatusStrings.string("drivetrain.motor.updating", "Updating"))
        }
    }

    var body: some View {
        let descriptor = descriptor
        return HStack(spacing: 4) {
            Circle()
                .fill(descriptor.tone)
                .frame(width: 6, height: 6)
            Text(verbatim: descriptor.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(descriptor.tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: descriptor.label))
    }
}

// MARK: - Loading skeleton (P4 leaf loading chrome)

/// The initial-fetch chrome: skeleton status cards above skeleton metric rows so the surface keeps
/// its shape while the parent query resolves.
struct LiveMotorLoadingGrid: View {
    private let cardColumns = [GridItem(.adaptive(minimum: 132), spacing: TSSpacing.sm, alignment: .top)]
    private let metricColumns = [GridItem(.adaptive(minimum: 156), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            LazyVGrid(columns: cardColumns, alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    VStack(spacing: TSSpacing.xs) {
                        TSSkeleton(width: 56, height: 9)
                        TSSkeleton(width: 76, height: 16)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, TSSpacing.md)
                    .padding(.horizontal, TSSpacing.sm)
                    .overlay(
                        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                            .strokeBorder(Color.TS.border, lineWidth: 1)
                    )
                }
            }
            LazyVGrid(columns: metricColumns, alignment: .leading, spacing: TSSpacing.md) {
                ForEach(0 ..< 8, id: \.self) { _ in
                    HStack(spacing: TSSpacing.sm) {
                        TSSkeleton(width: 16, height: 16, cornerRadius: TSRadius.sm)
                        TSSkeleton(height: 12)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: LiveMotorStatusStrings.string(
            "drivetrain.motor.loading", "Loading live motor status"
        )))
    }
}
