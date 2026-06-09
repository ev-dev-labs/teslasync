//
//  GasPriceSettings.Views.swift
//  TeslaSync — P4 feature view · 0206 · GasPriceSettings (Apple)
//
//  The presentational subviews composed by `GasPriceSettings`: the auto-poll toggle +
//  poll-interval select row (web `grid-cols-1 sm:grid-cols-2` with the `SettingField`
//  toggle and the `<Select>` + `<HelpIcon>`), the current-price + last-polled info
//  cells, the "Poll Now" action with the EIA source caption, and the loading / empty /
//  error chrome (the P4 leaf states). All consume the P1/S10 facade and the shared
//  P1/S9 tokens — no networking, no Tailwind ports, no raw hex, no English literals.
//  The cells reflow from one column to two as width allows, matching the web grid.
//

import SwiftUI

// MARK: - Field help descriptor (web `<HelpIcon>` content)

/// One field-level help descriptor — the native mirror of the web `<HelpIcon>` props
/// (`i18nKey` / `for`). The help text resolves against the app's global catalog (the
/// native analogue of the web global `t()`), with the web English copy as the fallback.
struct GasHelpDescriptor {
    let i18nKey: String
    let fallback: String
    let fieldID: String

    /// The resolved help text (web `t(i18nKey, { defaultValue })`).
    var text: String {
        NSLocalizedString(i18nKey, tableName: nil, bundle: .main, value: fallback, comment: "")
    }
}

private enum GasHelp {
    static let autoPoll = GasHelpDescriptor(
        i18nKey: "help.fields.settings.gasPriceAutoPoll",
        fallback: "When enabled, TeslaSync automatically fetches U.S. average gasoline prices "
            + "from the EIA. Used to compute fuel-savings vs. driving an EV.",
        fieldID: "gas-auto-poll"
    )
    static let pollInterval = GasHelpDescriptor(
        i18nKey: "help.fields.settings.gasPricePollInterval",
        fallback: "How often the gas-price worker polls the EIA. Daily catches price spikes; "
            + "weekly is plenty for most users and is gentler on the upstream feed.",
        fieldID: "gas-poll-interval"
    )
}

// MARK: - Data body (web panel: controls grid + info grid + poll action)

/// The resolved panel body — the auto-poll toggle + poll-interval select, the
/// current-price + last-polled cells, and the "Poll Now" action with the source
/// caption. Pure function of the bound model's resolved state.
struct GasPriceForm: View {
    @Bindable var model: GasPriceSettingsModel

    private var intervalSelection: Binding<GasPollInterval> {
        Binding(
            get: { model.resolved.pollInterval },
            set: { model.selectInterval($0) }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xl) {
            controlsGrid
            infoGrid
            actionRow
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var controlsGrid: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                autoPollField.frame(minWidth: 220, maxWidth: .infinity, alignment: .leading)
                intervalField.frame(minWidth: 220, maxWidth: .infinity, alignment: .leading)
            }
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                autoPollField
                intervalField
            }
        }
    }

    private var autoPollField: some View {
        GasField(
            labelKey: "gas.autoPoll",
            labelFallback: "Auto-Poll",
            help: GasHelp.autoPoll
        ) {
            GasAutoPollControl(enabled: model.resolved.enabled) { model.toggleAutoPoll() }
        }
    }

    private var intervalField: some View {
        GasField(
            labelKey: "gas.pollInterval",
            labelFallback: "Poll Interval",
            help: GasHelp.pollInterval
        ) {
            GasIntervalControl(selection: intervalSelection)
        }
    }

    private var infoGrid: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                currentPriceCell.frame(minWidth: 200, maxWidth: .infinity, alignment: .leading)
                lastPolledCell.frame(minWidth: 200, maxWidth: .infinity, alignment: .leading)
            }
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                currentPriceCell
                lastPolledCell
            }
        }
    }

    private var currentPriceCell: some View {
        GasInfoCard(
            label: GasPriceStrings.string("gas.currentPrice", "Current Price"),
            value: model.resolved.currentPriceLabel
        )
    }

    private var lastPolledCell: some View {
        GasInfoCard(
            label: GasPriceStrings.string("gas.lastPolled", "Last Polled"),
            value: model.resolved.lastPolledLabel ?? GasPriceStrings.string("gas.never", "Never")
        )
    }

    private var actionRow: some View {
        HStack(alignment: .center, spacing: TSSpacing.lg) {
            TSButton(variant: .primary, isLoading: model.isPolling) {
                model.pollNow()
            } label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "bolt.fill").font(.system(size: 13, weight: .semibold))
                    Text(verbatim: GasPriceStrings.string("gas.pollNow", "Poll Now"))
                }
            }
            .accessibilityLabel(Text(verbatim: GasPriceStrings.string("gas.pollNow", "Poll Now")))
            Text(verbatim: GasPriceStrings.string(
                "gas.source",
                "Source: U.S. Energy Information Administration"
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Field wrapper (web `SettingField` label + `<HelpIcon>` above the control)

/// A labelled field with an optional inline help trigger above the caller-supplied
/// control — the SwiftUI parity of the web `SettingField` / `<Select>`+`<HelpIcon>`
/// label rows. Owns no data.
struct GasField<Control: View>: View {
    let labelKey: String
    let labelFallback: String
    let help: GasHelpDescriptor
    @ViewBuilder let control: () -> Control

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                Text(verbatim: GasPriceStrings.string(labelKey, labelFallback))
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(TSTypeMetrics.labelTracking)
                    .foregroundStyle(Color.TS.textMuted)
                GasHelpButton(help: help)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            control()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

/// The field-level help trigger — the SwiftUI parity of the web `<HelpIcon>`: a small
/// "(?)" button revealing the help text in a popover (and as a native hover tooltip on
/// macOS), with a per-field accessibility label ("Help for {field}") and the help text
/// as its accessibility hint.
struct GasHelpButton: View {
    let help: GasHelpDescriptor
    @State private var isShowing = false

    private var accessibilityLabelText: String {
        GasPriceAccessibility.helpLabel(
            format: GasPriceStrings.string("gas.helpFor", "Help for %@"),
            field: help.fieldID
        )
    }

    var body: some View {
        Button {
            isShowing.toggle()
        } label: {
            Image(systemName: "questionmark.circle")
                .font(.system(size: 13, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 16, height: 16)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
        .accessibilityHint(Text(verbatim: help.text))
        .help(Text(verbatim: help.text))
        .popover(isPresented: $isShowing) {
            Text(verbatim: help.text)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(TSSpacing.md)
                .frame(maxWidth: 280)
        }
    }
}

// MARK: - Auto-poll toggle (web ghost Button with Play/Pause + Running/Stopped)

/// The auto-poll toggle — the SwiftUI parity of the web ghost `<Button>`: a full-width
/// pill showing a play / pause glyph and the running / stopped label, tinted success
/// when enabled. Apple-idiomatic as a single tappable control with toggle semantics.
struct GasAutoPollControl: View {
    let enabled: Bool
    let action: () -> Void

    private var stateLabel: String {
        enabled
            ? GasPriceStrings.string("gas.running", "Running")
            : GasPriceStrings.string("gas.stopped", "Stopped")
    }

    private var tone: Color {
        enabled ? Color.TS.statusSuccess : Color.TS.textMuted
    }

    private var hintText: String {
        GasPriceStrings.string("gas.toggleHint", "Toggle automatic gas-price polling")
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.md) {
                Image(systemName: enabled ? "play.fill" : "pause.fill")
                    .font(.system(size: 14, weight: .semibold))
                Text(verbatim: stateLabel)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                Spacer(minLength: 0)
            }
            .foregroundStyle(tone)
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            .background(tone.opacity(0.08), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(tone.opacity(enabled ? 0.4 : 0.2), lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: GasPriceAccessibility.toggleLabel(
            label: GasPriceStrings.string("gas.autoPoll", "Auto-Poll"),
            state: stateLabel
        )))
        .accessibilityHint(Text(verbatim: hintText))
        .accessibilityAddTraits(enabled ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Poll-interval select (web `<Select>` backed by a native menu Picker)

/// The poll-interval select — the SwiftUI parity of the web `<Select>`, a native menu
/// `Picker` over the four cadence options. Wording resolves through the P1/S10 facade.
struct GasIntervalControl: View {
    @Binding var selection: GasPollInterval

    var body: some View {
        Picker(selection: $selection) {
            ForEach(GasPollInterval.allCases) { interval in
                Text(verbatim: GasPriceStrings.string(interval.labelKey, interval.labelFallback))
                    .tag(interval)
            }
        } label: {
            EmptyView()
        }
        .pickerStyle(.menu)
        .tint(Color.TS.accent)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel(Text(verbatim: GasPriceStrings.string("gas.pollInterval", "Poll Interval")))
    }
}

// MARK: - Info cell (web `rounded-xl border bg-surface-2 p-3.5` label/value block)

/// One labelled value cell — the current-price or last-polled block (web
/// `rounded-xl border bg-[var(--surface-2)] p-3.5`): an uppercase, wide-tracked, muted
/// caption above the resolved value.
struct GasInfoCard: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(TSTypeMetrics.labelTracking)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value)
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.border.opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: GasPriceAccessibility.infoLabel(label: label, value: value)))
    }
}
