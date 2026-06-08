//
//  FleetTelemetryHealth.Tests.swift
//  TeslaSync — P4 feature view · 0005 · FleetTelemetryHealth (Apple)
//
//  Unit coverage for the FleetTelemetryHealth surface:
//    • Adapter (cached → projection) — `FleetHealthProjection` recency / normalization /
//      VIN + error row projection / phase resolution / badge tone, plus the timestamp
//      formatters, all parity with the web `isRecent`, `?? '—'`, and `length > 0` rules.
//    • State holder — `FleetHealthModel` phase resolution across loading / empty / error /
//      content per section, the VIN-filter toggle + source delegation, the Tesla-refresh
//      delegation, the stale auto-refresh, and the P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver row summaries (VIN + error rows).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryFleetHealthSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Test helpers

/// Names a `TSTone` so the (non-Equatable) shared tone can be asserted by value.
private func toneName(_ tone: TSTone) -> String {
    switch tone {
    case .neutral: "neutral"
    case .accent: "accent"
    case .success: "success"
    case .warning: "warning"
    case .danger: "danger"
    case .info: "info"
    }
}

// MARK: - Adapter: recency / normalization / projection (web parity)

@MainActor final class FleetHealthAdapterTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let window = FleetHealthProjection.recencyWindow

    func testIsRecentBoundaries() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        XCTAssertTrue(FleetHealthProjection.isRecent(now.addingTimeInterval(-(window - 60)), now: now))
        XCTAssertFalse(FleetHealthProjection.isRecent(now.addingTimeInterval(-window), now: now))
        XCTAssertFalse(FleetHealthProjection.isRecent(now.addingTimeInterval(-(window + 60)), now: now))
        XCTAssertTrue(FleetHealthProjection.isRecent(now.addingTimeInterval(60), now: now))
        XCTAssertFalse(FleetHealthProjection.isRecent(nil, now: now))
    }

    func testNormalizedTrimsAndFoldsEmpty() {
        XCTAssertEqual(FleetHealthProjection.normalized("  STREAM_DOWN  "), "STREAM_DOWN")
        XCTAssertNil(FleetHealthProjection.normalized(""))
        XCTAssertNil(FleetHealthProjection.normalized("   "))
        XCTAssertNil(FleetHealthProjection.normalized(nil))
    }

    func testVINRowsPreserveOrderAndEmphasis() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let inputs = [
            FleetTelemetryErrorVINInput(vin: "A", firstSeenAt: nil, lastSeenAt: now.addingTimeInterval(-60)),
            FleetTelemetryErrorVINInput(vin: "B", firstSeenAt: nil, lastSeenAt: now.addingTimeInterval(-(window + 60)))
        ]
        let rows = FleetHealthProjection.vinRows(from: inputs, now: now)
        XCTAssertEqual(rows.map(\.vin), ["A", "B"])
        XCTAssertEqual(rows[0].lastSeenEmphasis, .recent)
        XCTAssertEqual(rows[1].lastSeenEmphasis, .aged)
        XCTAssertEqual(rows[0].id, "A")
    }

    func testErrorRowsNormalizeAndEmphasize() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let inputs = [
            FleetTelemetryErrorInput(
                id: "1", vin: "A", errorCode: "  X1  ", errorMessage: "",
                reportedAt: now.addingTimeInterval(-30)
            ),
            FleetTelemetryErrorInput(
                id: "2", vin: "B", errorCode: nil, errorMessage: "boom",
                reportedAt: now.addingTimeInterval(-(window + 30))
            )
        ]
        let rows = FleetHealthProjection.errorRows(from: inputs, now: now)
        XCTAssertEqual(rows[0].errorCode, "X1")
        XCTAssertNil(rows[0].errorMessage)
        XCTAssertEqual(rows[0].reportedAtEmphasis, .recent)
        XCTAssertNil(rows[1].errorCode)
        XCTAssertEqual(rows[1].errorMessage, "boom")
        XCTAssertEqual(rows[1].reportedAtEmphasis, .normal)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(FleetHealthProjection.resolvePhase(.loading, hasRows: false), .loading)
        XCTAssertEqual(FleetHealthProjection.resolvePhase(.loading, hasRows: true), .content)
        XCTAssertEqual(FleetHealthProjection.resolvePhase(.empty, hasRows: false), .empty)
        XCTAssertEqual(FleetHealthProjection.resolvePhase(.loaded, hasRows: false), .empty)
        XCTAssertEqual(FleetHealthProjection.resolvePhase(.loaded, hasRows: true), .content)
        XCTAssertEqual(FleetHealthProjection.resolvePhase(.failed("e"), hasRows: false), .error("e"))
        XCTAssertEqual(FleetHealthProjection.resolvePhase(.failed("e"), hasRows: true), .content)
    }

    func testVINBadgeTone() {
        XCTAssertEqual(toneName(FleetHealthProjection.vinBadgeTone(count: 0)), "success")
        XCTAssertEqual(toneName(FleetHealthProjection.vinBadgeTone(count: 3)), "danger")
    }

    func testTimestampFormatting() {
        XCTAssertEqual(FleetHealthTimestamp.absolute(for: nil), FleetHealthProjection.emDash)
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        XCTAssertNotEqual(FleetHealthTimestamp.absolute(for: date), FleetHealthProjection.emDash)
        XCTAssertFalse(FleetHealthTimestamp.absolute(for: date).isEmpty)
        let now = date.addingTimeInterval(3600)
        XCTAssertFalse(FleetHealthTimestamp.relative(for: date, relativeTo: now).isEmpty)
    }
}

// MARK: - State holder: phases + filter + refresh + telemetry

@MainActor final class FleetHealthModelTests: XCTestCase {
    private func makeModel(
        _ update: FleetHealthUpdate,
        telemetry: FleetHealthTelemetry = OSLogFleetHealthTelemetry()
    ) -> (FleetHealthModel, InMemoryFleetHealthSource) {
        let source = InMemoryFleetHealthSource(initial: update)
        let model = FleetHealthModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func sampleVIN() -> FleetTelemetryErrorVINInput {
        FleetTelemetryErrorVINInput(vin: "A", firstSeenAt: Date(), lastSeenAt: Date())
    }

    private func sampleError() -> FleetTelemetryErrorInput {
        FleetTelemetryErrorInput(id: "1", vin: "A", errorCode: "X", errorMessage: "m", reportedAt: Date())
    }

    func testInitialPhasesPerSection() {
        let (model, _) = makeModel(
            FleetHealthUpdate(vinsStatus: .loaded, vins: [sampleVIN()], errorsStatus: .loaded, errors: [])
        )
        model.start()
        XCTAssertEqual(model.vinsPhase, .content)
        XCTAssertEqual(model.errorsPhase, .empty)
        XCTAssertEqual(model.vinRows.count, 1)
    }

    func testLoadingAndErrorPhases() {
        let (loading, _) = makeModel(FleetHealthUpdate(vinsStatus: .loading, errorsStatus: .loading))
        loading.start()
        XCTAssertEqual(loading.vinsPhase, .loading)
        XCTAssertEqual(loading.errorsPhase, .loading)

        let (failed, _) = makeModel(
            FleetHealthUpdate(vinsStatus: .failed("boom"), errorsStatus: .failed("boom"))
        )
        failed.start()
        XCTAssertEqual(failed.vinsPhase, .error("boom"))
        XCTAssertEqual(failed.errorsPhase, .error("boom"))
    }

    func testCachedRowsStayContentWhileFailing() {
        let (model, source) = makeModel(FleetHealthUpdate(vinsStatus: .loaded, vins: [sampleVIN()]))
        model.start()
        source.push(
            FleetHealthUpdate(
                vinsStatus: .failed("net"),
                vins: [sampleVIN()],
                errorsStatus: .loaded,
                errors: [sampleError()]
            )
        )
        XCTAssertEqual(model.vinsPhase, .content)
        XCTAssertEqual(model.errorsPhase, .content)
        XCTAssertEqual(model.errorRows.count, 1)
    }

    func testToggleVinSetsClearsAndDelegates() {
        let (model, source) = makeModel(FleetHealthUpdate(vinsStatus: .loaded, vins: [sampleVIN()]))
        model.start()
        model.toggleVin("A")
        XCTAssertEqual(model.selectedVin, "A")
        model.toggleVin("A")
        XCTAssertNil(model.selectedVin)
        model.toggleVin("B")
        XCTAssertEqual(model.selectedVin, "B")
        XCTAssertEqual(source.selectedVins, ["A", nil, "B"])
    }

    func testClearVinFilterDelegates() {
        let (model, source) = makeModel(FleetHealthUpdate(vinsStatus: .loaded, vins: [sampleVIN()]))
        model.start()
        model.toggleVin("A")
        model.clearVinFilter()
        XCTAssertNil(model.selectedVin)
        XCTAssertEqual(source.selectedVins.last, .some(nil))
    }

    func testRefreshDelegatesPerSection() {
        let (model, source) = makeModel(FleetHealthUpdate(vinsStatus: .loaded, errorsStatus: .loaded))
        model.start()
        model.refreshVINs()
        model.refreshErrors()
        model.refreshErrors()
        XCTAssertEqual(source.refreshVINsCount, 1)
        XCTAssertEqual(source.refreshErrorsCount, 2)
    }

    func testSelectedVinEchoedFromUpdate() {
        let (model, source) = makeModel(FleetHealthUpdate(vinsStatus: .loaded, vins: [sampleVIN()]))
        model.start()
        source.push(
            FleetHealthUpdate(vinsStatus: .loaded, vins: [sampleVIN()], connection: .live, selectedVin: "A")
        )
        XCTAssertEqual(model.selectedVin, "A")
    }

    func testStaleAutoRefreshFiresOncePerEpisode() {
        let (model, source) = makeModel(FleetHealthUpdate(vinsStatus: .loaded, vins: [sampleVIN()]))
        model.start()
        XCTAssertEqual(source.refreshVINsCount, 0)
        source.push(FleetHealthUpdate(vinsStatus: .loaded, vins: [sampleVIN()], connection: .stale))
        source.push(FleetHealthUpdate(vinsStatus: .loaded, vins: [sampleVIN()], connection: .stale))
        XCTAssertEqual(source.refreshVINsCount, 1)
        XCTAssertEqual(source.refreshErrorsCount, 1)
        source.push(FleetHealthUpdate(vinsStatus: .loaded, vins: [sampleVIN()], connection: .live))
        source.push(FleetHealthUpdate(vinsStatus: .loaded, vins: [sampleVIN()], connection: .stale))
        XCTAssertEqual(source.refreshVINsCount, 2)
        XCTAssertEqual(source.refreshErrorsCount, 2)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyFleetHealthTelemetry()
        let (model, source) = makeModel(FleetHealthUpdate(vinsStatus: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [FleetTelemetryHealth.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testConnectionAndRefreshingTrackUpdates() {
        let (model, source) = makeModel(FleetHealthUpdate(vinsStatus: .loading))
        model.start()
        source.push(
            FleetHealthUpdate(
                vinsStatus: .loaded, vins: [sampleVIN()], vinsRefreshing: true,
                errorsStatus: .loaded, errors: [sampleError()], errorsRefreshing: true,
                connection: .offline, updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.vinsRefreshing)
        XCTAssertTrue(model.errorsRefreshing)
        XCTAssertNotNil(model.updatedAt)
    }
}

// MARK: - Accessibility summaries

@MainActor final class FleetHealthAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testVINRowSummary() {
        let row = FleetVINRow(id: "A", vin: "A", firstSeen: nil, lastSeen: nil, lastSeenEmphasis: .aged)
        let summary = FleetHealthAccessibility.vinRowSummary(row, localize: echo)
        XCTAssertTrue(summary.contains("VIN A"))
        XCTAssertTrue(summary.contains("First Seen"))
        XCTAssertTrue(summary.contains("Last Seen"))
    }

    func testErrorRowSummaryIncludesPresentSegments() {
        let row = FleetTelemetryHealthErrorRow(
            id: "1", vin: "A", errorCode: "X1", errorMessage: "boom",
            reportedAt: nil, reportedAtEmphasis: .normal
        )
        let summary = FleetHealthAccessibility.errorRowSummary(row, localize: echo)
        XCTAssertTrue(summary.contains("VIN A"))
        XCTAssertTrue(summary.contains("Error Code X1"))
        XCTAssertTrue(summary.contains("Message boom"))
        XCTAssertTrue(summary.contains("Reported At"))
    }

    func testErrorRowSummaryOmitsAbsentSegments() {
        let row = FleetTelemetryHealthErrorRow(
            id: "2", vin: "B", errorCode: nil, errorMessage: nil,
            reportedAt: nil, reportedAtEmphasis: .normal
        )
        let summary = FleetHealthAccessibility.errorRowSummary(row, localize: echo)
        XCTAssertTrue(summary.contains("VIN B"))
        XCTAssertFalse(summary.contains("Error Code"))
        XCTAssertFalse(summary.contains("Message"))
        XCTAssertTrue(summary.contains("Reported At"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyFleetHealthTelemetry: FleetHealthTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
