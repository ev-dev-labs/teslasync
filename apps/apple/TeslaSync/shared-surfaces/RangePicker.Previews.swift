//
//  RangePicker.Previews.swift
//  TeslaSync — P4 shared surface · 0157 · RangePicker (Apple)
//
//  Xcode previews for every branch of the date-range filter: the trigger in its content / loading / error
//  phases, the stale + offline freshness chips, and the popover body (preset listbox + 2-month calendar +
//  footer) in its default, compare-enabled, presets-only, and empty variants. A fixed UTC clock keeps the
//  resolved presets + calendar deterministic. DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    private let rpDemoCalendar = RangePickerDates.gregorian(timeZone: TimeZone(identifier: "UTC") ?? .current)

    private func rpDemoNow() -> Date {
        rpDemoCalendar.date(from: DateComponents(year: 2026, month: 3, day: 15, hour: 12)) ?? Date()
    }

    private var rpSevenDay: RangePickerValue {
        RangePickerPresets.resolve("7d", now: rpDemoNow(), calendar: rpDemoCalendar)
            ?? RangePickerValue(start: "2026-03-09", end: "2026-03-15")
    }

    @MainActor
    private func rpModel(
        value: RangePickerValue = RangePickerValue(start: "2026-02-01", end: "2026-03-15"),
        presetIDs: [String] = RangePickerPresets.defaultIDs,
        presetsOnly: Bool = false,
        enableCompare: Bool = false,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: RangePickerConnection = .live,
        open: Bool = false
    ) -> RangePickerModel {
        let input = RangePickerInput(
            value: value,
            presetIDs: presetIDs,
            maxDate: "2026-03-15",
            enableCompare: enableCompare,
            presetsOnly: presetsOnly
        )
        let snapshot = RangePickerSnapshot(
            input: input, isLoading: isLoading, errorMessage: errorMessage, connection: connection
        )
        let model = RangePickerModel(
            source: InMemoryRangePickerSource(snapshot: snapshot),
            now: rpDemoNow,
            calendar: rpDemoCalendar,
            locale: Locale(identifier: "en_US")
        )
        model.start()
        if open { model.setOpen(true) }
        return model
    }

    @MainActor
    private func rpStaged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 560, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Trigger · content") {
        rpStaged("active preset · Last 7 days") {
            RangePicker(model: rpModel(value: rpSevenDay))
        }
    }

    #Preview("Trigger · loading / error") {
        rpStaged("loading skeleton + error tile") {
            RangePicker(model: rpModel(isLoading: true))
            RangePicker(model: rpModel(errorMessage: "Network unavailable"))
        }
    }

    #Preview("Trigger · stale / offline") {
        rpStaged("freshness chips") {
            RangePicker(model: rpModel(connection: .stale))
            RangePicker(model: rpModel(connection: .offline))
        }
    }

    #Preview("Popover body") {
        rpStaged("preset listbox + 2-month calendar + footer") {
            RangePickerPopoverContent(model: rpModel(value: rpSevenDay, open: true))
        }
    }

    #Preview("Popover · compare") {
        rpStaged("compare toggle in footer") {
            RangePickerPopoverContent(model: rpModel(enableCompare: true, open: true))
        }
    }

    #Preview("Popover · presets only") {
        rpStaged("calendar + footer hidden") {
            RangePickerPopoverContent(model: rpModel(presetsOnly: true, open: true))
        }
    }

    #Preview("Popover · empty") {
        rpStaged("presetsOnly with no presets") {
            RangePickerPopoverContent(model: rpModel(presetIDs: [], presetsOnly: true, open: true))
        }
    }
#endif
