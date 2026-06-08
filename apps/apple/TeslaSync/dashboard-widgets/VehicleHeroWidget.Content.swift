//
//  VehicleHeroWidget.Content.swift
//  TeslaSync — P4 dashboard widget · 0108 · VehicleHeroWidget (Apple)
//
//  The "state present" content composed by `VehicleHeroWidget`: the radial-gauge
//  flow, the charging-detail panel, the context stat grid, the quick-action bar,
//  and the asleep wake panel (web `VehicleHero`'s `state ? … : asleep` body). All
//  consume the pre-projected `VehicleHeroProjection` + shared P1/S9 tokens.
//

import SwiftUI

// MARK: - State content (web `state ? … : …` body)

/// The full "live state" body: gauges → charging panel (if charging) → stat grid →
/// quick actions (web `VehicleHero`'s `state` branch).
struct VehicleHeroStateContent: View {
    let projection: VehicleHeroProjection
    let onNavigate: ((VehicleHeroDestination) -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            VehicleHeroGaugeFlow(gauges: projection.gauges)
            if let charging = projection.charging {
                VehicleHeroChargingPanel(detail: charging)
            }
            VehicleHeroStatGrid(cards: projection.statCards)
            VehicleHeroActionBar(vehicleId: projection.vehicleId, onNavigate: onNavigate)
        }
    }
}

// MARK: - Gauge flow (web radial-gauge row, flex-wrap)

/// The wrapping row of radial gauges (web `flex flex-wrap justify-center`).
struct VehicleHeroGaugeFlow: View {
    let gauges: [VehicleHeroGauge]

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 82), spacing: TSSpacing.md)],
            spacing: TSSpacing.md
        ) {
            ForEach(gauges) { VehicleHeroGaugeView(gauge: $0) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(VehicleHeroStrings.text("hero.a11y.gauges", "Live gauges"))
    }
}

/// A single radial gauge — arc + centered value/unit + label (web `RadialGauge`,
/// `size=70`, `STROKE_WIDTH=8`).
struct VehicleHeroGaugeView: View {
    let gauge: VehicleHeroGauge
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let diameter: CGFloat = 70
    private let stroke: CGFloat = 8

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ZStack {
                Circle().stroke(Color.TS.border.opacity(0.5), lineWidth: stroke)
                Circle()
                    .trim(from: 0, to: gauge.fraction)
                    .stroke(gauge.color, style: StrokeStyle(lineWidth: stroke, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.4), value: gauge.fraction)
                centerValue
            }
            .frame(width: diameter, height: diameter)
            Text(verbatim: gauge.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
        }
        .frame(width: diameter + TSSpacing.sm)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: gauge.label))
        .accessibilityValue(Text(verbatim: gauge.accessibilityValue))
    }

    private var centerValue: some View {
        HStack(alignment: .firstTextBaseline, spacing: 1) {
            Text(verbatim: gauge.valueText)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Color.TS.textPrimary)
            if !gauge.unit.isEmpty {
                Text(verbatim: gauge.unit)
                    .font(.system(size: 9))
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
}

// MARK: - Charging panel (web `is_charging` block)

/// The charging-detail panel — power / rate / time-to-full (+ the "Done ~hh:mm"
/// wall-clock estimate), shown only while charging (web `state.is_charging`).
struct VehicleHeroChargingPanel: View {
    let detail: VehicleHeroChargingDetail

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "battery.100.bolt")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                VehicleHeroStrings.text("hero.charging", "Charging")
                    .font(Font.TS.bodySm)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.statusSuccess)
            }
            HStack(alignment: .top, spacing: TSSpacing.md) {
                cell("hero.chargePower", "Power", detail.powerText)
                cell("hero.chargeRate", "Rate", detail.rateText)
                timeToFullCell
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.statusSuccess.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .strokeBorder(Color.TS.statusSuccess.opacity(0.18), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }

    private func cell(_ key: String, _ fallback: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            VehicleHeroStrings.text(key, fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
    }

    private var timeToFullCell: some View {
        VStack(spacing: 2) {
            VehicleHeroStrings.text("hero.timeToFull", "Time to Full")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: detail.timeToFullText)
                .font(Font.TS.bodySm)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            if let hours = detail.doneInHours {
                let done = Date().addingTimeInterval(hours * 3600)
                Text(verbatim: "\(VehicleHeroStrings.string("hero.doneAt", "Done")) ~"
                    + done.formatted(date: .omitted, time: .shortened))
                    .font(.system(size: 9))
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Stat grid (web context stat cards)

/// The 2–4 column stat grid (web `grid-cols-2 sm:grid-cols-4`).
struct VehicleHeroStatGrid: View {
    let cards: [VehicleHeroStatCard]

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 132), spacing: TSSpacing.sm)],
            spacing: TSSpacing.sm
        ) {
            ForEach(cards) { VehicleHeroStatCardView(card: $0) }
        }
    }
}

/// One stat cell — tinted SF Symbol + uppercase label + value (web stat card).
struct VehicleHeroStatCardView: View {
    let card: VehicleHeroStatCard

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: card.systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(card.color)
                .frame(width: 18)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: card.label)
                    .font(.system(size: 9, weight: .medium))
                    .textCase(.uppercase)
                    .tracking(0.4)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Text(verbatim: card.value)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(card.label): \(card.value)"))
    }
}

// MARK: - Action bar (web quick-action `<Link>` buttons)

/// The quick-action buttons — Details / Commands / Live Map / Digital Twin (web
/// `<Link>` buttons). Routing is delegated to the injected `onNavigate`.
struct VehicleHeroActionBar: View {
    let vehicleId: Int64
    let onNavigate: ((VehicleHeroDestination) -> Void)?

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 124), spacing: TSSpacing.sm)],
            spacing: TSSpacing.sm
        ) {
            button("hero.details", "Details", "eye.fill") { onNavigate?(.details(vehicleId: vehicleId)) }
            button("hero.commands", "Commands", "bolt.fill") { onNavigate?(.commands) }
            button("hero.liveMap", "Live Map", "mappin.and.ellipse") { onNavigate?(.liveMap) }
            button("hero.digitalTwin", "Digital Twin", "display") { onNavigate?(.digitalTwin) }
        }
    }

    private func button(_ key: String, _ fallback: String, _ image: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: image).font(.system(size: 12, weight: .semibold))
                VehicleHeroStrings.text(key, fallback).font(Font.TS.caption).fontWeight(.medium)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .frame(maxWidth: .infinity)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1))
            .foregroundStyle(Color.TS.textSecondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(VehicleHeroStrings.text(key, fallback))
    }
}

// MARK: - Asleep panel (web `state == null` branch)

/// The asleep state shown when no live state is available (web `state ? … :
/// GlassPanel` with "Vehicle asleep — wake to see live data" + Wake Up).
struct VehicleHeroAsleepPanel: View {
    let onWake: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "moon.zzz.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            VehicleHeroStrings.text("hero.asleep", "Vehicle asleep — wake to see live data")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            Button(action: onWake) {
                VehicleHeroStrings.text("hero.wakeUp", "Wake Up")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent, in: Capsule())
                    .foregroundStyle(Color.TS.surface)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(VehicleHeroStrings.text("hero.wakeUp", "Wake Up"))
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}
