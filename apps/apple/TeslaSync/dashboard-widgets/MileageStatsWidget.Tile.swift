//
//  MileageStatsWidget.Tile.swift
//  TeslaSync — P4 dashboard widget · 0064 · MileageStatsWidget (Apple)
//
//  The leaf views the MileageStatsWidget surface composes: the per-stat cell
//  (web `StatCard`) and the compact hero number (web `AnimatedNumber`). Kept in
//  their own file so the surface file stays within the house file-length limit.
//

import SwiftUI

// MARK: - Stat tile (web `StatCard`)

/// One stat cell's data, mirroring the web `StatCard` props (label, value, unit,
/// icon, optional "up" trend chip).
struct MileageStatTileData: Identifiable {
    let id: String
    let label: String
    let value: String
    let unit: String
    let systemImage: String
    var trend: String?
}

/// One stat cell mirroring the web `StatCard`: a muted label + icon, a large
/// value with a trailing unit, and an optional "up" trend chip.
struct MileageStatTile: View {
    let data: MileageStatTileData

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: data.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: data.systemImage)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(verbatim: data.value)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(verbatim: data.unit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            if let trend = data.trend {
                HStack(spacing: 2) {
                    Image(systemName: "arrow.up").font(.system(size: 9, weight: .bold))
                    Text(verbatim: trend).font(Font.TS.caption).fontWeight(.medium)
                }
                .foregroundStyle(Color.TS.statusSuccess)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(data.label) \(data.value) \(data.unit)"))
    }
}

// MARK: - Big number (web compact `AnimatedNumber`)

/// The compact layout's hero number, animating value changes and honoring
/// Reduce Motion (web `AnimatedNumber`).
struct MileageBigNumber: View {
    let formatted: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Text(verbatim: formatted)
            .font(Font.TS.display)
            .fontWeight(.bold)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textPrimary)
            .contentTransition(.numericText())
            .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.normalDuration), value: formatted)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
    }
}
