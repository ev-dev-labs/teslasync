//
//  DigitalTwinWidget.Badges.swift
//  TeslaSync — P4 dashboard widget · 0036 · DigitalTwinWidget (Apple)
//
//  TwinBadge (icon/count badge over the shared TSBadge/TSStatusPill tokens) + TwinFlowLayout (wrapping, centered badge
//  row).
//

import SwiftUI

// MARK: - TwinBadge (icon/count specialization of the shared TSBadge/TSStatusPill)

/// A capsule status chip styled with the same design tokens as the shared
/// `TSBadge` / `TSStatusPill` (`@/components/ui`), extended with a leading SF
/// Symbol, a state dot, and a pre-localized string — which the shared badges,
/// taking only a `LocalizedStringKey`, can't express (the web row needs a lock
/// glyph + "%lld Doors Open" counts).
struct TwinBadge: View {
    let tone: TSTone
    let label: String
    var systemImage: String?
    var showsDot: Bool = false

    var body: some View {
        HStack(spacing: 4) {
            if showsDot {
                Circle().fill(tone.color).frame(width: 6, height: 6)
            }
            if let systemImage {
                Image(systemName: systemImage).font(.system(size: 9, weight: .semibold))
            }
            Text(verbatim: label).font(Font.TS.caption).fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - TwinFlowLayout (wrapping, centered badge row — web `flex-wrap justify-center`)

/// A wrapping flow layout that center-aligns each row, reproducing the web badge
/// row's `flex flex-wrap gap-1.5 justify-center`.
struct TwinFlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        arrange(subviews: subviews, maxWidth: proposal.width ?? .infinity).size
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        let arrangement = arrange(subviews: subviews, maxWidth: bounds.width)
        for index in subviews.indices {
            let frame = arrangement.frames[index]
            subviews[index].place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                anchor: .topLeading,
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    private func arrange(subviews: Subviews, maxWidth: CGFloat) -> (size: CGSize, frames: [CGRect]) {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        var frames = [CGRect](repeating: .zero, count: subviews.count)
        var rowStart = 0
        var cursorX: CGFloat = 0
        var cursorY: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0

        func centerRow(end: Int) {
            let rowWidth = max(0, cursorX - spacing)
            let offset = maxWidth.isFinite ? max(0, (maxWidth - rowWidth) / 2) : 0
            for index in rowStart ..< end {
                frames[index].origin.x += offset
            }
            widest = max(widest, rowWidth)
        }

        for index in subviews.indices {
            let itemSize = sizes[index]
            if cursorX > 0, cursorX + itemSize.width > maxWidth {
                centerRow(end: index)
                cursorX = 0
                cursorY += rowHeight + spacing
                rowHeight = 0
                rowStart = index
            }
            frames[index] = CGRect(x: cursorX, y: cursorY, width: itemSize.width, height: itemSize.height)
            cursorX += itemSize.width + spacing
            rowHeight = max(rowHeight, itemSize.height)
        }
        centerRow(end: subviews.count)
        let width = maxWidth.isFinite ? maxWidth : widest
        return (CGSize(width: width, height: cursorY + rowHeight), frames)
    }
}
