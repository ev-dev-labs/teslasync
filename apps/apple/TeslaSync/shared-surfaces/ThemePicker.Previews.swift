//
//  ThemePicker.Previews.swift
//  TeslaSync — P4 shared surface · 0228 · ThemePicker (Apple)
//
//  Xcode previews for every real branch of the picker: the full picker (mode + accent + Custom), the
//  compact popover layout, the mode-only / accent-only configurations (`showMode` / `showCustom`
//  toggled), the Custom theme active (the RGB builder revealed), and the empty leaf (a degenerate store
//  with no themes). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
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
        .padding(TSSpacing.lg)
        .frame(maxWidth: 520, alignment: .leading)
        .background(Color.TS.bg)
    }

    @MainActor
    private func customStore() -> InMemoryThemePickerStore {
        InMemoryThemePickerStore(
            state: ThemePickerState(
                selectedThemeID: "custom",
                selectedModeID: "midnight",
                customPrimaryHex: ThemePickerCatalog.defaultCustomPrimaryHex,
                customAccentHex: ThemePickerCatalog.defaultCustomAccentHex
            )
        )
    }

    #Preview("Full — mode + accent + custom") {
        staged("default · showMode + showCustom") {
            ThemePicker(model: ThemePickerModel(store: InMemoryThemePickerStore()))
        }
    }

    #Preview("Compact — popover") {
        staged("compact · denser grids") {
            ThemePicker(model: ThemePickerModel(
                store: InMemoryThemePickerStore(),
                input: ThemePickerInput(showMode: true, showCustom: false, compact: true)
            ))
        }
    }

    #Preview("Accent only — showMode false") {
        staged("showMode false · accent grid only") {
            ThemePicker(model: ThemePickerModel(
                store: InMemoryThemePickerStore(),
                input: ThemePickerInput(showMode: false, showCustom: true)
            ))
        }
    }

    #Preview("Custom active — RGB builder") {
        staged("Custom theme selected · builder revealed") {
            ThemePicker(model: ThemePickerModel(store: customStore()))
        }
    }

    #Preview("Empty — no themes configured") {
        staged("degenerate store · never a blank box") {
            ThemePicker(model: ThemePickerModel(
                store: InMemoryThemePickerStore(themes: [], modes: []),
                input: ThemePickerInput(showMode: false, showCustom: false)
            ))
        }
    }
#endif
