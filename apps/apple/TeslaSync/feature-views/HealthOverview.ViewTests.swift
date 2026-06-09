//
//  HealthOverview.ViewTests.swift
//  TeslaSync — P4 feature view · 0155 · HealthOverview (Apple)
//
//  Per-state view-render smoke tests for the Drivetrain Health overview surface: every render
//  state (loading / empty / error / stale / offline / content across good / warning / critical)
//  materializes through `ImageRenderer`. The model is driven by `InMemoryHealthOverviewSource`, so
//  the tests run with no network and no real store.
//

#if canImport(UIKit) || canImport(AppKit)
    import SwiftUI
    import XCTest
    @testable import TeslaSync

    @MainActor final class HealthOverviewViewStateTests: XCTestCase {
        private func renders(_ update: HealthOverviewUpdate) -> Bool {
            let source = InMemoryHealthOverviewSource(initial: update)
            let model = HealthOverviewModel(source: source)
            model.start()
            let renderer = ImageRenderer(content: HealthOverview(model: model).frame(width: 700, height: 280))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        private func data(
            _ health: HealthOverviewHealthStatus,
            score: Double,
            motor: String
        ) -> HealthOverviewInput {
            HealthOverviewInput(overallHealth: health, healthScore: score, motorStatus: motor)
        }

        func testContentGoodRenders() {
            XCTAssertTrue(renders(HealthOverviewUpdate(
                status: .loaded,
                data: data(.good, score: 95, motor: "Optimal")
            )))
        }

        func testContentWarningRenders() {
            XCTAssertTrue(
                renders(HealthOverviewUpdate(status: .loaded, data: data(.warning, score: 60, motor: "Degraded")))
            )
        }

        func testContentCriticalRenders() {
            XCTAssertTrue(
                renders(HealthOverviewUpdate(status: .loaded, data: data(.critical, score: 25, motor: "Throttled")))
            )
        }

        func testEmptyRenders() {
            XCTAssertTrue(renders(HealthOverviewUpdate(status: .empty, data: nil)))
        }

        func testLoadingRenders() {
            XCTAssertTrue(renders(HealthOverviewUpdate(status: .loading)))
        }

        func testErrorRenders() {
            XCTAssertTrue(renders(HealthOverviewUpdate(status: .failed("offline"))))
        }

        func testStaleRenders() {
            XCTAssertTrue(
                renders(
                    HealthOverviewUpdate(
                        status: .loaded,
                        connection: .stale,
                        data: data(.warning, score: 60, motor: "Degraded")
                    )
                )
            )
        }

        func testOfflineRenders() {
            XCTAssertTrue(
                renders(
                    HealthOverviewUpdate(
                        status: .loaded,
                        connection: .offline,
                        data: data(.good, score: 95, motor: "Optimal")
                    )
                )
            )
        }
    }
#endif
