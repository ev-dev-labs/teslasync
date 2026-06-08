//
//  BatteryPill.Previews.swift
//  TeslaSync — P4 feature view · 0073 · BatteryPill (Apple)
//
//  Xcode previews covering every branch the web source carries: the three
//  `STATUS_COLORS` tiers, the threshold boundaries (exactly 60 ⇒ good, exactly
//  30 ⇒ warning), the meter clamp (0 / over-100), and the `safeNumber` guard
//  (a non-finite level renders `0%`, never "NaN"). DEBUG-only.
//

import SwiftUI

#if DEBUG
    private struct BatteryPillPreviewGallery: View {
        private struct Row: Identifiable {
            let id = UUID()
            let label: LocalizedStringKey
            let level: Double
        }

        /// Held on the (main-actor-isolated) view rather than as a top-level
        /// global so it stays concurrency-safe under Swift 6 strict concurrency.
        private let rows: [Row] = [
            Row(label: "battery.pill.preview.label", level: 82),
            Row(label: "battery.pill.preview.label", level: 60),
            Row(label: "battery.pill.preview.label", level: 45),
            Row(label: "battery.pill.preview.label", level: 30),
            Row(label: "battery.pill.preview.label", level: 12),
            Row(label: "battery.pill.preview.label", level: 0),
            Row(label: "battery.pill.preview.label", level: 120),
            Row(label: "battery.pill.preview.label", level: .nan)
        ]

        var body: some View {
            ScrollView {
                VStack(spacing: TSSpacing.md) {
                    ForEach(rows) { row in
                        BatteryPill(level: row.level, label: row.label)
                    }
                }
                .padding(TSSpacing.lg)
                .frame(maxWidth: 360)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Tiers · Dark") {
        BatteryPillPreviewGallery()
            .preferredColorScheme(.dark)
    }

    #Preview("Tiers · Light") {
        BatteryPillPreviewGallery()
            .preferredColorScheme(.light)
    }

    #Preview("Dynamic Type · XXL") {
        BatteryPillPreviewGallery()
            .preferredColorScheme(.dark)
            .environment(\.dynamicTypeSize, .accessibility2)
    }
#endif
