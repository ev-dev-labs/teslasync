//
//  AuditPanel.Tests.swift
//  TeslaSync — P4 feature view · 0026 · AuditPanel (Apple)
//
//  Unit coverage for the AuditPanel surface:
//    • Adapter (cached → projection) — snake-case decode, result mapping, row
//      formatting (em-dash fallbacks + absolute timestamp + localized token).
//    • Presentation resolver — every state (loading / empty(scoped) / offline /
//      error / stale / content), keeping cached rows visible.
//    • Web-prop mapping — `rows` + `loading` → load state (the four web branches).
//    • Telemetry — `view.opened` event + buffered sink.
//    • Accessibility — the per-row VoiceOver summary content.
//    • Model — preview/web-prop binding + source start/refresh/stop delegation.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store:
//  the model is driven by `InMemoryAuditReplayAuditSource`.
//

import XCTest
@testable import TeslaSync

@MainActor final class AuditPanelAdapterTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")
    private let timeZone = TimeZone(identifier: "UTC")!
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    // MARK: Decode

    func testDecodeRowParsesSnakeCase() {
        let json = #"""
        {"id":7,"replayed_at":"2026-06-07T18:00:00Z","actor":"ada@fleet.io","actor_ip":"10.0.0.2",
         "dlq_id":8841,"src_topic":"dlq/raw","dst_topic":"telemetry/5YJ/v/Soc","payload":"{}",
         "reason":"manual","result":"publish_failed","error":"mqtt down","trace_id":"abc123"}
        """#
        let row = AuditPanelDLQReplayRecord.decode(fromJSONString: json)
        XCTAssertEqual(row?.id, 7)
        XCTAssertEqual(row?.actor, "ada@fleet.io")
        XCTAssertEqual(row?.dlqId, 8841)
        XCTAssertEqual(row?.dstTopic, "telemetry/5YJ/v/Soc")
        XCTAssertEqual(row?.result, .publishFailed)
        XCTAssertEqual(row?.error, "mqtt down")
        XCTAssertEqual(row?.traceId, "abc123")
        XCTAssertNotNil(row?.replayedAt)
    }

    func testDecodeListAndGarbage() {
        let json = """
        [
          {"id":1,"replayed_at":"2026-06-07T18:00:00Z","actor":"a","dlq_id":1,"dst_topic":"t","result":"ok",
           "error":"","trace_id":"x"},
          {"id":2,"replayed_at":"2026-06-07T17:00:00.250Z","actor":"b","dlq_id":2,"dst_topic":"u",
           "result":"weird","error":"e","trace_id":"y"}
        ]
        """
        let rows = AuditPanelDLQReplayRecord.decodeList(fromJSONString: json)
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0].result, .ok)
        XCTAssertEqual(rows[1].result, .unknown)
        XCTAssertNotNil(rows[1].replayedAt)
        XCTAssertEqual(AuditPanelDLQReplayRecord.decodeList(fromJSONString: "not json"), [])
        XCTAssertNil(AuditPanelDLQReplayRecord.decode(fromJSONString: "not json"))
    }

    func testTimestampParsing() {
        XCTAssertNotNil(DLQAuditTime.parse("2026-06-07T18:00:00Z"))
        XCTAssertNotNil(DLQAuditTime.parse("2026-06-07T18:00:00.123Z"))
        XCTAssertNil(DLQAuditTime.parse(nil))
        XCTAssertNil(DLQAuditTime.parse(""))
        XCTAssertNil(DLQAuditTime.parse("garbage"))
    }

    // MARK: Result mapping (web `RESULT_VARIANT`)

    func testResultMappingAndTone() {
        XCTAssertEqual(AuditPanelDLQReplayResult(rawTag: "ok"), .ok)
        XCTAssertEqual(AuditPanelDLQReplayResult(rawTag: "PUBLISH_FAILED"), .publishFailed)
        XCTAssertEqual(AuditPanelDLQReplayResult(rawTag: "rate_limited"), .rateLimited)
        XCTAssertEqual(AuditPanelDLQReplayResult(rawTag: "disabled"), .disabled)
        XCTAssertEqual(AuditPanelDLQReplayResult(rawTag: "not_found"), .notFound)
        XCTAssertEqual(AuditPanelDLQReplayResult(rawTag: "unparseable"), .unparseable)
        XCTAssertEqual(AuditPanelDLQReplayResult(rawTag: nil), .unknown)

        XCTAssertEqual(AuditPanelDLQReplayResult.ok.tone, .success)
        XCTAssertEqual(AuditPanelDLQReplayResult.publishFailed.tone, .danger)
        XCTAssertEqual(AuditPanelDLQReplayResult.unparseable.tone, .danger)
        XCTAssertEqual(AuditPanelDLQReplayResult.rateLimited.tone, .warning)
        XCTAssertEqual(AuditPanelDLQReplayResult.disabled.tone, .warning)
        XCTAssertEqual(AuditPanelDLQReplayResult.notFound.tone, .neutral)
        XCTAssertEqual(AuditPanelDLQReplayResult.unknown.tone, .neutral)
        XCTAssertEqual(AuditPanelDLQReplayResult.publishFailed.rawTag, "publish_failed")
    }

    // MARK: Projection (cached → projection)

    func testProjectionSortsDescAndFormats() {
        let records = [
            record(id: 1, offset: -7200, actor: "a", dstTopic: "x"),
            record(id: 2, offset: -60, actor: "", dstTopic: ""),
            record(id: 3, offset: -3600, actor: "c", dstTopic: "z")
        ]
        let projection = AuditPanelProjection.make(from: records, now: now, locale: locale, timeZone: timeZone)
        XCTAssertEqual(projection.rows.map(\.id), [2, 3, 1])

        let blank = projection.rows.first { $0.id == 2 }
        XCTAssertEqual(blank?.actorText, "—")
        XCTAssertEqual(blank?.dstTopicText, "—")
        XCTAssertEqual(blank?.errorText, "—")
        XCTAssertEqual(blank?.traceIdText, "—")
        XCTAssertEqual(blank?.dlqIdText, "20")
        XCTAssertNotEqual(blank?.replayedAtText, "—")
        XCTAssertFalse(blank?.replayedAtText.isEmpty ?? true)
    }

    func testProjectionResultLabelAndMissingTimestamp() {
        let records = [AuditPanelDLQReplayRecord(id: 5, replayedAt: nil, result: .ok)]
        let row = AuditPanelProjection.make(from: records, locale: locale, timeZone: timeZone).rows[0]
        XCTAssertEqual(row.replayedAtText, "—")
        XCTAssertEqual(row.resultTone, .success)
        XCTAssertEqual(row.resultLabel, AuditPanelDLQReplayResult.ok.rawTag)
    }

    // MARK: Accessibility

    func testRowSummaryReadsKeyFields() {
        let records = [record(id: 9, offset: -10, actor: "grace", dstTopic: "t")]
        let row = AuditPanelProjection.make(from: records, now: now, locale: locale, timeZone: timeZone).rows[0]
        let summary = AuditPanelAccessibility.rowSummary(for: row)
        XCTAssertTrue(summary.contains("grace"))
        XCTAssertTrue(summary.contains(row.resultLabel))
        XCTAssertTrue(summary.contains(row.replayedAtText))
    }

    // MARK: Fixtures

    private func record(id: Int, offset: TimeInterval, actor: String, dstTopic: String) -> AuditPanelDLQReplayRecord {
        AuditPanelDLQReplayRecord(
            id: id,
            replayedAt: now.addingTimeInterval(offset),
            actor: actor,
            dlqId: id * 10,
            dstTopic: dstTopic,
            result: .ok,
            error: actor.isEmpty ? "" : "err-\(id)",
            traceId: dstTopic.isEmpty ? "" : "tr-\(id)"
        )
    }
}

// MARK: - Presentation resolver (every state)

@MainActor final class AuditPanelPresentationTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")
    private let timeZone = TimeZone(identifier: "UTC")!
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func sample() -> [AuditPanelDLQReplayRecord] {
        [AuditPanelDLQReplayRecord(id: 1, replayedAt: now, actor: "a", dlqId: 10, result: .ok)]
    }

    private func resolve(
        _ state: AuditPanelLoadState<[AuditPanelDLQReplayRecord]>,
        scopedDlqId: Int? = nil
    ) -> AuditPanelPresentation {
        AuditPanelPresentation.resolve(
            state: state, scopedDlqId: scopedDlqId, now: now, locale: locale, timeZone: timeZone
        )
    }

    private func expected(_ records: [AuditPanelDLQReplayRecord]) -> AuditPanelProjection {
        AuditPanelProjection.make(from: records, now: now, locale: locale, timeZone: timeZone)
    }

    func testLoadingStates() {
        XCTAssertEqual(resolve(.idle), .loading)
        XCTAssertEqual(resolve(.loading(cached: nil, stale: false)), .loading)
        XCTAssertEqual(resolve(.loading(cached: [], stale: false)), .loading)
        XCTAssertEqual(
            resolve(.loading(cached: sample(), stale: true)),
            .content(expected(sample()), freshness: .stale, refreshing: true)
        )
    }

    func testLoadedContentAndEmpty() {
        XCTAssertEqual(
            resolve(.loaded(sample(), stale: false)),
            .content(expected(sample()), freshness: .live, refreshing: false)
        )
        XCTAssertEqual(resolve(.loaded([], stale: false)), .empty(scoped: false))
        XCTAssertEqual(resolve(.loaded([], stale: false), scopedDlqId: 42), .empty(scoped: true))
        XCTAssertEqual(resolve(.empty(stale: false), scopedDlqId: 42), .empty(scoped: true))
    }

    func testOfflineStates() {
        XCTAssertEqual(resolve(.failed(.offline, cached: nil, stale: false)), .offlineNoData)
        XCTAssertEqual(resolve(.failed(.offline, cached: [], stale: false)), .offlineNoData)
        XCTAssertEqual(
            resolve(.failed(.offline, cached: sample(), stale: true)),
            .content(expected(sample()), freshness: .offline, refreshing: false)
        )
    }

    func testErrorRetryabilityAndCache() {
        XCTAssertEqual(resolve(.failed(.network(message: "x"), cached: nil, stale: false)), .error(retryable: true))
        XCTAssertEqual(resolve(.failed(.decode(message: "x"), cached: nil, stale: false)), .error(retryable: false))
        XCTAssertEqual(
            resolve(.failed(.api(status: 500, code: nil, body: nil), cached: nil, stale: false)),
            .error(retryable: true)
        )
        XCTAssertEqual(
            resolve(.failed(.network(message: "x"), cached: sample(), stale: false)),
            .content(expected(sample()), freshness: .live, refreshing: false)
        )
    }

    // MARK: Web-prop mapping (rows + loading → load state)

    func testWebPropMapping() {
        XCTAssertEqual(AuditPanelModel.loadState(rows: [], loading: true), .loading(cached: nil, stale: false))
        XCTAssertEqual(
            AuditPanelModel.loadState(rows: sample(), loading: true),
            .loading(cached: sample(), stale: false)
        )
        XCTAssertEqual(AuditPanelModel.loadState(rows: [], loading: false), .empty(stale: false))
        XCTAssertEqual(AuditPanelModel.loadState(rows: sample(), loading: false), .loaded(sample(), stale: false))

        XCTAssertEqual(resolve(AuditPanelModel.loadState(rows: [], loading: true)), .loading)
        XCTAssertEqual(resolve(AuditPanelModel.loadState(rows: [], loading: false)), .empty(scoped: false))
        XCTAssertEqual(
            resolve(AuditPanelModel.loadState(rows: sample(), loading: false)),
            .content(expected(sample()), freshness: .live, refreshing: false)
        )
    }
}

// MARK: - Telemetry + model

@MainActor final class AuditPanelModelTests: XCTestCase {
    func testViewOpenedEventCarriesSurfaceSlug() {
        XCTAssertEqual(AuditPanel.surfaceSlug, "AuditPanel")
        XCTAssertEqual(
            AuditPanel.viewOpenedEvent,
            DashboardWidgetTelemetryEvent(name: "view.opened", surface: "AuditPanel")
        )
    }

    @MainActor
    func testBufferedTelemetryRecordsEvent() {
        let sink = BufferedDashboardWidgetTelemetry()
        sink.record(AuditPanel.viewOpenedEvent)
        XCTAssertEqual(
            sink.events,
            [DashboardWidgetTelemetryEvent(name: "view.opened", surface: "AuditPanel")]
        )
    }

    @MainActor
    func testPreviewModelExposesInjectedState() {
        let rows = [AuditPanelDLQReplayRecord(id: 1, replayedAt: Date(), result: .ok)]
        let model = AuditPanelModel(previewState: .loaded(rows, stale: false), scopedDlqId: 9)
        XCTAssertEqual(model.state, .loaded(rows, stale: false))
        XCTAssertEqual(model.scopedDlqId, 9)
    }

    @MainActor
    func testWebPropConvenienceInit() {
        let rows = [AuditPanelDLQReplayRecord(id: 1, replayedAt: Date(), result: .ok)]
        let model = AuditPanelModel(rows: rows, loading: false, scopedDlqId: 3)
        XCTAssertEqual(model.state, .loaded(rows, stale: false))
        XCTAssertEqual(model.scopedDlqId, 3)
        let loading = AuditPanelModel(rows: [], loading: true)
        XCTAssertEqual(loading.state, .loading(cached: nil, stale: false))
    }

    @MainActor
    func testSourceBackedModelStartsOnceRefreshesAndPushes() {
        let rows = [AuditPanelDLQReplayRecord(id: 1, replayedAt: Date(), result: .ok)]
        let source = InMemoryAuditReplayAuditSource(initial: .loaded(rows, stale: false))
        let model = AuditPanelModel(source: source, scopedDlqId: nil)
        model.start()
        model.start()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.state, .loaded(rows, stale: false))
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
        source.push(.empty(stale: false))
        XCTAssertEqual(model.state, .empty(stale: false))
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
