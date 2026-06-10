//
//  EntriesTable.Tests.swift
//  TeslaSync — P4 feature view · 0027 · EntriesTable (Apple)
//
//  Unit coverage for the EntriesTable surface:
//    • Adapter (cached → projection) — `EntriesTableProjector` value parity with the web
//      source's per-column pipeline (Date.parse, formatBytes, fmtInt, `?? '—'` fallbacks).
//    • Format helpers — formatBytes branch table, fmtInt grouping, ISO parsing.
//    • Sort — the `useSortToggle` default + the per-key comparator switch + stability.
//    • State holder — `EntriesTableModel` republishing loading / loaded / empty / error,
//      plus the P1/S11 `view.opened` telemetry contract + refresh/stop wiring.
//    • i18n — every key is namespaced and resolves to its web English fallback.
//    • Accessibility — the per-row VoiceOver label, the Inspect label, the list summary.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by an in-memory `RecordingEntriesProvider`.
//

import XCTest
@testable import TeslaSync

// MARK: - Test doubles (file scope so neither test class body grows)

/// Controlled provider that records lifecycle calls and lets a test drive the emitted
/// state — the stand-in for the production live provider.
@MainActor
private final class RecordingEntriesProvider: EntriesTableProvider {
    private(set) var startCount = 0
    private(set) var stopCount = 0
    private(set) var refreshCount = 0
    private var sink: ((EntriesTableViewState) -> Void)?

    func start(onState: @escaping (EntriesTableViewState) -> Void) {
        startCount += 1
        sink = onState
    }

    func stop() {
        stopCount += 1
    }

    func refresh() {
        refreshCount += 1
    }

    func send(_ state: EntriesTableViewState) {
        sink?(state)
    }
}

/// Spy proving the `view.opened` diagnostics contract is invokable with the surface slug.
@MainActor
private final class EntriesTableTelemetrySpy: EntriesTableTelemetry {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

private let summaryJSON = """
{
  "id": 7,
  "arrived_at": "2026-06-07T12:04:31Z",
  "dlq_topic": "dlq/telemetry",
  "parsed_reason": "codec_drop",
  "parsed_vehicle_id": 42,
  "parsed_vin": "5YJ3E1EA7KF000001",
  "parsed_source_topic": "telemetry/5YJ3/v/VehicleSpeed",
  "parsed_redeliveries": 3,
  "parsed_timestamp": "2026-06-07T12:04:30Z",
  "parse_error": null,
  "replayable": true,
  "raw_payload_size": 1536,
  "inner_payload_size": 940
}
"""

private func sampleDTO(
    id: Int,
    arrivedAt: String,
    reason: String = "codec_drop",
    vin: String? = "5YJ3E1EA7KF000001",
    redeliveries: Int? = 3,
    replayable: Bool = true,
    payloadSize: Int = 1536
) -> DLQEntrySummaryDTO {
    DLQEntrySummaryDTO(
        id: id,
        arrivedAt: arrivedAt,
        dlqTopic: "dlq/telemetry",
        parsedReason: reason,
        parsedVin: vin,
        parsedSourceTopic: "telemetry/5YJ3/v/VehicleSpeed",
        parsedRedeliveries: redeliveries,
        replayable: replayable,
        rawPayloadSize: payloadSize,
        innerPayloadSize: 0
    )
}

// MARK: - Adapter / pure-logic tests

@MainActor final class EntriesTableAdapterTests: XCTestCase {
    func testDecodesSnakeCaseSummaryJSON() throws {
        let dto = try JSONDecoder().decode(DLQEntrySummaryDTO.self, from: Data(summaryJSON.utf8))
        XCTAssertEqual(dto.id, 7)
        XCTAssertEqual(dto.arrivedAt, "2026-06-07T12:04:31Z")
        XCTAssertEqual(dto.parsedReason, "codec_drop")
        XCTAssertEqual(dto.parsedVehicleID, 42)
        XCTAssertEqual(dto.parsedVin, "5YJ3E1EA7KF000001")
        XCTAssertEqual(dto.parsedRedeliveries, 3)
        XCTAssertNil(dto.parseError)
        XCTAssertTrue(dto.replayable)
        XCTAssertEqual(dto.rawPayloadSize, 1536)
    }

    func testFormatBytesBranchTable() {
        XCTAssertEqual(EntriesTableFormat.bytes(-1), "—")
        XCTAssertEqual(EntriesTableFormat.bytes(0), "0 B")
        XCTAssertEqual(EntriesTableFormat.bytes(512), "512 B")
        XCTAssertEqual(EntriesTableFormat.bytes(1023), "1023 B")
        XCTAssertEqual(EntriesTableFormat.bytes(1024), "1.0 KB")
        XCTAssertEqual(EntriesTableFormat.bytes(1536), "1.5 KB")
        XCTAssertEqual(EntriesTableFormat.bytes(1024 * 1024), "1.0 MB")
        XCTAssertEqual(EntriesTableFormat.bytes(3_407_872), "3.3 MB")
    }

    func testFmtIntGroupingMatchesIntl() {
        XCTAssertEqual(EntriesTableFormat.integer(3, localeIdentifier: "en_US"), "3")
        XCTAssertEqual(EntriesTableFormat.integer(12, localeIdentifier: "en_US"), "12")
        XCTAssertEqual(EntriesTableFormat.integer(1234, localeIdentifier: "en_US"), "1,234")
    }

    func testParseTimestampToleratesWholeAndFractionalSeconds() {
        XCTAssertNotNil(EntriesTableFormat.parseTimestamp("2026-06-07T12:04:31Z"))
        XCTAssertNotNil(EntriesTableFormat.parseTimestamp("2026-06-07T12:04:31.250Z"))
        XCTAssertNil(EntriesTableFormat.parseTimestamp(nil))
        XCTAssertNil(EntriesTableFormat.parseTimestamp(""))
        XCTAssertNil(EntriesTableFormat.parseTimestamp("not-a-date"))
    }

    func testProjectRowDisplayFallbacks() {
        let dto = sampleDTO(id: 1, arrivedAt: "bad", reason: "", vin: nil, redeliveries: nil, payloadSize: 0)
        let row = EntriesTableProjector.projectRow(dto, context: .fixed)
        XCTAssertNil(row.arrivedAt)
        XCTAssertEqual(row.arrivedAtText, "—")
        XCTAssertEqual(row.reasonDisplay, "—")
        XCTAssertEqual(row.vinDisplay, "—")
        XCTAssertEqual(row.redeliveriesText, "—")
        XCTAssertEqual(row.payloadSizeText, "0 B")
    }

    func testProjectRowPopulatedValues() {
        let row = EntriesTableProjector.projectRow(sampleDTO(id: 2, arrivedAt: "2026-06-07T12:04:31Z"), context: .fixed)
        XCTAssertNotNil(row.arrivedAt)
        XCTAssertNotEqual(row.arrivedAtText, "—")
        XCTAssertEqual(row.reasonDisplay, "codec_drop")
        XCTAssertEqual(row.vinDisplay, "5YJ3E1EA7KF000001")
        XCTAssertEqual(row.redeliveriesText, "3")
        XCTAssertEqual(row.payloadSizeText, "1.5 KB")
    }

    func testDefaultSortIsArrivedDescending() {
        let dtos = [
            sampleDTO(id: 1, arrivedAt: "2026-06-07T09:00:00Z"),
            sampleDTO(id: 2, arrivedAt: "2026-06-07T12:00:00Z"),
            sampleDTO(id: 3, arrivedAt: "2026-06-07T10:30:00Z")
        ]
        let rows = EntriesTableProjector.project(dtos, context: .fixed, sort: .default)
        XCTAssertEqual(rows.map(\.id), [2, 3, 1])
    }

    func testSortByReasonLocaleCompare() {
        let dtos = [
            sampleDTO(id: 1, arrivedAt: "2026-06-07T09:00:00Z", reason: "schema_mismatch"),
            sampleDTO(id: 2, arrivedAt: "2026-06-07T10:00:00Z", reason: "codec_drop"),
            sampleDTO(id: 3, arrivedAt: "2026-06-07T11:00:00Z", reason: "payload_too_large")
        ]
        let rows = EntriesTableProjector.project(
            dtos,
            context: .fixed,
            sort: DLQSortState(key: .reason, ascending: true)
        )
        XCTAssertEqual(rows.map(\.reasonDisplay), ["codec_drop", "payload_too_large", "schema_mismatch"])
    }

    func testSortByVinTreatsNilAsEmpty() {
        let dtos = [
            sampleDTO(id: 1, arrivedAt: "2026-06-07T09:00:00Z", vin: "B"),
            sampleDTO(id: 2, arrivedAt: "2026-06-07T10:00:00Z", vin: nil),
            sampleDTO(id: 3, arrivedAt: "2026-06-07T11:00:00Z", vin: "A")
        ]
        let rows = EntriesTableProjector.project(dtos, context: .fixed, sort: DLQSortState(key: .vin, ascending: true))
        XCTAssertEqual(rows.map(\.id), [2, 3, 1])
    }

    func testSortByPayloadSizeNumeric() {
        let dtos = [
            sampleDTO(id: 1, arrivedAt: "2026-06-07T09:00:00Z", payloadSize: 2048),
            sampleDTO(id: 2, arrivedAt: "2026-06-07T10:00:00Z", payloadSize: 512),
            sampleDTO(id: 3, arrivedAt: "2026-06-07T11:00:00Z", payloadSize: 1024)
        ]
        let asc = EntriesTableProjector.project(
            dtos,
            context: .fixed,
            sort: DLQSortState(key: .payloadSize, ascending: true)
        )
        XCTAssertEqual(asc.map(\.id), [2, 3, 1])
        let desc = EntriesTableProjector.project(
            dtos,
            context: .fixed,
            sort: DLQSortState(key: .payloadSize, ascending: false)
        )
        XCTAssertEqual(desc.map(\.id), [1, 3, 2])
    }

    func testSortIsStableForTies() {
        let dtos = (1 ... 5).map { sampleDTO(id: $0, arrivedAt: "2026-06-07T12:00:00Z", payloadSize: 1024) }
        let rows = EntriesTableProjector.project(
            dtos,
            context: .fixed,
            sort: DLQSortState(key: .payloadSize, ascending: true)
        )
        XCTAssertEqual(rows.map(\.id), [1, 2, 3, 4, 5])
    }

    func testSortToggleReducer() {
        XCTAssertEqual(DLQSortState.default, DLQSortState(key: .arrivedAt, ascending: false))
        XCTAssertEqual(DLQSortState.default.toggled(for: .arrivedAt), DLQSortState(key: .arrivedAt, ascending: true))
        XCTAssertEqual(DLQSortState.default.toggled(for: .reason), DLQSortState(key: .reason, ascending: false))
    }
}

// MARK: - Model / view-state / contract tests

@MainActor final class EntriesTableModelTests: XCTestCase {
    private func rows() -> [DLQEntryRow] {
        EntriesTableProjector.project([sampleDTO(id: 1, arrivedAt: "2026-06-07T12:04:31Z")], context: .fixed)
    }

    func testModelStartsAndRepublishesProviderState() {
        let provider = RecordingEntriesProvider()
        let model = EntriesTableModel(provider: provider)
        if case .loading = model.state {} else { XCTFail("expected initial loading state") }

        model.start()
        XCTAssertEqual(provider.startCount, 1)

        let loaded: EntriesTableViewState = .loaded(rows(), freshness: .fresh)
        provider.send(loaded)
        XCTAssertEqual(model.state, loaded)

        provider.send(.empty(freshness: .offline))
        XCTAssertEqual(model.state, .empty(freshness: .offline))

        provider.send(.failed(message: nil, cached: nil))
        XCTAssertEqual(model.state, .failed(message: nil, cached: nil))
    }

    func testModelStopAndRefreshForwardToProvider() {
        let provider = RecordingEntriesProvider()
        let model = EntriesTableModel(provider: provider)
        model.refresh()
        model.stop()
        XCTAssertEqual(provider.refreshCount, 1)
        XCTAssertEqual(provider.stopCount, 1)
    }

    func testEveryViewStateIsRenderable() {
        let populated = rows()
        let states: [EntriesTableViewState] = [
            .loading(cached: nil),
            .loading(cached: populated),
            .loaded(populated, freshness: .fresh),
            .loaded(populated, freshness: .stale),
            .loaded(populated, freshness: .offline),
            .loaded([], freshness: .fresh),
            .empty(freshness: .fresh),
            .empty(freshness: .offline),
            .failed(message: nil, cached: nil),
            .failed(message: "boom", cached: populated)
        ]
        for state in states {
            let model = EntriesTableModel(provider: RecordingEntriesProvider(), initialState: state)
            let surface = EntriesTable(model: model, onInspect: { _ in })
            XCTAssertNotNil(surface.body)
        }
    }

    func testCurrentFreshnessOnlyWhenStateCarriesIt() {
        func freshness(_ state: EntriesTableViewState) -> WidgetFreshness? {
            let model = EntriesTableModel(provider: RecordingEntriesProvider(), initialState: state)
            return EntriesTable(model: model, onInspect: { _ in }).currentFreshness
        }
        XCTAssertEqual(freshness(.loaded(rows(), freshness: .stale)), .stale)
        XCTAssertEqual(freshness(.empty(freshness: .offline)), .offline)
        XCTAssertNil(freshness(.loading(cached: nil)))
        XCTAssertNil(freshness(.failed(message: nil, cached: nil)))
    }

    func testFreshnessInfoMapping() {
        XCTAssertEqual(EntriesTableFreshness.info(for: .fresh).label, "Live")
        XCTAssertEqual(EntriesTableFreshness.info(for: .fresh).tone, .success)
        XCTAssertEqual(EntriesTableFreshness.info(for: .stale).label, "Stale")
        XCTAssertEqual(EntriesTableFreshness.info(for: .stale).tone, .warning)
        XCTAssertEqual(EntriesTableFreshness.info(for: .offline).label, "Offline")
        XCTAssertEqual(EntriesTableFreshness.info(for: .offline).tone, .neutral)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(EntriesTable.surfaceSlug, "EntriesTable")
    }

    func testTelemetryContract() {
        let spy = EntriesTableTelemetrySpy()
        spy.viewOpened(surface: EntriesTable.surfaceSlug)
        XCTAssertEqual(spy.surfaces, ["EntriesTable"])
    }

    func testOSLogTelemetrySinkIsInvokable() {
        let sink = OSLogEntriesTableTelemetry()
        sink.viewOpened(surface: EntriesTable.surfaceSlug)
    }
}

// MARK: - i18n + accessibility tests

@MainActor final class EntriesTableLocalizationTests: XCTestCase {
    func testEveryKeyIsNamespaced() {
        for key in EntriesTableStrings.Key.all {
            let namespaced = key.hasPrefix("admin.dlq.") || key == "common.yes" || key == "common.no"
            XCTAssertTrue(namespaced, "unexpected key \(key)")
        }
    }

    func testResolvedAccessorsFallBackToWebEnglish() {
        XCTAssertEqual(EntriesTableStrings.colArrived, "Arrived")
        XCTAssertEqual(EntriesTableStrings.colReason, "Reason")
        XCTAssertEqual(EntriesTableStrings.colVin, "VIN")
        XCTAssertEqual(EntriesTableStrings.colTopic, "Source topic")
        XCTAssertEqual(EntriesTableStrings.colRedeliveries, "Redel.")
        XCTAssertEqual(EntriesTableStrings.colSize, "Payload")
        XCTAssertEqual(EntriesTableStrings.colReplayable, "Replayable")
        XCTAssertEqual(EntriesTableStrings.colActions, "Actions")
        XCTAssertEqual(EntriesTableStrings.commonYes, "Yes")
        XCTAssertEqual(EntriesTableStrings.commonNo, "No")
        XCTAssertEqual(EntriesTableStrings.inspect, "Inspect")
        XCTAssertEqual(EntriesTableStrings.tableLoading, "Loading…")
        XCTAssertEqual(EntriesTableStrings.tableEmpty, "No DLQ entries — the pipeline is clean.")
    }

    func testRowAccessibilityLabelContainsEveryColumn() {
        let row = EntriesTableProjector.projectRow(sampleDTO(id: 9, arrivedAt: "2026-06-07T12:04:31Z"), context: .fixed)
        let label = EntriesTableAccessibility.rowLabel(for: row)
        XCTAssertTrue(label.contains("Arrived"))
        XCTAssertTrue(label.contains("Reason"))
        XCTAssertTrue(label.contains("codec_drop"))
        XCTAssertTrue(label.contains("VIN"))
        XCTAssertTrue(label.contains("Replayable"))
        XCTAssertTrue(label.contains("Yes"))
    }

    func testInspectAndListAccessibilityLabels() {
        let row = EntriesTableProjector.projectRow(
            sampleDTO(id: 42, arrivedAt: "2026-06-07T12:04:31Z"),
            context: .fixed
        )
        XCTAssertEqual(EntriesTableAccessibility.inspectLabel(for: row), "Inspect entry 42")
        XCTAssertEqual(EntriesTableAccessibility.listSummary(count: 3), "Dead-letter queue, 3 entries")
    }
}
