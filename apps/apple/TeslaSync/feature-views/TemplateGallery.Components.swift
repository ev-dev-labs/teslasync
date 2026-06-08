//
//  TemplateGallery.Components.swift
//  TeslaSync — P4 feature view · 0132 · TemplateGallery (Apple)
//
//  Supporting subviews split out of TemplateGallery.Views.swift to keep each
//  file focused: the `MiniGridPreview`-parity mini-grid + its frame, the shared
//  card chrome (glass surface + press style), and the loading / empty / error
//  state surfaces. Pure functions of their inputs.
//

import SwiftUI

// MARK: - Mini-grid preview (web `MiniGridPreview`)

struct TemplateGalleryMiniGrid: View {
    let grid: TemplateGalleryGrid
    var fixedHeight: CGFloat?

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                ForEach(grid.items) { item in
                    tile(item, in: geo.size)
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
        }
        .modifier(TemplateGalleryMiniGridFrame(aspectRatio: grid.aspectRatio, fixedHeight: fixedHeight))
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement()
        .accessibilityLabel(
            Text(verbatim: TemplateGalleryAccessibility.gridLabel(widgetCount: grid.items.count))
        )
    }

    private func tile(_ item: TemplateGalleryGridItem, in size: CGSize) -> some View {
        let cols = CGFloat(max(grid.columns, 1))
        let rows = CGFloat(max(grid.rows, 1))
        let tileWidth = CGFloat(item.width) / cols * size.width
        let tileHeight = CGFloat(item.height) / rows * size.height
        let originX = CGFloat(item.x) / cols * size.width
        let originY = CGFloat(item.y) / rows * size.height

        return RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .overlay(
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 0.5)
            )
            .overlay(
                Image(systemName: item.systemImage)
                    .font(.system(size: 8))
                    .foregroundStyle(Color.TS.textMuted)
            )
            .frame(width: max(tileWidth - 2, 0), height: max(tileHeight - 2, 0))
            .offset(x: originX + 1, y: originY + 1)
    }
}

/// Applies the mini-grid frame: a fixed height (detail, web `h-48`) or the
/// `cols / rows` aspect ratio (cards, web `aspectRatio`).
private struct TemplateGalleryMiniGridFrame: ViewModifier {
    let aspectRatio: CGFloat
    let fixedHeight: CGFloat?

    func body(content: Content) -> some View {
        if let fixedHeight {
            content.frame(height: fixedHeight)
        } else {
            content.aspectRatio(aspectRatio, contentMode: .fit)
        }
    }
}

// MARK: - Card surface + button style (web card chrome + hover lift)

/// The card background: a glass surface with a solid or dashed border (the
/// "Blank" card is dashed, web `border-dashed`).
struct TemplateGalleryCardSurface: ViewModifier {
    let dashed: Bool

    func body(content: Content) -> some View {
        content
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(
                        Color.TS.border,
                        style: StrokeStyle(lineWidth: 1, dash: dashed ? [4, 3] : [])
                    )
            )
    }
}

/// The card press feedback (web hover lift, here a press scale honoring Reduce
/// Motion).
struct TemplateGalleryCardButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.9 : 1)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: TSMotion.fastDuration), value: configuration.isPressed)
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
    }
}

// MARK: - Loading (skeleton chrome)

struct TemplateGalleryLoading: View {
    private let columns = [GridItem(.adaptive(minimum: 240), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(0 ..< 4, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .fill(Color.TS.surfaceGlass)
                    .frame(height: 150)
                    .overlay(
                        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                            .strokeBorder(Color.TS.border, lineWidth: 1)
                    )
            }
        }
        .accessibilityLabel(TemplateGalleryStrings.text("templates.loading", "Loading templates"))
    }
}

// MARK: - Empty (friendly, never a blank box)

struct TemplateGalleryEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                TemplateGalleryStrings.text("templates.empty.title", "No templates available")
            } icon: {
                Image(systemName: "square.grid.2x2")
            }
        } description: {
            TemplateGalleryStrings.text("templates.empty.message", "Dashboard templates will appear here.")
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (retry affordance, web `QueryError` equivalent)

struct TemplateGalleryErrorState: View {
    let messageKey: String
    let messageFallback: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 32))
                .foregroundStyle(Color.TS.statusDanger)
            TemplateGalleryStrings.text("templates.error.title", "Couldn't load templates")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            TemplateGalleryStrings.text(messageKey, messageFallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "arrow.clockwise").font(.system(size: 12, weight: .semibold))
                    TemplateGalleryStrings.text("templates.error.retry", "Retry")
                }
            }
            .accessibilityLabel(TemplateGalleryStrings.text("templates.error.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
