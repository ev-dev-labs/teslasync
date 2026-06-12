//
//  ThemePicker.swift
//  TeslaSync — P4 shared surface · 0228 · ThemePicker (Apple)
//
//  The public API of the theme + mode + custom-colour picker — the SwiftUI parity of
//  `components/ui/ThemePicker.tsx`. Like the web component it is the single source of truth for the
//  theme / mode / custom-colour UI and renders without page chrome (no panel / title); callers wrap it
//  in whatever container they need (the full Appearance page, the top-bar quick-switcher popover with
//  `compact` + `showCustom: false`, or the first-run banner). It binds through ``ThemePickerModel`` for
//  the selection state, the once-only `view.opened` telemetry (P1/S11), the store + toast seams (P1/S8),
//  and the i18n facade (P1/S10); composes the token-driven chrome (P1/S9); and honours Reduce Motion at
//  the selection boundary. No networking, no Tailwind ports.
//

import SwiftUI

/// The theme + mode + custom-colour picker — the SwiftUI parity of `components/ui/ThemePicker.tsx`.
/// Renders an optional Display-Mode grid (`showMode`), the always-present Accent-Colour grid, an
/// optional Custom swatch (`showCustom`), and the Custom RGB builder when the Custom theme is active.
/// Mount it inside a settings panel, a popover, or a banner.
public struct ThemePicker: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ThemePickerSurface.slug

    @State private var model: ThemePickerModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Convenience initializer wiring the dependency seams directly — the parity of mounting
    /// `<ThemePicker showMode showCustom compact onChange onModeChange />`. Supply the theme `store`
    /// (the native `useTheme`), an optional `toast` presenter (the native `useToast`), and the
    /// selection callbacks.
    public init(
        store: any ThemePickerThemeStore,
        input: ThemePickerInput = ThemePickerInput(),
        toast: (any ThemePickerToastPresenter)? = nil,
        onChange: (@MainActor (String) -> Void)? = nil,
        onModeChange: (@MainActor (String) -> Void)? = nil,
        telemetry: any ThemePickerTelemetry = OSLogThemePickerTelemetry()
    ) {
        _model = State(initialValue: ThemePickerModel(
            store: store,
            input: input,
            toast: toast,
            onChange: onChange,
            onModeChange: onModeChange,
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a seeded selection, a recording toast,
    /// a spy telemetry).
    public init(model: ThemePickerModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        let projection = model.projection
        let layout = ThemePickerProjector.layout(compact: model.input.compact)
        VStack(alignment: .leading, spacing: layout.sectionSpacing) {
            if projection.isEmpty {
                ThemePickerEmptyState()
            } else {
                if let title = projection.modeSectionTitle {
                    ThemePickerModeSection(
                        title: title,
                        options: projection.modeOptions,
                        layout: layout,
                        onSelect: { model.selectMode($0) }
                    )
                }
                ThemePickerAccentSection(model: model, projection: projection, layout: layout)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(TSAnimation.standard(reduceMotion: reduceMotion), value: model.selectedModeID)
        .animation(TSAnimation.standard(reduceMotion: reduceMotion), value: model.selectedThemeID)
        .onAppear { model.markAppeared() }
    }
}
