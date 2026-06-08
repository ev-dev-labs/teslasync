//
//  TemplateGallery.Model.swift
//  TeslaSync — P4 feature view · 0132 · TemplateGallery (Apple)
//
//  Pure, host-free projection layer for the TemplateGallery surface — SwiftUI
//  parity of features/dashboard/components/TemplateGallery.tsx.
//
//  The web component is a Modal that swaps in place between a *gallery* (a
//  "Blank" card plus one card per `DASHBOARD_PRESETS` entry) and a *detail*
//  view for the selected preset. Its data is entirely client-seed: the preset
//  catalog (`DASHBOARD_PRESETS`) and the widget registry (`getWidgetDef`) are
//  static imports, and `useCategoryIcons` is a pure `useMemo` derivation — there
//  is no fetch, so the web carries no loading / error / stale / offline phase.
//  The preset catalog is bundled, so it is available offline by construction.
//
//  To honour the prompt's "every state must render — no hidden surfaces" rule
//  without inventing freshness chrome the web source does not have, the catalog
//  is modelled as an injectable *source* projected into a four-case ``phase``
//  (loading / loaded / empty / failed). Production binds the bundled canonical
//  catalog, which resolves synchronously to `loaded` (or `empty`); the loading
//  and failed branches stay reachable for a future async source, previews, and
//  tests so no branch is a blank box. Every branch is an `Equatable`/`Sendable`
//  value type so the whole surface is unit-testable without a render host.
//

import Foundation
import SwiftUI

// MARK: - Surface identity (P1/S11 view.opened)

/// Stable, non-identifying identity for the `TemplateGallery` feature view. The
/// slug is the value emitted with the P1/S11 `view.opened` diagnostics contract;
/// the view and its tests both read it from here so the two never drift.
public enum TemplateGallerySurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "TemplateGallery"

    /// The sentinel preset id the gallery's "Blank" card applies — parity with
    /// the web `onApply('__blank__')` call.
    public static let blankPresetID = "__blank__"

    /// Reports the surface becoming visible. Factored out of the view's `.task`
    /// so it is unit-testable without a rendering host.
    public static func reportOpen(to telemetry: any TemplateGalleryTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Widget category (web `WidgetCategory` union)

/// The widget category union from the web registry (`widgets/types.ts`). Used to
/// de-duplicate the category-icon row exactly as the web `useCategoryIcons` hook
/// does (first widget encountered per category, in order).
public enum TemplateGalleryCategory: String, CaseIterable, Sendable {
    case vehicle, battery, energy, driving, charging, climate, tires, security
    case commands, media, telemetry, analytics, alerts, automations, system, maps
}

// MARK: - Grid size (web `WidgetSize` + min/max)

/// A widget's grid footprint in column/row units (web `WidgetSize`).
public struct TemplateGalleryGridSize: Equatable, Sendable {
    public let cols: Int
    public let rows: Int

    public init(cols: Int, rows: Int) {
        self.cols = cols
        self.rows = rows
    }
}

/// A widget's default / minimum / maximum footprints, driving the mini-grid
/// auto-flow packing (web `buildLayoutItem` clamps default against min/max).
public struct TemplateGalleryWidgetSizing: Equatable, Sendable {
    public let `default`: TemplateGalleryGridSize
    public let min: TemplateGalleryGridSize
    public let max: TemplateGalleryGridSize

    public init(
        default defaultSize: TemplateGalleryGridSize,
        min: TemplateGalleryGridSize,
        max: TemplateGalleryGridSize
    ) {
        self.default = defaultSize
        self.min = min
        self.max = max
    }
}

// MARK: - Widget (web `WidgetInstance` + projected `WidgetDef`)

/// One widget inside a template — the web `WidgetInstance` joined with the
/// registry `WidgetDef` fields the surface actually reads: the display `name`
/// (rendered verbatim, exactly like the web `{def.name}`), the SF Symbol mapped
/// from the lucide `def.icon`, the `category` (for the icon row), and the grid
/// `sizing` (for the mini-grid layout).
public struct TemplateGalleryWidget: Identifiable, Equatable, Sendable {
    /// The widget *instance* id (web `WidgetInstance.id`, e.g. `"commuter-1"`).
    /// This is the mini-grid layout key (web `RGLLayout.i`).
    public let id: String
    /// The registry widget id (web `WidgetInstance.widgetId`, e.g. `"battery-gauge"`).
    public let widgetID: String
    /// The widget display name (web registry `def.name`), rendered verbatim.
    public let name: String
    /// SF Symbol mapped from the lucide `def.icon`.
    public let systemImage: String
    /// The widget category (web `def.category`).
    public let category: TemplateGalleryCategory
    /// The widget grid footprints (web `def.defaultSize/minSize/maxSize`).
    public let sizing: TemplateGalleryWidgetSizing

    public init(
        id: String,
        widgetID: String,
        name: String,
        systemImage: String,
        category: TemplateGalleryCategory,
        sizing: TemplateGalleryWidgetSizing
    ) {
        self.id = id
        self.widgetID = widgetID
        self.name = name
        self.systemImage = systemImage
        self.category = category
        self.sizing = sizing
    }
}

// MARK: - Template (web `SavedDashboard` preset + i18n descriptors)

/// One dashboard preset — the web `SavedDashboard` entry from `DASHBOARD_PRESETS`
/// joined with the `TEMPLATE_DESCRIPTIONS` descriptor. `nameKey` / `nameFallback`
/// reproduce the web `t('templates.${id}.name', preset.name)`; the optional
/// `descriptionKey` / `descriptionFallback` reproduce `t(desc.key, desc.fallback)`.
public struct TemplateGalleryTemplate: Identifiable, Equatable, Sendable {
    /// The preset id (web `SavedDashboard.id`, e.g. `"commuter"`).
    public let id: String
    /// The i18n key for the localized name (web `templates.${id}.name`).
    public let nameKey: String
    /// The English fallback name (web `preset.name`, e.g. `"Daily Commuter"`).
    public let nameFallback: String
    /// The i18n key for the description, or `nil` when the preset has none
    /// (web `TEMPLATE_DESCRIPTIONS[id]?.key`).
    public let descriptionKey: String?
    /// The English fallback description (web `TEMPLATE_DESCRIPTIONS[id]?.fallback`).
    public let descriptionFallback: String?
    /// The ordered widgets in this preset (web `SavedDashboard.widgets`).
    public let widgets: [TemplateGalleryWidget]

    public init(
        id: String,
        nameKey: String,
        nameFallback: String,
        descriptionKey: String?,
        descriptionFallback: String?,
        widgets: [TemplateGalleryWidget]
    ) {
        self.id = id
        self.nameKey = nameKey
        self.nameFallback = nameFallback
        self.descriptionKey = descriptionKey
        self.descriptionFallback = descriptionFallback
        self.widgets = widgets
    }

    /// The widget count shown in the card badge + the `widgetCount` line
    /// (web `template.widgets.length`).
    public var widgetCount: Int {
        widgets.count
    }
}

// MARK: - Mini-grid projection (web `MiniGridPreview`)

/// One placed tile in the mini-grid preview — the web `RGLLayout` item the
/// `MiniGridPreview` renders (position + footprint in grid units + the glyph).
public struct TemplateGalleryGridItem: Identifiable, Equatable, Sendable {
    /// The widget instance id (web `RGLLayout.i`).
    public let id: String
    public let x: Int
    public let y: Int
    public let width: Int
    public let height: Int
    /// SF Symbol drawn inside the tile (web `def.icon` inside the cell).
    public let systemImage: String

    public init(id: String, x: Int, y: Int, width: Int, height: Int, systemImage: String) {
        self.id = id
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.systemImage = systemImage
    }
}

/// The packed mini-grid for a template — the web `dashboard.layouts.lg` plus the
/// `cols` (4) and `safeMaxY` the `MiniGridPreview` derives for its aspect ratio.
public struct TemplateGalleryGrid: Equatable, Sendable {
    /// Column count for the large breakpoint (web `GRID_COLS.lg` = 4).
    public let columns: Int
    /// Row span used for the aspect ratio (web `safeMaxY`, floored at 2).
    public let rows: Int
    /// The placed tiles.
    public let items: [TemplateGalleryGridItem]

    public init(columns: Int, rows: Int, items: [TemplateGalleryGridItem]) {
        self.columns = columns
        self.rows = rows
        self.items = items
    }

    /// The aspect ratio (`cols / rows`) the preview box uses (web `aspectRatio`).
    public var aspectRatio: CGFloat {
        guard rows > 0 else { return 1 }
        return CGFloat(columns) / CGFloat(rows)
    }
}

// MARK: - Category icon row (web `useCategoryIcons`)

/// One entry in a card's category-icon row — the unique-per-category glyph the
/// web `useCategoryIcons` derives (the icon of the first widget in each category,
/// capped at five).
public struct TemplateGalleryCategoryIcon: Identifiable, Equatable, Sendable {
    public var id: String {
        category.rawValue
    }

    public let category: TemplateGalleryCategory
    public let systemImage: String

    public init(category: TemplateGalleryCategory, systemImage: String) {
        self.category = category
        self.systemImage = systemImage
    }
}

// MARK: - Card / detail projections

/// The render-ready projection of a gallery *card* (web `TemplateCard`): the
/// localized name descriptor, optional description, widget count badge, the
/// category-icon row, and the mini-grid.
public struct TemplateGalleryCardProjection: Identifiable, Equatable, Sendable {
    public let id: String
    public let nameKey: String
    public let nameFallback: String
    public let descriptionKey: String?
    public let descriptionFallback: String?
    public let widgetCount: Int
    public let categoryIcons: [TemplateGalleryCategoryIcon]
    public let grid: TemplateGalleryGrid

    public init(
        id: String,
        nameKey: String,
        nameFallback: String,
        descriptionKey: String?,
        descriptionFallback: String?,
        widgetCount: Int,
        categoryIcons: [TemplateGalleryCategoryIcon],
        grid: TemplateGalleryGrid
    ) {
        self.id = id
        self.nameKey = nameKey
        self.nameFallback = nameFallback
        self.descriptionKey = descriptionKey
        self.descriptionFallback = descriptionFallback
        self.widgetCount = widgetCount
        self.categoryIcons = categoryIcons
        self.grid = grid
    }
}

/// The render-ready projection of the *detail* view (web `TemplateDetail`): the
/// mini-grid, the name + optional description + widget-count line, and the full
/// ordered widget list (icon + name) the detail grid renders.
public struct TemplateGalleryDetailProjection: Identifiable, Equatable, Sendable {
    public let id: String
    public let nameKey: String
    public let nameFallback: String
    public let descriptionKey: String?
    public let descriptionFallback: String?
    public let widgetCount: Int
    public let widgets: [TemplateGalleryWidget]
    public let grid: TemplateGalleryGrid

    public init(
        id: String,
        nameKey: String,
        nameFallback: String,
        descriptionKey: String?,
        descriptionFallback: String?,
        widgetCount: Int,
        widgets: [TemplateGalleryWidget],
        grid: TemplateGalleryGrid
    ) {
        self.id = id
        self.nameKey = nameKey
        self.nameFallback = nameFallback
        self.descriptionKey = descriptionKey
        self.descriptionFallback = descriptionFallback
        self.widgetCount = widgetCount
        self.widgets = widgets
        self.grid = grid
    }
}
