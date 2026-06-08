//
//  GeneralSettings.Fields.swift
//  TeslaSync — P4 feature view · 0207 · GeneralSettings (Apple)
//
//  The editable field grid the General Settings surface renders in the content
//  state — the native parity of the web `grid sm:grid-cols-2` of <Select> /
//  <Input> / <CurrencyInput> controls. Every field binds through
//  `GeneralSettingsModel.binding(_:)` so edits route through the model's draft +
//  navigation-guard side effects, and every label / option / helper resolves
//  through the P1/S10 facade. Rows are token-styled to mirror the shared UI
//  inputs without porting Tailwind.
//

import SwiftUI

// MARK: - Field grid

/// The responsive two-column field grid (web base / sm:grid-cols-2). Compact
/// width (iPhone portrait) collapses to one column. Split into a units group and
/// a locale/cost group so each stays a focused, HIG-idiomatic section.
struct SettingsFormGrid: View {
    let model: GeneralSettingsModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var columnCount: Int {
            horizontalSizeClass == .compact ? 1 : 2
        }
    #else
        private var columnCount: Int {
            2
        }
    #endif

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.xl, alignment: .top), count: columnCount)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xl) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.xl) {
                unitFields
            }
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.xl) {
                localeAndCostFields
            }
        }
    }

    @ViewBuilder private var unitFields: some View {
        SettingsSelectRow(
            labelKey: "app.distanceUnit", labelFallback: "Distance Unit",
            selection: model.binding(\.unitOfLength), options: GeneralSettingsAdapter.distanceOptions()
        )
        SettingsSelectRow(
            labelKey: "app.temperatureUnit", labelFallback: "Temperature Unit",
            selection: model.binding(\.unitOfTemp), options: GeneralSettingsAdapter.temperatureOptions()
        )
        SettingsSelectRow(
            labelKey: "app.pressureUnit", labelFallback: "Pressure Unit",
            selection: model.binding(\.unitOfPressure), options: GeneralSettingsAdapter.pressureOptions()
        )
        SettingsSelectRow(
            labelKey: "app.preferredRange", labelFallback: "Preferred Range",
            selection: model.binding(\.preferredRange), options: GeneralSettingsAdapter.rangeOptions()
        )
        SettingsStepperRow(
            labelKey: "app.decimalPrecision", labelFallback: "Decimal Precision",
            value: model.binding(\.decimalPrecision), range: 0 ... 20, preview: model.decimalPreview
        )
        SettingsSelectRow(
            labelKey: "app.language", labelFallback: "Language",
            selection: model.binding(\.language), options: GeneralSettingsAdapter.languageOptions()
        )
    }

    @ViewBuilder private var localeAndCostFields: some View {
        SettingsSelectRow(
            labelKey: "app.currency", labelFallback: "Currency",
            selection: model.binding(\.currencySymbol), options: GeneralSettingsAdapter.currencyOptions()
        )
        SettingsSelectRow(
            labelKey: "app.locale", labelFallback: "Number & Date Locale",
            selection: model.binding(\.locale), options: GeneralSettingsAdapter.localeOptions()
        )
        SettingsSelectRow(
            labelKey: "app.tzDisplayDefault", labelFallback: "Time Zone Display",
            selection: model.binding(\.tzDisplayDefault), options: GeneralSettingsAdapter.timezoneDisplayOptions()
        )
        SettingsTextRow(
            labelKey: "app.timezoneUser", labelFallback: "My Time Zone Override",
            text: model.binding(\.timezoneUser),
            promptKey: "app.timezoneUserPrompt",
            promptFallback: "e.g. America/Los_Angeles (leave blank for browser default)",
            helper: GeneralSettingsStrings.string(
                "app.timezoneUserHint",
                "IANA tz name. Useful when travelling but you'd rather see times in your home zone."
            )
        )
        SettingsCurrencyRow(
            labelKey: "app.electricityCost", labelFallback: "Electricity Cost (per kWh)",
            amount: model.binding(\.baseCostPerKwh), code: currencyCode
        )
        SettingsGasPriceRow(price: model.binding(\.gasPricePerUnit), unit: model.binding(\.gasUnit), code: currencyCode)
        SettingsNumberRow(
            labelKey: "app.comparisonMPG", labelFallback: "Comparison Vehicle MPG",
            value: model.binding(\.gasEfficiencyMpg),
            promptKey: "app.mpgPrompt", promptFallback: "Average MPG of equivalent gas car"
        )
    }

    private var currencyCode: String {
        GeneralSettingsAdapter.currencyCode(for: model.form.currencySymbol)
    }
}

// MARK: - Field container + input chrome

/// A labeled field wrapper: a top label, the control, and an optional helper line
/// (web `SettingField` / the `<label>` + helper `<p>`).
struct SettingsFieldContainer<Content: View>: View {
    let labelKey: String
    let labelFallback: String
    var helper: String?
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            GeneralSettingsStrings.text(labelKey, labelFallback)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            content()
            if let helper, !helper.isEmpty {
                Text(verbatim: helper).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension View {
    /// The shared bordered-surface chrome for a text/number/currency field,
    /// mirroring the shared `TSSelect` / `TSUnitInput` look.
    func settingsInputSurface() -> some View {
        padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

// MARK: - Rows

/// A dropdown field (web `<Select>`) backed by a native menu `Picker`.
struct SettingsSelectRow: View {
    let labelKey: String
    let labelFallback: String
    @Binding var selection: String
    let options: [SettingsOption]

    var body: some View {
        SettingsFieldContainer(labelKey: labelKey, labelFallback: labelFallback) {
            Picker(selection: $selection) {
                ForEach(options) { option in
                    Text(verbatim: option.title).tag(option.value)
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .frame(maxWidth: .infinity, alignment: .leading)
            .settingsInputSurface()
            .accessibilityLabel(GeneralSettingsStrings.text(labelKey, labelFallback))
        }
    }
}

/// An integer field with a stepper + value + preview (web decimal-precision input).
struct SettingsStepperRow: View {
    let labelKey: String
    let labelFallback: String
    @Binding var value: Int
    let range: ClosedRange<Int>
    let preview: String

    var body: some View {
        SettingsFieldContainer(labelKey: labelKey, labelFallback: labelFallback, helper: previewLine) {
            Stepper(value: $value, in: range) {
                Text(verbatim: "\(value)")
                    .font(Font.TS.body).monospacedDigit().foregroundStyle(Color.TS.textPrimary)
            }
            .settingsInputSurface()
            .accessibilityLabel(GeneralSettingsStrings.text(labelKey, labelFallback))
            .accessibilityValue(Text(verbatim: "\(value)"))
        }
    }

    private var previewLine: String {
        "\(GeneralSettingsStrings.string("app.preview", "Preview")): \(preview)"
    }
}

/// A free-text field (web `<Input type="text">`) with an optional helper line.
struct SettingsTextRow: View {
    let labelKey: String
    let labelFallback: String
    @Binding var text: String
    let promptKey: String
    let promptFallback: String
    var helper: String?

    var body: some View {
        SettingsFieldContainer(labelKey: labelKey, labelFallback: labelFallback, helper: helper) {
            TextField(text: $text, prompt: prompt) { EmptyView() }
                .labelsHidden()
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .autocorrectionDisabled()
                .settingsInputSurface()
                .accessibilityLabel(GeneralSettingsStrings.text(labelKey, labelFallback))
        }
    }

    private var prompt: Text {
        Text(verbatim: GeneralSettingsStrings.string(promptKey, promptFallback))
    }
}

/// A decimal field (web `<Input type="number">`) bound to a `Double`.
struct SettingsNumberRow: View {
    let labelKey: String
    let labelFallback: String
    @Binding var value: Double
    let promptKey: String
    let promptFallback: String

    var body: some View {
        SettingsFieldContainer(labelKey: labelKey, labelFallback: labelFallback) {
            TextField(value: $value, format: .number, prompt: prompt) { EmptyView() }
                .labelsHidden()
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .monospacedDigit()
                .decimalKeyboard()
                .settingsInputSurface()
                .accessibilityLabel(GeneralSettingsStrings.text(labelKey, labelFallback))
        }
    }

    private var prompt: Text {
        Text(verbatim: GeneralSettingsStrings.string(promptKey, promptFallback))
    }
}

/// A currency field (web `<CurrencyInput>`) formatting with the ISO 4217 code
/// resolved from the selected currency glyph.
struct SettingsCurrencyRow: View {
    let labelKey: String
    let labelFallback: String
    @Binding var amount: Double
    let code: String

    var body: some View {
        SettingsFieldContainer(labelKey: labelKey, labelFallback: labelFallback) {
            TextField(value: $amount, format: .currency(code: code), prompt: nil) { EmptyView() }
                .labelsHidden()
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .monospacedDigit()
                .decimalKeyboard()
                .settingsInputSurface()
                .accessibilityLabel(GeneralSettingsStrings.text(labelKey, labelFallback))
        }
    }
}

/// The gas-price field: a currency amount + a per-gallon/per-liter unit select
/// (web `<CurrencyInput>` + inline `<Select>`).
struct SettingsGasPriceRow: View {
    @Binding var price: Double
    @Binding var unit: String
    let code: String

    var body: some View {
        SettingsFieldContainer(labelKey: "app.gasPrice", labelFallback: "Gas Price (for EV vs ICE comparison)") {
            HStack(spacing: TSSpacing.sm) {
                TextField(value: $price, format: .currency(code: code), prompt: nil) { EmptyView() }
                    .labelsHidden()
                    .textFieldStyle(.plain)
                    .font(Font.TS.body)
                    .monospacedDigit()
                    .decimalKeyboard()
                    .frame(maxWidth: .infinity)
                    .settingsInputSurface()
                    .accessibilityLabel(GeneralSettingsStrings.text("app.gasPrice", "Gas Price"))
                Picker(selection: $unit) {
                    ForEach(GeneralSettingsAdapter.gasUnitOptions()) { option in
                        Text(verbatim: option.title).tag(option.value)
                    }
                } label: {
                    EmptyView()
                }
                .pickerStyle(.menu)
                .tint(Color.TS.accent)
                .settingsInputSurface()
                .accessibilityLabel(GeneralSettingsStrings.text("app.gasUnit", "Gas unit"))
            }
        }
    }
}

private extension View {
    /// Applies the decimal keypad on iOS; a no-op on macOS (hardware keyboard).
    @ViewBuilder
    func decimalKeyboard() -> some View {
        #if os(iOS)
            keyboardType(.decimalPad)
        #else
            self
        #endif
    }
}
