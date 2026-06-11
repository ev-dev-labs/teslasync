//
//  DriveScore.Views.swift
//  TeslaSync — P4 shared surface · 0082 · DriveScore (Apple)
//
//  The presentational pieces of the drive score: the category / band → design-token color projections
//  (the web `'#00f0ff'` / `'#a855f7'` / `'#10b981'` / `'#f59e0b'` axis colors and the
//  `getScoreColor` red / amber / green), the animated circular gauge (the native peer of the web
//  `<motion.circle>` arc), and the breakdown bars (the web `<motion.div>` width reveals). All chrome
//  is token-driven (P1/S9); the gauge number uses `.monospacedDigit()`; the reveal animations honor
//  Reduce Motion; no raw hex, no Tailwind ports.
//

import SwiftUI

// MARK: - DriveScoreSurfaceCategory → design tokens (web axis colors)

extension DriveScoreSurfaceCategory {
    /// The axis accent — the theme-aware token projection of the web hex colors: efficiency → the
    /// brand cyan accent (`#00f0ff` in dark), speed → the power series (`#a855f7`), range → the
    /// battery series (`#10b981`), trip → the energy series (`#f59e0b`). Reads from the design system
    /// so each recolors across light / dark / high-contrast where the web fixed hex did not.
    var accentColor: Color {
        switch self {
        case .efficiency: Color.TS.accent
        case .speedDiscipline: Color.TS.chartSeriesPower
        case .rangePreservation: Color.TS.chartSeriesBattery
        case .tripLength: Color.TS.chartSeriesEnergy
        }
    }
}

// MARK: - DriveScoreSurfaceBand → design tokens (web `getScoreColor`)

extension DriveScoreSurfaceBand {
    /// The gauge color — the theme-aware token projection of the web `getScoreColor` hex:
    /// `poor → statusDanger` (#ef4444), `fair → statusWarning` (#f59e0b), `good → statusSuccess`
    /// (#10b981). Recolors across light / dark / high-contrast.
    var color: Color {
        switch self {
        case .poor: Color.TS.statusDanger
        case .fair: Color.TS.statusWarning
        case .good: Color.TS.statusSuccess
        }
    }
}

// MARK: - Reveal animations (web framer-motion, Reduce-Motion-aware)

/// The surface's two reveal animations, projected from the web `transition` props and gated on Reduce
/// Motion (returns `nil` → an instant transition). The web eases both with
/// `cubic-bezier(0.16, 1, 0.3, 1)`; the arc takes 1.2 s and the bars 0.8 s.
enum DriveScoreSurfaceMotion {
    static func arc(reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: 1.2)
    }

    static func bar(reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .timingCurve(0.16, 1, 0.3, 1, duration: 0.8)
    }
}

// MARK: - DriveScoreSurfaceGaugeView (web `<svg>` circular gauge)

/// The animated circular gauge — the native peer of the web background circle + `<motion.circle>`
/// score arc + centered "{total} / Score" overlay. The arc fills from 0 to `projection.fillFraction`
/// on appear (and re-animates when the score changes), in the band color; Reduce Motion makes it
/// instant. VoiceOver reads the whole gauge as one element with the resolved score label.
struct DriveScoreSurfaceGaugeView: View {
    let projection: DriveScoreSurfaceProjection
    let scoreCaption: String
    let accessibilityLabel: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animatedFill: Double = 0

    private let diameter: CGFloat = 120
    private let lineWidth: CGFloat = 10

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.TS.border, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: animatedFill)
                .stroke(
                    projection.band.color,
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            centerOverlay
        }
        .frame(width: diameter, height: diameter)
        .onAppear { reveal(to: projection.fillFraction) }
        .onChange(of: projection.fillFraction) { _, newValue in reveal(to: newValue) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var centerOverlay: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: String(projection.total))
                .font(Font.TS.display)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(projection.band.color)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            Text(verbatim: scoreCaption)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private func reveal(to target: Double) {
        if let animation = DriveScoreSurfaceMotion.arc(reduceMotion: reduceMotion) {
            withAnimation(animation) { animatedFill = target }
        } else {
            animatedFill = target
        }
    }
}

// MARK: - DriveScoreSurfaceProgressBar (web `<motion.div>` width reveal)

/// A single breakdown bar — a rounded track with a tinted fill that reveals from 0 to `fraction` on
/// appear (and re-animates when it changes), honoring Reduce Motion. Decorative (the row owns the
/// VoiceOver label), so the bar itself is hidden from accessibility.
struct DriveScoreSurfaceProgressBar: View {
    let fraction: Double
    let color: Color

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animatedFraction: Double = 0

    private let height: CGFloat = 6

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.border.opacity(0.3))
                Capsule()
                    .fill(color)
                    .frame(width: geo.size.width * clamped(animatedFraction))
            }
        }
        .frame(height: height)
        .onAppear { reveal(to: fraction) }
        .onChange(of: fraction) { _, newValue in reveal(to: newValue) }
        .accessibilityHidden(true)
    }

    private func clamped(_ value: Double) -> Double {
        min(max(value, 0), 1)
    }

    private func reveal(to target: Double) {
        if let animation = DriveScoreSurfaceMotion.bar(reduceMotion: reduceMotion) {
            withAnimation(animation) { animatedFraction = target }
        } else {
            animatedFraction = target
        }
    }
}

// MARK: - DriveScoreSurfaceBreakdownRow (web breakdown entry)

/// One breakdown entry — the native peer of the web `{label}` / `{value}/{max}` header + the bar. The
/// row is a single VoiceOver element carrying the resolved "{axis}: {value} of {max} points" label.
struct DriveScoreSurfaceBreakdownRow: View {
    let row: DriveScoreSurfaceRowViewData

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                Text(verbatim: row.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: "\(row.item.value)/\(row.item.maxPoints)")
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .monospacedDigit()
                    .foregroundStyle(row.item.category.accentColor)
            }
            DriveScoreSurfaceProgressBar(
                fraction: row.item.fraction,
                color: row.item.category.accentColor
            )
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: row.accessibilityLabel))
    }
}

// MARK: - DriveScoreSurfaceContentView (web `GlassPanel` composition)

/// The full surface body — the native peer of the web `<GlassPanel className="p-5">`: the gauge on
/// the leading edge and the titled breakdown filling the rest, on a glass panel. A pure function of
/// its resolved inputs — no networking, no facade calls, no derivation.
struct DriveScoreSurfaceContentView: View {
    let projection: DriveScoreSurfaceProjection
    let title: String
    let scoreCaption: String
    let scoreAccessibilityLabel: String
    let rows: [DriveScoreSurfaceRowViewData]

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.x2xl) {
            DriveScoreSurfaceGaugeView(
                projection: projection,
                scoreCaption: scoreCaption,
                accessibilityLabel: scoreAccessibilityLabel
            )
            breakdown
        }
        .padding(TSSpacing.xl)
        .tsGlassPanel()
    }

    private var breakdown: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: title)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            ForEach(rows) { row in
                DriveScoreSurfaceBreakdownRow(row: row)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
