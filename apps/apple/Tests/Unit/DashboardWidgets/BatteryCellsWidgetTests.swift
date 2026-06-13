import XCTest
@testable import TeslaSync

/// Unit tests for the BatteryCellsWidget surface: the decode→projection adapter,
/// the per-state presentation resolver, accessibility labels, telemetry, and the
/// registry metadata. All pure (no rendering / no KMP runtime required).
@MainActor final class BatteryCellsWidgetTests: XCTestCase {
    /// A deterministic en-US locale so number formatting is stable across hosts.
    private let locale = Locale(identifier: "en_US")

    private let fixture = """
    {
      "total_cells": 4,
      "avg_voltage": 3.950,
      "min_voltage": 3.948,
      "max_voltage": 3.970,
      "voltage_spread": 0.022,
      "avg_temperature": 25.0,
      "min_temperature": 24.0,
      "max_temperature": 28.0,
      "temp_spread": 4.0,
      "cells": [
        { "cell_id": 1, "module": 1, "voltage": 3.950, "temperature": 24.5 },
        { "cell_id": 2, "module": 1, "voltage": 3.952, "temperature": 25.0 },
        { "cell_id": 3, "module": 2, "voltage": 3.958, "temperature": 25.5 },
        { "cell_id": 4, "module": 2, "voltage": 3.970, "temperature": 26.0 }
      ]
    }
    """

    private func decodedFixture(file: StaticString = #filePath, line: UInt = #line) -> BatteryCellSummary {
        guard let summary = BatteryCellSummary.decode(fromJSONString: fixture) else {
            XCTFail("fixture failed to decode", file: file, line: line)
            return BatteryCellSummary(
                totalCells: 0, avgVoltage: 0, minVoltage: 0, maxVoltage: 0, voltageSpread: 0,
                avgTemperature: 0, minTemperature: 0, maxTemperature: 0, tempSpread: 0, cells: []
            )
        }
        return summary
    }

    // MARK: - Decode adapter

    func testDecodeParsesSnakeCaseShape() {
        let summary = decodedFixture()
        XCTAssertEqual(summary.totalCells, 4)
        XCTAssertEqual(summary.cells.count, 4)
        XCTAssertEqual(summary.avgVoltage, 3.950, accuracy: 0.0001)
        XCTAssertEqual(summary.cells.first?.cellID, 1)
        XCTAssertEqual(summary.cells.first?.module, 1)
        XCTAssertEqual(summary.cells.first?.voltage ?? 0, 3.950, accuracy: 0.0001)
    }

    func testDecodeRejectsGarbage() {
        XCTAssertNil(BatteryCellSummary.decode(fromJSONString: "not json"))
        XCTAssertNil(BatteryCellSummary.decode(fromJSONString: "{}"))
    }

    func testDecodeFromSharedPayloadAcceptsJSONString() {
        let viaPayload = BatteryCellSummary.decode(fromSharedPayload: fixture)
        XCTAssertEqual(viaPayload, decodedFixture())
    }

    // MARK: - Status classification (web cellStatus thresholds)

    func testClassifyThresholds() {
        let average = 3.950
        XCTAssertEqual(BatteryCellsWidgetStatus.classify(voltage: 3.950, average: average), .ok)
        XCTAssertEqual(BatteryCellsWidgetStatus.classify(voltage: 3.955, average: average), .ok) // 5 mV
        XCTAssertEqual(BatteryCellsWidgetStatus.classify(voltage: 3.965, average: average), .warning) // 15 mV
        XCTAssertEqual(BatteryCellsWidgetStatus.classify(voltage: 3.966, average: average), .error) // 16 mV
        XCTAssertEqual(BatteryCellsWidgetStatus.classify(voltage: nil, average: average), .unknown)
    }

    // MARK: - Number formatting parity (web fmtNumber / safeNumber)

    func testFixedFormattingCoercesNonFiniteToZero() {
        XCTAssertEqual(BatteryCellsProjection.fixed(nil, 3, locale: locale), "0.000")
        XCTAssertEqual(BatteryCellsProjection.fixed(.infinity, 1, locale: locale), "0.0")
        XCTAssertEqual(BatteryCellsProjection.fixed(.nan, 2, locale: locale), "0.00")
        XCTAssertEqual(BatteryCellsProjection.fixed(3.14159, 2, locale: locale), "3.14")
    }

    // MARK: - Projection (cached → projection)

    func testProjectionMediumWidth() {
        let projection = BatteryCellsProjection.make(
            from: decodedFixture(),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            cellWord: "Cell",
            locale: locale
        )
        XCTAssertEqual(projection.gridColumns, 3)
        XCTAssertFalse(projection.isCompact)
        XCTAssertFalse(projection.showTemperatures)
        XCTAssertEqual(projection.statusItems.count, 4)
        XCTAssertEqual(projection.statusItems[0].status, .ok)
        XCTAssertEqual(projection.statusItems[1].status, .ok)
        XCTAssertEqual(projection.statusItems[2].status, .warning)
        XCTAssertEqual(projection.statusItems[3].status, .error)
        XCTAssertEqual(projection.statusItems[0].label, "C1")
        XCTAssertEqual(projection.statusItems[0].value, "3.950 V")
        XCTAssertEqual(projection.minVoltageText, "3.948 V")
        XCTAssertEqual(projection.maxVoltageText, "3.970 V")
        XCTAssertEqual(projection.avgVoltageText, "3.950 V")
        XCTAssertEqual(projection.spreadText, "22.0 mV")
    }

    func testProjectionWideShowsTemperaturesAndModuleLabels() {
        let projection = BatteryCellsProjection.make(
            from: decodedFixture(),
            size: DashboardWidgetSize(cols: 4, rows: 6),
            cellWord: "Cell",
            locale: locale
        )
        XCTAssertEqual(projection.gridColumns, 4)
        XCTAssertTrue(projection.showTemperatures)
        XCTAssertEqual(projection.statusItems[0].label, "Cell 1 · M1")
        XCTAssertEqual(projection.statusItems[0].value, "3.950 V / 24.5°")
        XCTAssertEqual(projection.minTemperatureText, "24.0°")
        XCTAssertEqual(projection.avgTemperatureText, "25.0°")
        XCTAssertEqual(projection.maxTemperatureText, "28.0°")
    }

    func testProjectionCompactCollapsesColumns() {
        let projection = BatteryCellsProjection.make(
            from: decodedFixture(),
            size: DashboardWidgetSize(cols: 1, rows: 4),
            cellWord: "Cell",
            locale: locale
        )
        XCTAssertEqual(projection.gridColumns, 2)
        XCTAssertTrue(projection.isCompact)
        XCTAssertEqual(projection.statusItems[0].label, "C1")
    }

    // MARK: - Presentation resolver (every state)

    private func resolve(_ state: LoadableState<BatteryCellSummary>) -> BatteryCellsPresentation {
        BatteryCellsPresentation.resolve(
            state: state,
            size: DashboardWidgetSize(cols: 2, rows: 4),
            cellWord: "Cell",
            locale: locale
        )
    }

    private func expectedProjection() -> BatteryCellsProjection {
        BatteryCellsProjection.make(
            from: decodedFixture(),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            cellWord: "Cell",
            locale: locale
        )
    }

    func testResolveIdleAndLoadingAreLoading() {
        XCTAssertEqual(resolve(.idle), .loading)
        XCTAssertEqual(resolve(.loading(cached: nil, stale: false)), .loading)
    }

    func testResolveLoadingWithCacheShowsContentRefreshing() {
        let summary = decodedFixture()
        XCTAssertEqual(
            resolve(.loading(cached: summary, stale: true)),
            .content(expectedProjection(), freshness: .stale, refreshing: true)
        )
    }

    func testResolveLoadedLiveAndStale() {
        let summary = decodedFixture()
        XCTAssertEqual(
            resolve(.loaded(summary, stale: false)),
            .content(expectedProjection(), freshness: .live, refreshing: false)
        )
        XCTAssertEqual(
            resolve(.loaded(summary, stale: true)),
            .content(expectedProjection(), freshness: .stale, refreshing: false)
        )
    }

    func testResolveEmpty() {
        XCTAssertEqual(resolve(.empty(stale: false)), .empty)
    }

    func testResolveOfflineWithoutCacheIsOfflineNoData() {
        XCTAssertEqual(resolve(.failed(.offline, cached: nil, stale: false)), .offlineNoData)
    }

    func testResolveOfflineWithCacheShowsContentOfflineChip() {
        let summary = decodedFixture()
        XCTAssertEqual(
            resolve(.failed(.offline, cached: summary, stale: true)),
            .content(expectedProjection(), freshness: .offline, refreshing: false)
        )
    }

    func testResolveErrorRetryability() {
        XCTAssertEqual(
            resolve(.failed(.network(message: "boom"), cached: nil, stale: false)),
            .error(retryable: true)
        )
        XCTAssertEqual(
            resolve(.failed(.decode(message: "bad"), cached: nil, stale: false)),
            .error(retryable: false)
        )
    }

    func testResolveErrorWithCacheKeepsContent() {
        let summary = decodedFixture()
        XCTAssertEqual(
            resolve(.failed(.api(status: 500, code: nil, body: nil), cached: summary, stale: false)),
            .content(expectedProjection(), freshness: .live, refreshing: false)
        )
    }

    // MARK: - Accessibility

    func testTileAccessibilityLabelCombinesLabelAndValue() {
        let item = BatteryCellStatusItem(id: "1", label: "C1", value: "3.950 V", status: .ok)
        XCTAssertEqual(BatteryCellsAccessibility.tileLabel(for: item), "C1, 3.950 V")
    }

    // MARK: - Registry metadata + telemetry

    func testDescriptorMatchesRegistry() {
        let descriptor = BatteryCellsWidget.descriptor
        XCTAssertEqual(descriptor.id, "battery-cells")
        XCTAssertEqual(descriptor.category, .battery)
        XCTAssertEqual(descriptor.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(descriptor.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(descriptor.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testViewOpenedEventCarriesSurfaceSlug() {
        XCTAssertEqual(BatteryCellsWidget.surfaceSlug, "BatteryCellsWidget")
        XCTAssertEqual(
            BatteryCellsWidget.viewOpenedEvent,
            DashboardWidgetTelemetryEvent(name: "view.opened", surface: "BatteryCellsWidget")
        )
    }

    @MainActor
    func testBufferedTelemetryRecordsEvents() {
        let sink = BufferedDashboardWidgetTelemetry()
        sink.record(BatteryCellsWidget.viewOpenedEvent)
        XCTAssertEqual(sink.events, [DashboardWidgetTelemetryEvent(name: "view.opened", surface: "BatteryCellsWidget")])
    }

    // MARK: - Model (preview binding)

    @MainActor
    func testPreviewModelExposesInjectedState() {
        let summary = decodedFixture()
        let model = BatteryCellsModel(previewState: .loaded(summary, stale: false))
        guard case let .loaded(value, stale) = model.state else {
            return XCTFail("expected loaded state")
        }
        XCTAssertEqual(value, summary)
        XCTAssertFalse(stale)
    }
}
