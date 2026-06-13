//
//  DatePresetChips.swift
//  TeslaSync — P4 shared surface · 0151 · DatePresetChips (Apple)
//
//  The public API of the quick-select date-range chip row — the SwiftUI parity of
//  `components/forms/DatePresetChips.tsx`. Like the web component it is driven entirely by its props
//  (`presetIds`, `activeId`, `onSelect`, `size`, `ariaLabel`); there is no fetcher. The view binds through
//  ``DatePresetChipsModel`` for the once-only `view.opened` telemetry (P1/S11) and the tap-time range
//  resolution; composes the token-driven chrome (P1/S9) as a wrapping row of shared `TSButton` chips (the
//  native peer of the web `@/components/ui/Button`); and pushes prop changes into the holder via `.onChange`
//  so a reused row re-renders faithfully when the page rebinds a new `activeId`. No networking, no Tailwind
//  ports.
//
//  States (every one the source has renders — no hidden surface): the populated chip row (with an optional
//  active primary highlight per `activeId`) and the friendly empty-state view (when `presetIds` resolves to
//  zero known presets). The web component has no loading / error / stale / offline branch — it never
//  fetches; its only hook is `useTranslation` — so reproducing those here would fabricate states the source
//  does not have (see DatePresetChips.Adapter.swift's faithful-parity note).
//

import SwiftUI

// MARK: - DatePresetChips (the shared surface)

/// The quick-select date-range chip row — the SwiftUI parity of `components/forms/DatePresetChips.tsx`.
/// Renders one chip per preset id; tapping a chip resolves its inclusive `{start, end}` range against "now"
/// and hands the page a ``DatePresetChipsSelection``. Mounted inside a date filter (the range picker, a
/// signal-log time window, alert history) to give one-tap range selection.
public struct DatePresetChips: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = DatePresetChipsSurface.slug

    private let input: DatePresetChipsInput
    private let onSelect: @MainActor (DatePresetChipsSelection) -> Void
    @State private var model: DatePresetChipsModel

    /// The prop-style initializer — the parity of `<DatePresetChips presetIds activeId onSelect size
    /// ariaLabel>`. `presetIDs` is the subset of presets to render (default
    /// ``DatePresetChipsCatalog/defaultIDs``); `activeID` highlights the active chip; `onSelect` receives the
    /// tapped preset's id + resolved range; `size` matches the shared button scale; `ariaLabel` overrides the
    /// group's accessible name. `clock` + `calendar` are seams (production uses the wall clock / user's
    /// calendar) so the tap-time resolution is deterministic under test.
    public init(
        presetIDs: [String] = DatePresetChipsCatalog.defaultIDs,
        activeID: String? = nil,
        size: DatePresetChipsSize = .small,
        ariaLabel: String? = nil,
        onSelect: @escaping @MainActor (DatePresetChipsSelection) -> Void,
        clock: any DatePresetChipsClock = SystemDatePresetChipsClock(),
        calendar: Calendar = DatePresetChipsCatalog.gregorian(),
        telemetry: any DatePresetChipsTelemetry = OSLogDatePresetChipsTelemetry()
    ) {
        let resolved = DatePresetChipsInput(
            presetIDs: presetIDs,
            activeID: activeID,
            size: size,
            ariaLabelOverride: ariaLabel
        )
        input = resolved
        self.onSelect = onSelect
        _model = State(initialValue: DatePresetChipsModel(
            input: resolved,
            onSelect: onSelect,
            clock: clock,
            calendar: calendar,
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a fixed clock).
    public init(model: DatePresetChipsModel) {
        input = model.input
        onSelect = { _ in }
        _model = State(initialValue: model)
    }

    public var body: some View {
        let projection = model.projection
        Group {
            if projection.isEmpty {
                DatePresetChipsEmptyView()
            } else {
                DatePresetChipsRow(
                    chips: projection.chips,
                    size: model.input.size
                ) { model.select($0) }
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: input) { _, newInput in
            model.update(newInput, onSelect: onSelect)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: groupLabel))
    }

    /// The group's accessible name — the prop override or the i18n'd default (web `ariaLabel ??
    /// t('date.preset.label', 'Quick date range')`).
    private var groupLabel: String {
        model.input.ariaLabelOverride ?? DatePresetChipsStrings.groupLabel
    }
}
