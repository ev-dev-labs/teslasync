//
//  DataTableColumnsMenu.Views.swift
//  TeslaSync — P4 shared surface · 0211 · DataTableColumnsMenu (Apple)
//
//  The presentational pieces of the column-visibility menu — the native peers of the web elements: the
//  popover panel (web the `role="menu"` container `<div>` + its header + `<ul>`), the header (web the heading
//  `<span>` + the "Show all" `<button>`), one column row (web the `<li>`'s `<label>`: a `<input
//  type=checkbox>` + the header `<span>`), and the friendly empty body (native — the web renders an empty
//  list). All chrome is token-driven (P1/S9): the panel is a system material clipped to the panel radius with
//  the semantic hairline border + an elevation shadow (web `bg-[var(--surface-elevated)] border-white/[0.08]
//  rounded-lg shadow-xl`); the checkbox is a HIG checkmark box tinted with the brand accent. No raw hex, no
//  Tailwind ports. The panel is one VoiceOver container named "Show or hide columns" (web `aria-label`); each
//  row toggle is a VoiceOver checkbox named by the column label (web associates the `<label>` text with the
//  checkbox); the "Show all" control is a labelled button; the decorative trigger glyph is hidden from
//  VoiceOver (web `aria-hidden`). The list grows with its content and scrolls past the web `max-h-64` cap via
//  `ViewThatFits`.
//

import SwiftUI

// MARK: - DataTableColumnsMenuPanel (web `role="menu"` popover)

/// The floating menu panel — the native peer of the web `role="menu"` container `<div>`. It stacks the
/// header (heading + "Show all") over the column-row list (or the friendly empty body when there are no
/// columns), on a system material clipped to the panel radius with the hairline border + elevation shadow.
/// The list sizes to its content and scrolls only past the web `max-h-64` cap. It is one VoiceOver container
/// named "Show or hide columns" (web `aria-label`).
struct DataTableColumnsMenuPanel: View {
    let controller: DataTableColumnsMenuController

    var body: some View {
        VStack(alignment: .leading, spacing: DataTableColumnsMenuLayout.headerBottomSpacing) {
            DataTableColumnsMenuHeader(
                heading: controller.headingLabel,
                onShowAll: controller.showAll
            )
            content
        }
        .padding(DataTableColumnsMenuLayout.popoverPadding)
        .frame(width: DataTableColumnsMenuLayout.popoverWidth, alignment: .leading)
        .background(
            TSMaterial.panel,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .shadow(color: .black.opacity(0.25), radius: 16, x: 0, y: 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: controller.menuLabel))
    }

    @ViewBuilder private var content: some View {
        if controller.isEmpty {
            DataTableColumnsMenuEmptyView()
        } else {
            let stack = VStack(spacing: DataTableColumnsMenuLayout.rowSpacing) {
                ForEach(controller.rows) { row in
                    DataTableColumnsMenuRowView(row: row) { controller.toggle(row.key) }
                }
            }
            ViewThatFits(in: .vertical) {
                stack
                ScrollView { stack }
            }
            .frame(maxHeight: DataTableColumnsMenuLayout.listMaxHeight)
        }
    }
}

// MARK: - DataTableColumnsMenuHeader (web heading + "Show all")

/// The panel header — the native peer of the web heading `<span>` + the "Show all" `<button>`: the uppercase
/// muted heading on the leading edge and the accent "Show all" control on the trailing edge. Tapping "Show
/// all" makes every column visible (web `showAll`) and keeps the menu open. The control is one VoiceOver
/// button named "Show all".
struct DataTableColumnsMenuHeader: View {
    let heading: String
    let onShowAll: () -> Void

    var body: some View {
        HStack(spacing: DataTableColumnsMenuLayout.rowContentGap) {
            Text(verbatim: heading)
                .font(.system(size: DataTableColumnsMenuLayout.headingFontSize, weight: .medium))
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: onShowAll) {
                Text(verbatim: DataTableColumnsMenuStrings.showAll)
                    .font(.system(size: DataTableColumnsMenuLayout.headingFontSize, weight: .medium))
                    .foregroundStyle(Color.TS.accent)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: DataTableColumnsMenuStrings.showAll))
        }
        .padding(.horizontal, DataTableColumnsMenuLayout.rowPaddingV)
    }
}

// MARK: - DataTableColumnsMenuRowView (web `<li>` label)

/// One column row — the native peer of the web `<li>`'s `<label>`: a leading visibility checkbox (web
/// `<input type=checkbox>`) and the column header label (web `col.header || col.key`). The checkbox is
/// disabled for a required column or the last visible column (web `disabled`). The whole row is the tap
/// target (web wraps both in one `<label>`), surfaced to VoiceOver as a single checkbox named by the column
/// label and carrying the checked / unchecked value.
struct DataTableColumnsMenuRowView: View {
    let row: DataTableColumnsMenuRow
    let onToggle: () -> Void

    var body: some View {
        Toggle(isOn: Binding(get: { row.isVisible }, set: { _ in onToggle() })) {
            Text(verbatim: row.label)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .toggleStyle(DataTableColumnsMenuCheckboxToggleStyle())
        .disabled(row.toggleDisabled)
        .padding(.horizontal, DataTableColumnsMenuLayout.rowPaddingH)
        .padding(.vertical, DataTableColumnsMenuLayout.rowPaddingV)
        .frame(minHeight: DataTableColumnsMenuLayout.rowMinHeight)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityLabel(Text(verbatim: row.label))
    }
}

// MARK: - DataTableColumnsMenuCheckboxToggleStyle (web `<input type=checkbox>`)

/// A HIG checkbox toggle style — the native peer of the web `<input type=checkbox>`: a leading filled accent
/// checkmark box when on, a muted empty box when off, dimmed when disabled, followed by the toggle's label.
/// Keeps the Toggle's VoiceOver checkbox semantics (it announces checked / unchecked) while rendering the
/// brand-tinted box and the inline column label.
struct DataTableColumnsMenuCheckboxToggleStyle: ToggleStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack(spacing: DataTableColumnsMenuLayout.rowContentGap) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .font(.system(size: DataTableColumnsMenuLayout.checkboxSide, weight: .regular))
                    .foregroundStyle(configuration.isOn ? Color.TS.accent : Color.TS.textMuted)
                configuration.label
            }
            .opacity(isEnabled ? 1 : 0.4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - DataTableColumnsMenuEmptyView (native — never a blank box)

/// The friendly body shown when the menu is opened with no columns. The web renders an empty list; the
/// native HIG calls for a labelled empty body rather than a blank box. One combined VoiceOver element; the
/// leading glyph is decorative and hidden from assistive technology.
struct DataTableColumnsMenuEmptyView: View {
    var body: some View {
        HStack(spacing: DataTableColumnsMenuLayout.rowContentGap) {
            Image(systemName: "tablecells")
                .font(.system(size: 13))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: DataTableColumnsMenuStrings.empty)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, DataTableColumnsMenuLayout.rowPaddingH)
        .padding(.vertical, DataTableColumnsMenuLayout.rowPaddingV)
        .frame(minHeight: DataTableColumnsMenuLayout.rowMinHeight)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
