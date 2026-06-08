//
//  TitleSlide.Tests.swift
//  TeslaSync — P4 feature view · 0070 · TitleSlide (Apple)
//
//  Unit coverage for the TitleSlide surface:
//    • Adapter (cached → projection) — `TitleSlideFormat.year` grouping parity with the web
//      `AnimatedNumber` → `fmtNumber(year, 0)` pipeline, plus the vehicle-name trim / em-dash
//      null-safety and the projector composition.
//    • State holder — `TitleSlideModel` phase resolution across loading / empty / error / content,
//      the refresh delegation, the stale auto-refresh guard, the connection / fetching tracking,
//      and the P1/S11 `view.opened` telemetry (emitted exactly once).
//    • Accessibility — the combined VoiceOver hero summary.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryTitleSlideSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: formatting / projection (web parity)

@MainActor
final class TitleSlideAdapterTests: XCTestCase {
    func testYearGroupsLikeWebFmtNumber() {
        // Web `<AnimatedNumber value={data.year} />` → fmtNumber(year, 0) → grouped in en-US.
        XCTAssertEqual(TitleSlideFormat.year(2026, localeIdentifier: "en_US"), "2,026")
        XCTAssertEqual(TitleSlideFormat.year(1999, localeIdentifier: "en_US"), "1,999")
    }

    func testYearBelowGroupingThresholdHasNoSeparator() {
        XCTAssertEqual(TitleSlideFormat.year(999, localeIdentifier: "en_US"), "999")
    }

    func testYearRespectsLocaleSeparator() {
        // de-DE groups thousands with a period; only the separator differs, the digits do not.
        let german = TitleSlideFormat.year(2026, localeIdentifier: "de_DE")
        XCTAssertTrue(german.contains("2"))
        XCTAssertTrue(german.contains("026"))
        XCTAssertNotEqual(german, "2026")
    }

    func testProjectTrimsVehicleName() {
        let projection = TitleSlideProjector.project(
            data: TitleSlideDTO(year: 2026, vehicleDisplayName: "  Model 3  "),
            localeIdentifier: "en_US"
        )
        XCTAssertEqual(projection.vehicleName, "Model 3")
        XCTAssertEqual(projection.yearText, "2,026")
        XCTAssertEqual(projection.year, 2026)
    }

    func testProjectFallsBackToEmDashForBlankName() {
        let blank = TitleSlideProjector.project(
            data: TitleSlideDTO(year: 2026, vehicleDisplayName: "   "),
            localeIdentifier: "en_US"
        )
        XCTAssertEqual(blank.vehicleName, TitleSlideProjector.emDash)
        let empty = TitleSlideProjector.project(
            data: TitleSlideDTO(year: 2026, vehicleDisplayName: ""),
            localeIdentifier: "en_US"
        )
        XCTAssertEqual(empty.vehicleName, TitleSlideProjector.emDash)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(TitleSlideModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(TitleSlideModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(TitleSlideModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(TitleSlideModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(TitleSlideModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(TitleSlideModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(TitleSlideModel.resolvePhase(status: .failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(TitleSlideModel.resolvePhase(status: .failed("e"), hasData: true), .content)
    }
}

// MARK: - State holder: phases + refresh + telemetry

@MainActor
final class TitleSlideModelTests: XCTestCase {
    private func makeModel(
        _ update: TitleSlideUpdate,
        telemetry: TitleSlideTelemetry = OSLogTitleSlideTelemetry()
    ) -> (TitleSlideModel, InMemoryTitleSlideSource) {
        let source = InMemoryTitleSlideSource(initial: update)
        let model = TitleSlideModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sampleData() -> TitleSlideDTO {
        TitleSlideDTO(year: 2026, vehicleDisplayName: "Model 3")
    }

    func testInitialContentPhaseProjects() {
        let (model, _) = makeModel(
            TitleSlideUpdate(status: .loaded, data: sampleData(), localeIdentifier: "en_US")
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.yearText, "2,026")
        XCTAssertEqual(model.projection?.vehicleName, "Model 3")
    }

    func testLoadingAndErrorPhases() {
        let (loading, _) = makeModel(TitleSlideUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)
        XCTAssertNil(loading.projection)

        let (failed, _) = makeModel(TitleSlideUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testCachedDataStaysContentWhileFailing() {
        let (model, source) = makeModel(TitleSlideUpdate(status: .loaded, data: sampleData()))
        model.start()
        source.push(TitleSlideUpdate(status: .failed("net"), data: sampleData()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.year, 2026)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(TitleSlideUpdate(status: .loaded, data: sampleData()))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshIsGuarded() {
        let (model, source) = makeModel(TitleSlideUpdate(status: .loaded, data: sampleData()))
        model.start()

        // Live → no refresh.
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 0)

        // Stale + not fetching → one refresh.
        source.push(TitleSlideUpdate(status: .loaded, connection: .stale, data: sampleData()))
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 1)

        // Stale + already fetching → no extra refresh.
        source.push(
            TitleSlideUpdate(status: .loaded, connection: .stale, isFetching: true, data: sampleData())
        )
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndFetchingTrackUpdates() {
        let (model, source) = makeModel(TitleSlideUpdate(status: .loading))
        model.start()
        source.push(
            TitleSlideUpdate(
                status: .loaded,
                connection: .offline,
                isFetching: true,
                data: sampleData(),
                localeIdentifier: "de_DE",
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.isFetching)
        XCTAssertEqual(model.localeIdentifier, "de_DE")
        XCTAssertNotNil(model.updatedAt)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyTitleSlideTelemetry()
        let (model, source) = makeModel(TitleSlideUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TitleSlide.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }
}

// MARK: - Accessibility summary

@MainActor
final class TitleSlideAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSummarySpeaksTitleYearVehicle() {
        let projection = TitleSlideProjector.project(
            data: TitleSlideDTO(year: 2026, vehicleDisplayName: "Model 3"),
            localeIdentifier: "en_US"
        )
        let summary = TitleSlideAccessibility.summary(for: projection, localize: echo)
        XCTAssertEqual(summary, "Year in Review, 2,026, Model 3")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyTitleSlideTelemetry: TitleSlideTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
