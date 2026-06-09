//
//  AccordionSection.Tests.swift
//  TeslaSync — P4 feature view · 0236 · AccordionSection (Apple)
//
//  Host-free unit coverage for the accordion section:
//    • State holder — `AccordionSectionModel` starts at `defaultOpen`, toggles open/closed
//      (web header click + Enter/Space), and exposes the chevron rotation projection
//      (web `open && 'rotate-180'`).
//    • Telemetry — `start()` emits `view.opened` with the surface slug exactly once
//      (P1/S11), and toggling does not re-emit.
//    • Accessibility — the per-state spoken value (web `aria-expanded`) + action hint, the
//      strings facade fallbacks (P1/S10), and a per-state projection bundle that pins the
//      full collapsed/expanded contract in one place (the host-free stand-in for a pixel
//      snapshot, since the surface is pure presentation over these projected values).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no host, no KMP: the
//  model is Foundation/Observation/OSLog only and is driven directly.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder + chevron projection (web `useState` + `rotate-180`)

@MainActor
final class AccordionSectionModelTests: XCTestCase {
    private func makeModel(
        defaultOpen: Bool = false,
        telemetry: any AccordionSectionTelemetry = SpyAccordionTelemetry()
    ) -> AccordionSectionModel {
        AccordionSectionModel(defaultOpen: defaultOpen, telemetry: telemetry)
    }

    func testStartsCollapsedByDefault() {
        let model = makeModel()
        XCTAssertFalse(model.isOpen)
        XCTAssertEqual(model.chevronRotationDegrees, 0)
    }

    func testDefaultOpenStartsExpanded() {
        let model = makeModel(defaultOpen: true)
        XCTAssertTrue(model.isOpen)
        XCTAssertEqual(model.chevronRotationDegrees, 180)
    }

    func testToggleFlipsOpenState() {
        let model = makeModel()

        model.toggle()
        XCTAssertTrue(model.isOpen)
        XCTAssertEqual(model.chevronRotationDegrees, 180)

        model.toggle()
        XCTAssertFalse(model.isOpen)
        XCTAssertEqual(model.chevronRotationDegrees, 0)
    }

    func testSetOpenSetsStateExplicitly() {
        let model = makeModel()

        model.setOpen(true)
        XCTAssertTrue(model.isOpen)

        model.setOpen(false)
        XCTAssertFalse(model.isOpen)
    }
}

// MARK: - Telemetry (P1/S11 view.opened)

@MainActor
final class AccordionSectionTelemetryTests: XCTestCase {
    func testStartEmitsViewOpenedOnceWithSlug() {
        let spy = SpyAccordionTelemetry()
        let model = AccordionSectionModel(telemetry: spy)

        model.start()

        XCTAssertEqual(spy.openedSurfaces, ["AccordionSection"])
    }

    func testStartIsIdempotent() {
        let spy = SpyAccordionTelemetry()
        let model = AccordionSectionModel(telemetry: spy)

        model.start()
        model.start()
        model.start()

        XCTAssertEqual(spy.openedSurfaces, ["AccordionSection"])
    }

    func testTogglingDoesNotEmitTelemetry() {
        let spy = SpyAccordionTelemetry()
        let model = AccordionSectionModel(telemetry: spy)

        model.start()
        model.toggle()
        model.toggle()

        XCTAssertEqual(spy.openedSurfaces, ["AccordionSection"])
    }

    func testReportOpenEmitsSurfaceSlug() {
        let spy = SpyAccordionTelemetry()
        AccordionSectionSurface.reportOpen(to: spy)
        XCTAssertEqual(spy.openedSurfaces, ["AccordionSection"])
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(AccordionSectionSurface.slug, "AccordionSection")
        XCTAssertEqual(AccordionSectionModel.surfaceSlug, AccordionSectionSurface.slug)
    }
}

// MARK: - Accessibility value + hint (web aria-expanded) and strings facade (P1/S10)

@MainActor
final class AccordionSectionAccessibilityTests: XCTestCase {
    func testAccessibilityValuePerState() {
        let model = AccordionSectionModel(telemetry: SpyAccordionTelemetry())

        XCTAssertEqual(model.accessibilityValue, "Collapsed")
        model.toggle()
        XCTAssertEqual(model.accessibilityValue, "Expanded")
    }

    func testAccessibilityHintPerState() {
        let model = AccordionSectionModel(telemetry: SpyAccordionTelemetry())

        XCTAssertEqual(model.accessibilityHint, "Expands this section")
        model.toggle()
        XCTAssertEqual(model.accessibilityHint, "Collapses this section")
    }

    func testStringsFacadeValueFallbacks() {
        XCTAssertEqual(AccordionSectionStrings.accessibilityValue(isOpen: true), "Expanded")
        XCTAssertEqual(AccordionSectionStrings.accessibilityValue(isOpen: false), "Collapsed")
    }

    func testStringsFacadeHintFallbacks() {
        XCTAssertEqual(AccordionSectionStrings.accessibilityHint(isOpen: true), "Collapses this section")
        XCTAssertEqual(AccordionSectionStrings.accessibilityHint(isOpen: false), "Expands this section")
    }
}

// MARK: - Per-state projection bundle (host-free stand-in for a per-state snapshot)

@MainActor
final class AccordionSectionProjectionTests: XCTestCase {
    /// The full projected contract for one render state — what the view binds to.
    private struct Projection: Equatable {
        let isOpen: Bool
        let chevronRotationDegrees: Double
        let accessibilityValue: String
        let accessibilityHint: String
    }

    private func projection(of model: AccordionSectionModel) -> Projection {
        Projection(
            isOpen: model.isOpen,
            chevronRotationDegrees: model.chevronRotationDegrees,
            accessibilityValue: model.accessibilityValue,
            accessibilityHint: model.accessibilityHint
        )
    }

    func testCollapsedStateProjection() {
        let model = AccordionSectionModel(defaultOpen: false, telemetry: SpyAccordionTelemetry())
        XCTAssertEqual(
            projection(of: model),
            Projection(
                isOpen: false,
                chevronRotationDegrees: 0,
                accessibilityValue: "Collapsed",
                accessibilityHint: "Expands this section"
            )
        )
    }

    func testExpandedStateProjection() {
        let model = AccordionSectionModel(defaultOpen: true, telemetry: SpyAccordionTelemetry())
        XCTAssertEqual(
            projection(of: model),
            Projection(
                isOpen: true,
                chevronRotationDegrees: 180,
                accessibilityValue: "Expanded",
                accessibilityHint: "Collapses this section"
            )
        )
    }

    func testToggleMovesBetweenTheTwoProjections() {
        let model = AccordionSectionModel(defaultOpen: false, telemetry: SpyAccordionTelemetry())
        let collapsed = projection(of: model)
        model.toggle()
        let expanded = projection(of: model)

        XCTAssertNotEqual(collapsed, expanded)
        XCTAssertEqual(expanded.accessibilityValue, "Expanded")
        model.toggle()
        XCTAssertEqual(projection(of: model), collapsed)
    }
}

// MARK: - Test doubles

/// Records the surfaces opened so the `view.opened` contract can be asserted without an
/// `os_log` round-trip. Single-threaded test usage only.
private final class SpyAccordionTelemetry: AccordionSectionTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}
