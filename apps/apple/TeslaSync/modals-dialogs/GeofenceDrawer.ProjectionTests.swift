//
//  GeofenceDrawer.ProjectionTests.swift
//  TeslaSync — P4 modal/dialog · 0011 · GeofenceDrawer (Apple)
//
//  Projection + describe + accessibility coverage, split from GeofenceDrawer.Tests.swift for the
//  lint file-length budget:
//    • `GeofenceDescribe.text` — the verbatim `describeFence` port (circle / polygon / name).
//    • `GeofenceDrawerProjection` — phase resolution, renderable filtering, describe rows, the
//      camera-fit points, and the `modes` fallback.
//    • `GeofenceDrawerAccessibility` — the dialog summary, mode labels, and the draw hints.
//    • `GeofenceDrawerSurface.slug` — the diagnostics slug.
//
//  Pure: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - describeFence

final class GeofenceDescribeTests: XCTestCase {
    func testCircleDescriptionWithName() {
        let item = GeofenceItem(id: "1", name: "Home", lat: 37.774929, lng: -122.419418, radius: 250)
        XCTAssertEqual(
            GeofenceDescribe.text(for: item, localize: passthroughLocalize),
            "Home — 250m circle around 37.7749, -122.4194"
        )
    }

    func testCircleDescriptionFallsBackToDefaultName() {
        let item = GeofenceItem(id: "1", lat: 1, lng: 2, radius: 100)
        XCTAssertEqual(
            GeofenceDescribe.text(for: item, localize: passthroughLocalize),
            "Geofence — 100m circle around 1.0000, 2.0000"
        )
    }

    func testCircleDescriptionUsesPresenceNotPositiveRadius() {
        // Web `describeFence` guards on `typeof radius === 'number'`, NOT radius > 0 — so a
        // zero-radius fence still reads as a circle (this differs from `renderKind`).
        let item = GeofenceItem(id: "1", name: "Pin", lat: 0, lng: 0, radius: 0)
        XCTAssertEqual(
            GeofenceDescribe.text(for: item, localize: passthroughLocalize),
            "Pin — 0m circle around 0.0000, 0.0000"
        )
    }

    func testPolygonDescription() {
        let ring = [
            GeofencePoint(lat: 0, lng: 0), GeofencePoint(lat: 0, lng: 1),
            GeofencePoint(lat: 1, lng: 1), GeofencePoint(lat: 1, lng: 0)
        ]
        let item = GeofenceItem(id: "1", name: "Yard", polygon: ring)
        XCTAssertEqual(
            GeofenceDescribe.text(for: item, localize: passthroughLocalize),
            "Yard — 4-vertex polygon"
        )
    }

    func testNameOnlyFallsBackToName() {
        let item = GeofenceItem(id: "1", name: "Mystery")
        XCTAssertEqual(GeofenceDescribe.text(for: item, localize: passthroughLocalize), "Mystery")
    }

    func testNoGeometryNoNameFallsBackToDefault() {
        XCTAssertEqual(
            GeofenceDescribe.text(for: GeofenceItem(id: "1"), localize: passthroughLocalize),
            "Geofence"
        )
    }
}

// MARK: - Phase resolution

final class GeofenceProjectionPhaseTests: XCTestCase {
    private let fence = GeofenceItem(id: "1", lat: 1, lng: 2, radius: 50)

    func testLoadingResolvesByResolution() {
        XCTAssertEqual(GeofenceDrawerProjection.resolvePhase(status: .loading, fences: nil), .loading)
        XCTAssertEqual(GeofenceDrawerProjection.resolvePhase(status: .loading, fences: []), .empty)
        XCTAssertEqual(GeofenceDrawerProjection.resolvePhase(status: .loading, fences: [fence]), .content)
    }

    func testLoadedResolvesEmptyOrContent() {
        XCTAssertEqual(GeofenceDrawerProjection.resolvePhase(status: .loaded, fences: []), .empty)
        XCTAssertEqual(GeofenceDrawerProjection.resolvePhase(status: .loaded, fences: [fence]), .content)
    }

    func testFailedResolvesErrorOrKeepsSurface() {
        XCTAssertEqual(
            GeofenceDrawerProjection.resolvePhase(status: .failed("boom"), fences: nil),
            .error("boom")
        )
        XCTAssertEqual(GeofenceDrawerProjection.resolvePhase(status: .failed("boom"), fences: []), .empty)
        XCTAssertEqual(GeofenceDrawerProjection.resolvePhase(status: .failed("boom"), fences: [fence]), .content)
    }
}

// MARK: - Renderables / rows / camera / modes

final class GeofenceProjectionDataTests: XCTestCase {
    func testRenderablesSkipUndrawableFences() {
        let fences = [
            GeofenceItem(id: "circle", lat: 1, lng: 2, radius: 50),
            GeofenceItem(id: "blank"), // no geometry → skipped
            GeofenceItem(id: "poly", polygon: [
                GeofencePoint(lat: 0, lng: 0), GeofencePoint(lat: 0, lng: 1), GeofencePoint(lat: 1, lng: 1)
            ])
        ]
        let renderables = GeofenceDrawerProjection.renderables(from: fences)
        XCTAssertEqual(renderables.map(\.id), ["circle", "poly"])
    }

    func testRowsAreDescribedInOrder() {
        let fences = [
            GeofenceItem(id: "1", name: "Home", lat: 1, lng: 2, radius: 100),
            GeofenceItem(id: "2", name: "Office", lat: 3, lng: 4, radius: 200)
        ]
        let rows = GeofenceDrawerProjection.rows(from: fences, localize: passthroughLocalize)
        XCTAssertEqual(rows.map(\.id), ["1", "2"])
        XCTAssertTrue(rows[0].text.contains("Home"))
        XCTAssertTrue(rows[1].text.contains("Office"))
    }

    func testCameraPointsFlattenCentersAndRings() {
        let renderables = [
            GeofenceRenderable(id: "c", kind: .circle(center: GeofencePoint(lat: 1, lng: 2), radius: 5), name: nil),
            GeofenceRenderable(id: "p", kind: .polygon(ring: [
                GeofencePoint(lat: 3, lng: 4), GeofencePoint(lat: 5, lng: 6)
            ]), name: nil)
        ]
        XCTAssertEqual(GeofenceDrawerProjection.cameraPoints(from: renderables).count, 3)
    }

    func testModesFallBackToDefaultWhenEmpty() {
        XCTAssertEqual(GeofenceDrawerProjection.modes(from: []), [.circle])
    }

    func testModesAreOrderedAndDeduped() {
        let resolved = GeofenceDrawerProjection.modes(from: [.rectangle, .circle, .circle])
        XCTAssertEqual(resolved, [.circle, .rectangle])
    }
}

// MARK: - Accessibility + slug

final class GeofenceAccessibilityTests: XCTestCase {
    func testSummaryIsTitle() {
        XCTAssertEqual(GeofenceDrawerAccessibility.summary(localize: passthroughLocalize), "Geofences")
    }

    func testModeLabelAppendsSelectedState() {
        XCTAssertEqual(
            GeofenceDrawerAccessibility.modeLabel(.circle, selected: false, localize: passthroughLocalize),
            "Circle"
        )
        XCTAssertEqual(
            GeofenceDrawerAccessibility.modeLabel(.circle, selected: true, localize: passthroughLocalize),
            "Circle, selected"
        )
    }

    func testDraftHintTracksCircleProgress() {
        let empty = GeofenceDraft.start(mode: .circle)
        XCTAssertEqual(
            GeofenceDrawerAccessibility.draftHint(empty, localize: passthroughLocalize),
            "Tap the map to set the circle center"
        )
        let placed = empty.adding(GeofencePoint(lat: 1, lng: 1))
        XCTAssertEqual(
            GeofenceDrawerAccessibility.draftHint(placed, localize: passthroughLocalize),
            "Adjust the slider to set the radius"
        )
    }

    func testDraftHintCountsPolygonVerticesNeeded() {
        let draft = GeofenceDraft.start(mode: .polygon).adding(GeofencePoint(lat: 1, lng: 1))
        XCTAssertEqual(
            GeofenceDrawerAccessibility.draftHint(draft, localize: passthroughLocalize),
            "Tap to add a vertex (2 more needed)"
        )
    }

    func testDraftHintRectangleSteps() {
        let first = GeofenceDraft.start(mode: .rectangle)
        XCTAssertEqual(
            GeofenceDrawerAccessibility.draftHint(first, localize: passthroughLocalize),
            "Tap the first corner"
        )
        let second = first.adding(GeofencePoint(lat: 1, lng: 1))
        XCTAssertEqual(
            GeofenceDrawerAccessibility.draftHint(second, localize: passthroughLocalize),
            "Tap the opposite corner"
        )
    }

    func testSurfaceSlug() {
        XCTAssertEqual(GeofenceDrawerSurface.slug, "GeofenceDrawer")
    }
}
