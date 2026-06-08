//
//  PositionHeatmapWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0072 · PositionHeatmapWidget (Apple)
//
//  Unit coverage for the PositionHeatmapWidget surface:
//    • Adapter (cached → projection) — `PositionHeatmapBuilder` parity with the
//      web clusterPositions / centroid / intensityColor / responsive tables.
//    • State holder — `PositionHeatmapModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry + wiring.
//    • Registry — canonical `position-heatmap` metadata + size clamping.
//    • i18n facade — count/format resolution used by the badge + a11y value.
//
//  These run in the TeslaSync(/-macOS) XCTest targets, driven by
//  `InMemoryPositionHeatmapSource` (no network, no real store).
//

import CoreLocation
import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached positions → density projection (parity port)

@MainActor final class PositionHeatmapBuilderTests: XCTestCase {
    func testTierFromColumns() {
        XCTAssertEqual(PositionHeatmapBuilder.tier(forColumns: 0), .compact)
        XCTAssertEqual(PositionHeatmapBuilder.tier(forColumns: 1), .compact)
        XCTAssertEqual(PositionHeatmapBuilder.tier(forColumns: 2), .standard)
        XCTAssertEqual(PositionHeatmapBuilder.tier(forColumns: 3), .wide)
        XCTAssertEqual(PositionHeatmapBuilder.tier(forColumns: 4), .wide)
    }

    func testPrecisionPerTier() {
        XCTAssertEqual(PositionHeatmapBuilder.precision(for: .compact), 200)
        XCTAssertEqual(PositionHeatmapBuilder.precision(for: .standard), 500)
        XCTAssertEqual(PositionHeatmapBuilder.precision(for: .wide), 500)
    }

    func testClusterBucketsAveragesAndNormalises() {
        let positions = [
            HeatPosition(latitude: 37.0, longitude: -122.0),
            HeatPosition(latitude: 37.0, longitude: -122.0),
            HeatPosition(latitude: 37.0, longitude: -122.0),
            HeatPosition(latitude: 10.0, longitude: 10.0),
            HeatPosition(latitude: 0.0, longitude: 0.0) // null-island → skipped
        ]
        let clusters = PositionHeatmapBuilder.clusterPositions(positions, precision: 500)
        XCTAssertEqual(clusters.count, 2)
        // Insertion order preserved: the (37,-122) bucket is first.
        XCTAssertEqual(clusters[0].count, 3)
        XCTAssertEqual(clusters[0].intensity, 1.0, accuracy: 1e-9)
        XCTAssertEqual(clusters[0].latitude, 37.0, accuracy: 1e-9)
        XCTAssertEqual(clusters[1].count, 1)
        XCTAssertEqual(clusters[1].intensity, 1.0 / 3.0, accuracy: 1e-9)
    }

    func testClusterRunningAverageCentre() {
        let positions = [
            HeatPosition(latitude: 1.000, longitude: 1.000),
            HeatPosition(latitude: 1.001, longitude: 1.001)
        ]
        // Both fall in bucket Int(1.000*500)=500 / Int(1.0005*500)=500.
        let clusters = PositionHeatmapBuilder.clusterPositions(positions, precision: 500)
        XCTAssertEqual(clusters.count, 1)
        XCTAssertEqual(clusters[0].count, 2)
        XCTAssertEqual(clusters[0].latitude, 1.0005, accuracy: 1e-9)
        XCTAssertEqual(clusters[0].longitude, 1.0005, accuracy: 1e-9)
    }

    func testClusterSkipsNullIslandOnly() {
        // (0, 5) is NOT null-island (only both-zero is skipped).
        let clusters = PositionHeatmapBuilder.clusterPositions(
            [HeatPosition(latitude: 0.0, longitude: 5.0)],
            precision: 500
        )
        XCTAssertEqual(clusters.count, 1)
        XCTAssertEqual(clusters[0].count, 1)
    }

    func testCentroidAveragesClusters() {
        let clusters = [
            HeatCluster(id: 0, latitude: 37.0, longitude: -122.0, count: 3, intensity: 1),
            HeatCluster(id: 1, latitude: 10.0, longitude: 10.0, count: 1, intensity: 0.33)
        ]
        let center = PositionHeatmapBuilder.centroid(clusters)
        XCTAssertEqual(center.latitude, 23.5, accuracy: 1e-9)
        XCTAssertEqual(center.longitude, -56.0, accuracy: 1e-9)
    }

    func testCentroidFallbackWhenEmpty() {
        let center = PositionHeatmapBuilder.centroid([])
        XCTAssertEqual(center.latitude, 37.7749, accuracy: 1e-9)
        XCTAssertEqual(center.longitude, -122.4194, accuracy: 1e-9)
    }

    func testIntensityRGBEndpoints() {
        let low = PositionHeatmapBuilder.intensityRGB(0)
        XCTAssertEqual(low.red, 20.0 / 255, accuracy: 1e-9)
        XCTAssertEqual(low.green, 184.0 / 255, accuracy: 1e-9)
        XCTAssertEqual(low.blue, 166.0 / 255, accuracy: 1e-9)

        let high = PositionHeatmapBuilder.intensityRGB(1)
        XCTAssertEqual(high.red, 245.0 / 255, accuracy: 1e-9)
        XCTAssertEqual(high.green, 64.0 / 255, accuracy: 1e-9)
        XCTAssertEqual(high.blue, 226.0 / 255, accuracy: 1e-9)
    }

    func testFillOpacityPerTier() {
        XCTAssertEqual(PositionHeatmapBuilder.fillOpacity(0, tier: .compact), 0.4, accuracy: 1e-9)
        XCTAssertEqual(PositionHeatmapBuilder.fillOpacity(1, tier: .compact), 0.9, accuracy: 1e-9)
        XCTAssertEqual(PositionHeatmapBuilder.fillOpacity(0, tier: .standard), 0.35, accuracy: 1e-9)
        XCTAssertEqual(PositionHeatmapBuilder.fillOpacity(1, tier: .wide), 0.9, accuracy: 1e-9)
    }

    func testRadiusPerTier() {
        XCTAssertEqual(PositionHeatmapBuilder.radius(0, tier: .compact), 4, accuracy: 1e-9)
        XCTAssertEqual(PositionHeatmapBuilder.radius(1, tier: .compact), 10, accuracy: 1e-9)
        XCTAssertEqual(PositionHeatmapBuilder.radius(1, tier: .standard), 16, accuracy: 1e-9)
        XCTAssertEqual(PositionHeatmapBuilder.radius(1, tier: .wide), 20, accuracy: 1e-9)
    }

    func testZoomPerTier() {
        XCTAssertEqual(PositionHeatmapBuilder.zoom(for: .compact), 11, accuracy: 1e-9)
        XCTAssertEqual(PositionHeatmapBuilder.zoom(for: .standard), 11, accuracy: 1e-9)
        XCTAssertEqual(PositionHeatmapBuilder.zoom(for: .wide), 12, accuracy: 1e-9)
    }

    func testRegionSpanFromZoom() {
        let region = PositionHeatmapBuilder.region(
            center: CLLocationCoordinate2D(latitude: 1, longitude: 2),
            zoom: 11
        )
        XCTAssertEqual(region.center.latitude, 1, accuracy: 1e-9)
        XCTAssertEqual(region.center.longitude, 2, accuracy: 1e-9)
        XCTAssertEqual(region.span.longitudeDelta, 360.0 / 2048.0, accuracy: 1e-12)
        XCTAssertEqual(region.span.latitudeDelta, (360.0 / 2048.0) * 0.7, accuracy: 1e-12)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class PositionHeatmapModelTests: XCTestCase {
    private func makeModel(
        _ update: PositionHeatmapUpdate,
        telemetry: PositionHeatmapTelemetry = OSLogPositionHeatmapTelemetry()
    ) -> (PositionHeatmapModel, InMemoryPositionHeatmapSource) {
        let source = InMemoryPositionHeatmapSource(initial: update)
        let model = PositionHeatmapModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(PositionHeatmapUpdate(status: .loading, positions: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(PositionHeatmapUpdate(status: .loaded, positions: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testEmptyStatusShowsEmpty() {
        let (model, _) = makeModel(PositionHeatmapUpdate(status: .empty, positions: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutDataShowsError() {
        let (model, _) = makeModel(PositionHeatmapUpdate(status: .failed("boom"), positions: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileLoadingOrFailed() {
        let sample = [HeatPosition(latitude: 37, longitude: -122)]
        let (loading, _) = makeModel(PositionHeatmapUpdate(status: .loading, positions: sample))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(PositionHeatmapUpdate(status: .failed("net"), positions: sample))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyPositionHeatmapTelemetry()
        let (model, source) = makeModel(PositionHeatmapUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [PositionHeatmapWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(PositionHeatmapUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndPositionsTrackUpdates() {
        let (model, source) = makeModel(PositionHeatmapUpdate(status: .loading))
        model.start()
        source.push(
            PositionHeatmapUpdate(
                status: .loaded,
                connection: .offline,
                positions: [HeatPosition(latitude: 1, longitude: 2)],
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.totalPositions, 1)
    }
}

// MARK: - Registry parity

@MainActor final class PositionHeatmapRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = PositionHeatmapWidget.registration
        XCTAssertEqual(registration.id, "position-heatmap")
        XCTAssertEqual(registration.category, "maps")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = PositionHeatmapWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)), DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 12)),
            DashboardWidgetSize(cols: 3, rows: 12)
        )
    }
}

// MARK: - i18n facade content

@MainActor final class PositionHeatmapStringsTests: XCTestCase {
    func testCountFormatsValue() {
        let label = PositionHeatmapStrings.count("widget.positionHeatmap.count", "%lld positions", 3)
        XCTAssertEqual(label, "3 positions")
    }

    func testFormatHandlesMultipleArguments() {
        let value = PositionHeatmapStrings.format(
            "widget.positionHeatmap.a11yValue",
            "%lld positions across %lld areas",
            5,
            2
        )
        XCTAssertEqual(value, "5 positions across 2 areas")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyPositionHeatmapTelemetry: PositionHeatmapTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
