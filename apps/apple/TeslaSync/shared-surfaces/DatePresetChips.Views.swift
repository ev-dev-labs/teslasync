//
//  DatePresetChips.Views.swift
//  TeslaSync — P4 shared surface · 0151 · DatePresetChips (Apple)
//
//  The presentational pieces of the quick-select chip row — the native peers of the web elements: the
//  wrapping flow layout (web `flex flex-wrap items-center gap-1`), one preset chip (web `<Button variant
//  size>` — primary when active, ghost otherwise), and the friendly empty-state view (web renders an empty
//  group; the native HIG calls for a labelled empty state, never a bare box). Every chip is the shared
//  ``TSButton`` (the native peer of the web `@/components/ui/Button`); all chrome is token-driven (P1/S9); no
//  raw hex, no Tailwind ports. The active chip carries the selected trait (web `aria-pressed`).
//

import SwiftUI

// MARK: - Row (web `flex flex-wrap` of chips)

/// The chip row — the preset chips laid out in a wrapping flow (web `flex flex-wrap items-center gap-1`),
/// wrapping to the next line instead of clipping so it survives Dynamic Type and narrow widths.
struct DatePresetChipsRow: View {
    let chips: [DatePresetChipsChip]
    let size: DatePresetChipsSize
    let onSelect: (String) -> Void

    var body: some View {
        DatePresetChipsFlowLayout {
            ForEach(chips) { chip in
                DatePresetChipView(chip: chip, size: size) { onSelect(chip.id) }
            }
        }
    }
}

// MARK: - Chip (web `<Button variant size>`)

/// One preset chip — the shared ``TSButton`` carrying the i18n'd preset label (web `t(p.i18nKey,
/// p.fallback)`). Active chips render `primary` (filled) and ghost otherwise (web `variant={active ?
/// 'primary' : 'ghost'}`); the active chip also carries the selected trait (web `aria-pressed={active}`). The
/// explicit accessibility label keeps the spoken name stable across the variant swap.
struct DatePresetChipView: View {
    let chip: DatePresetChipsChip
    let size: DatePresetChipsSize
    let onTap: () -> Void

    private var label: String {
        DatePresetChipsStrings.label(key: chip.i18nKey, fallback: chip.fallback)
    }

    private var buttonSize: TSButtonSize {
        size == .medium ? .medium : .small
    }

    var body: some View {
        TSButton(
            variant: chip.isActive ? .primary : .ghost,
            size: buttonSize,
            action: onTap
        ) {
            Text(verbatim: label)
        }
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(chip.isActive ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Empty state (native — never a blank box)

/// The friendly empty-state view shown when `presetIds` resolves to zero known presets. The web renders an
/// empty `role="group"` div; the native HIG calls for a labelled empty state rather than a bare box.
struct DatePresetChipsEmptyView: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "calendar.badge.exclamationmark")
                .font(.system(size: 12))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: DatePresetChipsStrings.empty)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Flow layout (web `flex flex-wrap items-center gap-1`)

/// A lightweight wrapping layout — chips flow left-to-right and wrap to the next line, leading-aligned, the
/// Apple-idiomatic shape for the web `flex flex-wrap` row versus a single clipped line. Owned by this surface
/// (a small, self-contained primitive) so it stays within the prompt's file scope. The `gap-1` web gap maps
/// to ``TSSpacing/xs`` on both axes.
struct DatePresetChipsFlowLayout: Layout {
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
