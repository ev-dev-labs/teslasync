//
//  TagInput.Views.swift
//  TeslaSync — P4 shared surface · 0160 · TagInput (Apple)
//
//  The presentational pieces of the tag chip input — the native peers of the web elements: the
//  production announcer (the web `useAnnouncer` polite live region), the wrapping flow layout for the chip
//  strip (web `flex flex-wrap gap-1.5`), one tag chip (web chip span + its remove button), the editable
//  field (the web `<input>` plus the chip strip, wrapped in the field chrome with focus-to-edit /
//  commit-on-blur / Enter-commit / Backspace-removes-last), the labelled "ready" body (label + count, the
//  always-present empty hint, the validation / cap helper line), and the freshness chip (P4 connectivity
//  axis). All chrome is token-driven (P1/S9); no raw hex, no Tailwind ports. Decorative glyphs are hidden
//  from VoiceOver; each chip's remove button carries the explicit "Remove {tag}" label; the field's
//  VoiceOver label folds in the live tags enumeration (web hidden `aria-describedby` list).
//

import SwiftUI

// MARK: - Production announcer (posts a real polite announcement)

/// Posts the announcement to the assistive technology via SwiftUI's `AccessibilityNotification`
/// `.Announcement` at `.default` (polite) speech priority — the native parity of the web `announce(...)`
/// `aria-live="polite"` region that the field writes add / remove / duplicate / cap messages into.
@MainActor
public struct LiveTagInputAnnouncer: TagInputAnnouncer {
    public init() {}

    public func announce(_ message: String) {
        guard !message.isEmpty else { return }
        var attributed = AttributedString(message)
        attributed.accessibilitySpeechAnnouncementPriority = .default
        AccessibilityNotification.Announcement(attributed).post()
    }
}

// MARK: - Flow layout (web `flex flex-wrap items-center gap-1.5`)

/// A lightweight wrapping layout — chips flow left-to-right and wrap to the next line, leading-aligned,
/// the Apple-idiomatic shape for the web `flex flex-wrap` strip. Owned by this surface (a small,
/// self-contained primitive) so it stays within the prompt's file scope.
struct TagInputFlowLayout: Layout {
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

// MARK: - Field chrome (web `Input` surface + hairline border)

/// The token-driven field surface — the native parity of the web field chrome (rounded surface with a
/// hairline border that turns danger-red on a validation error), kept local because the shared
/// `TSTextField` chrome modifier is private.
private struct TagInputFieldChrome: ViewModifier {
    let hasError: Bool

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(hasError ? Color.TS.statusDanger : Color.TS.border, lineWidth: 1)
            )
    }
}

// MARK: - Tag chip (web chip span + remove button)

/// One tag chip — a capsule with the tag text and a trailing × remove button. The text is truncated to
/// one line (web `truncate`); the × is a separate button with the explicit "Remove {tag}" VoiceOver label
/// (web `aria-label`) and is disabled when the field's chip removal is disabled (web `disabled`).
struct TagInputChip: View {
    let tag: String
    let removeLabel: String
    var disabled = false
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: tag)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            removeButton
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface.opacity(0.5), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .contain)
    }

    private var removeButton: some View {
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
}

// MARK: - Editable field (web `<input>` + chip strip + focus / commit behaviour)

/// The field surface — the chip strip (when populated) over the typing field, wrapped in the bordered
/// chrome. Tapping the surface focuses the field; losing focus commits any pending text (web `onBlur`);
/// Enter commits (web Enter); Backspace at the empty field removes the trailing chip (web Backspace).
/// Typing or pasting a separator commits up to the last separator and keeps the remainder (web
/// `handleInputChange`). The field carries the web label folded with the live tags enumeration.
struct TagInputFieldEditor: View {
    @Bindable var model: TagInputModel
    let resolved: TagInputResolved
    @FocusState private var isFocused: Bool

    private var prompt: String {
        resolved.atMax ? TagInputStrings.maxReached : (resolved.customPrompt ?? TagInputStrings.prompt)
    }

    private var fieldLabel: String {
        TagInputEngine.fieldAccessibilityLabel(
            label: resolved.label,
            summary: TagInputStrings.tagsSummary(resolved.tags)
        )
    }

    private var textBinding: Binding<String> {
        Binding(get: { model.editingText }, set: { model.updatePending($0) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if !resolved.tags.isEmpty {
                chipStrip
            }
            field
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(TagInputFieldChrome(hasError: model.errorText != nil))
        .contentShape(Rectangle())
        .onTapGesture {
            if !resolved.isDisabled { isFocused = true }
        }
        .onChange(of: isFocused) { _, focused in
            if !focused { model.commitPendingIfNeeded() }
        }
    }

    private var chipStrip: some View {
        TagInputFlowLayout {
            ForEach(Array(resolved.tags.enumerated()), id: \.offset) { index, tag in
                TagInputChip(
                    tag: tag,
                    removeLabel: TagInputStrings.removeTag(tag),
                    disabled: resolved.chipsDisabled
                ) {
                    model.removeTag(at: index)
                }
            }
        }
    }

    private var field: some View {
        let editor = TextField(text: textBinding, prompt: Text(verbatim: prompt)) {
            Text(verbatim: resolved.label)
        }
        .textFieldStyle(.plain)
        .font(Font.TS.body)
        .labelsHidden()
        .focused($isFocused)
        .disabled(resolved.isDisabled)
        .autocorrectionDisabled(true)
        .frame(minWidth: CGFloat(TagInputMeta.minFieldCharacters) * 9, alignment: .leading)
        .onSubmit { model.submit() }
        .onKeyPress(.delete) {
            guard model.editingText.isEmpty else { return .ignored }
            model.backspaceAtStart()
            return .handled
        }
        .accessibilityLabel(Text(verbatim: fieldLabel))
        .accessibilityValue(Text(verbatim: model.editingText))

        #if os(iOS)
            return editor.textInputAutocapitalization(.never)
        #else
            return editor
        #endif
    }
}

// MARK: - Ready body (label + field + helper, never a blank box)

/// The `ready` render — the (always-present) labelled field. The label shows the web `({count}/{max})`
/// suffix when capped; the field renders whether empty or populated; and a helper line beneath shows the
/// validation error (red), else the cap hint when full, else the caller hint, else the friendly "No tags
/// yet" empty hint — so the surface is never a blank box. Wrapped in the shared fade-in for entrance
/// polish.
struct TagInputReadyView: View {
    @Bindable var model: TagInputModel
    let resolved: TagInputResolved

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                if !resolved.hideLabel {
                    label
                }
                TagInputFieldEditor(model: model, resolved: resolved)
                footer
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
        }
    }

    private var label: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: resolved.label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            if let countText = resolved.countText {
                Text(verbatim: "(\(countText))")
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var footer: some View {
        if let error = model.errorText {
            helperLine(error, color: Color.TS.statusDanger)
        } else if resolved.atMax {
            helperLine(TagInputStrings.maxReachedHint(resolved.maxTags ?? 0), color: Color.TS.textSecondary)
        } else if let hint = resolved.hint, !hint.isEmpty {
            helperLine(hint, color: Color.TS.textSecondary)
        } else if resolved.isEmpty {
            helperLine(TagInputStrings.tagsNone, color: Color.TS.textMuted)
        }
    }

    private func helperLine(_ text: String, color: Color) -> some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(color)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the field when the feed is not live — a colored dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the snapshot, with
/// an explicit label.
struct TagInputFreshnessChip: View {
    let connection: TagInputConnection
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
        case .live: TagInputStrings.live
        case .stale: TagInputStrings.stale
        case .offline: TagInputStrings.offline
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live: label
        case .stale: TagInputStrings.staleA11y
        case .offline: TagInputStrings.offlineA11y
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
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}
