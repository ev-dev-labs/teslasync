//
//  MoreDetailsPanel.ModelTests.swift
//  TeslaSync — P4 feature view · 0145 · MoreDetailsPanel (Apple)
//
//  State-holder coverage for `MoreDetailsModel`: phase resolution across loading / empty /
//  error / content, the cached-stays-content-while-failing rule, refresh delegation, the
//  one-per-episode stale auto-refresh, the P1/S11 `view.opened` telemetry, and connection /
//  refreshing tracking. The model is driven by `InMemoryMoreDetailsSource` — no network, no
//  real store. (Split from `MoreDetailsPanel.Tests.swift` to keep each file within the
//  file-length budget.)
//
//  The whole file is gated on `canImport(XCTest)`: the feature-views group is a member of the
//  app targets as well as the test bundle, and the app targets do not link XCTest. The guard
//  means this file compiles to nothing there (so it never breaks the app build) while still
//  compiling and running in the XCTest bundle.
//

#if canImport(XCTest)
    import XCTest
    @testable import TeslaSync

    @MainActor final class MoreDetailsModelTests: XCTestCase {
        private func makeModel(
            _ update: MoreDetailsUpdate,
            telemetry: MoreDetailsTelemetry = OSLogMoreDetailsTelemetry()
        ) -> (MoreDetailsModel, InMemoryMoreDetailsSource) {
            let source = InMemoryMoreDetailsSource(initial: update)
            let model = MoreDetailsModel(source: source, telemetry: telemetry)
            return (model, source)
        }

        private func sampleInput() -> MoreDetailsInput {
            MoreDetailsInput(
                odometerStart: 12345,
                odometerEnd: 12378,
                avgPower: 22.5,
                minSpd: 8,
                startBatteryPct: 82,
                endBatteryPct: 68
            )
        }

        private func loaded(_ connection: MoreDetailsConnection = .live) -> MoreDetailsUpdate {
            MoreDetailsUpdate(
                status: .loaded,
                input: sampleInput(),
                unitPrefs: MoreDetailsUnitPrefs(distance: "mi", speed: "mph", temperature: "°F", locale: "en-US"),
                connection: connection,
                updatedAt: Date()
            )
        }

        func testInitialContentPhaseAndTiles() {
            let (model, _) = makeModel(loaded())
            model.start()
            XCTAssertEqual(model.phase, .content)
            XCTAssertEqual(model.tiles.primary.count, 6)
            XCTAssertFalse(model.tiles.secondary.isEmpty)
        }

        func testLoadingAndErrorPhases() {
            let (loading, _) = makeModel(MoreDetailsUpdate(status: .loading))
            loading.start()
            XCTAssertEqual(loading.phase, .loading)

            let (failed, _) = makeModel(MoreDetailsUpdate(status: .failed("boom")))
            failed.start()
            XCTAssertEqual(failed.phase, .error("boom"))
        }

        func testEmptyPhaseStillProjectsFallbackTiles() {
            let (model, _) = makeModel(MoreDetailsUpdate(status: .empty, input: nil))
            model.start()
            XCTAssertEqual(model.phase, .empty)
            XCTAssertEqual(model.tiles.primary.count, 6)
        }

        func testCachedInputStaysContentWhileFailing() {
            let (model, source) = makeModel(loaded())
            model.start()
            source.push(
                MoreDetailsUpdate(
                    status: .failed("net"),
                    input: sampleInput(),
                    unitPrefs: MoreDetailsUnitPrefs(distance: "mi", speed: "mph"),
                    connection: .stale
                )
            )
            XCTAssertEqual(model.phase, .content)
            XCTAssertEqual(model.connection, .stale)
        }

        func testRefreshDelegates() {
            let (model, source) = makeModel(loaded())
            model.start()
            model.refresh()
            model.refresh()
            XCTAssertEqual(source.refreshCount, 2)
        }

        func testStaleAutoRefreshFiresOncePerEpisode() {
            let (model, source) = makeModel(loaded(.live))
            model.start()
            XCTAssertEqual(source.refreshCount, 0)
            source.push(loaded(.stale))
            source.push(loaded(.stale))
            XCTAssertEqual(source.refreshCount, 1)
            source.push(loaded(.live))
            source.push(loaded(.stale))
            XCTAssertEqual(source.refreshCount, 2)
        }

        func testStartEmitsViewOpenedOnce() {
            let spy = SpyMoreDetailsTelemetry()
            let (model, source) = makeModel(MoreDetailsUpdate(status: .loading), telemetry: spy)
            model.start()
            model.start()
            XCTAssertEqual(spy.surfaces, [MoreDetailsPanel.surfaceSlug])
            XCTAssertEqual(source.startCount, 1)
        }

        func testConnectionAndRefreshingTrackUpdates() {
            let (model, source) = makeModel(MoreDetailsUpdate(status: .loading))
            model.start()
            source.push(
                MoreDetailsUpdate(
                    status: .loaded,
                    input: sampleInput(),
                    unitPrefs: MoreDetailsUnitPrefs(distance: "mi", speed: "mph"),
                    refreshing: true,
                    connection: .offline,
                    updatedAt: Date()
                )
            )
            XCTAssertEqual(model.connection, .offline)
            XCTAssertTrue(model.refreshing)
            XCTAssertNotNil(model.updatedAt)
        }
    }

    /// Records `viewOpened` surfaces so the telemetry contract can be asserted.
    private final class SpyMoreDetailsTelemetry: MoreDetailsTelemetry, @unchecked Sendable {
        private(set) var surfaces: [String] = []
        func viewOpened(surface: String) {
            surfaces.append(surface)
        }
    }
#endif
