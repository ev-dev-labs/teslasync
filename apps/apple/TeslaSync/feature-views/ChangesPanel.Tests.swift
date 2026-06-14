//
//  ChangesPanel.Tests.swift
//  TeslaSync — P4 feature view · 0030 · ChangesPanel (Apple)
//
//  Unit coverage for the ChangesPanel surface:
//    • Adapter (cached → projection) — snake-case decode, operation mapping, the
//      `compact()` value preview parity, row formatting (em-dash fallbacks +
//      absolute timestamp + localized token), and source-order preservation.
//    • Presentation resolver — every state (loading / empty(scoped) / offline /
//      error / stale / content), keeping cached rows visible.
//    • Web-prop mapping — `rows` + `loading` → load state (the four web branches).
//    • Telemetry — `view.opened` event + buffered sink.
//    • Accessibility — the per-row VoiceOver summary content.
//    • Model — preview/web-prop binding + source start/refresh/stop delegation.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store:
//  the model is driven by `InMemoryChangesAuditSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: decode + value preview + projection

@MainActor final class ChangesPanelAdapterTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")
    private let timeZone = TimeZone(identifier: "UTC")!
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    // MARK: Decode

    func testDecodeRowParsesSnakeCase() {
        let json = #"""
        {"id":7,"changed_at":"2026-06-07T18:00:00Z","actor":"ada@fleet.io","actor_ip":"10.0.0.2",
         "flag_key":"beta_dashboard","operation":"set","old_value":false,"new_value":true,
         "reason":"enable beta","trace_id":"abc123"}
        """#
        let row = ChangesPanelFlagChange.decode(fromJSONString: json)
        XCTAssertEqual(row?.id, 7)
        XCTAssertEqual(row?.actor, "ada@fleet.io")
        XCTAssertEqual(row?.flagKey, "beta_dashboard")
        XCTAssertEqual(row?.operation, .set)
        XCTAssertEqual(row?.oldValue, .bool(false))
        XCTAssertEqual(row?.newValue, .bool(true))
        XCTAssertEqual(row?.reason, "enable beta")
        XCTAssertNotNil(row?.changedAt)
    }

    func testDecodeNullVersusAbsentValue() {
        let json = #"{"id":9,"changed_at":"2026-06-07T18:00:00Z","flag_key":"f","operation":"delete","old_value":null}"#
        let row = ChangesPanelFlagChange.decode(fromJSONString: json)
        XCTAssertEqual(row?.operation, .delete)
        XCTAssertEqual(row?.oldValue, .null)
        XCTAssertEqual(row?.newValue, .undefined)
        XCTAssertEqual(row?.actor, "")
    }

    func testDecodeListAndGarbage() {
        let json = """
        [
          {"id":1,"changed_at":"2026-06-07T18:00:00Z","actor":"a","flag_key":"x","operation":"set",
           "old_value":1,"new_value":2,"reason":"r"},
          {"id":2,"changed_at":"2026-06-07T17:00:00.250Z","actor":"b","flag_key":"y","operation":"weird",
           "old_value":"on","new_value":null,"reason":""}
        ]
        """
        let rows = ChangesPanelFlagChange.decodeList(fromJSONString: json)
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0].operation, .set)
        XCTAssertEqual(rows[1].operation, .unknown)
        XCTAssertNotNil(rows[1].changedAt)
        XCTAssertEqual(ChangesPanelFlagChange.decodeList(fromJSONString: "not json"), [])
        XCTAssertNil(ChangesPanelFlagChange.decode(fromJSONString: "not json"))
    }

    func testTimestampParsing() {
        XCTAssertNotNil(ChangesAuditTime.parse("2026-06-07T18:00:00Z"))
        XCTAssertNotNil(ChangesAuditTime.parse("2026-06-07T18:00:00.123Z"))
        XCTAssertNil(ChangesAuditTime.parse(nil))
        XCTAssertNil(ChangesAuditTime.parse(""))
        XCTAssertNil(ChangesAuditTime.parse("garbage"))
    }

    // MARK: Operation mapping (web `OP_VARIANT`)

    func testOperationMappingAndTone() {
        XCTAssertEqual(ChangesPanelFlagOperation(rawTag: "set"), .set)
        XCTAssertEqual(ChangesPanelFlagOperation(rawTag: "DELETE"), .delete)
        XCTAssertEqual(ChangesPanelFlagOperation(rawTag: "nope"), .unknown)
        XCTAssertEqual(ChangesPanelFlagOperation(rawTag: nil), .unknown)

        XCTAssertEqual(ChangesPanelFlagOperation.set.tone, .success)
        XCTAssertEqual(ChangesPanelFlagOperation.delete.tone, .danger)
        XCTAssertEqual(ChangesPanelFlagOperation.unknown.tone, .neutral)
        XCTAssertEqual(ChangesPanelFlagOperation.set.rawTag, "set")
        XCTAssertEqual(ChangesPanelFlagOperation.delete.rawTag, "delete")
    }

    // MARK: Compact value preview (web `compact()`)

    func testCompactNullAndUndefinedRenderEmDash() {
        XCTAssertEqual(ChangesValuePreview.compact(.null), "\u{2014}")
        XCTAssertEqual(ChangesValuePreview.compact(.undefined), "\u{2014}")
    }

    func testCompactStringIsJSONQuotedAndEscaped() {
        XCTAssertEqual(ChangesValuePreview.compact(.string("hi")), "\"hi\"")
        XCTAssertEqual(ChangesValuePreview.compact(.string("a\"b")), "\"a\\\"b\"")
        XCTAssertEqual(ChangesValuePreview.compact(.string("a\nb")), "\"a\\nb\"")
    }

    func testCompactBooleanAndNumber() {
        XCTAssertEqual(ChangesValuePreview.compact(.bool(true)), "true")
        XCTAssertEqual(ChangesValuePreview.compact(.bool(false)), "false")
        XCTAssertEqual(ChangesValuePreview.compact(.number(5000)), "5000")
        XCTAssertEqual(ChangesValuePreview.compact(.number(-3)), "-3")
        XCTAssertEqual(ChangesValuePreview.compact(.number(2.5)), "2.5")
    }

    func testCompactContainersRenderSortedCompactJSON() {
        let object = ChangeJSONValue.object(["percent": .number(25), "cohort": .string("internal")])
        XCTAssertEqual(ChangesValuePreview.compact(object), "{\"cohort\":\"internal\",\"percent\":25}")
        let array = ChangeJSONValue.array([.string("us"), .string("eu"), .string("apac")])
        XCTAssertEqual(ChangesValuePreview.compact(array), "[\"us\",\"eu\",\"apac\"]")
    }

    func testCompactTruncatesPastSixtyCharacters() {
        let long = ChangeJSONValue.string(String(repeating: "a", count: 100))
        let preview = ChangesValuePreview.compact(long)
        XCTAssertEqual(preview.count, ChangesValuePreview.truncatedPrefix + 1)
        XCTAssertTrue(preview.hasSuffix("\u{2026}"))
    }

    func testFromJSONProjectsEveryKind() {
        XCTAssertEqual(ChangeJSONValue.from(json: nil), .undefined)
        XCTAssertEqual(ChangeJSONValue.from(json: NSNull()), .null)
        XCTAssertEqual(ChangeJSONValue.from(json: true), .bool(true))
        XCTAssertEqual(ChangeJSONValue.from(json: 3), .number(3))
        XCTAssertEqual(ChangeJSONValue.from(json: "x"), .string("x"))
        XCTAssertEqual(ChangeJSONValue.from(json: ["a": 1]), .object(["a": .number(1)]))
    }

    // MARK: Projection (cached → projection)

    func testProjectionPreservesOrderAndFormats() {
        let changes = [change(id: 3, offset: -60, actor: "c"), change(id: 1, offset: -7200, actor: ""), change(id: 2)]
        let projection = ChangesPanelProjection.make(from: changes, locale: locale, timeZone: timeZone)
        XCTAssertEqual(projection.rows.map(\.id), [3, 1, 2])

        let blank = projection.rows.first { $0.id == 1 }
        XCTAssertEqual(blank?.actorText, "—")
        XCTAssertEqual(blank?.reasonText, "—")
        XCTAssertNotEqual(blank?.changedAtText, "—")
        XCTAssertFalse(blank?.changedAtText.isEmpty ?? true)
    }

    func testProjectionOperationLabelAndMissingTimestamp() {
        let changes = [ChangesPanelFlagChange(id: 5, changedAt: nil, flagKey: "k", operation: .delete)]
        let row = ChangesPanelProjection.make(from: changes, locale: locale, timeZone: timeZone).rows[0]
        XCTAssertEqual(row.changedAtText, "—")
        XCTAssertEqual(row.operationTone, .danger)
        XCTAssertEqual(row.operationLabel, ChangesPanelFlagOperation.delete.rawTag)
        XCTAssertEqual(row.flagKeyText, "k")
    }

    // MARK: Accessibility

    func testRowSummaryReadsKeyFields() {
        let changes = [change(id: 9, offset: -10, actor: "grace", flagKey: "beta")]
        let row = ChangesPanelProjection.make(from: changes, locale: locale, timeZone: timeZone).rows[0]
        let summary = ChangesPanelAccessibility.rowSummary(for: row)
        XCTAssertTrue(summary.contains("grace"))
        XCTAssertTrue(summary.contains("beta"))
        XCTAssertTrue(summary.contains(row.operationLabel))
        XCTAssertTrue(summary.contains(row.changedAtText))
    }

    // MARK: Fixtures

    private func change(
        id: Int,
        offset: TimeInterval = 0,
        actor: String = "ada",
        flagKey: String = "flag",
        operation: ChangesPanelFlagOperation = .set
    ) -> ChangesPanelFlagChange {
        ChangesPanelFlagChange(
            id: id,
            changedAt: now.addingTimeInterval(offset),
            actor: actor,
            flagKey: flagKey,
            operation: operation,
            oldValue: .bool(false),
            newValue: .bool(true),
            reason: actor.isEmpty ? "" : "reason-\(id)"
        )
    }
}

// MARK: - Presentation resolver (every state)

@MainActor final class ChangesPanelPresentationTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")
    private let timeZone = TimeZone(identifier: "UTC")!
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    private func sample() -> [ChangesPanelFlagChange] {
        [ChangesPanelFlagChange(id: 1, changedAt: now, actor: "a", flagKey: "k", operation: .set)]
    }

    private func resolve(
        _ state: ChangesPanelLoadState<[ChangesPanelFlagChange]>,
        scopedKey: String? = nil
    ) -> ChangesPanelPresentation {
        ChangesPanelPresentation.resolve(state: state, scopedKey: scopedKey, locale: locale, timeZone: timeZone)
    }

    private func expected(_ changes: [ChangesPanelFlagChange]) -> ChangesPanelProjection {
        ChangesPanelProjection.make(from: changes, locale: locale, timeZone: timeZone)
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
        XCTAssertEqual(resolve(.loaded([], stale: false)), .empty(scopedKey: nil))
        XCTAssertEqual(resolve(.loaded([], stale: false), scopedKey: "beta"), .empty(scopedKey: "beta"))
        XCTAssertEqual(resolve(.empty(stale: false), scopedKey: "beta"), .empty(scopedKey: "beta"))
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

    func testWebPropMapping() {
        XCTAssertEqual(ChangesPanelModel.loadState(rows: [], loading: true), .loading(cached: nil, stale: false))
        XCTAssertEqual(
            ChangesPanelModel.loadState(rows: sample(), loading: true),
            .loading(cached: sample(), stale: false)
        )
        XCTAssertEqual(ChangesPanelModel.loadState(rows: [], loading: false), .empty(stale: false))
        XCTAssertEqual(ChangesPanelModel.loadState(rows: sample(), loading: false), .loaded(sample(), stale: false))

        XCTAssertEqual(resolve(ChangesPanelModel.loadState(rows: [], loading: true)), .loading)
        XCTAssertEqual(resolve(ChangesPanelModel.loadState(rows: [], loading: false)), .empty(scopedKey: nil))
        XCTAssertEqual(
            resolve(ChangesPanelModel.loadState(rows: sample(), loading: false)),
            .content(expected(sample()), freshness: .live, refreshing: false)
        )
    }
}

// MARK: - Telemetry + model

@MainActor final class ChangesPanelModelTests: XCTestCase {
    func testViewOpenedEventCarriesSurfaceSlug() {
        XCTAssertEqual(ChangesPanel.surfaceSlug, "ChangesPanel")
        XCTAssertEqual(
            ChangesPanel.viewOpenedEvent,
            DashboardWidgetTelemetryEvent(name: "view.opened", surface: "ChangesPanel")
        )
    }

    func testBufferedTelemetryRecordsEvent() {
        let sink = BufferedDashboardWidgetTelemetry()
        sink.record(ChangesPanel.viewOpenedEvent)
        XCTAssertEqual(
            sink.events,
            [DashboardWidgetTelemetryEvent(name: "view.opened", surface: "ChangesPanel")]
        )
    }

    func testPreviewModelExposesInjectedState() {
        let rows = [ChangesPanelFlagChange(id: 1, changedAt: Date(), operation: .set)]
        let model = ChangesPanelModel(previewState: .loaded(rows, stale: false), scopedKey: "beta")
        XCTAssertEqual(model.state, .loaded(rows, stale: false))
        XCTAssertEqual(model.scopedKey, "beta")
    }

    func testWebPropConvenienceInit() {
        let rows = [ChangesPanelFlagChange(id: 1, changedAt: Date(), operation: .set)]
        let model = ChangesPanelModel(rows: rows, loading: false, scopedKey: "k")
        XCTAssertEqual(model.state, .loaded(rows, stale: false))
        XCTAssertEqual(model.scopedKey, "k")
        let loading = ChangesPanelModel(rows: [], loading: true)
        XCTAssertEqual(loading.state, .loading(cached: nil, stale: false))
    }

    func testSourceBackedModelStartsOnceRefreshesAndPushes() {
        let rows = [ChangesPanelFlagChange(id: 1, changedAt: Date(), operation: .set)]
        let source = InMemoryChangesAuditSource(initial: .loaded(rows, stale: false))
        let model = ChangesPanelModel(source: source, scopedKey: nil)
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
