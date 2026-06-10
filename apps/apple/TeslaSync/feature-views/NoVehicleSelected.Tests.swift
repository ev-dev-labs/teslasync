//
//  NoVehicleSelected.Tests.swift
//  TeslaSync — P4 feature view · 0193 · NoVehicleSelected (Apple)
//
//  Adapter + accessibility coverage for the NoVehicleSelected surface:
//    • `NoVehicleSelectedProjectionBuilder` — phase resolution across resolving / resolved
//      (none + some) / failed, and that the projection carries the selected reference into
//      the content phase and the failure message into the error phase.
//    • `NoVehicleSelectedCopy` — the "{{name}}" ready-body interpolation.
//    • `NoVehicleSelectedAccessibility` — the per-phase VoiceOver summary content.
//
//  The state-holder coverage lives in NoVehicleSelected.ModelTests.swift. Pure, bundle-free:
//  copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real
/// copy without a bundle.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private enum NoVehicleSelectedSampleSelection {
    static let vehicle = SelectedVehicleRef(id: "veh_1", displayName: "Midnight Model 3")
}

// MARK: - Adapter: phase resolution

final class NoVehicleSelectedPhaseTests: XCTestCase {
    func testResolvingResolvesLoading() {
        XCTAssertEqual(NoVehicleSelectedProjectionBuilder.resolvePhase(.resolving), .loading)
    }

    func testResolvedNoneResolvesEmpty() {
        XCTAssertEqual(NoVehicleSelectedProjectionBuilder.resolvePhase(.resolved(nil)), .empty)
    }

    func testResolvedSomeResolvesContent() {
        XCTAssertEqual(
            NoVehicleSelectedProjectionBuilder.resolvePhase(.resolved(NoVehicleSelectedSampleSelection.vehicle)),
            .content
        )
    }

    func testFailedResolvesError() {
        XCTAssertEqual(
            NoVehicleSelectedProjectionBuilder.resolvePhase(.failed(message: "boom")),
            .error("boom")
        )
    }
}

// MARK: - Adapter: projection payload

final class NoVehicleSelectedProjectionTests: XCTestCase {
    func testResolvingProjectionHasNoSelectionOrError() {
        let projection = NoVehicleSelectedProjectionBuilder.build(.resolving)
        XCTAssertEqual(projection.phase, .loading)
        XCTAssertNil(projection.selected)
        XCTAssertNil(projection.errorMessage)
    }

    func testResolvedNoneProjectionIsEmptyWithNoSelection() {
        let projection = NoVehicleSelectedProjectionBuilder.build(.resolved(nil))
        XCTAssertEqual(projection.phase, .empty)
        XCTAssertNil(projection.selected)
    }

    func testResolvedSomeProjectionCarriesSelection() {
        let projection = NoVehicleSelectedProjectionBuilder.build(.resolved(NoVehicleSelectedSampleSelection.vehicle))
        XCTAssertEqual(projection.phase, .content)
        XCTAssertEqual(projection.selected, NoVehicleSelectedSampleSelection.vehicle)
    }

    func testFailedProjectionCarriesMessage() {
        let projection = NoVehicleSelectedProjectionBuilder.build(.failed(message: "token revoked"))
        XCTAssertEqual(projection.phase, .error("token revoked"))
        XCTAssertEqual(projection.errorMessage, "token revoked")
    }
}

// MARK: - Adapter: copy interpolation

final class NoVehicleSelectedCopyTests: XCTestCase {
    func testReadyBodyInterpolatesName() {
        XCTAssertEqual(
            NoVehicleSelectedCopy.readyBody(name: "Midnight Model 3", localize: passthroughLocalize),
            "Midnight Model 3 is ready — your data is available."
        )
    }

    func testReadyBodyWithEmptyNameKeepsTemplateShape() {
        XCTAssertEqual(
            NoVehicleSelectedCopy.readyBody(name: "", localize: passthroughLocalize),
            " is ready — your data is available."
        )
    }
}

// MARK: - Accessibility

final class NoVehicleSelectedAccessibilityTests: XCTestCase {
    private func summary(_ feed: SelectedVehicleFeedPhase) -> String {
        NoVehicleSelectedAccessibility.summary(
            for: NoVehicleSelectedProjectionBuilder.build(feed),
            localize: passthroughLocalize
        )
    }

    func testLoadingSummary() {
        XCTAssertEqual(summary(.resolving), "Checking your garage…")
    }

    func testEmptySummaryIncludesTitleAndDescription() {
        let label = summary(.resolved(nil))
        XCTAssertTrue(label.contains("No vehicle selected"))
        XCTAssertTrue(label.contains("Add a vehicle to your fleet to see data on this page."))
    }

    func testContentSummaryIncludesVehicleName() {
        let label = summary(.resolved(NoVehicleSelectedSampleSelection.vehicle))
        XCTAssertTrue(label.contains("Vehicle selected"))
        XCTAssertTrue(label.contains("Midnight Model 3"))
    }

    func testErrorSummaryIncludesTitleAndMessage() {
        let label = summary(.failed(message: "token revoked"))
        XCTAssertTrue(label.contains("Couldn't load your vehicles"))
        XCTAssertTrue(label.contains("token revoked"))
    }
}
