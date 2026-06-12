//
//  LinearSidebar.Tests.swift
//  TeslaSync — P4 shared surface · 0174 · LinearSidebar (Apple)
//
//  The model + view-composition + i18n + accessibility half of the coverage (the pure value types,
//  active-path, filter and projection live in LinearSidebar.AdapterTests.swift +
//  LinearSidebar.ProjectionTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • LinearSidebarModel — initial collapse (only the active section open), toggle, filter + clear,
//      pin/unpin forwarding, the activeSection auto-expand on re-bind, the once-only `view.opened`.
//    • Views — the sidebar, rows (active / pin / unpin), header, badges, favorites header, empty branches,
//      the inspector + samples compose; copy resolves through P1/S10.
//    • Accessibility — every interactive element's label is present in the resolved presentation (the row
//      title, the pin/unpin label, the count-chip label, the nav region label).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the model is in-process.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - LinearSidebarModel (web collapsed / filter / activeSectionTitle effect)

@MainActor
final class LinearSidebarModelTests: XCTestCase {
    func testInitialCollapseOpensOnlyActiveSection() {
        let model = LinearSidebarSampleData.model(activePath: "/vehicles")
        let sections = model.presentation.sections
        XCTAssertEqual(sections.first { $0.id == "vehicle" }?.isExpanded, true)
        XCTAssertEqual(sections.first { $0.id == "overview" }?.isExpanded, false)
        XCTAssertEqual(model.activeSection, "vehicle")
    }

    func testToggleSectionFlipsExpansion() {
        let model = LinearSidebarSampleData.model(activePath: "/vehicles")
        XCTAssertEqual(model.presentation.sections.first { $0.id == "overview" }?.isExpanded, false)
        model.toggleSection("overview")
        XCTAssertEqual(model.presentation.sections.first { $0.id == "overview" }?.isExpanded, true)
        model.toggleSection("overview")
        XCTAssertEqual(model.presentation.sections.first { $0.id == "overview" }?.isExpanded, false)
    }

    func testSetFilterActivatesAndClearRestores() {
        let model = LinearSidebarSampleData.model()
        model.setFilter("zzz")
        XCTAssertTrue(model.presentation.isFilterActive)
        XCTAssertTrue(model.presentation.isEmptyFilterResult)
        XCTAssertEqual(model.filterText, "zzz")
        model.clearFilter()
        XCTAssertFalse(model.presentation.isFilterActive)
        XCTAssertFalse(model.presentation.isEmptyFilterResult)
        XCTAssertEqual(model.filterText, "")
    }

    func testPinAndUnpinForwardToCallbacks() {
        let recorder = PinRecorder()
        let model = LinearSidebarModel(
            input: LinearSidebarSampleData.input(),
            localize: { _, fallback in fallback },
            onPin: { recorder.pinned.append($0) },
            onUnpin: { recorder.unpinned.append($0) }
        )
        model.pin("/trips")
        model.unpin("/dashboard")
        XCTAssertEqual(recorder.pinned, ["/trips"])
        XCTAssertEqual(recorder.unpinned, ["/dashboard"])
    }

    func testReBindAutoExpandsNewActiveSection() {
        let model = LinearSidebarSampleData.model(activePath: "/dashboard")
        XCTAssertEqual(model.presentation.sections.first { $0.id == "vehicle" }?.isExpanded, false)
        model.update(input: LinearSidebarSampleData.input(activePath: "/charging"))
        XCTAssertEqual(model.activeSection, "vehicle")
        XCTAssertEqual(
            model.presentation.sections.first { $0.id == "vehicle" }?.isExpanded,
            true,
            "navigating into a collapsed section auto-expands it (web activeSectionTitle effect)"
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyLinearSidebarTelemetry()
        let model = LinearSidebarModel(
            input: LinearSidebarSampleData.input(),
            telemetry: spy,
            localize: { _, fallback in fallback }
        )
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [LinearSidebarSurface.slug], "view.opened fires once per instance")
    }

    func testFilterPromptResolvesThroughLocalizer() {
        let model = LinearSidebarModel(
            input: LinearSidebarSampleData.emptyInput,
            localize: { _, fallback in fallback }
        )
        XCTAssertEqual(model.localizedFilterPrompt, "Filter")
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class LinearSidebarViewTests: XCTestCase {
    func testSidebarComposesForEveryBranch() {
        _ = LinearSidebar(model: LinearSidebarSampleData.model())
        _ = LinearSidebar(model: LinearSidebarSampleData.model(filter: "char"))
        _ = LinearSidebar(model: LinearSidebarSampleData.model(filter: "zzz"))
        _ = LinearSidebar(
            input: LinearSidebarSampleData.input(),
            onNavigate: { _ in },
            onPin: { _ in },
            onUnpin: { _ in }
        )
    }

    func testRowAndChromeCompose() throws {
        let presentation = LinearSidebarSampleData.model().presentation
        let row = presentation.sections.first?.rows.first
        _ = try LinearSidebarNavRow(row: XCTUnwrap(row), onSelect: {}, onPinToggle: {})
        _ = LinearSidebarSectionHeader(title: "Vehicle", count: 3, isExpanded: true, onToggle: {})
        _ = LinearSidebarFavoritesHeader(label: "Favorites")
        _ = LinearSidebarTrailingBadge(trailing: .notificationDot)
        _ = LinearSidebarTrailingBadge(trailing: .count(text: "5", accessibilityLabel: "5 vehicles"))
        _ = LinearSidebarEmptyFilter(message: "No matches.", clearLabel: "Clear filter", onClear: {})
        _ = LinearSidebarEmptyState(message: "No navigation items.")
    }

    func testInspectorAndSamplesCompose() {
        _ = LinearSidebarInspector()
        XCTAssertEqual(LinearSidebarSampleData.sections.count, 3)
        XCTAssertEqual(LinearSidebarSampleData.pinnedItems.count, 2)
        XCTAssertTrue(LinearSidebarSampleData.emptyInput.sections.isEmpty)
    }
}

// MARK: - Accessibility (labels present on every interactive element)

@MainActor
final class LinearSidebarAccessibilityTests: XCTestCase {
    func testRowsCarryTitleAndAffordanceLabels() throws {
        let presentation = LinearSidebarSampleData.model().presentation

        for section in presentation.sections {
            for row in section.rows {
                XCTAssertFalse(row.title.isEmpty, "every row has a VoiceOver label")
                if case let .pin(label) = row.pinAffordance {
                    XCTAssertTrue(label.contains(row.title), "pin label names the page")
                }
            }
        }

        let favoriteRow = try XCTUnwrap(presentation.favorites?.rows.first)
        if case let .unpin(label) = favoriteRow.pinAffordance {
            XCTAssertTrue(label.contains(favoriteRow.title), "unpin label names the page")
        } else {
            XCTFail("favorites rows carry an unpin affordance with a label")
        }
    }

    func testCountChipCarriesAccessibilityLabel() {
        let presentation = LinearSidebarSampleData.model().presentation
        let vehicleRow = presentation.sections
            .flatMap(\.rows)
            .first { $0.path == "/vehicles" }
        guard case let .count(_, label)? = vehicleRow?.trailing else {
            return XCTFail("the vehicles row carries a count chip")
        }
        XCTAssertEqual(label, "5 vehicles")
    }

    func testNavRegionLabelResolves() {
        XCTAssertEqual(LinearSidebarSampleData.model().presentation.sidebarLabel, "Sidebar navigation")
    }
}

// MARK: - i18n facade

final class LinearSidebarStringsTests: XCTestCase {
    func testFacadeReturnsFallbackWhenKeyAbsent() {
        XCTAssertEqual(LinearSidebarStrings.string("nav.favorites", "Favorites"), "Favorites")
        XCTAssertEqual(LinearSidebarStrings.localize("any.key", "Fallback"), "Fallback")
        XCTAssertEqual(LinearSidebarStrings.table, "LinearSidebar")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyLinearSidebarTelemetry: LinearSidebarTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}

/// Captures pin / unpin intents forwarded by the model. MainActor-isolated (the callbacks are `@MainActor`).
@MainActor
private final class PinRecorder {
    var pinned: [String] = []
    var unpinned: [String] = []
}
