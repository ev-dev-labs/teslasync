//
//  WidgetSettingsModal.Controls.swift
//  TeslaSync — P4 modal / dialog · 0027 · WidgetSettingsModal (Apple)
//
//  The form sections `WidgetSettingsPopulatedView` scrolls — the parity of the web `FormSection`
//  blocks: Vehicle (the scope select, shown only for vehicle widgets), Refresh Interval (the cadence
//  select), Time Range (the chart-range select, shown only for chart widgets), and Appearance (the
//  show-title switch). The selects render as native menu pickers, the switch as a native toggle. Each
//  section is a token glass panel mirroring the web `FormSection` (`glass-panel`). All copy resolves
//  through P1/S10; vehicle data renders verbatim. Binds through `WidgetSettingsModel` (P1/S8).
//

import SwiftUI

// MARK: - Section scaffold (web `FormSection`)

/// A form section: a title (web `<h3 class="section-title">`) and its content, wrapped in a token
/// glass panel (web `glass-panel`).
struct WidgetSettingsSection<Content: View>: View {
    let titleKey: String
    let titleFallback: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: WidgetSettingsStrings.string(titleKey, titleFallback))
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityAddTraits(.isHeader)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Vehicle Filter (web scope `<Select>`, shown when `isVehicleWidget`)

/// The Vehicle section: the scope picker (web `Select` with "All Vehicles (first)" + each vehicle).
/// `nil` selection = all vehicles (web `'all'`).
struct WidgetSettingsVehicleSection: View {
    @Bindable var model: WidgetSettingsModel

    var body: some View {
        WidgetSettingsSection(titleKey: "dashboard.settings.vehicle", titleFallback: "Vehicle") {
            WidgetSettingsMenuRow {
                Picker(selection: selection) {
                    Text(verbatim: WidgetSettingsStrings.string(
                        "dashboard.settings.allVehicles", "All Vehicles (first)"
                    ))
                    .tag(Int?.none)
                    ForEach(model.vehicles) { vehicle in
                        Text(verbatim: model.vehicleLabel(vehicle)).tag(Int?.some(vehicle.id))
                    }
                } label: {
                    EmptyView()
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .tint(Color.TS.accent)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel(Text(verbatim: WidgetSettingsStrings.string(
                    "dashboard.settings.vehicle", "Vehicle"
                )))
            }
        }
    }

    private var selection: Binding<Int?> {
        Binding(get: { model.draft.vehicleID }, set: { model.setVehicleID($0) })
    }
}

// MARK: - Refresh Interval (web cadence `<Select>`)

/// The Refresh Interval section: the cadence picker (web `Select` over Default / 5 / 15 / 30 / 60s).
struct WidgetSettingsRefreshSection: View {
    @Bindable var model: WidgetSettingsModel

    var body: some View {
        WidgetSettingsSection(
            titleKey: "dashboard.settings.refreshInterval",
            titleFallback: "Refresh Interval"
        ) {
            WidgetSettingsMenuRow {
                Picker(selection: selection) {
                    ForEach(model.refreshOptions) { option in
                        Text(verbatim: model.refreshLabel(option)).tag(option.value)
                    }
                } label: {
                    EmptyView()
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .tint(Color.TS.accent)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel(Text(verbatim: WidgetSettingsStrings.string(
                    "dashboard.settings.refreshInterval", "Refresh Interval"
                )))
            }
        }
    }

    private var selection: Binding<Int?> {
        Binding(get: { model.draft.refreshRate }, set: { model.setRefreshRate($0) })
    }
}

// MARK: - Time Range (web chart-range `<Select>`, shown when `isChartWidget`)

/// The Time Range section: the chart-range picker (web `Select` over 24h / 7d / 30d / 90d), defaulting
/// to the web `'7d'` display value.
struct WidgetSettingsTimeRangeSection: View {
    @Bindable var model: WidgetSettingsModel

    var body: some View {
        WidgetSettingsSection(titleKey: "dashboard.settings.timeRange", titleFallback: "Time Range") {
            WidgetSettingsMenuRow {
                Picker(selection: selection) {
                    ForEach(model.timeRangeOptions) { option in
                        Text(verbatim: model.timeRangeLabel(option)).tag(option.value)
                    }
                } label: {
                    EmptyView()
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .tint(Color.TS.accent)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel(Text(verbatim: WidgetSettingsStrings.string(
                    "dashboard.settings.timeRange", "Time Range"
                )))
            }
        }
    }

    private var selection: Binding<String> {
        Binding(get: { model.timeRangeValue }, set: { model.setTimeRange($0) })
    }
}

// MARK: - Appearance (web show-title `Toggle`)

/// The Appearance section: the show-widget-title switch (web `Toggle`, default-on `showTitle !==
/// false`).
struct WidgetSettingsAppearanceSection: View {
    @Bindable var model: WidgetSettingsModel

    var body: some View {
        WidgetSettingsSection(titleKey: "dashboard.settings.appearance", titleFallback: "Appearance") {
            Toggle(isOn: showTitle) {
                Text(verbatim: WidgetSettingsStrings.string(
                    "dashboard.settings.showTitle", "Show widget title"
                ))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
            }
            .tint(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: WidgetSettingsStrings.string(
                "dashboard.settings.showTitle", "Show widget title"
            )))
        }
    }

    private var showTitle: Binding<Bool> {
        Binding(get: { model.showTitleChecked }, set: { model.setShowTitle($0) })
    }
}

// MARK: - Menu row chrome

/// Token-styled chrome for a menu picker so the native `.menu` picker reads as a bordered field (web
/// `Select` trigger).
struct WidgetSettingsMenuRow<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}
