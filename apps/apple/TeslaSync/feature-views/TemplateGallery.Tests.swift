//
//  TemplateGallery.Tests.swift
//  TeslaSync — P4 feature view · 0132 · TemplateGallery (Apple)
//
//  Host-free unit coverage for the TemplateGallery surface. The web source
//  fetches nothing — its catalog is a static client-seed import — so the
//  meaningful, render-free surface area is:
//    • the canonical catalog integrity (ten presets, web instance-id scheme,
//      every preset widget resolves to real registry metadata),
//    • the mini-grid auto-flow packer (web `buildDefaultLayouts`),
//    • the unique-per-category icon derivation (web `useCategoryIcons`),
//    • the card / detail / phase projections (cached → projection),
//    • the localization + accessibility phrasing,
//    • the model's selection + phase behaviour,
//    • the P1/S11 `view.opened` telemetry slug.
//  No rendering / no KMP runtime required. These run in the TeslaSync(/-macOS)
//  XCTest targets (folded in at integration time, like every per-surface bundle).
//

import XCTest
@testable import TeslaSync

/// Looks up a canonical preset by id (shared test helper — avoids force unwraps).
private func templateGalleryPreset(_ id: String) -> TemplateGalleryTemplate {
    guard let match = TemplateGalleryCatalog.templates.first(where: { $0.id == id }) else {
        fatalError("missing preset \(id)")
    }
    return match
}

// MARK: - Canonical catalog integrity (web `DASHBOARD_PRESETS`)

final class TemplateGalleryCatalogTests: XCTestCase {
    private var templates: [TemplateGalleryTemplate] {
        TemplateGalleryCatalog.templates
    }

    func testHasTheTenPresetsInWebOrder() {
        XCTAssertEqual(
            templates.map(\.id),
            [
                "default", "commuter", "fleet_manager", "data_nerd", "charging_focus",
                "security_monitor", "road_trip", "performance", "kiosk_wall", "minimal"
            ]
        )
    }

    func testWidgetCountsMatchWebPresets() {
        let counts = Dictionary(uniqueKeysWithValues: templates.map { ($0.id, $0.widgetCount) })
        XCTAssertEqual(counts["default"], 8)
        XCTAssertEqual(counts["commuter"], 7)
        XCTAssertEqual(counts["fleet_manager"], 6)
        XCTAssertEqual(counts["data_nerd"], 5)
        XCTAssertEqual(counts["charging_focus"], 7)
        XCTAssertEqual(counts["security_monitor"], 6)
        XCTAssertEqual(counts["road_trip"], 8)
        XCTAssertEqual(counts["performance"], 6)
        XCTAssertEqual(counts["kiosk_wall"], 6)
        XCTAssertEqual(counts["minimal"], 4)
    }

    func testInstanceIDsFollowWebScheme() {
        // web `makePreset`: each widget instance id is `${presetId}-${i + 1}`.
        for template in templates {
            for (index, widget) in template.widgets.enumerated() {
                XCTAssertEqual(widget.id, "\(template.id)-\(index + 1)")
            }
        }
    }

    func testEveryPresetWidgetResolvesToRealMetadata() {
        // Guards against a typo'd widget id: the unknown fallback uses the
        // "square.dashed" glyph + the raw id as its name, so neither must appear.
        for template in templates {
            for widget in template.widgets {
                XCTAssertNotEqual(widget.systemImage, "square.dashed", "unmapped widget \(widget.widgetID)")
                XCTAssertNotEqual(widget.name, widget.widgetID, "unmapped widget \(widget.widgetID)")
                XCTAssertFalse(widget.name.isEmpty)
                XCTAssertFalse(widget.systemImage.isEmpty)
                XCTAssertGreaterThan(widget.sizing.default.cols, 0)
                XCTAssertGreaterThan(widget.sizing.default.rows, 0)
            }
        }
    }

    func testNameAndDescriptionDescriptorsMatchWebKeys() {
        let byID = Dictionary(uniqueKeysWithValues: templates.map { ($0.id, $0) })
        XCTAssertEqual(byID["commuter"]?.nameKey, "templates.commuter.name")
        XCTAssertEqual(byID["commuter"]?.nameFallback, "Daily Commuter")
        // multiword ids use the camelCased desc key (web `TEMPLATE_DESCRIPTIONS`).
        XCTAssertEqual(byID["fleet_manager"]?.descriptionKey, "templates.fleetManager.desc")
        XCTAssertEqual(byID["kiosk_wall"]?.nameKey, "templates.kiosk_wall.name")
        XCTAssertEqual(byID["kiosk_wall"]?.descriptionKey, "templates.kioskWall.desc")
        for template in templates {
            XCTAssertNotNil(template.descriptionKey)
            XCTAssertNotNil(template.descriptionFallback)
        }
    }
}

// MARK: - Mini-grid packer (web `buildDefaultLayouts` — lg breakpoint)

final class TemplateGalleryAdapterGridTests: XCTestCase {
    private func template(_ id: String) -> TemplateGalleryTemplate {
        guard let match = TemplateGalleryCatalog.templates.first(where: { $0.id == id }) else {
            fatalError("missing preset \(id)")
        }
        return match
    }

    func testMinimalPresetPacksLikeTheWebAutoFlow() {
        // minimal: battery-radial-gauge(1×2), charge-status(2×2), climate(1×2),
        // quick-nav(4×2). The first row fills 1+2+1 = 4 cols; quick-nav (4 wide)
        // overflows and wraps to y = 2.
        let grid = TemplateGalleryAdapter.grid(for: template("minimal"))
        XCTAssertEqual(grid.columns, 4)
        XCTAssertEqual(grid.rows, 4)
        XCTAssertEqual(
            grid.items,
            [
                TemplateGalleryGridItem(id: "minimal-1", x: 0, y: 0, width: 1, height: 2, systemImage: "battery.100"),
                TemplateGalleryGridItem(id: "minimal-2", x: 1, y: 0, width: 2, height: 2, systemImage: "bolt.fill"),
                TemplateGalleryGridItem(
                    id: "minimal-3", x: 3, y: 0, width: 1, height: 2, systemImage: "thermometer.medium"
                ),
                TemplateGalleryGridItem(id: "minimal-4", x: 0, y: 2, width: 4, height: 2, systemImage: "mappin")
            ]
        )
    }

    func testNoTileExceedsTheColumnCount() {
        for template in TemplateGalleryCatalog.templates {
            let grid = TemplateGalleryAdapter.grid(for: template)
            for item in grid.items {
                XCTAssertLessThanOrEqual(item.x + item.width, grid.columns, "\(template.id)/\(item.id)")
                XCTAssertGreaterThanOrEqual(item.x, 0)
                XCTAssertGreaterThan(item.width, 0)
                XCTAssertGreaterThan(item.height, 0)
            }
            XCTAssertGreaterThan(grid.rows, 0)
        }
    }

    func testEmptyTemplateFallsBackToTwoRows() {
        // web `MiniGridPreview` floors `safeMaxY` at 2 for an empty layout.
        let empty = TemplateGalleryTemplate(
            id: "x", nameKey: "k", nameFallback: "X",
            descriptionKey: nil, descriptionFallback: nil, widgets: []
        )
        let grid = TemplateGalleryAdapter.grid(for: empty)
        XCTAssertTrue(grid.items.isEmpty)
        XCTAssertEqual(grid.rows, TemplateGalleryAdapter.fallbackRows)
        XCTAssertEqual(grid.aspectRatio, CGFloat(grid.columns) / CGFloat(grid.rows))
    }
}

// MARK: - Category icons (web `useCategoryIcons`)

final class TemplateGalleryCategoryIconTests: XCTestCase {
    private func template(_ id: String) -> TemplateGalleryTemplate {
        templateGalleryPreset(id)
    }

    func testCapsAtFiveUniqueCategories() {
        for template in TemplateGalleryCatalog.templates {
            let icons = TemplateGalleryAdapter.categoryIcons(for: template)
            XCTAssertLessThanOrEqual(icons.count, 5)
            XCTAssertEqual(icons.map(\.category).count, Set(icons.map(\.category)).count, "must be unique")
        }
    }

    func testUsesFirstWidgetIconPerCategoryInOrder() {
        // default order: onboarding(system), vehicle-hero(vehicle), battery-gauge
        // (battery), climate-status(climate), recent-drives(driving), … capped 5.
        let icons = TemplateGalleryAdapter.categoryIcons(for: template("default"))
        XCTAssertEqual(icons.map(\.category), [.system, .vehicle, .battery, .climate, .driving])
        XCTAssertEqual(
            icons.map(\.systemImage),
            ["checklist", "car.fill", "battery.100", "thermometer.medium", "car.fill"]
        )
    }

    func testRespectsACustomLimit() {
        let icons = TemplateGalleryAdapter.categoryIcons(for: template("default"), limit: 2)
        XCTAssertEqual(icons.count, 2)
        XCTAssertEqual(icons.map(\.category), [.system, .vehicle])
    }
}

// MARK: - Phase + card/detail projections (cached → projection)

final class TemplateGalleryProjectionTests: XCTestCase {
    func testPhaseProjectsLoadedEmptyAndFailed() {
        XCTAssertEqual(
            TemplateGalleryAdapter.phase(from: .success(TemplateGalleryCatalog.templates)),
            .loaded(TemplateGalleryCatalog.templates)
        )
        XCTAssertEqual(TemplateGalleryAdapter.phase(from: .success([])), .empty)

        let error = TemplateGalleryCatalogError(messageKey: "k", messageFallback: "f")
        XCTAssertEqual(
            TemplateGalleryAdapter.phase(from: .failure(error)),
            .failed(messageKey: "k", messageFallback: "f")
        )
    }

    func testCardProjectionCarriesNameCountIconsAndGrid() {
        let template = templateGalleryPreset("commuter")
        let card = TemplateGalleryAdapter.card(for: template)
        XCTAssertEqual(card.id, "commuter")
        XCTAssertEqual(card.nameKey, "templates.commuter.name")
        XCTAssertEqual(card.nameFallback, "Daily Commuter")
        XCTAssertEqual(card.widgetCount, 7)
        XCTAssertFalse(card.categoryIcons.isEmpty)
        XCTAssertFalse(card.grid.items.isEmpty)
        XCTAssertNotNil(card.descriptionKey)
    }

    func testDetailProjectionKeepsTheFullWidgetList() {
        let template = templateGalleryPreset("road_trip")
        let detail = TemplateGalleryAdapter.detail(for: template)
        XCTAssertEqual(detail.widgets, template.widgets)
        XCTAssertEqual(detail.widgetCount, template.widgetCount)
        XCTAssertEqual(detail.grid.items.count, template.widgets.count)
    }
}

// MARK: - Localization (web `t(key, fallback)`)

final class TemplateGalleryStringsTests: XCTestCase {
    func testReturnsFallbackWhenKeyIsAbsent() {
        XCTAssertEqual(TemplateGalleryStrings.string("templates.title", "Dashboard Templates"), "Dashboard Templates")
        XCTAssertEqual(TemplateGalleryStrings.string("common.back", "Back"), "Back")
    }

    func testWidgetCountInterpolatesWithoutPluralisation() {
        // web renders `{{count}} widgets` verbatim (no plural rule), so 1 → "1 widgets".
        XCTAssertEqual(TemplateGalleryStrings.widgetCount(7), "7 widgets")
        XCTAssertEqual(TemplateGalleryStrings.widgetCount(1), "1 widgets")
    }
}

// MARK: - Accessibility phrasing

final class TemplateGalleryAccessibilityTests: XCTestCase {
    func testCardLabelNamesTheTemplateAndCount() {
        let label = TemplateGalleryAccessibility.cardLabel(name: "Daily Commuter", widgetCount: 7)
        XCTAssertTrue(label.contains("Daily Commuter"), label)
        XCTAssertTrue(label.contains("7"), label)
    }

    func testBlankLabelCombinesTitleAndDescription() {
        let label = TemplateGalleryAccessibility.blankLabel()
        XCTAssertTrue(label.contains("Blank Dashboard"), label)
        XCTAssertTrue(label.lowercased().contains("scratch"), label)
    }

    func testCategoryAndGridLabelsAreNonEmpty() {
        XCTAssertFalse(TemplateGalleryAccessibility.categoryLabel(.battery).isEmpty)
        let grid = TemplateGalleryAccessibility.gridLabel(widgetCount: 5)
        XCTAssertTrue(grid.contains("5"), grid)
    }
}

// MARK: - Telemetry (P1/S11 view.opened)

final class TemplateGalleryTelemetryTests: XCTestCase {
    func testReportOpenEmitsSurfaceSlug() {
        let spy = SpyTemplateGalleryTelemetry()
        TemplateGallerySurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["TemplateGallery"])
    }

    func testSurfaceSlugConstantsAgree() {
        XCTAssertEqual(TemplateGallery.surfaceSlug, "TemplateGallery")
        XCTAssertEqual(TemplateGallery.surfaceSlug, TemplateGallerySurface.slug)
    }

    func testBlankPresetSentinelMatchesWeb() {
        XCTAssertEqual(TemplateGallerySurface.blankPresetID, "__blank__")
    }
}

// MARK: - Model (selection + phase)

@MainActor
final class TemplateGalleryModelTests: XCTestCase {
    func testCanonicalModelOpensLoadedWithTenTemplates() {
        let model = TemplateGalleryModel(telemetry: SpyTemplateGalleryTelemetry())
        XCTAssertEqual(model.phase, .loaded(TemplateGalleryCatalog.templates))
        XCTAssertNil(model.selectedTemplate)
    }

    func testSelectionResolvesAndClears() {
        let model = TemplateGalleryModel(telemetry: SpyTemplateGalleryTelemetry())
        model.select("charging_focus")
        XCTAssertEqual(model.selectedTemplate?.id, "charging_focus")
        model.clearSelection()
        XCTAssertNil(model.selectedTemplate)
        XCTAssertNil(model.selectedID)
    }

    func testEmptyAndFailingSourcesProjectToTheirPhases() {
        let empty = TemplateGalleryModel(
            source: StubCatalogSource(result: .success([])),
            telemetry: SpyTemplateGalleryTelemetry()
        )
        XCTAssertEqual(empty.phase, .empty)

        let error = TemplateGalleryCatalogError(messageKey: "k", messageFallback: "f")
        let failing = TemplateGalleryModel(
            source: StubCatalogSource(result: .failure(error)),
            telemetry: SpyTemplateGalleryTelemetry()
        )
        XCTAssertEqual(failing.phase, .failed(messageKey: "k", messageFallback: "f"))
    }

    func testReportOpenForwardsTheSlug() {
        let spy = SpyTemplateGalleryTelemetry()
        let model = TemplateGalleryModel(telemetry: spy)
        model.reportOpen()
        XCTAssertEqual(spy.openedSurfaces, ["TemplateGallery"])
    }
}

// MARK: - Test doubles

/// Records the surfaces opened so the `view.opened` contract can be asserted
/// without an `os_log` round-trip. Single-threaded test usage only.
private final class SpyTemplateGalleryTelemetry: TemplateGalleryTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}

/// A catalog source returning a fixed result (drives the empty / failed phases).
private struct StubCatalogSource: TemplateGalleryCatalogSource {
    let result: Result<[TemplateGalleryTemplate], TemplateGalleryCatalogError>

    func loadCatalog() -> Result<[TemplateGalleryTemplate], TemplateGalleryCatalogError> {
        result
    }
}
