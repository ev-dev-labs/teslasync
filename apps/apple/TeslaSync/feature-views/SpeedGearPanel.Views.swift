//
//  SpeedGearPanel.Views.swift
//  TeslaSync — P4 feature view · 0174 · SpeedGearPanel (Apple)
//
//  The presentational subviews composed by `SpeedGearPanel`: the shift cell (the big gear letter +
//  the "Shift State" badge), the three value cells (Motor Power / Avg Drive Speed / Top Drive Speed),
//  the content grid (web `Grid cols 2 / md:4`), the freshness chip, and the loading skeleton. All
//  consume the P1/S10 facade-resolved strings carried on the projection + the shared P1/S9 tokens —
//  no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web shift-letter Tailwind tints map to design
//  tokens — emerald-400 → statusSuccess, red-400 → statusDanger, yellow-400 → statusWarning, the
//  `--text-muted` var → textMuted, and the `--text-secondary` fallback → textSecondary; the value
//  text maps to textPrimary and the badge tones to the shared `TSTone` ladder.
//

import SwiftUI

// MARK: - Shift accent → design token (web shiftColor tint → P1/S9 token)

extension SpeedGearShiftAccent {
    /// The design-token colour for the web shift-letter tint this accent represents.
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .danger: Color.TS.statusDanger
        case .warning: Color.TS.statusWarning
        case .muted: Color.TS.textMuted
        case .secondary: Color.TS.textSecondary
        }
    }
}

// MARK: - Badge tone → shared TSTone (web Badge variant → P1/S9 component tone)

extension SpeedGearBadgeTone {
    /// The shared `TSBadge` tone for the web `shiftBadgeVariant` this tone represents.
    var tsTone: TSTone {
        switch self {
        case .success: .success
        case .danger: .danger
        case .warning: .warning
        case .neutral: .neutral
        }
    }
}

// MARK: - Shift cell (web shift column: 5xl gear letter + Shift State badge)

/// The first grid cell: the big colour-coded gear letter centred over the "Shift State" badge —
/// the web `flex flex-col items-center justify-center gap-2` column.
struct SpeedGearShiftCell: View {
    let shift: SpeedGearShiftTile

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Text(verbatim: shift.letter)
                .font(Font.TS.display)
                .fontWeight(.bold)
                .foregroundStyle(shift.accent.color)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            TSBadge(LocalizedStringKey(shift.badgeLabel), tone: shift.tone.tsTone)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: SpeedGearAccessibility.join([shift.badgeLabel, shift.letter])))
    }
}

// MARK: - Metric cell (web value column: label / 2xl value / unit)

/// One value cell: the muted label over the bold value over the muted unit suffix — the web
/// `flex flex-col items-center gap-1` column. The value already carries the web-formatted string
/// (or the em-dash); the unit is always shown (web renders the unit span regardless of the value).
struct SpeedGearMetricCell: View {
    let metric: SpeedGearMetricTile

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: metric.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(verbatim: metric.value)
                .font(Font.TS.title)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            Text(verbatim: metric.unit)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: SpeedGearAccessibility.join([
            metric.label, "\(metric.value) \(metric.unit)"
        ])))
    }
}

// MARK: - Content grid (web Grid cols 2 / md:4)

/// The populated body: the shift cell followed by the three value cells in a width-adaptive grid
/// that reflows from two columns on a compact iPhone to four on iPad / macOS (web `cols 2 / md:4`).
struct SpeedGearContentGrid: View {
    let projection: SpeedGearProjection

    private let columns = [GridItem(.adaptive(minimum: 140), spacing: TSSpacing.lg, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            SpeedGearShiftCell(shift: projection.shift)
            ForEach(projection.metrics) { SpeedGearMetricCell(metric: $0) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Freshness chip (P4 leaf freshness axis)

/// The header freshness affordance: a tinted dot + label shown while fetching or when the bound
/// source is stale / offline. Live + idle hides it (the surface header is then just the title).
struct SpeedGearFreshnessChip: View {
    let connection: SpeedGearConnection
    let isFetching: Bool

    private var descriptor: (tone: Color, label: String) {
        switch connection {
        case .offline:
            (Color.TS.textMuted, SpeedGearPanelStrings.string("dynamics.speedGear.offline", "Offline"))
        case .stale:
            (Color.TS.statusWarning, SpeedGearPanelStrings.string("dynamics.speedGear.stale", "Stale"))
        case .live:
            (Color.TS.accent, SpeedGearPanelStrings.string("dynamics.speedGear.updating", "Updating"))
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

/// The initial-fetch chrome: four skeleton cells matching the content grid so the surface keeps its
/// shape while the parent query resolves.
struct SpeedGearLoadingGrid: View {
    private let columns = [GridItem(.adaptive(minimum: 140), spacing: TSSpacing.lg, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(0 ..< 4, id: \.self) { _ in
                VStack(spacing: TSSpacing.xs) {
                    TSSkeleton(width: 60, height: 10)
                    TSSkeleton(width: 84, height: 22)
                    TSSkeleton(width: 40, height: 9)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, TSSpacing.sm)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: SpeedGearPanelStrings.string(
            "dynamics.speedGear.loading", "Loading speed and gear"
        )))
    }
}
