//
//  LiveTelemetryPanels.PanelViews.swift
//  TeslaSync — P4 feature view · 0281 · LiveTelemetryPanels (Apple)
//
//  Three of the seven SwiftUI panels the grid composes — Powertrain (`PowertrainPanel`),
//  Climate (`ClimatePanel`), and Security (`SecurityPanel`). Each renders its Foundation
//  projection through the shared primitives in LiveTelemetryPanels.Primitives.swift; the
//  remaining four panels live in LiveTelemetryPanels.MorePanelViews.swift.
//

import SwiftUI

// MARK: - Powertrain

struct LTPPowertrainPanelView: View {
    let projection: LTPPowertrainProjection

    var body: some View {
        LTPPanelShell(icon: "gearshape.fill", tint: Color.TS.accent, title: projection.title) {
            if projection.hasData {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    HStack {
                        Text(verbatim: projection.shiftLabel).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                        Spacer(minLength: TSSpacing.sm)
                        LTPChipView(chip: projection.shiftChip)
                    }
                    powerSection
                    HStack(spacing: TSSpacing.md) {
                        LTPMetricTileView(tile: projection.rpmFront)
                        LTPMetricTileView(tile: projection.rpmRear)
                    }
                    HStack(spacing: TSSpacing.md) {
                        LTPMetricTileView(tile: projection.torqueFront)
                        LTPMetricTileView(tile: projection.torqueRear)
                    }
                    LTPRow(row: projection.motorTempRow)
                    LTPRow(row: projection.inverterTempRow)
                    LTPRow(row: projection.regenRow)
                }
            } else {
                LTPPanelEmpty(message: projection.emptyMessage)
            }
        }
    }

    private var powerSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                Text(verbatim: projection.powerLabel).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: projection.powerValue)
                    .font(Font.TS.bodySm)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
            LTPPowerBar(
                known: projection.powerKnown,
                positive: projection.powerPositive,
                fraction: projection.powerFillFraction
            )
            HStack {
                Text(verbatim: "-300").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                Spacer()
                Text(verbatim: "0").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                Spacer()
                Text(verbatim: "+300").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(projection.powerLabel) \(projection.powerValue)"))
    }
}

/// The bidirectional −300…+300 kW power bar (web center-anchored fill).
struct LTPPowerBar: View {
    let known: Bool
    let positive: Bool
    let fraction: Double

    var body: some View {
        GeometryReader { geo in
            let half = geo.size.width / 2
            let width = max(0, half * min(max(fraction, 0), 1))
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.surfaceGlass)
                Rectangle().fill(Color.TS.border).frame(width: 1).offset(x: half)
                if known {
                    Capsule()
                        .fill((positive ? Color.TS.statusSuccess : Color.TS.statusDanger).opacity(0.6))
                        .frame(width: width)
                        .offset(x: positive ? half : half - width)
                }
            }
        }
        .frame(height: 12)
        .clipShape(Capsule())
        .accessibilityHidden(true)
    }
}

// MARK: - Climate

struct LTPClimatePanelView: View {
    let projection: LTPClimateProjection

    var body: some View {
        LTPPanelShell(icon: "thermometer.medium", tint: Color.TS.accent, title: projection.title) {
            if projection.hasData {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    HStack(spacing: TSSpacing.md) {
                        LTPMetricTileView(tile: projection.cabinTile)
                        LTPMetricTileView(tile: projection.outsideTile)
                    }
                    HStack(spacing: TSSpacing.md) {
                        LTPRow(row: projection.driverRow)
                        LTPRow(row: projection.passengerRow)
                    }
                    LTPRow(row: projection.hvacRow)
                    fanRow
                    LTPChipWrap(chips: projection.chips)
                }
            } else {
                LTPPanelEmpty(message: projection.emptyMessage)
            }
        }
    }

    private var fanRow: some View {
        HStack {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "fanblades.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: projection.fanLabel).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            HStack(spacing: 3) {
                ForEach(1 ..< 7) { level in
                    Capsule()
                        .fill(level <= projection.fanLevel ? Color.TS.accent.opacity(0.7) : Color.TS.border)
                        .frame(width: CGFloat(4 + level), height: 12)
                }
                Text(verbatim: projection.fanValue)
                    .font(Font.TS.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .padding(.leading, TSSpacing.xs)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: projection.fanLabel))
        .accessibilityValue(Text(verbatim: projection.fanValue))
    }
}

// MARK: - Security

struct LTPSecurityPanelView: View {
    let projection: LTPSecurityProjection

    var body: some View {
        LTPPanelShell(icon: "shield.lefthalf.filled", tint: Color.TS.accent, title: projection.title) {
            if projection.hasData {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    if projection.hasSecurity {
                        lockBlock
                        HStack {
                            Text(verbatim: projection.sentryLabel).font(Font.TS.caption)
                                .foregroundStyle(Color.TS.textMuted)
                            Spacer(minLength: TSSpacing.sm)
                            LTPChipView(chip: projection.sentryChip)
                        }
                        LTPRow(row: projection.doorsRow)
                        LTPRow(row: projection.windowsRow)
                        LTPRow(row: projection.userPresentRow)
                        if let detail = projection.detail {
                            Text(verbatim: detail)
                                .font(Font.TS.caption)
                                .italic()
                                .foregroundStyle(Color.TS.textMuted)
                        }
                    }
                    LTPRow(row: projection.remoteStartRow)
                }
            } else {
                LTPPanelEmpty(message: projection.emptyMessage)
            }
        }
    }

    private var lockBlock: some View {
        HStack(spacing: TSSpacing.lg) {
            Image(systemName: projection.lockIcon)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(projection.lockTone.color)
                .frame(width: 48, height: 48)
                .background(
                    projection.lockTone.color.opacity(0.12),
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: projection.lockText)
                    .font(Font.TS.panel)
                    .fontWeight(.semibold)
                    .foregroundStyle(projection.lockTone.color)
                Text(verbatim: projection.lockSubLabel).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}
