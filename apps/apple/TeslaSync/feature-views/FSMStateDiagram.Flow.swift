//
//  FSMStateDiagram.Flow.swift
//  TeslaSync — P4 feature view · 0229 · FSMStateDiagram (Apple)
//
//  The wrapping flow layout for the node row and the edge-summary chips — the native
//  port of the web `flex flex-wrap items-start gap` container. Places its subviews left
//  to right, wrapping to a new line when the proposed width is exceeded; rows align to
//  the top (web `items-start`). Pure layout, no surface-specific knowledge.
//

import SwiftUI

/// Vertical alignment of items within a wrapped row.
enum FSMFlowAlignment {
    case top
    case center
    case bottom
}

/// A wrapping horizontal flow layout (web `flex flex-wrap`).
struct FSMFlowLayout: Layout {
    var horizontalSpacing: CGFloat
    var verticalSpacing: CGFloat
    var alignment: FSMFlowAlignment = .top

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        let rows = rows(maxWidth: maxWidth, subviews: subviews)
        let contentWidth = rows.map(\.width).max() ?? 0
        let height = rows.reduce(0) { $0 + $1.height }
            + CGFloat(max(rows.count - 1, 0)) * verticalSpacing
        let width = maxWidth.isFinite ? min(contentWidth, maxWidth) : contentWidth
        return CGSize(width: width, height: height)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal _: ProposedViewSize,
        subviews: Subviews,
        cache _: inout Void
    ) {
        let rows = rows(maxWidth: bounds.width, subviews: subviews)
        var originY = bounds.minY
        for row in rows {
            var originX = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(
                    at: CGPoint(
                        x: originX,
                        y: originY + verticalOffset(rowHeight: row.height, itemHeight: size.height)
                    ),
                    proposal: ProposedViewSize(size)
                )
                originX += size.width + horizontalSpacing
            }
            originY += row.height + verticalSpacing
        }
    }

    private func verticalOffset(rowHeight: CGFloat, itemHeight: CGFloat) -> CGFloat {
        switch alignment {
        case .top: 0
        case .center: (rowHeight - itemHeight) / 2
        case .bottom: rowHeight - itemHeight
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func rows(maxWidth: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var current = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let projected = current.indices.isEmpty
                ? size.width
                : current.width + horizontalSpacing + size.width
            if !current.indices.isEmpty, projected > maxWidth {
                rows.append(current)
                current = Row(indices: [index], width: size.width, height: size.height)
            } else {
                if !current.indices.isEmpty { current.width += horizontalSpacing }
                current.indices.append(index)
                current.width += size.width
                current.height = max(current.height, size.height)
            }
        }
        if !current.indices.isEmpty { rows.append(current) }
        return rows
    }
}
