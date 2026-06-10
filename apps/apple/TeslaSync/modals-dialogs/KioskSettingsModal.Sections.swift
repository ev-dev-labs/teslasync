//
//  KioskSettingsModal.Sections.swift
//  TeslaSync — P4 modal / dialog · 0025 · KioskSettingsModal (Apple)
//
//  The Rotation + Display form sections `KioskSettingsPopulatedView` composes, plus the shared form
//  primitives every section reuses (split from the chrome for the lint file-length budget): the
//  glass-panel `FormSection` wrapper (web `FormSection`), the labelled menu pickers (web `<Select>`),
//  the labelled toggle row (web `Toggle`), the labelled slider row (web `Slider`), and the
//  rotation-dashboard checkbox row (web checklist item). Each conditional sub-control mirrors the
//  web `&&` reveal exactly (cursor timeout, dim brightness, clock position, the dashboards-to-rotate
//  list). All copy resolves through P1/S10; chrome via P1/S9 tokens. Binds through
//  `KioskSettingsModel` (P1/S8).
//

import SwiftUI

// MARK: - FormSection wrapper (web `FormSection`)

/// A labelled glass-panel group of form controls (web `FormSection`: a `glass-panel` with a
/// `section-title` heading + optional description over the controls).
struct KioskFormSection<Content: View>: View {
    let title: String
    var description: String?
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: title)
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                if let description, !description.isEmpty {
                    Text(verbatim: description)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                content()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .background(
            Color.TS.surfaceGlass.opacity(0.4),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Labelled pickers (web `<Select>`)

/// A labelled menu picker over the numeric option catalog (web numeric `<Select>`): the label on the
/// leading edge and a native menu picker trailing.
struct KioskOptionPicker: View {
    let label: String
    let options: [KioskOption]
    let localize: (String, String) -> String
    @Binding var value: Int

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Picker(selection: $value) {
                ForEach(options) { option in
                    Text(verbatim: localize(option.labelKey, option.labelFallback)).tag(option.value)
                }
            } label: {
                EmptyView()
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: label))
        }
    }
}

/// The clock-position menu picker (web clock-position `<Select>`), over the `KioskClockPosition`
/// cases.
struct KioskClockPositionPicker: View {
    let label: String
    let localize: (String, String) -> String
    @Binding var value: KioskClockPosition

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Picker(selection: $value) {
                ForEach(KioskClockPosition.allCases) { position in
                    Text(verbatim: localize(position.labelKey, position.labelFallback)).tag(position)
                }
            } label: {
                EmptyView()
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: label))
        }
    }
}

// MARK: - Labelled toggle (web `Toggle`)

/// A labelled switch (web `Toggle`): the native `Toggle` already announces its on / off state to
/// VoiceOver, so only the label name is set.
struct KioskToggleRow: View {
    let label: String
    @Binding var isOn: Bool

    var body: some View {
        Toggle(isOn: $isOn) {
            Text(verbatim: label)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .tint(Color.TS.accent)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Labelled slider (web `Slider`)

/// A labelled single-thumb slider with a live percent readout (web `Slider` with `formatValue`): the
/// label + value on a header row over a native stepped `Slider`. The formatted value drives both the
/// readout and the VoiceOver `accessibilityValue`.
struct KioskSliderRow: View {
    let label: String
    let bounds: KioskSliderBounds
    let value: Int
    let onChange: (Int) -> Void
    let format: (Int) -> String

    private var binding: Binding<Double> {
        Binding(
            get: { Double(value) },
            set: { onChange(Int($0.rounded())) }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                Text(verbatim: label)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer()
                Text(verbatim: format(value))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textMuted)
            }
            Slider(
                value: binding,
                in: Double(bounds.min) ... Double(bounds.max),
                step: Double(bounds.step)
            )
            .tint(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: label))
            .accessibilityValue(Text(verbatim: format(value)))
        }
    }
}

// MARK: - Rotation-dashboard row (web checklist item)

/// One rotation-dashboard row (web dashboards-to-rotate `<label>`): a selection checkbox, the
/// dashboard name, and an optional "Default" marker. The whole row toggles the dashboard.
struct KioskDashboardRow: View {
    @Bindable var model: KioskSettingsModel
    let dashboard: KioskDashboard

    private var selected: Bool {
        model.isDashboardSelected(dashboard.id)
    }

    var body: some View {
        Button {
            model.toggleDashboard(dashboard.id)
        } label: {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: selected ? "checkmark.square.fill" : "square")
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(selected ? Color.TS.accent : Color.TS.textMuted)
                Text(verbatim: dashboard.name)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                if dashboard.isDefault {
                    Text(verbatim: KioskSettingsStrings.string("kiosk.default", "Default"))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(
                Color.TS.surfaceGlass.opacity(0.5),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: model.dashboardAccessibilityLabel(dashboard)))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: - Rotation section (web "Dashboard Rotation" FormSection)

/// The dashboard-rotation section: the rotation-interval picker, and (web
/// `rotateInterval > 0 && dashboards > 1`) the dashboards-to-rotate checklist.
struct KioskRotationSection: View {
    @Bindable var model: KioskSettingsModel

    var body: some View {
        KioskFormSection(title: KioskSettingsStrings.string("kiosk.rotation", "Dashboard Rotation")) {
            KioskOptionPicker(
                label: KioskSettingsStrings.string("kiosk.rotationInterval", "Rotation Interval"),
                options: KioskCatalog.rotationOptions,
                localize: model.localize,
                value: rotateBinding
            )
            if model.showsRotationList {
                rotationList
            }
        }
    }

    private var rotateBinding: Binding<Int> {
        Binding(get: { model.config.rotateInterval }, set: { model.setRotateInterval($0) })
    }

    private var rotationList: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: KioskSettingsStrings.string("kiosk.dashboardsToRotate", "Dashboards to Rotate"))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            VStack(spacing: TSSpacing.xs) {
                ForEach(model.dashboards) { dashboard in
                    KioskDashboardRow(model: model, dashboard: dashboard)
                }
            }
        }
    }
}

// MARK: - Display section (web "Display" FormSection)

/// The display-behaviour section: cursor auto-hide (+ idle timeout), screen dim (+ dimmed
/// brightness), and the clock overlay (+ its corner). Each secondary control mirrors the web `&&`
/// reveal.
struct KioskDisplaySection: View {
    @Bindable var model: KioskSettingsModel

    var body: some View {
        KioskFormSection(title: KioskSettingsStrings.string("kiosk.display", "Display")) {
            cursorGroup
            dimGroup
            clockGroup
        }
    }

    private var cursorGroup: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            KioskToggleRow(
                label: KioskSettingsStrings.string("kiosk.hideCursor", "Auto-hide Cursor"),
                isOn: Binding(get: { model.config.hideCursor }, set: { model.setHideCursor($0) })
            )
            if model.showsCursorTimeout {
                KioskOptionPicker(
                    label: KioskSettingsStrings.string("kiosk.cursorTimeout", "Hide After"),
                    options: KioskCatalog.cursorTimeoutOptions,
                    localize: model.localize,
                    value: Binding(get: { model.config.cursorTimeout }, set: { model.setCursorTimeout($0) })
                )
            }
        }
    }

    private var dimGroup: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            KioskOptionPicker(
                label: KioskSettingsStrings.string("kiosk.dimAfter", "Dim Screen After"),
                options: KioskCatalog.dimAfterOptions,
                localize: model.localize,
                value: Binding(get: { model.config.dimAfter }, set: { model.setDimAfter($0) })
            )
            if model.showsDimBrightness {
                KioskSliderRow(
                    label: KioskSettingsStrings.string("kiosk.brightness", "Dimmed Brightness"),
                    bounds: KioskCatalog.brightnessBounds,
                    value: model.brightnessPercent,
                    onChange: model.setDimBrightnessPercent,
                    format: percentLabel
                )
            }
        }
    }

    private var clockGroup: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            KioskToggleRow(
                label: KioskSettingsStrings.string("kiosk.showClock", "Show Clock"),
                isOn: Binding(get: { model.config.showClock }, set: { model.setShowClock($0) })
            )
            if model.showsClockPosition {
                KioskClockPositionPicker(
                    label: KioskSettingsStrings.string("kiosk.clockPosition", "Clock Position"),
                    localize: model.localize,
                    value: clockBinding
                )
            }
        }
    }

    private var clockBinding: Binding<KioskClockPosition> {
        Binding(get: { model.config.clockPosition }, set: { model.setClockPosition($0) })
    }
}

// MARK: - Shared percent formatter

/// Formats an integer percent through P1/S10 (web `${Math.round(n)}%`), so no `%` literal lives in
/// Swift.
func percentLabel(_ value: Int) -> String {
    KioskSettingsStrings.string("kiosk.percentValue", "{{value}}%", "{{value}}", String(value))
}
