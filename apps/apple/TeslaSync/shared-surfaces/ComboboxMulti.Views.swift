//
//  ComboboxMulti.Views.swift
//  TeslaSync — P4 shared surface · 0149 · ComboboxMulti (Apple)
//
//  The field-level subviews composed by `ComboboxMulti`: the visible field label with the web
//  `({count}/{max})` suffix, the wrapping flow layout for the chip strip (web `flex flex-wrap`), one
//  removable chip (web chip span + its remove button), the editable text field with its leading icon +
//  trailing inline spinner / chevron (web `<input role="combobox">` + adornments), the hardware-keyboard
//  contract (web `handleKeyDown` → `.onKeyPress`, including Backspace-removes-last), the freshness chip
//  (P4 connectivity axis), and the production polite announcer (web `useAnnouncer` live region). The
//  listbox + its rows live in `ComboboxMulti.Listbox.swift`. All chrome is token-driven (P1/S9); all
//  copy resolves through the P1/S10 facade — no raw hex, no Tailwind ports, no English literals.
//

import SwiftUI

// MARK: - Field label (web `<label>` + `({count}/{max})` suffix)

/// The visible field label (web `<label>`), shown above the field when `hideLabel` is false, with the
/// web `({value.length}/{maxItems})` count suffix when a cap is set. The field itself carries the
/// accessibility label, so this is hidden from VoiceOver to avoid a double read.
struct ComboboxMultiLabel: View {
    let text: String
    let count: Int
    let maxItems: Int?

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: text)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            if let maxItems {
                Text(verbatim: "(\(count)/\(maxItems))")
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Flow layout (web `flex flex-wrap items-center gap-1.5`)

/// A lightweight wrapping layout — chips flow left-to-right and wrap to the next line, leading-aligned,
/// the Apple-idiomatic shape for the web `flex flex-wrap` chip strip. Owned by this surface (a small,
/// self-contained primitive) so it stays within the prompt's file scope.
struct ComboboxMultiFlowLayout: Layout {
    var horizontalSpacing: CGFloat = TSSpacing.xs
    var verticalSpacing: CGFloat = TSSpacing.xs

    private struct Line {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func lines(maxWidth: CGFloat, sizes: [CGSize]) -> [Line] {
        var result: [Line] = []
        var current = Line()
        for (index, size) in sizes.enumerated() {
            let projected = current.indices.isEmpty
                ? size.width
                : current.width + horizontalSpacing + size.width
            if !current.indices.isEmpty, projected > maxWidth {
                result.append(current)
                current = Line(indices: [index], width: size.width, height: size.height)
            } else {
                current.width = projected
                current.height = max(current.height, size.height)
                current.indices.append(index)
            }
        }
        if !current.indices.isEmpty {
            result.append(current)
        }
        return result
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let maxWidth = proposal.width ?? sizes.reduce(0) { $0 + $1.width }
        let computed = lines(maxWidth: maxWidth, sizes: sizes)
        let width = computed.map(\.width).max() ?? 0
        let height = computed.reduce(0) { $0 + $1.height }
            + CGFloat(max(0, computed.count - 1)) * verticalSpacing
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let computed = lines(maxWidth: bounds.width, sizes: sizes)
        var originY = bounds.minY
        for line in computed {
            var originX = bounds.minX
            for index in line.indices {
                let size = sizes[index]
                subviews[index].place(
                    at: CGPoint(x: originX, y: originY + (line.height - size.height) / 2),
                    proposal: ProposedViewSize(size)
                )
                originX += size.width + horizontalSpacing
            }
            originY += line.height + verticalSpacing
        }
    }
}

// MARK: - Chip (web chip span + remove button)

/// One selected-option chip — a capsule with the option label and a trailing × remove button. The text
/// truncates to one line (web `truncate`); the × is a separate button with the explicit "Remove {label}"
/// VoiceOver label (web `aria-label`) and is disabled when the field is disabled (web `disabled`).
struct ComboboxMultiChip: View {
    let label: String
    let removeLabel: String
    var disabled = false
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            Button(action: onRemove) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(width: 18, height: 18)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(disabled)
            .accessibilityLabel(Text(verbatim: removeLabel))
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.accent.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.accent.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Field chrome (web `Input` surface + focus ring)

/// The token-driven field surface — the native parity of the web combobox input chrome (rounded surface
/// + hairline border, a 2pt accent ring on focus mirroring the web `focus-within:ring-2`).
private struct ComboboxMultiFieldChrome: ViewModifier {
    let focused: Bool

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(focused ? Color.TS.accent : Color.TS.border, lineWidth: focused ? 2 : 1)
            )
    }
}

// MARK: - Inline icon button (web trailing chevron)

/// A compact inline icon affordance — the native peer of the web trailing chevron button. The glyph is
/// decorative; the button carries the explicit accessibility label and an enlarged hit target.
struct ComboboxMultiIconButton: View {
    let systemName: String
    let label: String
    var rotated = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .rotationEffect(.degrees(rotated ? 180 : 0))
                .frame(width: 22, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Keyboard contract (web handleKeyDown → .onKeyPress)

/// Wires the web combobox keyboard contract onto the field for hardware keyboards (macOS / iPadOS):
/// ArrowDown / ArrowUp move the active descendant (wrapping), Home / End jump to the ends, Escape closes
/// without removing chips, and Backspace at the empty input removes the trailing chip. Enter is handled
/// by the field's `onSubmit`.
private struct ComboboxMultiKeyboardModifier: ViewModifier {
    let model: ComboboxMultiModel

    func body(content: Content) -> some View {
        content
            .onKeyPress(.downArrow) { model.moveDown(); return .handled }
            .onKeyPress(.upArrow) { model.moveUp(); return .handled }
            .onKeyPress(.home) { model.moveHome(); return .handled }
            .onKeyPress(.end) { model.moveEnd(); return .handled }
            .onKeyPress(.escape) {
                guard model.isOpen else { return .ignored }
                model.close()
                return .handled
            }
            .onKeyPress(.delete) {
                guard model.query.isEmpty, !model.selected.isEmpty else { return .ignored }
                model.removeLast()
                return .handled
            }
    }
}

// MARK: - Field (web `<input role="combobox">` + chips + adornments)

/// The editable multi-select field — the wrapping chip strip (when populated) over the typing row, all
/// inside the bordered field chrome. Each keystroke routes through `setQuery` (web `handleInputChange`);
/// gaining focus opens the list (web `onFocus`); Enter adds the highlighted option (web Enter); the
/// keyboard contract (arrows / Home / End / Escape / Backspace) is attached for hardware keyboards. The
/// trailing adornments are the inline spinner (web async indicator) + the chevron toggle.
struct ComboboxMultiField: View {
    @Bindable var model: ComboboxMultiModel
    @FocusState private var isFocused: Bool

    private var queryBinding: Binding<String> {
        Binding(get: { model.query }, set: { model.setQuery($0) })
    }

    private var promptText: Text? {
        if model.selected.isEmpty {
            guard let prompt = model.config.prompt, !prompt.isEmpty else { return nil }
            return Text(verbatim: prompt)
        }
        return model.atMax ? Text(verbatim: ComboboxMultiStrings.maxReached) : nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if !model.selected.isEmpty {
                chipStrip
            }
            typingRow
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(ComboboxMultiFieldChrome(focused: isFocused))
        .contentShape(Rectangle())
        .onTapGesture {
            if !model.config.disabled { isFocused = true }
        }
        .onChange(of: isFocused) { _, focused in
            if focused { model.open() }
        }
        .onChange(of: model.focusRequestCount) { _, _ in
            if !model.config.disabled { isFocused = true }
        }
    }

    private var chipStrip: some View {
        ComboboxMultiFlowLayout {
            ForEach(Array(model.selected.enumerated()), id: \.element.id) { _, item in
                ComboboxMultiChip(
                    label: item.label,
                    removeLabel: ComboboxMultiStrings.removeChip(item.label),
                    disabled: model.config.disabled
                ) {
                    model.remove(item)
                }
            }
        }
    }

    private var typingRow: some View {
        HStack(spacing: TSSpacing.sm) {
            if let icon = model.config.iconSystemName {
                Image(systemName: icon)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            field
            trailing
        }
    }

    private var field: some View {
        let editor = TextField(text: queryBinding, prompt: promptText) {
            Text(verbatim: model.config.label)
        }
        .textFieldStyle(.plain)
        .font(Font.TS.body)
        .labelsHidden()
        .frame(maxWidth: .infinity, alignment: .leading)
        .focused($isFocused)
        .disabled(model.config.disabled)
        .autocorrectionDisabled(true)
        .onSubmit { model.addActive() }
        .accessibilityLabel(Text(verbatim: model.config.label))
        .modifier(ComboboxMultiKeyboardModifier(model: model))

        #if os(iOS)
            return editor.textInputAutocapitalization(.never)
        #else
            return editor
        #endif
    }

    private var trailing: some View {
        HStack(spacing: TSSpacing.xs) {
            if model.effectiveLoading {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel(Text(verbatim: ComboboxMultiStrings.loading))
            }
            if !model.config.noChevron {
                ComboboxMultiIconButton(
                    systemName: "chevron.down",
                    label: model.isOpen ? ComboboxMultiStrings.closeListAria : ComboboxMultiStrings.openListAria,
                    rotated: model.isOpen
                ) {
                    model.toggleOpen()
                }
                .disabled(model.config.disabled)
            }
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the field when the feed is not live — a colored dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the options, with
/// an explicit label.
struct ComboboxMultiFreshnessChip: View {
    let connection: ComboboxMultiConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: ComboboxMultiStrings.live
        case .stale: ComboboxMultiStrings.stale
        case .offline: ComboboxMultiStrings.offline
        }
    }

    private var accessibilityText: String {
        switch connection {
        case .live: label
        case .stale: ComboboxMultiStrings.staleA11y
        case .offline: ComboboxMultiStrings.offlineA11y
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

// MARK: - Production announcer (posts a real polite announcement)

/// Posts the result-count / chip-removal announcement to the assistive technology via
/// `AccessibilityNotification.Announcement` at `.default` (polite) speech priority — the native parity
/// of the web `useAnnouncer` `aria-live="polite"` region the field writes "5 results" / "Removed {label}"
/// into.
@MainActor
public struct LiveComboboxMultiAnnouncer: ComboboxMultiAnnouncer {
    public init() {}

    public func announce(_ message: String) {
        guard !message.isEmpty else { return }
        var attributed = AttributedString(message)
        attributed.accessibilitySpeechAnnouncementPriority = .default
        AccessibilityNotification.Announcement(attributed).post()
    }
}
