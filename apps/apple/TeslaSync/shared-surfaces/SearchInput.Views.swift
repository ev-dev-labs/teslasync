//
//  SearchInput.Views.swift
//  TeslaSync — P4 shared surface · 0158 · SearchInput (Apple)
//
//  The presentational pieces of the debounced search field — the native peers of the web elements: the
//  field row (web `Input` with its leading `icon` magnifier slot + trailing `suffix` clear button), the
//  floating recent-searches dropdown (web `absolute … popover` — the heading, the scrolling listbox, and
//  the clear-all footer), one recent-search row (web `<li>` — the select button + the remove button), the
//  friendly empty-history leaf (the native "never a blank box" peer of a scope with no entries), and the
//  reveal animation that honors Reduce Motion. All chrome is token-driven (P1/S9); no raw hex, no Tailwind
//  ports. Decorative glyphs are hidden from VoiceOver; the field carries an explicit label / value / hint,
//  each row carries the explicit "Remove …" label + a select hint, and the highlighted row exposes the
//  `isSelected` trait (the spoken peer of the web `aria-selected`).
//

import SwiftUI

// MARK: - Reveal motion (web popover entrance + `transition-transform`)

/// Builds the dropdown reveal animation + transition — the native boundary that turns the web popover's
/// appearance into a single token-driven `Animation`. Returns `nil` under reduced motion so the dropdown
/// snaps in/out with no movement. The duration is the design system's `fast` motion token (P1/S9).
public enum SearchInputMotion {
    /// The reveal animation, or `nil` when reduced motion is in effect.
    public static func reveal(reduce: Bool) -> Animation? {
        guard !reduce else { return nil }
        return .easeOut(duration: TSMotion.fastDuration)
    }

    /// The dropdown enter/exit transition — a soft fade + downward slide from the field edge.
    public static var dropdownTransition: AnyTransition {
        .opacity.combined(with: .move(edge: .top))
    }
}

// MARK: - Field row (web `Input` + icon + clear suffix)

/// The field surface — the native peer of the web shared `<Input type="search">`: a leading magnifier (web
/// `icon`), the debounced text field (binding into the holder's buffered `local`), and the trailing clear
/// button (web `suffix={local ? <clear/> : undefined}`). Submitting fires the holder's Enter rule; the
/// arrow + escape keys drive the recent-searches dropdown when one is open. Wrapped in the token-driven
/// field chrome (rounded surface + hairline border).
struct SearchInputField: View {
    @Bindable var model: SearchInputModel
    var focus: FocusState<Bool>.Binding
    let prompt: String
    let clearLabel: String
    let fieldLabel: String
    let fieldHint: String?

    private var textBinding: Binding<String> {
        Binding(get: { model.local }, set: { model.setLocal($0) })
    }

    private var promptText: Text? {
        prompt.isEmpty ? nil : Text(verbatim: prompt)
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            field
            if model.projection.showsClearButton {
                clearButton
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }

    private var field: some View {
        let editor = TextField(text: textBinding, prompt: promptText) {
            Text(verbatim: fieldLabel)
        }
        .textFieldStyle(.plain)
        .labelsHidden()
        .focused(focus)
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textPrimary)
        .submitLabel(.search)
        .autocorrectionDisabled(true)
        .onSubmit { model.submit() }
        .onKeyPress(.downArrow) { handleArrowDown() }
        .onKeyPress(.upArrow) { handleArrowUp() }
        .onKeyPress(.escape) { handleEscape() }
        .accessibilityLabel(Text(verbatim: fieldLabel))
        .accessibilityValue(Text(verbatim: model.local))
        .accessibilityHint(hintText)

        #if os(iOS)
            return editor.textInputAutocapitalization(.never)
        #else
            return editor
        #endif
    }

    private var hintText: Text {
        guard let fieldHint, !fieldHint.isEmpty else { return Text(verbatim: "") }
        return Text(verbatim: fieldHint)
    }

    private var clearButton: some View {
        Button {
            model.clear()
        } label: {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 15))
                .foregroundStyle(Color.TS.textMuted)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: clearLabel))
    }

    private func handleArrowDown() -> KeyPress.Result {
        guard model.projection.dropdownVisible else { return .ignored }
        model.moveActiveDown()
        return .handled
    }

    private func handleArrowUp() -> KeyPress.Result {
        guard model.projection.dropdownVisible else { return .ignored }
        model.moveActiveUp()
        return .handled
    }

    private func handleEscape() -> KeyPress.Result {
        guard model.projection.dropdownVisible else { return .ignored }
        model.escape()
        return .handled
    }
}

// MARK: - Recent-searches dropdown (web `absolute … popover`)

/// The floating recent-searches popover — the heading (web uppercase `Recent searches`), the scrolling
/// listbox of rows, and the clear-all footer (web bottom-bordered `Clear history`). When the scope somehow
/// resolves to no rows it shows the friendly empty leaf rather than a bare box (native "never a blank box";
/// the web simply renders no popover). Token-driven chrome with a soft elevation shadow.
struct SearchInputHistoryDropdown: View {
    @Bindable var model: SearchInputModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            heading
            content
            footer
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.18), radius: 12, x: 0, y: 6)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: SearchInputStrings.historyTitle))
    }

    private var heading: some View {
        Text(verbatim: SearchInputStrings.historyTitle)
            .font(Font.TS.label)
            .textCase(.uppercase)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var content: some View {
        if model.entries.isEmpty {
            SearchInputHistoryEmpty(
                title: SearchInputStrings.emptyTitle,
                message: SearchInputStrings.emptyMessage
            )
            .padding(.horizontal, TSSpacing.md)
        } else {
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(Array(model.entries.enumerated()), id: \.offset) { index, entry in
                        SearchInputHistoryRow(
                            text: entry,
                            isActive: index == model.activeIndex,
                            selectHint: SearchInputStrings.selectHint,
                            removeLabel: SearchInputStrings.removeAria(entry),
                            onSelect: { model.selectEntry(entry) },
                            onRemove: { model.removeEntry(entry) },
                            onHover: { hovering in model.highlight(hovering ? index : nil) }
                        )
                    }
                }
            }
            .frame(maxHeight: 256)
        }
    }

    private var footer: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(Color.TS.border)
                .frame(height: 1)
            Button {
                model.clearAll()
            } label: {
                Text(verbatim: SearchInputStrings.clearHistory)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.sm)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }
}

// MARK: - Recent-search row (web `<li>` select + remove)

/// One recent-search row — a select button (magnifier + truncated query) beside a remove button. The whole
/// row tints when keyboard- or pointer-highlighted (web `aria-selected` / `onMouseEnter`) and exposes the
/// `isSelected` trait to VoiceOver; the select button carries the query as its label + a select hint, and
/// the remove button carries the explicit "Remove …" label.
struct SearchInputHistoryRow: View {
    let text: String
    let isActive: Bool
    let selectHint: String
    let removeLabel: String
    let onSelect: () -> Void
    let onRemove: () -> Void
    var onHover: (Bool) -> Void = { _ in }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            selectButton
            removeButton
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(isActive ? Color.TS.textPrimary.opacity(0.06) : Color.clear)
        .contentShape(Rectangle())
        .onHover { onHover($0) }
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }

    private var selectButton: some View {
        Button(action: onSelect) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: text)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: text))
        .accessibilityHint(Text(verbatim: selectHint))
    }

    private var removeButton: some View {
        Button(action: onRemove) {
            Image(systemName: "xmark")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: removeLabel))
    }
}

// MARK: - Empty-history leaf (native — never a blank box)

/// The friendly leaf shown when a history-enabled dropdown resolves to no rows — a labelled card rather
/// than a bare box (native HIG). The web simply renders no popover when the scope is empty; the native peer
/// states the condition so a host that always reveals the popover never sees an unexplained empty space.
/// Token-driven (P1/S9); copy via the P1/S10 facade; combined into a single VoiceOver element.
struct SearchInputHistoryEmpty: View {
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(title). \(message)"))
    }
}
