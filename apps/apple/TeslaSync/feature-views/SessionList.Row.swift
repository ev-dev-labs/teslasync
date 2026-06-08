//
//  SessionList.Row.swift
//  TeslaSync — P4 feature view · 0222 · SessionList (Apple)
//
//  One session row + its inline rename field — the parity of the web row button
//  (`onClick` select, `onDoubleClick` rename, hover delete) and the inline `<Input>`
//  edit field (Enter saves, Esc cancels, blur saves). The active row gets a tinted
//  surface; rename + delete are also offered through a native context menu (the HIG
//  idiom for the web double-click-to-rename + hover-delete affordances). Token-driven
//  (P1/S9); copy via the P1/S10 facade.
//

import SwiftUI

// MARK: - Session row

/// A single conversation row. Tapping selects it (web `onSelect`); double-click or the
/// context menu starts an inline rename (web `onDoubleClick` → `startRename`); the
/// trailing trash button or the context menu requests deletion (web hover delete →
/// `ConfirmDialog`). While renaming, the row becomes an inline text field.
struct ChatSessionRow: View {
    @Bindable var model: ChatSessionListModel
    let item: ChatSessionListItem

    private var isActive: Bool {
        model.isActive(item)
    }

    private var isRenaming: Bool {
        model.isRenaming(item)
    }

    var body: some View {
        Group {
            if isRenaming {
                ChatSessionRenameField(model: model, item: item)
                    .padding(TSSpacing.xs)
            } else {
                selectableRow
            }
        }
        .background(rowBackground)
        .overlay(rowBorder)
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
    }

    private var selectableRow: some View {
        ZStack(alignment: .topTrailing) {
            rowButton
            deleteButton
        }
        .contextMenu { rowMenu }
    }

    private var rowButton: some View {
        Button { model.selectSession(item) } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: model.displayTitle(item))
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(isActive ? Color.TS.accent : Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(verbatim: model.subtitle(item))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, TSSpacing.sm)
            .padding(.leading, TSSpacing.md)
            .padding(.trailing, TSSpacing.x3xl)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .simultaneousGesture(TapGesture(count: 2).onEnded { model.startRename(item) })
        .help(ChatSessionListStrings.text("chatbot.aria.doubleClickRename", "Double-click to rename"))
        .accessibilityLabel(Text(verbatim: model.rowAccessibilityLabel(item)))
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
    }

    private var deleteButton: some View {
        Button { model.requestDelete(item) } label: {
            Image(systemName: "trash")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .padding(TSSpacing.xs)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(TSSpacing.xs)
        .accessibilityLabel(ChatSessionListStrings.text("chatbot.aria.deleteSession", "Delete conversation"))
        .help(ChatSessionListStrings.text("chatbot.aria.deleteSession", "Delete conversation"))
    }

    @ViewBuilder
    private var rowMenu: some View {
        Button { model.startRename(item) } label: {
            Label {
                ChatSessionListStrings.text("chatbot.aria.renameSession", "Rename conversation")
            } icon: {
                Image(systemName: "pencil")
            }
        }
        Button(role: .destructive) { model.requestDelete(item) } label: {
            Label {
                ChatSessionListStrings.text("chatbot.aria.deleteSession", "Delete conversation")
            } icon: {
                Image(systemName: "trash")
            }
        }
    }

    private var rowBackground: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .fill(isActive ? Color.TS.accent.opacity(0.12) : Color.clear)
    }

    private var rowBorder: some View {
        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            .strokeBorder(isActive ? Color.TS.accent.opacity(0.35) : Color.clear, lineWidth: 1)
    }
}

// MARK: - Inline rename field (web inline `<Input>`)

/// The inline rename editor shown in place of a row while it is being renamed. Enter
/// saves, Esc cancels, losing focus saves — the parity of the web `<Input>` with
/// `onKeyDown` (Enter / Escape) + `onBlur` commit, auto-focused on appear.
struct ChatSessionRenameField: View {
    @Bindable var model: ChatSessionListModel
    let item: ChatSessionListItem
    @FocusState private var focused: Bool

    var body: some View {
        TextField("", text: $model.renameDraft)
            .textFieldStyle(.plain)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textPrimary)
            .focused($focused)
            .submitLabel(.done)
            .onSubmit { model.commitRename() }
            .onExitCommand { model.cancelRename() }
            .onChange(of: focused) { _, isFocused in
                if !isFocused { model.commitRename() }
            }
            .onAppear { focused = true }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.accent.opacity(0.4), lineWidth: 1)
            )
            .accessibilityLabel(
                ChatSessionListStrings.text("chatbot.aria.renameSession", "Rename conversation")
            )
    }
}
