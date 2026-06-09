//
//  RecentlyUnlockedAchievements.Badges.swift
//  TeslaSync — P4 dashboard widget · 0080 · RecentlyUnlockedAchievements (Apple)
//
//  AchievementBadgeView (the size="sm" unlocked badge over the amber glass card) +
//  RecentlyUnlockedFlowLayout (the wrapping, left/top-aligned badge strip — web
//  `flex flex-wrap gap-3 items-start`) + the shared badge footprint metrics.
//

import Foundation
import SwiftUI

// MARK: - Badge tile (web `AchievementBadge` size="sm", unlocked variant)

/// One recently-unlocked badge: emoji icon over the achievement name, description, and an
/// "✓ Unlocked" caption, on the amber glass card the web `AchievementBadge` renders for an
/// unlocked achievement. Decorative (the enclosing button carries the VoiceOver label).
struct AchievementBadgeView: View {
    let item: RecentlyUnlockedItem

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: item.icon)
                .font(.system(size: 26))
                .accessibilityHidden(true)
            Text(verbatim: item.name)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.statusWarning)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            if !item.detail.isEmpty {
                Text(verbatim: item.detail)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
            }
            Text(verbatim: item.statusText)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.statusWarning.opacity(0.8))
                .lineLimit(1)
        }
        .padding(TSSpacing.sm)
        .frame(width: RecentlyUnlockedMetrics.badgeWidth)
        .frame(minHeight: RecentlyUnlockedMetrics.badgeHeight, alignment: .top)
        .background(
            Color.TS.statusWarning.opacity(0.08),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.3), lineWidth: 1)
        )
    }
}

// MARK: - Layout metrics

/// Fixed badge footprint shared by the skeleton + the real badge so the strip wraps identically
/// in both states.
enum RecentlyUnlockedMetrics {
    static let badgeWidth: CGFloat = 104
    static let badgeHeight: CGFloat = 104
}

// MARK: - Flow layout (web `flex flex-wrap gap-3 items-start`)

/// A wrapping flow layout that left-aligns and top-aligns each row, reproducing the web badge
/// strip's `flex flex-wrap gap-3 items-start`.
struct RecentlyUnlockedFlowLayout: Layout {
    var spacing: CGFloat = TSSpacing.md

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
        var cursorX: CGFloat = 0
        var cursorY: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0

        for index in subviews.indices {
            let itemSize = sizes[index]
            if cursorX > 0, cursorX + itemSize.width > maxWidth {
                widest = max(widest, cursorX - spacing)
                cursorX = 0
                cursorY += rowHeight + spacing
                rowHeight = 0
            }
            frames[index] = CGRect(x: cursorX, y: cursorY, width: itemSize.width, height: itemSize.height)
            cursorX += itemSize.width + spacing
            rowHeight = max(rowHeight, itemSize.height)
        }
        widest = max(widest, cursorX - spacing)

        let width = maxWidth.isFinite ? maxWidth : max(0, widest)
        return (CGSize(width: width, height: cursorY + rowHeight), frames)
    }
}
