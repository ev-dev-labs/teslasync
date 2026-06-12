//
//  WidgetMapView.AdapterTests.swift
//  TeslaSync — P4 widget primitive · 0008 · WidgetMapView (Apple)
//
//  The pure-core coverage (the Foundation-only adapter + state-holder): the surface identity, the input
//  defaults (web `zoom = 13` / `compact = false` / `isEmpty = false`), the coordinate / zoom sanitization,
//  the Leaflet-zoom → MapKit-span math (positive, halves per zoom step, narrows with latitude, clamped),
//  the `compact` interaction / controls decisions (web `!compact`), the render-branch projection (web
//  `isEmpty ? <EmptyState/> : <MapContainer/>`), the model's once-only `view.opened` (P1/S11) + prop
//  re-derivation, and the P1/S10 facade fallbacks. Split from WidgetMapView.Tests.swift (the SwiftUI /
//  MapKit composition half) to keep each file within the SwiftLint file-length budget and so this half
//  runs on a plain host with no SwiftUI / MapKit. These run in the TeslaSync(/-macOS) XCTest targets; the
//  derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class WidgetMapViewAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(WidgetMapViewSurface.slug, "WidgetMapView")
    }
}

// MARK: - WidgetMapInput defaults (web props)

final class WidgetMapInputTests: XCTestCase {
    func testDefaultsMatchWebProps() {
        let input = WidgetMapInput(centerLatitude: 37.77, centerLongitude: -122.41)
        XCTAssertEqual(input.zoom, 13)
        XCTAssertFalse(input.compact)
        XCTAssertFalse(input.isEmpty)
    }

    func testEquatable() {
        let lhs = WidgetMapInput(centerLatitude: 1, centerLongitude: 2, zoom: 10)
        let rhs = WidgetMapInput(centerLatitude: 1, centerLongitude: 2, zoom: 10)
        let other = WidgetMapInput(centerLatitude: 1, centerLongitude: 2, zoom: 11)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, other)
    }
}

// MARK: - Sanitization

final class WidgetMapGeometrySanitizeTests: XCTestCase {
    func testLatitudeClampsAndDefaultsNonFinite() {
        XCTAssertEqual(WidgetMapGeometry.sanitizeLatitude(37.5), 37.5, accuracy: 1e-9)
        XCTAssertEqual(WidgetMapGeometry.sanitizeLatitude(120), 90, accuracy: 1e-9)
        XCTAssertEqual(WidgetMapGeometry.sanitizeLatitude(-120), -90, accuracy: 1e-9)
        XCTAssertEqual(WidgetMapGeometry.sanitizeLatitude(.nan), 0)
        XCTAssertEqual(WidgetMapGeometry.sanitizeLatitude(.infinity), 0)
    }

    func testLongitudeClampsAndDefaultsNonFinite() {
        XCTAssertEqual(WidgetMapGeometry.sanitizeLongitude(-122.4), -122.4, accuracy: 1e-9)
        XCTAssertEqual(WidgetMapGeometry.sanitizeLongitude(200), 180, accuracy: 1e-9)
        XCTAssertEqual(WidgetMapGeometry.sanitizeLongitude(-200), -180, accuracy: 1e-9)
        XCTAssertEqual(WidgetMapGeometry.sanitizeLongitude(.nan), 0)
    }

    func testZoomClampsAndDefaultsNonFinite() {
        XCTAssertEqual(WidgetMapGeometry.sanitizeZoom(13), 13, accuracy: 1e-9)
        XCTAssertEqual(WidgetMapGeometry.sanitizeZoom(0), WidgetMapGeometry.minZoom, accuracy: 1e-9)
        XCTAssertEqual(WidgetMapGeometry.sanitizeZoom(99), WidgetMapGeometry.maxZoom, accuracy: 1e-9)
        XCTAssertEqual(WidgetMapGeometry.sanitizeZoom(.nan), WidgetMapGeometry.defaultZoom, accuracy: 1e-9)
    }
}

// MARK: - Leaflet-zoom → MapKit-span math

final class WidgetMapGeometrySpanTests: XCTestCase {
    func testMetersPerPixelIsPositiveAndHalvesPerZoomStep() {
        let coarse = WidgetMapGeometry.metersPerPixel(latitude: 0, zoom: 10)
        let fine = WidgetMapGeometry.metersPerPixel(latitude: 0, zoom: 11)
        XCTAssertGreaterThan(coarse, 0)
        XCTAssertEqual(coarse / fine, 2, accuracy: 1e-6)
    }

    func testSpanDecreasesWithZoom() {
        let zoomedOut = WidgetMapGeometry.spanMeters(latitude: 0, zoom: 10)
        let mid = WidgetMapGeometry.spanMeters(latitude: 0, zoom: 13)
        let zoomedIn = WidgetMapGeometry.spanMeters(latitude: 0, zoom: 16)
        XCTAssertGreaterThan(zoomedOut, mid)
        XCTAssertGreaterThan(mid, zoomedIn)
    }

    func testSpanNarrowsWithLatitudeViaCosine() {
        let equator = WidgetMapGeometry.spanMeters(latitude: 0, zoom: 13)
        let midLatitude = WidgetMapGeometry.spanMeters(latitude: 60, zoom: 13)
        // cos(60°) = 0.5 → the high-latitude span is ~half the equatorial span.
        XCTAssertEqual(midLatitude / equator, 0.5, accuracy: 0.01)
    }

    func testSpanIsClampedAtBothEnds() {
        // zoom 1 at the equator overflows one tile → clamped to the ceiling.
        XCTAssertEqual(
            WidgetMapGeometry.spanMeters(latitude: 0, zoom: 1),
            WidgetMapGeometry.maxSpanMeters,
            accuracy: 1e-3
        )
        // zoom 22 collapses below the floor → clamped to the floor.
        XCTAssertEqual(
            WidgetMapGeometry.spanMeters(latitude: 0, zoom: 22),
            WidgetMapGeometry.minSpanMeters,
            accuracy: 1e-3
        )
    }

    func testSpanIsFiniteForNonFiniteInputs() {
        let span = WidgetMapGeometry.spanMeters(latitude: .nan, zoom: .infinity)
        XCTAssertTrue(span.isFinite)
        XCTAssertGreaterThanOrEqual(span, WidgetMapGeometry.minSpanMeters)
    }
}

// MARK: - compact interaction / controls decisions (web `!compact`)

final class WidgetMapGeometryInteractionTests: XCTestCase {
    func testInteractiveOnlyOutsideCompact() {
        XCTAssertTrue(WidgetMapGeometry.isInteractive(compact: false))
        XCTAssertFalse(WidgetMapGeometry.isInteractive(compact: true))
    }

    func testControlsOnlyOutsideCompact() {
        XCTAssertTrue(WidgetMapGeometry.showsControls(compact: false))
        XCTAssertFalse(WidgetMapGeometry.showsControls(compact: true))
    }
}

// MARK: - Projector (web render branch)

final class WidgetMapViewProjectorTests: XCTestCase {
    func testIsEmptyProjectsToEmptyRegardlessOfCenter() {
        let input = WidgetMapInput(centerLatitude: 37, centerLongitude: -122, isEmpty: true)
        XCTAssertEqual(WidgetMapViewProjector.resolve(input), .empty)
    }

    func testPopulatedProjectsToMapWithSanitizedCanvas() {
        let input = WidgetMapInput(centerLatitude: 37.7749, centerLongitude: -122.4194, zoom: 13)
        guard case let .map(canvas) = WidgetMapViewProjector.resolve(input) else {
            return XCTFail("expected a map projection")
        }
        XCTAssertEqual(canvas.centerLatitude, 37.7749, accuracy: 1e-6)
        XCTAssertEqual(canvas.centerLongitude, -122.4194, accuracy: 1e-6)
        XCTAssertGreaterThan(canvas.spanMeters, 0)
        XCTAssertTrue(canvas.isInteractive)
        XCTAssertTrue(canvas.showsControls)
    }

    func testCompactCanvasDisablesInteractionAndControls() {
        let input = WidgetMapInput(centerLatitude: 1, centerLongitude: 2, compact: true)
        let canvas = WidgetMapViewProjector.canvas(input)
        XCTAssertFalse(canvas.isInteractive)
        XCTAssertFalse(canvas.showsControls)
    }

    func testCanvasSanitizesAnInvalidCenter() {
        let input = WidgetMapInput(centerLatitude: .nan, centerLongitude: 999)
        let canvas = WidgetMapViewProjector.canvas(input)
        XCTAssertEqual(canvas.centerLatitude, 0)
        XCTAssertEqual(canvas.centerLongitude, 180)
        XCTAssertTrue(canvas.spanMeters.isFinite)
    }
}

// MARK: - Model (telemetry + derivation)

@MainActor
final class WidgetMapViewModelTests: XCTestCase {
    private func model(
        _ input: WidgetMapInput,
        telemetry: WidgetMapViewTelemetry = OSLogWidgetMapViewTelemetry()
    ) -> WidgetMapViewModel {
        WidgetMapViewModel(input: input, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(WidgetMapInput(centerLatitude: 1, centerLongitude: 2), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [WidgetMapViewSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(WidgetMapInput(centerLatitude: 1, centerLongitude: 2), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [WidgetMapViewSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsEmptyAndMap() {
        XCTAssertEqual(
            model(WidgetMapInput(centerLatitude: 1, centerLongitude: 2, isEmpty: true)).projection,
            .empty
        )
        guard case .map = model(WidgetMapInput(centerLatitude: 1, centerLongitude: 2)).projection else {
            return XCTFail("expected a map projection")
        }
    }

    func testUpdateReDerivesProjectionFromEmptyToMap() {
        let holder = model(WidgetMapInput(centerLatitude: 1, centerLongitude: 2, isEmpty: true))
        XCTAssertEqual(holder.projection, .empty)
        holder.update(WidgetMapInput(centerLatitude: 1, centerLongitude: 2, isEmpty: false))
        guard case .map = holder.projection else {
            return XCTFail("expected a map projection after update")
        }
    }

    func testUpdateToCompactTogglesInteractionAndControls() {
        let holder = model(WidgetMapInput(centerLatitude: 1, centerLongitude: 2))
        guard case let .map(before) = holder.projection else {
            return XCTFail("expected a map projection")
        }
        XCTAssertTrue(before.isInteractive)
        holder.update(WidgetMapInput(centerLatitude: 1, centerLongitude: 2, compact: true))
        guard case let .map(after) = holder.projection else {
            return XCTFail("expected a map projection after update")
        }
        XCTAssertFalse(after.isInteractive)
        XCTAssertFalse(after.showsControls)
    }
}

// MARK: - Strings facade (P1/S10)

final class WidgetMapViewStringsTests: XCTestCase {
    func testTableName() {
        XCTAssertEqual(WidgetMapViewStrings.table, "WidgetMapView")
    }

    /// The per-surface table is not loaded into the unit-test host's main bundle, so the facade returns
    /// the supplied web English fallback — proving the view never shows a raw key.
    func testFallbacksResolve() {
        XCTAssertEqual(WidgetMapViewStrings.emptyMessage, "No location data available")
        XCTAssertFalse(WidgetMapViewStrings.emptyHint.isEmpty)
        XCTAssertFalse(WidgetMapViewStrings.accessibilityLabel.isEmpty)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: WidgetMapViewTelemetry, @unchecked Sendable {
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
