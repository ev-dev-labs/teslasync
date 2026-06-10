//
//  GeofenceDrawer.Tests.swift
//  TeslaSync — P4 modal/dialog · 0011 · GeofenceDrawer (Apple)
//
//  Adapter + geometry + draw-reducer coverage for the GeofenceDrawer surface — the pure port of
//  components/maps/GeofenceDrawer.tsx:
//    • `GeofenceDrawerMode` — the three modes, order, and the web default `['circle']`.
//    • `GeofenceGeometry.renderKind` — the verbatim `fenceToLayer` decision (circle wins; ≥3-ring
//      polygon; else none).
//    • `GeofenceGeometry.circle / rectangleRing / rectangle / polygon / corners` — the
//      `layerToGeometry` constructors, with the rectangle ring pinned verbatim.
//    • `GeofenceFormat.fixed` — the locale-independent `toFixed` parity.
//    • `GeofenceDraft` — the interactive create reducer (tap → point, slider → radius, commit).
//
//  Pure, bundle-free.
//

import XCTest
@testable import TeslaSync

// MARK: - Modes (web GeofenceMode)

final class GeofenceModeTests: XCTestCase {
    func testOrderMatchesWeb() {
        XCTAssertEqual(GeofenceDrawerMode.order.map(\.rawValue), ["circle", "polygon", "rectangle"])
    }

    func testDefaultModesIsCircleOnly() {
        XCTAssertEqual(GeofenceDrawerMode.defaultModes, [.circle])
    }

    func testEveryModeCarriesGlyphAndLabel() {
        for mode in GeofenceDrawerMode.order {
            XCTAssertEqual(mode.labelKey, "geofence.mode.\(mode.rawValue)")
            XCTAssertFalse(mode.labelFallback.isEmpty)
            XCTAssertFalse(mode.systemImage.isEmpty)
        }
    }
}

// MARK: - Point validity

final class GeofencePointTests: XCTestCase {
    func testValidRange() {
        XCTAssertTrue(GeofencePoint(lat: 37.77, lng: -122.41).isValid)
        XCTAssertTrue(GeofencePoint(lat: -90, lng: 180).isValid)
    }

    func testOutOfRangeIsInvalid() {
        XCTAssertFalse(GeofencePoint(lat: 91, lng: 0).isValid)
        XCTAssertFalse(GeofencePoint(lat: 0, lng: -181).isValid)
    }
}

// MARK: - renderKind (web fenceToLayer)

final class GeofenceRenderKindTests: XCTestCase {
    func testCircleWhenLatLngRadiusPositive() {
        let item = GeofenceItem(id: "1", lat: 37.7, lng: -122.4, radius: 300)
        XCTAssertEqual(
            GeofenceGeometry.renderKind(for: item),
            .circle(center: GeofencePoint(lat: 37.7, lng: -122.4), radius: 300)
        )
    }

    func testCircleWinsWhenBothCircleAndPolygonPresent() {
        let ring = [GeofencePoint(lat: 0, lng: 0), GeofencePoint(lat: 0, lng: 1), GeofencePoint(lat: 1, lng: 1)]
        let item = GeofenceItem(id: "1", lat: 1, lng: 2, radius: 50, polygon: ring)
        XCTAssertEqual(
            GeofenceGeometry.renderKind(for: item),
            .circle(center: GeofencePoint(lat: 1, lng: 2), radius: 50)
        )
    }

    func testPolygonWhenRingHasThreeOrMore() {
        let ring = [GeofencePoint(lat: 0, lng: 0), GeofencePoint(lat: 0, lng: 1), GeofencePoint(lat: 1, lng: 1)]
        let item = GeofenceItem(id: "1", polygon: ring)
        XCTAssertEqual(GeofenceGeometry.renderKind(for: item), .polygon(ring: ring))
    }

    func testNoneWhenRadiusZeroAndNoPolygon() {
        let item = GeofenceItem(id: "1", lat: 1, lng: 2, radius: 0)
        XCTAssertEqual(GeofenceGeometry.renderKind(for: item), GeofenceRenderKind.none)
    }

    func testNoneWhenPolygonTooSmall() {
        let item = GeofenceItem(id: "1", polygon: [GeofencePoint(lat: 0, lng: 0), GeofencePoint(lat: 1, lng: 1)])
        XCTAssertEqual(GeofenceGeometry.renderKind(for: item), GeofenceRenderKind.none)
    }
}

// MARK: - Geometry constructors (web layerToGeometry)

final class GeofenceGeometryTests: XCTestCase {
    func testCircleConstructor() {
        let geometry = GeofenceGeometry.circle(center: GeofencePoint(lat: 5, lng: 6), radius: 120)
        XCTAssertEqual(geometry, NewGeofence(shape: .circle, lat: 5, lng: 6, radius: 120))
    }

    func testRectangleRingOrderPinnedVerbatim() {
        let sw = GeofencePoint(lat: 0, lng: 0)
        let ne = GeofencePoint(lat: 10, lng: 20)
        XCTAssertEqual(GeofenceGeometry.rectangleRing(sw: sw, ne: ne), [
            GeofencePoint(lat: 0, lng: 0),
            GeofencePoint(lat: 10, lng: 0),
            GeofencePoint(lat: 10, lng: 20),
            GeofencePoint(lat: 0, lng: 20)
        ])
    }

    func testRectangleConstructorIsPolygonShape() {
        let geometry = GeofenceGeometry.rectangle(
            sw: GeofencePoint(lat: 0, lng: 0),
            ne: GeofencePoint(lat: 1, lng: 1)
        )
        XCTAssertEqual(geometry.shape, .rectangle)
        XCTAssertEqual(geometry.polygon?.count, 4)
        XCTAssertNil(geometry.lat)
    }

    func testPolygonConstructor() {
        let ring = [GeofencePoint(lat: 0, lng: 0), GeofencePoint(lat: 0, lng: 1), GeofencePoint(lat: 1, lng: 1)]
        XCTAssertEqual(GeofenceGeometry.polygon(ring: ring), NewGeofence(shape: .polygon, polygon: ring))
    }

    func testCornersNormalisesToSouthWestNorthEast() {
        let pair = GeofenceGeometry.corners(
            GeofencePoint(lat: 10, lng: 5),
            GeofencePoint(lat: 2, lng: 30)
        )
        XCTAssertEqual(pair.sw, GeofencePoint(lat: 2, lng: 5))
        XCTAssertEqual(pair.ne, GeofencePoint(lat: 10, lng: 30))
    }
}

// MARK: - Number formatting (web toFixed)

final class GeofenceFormatTests: XCTestCase {
    func testFixedZeroPlacesRounds() {
        XCTAssertEqual(GeofenceFormat.fixed(249.6, places: 0), "250")
        XCTAssertEqual(GeofenceFormat.fixed(250, places: 0), "250")
    }

    func testFixedFourPlacesForCoordinates() {
        XCTAssertEqual(GeofenceFormat.fixed(37.774929, places: 4), "37.7749")
        XCTAssertEqual(GeofenceFormat.fixed(-122.419418, places: 4), "-122.4194")
    }

    func testFixedClampsNegativePlaces() {
        XCTAssertEqual(GeofenceFormat.fixed(12.9, places: -3), "13")
    }

    func testFixedUsesDotSeparatorRegardlessOfLocale() {
        // en_US_POSIX guarantees a '.' even on comma-locale devices (web parity).
        XCTAssertTrue(GeofenceFormat.fixed(1.5, places: 1).contains("."))
    }
}

// MARK: - Draw reducer (web leaflet-draw create flow)

final class GeofenceDraftTests: XCTestCase {
    private let pointA = GeofencePoint(lat: 37.7, lng: -122.4)
    private let pointB = GeofencePoint(lat: 37.8, lng: -122.3)
    private let pointC = GeofencePoint(lat: 37.9, lng: -122.2)

    func testStartIsEmptyWithDefaultRadius() {
        let draft = GeofenceDraft.start(mode: .circle)
        XCTAssertEqual(draft.pointCount, 0)
        XCTAssertEqual(draft.radiusMeters, GeofenceDraft.defaultRadius)
        XCTAssertFalse(draft.canCommit)
    }

    func testCircleAddingReplacesCenterAndCommits() {
        var draft = GeofenceDraft.start(mode: .circle)
        draft = draft.adding(pointA).adding(pointB) // last tap wins as center
        XCTAssertEqual(draft.points, [pointB])
        XCTAssertTrue(draft.canCommit)
        XCTAssertEqual(draft.geometry(), GeofenceGeometry.circle(center: pointB, radius: GeofenceDraft.defaultRadius))
    }

    func testCircleCannotCommitWithZeroRadius() {
        let draft = GeofenceDraft.start(mode: .circle).adding(pointA).settingRadius(0)
        XCTAssertFalse(draft.canCommit)
        XCTAssertNil(draft.geometry())
    }

    func testPolygonNeedsThreeVertices() {
        var draft = GeofenceDraft.start(mode: .polygon).adding(pointA).adding(pointB)
        XCTAssertFalse(draft.canCommit)
        draft = draft.adding(pointC)
        XCTAssertTrue(draft.canCommit)
        XCTAssertEqual(draft.geometry(), GeofenceGeometry.polygon(ring: [pointA, pointB, pointC]))
    }

    func testRectangleCapsAtTwoCornersAndRestarts() {
        var draft = GeofenceDraft.start(mode: .rectangle).adding(pointA).adding(pointB)
        XCTAssertTrue(draft.canCommit)
        XCTAssertEqual(draft.points.count, 2)
        draft = draft.adding(pointC) // a third tap restarts
        XCTAssertEqual(draft.points, [pointC])
        XCTAssertFalse(draft.canCommit)
    }

    func testRectangleGeometryNormalisesCorners() {
        let draft = GeofenceDraft.start(mode: .rectangle)
            .adding(GeofencePoint(lat: 10, lng: 5))
            .adding(GeofencePoint(lat: 2, lng: 30))
        let geometry = draft.geometry()
        XCTAssertEqual(geometry?.shape, .rectangle)
        XCTAssertEqual(geometry?.polygon?.first, GeofencePoint(lat: 2, lng: 5))
    }

    func testSettingRadiusClampsToZero() {
        XCTAssertEqual(GeofenceDraft.start(mode: .circle).settingRadius(-50).radiusMeters, 0)
    }

    func testRemovingLastDropsTheLatestPoint() {
        let draft = GeofenceDraft.start(mode: .polygon).adding(pointA).adding(pointB).removingLast()
        XCTAssertEqual(draft.points, [pointA])
    }

    func testRemovingLastOnEmptyIsNoOp() {
        let draft = GeofenceDraft.start(mode: .polygon).removingLast()
        XCTAssertEqual(draft.pointCount, 0)
    }

    func testSettingModeClearsPoints() {
        let draft = GeofenceDraft.start(mode: .polygon).adding(pointA).settingMode(.circle)
        XCTAssertEqual(draft.mode, .circle)
        XCTAssertEqual(draft.pointCount, 0)
    }

    func testClearedKeepsModeAndRadius() {
        let draft = GeofenceDraft.start(mode: .circle).settingRadius(900).adding(pointA).cleared()
        XCTAssertEqual(draft.mode, .circle)
        XCTAssertEqual(draft.radiusMeters, 900)
        XCTAssertEqual(draft.pointCount, 0)
    }
}
