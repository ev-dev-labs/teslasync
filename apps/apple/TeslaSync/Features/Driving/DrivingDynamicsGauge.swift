//
//  DrivingDynamicsGauge.swift
//  TeslaSync — P4-APPLE P7 · page:driving/DrivingDynamics (Apple) — Local presentational helpers
//
//  Small feature-local SwiftUI views the page composes: the absolute-value radial
//  gauge (web `RadialGauge` with an in-center value + unit, distinct from the
//  shared `TSRadialGauge` which only renders a percentage), plus the section-title
//  and panel-heading roles. All colors/typography come from the design tokens
//  (P2) — never hardcoded — and every string is caller-supplied (already localized
//  through `DDynStrings`), rendered verbatim so it can't be re-keyed.
//

import SwiftUI

/// Web `RadialGauge`: a fractional arc (`value / maxValue`) with the absolute,
/// pre-formatted value + unit at its center and a label caption beneath.
struct DrivingValueGauge: View {
    let value: Double
    let maxValue: Double
    let valueText: String
    let unit: String
    let label: String
    let color: Color
    var size: CGFloat = 120

    private var fraction: Double {
        guard maxValue > 0 else { return 0 }
        return min(max(value / maxValue, 0), 1)
    }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ZStack {
                Circle()
                    .stroke(Color.TS.border.opacity(0.3), lineWidth: 10)
                Circle()
                    .trim(from: 0, to: fraction)
                    .stroke(color, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                VStack(spacing: 2) {
                    Text(verbatim: valueText)
                        .font(Font.TS.panel)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textPrimary)
                    if !unit.isEmpty {
                        Text(verbatim: unit)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
            .frame(width: size, height: size)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityValue(Text(verbatim: "\(valueText) \(unit)"))
    }
}

/// A page section heading (web `<h2>`), rendered verbatim from the localized
/// string and marked as an accessibility header.
struct DrivingSectionTitle: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.section)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A panel/card heading (web `<h3>`), optionally with a leading SF Symbol.
struct DrivingPanelHeading: View {
    let text: String
    var systemImage: String?
    var tone: TSTone = .accent

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(tone.color)
                    .accessibilityHidden(true)
            }
            Text(verbatim: text)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
        }
    }
}

/// A compact label-over-value tile (web `SpeedGearPanel` cells) with a unit caption.
struct DDynStatTile: View {
    let label: String
    let value: String
    var unit: String?

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            Text(verbatim: value)
                .font(Font.TS.title)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            if let unit {
                Text(verbatim: unit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

/// A tinted capsule badge for a raw (non-localized) value such as a gear letter
/// (web `Badge` with verbatim content). Mirrors `TSBadge` but renders verbatim so
/// the wire token is shown as-is.
struct DDynValueBadge: View {
    let text: String
    var tone: TSTone = .neutral

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
    }
}

/// One labeled metric row inside an insights panel (web `flex justify-between`).
struct DrivingMetricRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(verbatim: label)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: value)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
        }
        .accessibilityElement(children: .combine)
    }
}
