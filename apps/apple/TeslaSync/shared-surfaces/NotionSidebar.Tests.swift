//
//  NotionSidebar.Tests.swift
//  TeslaSync — P4 shared surface · 0175 · NotionSidebar (Apple)
//
//  The model + view-composition + i18n + accessibility half of the coverage (the pure value types,
//  active-path, filter and projection live in NotionSidebar.AdapterTests.swift +
//  NotionSidebar.ProjectionTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • NotionSidebarModel — initial collapse (only the active section open), toggle, filter + clear,
//      pin/unpin forwarding, the activeSection auto-expand on re-bind, the once-only `view.opened`.
//    • Views — the sidebar, rows (active / pin / unpin), section row, group labels, badges, empty branches,
//      the inspector + samples compose; copy resolves through P1/S10.
//    • Accessibility — every interactive element's label is present in the resolved presentation (the row
//      title, the pin/unpin label naming the page, the count-chip label, the nav region label).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the model is in-process.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - NotionSidebarModel (web collapsed / filter / activeSectionTitle effect)

@MainActor
final class NotionSidebarModelTests: XCTestCase {
    func testInitialCollapseOpensOnlyActiveSection() {
        let model = NotionSidebarSampleData.model(activePath: "/vehicles")
        let sections = model.presentation.sections
        XCTAssertEqual(sections.first { $0.id == "vehicle" }?.isExpanded, true)
        XCTAssertEqual(sections.first { $0.id == "overview" }?.isExpanded, false)
        XCTAssertEqual(model.activeSection, "vehicle")
    }

    func testToggleSectionFlipsExpansion() {
        let model = NotionSidebarSampleData.model(activePath: "/vehicles")
        XCTAssertEqual(model.presentation.sections.first { $0.id == "overview" }?.isExpanded, false)
        model.toggleSection("overview")
        XCTAssertEqual(model.presentation.sections.first { $0.id == "overview" }?.isExpanded, true)
        model.toggleSection("overview")
        XCTAssertEqual(model.presentation.sections.first { $0.id == "overview" }?.isExpanded, false)
    }

    func testSetFilterActivatesAndClearRestores() {
        let model = NotionSidebarSampleData.model()
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
        let model = NotionSidebarModel(
            input: NotionSidebarSampleData.input(),
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
        let model = NotionSidebarSampleData.model(activePath: "/dashboard")
        XCTAssertEqual(model.presentation.sections.first { $0.id == "vehicle" }?.isExpanded, false)
        model.update(input: NotionSidebarSampleData.input(activePath: "/charging"))
        XCTAssertEqual(model.activeSection, "vehicle")
        XCTAssertEqual(
            model.presentation.sections.first { $0.id == "vehicle" }?.isExpanded,
            true,
            "navigating into a collapsed section auto-expands it (web activeSectionTitle effect)"
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyNotionSidebarTelemetry()
        let model = NotionSidebarModel(
            input: NotionSidebarSampleData.input(),
            telemetry: spy,
            localize: { _, fallback in fallback }
        )
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [NotionSidebarSurface.slug], "view.opened fires once per instance")
    }

    func testFilterPromptResolvesThroughLocalizer() {
        let model = NotionSidebarModel(
            input: NotionSidebarSampleData.emptyInput,
            localize: { _, fallback in fallback }
        )
        XCTAssertEqual(model.localizedFilterPrompt, "Filter")
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class NotionSidebarViewTests: XCTestCase {
    func testSidebarComposesForEveryBranch() {
        _ = NotionSidebar(model: NotionSidebarSampleData.model())
        _ = NotionSidebar(model: NotionSidebarSampleData.model(filter: "char"))
        _ = NotionSidebar(model: NotionSidebarSampleData.model(filter: "zzz"))
        _ = NotionSidebar(
            input: NotionSidebarSampleData.input(),
            onNavigate: { _ in },
            onPin: { _ in },
            onUnpin: { _ in }
        )
    }

    func testRowAndChromeCompose() throws {
        let presentation = NotionSidebarSampleData.model().presentation
        let row = presentation.sections.first?.rows.first
        _ = try NotionSidebarNavRow(row: XCTUnwrap(row), onSelect: {}, onPinToggle: {})
        _ = NotionSidebarSectionRow(
            title: "Vehicle",
            glyphSystemImage: "car.2",
            count: 3,
            isExpanded: true,
            onToggle: {}
        )
        _ = NotionSidebarGroupLabel(label: "Favorites")
        _ = NotionSidebarGroupLabel(label: "Pages")
        _ = NotionSidebarTrailingBadge(trailing: .notificationDot)
        _ = NotionSidebarTrailingBadge(trailing: .count(text: "5", accessibilityLabel: "5 vehicles"))
        _ = NotionSidebarEmptyFilter(message: "No matches.", clearLabel: "Clear filter", onClear: {})
        _ = NotionSidebarEmptyState(message: "No navigation items.")
    }

    func testInspectorAndSamplesCompose() {
        _ = NotionSidebarInspector()
        XCTAssertEqual(NotionSidebarSampleData.sections.count, 3)
        XCTAssertEqual(NotionSidebarSampleData.pinnedItems.count, 2)
        XCTAssertTrue(NotionSidebarSampleData.emptyInput.sections.isEmpty)
    }
}

// MARK: - Accessibility (labels present on every interactive element)

@MainActor
final class NotionSidebarAccessibilityTests: XCTestCase {
    func testEveryRowCarriesTitleAndAffordanceLabel() throws {
        let presentation = NotionSidebarSampleData.model().presentation

        for section in presentation.sections {
            for row in section.rows {
                XCTAssertFalse(row.title.isEmpty, "every row has a VoiceOver label")
                switch row.pinAffordance {
                case let .pin(label), let .unpin(label):
                    XCTAssertTrue(label.contains(row.title), "the pin/unpin label names the page")
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
        let presentation = NotionSidebarSampleData.model().presentation
        let vehicleRow = presentation.sections
            .flatMap(\.rows)
            .first { $0.path == "/vehicles" }
        guard case let .count(_, label)? = vehicleRow?.trailing else {
            return XCTFail("the vehicles row carries a count chip")
        }
        XCTAssertEqual(label, "5 vehicles")
    }

    func testNavRegionLabelResolves() {
        XCTAssertEqual(NotionSidebarSampleData.model().presentation.sidebarLabel, "Sidebar navigation")
    }
}

// MARK: - i18n facade

final class NotionSidebarStringsTests: XCTestCase {
    func testFacadeReturnsFallbackWhenKeyAbsent() {
        XCTAssertEqual(NotionSidebarStrings.string("nav.pages", "Pages"), "Pages")
        XCTAssertEqual(NotionSidebarStrings.localize("any.key", "Fallback"), "Fallback")
        XCTAssertEqual(NotionSidebarStrings.table, "NotionSidebar")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies the
/// `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyNotionSidebarTelemetry: NotionSidebarTelemetry, @unchecked Sendable {
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
