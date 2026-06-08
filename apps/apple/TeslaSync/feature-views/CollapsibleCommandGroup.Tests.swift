//
//  CollapsibleCommandGroup.Tests.swift
//  TeslaSync — P4 feature view · 0224 · CollapsibleCommandGroup (Apple)
//
//  Unit coverage for the CollapsibleCommandGroup surface. The web source is a
//  pure presentational disclosure container, so the meaningful host-free surface
//  area is:
//    • Category adapter — the web `CommandCategory` / `CATEGORY_META` parity
//      (verbatim identifiers, web `CATEGORY_ORDER`, a label key + fallback + icon
//      for every case) and the `init(web:)` decode.
//    • Persistence adapter — the `sessionStorage` key derivation and the
//      stored-flag → initial-expansion resolution (web ternary), the "cache →
//      projection" seam this prompt requires a unit test for.
//    • Projection — the label/count/empty/accessibility policy across the data
//      and empty branches.
//    • Accessibility — the VoiceOver label + disclosure value content.
//    • Telemetry — the P1/S11 `view.opened` slug, via a spy sink.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network, no
//  store, and no rendering host.
//

import XCTest
@testable import TeslaSync

final class CollapsibleCommandGroupTests: XCTestCase {
    // MARK: - Category adapter (web `CommandCategory` + `CATEGORY_META`)

    private let webOrderedIdentifiers = [
        "security", "climate", "climate_protection", "charging",
        "doors", "drive", "windows", "sunroof",
        "schedules", "alerts", "navigation", "software",
        "vehicle", "media"
    ]

    func testCategoryRawValuesAreVerbatimWebIdentifiersInOrder() {
        XCTAssertEqual(CollapsibleCommandCategory.allCases.map(\.rawValue), webOrderedIdentifiers)
    }

    func testCategoryHasFourteenCasesMatchingTheWebUnion() {
        XCTAssertEqual(CollapsibleCommandCategory.allCases.count, 14)
    }

    func testCategoryWebOrderIsTheDeclarationIndex() {
        for (index, category) in CollapsibleCommandCategory.allCases.enumerated() {
            XCTAssertEqual(category.webOrder, index, "\(category.rawValue) order")
        }
    }

    func testEveryCategoryHasNonEmptyLabelKeyFallbackAndIcon() {
        for category in CollapsibleCommandCategory.allCases {
            XCTAssertFalse(category.labelKey.isEmpty, "\(category.rawValue) labelKey")
            XCTAssertFalse(category.labelFallback.isEmpty, "\(category.rawValue) fallback")
            XCTAssertFalse(category.systemImage.isEmpty, "\(category.rawValue) icon")
            XCTAssertTrue(category.labelKey.hasPrefix("commands.cat."), "\(category.rawValue) keyspace")
        }
    }

    func testCategoryLabelKeysMatchWebCategoryMeta() {
        XCTAssertEqual(CollapsibleCommandCategory.security.labelKey, "commands.cat.security")
        XCTAssertEqual(CollapsibleCommandCategory.climateProtection.labelKey, "commands.cat.climateProtect")
        XCTAssertEqual(CollapsibleCommandCategory.media.labelKey, "commands.cat.media")
    }

    func testCategoryFallbacksMatchWebCategoryMeta() {
        XCTAssertEqual(CollapsibleCommandCategory.security.labelFallback, "Security & Access")
        XCTAssertEqual(CollapsibleCommandCategory.climateProtection.labelFallback, "Climate Protection")
        XCTAssertEqual(CollapsibleCommandCategory.alerts.labelFallback, "Alerts & Location")
    }

    func testCategoryIconsAreValidSemanticSymbols() {
        XCTAssertEqual(CollapsibleCommandCategory.charging.systemImage, "bolt.fill")
        XCTAssertEqual(CollapsibleCommandCategory.drive.systemImage, "car.fill")
        XCTAssertEqual(CollapsibleCommandCategory.vehicle.systemImage, "car.fill")
        XCTAssertEqual(CollapsibleCommandCategory.media.systemImage, "play.fill")
    }

    func testCategoryDecodesFromVerbatimWebIdentifier() {
        XCTAssertEqual(CollapsibleCommandCategory(web: "security"), .security)
        XCTAssertEqual(CollapsibleCommandCategory(web: "climate_protection"), .climateProtection)
        XCTAssertNil(CollapsibleCommandCategory(web: "not_a_category"))
        XCTAssertNil(CollapsibleCommandCategory(web: ""))
    }

    // MARK: - Persistence adapter (sessionStorage key + expansion resolution)

    func testStorageKeyMatchesWebSessionStorageContract() {
        XCTAssertEqual(
            CollapsibleCommandGroupAdapter.storageKey(vehicleID: 7, category: .climateProtection),
            "teslasync-cat-7-climate_protection"
        )
        XCTAssertEqual(
            CollapsibleCommandGroupAdapter.storageKey(vehicleID: 1, category: .security),
            "teslasync-cat-1-security"
        )
    }

    func testResolveExpansionDefersToDefaultWhenUnset() {
        XCTAssertTrue(CollapsibleCommandGroupAdapter.resolveExpansion(stored: nil, defaultOpen: true))
        XCTAssertFalse(CollapsibleCommandGroupAdapter.resolveExpansion(stored: nil, defaultOpen: false))
    }

    func testResolveExpansionReadsStoredFlagOverDefault() {
        XCTAssertTrue(CollapsibleCommandGroupAdapter.resolveExpansion(stored: "true", defaultOpen: false))
        XCTAssertFalse(CollapsibleCommandGroupAdapter.resolveExpansion(stored: "false", defaultOpen: true))
    }

    func testResolveExpansionTreatsUnknownStoredValueAsCollapsed() {
        // Web parity: `stored === 'true'` — anything else present is falsey.
        XCTAssertFalse(CollapsibleCommandGroupAdapter.resolveExpansion(stored: "garbage", defaultOpen: true))
        XCTAssertFalse(CollapsibleCommandGroupAdapter.resolveExpansion(stored: "TRUE", defaultOpen: true))
    }

    func testFlagForExpandedMatchesWebStringBoolean() {
        XCTAssertEqual(CollapsibleCommandGroupAdapter.flag(forExpanded: true), "true")
        XCTAssertEqual(CollapsibleCommandGroupAdapter.flag(forExpanded: false), "false")
    }

    // MARK: - Projection (cache → render config)

    func testProjectionDenormalizesCategoryMeta() {
        let projection = CollapsibleCommandGroupAdapter.project(
            category: .charging, vehicleID: 3, commandCount: 5
        )
        XCTAssertEqual(projection.category, .charging)
        XCTAssertEqual(projection.labelKey, "commands.cat.charging")
        XCTAssertEqual(projection.labelFallback, "Charging")
        XCTAssertEqual(projection.systemImage, "bolt.fill")
        XCTAssertEqual(projection.storageKey, "teslasync-cat-3-charging")
        XCTAssertEqual(projection.commandCount, 5)
        XCTAssertFalse(projection.isEmpty)
    }

    func testProjectionClampsNegativeCountToZeroAndIsEmpty() {
        let projection = CollapsibleCommandGroupAdapter.project(
            category: .media, vehicleID: 1, commandCount: -4
        )
        XCTAssertEqual(projection.commandCount, 0)
        XCTAssertTrue(projection.isEmpty)
        XCTAssertEqual(projection.countBadge, "(0)")
    }

    func testProjectionIsEmptyOnlyWhenCountIsZero() {
        XCTAssertFalse(
            CollapsibleCommandGroupAdapter.project(category: .doors, vehicleID: 1, commandCount: 1).isEmpty
        )
        XCTAssertTrue(
            CollapsibleCommandGroupAdapter.project(category: .doors, vehicleID: 1, commandCount: 0).isEmpty
        )
    }

    func testProjectionCountBadgeIsParenthesised() {
        let projection = CollapsibleCommandGroupAdapter.project(
            category: .windows, vehicleID: 2, commandCount: 12
        )
        XCTAssertEqual(projection.countBadge, "(12)")
    }

    // MARK: - Accessibility

    func testProjectionAccessibilityLabelCombinesLabelAndCount() {
        let projection = CollapsibleCommandGroupAdapter.project(
            category: .security, vehicleID: 1, commandCount: 3
        )
        XCTAssertEqual(projection.accessibilityLabel, "Security & Access, 3 commands")
    }

    func testProjectionAccessibilityValueReflectsExpansion() {
        let projection = CollapsibleCommandGroupAdapter.project(
            category: .drive, vehicleID: 1, commandCount: 2
        )
        XCTAssertEqual(projection.accessibilityValue(expanded: true), "Expanded")
        XCTAssertEqual(projection.accessibilityValue(expanded: false), "Collapsed")
    }

    // MARK: - Localization facade (P1/S10)

    func testStringsFacadeReturnsFallbackForMissingKey() {
        XCTAssertEqual(
            CollapsibleCommandGroupStrings.string("collapsibleGroup.nonexistent", "Fallback Copy"),
            "Fallback Copy"
        )
    }

    func testCategoryLabelResolvesThroughTheFacade() {
        XCTAssertEqual(CollapsibleCommandGroupStrings.categoryLabel(.charging), "Charging")
        XCTAssertEqual(CollapsibleCommandGroupStrings.categoryLabel(.navigation), "Navigation")
    }

    // MARK: - Telemetry (P1/S11 `view.opened`)

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(CollapsibleCommandGroupSurface.slug, "CollapsibleCommandGroup")
    }

    func testReportOpenEmitsExactlyTheSurfaceSlug() {
        let spy = SpyCollapsibleCommandGroupTelemetry()
        CollapsibleCommandGroupSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["CollapsibleCommandGroup"])
    }
}

// MARK: - Test doubles

/// Records every `view.opened` slug so the telemetry contract is assertable
/// without a real `os_log` sink.
private final class SpyCollapsibleCommandGroupTelemetry: CollapsibleCommandGroupTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var surfaces: [String] = []

    var openedSurfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return surfaces
    }

    func viewOpened(surface: String) {
        lock.lock()
        defer { lock.unlock() }
        surfaces.append(surface)
    }
}
