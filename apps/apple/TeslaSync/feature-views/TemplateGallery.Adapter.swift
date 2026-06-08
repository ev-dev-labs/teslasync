//
//  TemplateGallery.Adapter.swift
//  TeslaSync — P4 feature view · 0132 · TemplateGallery (Apple)
//
//  The pure projection layer that turns the bundled catalog into render-ready
//  view models — the native parity of the web `buildDefaultLayouts` (mini-grid
//  auto-flow packing), `useCategoryIcons` (unique-per-category glyphs), and the
//  `TemplateCard` / `TemplateDetail` composition. Every function is a pure
//  value-in / value-out transform so the surface is testable without a render
//  host (the prompt's "unit test the data adapter: cached → projection").
//

import Foundation

// MARK: - Adapter

public enum TemplateGalleryAdapter {
    /// Column count for the large breakpoint the preview renders (web `GRID_COLS.lg`).
    public static let columns = 4

    /// Maximum category glyphs shown on a card (web `useCategoryIcons … slice(0, 5)`).
    public static let maxCategoryIcons = 5

    /// Row span the preview falls back to when a layout is empty/degenerate
    /// (web `MiniGridPreview` `maxY … : 2` + `safeMaxY` guard).
    public static let fallbackRows = 2

    // MARK: Phase projection (web static import → render envelope)

    /// Projects a catalog load `Result` into the surface ``TemplateGalleryPhase``.
    /// Success with rows → `loaded`; success with none → `empty`; failure →
    /// `failed`. This is the "cached → projection" seam the model binds.
    public static func phase(
        from result: Result<[TemplateGalleryTemplate], TemplateGalleryCatalogError>
    ) -> TemplateGalleryPhase {
        switch result {
        case let .success(templates):
            templates.isEmpty ? .empty : .loaded(templates)
        case let .failure(error):
            .failed(messageKey: error.messageKey, messageFallback: error.messageFallback)
        }
    }

    // MARK: Mini-grid packing (web `buildDefaultLayouts` — lg breakpoint)

    /// Packs a template's widgets into the large-breakpoint grid using the web's
    /// left-to-right auto-flow: place each widget at the running column; when it
    /// would overflow the column count, wrap to a new row at the tallest height
    /// of the row just closed. Footprints are clamped against each widget's
    /// min/max exactly as the web `buildLayoutItem` does.
    public static func grid(
        for template: TemplateGalleryTemplate,
        columns: Int = columns
    ) -> TemplateGalleryGrid {
        var items: [TemplateGalleryGridItem] = []
        var cursorX = 0
        var cursorY = 0
        var rowMaxHeight = 0

        for widget in template.widgets {
            let width = clamp(
                min(widget.sizing.default.cols, columns),
                lower: min(widget.sizing.min.cols, columns),
                upper: min(widget.sizing.max.cols, columns)
            )
            let height = clamp(
                widget.sizing.default.rows,
                lower: widget.sizing.min.rows,
                upper: widget.sizing.max.rows
            )

            var itemX = cursorX
            var itemY = cursorY
            if cursorX + width > columns {
                cursorX = 0
                cursorY += rowMaxHeight
                rowMaxHeight = 0
                itemX = 0
                itemY = cursorY
            }

            items.append(
                TemplateGalleryGridItem(
                    id: widget.id,
                    x: itemX,
                    y: itemY,
                    width: width,
                    height: height,
                    systemImage: widget.systemImage
                )
            )
            cursorX = itemX + width
            rowMaxHeight = max(rowMaxHeight, height)
        }

        let maxY = items.map { $0.y + $0.height }.max() ?? fallbackRows
        let rows = (maxY > 0) ? maxY : fallbackRows
        return TemplateGalleryGrid(columns: columns, rows: rows, items: items)
    }

    // MARK: Category icons (web `useCategoryIcons`)

    /// Derives the unique-per-category glyph row for a template: the icon of the
    /// first widget encountered in each category, in order, capped at five —
    /// a faithful port of the web `useCategoryIcons` `useMemo`.
    public static func categoryIcons(
        for template: TemplateGalleryTemplate,
        limit: Int = maxCategoryIcons
    ) -> [TemplateGalleryCategoryIcon] {
        var seen = Set<TemplateGalleryCategory>()
        var icons: [TemplateGalleryCategoryIcon] = []
        for widget in template.widgets where !seen.contains(widget.category) {
            seen.insert(widget.category)
            icons.append(
                TemplateGalleryCategoryIcon(category: widget.category, systemImage: widget.systemImage)
            )
        }
        return Array(icons.prefix(limit))
    }

    // MARK: Card / detail projections

    /// Projects a template into a gallery-card view model (web `TemplateCard`).
    public static func card(for template: TemplateGalleryTemplate) -> TemplateGalleryCardProjection {
        TemplateGalleryCardProjection(
            id: template.id,
            nameKey: template.nameKey,
            nameFallback: template.nameFallback,
            descriptionKey: template.descriptionKey,
            descriptionFallback: template.descriptionFallback,
            widgetCount: template.widgetCount,
            categoryIcons: categoryIcons(for: template),
            grid: grid(for: template)
        )
    }

    /// Projects a template into the detail view model (web `TemplateDetail`).
    public static func detail(for template: TemplateGalleryTemplate) -> TemplateGalleryDetailProjection {
        TemplateGalleryDetailProjection(
            id: template.id,
            nameKey: template.nameKey,
            nameFallback: template.nameFallback,
            descriptionKey: template.descriptionKey,
            descriptionFallback: template.descriptionFallback,
            widgetCount: template.widgetCount,
            widgets: template.widgets,
            grid: grid(for: template)
        )
    }

    // MARK: - Helpers

    /// Clamps `value` into `[lower, upper]` (web `clampMinMax`). When the bounds
    /// invert (degenerate registry data) the lower bound wins, matching the web
    /// `Math.min(Math.max(...))` ordering.
    private static func clamp(_ value: Int, lower: Int, upper: Int) -> Int {
        min(max(value, lower), upper)
    }
}
