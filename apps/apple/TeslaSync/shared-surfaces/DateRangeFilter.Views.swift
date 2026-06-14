//
//  DateRangeFilter.Views.swift
//  TeslaSync — P4 shared surface · 0152 · DateRangeFilter (Apple)
//
//  The presentational pieces of the inline date-range filter — the native peers of the web elements: the
//  date-range field (web pill `flex items-center gap-2 rounded-lg bg-white/[0.04] … ring-1`: a calendar glyph,
//  a start `<input type="date">`, an arrow, an end `<input type="date">`), the Apply action (web `<Button
//  size="sm" variant="primary">`), and the wrapping flow that lays the field, the button, and the composed
//  preset row out left-to-right and wraps under narrow widths (web top-level `flex flex-wrap items-center
//  gap-2`). The date fields are native `DatePicker`s (HIG-idiomatic) and the Apply control is the shared
//  ``TSButton`` (the native peer of `@/components/ui/Button`); all chrome is token-driven (P1/S9) — no raw hex,
//  no Tailwind ports.
//

import SwiftUI

// MARK: - Field (web date pill)

/// The date-range field — a calendar glyph, the start `DatePicker`, an arrow, and the end `DatePicker`, in a
/// token-driven rounded, stroked surface (web `rounded-lg bg-white/[0.04] ring-1 ring-white/[0.08]`). The
/// pickers are HIG-native and label-hidden, each carrying its explicit accessibility name (web `aria-label`);
/// the glyph and the arrow are decorative and hidden from VoiceOver.
struct DateRangeFilterField: View {
    @Binding var start: Date
    @Binding var end: Date
    let startLabel: String
    let endLabel: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "calendar")
                .font(.system(size: 12))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            DatePicker("", selection: $start, displayedComponents: .date)
                .labelsHidden()
                .datePickerStyle(.compact)
                .accessibilityLabel(Text(verbatim: startLabel))
            Text(verbatim: "→")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            DatePicker("", selection: $end, displayedComponents: .date)
                .labelsHidden()
                .datePickerStyle(.compact)
                .accessibilityLabel(Text(verbatim: endLabel))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Apply action (web `<Button size="sm" variant="primary">`)

/// The Apply action — the shared ``TSButton`` carrying the i18n'd title (web `t('date.range.apply',
/// 'Apply')`), rendered only when the page supplies an `onApply` (the surface gates it on
/// ``DateRangeFilterProjection/showApply``). The explicit accessibility label keeps the spoken name stable.
struct DateRangeFilterApplyButton: View {
    let title: String
    let action: () -> Void

    var body: some View {
        TSButton(variant: .primary, size: .small, action: action) {
            Text(verbatim: title)
        }
        .accessibilityLabel(Text(verbatim: title))
    }
}

// MARK: - Flow layout (web top-level `flex flex-wrap items-center gap-2`)

/// A lightweight wrapping layout — the field, the Apply button, and the preset row flow left-to-right and wrap
/// to the next line, leading-aligned, the Apple-idiomatic shape for the web `flex flex-wrap` container versus a
/// single clipped line. Owned by this surface (a small, self-contained primitive) so it stays within the
/// prompt's file scope. The `gap-2` web gap maps to ``TSSpacing/sm`` on both axes.
struct DateRangeFilterFlowLayout: Layout {
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
