//
//  AISettings.Views.swift
//  TeslaSync — P4 feature view · 0202 · AISettings (Apple)
//
//  The presentational subviews composed by `AISettings`: the Helix-branded icon box,
//  the mode picker (web radiogroup of `<ModeRadio>` cards), the off-mode helper
//  banner, the cloud cost-cap spend bar (web `AICostCapSpendBar`), the save action
//  row, and the loading / empty / error chrome. All consume the P1/S10 facade and the
//  shared P1/S9 tokens — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): Helix brand → `chartSeriesPower`
//  (the brand purple), cost-cap ok → `statusInfo` (web cyan-300), warn →
//  `statusWarning` (web amber-300), critical → `statusDanger` (web rose-300).
//

import SwiftUI

// MARK: - Helix icon box (web `<IconBox color="purple"><HelixMark/></IconBox>`)

/// The Helix-branded header glyph in a tinted rounded tile — the native peer of the
/// web purple `IconBox` wrapping the `HelixMark`. The brand mark atom itself is owned
/// by the component-library bundle; here it is the SF Symbol brand glyph.
struct HelixIconBox: View {
    var body: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .fill(Color.TS.chartSeriesPower.opacity(0.12))
            .frame(width: 36, height: 36)
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.chartSeriesPower.opacity(0.25), lineWidth: 1)
            )
            .overlay(
                Image(systemName: "sparkles")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.TS.chartSeriesPower)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Form body (web non-empty render)

/// The resolved settings form — the mode picker, the off-mode banner, the optional
/// cloud cost-cap bar, and the save action, wrapped in the shared fade-in (web
/// `FadeIn`).
struct AiSettingsForm: View {
    @Bindable var model: AiSettingsModel

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.xl) {
                HelixModePicker(selected: model.selectedMode) { model.selectMode($0) }
                if model.showsOffBanner {
                    HelixOffBanner()
                }
                if model.showsCostCapBar {
                    HelixCostCapBar(costCap: model.costCap, usageLoading: model.resolved.usageLoading)
                }
                HelixSaveRow(isSaving: model.savePhase.isSaving) { model.save() }
            }
        }
    }
}

// MARK: - Mode picker (web `<fieldset>` radiogroup of `<ModeRadio>` cards)

/// The Helix-mode picker — the legend caption over a vertical group of selectable
/// cards, one per `AiMode`. Mirrors the web radiogroup; each card is a real button
/// carrying the selected trait so VoiceOver announces the choice.
struct HelixModePicker: View {
    let selected: AiMode
    let onSelect: (AiMode) -> Void

    private var legend: String {
        AiSettingsStrings.string("ai.settings.modeLegend", "Helix mode")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: legend)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            VStack(spacing: TSSpacing.sm) {
                ForEach(AiModeCatalog.options) { option in
                    HelixModeRow(
                        option: option,
                        isSelected: option.mode == selected,
                        onSelect: { onSelect(option.mode) }
                    )
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: legend))
        }
    }
}

/// One mode card — a radio indicator, the label, and the helper description. Selected
/// cards take the brand-purple accent (web `border-purple-400/50 bg-purple-500/10`).
struct HelixModeRow: View {
    let option: AiModeOption
    let isSelected: Bool
    let onSelect: () -> Void

    private var label: String {
        AiSettingsStrings.string(option.labelKey, option.labelFallback)
    }

    private var hint: String {
        AiSettingsStrings.string(option.hintKey, option.hintFallback)
    }

    var body: some View {
        Button(action: onSelect) {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Image(systemName: isSelected ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 16, weight: .regular))
                    .foregroundStyle(isSelected ? Color.TS.chartSeriesPower : Color.TS.textMuted)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: label)
                        .font(Font.TS.bodySm.weight(.medium))
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: hint)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(
                isSelected ? Color.TS.chartSeriesPower.opacity(0.10) : Color.clear,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(
                        isSelected ? Color.TS.chartSeriesPower.opacity(0.5) : Color.TS.border,
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityHint(Text(verbatim: hint))
    }
}

// MARK: - Off banner (web `mode === 'off'` → `ai.settings.bannerOff` HelperText)

/// The off-mode reassurance banner — shown only while `off` is selected, mirroring
/// the web `HelperText` under the mode group.
struct HelixOffBanner: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.xs) {
            Image(systemName: "info.circle")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: AiSettingsStrings.string(
                "ai.settings.bannerOff",
                "Helix is off. Your app works fully without it. Enable a mode above to opt in."
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Cost-cap spend bar (web `AICostCapSpendBar`)

/// The live "today" Helix spend bar — the title, the `${{spent}} / ${{cap}}` readout
/// (or a loading indicator), the proportional fill, and the warn / critical hints.
/// Visible only in cloud mode with a non-zero cap (the model gates this).
struct HelixCostCapBar: View {
    let costCap: HelixCostCap
    let usageLoading: Bool

    private var tone: Color {
        switch costCap.level {
        case .ok: Color.TS.statusInfo
        case .warn: Color.TS.statusWarning
        case .critical: Color.TS.statusDanger
        }
    }

    private var amountText: String {
        if usageLoading {
            return AiSettingsStrings.string("ai.settings.costCap.loading", "Loading…")
        }
        let parts = costCap.amountParts()
        // Native parity of the web `${{spent}} / ${{cap}}` interpolation.
        return String(
            format: AiSettingsStrings.string("ai.settings.costCap.amount", "$%1$@ / $%2$@"),
            parts.spent,
            parts.cap
        )
    }

    private var accessibilityValue: String {
        let parts = costCap.amountParts()
        return AiSettingsAccessibility.costCapValue(
            spent: "$\(parts.spent)",
            cap: "$\(parts.cap)",
            percent: Int(costCap.percent.rounded())
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: AiSettingsStrings.string("ai.settings.costCap.todayTitle", "Today’s Helix spend"))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: amountText)
                    .font(Font.TS.caption.weight(.medium))
                    .foregroundStyle(tone)
                    .monospacedDigit()
            }
            track
            hint
        }
        .padding(TSSpacing.md)
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: AiSettingsStrings.string(
            "ai.settings.costCap.barLabel",
            "Helix cost cap usage"
        )))
        .accessibilityValue(Text(verbatim: accessibilityValue))
    }

    private var track: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.border.opacity(0.4))
                Capsule()
                    .fill(tone)
                    .frame(width: max(0, proxy.size.width * (costCap.percent / 100)))
            }
        }
        .frame(height: 8)
    }

    @ViewBuilder
    private var hint: some View {
        switch costCap.level {
        case .critical:
            Text(verbatim: AiSettingsStrings.string(
                "ai.settings.costCap.criticalHint",
                "Cap reached — new Helix calls will be rejected until the cap resets at UTC midnight or you raise it."
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.statusDanger)
            .fixedSize(horizontal: false, vertical: true)
        case .warn:
            Text(verbatim: AiSettingsStrings.string(
                "ai.settings.costCap.warnHint",
                "You are nearing today’s cap. Calls will pause once you reach it."
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.statusWarning)
            .fixedSize(horizontal: false, vertical: true)
        case .ok:
            EmptyView()
        }
    }
}

// MARK: - Save row (web primary `<Button>` with `isPending` → "Saving…")

/// The save action — a top divider over a trailing primary button that flips to a
/// "Saving…" spinner while the mutation is in flight (web `saveAi.isPending`).
struct HelixSaveRow: View {
    let isSaving: Bool
    let onSave: () -> Void

    private var title: String {
        isSaving
            ? AiSettingsStrings.string("ai.settings.saving", "Saving…")
            : AiSettingsStrings.string("ai.settings.save", "Save Helix settings")
    }

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Divider().overlay(Color.TS.border)
            HStack(spacing: TSSpacing.sm) {
                Spacer(minLength: 0)
                TSButton(variant: .primary, isLoading: isSaving, action: onSave) {
                    Text(verbatim: title)
                }
                .accessibilityLabel(Text(verbatim: title))
            }
        }
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: a skeleton legend over skeleton mode cards and a
/// skeleton action, so the panel keeps its shape while settings resolve.
struct AiSettingsLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(width: 96, height: 12)
            ForEach(0 ..< 3, id: \.self) { _ in
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.pill)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 120, height: 12)
                        TSSkeleton(height: 10)
                    }
                }
            }
            HStack {
                Spacer(minLength: 0)
                TSSkeleton(width: 140, height: 32, cornerRadius: TSRadius.md)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: AiSettingsStrings.string(
            "ai.settings.loadingA11y",
            "Loading Helix settings"
        )))
    }
}

/// The empty render (settings resolved with no payload): a friendly state, never a
/// blank panel.
struct AiSettingsEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: AiSettingsStrings.string(
                    "ai.settings.empty",
                    "Helix settings are unavailable right now."
                ))
            } icon: {
                Image(systemName: "sparkles")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct AiSettingsErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: AiSettingsStrings.string("ai.settings.errorTitle", "Couldn't load Helix settings"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: AiSettingsStrings.string("ai.settings.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: AiSettingsStrings.string("ai.settings.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
