//
//  DashboardSettingsModal.Controls.swift
//  TeslaSync — P4 modal / dialog · 0022 · DashboardSettingsModal (Apple)
//
//  The four form sections `DashboardSettingsPopulatedView` scrolls — the parity of the web form
//  blocks: Identity (the name field + the 16-emoji icon grid), Vehicle Filter (the scope select),
//  Auto-Refresh (the cadence select), and Display (the two switches). The selects render as native
//  menu pickers, the switches as native toggles, the name as a native text field, and the icon grid
//  as an 8-column `LazyVGrid` of glyph buttons. All copy resolves through P1/S10; vehicle + icon data
//  render verbatim. Binds through `DashboardSettingsModel` (P1/S8).
//

import SwiftUI

// MARK: - Section scaffold (web `<h3>` + description block)

/// A form section: a title (web `<h3>`), an optional description (web `<p>`), and its content.
struct DashboardSettingsSection<Content: View>: View {
    let titleKey: String
    let titleFallback: String
    var descriptionKey: String?
    var descriptionFallback: String?
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: DashboardSettingsStrings.string(titleKey, titleFallback))
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityAddTraits(.isHeader)
            if let descriptionKey, let descriptionFallback {
                Text(verbatim: DashboardSettingsStrings.string(descriptionKey, descriptionFallback))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Identity (web name + icon block)

/// The Identity section: the dashboard-name field (web `Input` with label "Name" + prompt "Dashboard
/// name") and the icon label + 8-column emoji grid (web `EmojiPicker`).
struct DashboardSettingsIdentitySection: View {
    @Bindable var model: DashboardSettingsModel

    var body: some View {
        DashboardSettingsSection(titleKey: "dashSettings.identity", titleFallback: "Identity") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                nameField
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    Text(verbatim: DashboardSettingsStrings.string("dashSettings.iconLabel", "Icon"))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                    DashboardSettingsIconPicker(model: model)
                }
            }
        }
    }

    private var nameField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: DashboardSettingsStrings.string("dashSettings.nameLabel", "Name"))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            TextField(text: name, prompt: prompt) {
                Text(verbatim: DashboardSettingsStrings.string("dashSettings.nameLabel", "Name"))
            }
            .labelsHidden()
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityLabel(Text(verbatim: DashboardSettingsStrings.string("dashSettings.nameLabel", "Name")))
        }
    }

    private var name: Binding<String> {
        Binding(get: { model.draft.name }, set: { model.setName($0) })
    }

    private var prompt: Text {
        Text(verbatim: DashboardSettingsStrings.string("dashSettings.name", "Dashboard name"))
    }
}

// MARK: - Icon picker (web `EmojiPicker`)

/// The 8-column icon grid (web `EmojiPicker`, `grid-cols-8`): each glyph is a tappable swatch, the
/// chosen one ringed in the accent tint (web `ring-1 ring-[var(--theme-primary)]`).
struct DashboardSettingsIconPicker: View {
    @Bindable var model: DashboardSettingsModel

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.xs), count: DashboardIconCatalog.columns)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.xs) {
            ForEach(model.icons, id: \.self) { icon in
                DashboardSettingsIconSwatch(icon: icon, model: model)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: DashboardSettingsStrings.string(
            "dashSettings.iconPicker", "Dashboard icon"
        )))
    }
}

/// One icon swatch (web `EmojiPicker` `Button`): renders the glyph, highlights when chosen, and sets
/// the draft icon on tap.
struct DashboardSettingsIconSwatch: View {
    let icon: String
    @Bindable var model: DashboardSettingsModel

    private var isSelected: Bool {
        model.isIconSelected(icon)
    }

    var body: some View {
        Button {
            model.setIcon(icon)
        } label: {
            Text(verbatim: icon)
                .font(.system(size: 20))
                .frame(width: 36, height: 36)
                .background(
                    isSelected ? Color.TS.surfaceGlass : Color.clear,
                    in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .strokeBorder(isSelected ? Color.TS.accent : Color.clear, lineWidth: 1.5)
                )
                .contentShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: model.iconAccessibilityLabel(icon)))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Vehicle Filter (web scope `<Select>`)

/// The Vehicle Filter section: the scope picker (web `Select` with "All Vehicles" + each vehicle).
/// `nil` selection = all vehicles (web empty `value`).
struct DashboardSettingsScopeSection: View {
    @Bindable var model: DashboardSettingsModel

    var body: some View {
        DashboardSettingsSection(
            titleKey: "dashSettings.vehicleFilter",
            titleFallback: "Vehicle Filter",
            descriptionKey: "dashSettings.vehicleFilterDesc",
            descriptionFallback:
            "Show data for a specific vehicle in all widgets. Widget-level filters take precedence."
        ) {
            DashboardSettingsMenuRow {
                Picker(selection: selection) {
                    Text(verbatim: DashboardSettingsStrings.string("dashSettings.allVehicles", "All Vehicles"))
                        .tag(Int?.none)
                    ForEach(model.vehicles) { vehicle in
                        Text(verbatim: vehicle.displayName).tag(Int?.some(vehicle.id))
                    }
                } label: {
                    EmptyView()
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .tint(Color.TS.accent)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel(Text(verbatim: DashboardSettingsStrings.string(
                    "dashSettings.vehicleFilterA11y", "Vehicle filter"
                )))
            }
        }
    }

    private var selection: Binding<Int?> {
        Binding(get: { model.draft.vehicleID }, set: { model.setVehicleID($0) })
    }
}

// MARK: - Auto-Refresh (web cadence `<Select>`)

/// The Auto-Refresh section: the cadence picker (web `Select` over `REFRESH_OPTIONS`).
struct DashboardSettingsRefreshSection: View {
    @Bindable var model: DashboardSettingsModel

    var body: some View {
        DashboardSettingsSection(titleKey: "dashSettings.refresh", titleFallback: "Auto-Refresh") {
            DashboardSettingsMenuRow {
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
                .accessibilityLabel(Text(verbatim: DashboardSettingsStrings.string(
                    "dashSettings.refreshA11y", "Auto-refresh interval"
                )))
            }
        }
    }

    private var selection: Binding<Int> {
        Binding(get: { model.draft.refreshInterval }, set: { model.setRefreshInterval($0) })
    }
}

// MARK: - Display (web two `Toggle`s)

/// The Display section: the widget-borders + compact-mode switches (web two `Toggle`s).
struct DashboardSettingsDisplaySection: View {
    @Bindable var model: DashboardSettingsModel

    var body: some View {
        DashboardSettingsSection(titleKey: "dashSettings.display", titleFallback: "Display") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                toggle(
                    key: "dashSettings.showBorders",
                    fallback: "Show widget borders",
                    isOn: borders
                )
                toggle(
                    key: "dashSettings.compactMode",
                    fallback: "Compact mode (smaller gaps)",
                    isOn: compact
                )
            }
        }
    }

    private func toggle(key: String, fallback: String, isOn: Binding<Bool>) -> some View {
        Toggle(isOn: isOn) {
            Text(verbatim: DashboardSettingsStrings.string(key, fallback))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .tint(Color.TS.accent)
        .accessibilityLabel(Text(verbatim: DashboardSettingsStrings.string(key, fallback)))
    }

    private var borders: Binding<Bool> {
        Binding(get: { model.draft.showWidgetBorders }, set: { model.setShowWidgetBorders($0) })
    }

    private var compact: Binding<Bool> {
        Binding(get: { model.draft.compactMode }, set: { model.setCompactMode($0) })
    }
}

// MARK: - Menu row chrome

/// Token-styled chrome for a menu picker so the native `.menu` picker reads as a bordered field (web
/// `Select` trigger).
struct DashboardSettingsMenuRow<Content: View>: View {
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
