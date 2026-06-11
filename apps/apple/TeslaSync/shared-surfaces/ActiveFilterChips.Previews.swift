//
//  ActiveFilterChips.Previews.swift
//  TeslaSync — P4 shared surface · 0147 · ActiveFilterChips (Apple)
//
//  Xcode previews for every branch of the active-filter chip strip: a few inline chips, the "+N more"
//  overflow (collapsed) with "Clear all", the all-collapsed `maxVisible == 0` variant, the long-value
//  truncation, and the kept-empty group (`hideWhenEmpty == false`). DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }

    private func sampleChips(_ count: Int) -> [ActiveFilterChip] {
        let pool = [
            ActiveFilterChip(id: "vehicle_id", label: "Vehicle", value: "Model 3") {},
            ActiveFilterChip(id: "state", label: "State", value: "Charging") {},
            ActiveFilterChip(id: "range", label: "Date", value: "Last 7 days") {},
            ActiveFilterChip(id: "min_distance", label: "Min distance", value: "10 km") {},
            ActiveFilterChip(id: "tag", label: "Tag", value: "Road trip") {},
            ActiveFilterChip(id: "driver", label: "Driver", value: "Alex") {},
            ActiveFilterChip(id: "location", label: "Location", value: "Home") {},
            ActiveFilterChip(id: "battery", label: "Battery", value: "> 50%") {},
            ActiveFilterChip(id: "temp", label: "Temperature", value: "Cold") {}
        ]
        return Array(pool.prefix(count))
    }

    #Preview("Inline chips") {
        staged("3 chips · no overflow") {
            ActiveFilterChips(filters: sampleChips(3))
        }
    }

    #Preview("Overflow + Clear all") {
        staged("9 chips · maxVisible 5 · +N more · Clear all") {
            ActiveFilterChips(filters: sampleChips(9), onClearAll: {}, maxVisible: 5)
        }
    }

    #Preview("All collapsed (maxVisible 0)") {
        staged("everything behind +N more") {
            ActiveFilterChips(filters: sampleChips(4), onClearAll: {}, maxVisible: 0)
        }
    }

    #Preview("Long value truncation") {
        staged("single chip · long value") {
            ActiveFilterChips(filters: [
                ActiveFilterChip(
                    id: "route",
                    label: "Route",
                    value: "San Francisco → Los Angeles via Highway 1 coastal scenic detour"
                ) {}
            ], onClearAll: {})
        }
    }

    #Preview("Empty group (hideWhenEmpty = false)") {
        staged("no chips · placeholder shown") {
            ActiveFilterChips(filters: [], onClearAll: {}, hideWhenEmpty: false)
        }
    }
#endif
