//
//  SignalCompareControls.Controls.swift
//  TeslaSync — P4 feature view · 0267 · SignalCompareControls (Apple)
//
//  The interactive controls composed into the populated content: the two window
//  `datetime-local` fields with their inline help tooltips (web `Input type=datetime-local`
//  + `HelpTooltip`), the quick-preset button row (web secondary `Button`s), the signal
//  filter field (web `Input type=search`), and the category chips (web rounded-full
//  `<button>`s). Token-driven (P1/S9); copy via the P1/S10 facade. The view performs no
//  networking — every edit routes through the model.
//

import SwiftUI

// MARK: - Flow layout (web `flex flex-wrap`)

/// A wrapping row layout reproducing the web `flex flex-wrap`: lays subviews left to
/// right, breaking to a new line when the next subview would overflow the width.
struct SignalCompareFlowLayout: Layout {
    var horizontalSpacing: CGFloat = TSSpacing.sm
    var verticalSpacing: CGFloat = TSSpacing.sm

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0
        var widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth > 0, rowWidth + horizontalSpacing + size.width > maxWidth {
                totalHeight += rowHeight + verticalSpacing
                widest = max(widest, rowWidth)
                rowWidth = size.width
                rowHeight = size.height
            } else {
                rowWidth += rowWidth > 0 ? horizontalSpacing + size.width : size.width
                rowHeight = max(rowHeight, size.height)
            }
        }
        widest = max(widest, rowWidth)
        let resolvedWidth = maxWidth == .infinity ? widest : maxWidth
        return CGSize(width: resolvedWidth, height: totalHeight + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        var lineX = bounds.minX
        var lineY = bounds.minY
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if lineX > bounds.minX, lineX + size.width > bounds.maxX {
                lineY += rowHeight + verticalSpacing
                lineX = bounds.minX
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: lineX, y: lineY), anchor: .topLeading, proposal: ProposedViewSize(size))
            lineX += size.width + horizontalSpacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

// MARK: - Help tooltip (web `HelpTooltip`)

/// The inline "?" help affordance (web `HelpTooltip`): a button revealing the help body
/// in a popover, labeled for VoiceOver with the web `ariaLabel`.
struct SignalCompareHelpButton: View {
    let body0: String
    let ariaLabel: String
    @State private var isShowing = false

    var body: some View {
        Button {
            isShowing.toggle()
        } label: {
            Image(systemName: "questionmark.circle")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: ariaLabel))
        .popover(isPresented: $isShowing) {
            Text(verbatim: body0)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .padding(TSSpacing.md)
                .frame(maxWidth: 280)
                .presentationCompactAdaptation(.popover)
        }
        .help(Text(verbatim: body0))
    }
}

// MARK: - Window field (web `Input type=datetime-local` + label + help)

/// One labeled window field (web Window A / Window B): a tinted label, the inline help
/// tooltip, and a `datetime-local` editor. When a value is set it shows a `DatePicker`
/// + a clear button; when empty it shows a "set" affordance — so both render, never a
/// blank box (web allows an empty `datetime-local`).
struct SignalCompareWindowField: View {
    let title: String
    let tone: Color
    let helpBody: String
    let helpAria: String
    let value: String
    let timeZone: TimeZone
    let onChange: (String) -> Void

    private var parsedDate: Date? {
        SignalCompareDateFormat.parseLocalDatetimeInput(value, timeZone: timeZone)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: title)
                    .font(Font.TS.caption)
                    .foregroundStyle(tone)
                SignalCompareHelpButton(body0: helpBody, ariaLabel: helpAria)
            }
            editor
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: title))
    }

    @ViewBuilder
    private var editor: some View {
        if let parsedDate {
            HStack(spacing: TSSpacing.xs) {
                DatePicker(
                    "",
                    selection: Binding(
                        get: { parsedDate },
                        set: { onChange(SignalCompareDateFormat.toLocalDatetimeInput($0, timeZone: timeZone)) }
                    ),
                    displayedComponents: [.date, .hourAndMinute]
                )
                .labelsHidden()
                .accessibilityLabel(Text(verbatim: title))
                Button {
                    onChange("")
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: SignalCompareStrings.clearSearch))
            }
        } else {
            Button {
                onChange(SignalCompareDateFormat.toLocalDatetimeInput(Date(), timeZone: timeZone))
            } label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "calendar.badge.clock").font(.system(size: 12, weight: .medium))
                    Text(verbatim: "—").font(Font.TS.body)
                }
                .foregroundStyle(Color.TS.textSecondary)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
        }
    }
}

// MARK: - Preset row (web "Quick presets:" + secondary Buttons)

/// The quick-preset row (web `DIFF_PRESETS.map`): the muted label then the 5 secondary
/// buttons, wrapping like the web `flex flex-wrap`. Each applies its window through the
/// model.
struct SignalComparePresetRow: View {
    @Bindable var model: SignalCompareControlsModel

    var body: some View {
        SignalCompareFlowLayout(horizontalSpacing: TSSpacing.sm, verticalSpacing: TSSpacing.sm) {
            Text(verbatim: SignalCompareStrings.presetsLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .frame(minHeight: 28)
            ForEach(SignalDiffPreset.all) { preset in
                TSButton(variant: .secondary, size: .small) {
                    model.applyPreset(preset.id)
                } label: {
                    Text(verbatim: model.localize(preset.labelKey, preset.defaultLabel))
                }
                .accessibilityLabel(Text(verbatim: model.localize(preset.labelKey, preset.defaultLabel)))
            }
        }
    }
}

// MARK: - Search field (web `Input type=search`)

/// The signal filter field (web `Input type=search`): a magnifying glass, the bound
/// text, and a clear button when non-empty. Edits route through `setSearch`.
struct SignalCompareSearchField: View {
    @Bindable var model: SignalCompareControlsModel

    var body: some View {
        let binding = Binding(get: { model.selection.search }, set: { model.setSearch($0) })
        let prompt = SignalCompareStrings.filterPlaceholder // parity:allow ui
        return HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TextField("", text: binding, prompt: Text(verbatim: prompt))
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityLabel(Text(verbatim: prompt))
            if !model.selection.search.isEmpty {
                Button {
                    model.setSearch("")
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: SignalCompareStrings.clearSearch))
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: 360, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Category chip (web rounded-full `<button>`)

/// One category chip (web `CATEGORY_PREFIXES.map` rounded-full button): an uppercase
/// label whose active state reads as selected for VoiceOver (web `aria-pressed`).
struct SignalCompareCategoryChip: View {
    let label: String
    let isActive: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .textCase(.uppercase)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs)
                .foregroundStyle(isActive ? Color.TS.accent : Color.TS.textMuted)
                .background(isActive ? Color.TS.accent.opacity(0.15) : Color.TS.surface, in: Capsule())
                .overlay(
                    Capsule().strokeBorder(
                        isActive ? Color.TS.accent.opacity(0.4) : Color.TS.border,
                        lineWidth: 1
                    )
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}
