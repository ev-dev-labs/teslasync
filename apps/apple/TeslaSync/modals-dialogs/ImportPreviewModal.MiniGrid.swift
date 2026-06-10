//
//  ImportPreviewModal.MiniGrid.swift
//  TeslaSync — P4 modal / dialog · 0024 · ImportPreviewModal (Apple)
//
//  The miniature dashboard-layout thumbnail the preview embeds (web `<MiniGridPreview dashboard={…}>`)
//  and the per-widget availability row. The thumbnail draws each placed widget as a small rounded box
//  positioned proportionally inside an aspect-fitted frame (web absolute `left/top/width/height`
//  percentages inside a `relative` box with `aspectRatio: cols/safeMaxY`); the native read uses a
//  `GeometryReader` so the same fractional rects map onto the frame. An empty layout renders a
//  friendly hint instead of a blank box. The geometry is computed by `ImportPreviewProjection.grid`;
//  this file is the render only.
//

import SwiftUI

// MARK: - Mini-grid thumbnail (web `<MiniGridPreview>`)

/// The dashboard-layout thumbnail: the positioned widget tiles, or a friendly empty hint.
struct ImportPreviewMiniGrid: View {
    let grid: ImportPreviewGrid
    let localize: (String, String) -> String

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                ForEach(grid.tiles) { tile in
                    ImportPreviewTileView(tile: tile)
                        .frame(
                            width: max(0, tile.width * proxy.size.width),
                            height: max(0, tile.height * proxy.size.height)
                        )
                        .offset(
                            x: tile.originX * proxy.size.width,
                            y: tile.originY * proxy.size.height
                        )
                }
                if grid.isEmpty {
                    ImportPreviewMiniGridEmpty(localize: localize)
                        .frame(width: proxy.size.width, height: proxy.size.height)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
        }
        .aspectRatio(grid.aspectRatio, contentMode: .fit)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: localize("import.previewThumbnail", "Dashboard layout preview")))
    }
}

/// Tile-intrinsic sizes (not theme tokens): the tiny constants matching the web `rounded-sm`,
/// hairline border, and `padding: 2px`, which carry no semantic token.
private enum ImportPreviewMiniGridMetrics {
    static let tileRadius: CGFloat = 3
    static let tileBorderWidth: CGFloat = 0.5
    static let iconInset: CGFloat = 2
    static let iconSideFraction: CGFloat = 0.5
    static let minIconSize: CGFloat = 6
    static let maxIconSize: CGFloat = 16
    static let tileFillOpacity: Double = 0.06
}

/// One positioned box in the thumbnail (web `lgLayout.map` child) — a small rounded, subtly-filled
/// box centring the widget glyph when one resolved.
private struct ImportPreviewTileView: View {
    let tile: ImportPreviewTile

    var body: some View {
        GeometryReader { proxy in
            let shorterSide = min(proxy.size.width, proxy.size.height)
            ZStack {
                RoundedRectangle(cornerRadius: ImportPreviewMiniGridMetrics.tileRadius, style: .continuous)
                    .fill(Color.TS.textPrimary.opacity(ImportPreviewMiniGridMetrics.tileFillOpacity))
                RoundedRectangle(cornerRadius: ImportPreviewMiniGridMetrics.tileRadius, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: ImportPreviewMiniGridMetrics.tileBorderWidth)
                if let symbol = tile.systemImage {
                    Image(systemName: symbol)
                        .font(.system(size: iconSize(forSide: shorterSide), weight: .medium))
                        .foregroundStyle(Color.TS.textMuted)
                        .padding(ImportPreviewMiniGridMetrics.iconInset)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .accessibilityHidden(true)
    }

    /// Web `h-3 w-3` icon scaled to the tile: half the shorter side, clamped so it stays legible on
    /// large cells and never overflows tiny ones.
    private func iconSize(forSide side: CGFloat) -> CGFloat {
        let raw = side * ImportPreviewMiniGridMetrics.iconSideFraction
        return min(ImportPreviewMiniGridMetrics.maxIconSize, max(ImportPreviewMiniGridMetrics.minIconSize, raw))
    }
}

/// The friendly empty hint shown when the previewed layout has no placed widgets (the web renders a
/// bare border; the Apple thumbnail shows a faint glyph so it never reads as a blank box).
private struct ImportPreviewMiniGridEmpty: View {
    let localize: (String, String) -> String

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "rectangle.grid.2x2")
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: localize("import.noWidgets", "No widgets"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityHidden(true)
    }
}

// MARK: - Widget-availability row (web available / missing list item)

/// One row in the preview's widget list: an available widget (check + glyph + registry name) or a
/// missing one (X + struck-through raw id + "Not available").
struct ImportPreviewWidgetRowView: View {
    let row: ImportPreviewWidgetRow
    let localize: (String, String) -> String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: row.available ? "checkmark.circle.fill" : "xmark.circle.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(row.available ? Color.TS.statusSuccess : Color.TS.statusDanger)
                .accessibilityHidden(true)
            if let icon = row.icon {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            Text(verbatim: row.name)
                .font(Font.TS.bodySm)
                .foregroundStyle(row.available ? Color.TS.textSecondary : Color.TS.textMuted)
                .strikethrough(!row.available)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            if !row.available {
                Text(verbatim: localize("import.notAvailable", "Not available"))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger.opacity(0.7))
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(
                    row.available ? Color.TS.border : Color.TS.statusDanger.opacity(0.15),
                    lineWidth: 1
                )
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: ImportPreviewAccessibility.widgetRowLabel(row, localize: localize)))
    }
}
