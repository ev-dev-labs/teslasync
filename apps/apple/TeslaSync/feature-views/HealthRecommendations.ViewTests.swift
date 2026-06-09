//
//  HealthRecommendations.ViewTests.swift
//  TeslaSync — P4 feature view · 0156 · HealthRecommendations (Apple)
//
//  Per-state view-render smoke tests for the Drivetrain Health recommendations surface: every render
//  state (loading / empty / error / stale / offline / content across good / warning / critical)
//  materializes through `ImageRenderer`. The model is driven by `InMemoryHealthRecommendationsSource`,
//  so the tests run with no network and no real store.
//

#if canImport(UIKit) || canImport(AppKit)
    import SwiftUI
    import XCTest
    @testable import TeslaSync

    @MainActor final class HealthRecommendationsViewStateTests: XCTestCase {
        private func renders(_ update: HealthRecommendationsUpdate) -> Bool {
            let source = InMemoryHealthRecommendationsSource(initial: update)
            let model = HealthRecommendationsModel(source: source)
            model.start()
            let renderer = ImageRenderer(content: HealthRecommendations(model: model).frame(width: 700, height: 520))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        private func loaded(
            _ health: HealthRecommendationsHealthStatus,
            connection: HealthRecommendationsConnection = .live
        ) -> HealthRecommendationsUpdate {
            HealthRecommendationsUpdate(
                status: .loaded,
                connection: connection,
                data: HealthRecommendationsInput(overallHealth: health)
            )
        }

        func testContentGoodRenders() {
            XCTAssertTrue(renders(loaded(.good)))
        }

        func testContentWarningRenders() {
            XCTAssertTrue(renders(loaded(.warning)))
        }

        func testContentCriticalRenders() {
            XCTAssertTrue(renders(loaded(.critical)))
        }

        func testEmptyRenders() {
            XCTAssertTrue(renders(HealthRecommendationsUpdate(status: .empty, data: nil)))
        }

        func testLoadingRenders() {
            XCTAssertTrue(renders(HealthRecommendationsUpdate(status: .loading)))
        }

        func testErrorRenders() {
            XCTAssertTrue(renders(HealthRecommendationsUpdate(status: .failed("offline"))))
        }

        func testStaleRenders() {
            XCTAssertTrue(renders(loaded(.warning, connection: .stale)))
        }

        func testOfflineRenders() {
            XCTAssertTrue(renders(loaded(.critical, connection: .offline)))
        }
    }
#endif
