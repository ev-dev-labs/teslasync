//
//  WidgetMapView.Tests.swift
//  TeslaSync — P4 widget primitive · 0008 · WidgetMapView (Apple)
//
//  The SwiftUI / MapKit composition half of the coverage (the pure adapter + state-holder + facade live in
//  WidgetMapView.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • Views — the public surface composes in every real branch (empty / populated / compact / childless),
//      via the prop initializer, the no-content convenience, and the injected-model seam.
//    • Subviews — the empty leaf, the empty map content, and the MapKit canvas compose.
//    • Per-state render — the pure-SwiftUI empty leaf renders to an image (ImageRenderer); the live MapKit
//      canvas is composed structurally (its offscreen pixel snapshot is unreliable in a headless XCTest
//      host, so it is exercised in the app-hosted P99 gate, not pixel-asserted here).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store.
//

import MapKit
import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum MapFixture {
    static let center = CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194)

    @MapContentBuilder static func marker() -> some MapContent {
        Marker("Vehicle", systemImage: "car.fill", coordinate: center)
    }

    static func canvas(compact: Bool = false) -> WidgetMapCanvas {
        WidgetMapViewProjector.canvas(
            WidgetMapInput(centerLatitude: center.latitude, centerLongitude: center.longitude, compact: compact)
        )
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class WidgetMapViewCompositionTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = WidgetMapView(center: MapFixture.center) { MapFixture.marker() }
        _ = WidgetMapView(center: MapFixture.center, zoom: 14, compact: true) { MapFixture.marker() }
        _ = WidgetMapView(center: MapFixture.center, isEmpty: true) { MapFixture.marker() }
    }

    func testChildlessConvenienceComposes() {
        _ = WidgetMapView(center: MapFixture.center)
        _ = WidgetMapView(center: MapFixture.center, compact: true)
        _ = WidgetMapView(center: MapFixture.center, isEmpty: true)
        _ = WidgetMapView(center: MapFixture.center, emptyMessage: "Custom empty")
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = WidgetMapViewModel(
            input: WidgetMapInput(centerLatitude: MapFixture.center.latitude, centerLongitude: -122.41),
            telemetry: OSLogWidgetMapViewTelemetry()
        )
        _ = WidgetMapView(model: injected) { MapFixture.marker() }
        XCTAssertEqual(WidgetMapView<WidgetMapEmptyContent>.surfaceSlug, "WidgetMapView")
    }
}

// MARK: - Subviews

@MainActor
final class WidgetMapViewSubviewTests: XCTestCase {
    func testSubviewsCompose() {
        _ = WidgetMapEmptyState(message: WidgetMapViewStrings.emptyMessage)
        _ = WidgetMapEmptyContent()
        _ = WidgetMapCanvasView(canvas: MapFixture.canvas()) { MapFixture.marker() }
        _ = WidgetMapCanvasView(canvas: MapFixture.canvas(compact: true)) { MapFixture.marker() }
    }
}

// MARK: - Per-state render smoke

@MainActor
final class WidgetMapViewRenderTests: XCTestCase {
    private func assertRenders(_ view: some View, _ message: String, width: CGFloat, height: CGFloat) {
        let renderer = ImageRenderer(content: view.frame(width: width, height: height))
        #if canImport(UIKit)
            XCTAssertNotNil(renderer.uiImage, message)
        #elseif canImport(AppKit)
            XCTAssertNotNil(renderer.nsImage, message)
        #endif
    }

    func testRendersEmptyLeaf() {
        assertRenders(
            WidgetMapView(center: MapFixture.center, isEmpty: true),
            "empty leaf should render",
            width: 320,
            height: 220
        )
    }

    func testRendersEmptyLeafWithCustomMessage() {
        assertRenders(
            WidgetMapEmptyState(message: "No location data available"),
            "empty leaf subview should render",
            width: 320,
            height: 220
        )
    }
}
