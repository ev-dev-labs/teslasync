//
//  DataTableColumnMenu.Views.swift
//  TeslaSync — P4 shared surface · 0210 · DataTableColumnMenu (Apple)
//
//  The presentational pieces of the column visibility + reorder menu — the native peers of the web elements:
//  the popover panel (web the `role="menu"` container `<div>` + its header + `<ul>`), the header (web the
//  heading `<span>` + the "Reset" `<button>`), one column row (web the `<li>`: a `<input type=checkbox>`, the
//  header `<span>`, and the ↑ / ↓ `<button>`s), and the friendly empty body (native — the web renders an
//  empty list). All chrome is token-driven (P1/S9): the panel is a system material clipped to the panel
//  radius with the semantic hairline border + an elevation shadow (web `bg-[var(--surface-elevated)]
//  border-white/[0.08] rounded-lg shadow-xl`); the checkbox is a HIG checkmark box tinted with the brand
//  accent; the reset + ↑ / ↓ glyphs are SF Symbols. No raw hex, no Tailwind ports. The panel is one
//  VoiceOver container named by the reorder-aware menu label (web `aria-label`); the checkbox carries "Show
//  or hide {{col}}", the step buttons "Move {{col}} up / down" (web `aria-label`s); the decorative glyphs are
//  hidden from VoiceOver (web `aria-hidden`). The list grows with its content and scrolls past the web
//  `max-h-72` cap via `ViewThatFits`.
//

import SwiftUI

// MARK: - DataTableColumnMenuPanel (web `role="menu"` popover)

/// The floating menu panel — the native peer of the web `role="menu"` container `<div>`. It stacks the
/// header (heading + reset) over the column-row list (or the friendly empty body when there are no columns),
/// on a system material clipped to the panel radius with the hairline border + elevation shadow. The list
/// sizes to its content and scrolls only past the web `max-h-72` cap. It is one VoiceOver container named by
/// the reorder-aware menu label (web `aria-label={triggerLabel}`).
struct DataTableColumnMenuPanel: View {
    let controller: DataTableColumnMenuController

    var body: some View {
        VStack(alignment: .leading, spacing: DataTableColumnMenuLayout.headerBottomSpacing) {
            DataTableColumnMenuHeader(
                heading: controller.headingLabel,
                onReset: controller.reset
            )
            content
        }
        .padding(DataTableColumnMenuLayout.popoverPadding)
        .frame(width: DataTableColumnMenuLayout.popoverWidth, alignment: .leading)
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
        .accessibilityLabel(Text(verbatim: controller.triggerLabel))
    }

    @ViewBuilder private var content: some View {
        if controller.isEmpty {
            DataTableColumnMenuEmptyView()
        } else {
            let stack = VStack(spacing: DataTableColumnMenuLayout.rowSpacing) {
                ForEach(controller.rows) { row in
                    DataTableColumnMenuRowView(
                        row: row,
                        toggleable: controller.toggleable,
                        reorderable: controller.reorderable,
                        onToggle: { controller.toggle(row.key) },
                        onMoveUp: { controller.moveUp(row.key) },
                        onMoveDown: { controller.moveDown(row.key) }
                    )
                }
            }
            ViewThatFits(in: .vertical) {
                stack
                ScrollView { stack }
            }
            .frame(maxHeight: DataTableColumnMenuLayout.listMaxHeight)
        }
    }
}

// MARK: - DataTableColumnMenuHeader (web heading + "Reset")

/// The panel header — the native peer of the web heading `<span>` + the "Reset" `<button>`: the uppercase
/// muted heading on the leading edge and the accent reset control (a counter-clockwise glyph + "Reset") on
/// the trailing edge. Tapping reset reverts to the table's source-defined defaults (web `onReset`) and keeps
/// the menu open. The glyph is decorative; the reset control is one VoiceOver button named "Reset".
struct DataTableColumnMenuHeader: View {
    let heading: String
    let onReset: () -> Void

    var body: some View {
        HStack(spacing: DataTableColumnMenuLayout.rowContentGap) {
            Text(verbatim: heading)
                .font(.system(size: DataTableColumnMenuLayout.headingFontSize, weight: .medium))
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: onReset) {
                HStack(spacing: DataTableColumnMenuLayout.stepButtonGap) {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.system(size: DataTableColumnMenuLayout.resetIconSide, weight: .semibold))
                        .accessibilityHidden(true)
                    Text(verbatim: DataTableColumnMenuStrings.reset)
                        .font(.system(size: DataTableColumnMenuLayout.headingFontSize, weight: .medium))
                }
                .foregroundStyle(Color.TS.accent)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: DataTableColumnMenuStrings.reset))
        }
        .padding(.horizontal, DataTableColumnMenuLayout.rowPaddingV)
    }
}

// MARK: - DataTableColumnMenuRowView (web `<li>`)

/// One column row — the native peer of the web `<li>`: an optional leading visibility checkbox (web `<input
/// type=checkbox>`, shown when `toggleable`), the column header label (web `col.header || col.key`), and the
/// optional trailing ↑ / ↓ reorder buttons (shown when `reorderable`). The checkbox is disabled for a
/// required column or the last visible column (web `checkboxDisabled`); each step button is disabled at the
/// matching end of the order (web `upDisabled` / `downDisabled`). The checkbox is one VoiceOver checkbox
/// named "Show or hide {{col}}"; the step buttons are named "Move {{col}} up / down"; the label is plain
/// text.
struct DataTableColumnMenuRowView: View {
    let row: ColumnMenuRow
    let toggleable: Bool
    let reorderable: Bool
    let onToggle: () -> Void
    let onMoveUp: () -> Void
    let onMoveDown: () -> Void

    var body: some View {
        HStack(spacing: DataTableColumnMenuLayout.rowContentGap) {
            if toggleable {
                checkbox
            }
            Text(verbatim: row.label)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            if reorderable {
                stepButtons
            }
        }
        .padding(.horizontal, DataTableColumnMenuLayout.rowPaddingH)
        .padding(.vertical, DataTableColumnMenuLayout.rowPaddingV)
        .frame(minHeight: DataTableColumnMenuLayout.rowMinHeight)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private var checkbox: some View {
        Toggle(isOn: Binding(get: { row.isVisible }, set: { _ in onToggle() })) {
            EmptyView()
        }
        .toggleStyle(ColumnVisibilityToggleStyle())
        .labelsHidden()
        .disabled(row.toggleDisabled)
        .accessibilityLabel(Text(verbatim: DataTableColumnMenuStrings.toggleColumn(row.label)))
    }

    private var stepButtons: some View {
        HStack(spacing: DataTableColumnMenuLayout.stepButtonGap) {
            DataTableColumnMenuStepButton(
                systemImage: "arrow.up",
                label: DataTableColumnMenuStrings.moveUp(row.label),
                isEnabled: row.canMoveUp,
                action: onMoveUp
            )
            DataTableColumnMenuStepButton(
                systemImage: "arrow.down",
                label: DataTableColumnMenuStrings.moveDown(row.label),
                isEnabled: row.canMoveDown,
                action: onMoveDown
            )
        }
    }
}

// MARK: - DataTableColumnMenuStepButton (web ↑ / ↓ button)

/// One reorder step button — the native peer of the web ↑ / ↓ `<button>`: a single SF Symbol arrow that
/// moves the column one slot, disabled (and dimmed) at the matching end of the order (web `disabled`). The
/// glyph is decorative; the button is named by the move label (web `aria-label`).
struct DataTableColumnMenuStepButton: View {
    let systemImage: String
    let label: String
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: DataTableColumnMenuLayout.iconSide, weight: .semibold))
                .foregroundStyle(isEnabled ? Color.TS.textMuted : Color.TS.textMuted.opacity(0.3))
                .frame(
                    width: DataTableColumnMenuLayout.stepButtonSide,
                    height: DataTableColumnMenuLayout.stepButtonSide
                )
                .contentShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - ColumnVisibilityToggleStyle (web `<input type=checkbox>`)

/// A HIG checkbox toggle style — the native peer of the web `<input type=checkbox>`: a filled accent
/// checkmark box when on, a muted empty box when off, dimmed when disabled. Keeps the Toggle's VoiceOver
/// checkbox semantics (it announces checked / unchecked) while rendering the brand-tinted box.
struct ColumnVisibilityToggleStyle: ToggleStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
            .font(.system(size: DataTableColumnMenuLayout.checkboxSide, weight: .regular))
            .foregroundStyle(configuration.isOn ? Color.TS.accent : Color.TS.textMuted)
            .opacity(isEnabled ? 1 : 0.4)
            .contentShape(Rectangle())
            .onTapGesture { configuration.isOn.toggle() }
    }
}

// MARK: - DataTableColumnMenuEmptyView (native — never a blank box)

/// The friendly body shown when the menu is opened with no columns. The web renders an empty list; the
/// native HIG calls for a labelled empty body rather than a blank box. One combined VoiceOver element; the
/// leading glyph is decorative and hidden from assistive technology.
struct DataTableColumnMenuEmptyView: View {
    var body: some View {
        HStack(spacing: DataTableColumnMenuLayout.rowContentGap) {
            Image(systemName: "tablecells")
                .font(.system(size: 13))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: DataTableColumnMenuStrings.empty)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, DataTableColumnMenuLayout.rowPaddingH)
        .padding(.vertical, DataTableColumnMenuLayout.rowPaddingV)
        .frame(minHeight: DataTableColumnMenuLayout.rowMinHeight)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
