//
//  MiniGridPreview.swift
//  TeslaSync — P4 feature view · 0128 · MiniGridPreview (Apple)
//
//  Native, Apple-idiomatic parity of the web `MiniGridPreview`
//  (features/dashboard/components/MiniGridPreview.tsx).
//
//  A miniature thumbnail of a dashboard layout: a subtle bordered box, sized to
//  the layout's aspect ratio (columns : safeMaxY), in which each placed widget
//  is drawn as a small rounded box positioned proportionally and badged with the
//  widget's SF Symbol. The web component positions children with absolute
//  percentages inside a `relative` box with `aspectRatio: cols/safeMaxY`; the
//  native read uses a `GeometryReader` so the same fractional rects map onto the
//  aspect-fitted frame. An empty layout renders a friendly empty state instead
//  of a blank box.
//
//  It owns no data — the data-bound states (loading / error / stale / offline)
//  belong to the embedding caller (the dashboard manager) — so the only branches
//  here are the ones the web source carries: the positioned tiles (with / without
//  an icon) and the empty layout.
//
//  On appear it emits the P1/S11 `view.opened` diagnostics event with the
//  ``MiniGridPreviewSurface/slug``.
//

import SwiftUI

// MARK: - MiniGridPreview

public struct MiniGridPreview: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`); the canonical source.
    /// `nonisolated` because it is a compile-time constant — `View` is
    /// `@MainActor`, but the slug must be readable from any context (tests,
    /// telemetry adapters) without a main-actor hop.
    public nonisolated static let surfaceSlug = MiniGridPreviewSurface.slug

    private let projection: MiniGridProjection
    private let telemetry: any MiniGridPreviewTelemetry

    /// Designated initialiser.
    /// - Parameters:
    ///   - dashboard: the layout to preview (web `dashboard` prop).
    ///   - iconResolver: the widget id → SF Symbol seam (native analogue of the
    ///     web imported `getWidgetDef`); defaults to the full registry catalog.
    ///   - telemetry: diagnostics sink; defaults to the `os_log` sink.
    public init(
        dashboard: MiniGridDashboard,
        iconResolver: any MiniGridIconResolving = MiniGridWidgetIconCatalog(),
        telemetry: any MiniGridPreviewTelemetry = OSLogMiniGridPreviewTelemetry()
    ) {
        projection = MiniGridProjection(dashboard: dashboard, iconResolver: iconResolver)
        self.telemetry = telemetry
    }

    /// Projection initialiser — for callers (and previews/tests) that already
    /// built the projection, so the render math is computed exactly once.
    public init(
        projection: MiniGridProjection,
        telemetry: any MiniGridPreviewTelemetry = OSLogMiniGridPreviewTelemetry()
    ) {
        self.projection = projection
        self.telemetry = telemetry
    }

    public var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                ForEach(projection.tiles) { tile in
                    MiniGridTileView(tile: tile)
                        .frame(
                            width: max(0, tile.width * proxy.size.width),
                            height: max(0, tile.height * proxy.size.height)
                        )
                        .offset(
                            x: tile.originX * proxy.size.width,
                            y: tile.originY * proxy.size.height
                        )
                }
                if projection.isEmpty {
                    MiniGridEmptyState()
                        .frame(width: proxy.size.width, height: proxy.size.height)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
        }
        .aspectRatio(projection.aspectRatio, contentMode: .fit)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: MiniGridPreviewMetrics.containerRadius, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: MiniGridPreviewMetrics.containerRadius, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: MiniGridPreviewMetrics.containerRadius, style: .continuous))
        .task { MiniGridPreviewSurface.reportOpen(to: telemetry) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: MiniGridPreviewAccessibility.summary(widgetCount: projection.widgetCount))
        )
    }
}

// MARK: - Metrics (thumbnail-intrinsic sizes; not theme tokens)

/// Fixed sizes intrinsic to this miniature visualisation. The container radius
/// reuses the design token (web `rounded-lg`); the tile radius / border / icon
/// inset are deliberately tiny constants matching the web `rounded-sm`,
/// hairline border, and `padding: 2px`, which have no semantic token.
enum MiniGridPreviewMetrics {
    /// Container corner radius (web `rounded-lg`).
    static let containerRadius = TSRadius.sm
    /// Tile corner radius (web `rounded-sm`).
    static let tileRadius: CGFloat = 3
    /// Tile hairline border (web `border-white/[0.08]`).
    static let tileBorderWidth: CGFloat = 0.5
    /// Inset between a tile edge and its icon (web `padding: 2px`).
    static let iconInset: CGFloat = 2
    /// Icon size as a fraction of the tile's shorter side.
    static let iconSideFraction: CGFloat = 0.5
    /// Clamp on the resolved icon size so glyphs stay legible but never overflow.
    static let minIconSize: CGFloat = 6
    static let maxIconSize: CGFloat = 16
    /// Tile fill opacity over the primary token (web `bg-white/[0.06]`).
    static let tileFillOpacity: Double = 0.06
}

// MARK: - Tile

/// One positioned box in the thumbnail (web `lgLayout.map(...)` child): a small
/// rounded, subtly-filled box that centres the widget's icon when one resolved.
private struct MiniGridTileView: View {
    let tile: MiniGridTile

    var body: some View {
        GeometryReader { proxy in
            let shorterSide = min(proxy.size.width, proxy.size.height)
            ZStack {
                RoundedRectangle(cornerRadius: MiniGridPreviewMetrics.tileRadius, style: .continuous)
                    .fill(Color.TS.textPrimary.opacity(MiniGridPreviewMetrics.tileFillOpacity))
                RoundedRectangle(cornerRadius: MiniGridPreviewMetrics.tileRadius, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: MiniGridPreviewMetrics.tileBorderWidth)
                if let symbol = tile.systemImage {
                    Image(systemName: symbol)
                        .font(.system(size: iconSize(forSide: shorterSide), weight: .medium))
                        .foregroundStyle(Color.TS.textMuted)
                        .padding(MiniGridPreviewMetrics.iconInset)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .accessibilityHidden(true)
    }

    /// Web `h-3 w-3` icon scaled to the tile: half the shorter side, clamped so
    /// it stays legible on large cells and never overflows tiny ones.
    private func iconSize(forSide side: CGFloat) -> CGFloat {
        let raw = side * MiniGridPreviewMetrics.iconSideFraction
        return min(MiniGridPreviewMetrics.maxIconSize, max(MiniGridPreviewMetrics.minIconSize, raw))
    }
}

// MARK: - Empty state

/// The friendly empty state shown when a dashboard has no placed widgets — a
/// faint grid glyph plus a muted caption, so the thumbnail never reads as a
/// blank box (the prompt's empty-state mandate; the web renders a bare border).
private struct MiniGridEmptyState: View {
    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "rectangle.grid.2x2")
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: MiniGridPreviewAccessibility.emptyCaption)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityHidden(true)
    }
}
