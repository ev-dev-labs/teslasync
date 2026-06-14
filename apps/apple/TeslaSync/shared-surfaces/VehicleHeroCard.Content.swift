//
//  VehicleHeroCard.Content.swift
//  TeslaSync — P4 shared surface · 0233 · VehicleHeroCard (Apple)
//
//  The live-content composition of the vehicle hero card — the native peers of the web body: the four-gauge
//  flow (web flex-wrap of `RadialGauge`s), the radial gauge itself (web `RadialGauge` SVG → a trimmed
//  `Circle`), the stat grid (web `Grid cols={{default:2, md:4}}` of `StatCard`s), the stat cell, the action
//  bar (web three `<Link>`s), and the friendly no-live-data fallback the native surface shows where the web
//  simply hides the gauges + stats (`vs && …`). Token-driven (P1/S9); strings resolve through the P1/S10
//  facade; every gauge / stat / action exposes a VoiceOver label. Reduce Motion is honored on the gauge arc.
//

import SwiftUI

// MARK: - Gauge flow (web flex-wrap of RadialGauge)

/// The four gauges laid out in a wrapping, centered flow (web `flex flex-wrap items-center justify-center
/// gap-6`) — an adaptive grid so they sit in one row on a wide idiom and wrap on a phone.
struct VehicleHeroCardGaugeFlow: View {
    let gauges: [VehicleHeroCardGauge]

    private let columns = [GridItem(.adaptive(minimum: 96, maximum: 140), spacing: TSSpacing.x2xl)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
            ForEach(gauges) { gauge in
                VehicleHeroCardGaugeView(gauge: gauge)
            }
        }
    }
}

// MARK: - Radial gauge (web RadialGauge)

/// A single radial gauge — the native peer of the web `<RadialGauge>`: a track ring, a value arc filling the
/// clamped fraction with a rounded cap, the value + unit centered, and the label below. VoiceOver announces
/// "{label}: {value}{unit}".
struct VehicleHeroCardGaugeView: View {
    let gauge: VehicleHeroCardGauge
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let size: CGFloat = 104
    private let stroke: CGFloat = 8

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ZStack {
                Circle().stroke(Color.TS.border.opacity(0.4), lineWidth: stroke)
                Circle()
                    .trim(from: 0, to: gauge.fraction)
                    .stroke(
                        VehicleHeroCardPalette.gaugeColor(gauge),
                        style: StrokeStyle(lineWidth: stroke, lineCap: .round)
                    )
                    .rotationEffect(.degrees(-90))
                    .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration), value: gauge.fraction)
                centerLabel
            }
            .frame(width: size, height: size)
            Text(verbatim: gauge.label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: gauge.label))
        .accessibilityValue(Text(verbatim: "\(gauge.valueText)\(gauge.unit)"))
    }

    private var centerLabel: some View {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text(verbatim: gauge.valueText)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: gauge.unit)
                .font(.system(size: 11))
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Stat grid (web Grid of StatCard)

/// The detail cards (web `Grid cols={{default: 2, md: 4}}` of `StatCard`) — an adaptive grid that lands 2-up
/// on a phone and 4-up on a wide idiom.
struct VehicleHeroCardStatGrid: View {
    let stats: [VehicleHeroCardStat]

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(stats) { stat in
                VehicleHeroCardStatCell(stat: stat)
            }
        }
    }
}

/// One detail card — a muted label over a bold value with an optional unit suffix (web `StatCard`).
struct VehicleHeroCardStatCell: View {
    let stat: VehicleHeroCardStat

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: stat.label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textMuted)
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                Text(verbatim: stat.value)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                if let unit = stat.unit {
                    Text(verbatim: unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }

    private var accessibilityText: String {
        guard let unit = stat.unit else { return "\(stat.label): \(stat.value)" }
        return "\(stat.label): \(stat.value) \(unit)"
    }
}

// MARK: - Action bar (web three `<Link>`s)

/// The navigation actions (web Details / Commands / Live Map links). A divider then three buttons; the
/// prominent Details button is accent-tinted (web `bg-cyan-500/10 text-cyan-400`). Each routes through the
/// host's `onNavigate`.
struct VehicleHeroCardActionBar: View {
    let vehicleID: Int
    let onNavigate: (VehicleHeroCardRoute) -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Divider().overlay(Color.TS.border)
            HStack(spacing: TSSpacing.sm) {
                action(VehicleHeroCardStrings.actionDetails, .details(vehicleID: vehicleID), prominent: true)
                action(VehicleHeroCardStrings.actionCommands, .commands(vehicleID: vehicleID), prominent: false)
                action(VehicleHeroCardStrings.actionLiveMap, .liveMap(vehicleID: vehicleID), prominent: false)
                Spacer(minLength: 0)
            }
        }
    }

    private func action(_ title: String, _ route: VehicleHeroCardRoute, prominent: Bool) -> some View {
        Button { onNavigate(route) } label: {
            Text(verbatim: title)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(prominent ? Color.TS.accent : Color.TS.textSecondary)
                .padding(.horizontal, TSSpacing.lg)
                .padding(.vertical, TSSpacing.sm)
                .background(
                    prominent ? Color.TS.accent.opacity(0.12) : Color.TS.surface,
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - No-live-data fallback (web hides; native shows)

/// The friendly fallback shown when a vehicle is present but has no live state (web renders nothing for the
/// `vs && …` gates; the native HIG calls for a labelled panel rather than a gap).
struct VehicleHeroCardNoLiveData: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "antenna.radiowaves.left.and.right.slash")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: VehicleHeroCardStrings.noLiveDataTitle)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: VehicleHeroCardStrings.noLiveDataMessage)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
