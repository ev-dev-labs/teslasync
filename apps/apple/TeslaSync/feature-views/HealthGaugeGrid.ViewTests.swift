//
//  HealthGaugeGrid.ViewTests.swift
//  TeslaSync — P4 feature view · 0154 · HealthGaugeGrid (Apple)
//
//  Per-state view-render smoke tests for the Drivetrain Health gauge-grid surface: every render
//  state (loading / empty / error / stale / offline / content / content-with-stats-loading)
//  materializes through `ImageRenderer`. The model is driven by `InMemoryHealthGaugeGridSource`,
//  so the tests run with no network and no real store.
//

#if canImport(UIKit) || canImport(AppKit)
    import SwiftUI
    import XCTest
    @testable import TeslaSync

    @MainActor
    final class HealthGaugeGridViewStateTests: XCTestCase {
        private func renders(_ update: HealthGaugeGridUpdate) -> Bool {
            let source = InMemoryHealthGaugeGridSource(initial: update)
            let model = HealthGaugeGridModel(source: source)
            model.start()
            let renderer = ImageRenderer(content: HealthGaugeGrid(model: model).frame(width: 700, height: 360))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        private func sample(includeStats: Bool = true) -> DrivetrainHealthInput {
            DrivetrainHealthInput(
                overallHealth: .good,
                healthScore: 95,
                motorStatus: "Optimal",
                activeSensorCount: 6,
                stats: includeStats
                    ? DriveStatsInput(
                        totalDrives: 1284,
                        totalDistanceMeters: 12000,
                        avgSpeedMetersPerSecond: 20,
                        topSpeedMetersPerSecond: 30
                    )
                    : nil
            )
        }

        func testContentRenders() {
            XCTAssertTrue(renders(HealthGaugeGridUpdate(status: .loaded, data: sample())))
        }

        func testContentWithStatsLoadingRenders() {
            XCTAssertTrue(renders(HealthGaugeGridUpdate(status: .loaded, data: sample(includeStats: false))))
        }

        func testEmptyRenders() {
            XCTAssertTrue(renders(HealthGaugeGridUpdate(status: .empty, data: nil)))
        }

        func testLoadingRenders() {
            XCTAssertTrue(renders(HealthGaugeGridUpdate(status: .loading)))
        }

        func testErrorRenders() {
            XCTAssertTrue(renders(HealthGaugeGridUpdate(status: .failed("offline"))))
        }

        func testStaleRenders() {
            XCTAssertTrue(renders(HealthGaugeGridUpdate(status: .loaded, connection: .stale, data: sample())))
        }

        func testOfflineRenders() {
            XCTAssertTrue(renders(HealthGaugeGridUpdate(status: .loaded, connection: .offline, data: sample())))
        }
    }
#endif
