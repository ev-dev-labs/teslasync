//
//  ActiveFilterChips.Views.swift
//  TeslaSync — P4 shared surface · 0147 · ActiveFilterChips (Apple)
//
//  The presentational pieces of the active-filter chip strip — the native peers of the web elements: the
//  wrapping flow layout (web `flex flex-wrap`), one chip (web `<Chip>` — the "label: value ×" capsule),
//  the "+N more" overflow trigger + its popover (web `role="menu"`), the "Clear all" affordance, the
//  friendly empty placeholder, and the production announcer that posts a real polite announcement. All
//  chrome is token-driven (P1/S9); no raw hex, no Tailwind ports. Decorative glyphs are hidden from
//  VoiceOver; each chip's remove button carries the explicit "Remove filter {label}" label and removes on
//  tap AND on Delete / Backspace (web `handleChipKey`).
//

import SwiftUI

// MARK: - Production announcer (posts a real polite announcement)

/// Posts the announcement to the assistive technology via SwiftUI's
/// `AccessibilityNotification.Announcement` at `.default` (polite) speech priority — the native parity of
/// the web `<VisuallyHidden liveRegion>` `aria-live="polite"` region the chip strip writes removals into.
@MainActor
public struct LiveActiveFilterChipsAnnouncer: ActiveFilterChipsAnnouncer {
    public init() {}

    public func announce(_ message: String) {
        guard !message.isEmpty else { return }
        var attributed = AttributedString(message)
        attributed.accessibilitySpeechAnnouncementPriority = .default
        AccessibilityNotification.Announcement(attributed).post()
    }
}

// MARK: - Flow layout (web `flex flex-wrap items-center gap-2`)

/// A lightweight wrapping layout — chips flow left-to-right and wrap to the next line, leading-aligned, the
/// Apple-idiomatic shape for the web `flex flex-wrap` row versus a single clipped line. Owned by this
/// surface (a small, self-contained primitive) so it stays within the prompt's file scope.
struct ActiveFilterChipsFlowLayout: Layout {
    var horizontalSpacing: CGFloat = TSSpacing.sm
    var verticalSpacing: CGFloat = TSSpacing.sm

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

// MARK: - Chip (web `<Chip>`)

/// One filter chip — the "label: value ×" capsule (web `<Chip>`). The label/value text is one VoiceOver
/// element; the trailing × is a separate button with the explicit remove label that also fires on Delete /
/// Backspace (web `onKeyDown` → `handleChipKey`). `fullWidth` is the web popover variant (`w-full
/// justify-between`).
struct FilterChipView: View {
    let descriptor: FilterChipDescriptor
    let removeLabel: String
    var fullWidth = false
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            labelValue
                .frame(maxWidth: fullWidth ? .infinity : nil, alignment: .leading)
            removeButton
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .frame(maxWidth: fullWidth ? .infinity : nil, alignment: .leading)
        .background(Color.TS.surface.opacity(0.5), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .contain)
    }

    private var labelValue: some View {
        (
            Text(verbatim: "\(descriptor.label): ").foregroundColor(Color.TS.textMuted)
                + Text(verbatim: descriptor.value).foregroundColor(Color.TS.textPrimary)
        )
        .font(Font.TS.caption)
        .fontWeight(.medium)
        .lineLimit(1)
        .truncationMode(.tail)
        .accessibilityLabel(Text(verbatim: "\(descriptor.label): \(descriptor.value)"))
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
        .accessibilityLabel(Text(verbatim: removeLabel))
        .onKeyPress(.delete) {
            onRemove()
            return .handled
        }
        .onKeyPress(.deleteForward) {
            onRemove()
            return .handled
        }
    }
}

// MARK: - Overflow trigger + popover (web "+N more" + `role="menu"`)

/// The "+N more" trigger — a capsule button that toggles the overflow popover (web `aria-haspopup="menu"`).
/// The popover lists the collapsed chips, each removable, in a container labelled "Additional active
/// filters" (web popover `aria-label`).
struct ActiveFilterChipsOverflowControl: View {
    let model: ActiveFilterChipsModel
    let overflow: [FilterChipDescriptor]

    private var isOpen: Binding<Bool> {
        Binding(get: { model.overflowOpen }, set: { model.setOverflowOpen($0) })
    }

    var body: some View {
        Button { model.toggleOverflow() } label: {
            Text(verbatim: ActiveFilterChipsStrings.moreCount(overflow.count))
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.surface.opacity(0.5), in: Capsule())
                .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .popover(isPresented: isOpen) {
            popoverBody.presentationCompactAdaptation(.popover)
        }
    }

    private var popoverBody: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ForEach(overflow) { descriptor in
                FilterChipView(
                    descriptor: descriptor,
                    removeLabel: ActiveFilterChipsStrings.removeAria(label: descriptor.label),
                    fullWidth: true
                ) { model.remove(descriptor) }
            }
        }
        .padding(TSSpacing.sm)
        .frame(minWidth: 200, maxWidth: 320, alignment: .leading)
        .background(Color.TS.surface)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: ActiveFilterChipsStrings.moreLabel))
    }
}

// MARK: - Clear all (web "Clear all")

/// The "Clear all" affordance — a plain text button that clears every filter (web `onClearAll`).
struct ActiveFilterChipsClearAllButton: View {
    let model: ActiveFilterChipsModel

    var body: some View {
        Button { model.clearAll() } label: {
            Text(verbatim: ActiveFilterChipsStrings.clearAll)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Empty placeholder (native — never a blank box)

/// The friendly placeholder shown in the (kept) empty group when `hideWhenEmpty == false`. The web renders
/// an empty group; the native HIG calls for a labelled placeholder rather than a bare box.
struct ActiveFilterChipsEmptyView: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "line.3.horizontal.decrease.circle")
                .font(.system(size: 12))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: ActiveFilterChipsStrings.empty)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
    }
}
