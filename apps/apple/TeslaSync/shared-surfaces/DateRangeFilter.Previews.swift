//
//  DateRangeFilter.Previews.swift
//  TeslaSync — P4 shared surface · 0152 · DateRangeFilter (Apple)
//
//  Xcode previews for every branch of the inline date-range filter: the default (field + preset row), the
//  filter with an Apply action, the field-only variant (presets off), a custom preset subset, and an
//  active-preset highlight (a bound range that equals a preset resolves its chip to primary). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A small stateful harness so the previews' `DatePicker`s and preset taps mutate a visible range, the way
    /// a host page owns `startDate` / `endDate`.
    @MainActor
    private struct DateRangeFilterPreviewHost: View {
        let label: String
        var presets = true
        var presetIDs = DatePresetChipsCatalog.defaultIDs
        var withApply = false
        @State private var start: String
        @State private var end: String

        init(
            label: String,
            presets: Bool = true,
            presetIDs: [String] = DatePresetChipsCatalog.defaultIDs,
            withApply: Bool = false,
            start: String = "",
            end: String = ""
        ) {
            self.label = label
            self.presets = presets
            self.presetIDs = presetIDs
            self.withApply = withApply
            _start = State(initialValue: start)
            _end = State(initialValue: end)
        }

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Text(verbatim: label)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                DateRangeFilter(
                    startDate: start,
                    endDate: end,
                    onStartDateChange: { start = $0 },
                    onEndDateChange: { end = $0 },
                    onRangeChange: rangeChange,
                    onApply: applyAction,
                    presets: presets,
                    presetIDs: presetIDs
                )
                Text(verbatim: "start=\(start.isEmpty ? "—" : start)  end=\(end.isEmpty ? "—" : end)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: 380, alignment: .leading)
            .background(Color.TS.bg)
        }

        /// The atomic-update closure, present only in the Apply variant (web `onRangeChange`). Declared with
        /// the surface's exact closure type so the literal is `@MainActor`-isolated without a Sendable cast.
        private var rangeChange: (@MainActor (DateRangeFilterRange) -> Void)? {
            guard withApply else { return nil }
            return { start = $0.start; end = $0.end }
        }

        /// The Apply closure, present only in the Apply variant (web `onApply`).
        private var applyAction: (@MainActor () -> Void)? {
            guard withApply else { return nil }
            return {}
        }
    }

    /// "Today" resolved to the local day, so the default preview opens with an active highlight.
    @MainActor
    private func todayISO() -> String {
        DateRangeFilterDates.iso(from: Date(), calendar: DateRangeFilterDates.gregorian())
    }

    #Preview("Default · field + presets") {
        DateRangeFilterPreviewHost(label: "presets on · today highlighted", start: todayISO(), end: todayISO())
    }

    #Preview("With Apply action") {
        DateRangeFilterPreviewHost(label: "onApply set · primary Apply button", withApply: true)
    }

    #Preview("Field only · presets off") {
        DateRangeFilterPreviewHost(label: "presets = false · field only", presets: false)
    }

    #Preview("Custom preset subset") {
        DateRangeFilterPreviewHost(
            label: "presetIDs = [7d, 30d, 90d, 1y]",
            presetIDs: ["7d", "30d", "90d", "1y"]
        )
    }

    #Preview("Empty selection · no active chip") {
        DateRangeFilterPreviewHost(label: "no bound range · no chip highlighted")
    }
#endif
