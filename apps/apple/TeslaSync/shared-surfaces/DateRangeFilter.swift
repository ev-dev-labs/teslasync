//
//  DateRangeFilter.swift
//  TeslaSync — P4 shared surface · 0152 · DateRangeFilter (Apple)
//
//  The public API of the inline date-range filter — the SwiftUI parity of
//  `components/forms/DateRangeFilter.tsx`. Like the web component it is driven entirely by its props
//  (`startDate`, `endDate`, the change callbacks, `onApply`, `presets`, `presetIds`); there is no fetcher. The
//  view binds through ``DateRangeFilterModel`` for the once-only `view.opened` telemetry (P1/S11), the
//  active-preset resolution (web `matchPresetId`), and the change/apply routing; composes the token-driven
//  chrome (P1/S9) as a wrapping row of the date-range field, an optional Apply ``TSButton`` (the native peer
//  of the web `@/components/ui/Button`), and the composed ``DatePresetChips`` row (the native peer of the web
//  `<DatePresetChips>`); and pushes prop changes into the holder via `.onChange` so a reused filter re-renders
//  faithfully when the page rebinds a new range. No networking, no Tailwind ports.
//
//  States (every one the source has renders — no hidden surface): the always-present date-range field, the
//  optional Apply action (web `onApply &&`), and the optional preset row (web `presets &&`) — itself populated
//  or a friendly empty state, delegated to the composed ``DatePresetChips``. The web component has no loading /
//  error / stale / offline branch — it never fetches; its only hook is `useTranslation` — so reproducing those
//  here would fabricate states the source does not have (see DateRangeFilter.Adapter.swift's parity note).
//

import SwiftUI

// MARK: - DateRangeFilter (the shared surface)

/// The inline date-range filter — the SwiftUI parity of `components/forms/DateRangeFilter.tsx`. Renders a
/// date-range field (two `DatePicker`s with an arrow between them), an optional Apply action, and an optional
/// quick-select preset row; a field edit or a preset tap routes back out through the page's callbacks.
public struct DateRangeFilter: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = DateRangeFilterSurface.slug

    private let input: DateRangeFilterInput
    private let onStartDateChange: @MainActor (String) -> Void
    private let onEndDateChange: @MainActor (String) -> Void
    private let onRangeChange: (@MainActor (DateRangeFilterRange) -> Void)?
    private let onApply: (@MainActor () -> Void)?
    @State private var model: DateRangeFilterModel

    /// The prop-style initializer — the parity of `<DateRangeFilter startDate endDate onStartDateChange
    /// onEndDateChange onRangeChange onApply presets presetIds>`. `onRangeChange` is the optional atomic-update
    /// path (web JSDoc — used with a batched URL setter to avoid the same-tick race); `onApply` both renders
    /// the Apply button and fires after a preset tap. `clock` + `calendar` + `telemetry` are seams (production
    /// uses the wall clock / user's calendar / OSLog) so the active-preset math is deterministic under test.
    public init(
        startDate: String,
        endDate: String,
        onStartDateChange: @escaping @MainActor (String) -> Void,
        onEndDateChange: @escaping @MainActor (String) -> Void,
        onRangeChange: (@MainActor (DateRangeFilterRange) -> Void)? = nil,
        onApply: (@MainActor () -> Void)? = nil,
        presets: Bool = true,
        presetIDs: [String] = DatePresetChipsCatalog.defaultIDs,
        clock: any DateRangeFilterClock = SystemDateRangeFilterClock(),
        calendar: Calendar = DateRangeFilterDates.gregorian(),
        telemetry: any DateRangeFilterTelemetry = OSLogDateRangeFilterTelemetry()
    ) {
        let resolved = DateRangeFilterInput(
            startDate: startDate,
            endDate: endDate,
            showPresets: presets,
            presetIDs: presetIDs,
            showApply: onApply != nil
        )
        input = resolved
        self.onStartDateChange = onStartDateChange
        self.onEndDateChange = onEndDateChange
        self.onRangeChange = onRangeChange
        self.onApply = onApply
        _model = State(initialValue: DateRangeFilterModel(
            input: resolved,
            onStartDateChange: onStartDateChange,
            onEndDateChange: onEndDateChange,
            onRangeChange: onRangeChange,
            onApply: onApply,
            clock: clock,
            calendar: calendar,
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a fixed clock).
    public init(model: DateRangeFilterModel) {
        input = model.input
        onStartDateChange = { _ in }
        onEndDateChange = { _ in }
        onRangeChange = nil
        onApply = nil
        _model = State(initialValue: model)
    }

    public var body: some View {
        let projection = model.projection
        DateRangeFilterFlowLayout {
            DateRangeFilterField(
                start: Binding(get: { model.startDate }, set: { model.setStart(date: $0) }),
                end: Binding(get: { model.endDate }, set: { model.setEnd(date: $0) }),
                startLabel: DateRangeFilterStrings.startLabel,
                endLabel: DateRangeFilterStrings.endLabel
            )
            if projection.showApply {
                DateRangeFilterApplyButton(title: DateRangeFilterStrings.applyLabel) { model.apply() }
            }
            if projection.showPresets {
                DatePresetChips(
                    presetIDs: projection.presetIDs,
                    activeID: projection.activePresetID,
                    size: .small
                ) { selection in
                    model.handlePreset(DateRangeFilterRange(start: selection.start, end: selection.end))
                }
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: input) { _, newInput in
            model.update(
                newInput,
                onStartDateChange: onStartDateChange,
                onEndDateChange: onEndDateChange,
                onRangeChange: onRangeChange,
                onApply: onApply
            )
        }
        .accessibilityElement(children: .contain)
    }
}
