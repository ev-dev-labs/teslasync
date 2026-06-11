//
//  EnergyFlowAnimatedWidget.Compact.swift
//  TeslaSync — P4 dashboard widget · 0045 · EnergyFlowAnimatedWidget (Apple)
//
//  EnergyFlowAnimatedCompactView — the SwiftUI reproduction of the web
//  `CompactView` shown when the widget is a single column wide (web
//  `size.cols < 2`): a hero battery percentage stacked with the active power
//  chips (charging / consuming / regen), or the standby "Idle" copy when nothing
//  is moving. Tints mirror the web (amber / cyan / emerald); glyphs mirror the
//  web lucide icons.
//

import SwiftUI

// MARK: - EnergyFlowAnimatedCompactView (web `CompactView`)

/// The 1-column fallback: a centered battery percentage above the active flow
/// chips. Exposed to VoiceOver as a single element summarizing the live state.
struct EnergyFlowAnimatedCompactView: View {
    let summary: EnergyFlowAnimatedCompactSummary

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Text(verbatim: EnergyFlowAnimatedFormat.percent(summary.batteryLevel))
                .font(Font.TS.title)
                .foregroundStyle(Color.TS.textPrimary)
            if summary.isIdle {
                EnergyFlowAnimatedStrings.text("widget.energyFlowAnimated.idle", "Idle")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            } else {
                ForEach(summary.chips) { chip in
                    chipRow(chip)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: EnergyFlowAnimatedAccessibility.compactSummary(for: summary))
        )
    }

    private func chipRow(_ chip: EnergyFlowAnimatedCompactChip) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: Self.symbol(for: chip.kind))
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: EnergyFlowAnimatedFormat.kilowatts(chip.valueKw, decimals: 1))
                .font(Font.TS.caption)
        }
        .foregroundStyle(Self.color(for: chip.kind))
    }

    /// The SF Symbol mirroring the web lucide icon for a compact chip.
    static func symbol(for kind: EnergyFlowAnimatedCompactChip.Kind) -> String {
        switch kind {
        case .charging: "powerplug.fill" // lucide Plug
        case .consuming: "bolt.fill" // lucide Zap
        case .regen: "battery.100percent" // lucide Battery
        }
    }

    /// The chip tint mirroring the web Tailwind color.
    static func color(for kind: EnergyFlowAnimatedCompactChip.Kind) -> Color {
        switch kind {
        case .charging: EnergyFlowAnimatedPalette.amber
        case .consuming: EnergyFlowAnimatedPalette.cyan
        case .regen: EnergyFlowAnimatedPalette.emerald
        }
    }
}
