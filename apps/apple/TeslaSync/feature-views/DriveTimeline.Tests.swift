//
//  DriveTimeline.Tests.swift
//  TeslaSync — P4 feature view · 0140 · DriveTimeline (Apple)
//
//  Unit coverage for the DriveTimeline surface:
//    • Adapter (cached → projection) — snake-case decode, ISO timestamp parse,
//      duration-seconds coercion, the `formatTime` em-dash fallback, the
//      `formatDuration(durationS / 60)` arithmetic, and the start / duration / end
//      ("In progress") projection.
//    • Presentation resolver — every state (loading / empty / offline / error / stale
//      / content), keeping a cached drive visible.
//    • Web-prop mapping — `drive` + `loading` → load state.
//    • Telemetry — `view.opened` event + buffered sink.
//    • Accessibility — the combined VoiceOver summary content (completed + in-progress).
//    • Model — preview / web-prop binding + source start / refresh / stop delegation.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store: the
//  model is driven by `InMemoryDriveTimelineSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: decode + format + projection

@MainActor final class DriveTimelineAdapterTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")
    private let timeZone = TimeZone(identifier: "UTC")!
    // 2024-06-04T11:20:00Z (UTC) — chosen so the wall-clock minute is a stable "20".
    private let startEpoch: TimeInterval = 1_717_500_000

    // MARK: Decode

    func testDecodeParsesSnakeCaseCompletedDrive() {
        let json = #"""
        {"id":42,"vehicle_id":7,"start_ts":"2024-06-04T11:20:00Z",
         "end_ts":"2024-06-04T12:33:00Z","duration_s":4380,"distance_m":18250.0}
        """#
        let drive = DriveTimelineDrive.decode(fromJSONString: json)
        XCTAssertNotNil(drive?.startTs)
        XCTAssertNotNil(drive?.endTs)
        XCTAssertEqual(drive?.durationS, 4380)
        XCTAssertEqual(drive?.isInProgress, false)
    }

    func testDecodeNullEndTimestampIsInProgress() {
        let json = #"{"id":1,"start_ts":"2024-06-04T11:20:00Z","end_ts":null,"duration_s":1500}"#
        let drive = DriveTimelineDrive.decode(fromJSONString: json)
        XCTAssertNotNil(drive?.startTs)
        XCTAssertNil(drive?.endTs)
        XCTAssertEqual(drive?.isInProgress, true)
        XCTAssertEqual(drive?.durationS, 1500)
    }

    func testDecodeCoercesIntegerAndFloatingDuration() {
        let intJSON = #"{"start_ts":"2024-06-04T11:20:00Z","duration_s":3600}"#
        XCTAssertEqual(DriveTimelineDrive.decode(fromJSONString: intJSON)?.durationS, 3600)
        let floatJSON = #"{"start_ts":"2024-06-04T11:20:00Z","duration_s":3690.0}"#
        XCTAssertEqual(DriveTimelineDrive.decode(fromJSONString: floatJSON)?.durationS, 3690)
        let missingJSON = #"{"start_ts":"2024-06-04T11:20:00Z"}"#
        XCTAssertEqual(DriveTimelineDrive.decode(fromJSONString: missingJSON)?.durationS, 0)
    }

    func testDecodeGarbageReturnsNil() {
        XCTAssertNil(DriveTimelineDrive.decode(fromJSONString: "not json"))
        XCTAssertNil(DriveTimelineDrive.decode(fromJSONString: "[1,2,3]"))
    }

    // MARK: Timestamp + numeric parsing

    func testTimestampParsing() {
        XCTAssertNotNil(DriveTimelineTime.parse("2024-06-04T11:20:00Z"))
        XCTAssertNotNil(DriveTimelineTime.parse("2024-06-04T11:20:00.250Z"))
        XCTAssertNil(DriveTimelineTime.parse(nil))
        XCTAssertNil(DriveTimelineTime.parse(""))
        XCTAssertNil(DriveTimelineTime.parse("garbage"))
        XCTAssertNil(DriveTimelineTime.parse(42))
    }

    func testSecondsCoercion() {
        XCTAssertEqual(DriveTimelineTime.seconds(4380), 4380)
        XCTAssertEqual(DriveTimelineTime.seconds(4380.5), 4380.5)
        XCTAssertEqual(DriveTimelineTime.seconds("1500"), 1500)
        XCTAssertEqual(DriveTimelineTime.seconds(nil), 0)
        XCTAssertEqual(DriveTimelineTime.seconds("nope"), 0)
    }

    // MARK: Time format (web `formatTime`)

    func testTimeFormatEmDashForNil() {
        XCTAssertEqual(DriveTimelineFormat.time(nil, locale: locale, timeZone: timeZone), "—")
    }

    func testTimeFormatRendersWallClockMinute() {
        let date = Date(timeIntervalSince1970: startEpoch)
        let text = DriveTimelineFormat.time(date, locale: locale, timeZone: timeZone)
        XCTAssertNotEqual(text, "—")
        XCTAssertTrue(text.contains("20"), "expected the wall-clock minute, got \(text)")
    }

    // MARK: Duration format (web `formatDuration(durationS / 60)`)

    func testDurationFormatMinutesOnly() {
        XCTAssertEqual(DriveTimelineFormat.duration(seconds: 0, locale: locale), "0m")
        XCTAssertEqual(DriveTimelineFormat.duration(seconds: 90, locale: locale), "2m")
        XCTAssertEqual(DriveTimelineFormat.duration(seconds: 2700, locale: locale), "45m")
    }

    func testDurationFormatHoursAndMinutes() {
        XCTAssertEqual(DriveTimelineFormat.duration(seconds: 3600, locale: locale), "1h 0m")
        XCTAssertEqual(DriveTimelineFormat.duration(seconds: 5400, locale: locale), "1h 30m")
        XCTAssertEqual(DriveTimelineFormat.duration(seconds: 3690, locale: locale), "1h 2m")
        XCTAssertEqual(DriveTimelineFormat.duration(seconds: 4380, locale: locale), "1h 13m")
    }

    func testDurationFormatNonFiniteCollapsesToZero() {
        XCTAssertEqual(DriveTimelineFormat.duration(seconds: .nan, locale: locale), "0m")
        XCTAssertEqual(DriveTimelineFormat.duration(seconds: .infinity, locale: locale), "0m")
    }

    // MARK: Projection (cached → projection)

    func testProjectionCompletedDrive() {
        let start = Date(timeIntervalSince1970: startEpoch)
        let drive = DriveTimelineDrive(startTs: start, endTs: start.addingTimeInterval(4380), durationS: 4380)
        let projection = DriveTimelineProjection.make(from: drive, locale: locale, timeZone: timeZone)
        XCTAssertTrue(projection.startText.contains("20"))
        XCTAssertTrue(projection.endText.contains("33"))
        XCTAssertEqual(projection.durationText, "1h 13m")
        XCTAssertFalse(projection.isInProgress)
    }

    func testProjectionInProgressDrive() {
        let start = Date(timeIntervalSince1970: startEpoch)
        let drive = DriveTimelineDrive(startTs: start, endTs: nil, durationS: 1500)
        let projection = DriveTimelineProjection.make(from: drive, locale: locale, timeZone: timeZone)
        XCTAssertTrue(projection.startText.contains("20"))
        XCTAssertEqual(projection.endText, "In progress")
        XCTAssertEqual(projection.durationText, "25m")
        XCTAssertTrue(projection.isInProgress)
    }

    func testProjectionMissingStartRendersEmDash() {
        let drive = DriveTimelineDrive(startTs: nil, endTs: nil, durationS: 600)
        let projection = DriveTimelineProjection.make(from: drive, locale: locale, timeZone: timeZone)
        XCTAssertEqual(projection.startText, "—")
        XCTAssertEqual(projection.endText, "In progress")
        XCTAssertEqual(projection.durationText, "10m")
    }

    // MARK: Accessibility

    func testAccessibilitySummaryCompleted() {
        let projection = DriveTimelineProjection(
            startText: "11:20 AM",
            durationText: "1h 13m",
            endText: "12:33 PM",
            isInProgress: false
        )
        let summary = DriveTimelineAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("11:20 AM"))
        XCTAssertTrue(summary.contains("12:33 PM"))
        XCTAssertTrue(summary.contains("1h 13m"))
    }

    func testAccessibilitySummaryInProgress() {
        let projection = DriveTimelineProjection(
            startText: "11:20 AM",
            durationText: "25m",
            endText: "In progress",
            isInProgress: true
        )
        let summary = DriveTimelineAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("11:20 AM"))
        XCTAssertTrue(summary.contains("25m"))
        XCTAssertTrue(summary.lowercased().contains("in progress"))
    }
}

// MARK: - Presentation resolver (every state)

@MainActor final class DriveTimelinePresentationTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")
    private let timeZone = TimeZone(identifier: "UTC")!

    private func sample() -> DriveTimelineDrive {
        let start = Date(timeIntervalSince1970: 1_717_500_000)
        return DriveTimelineDrive(startTs: start, endTs: start.addingTimeInterval(4380), durationS: 4380)
    }

    private func resolve(_ state: DriveTimelineLoadState<DriveTimelineDrive>) -> DriveTimelinePresentation {
        DriveTimelinePresentation.resolve(state: state, locale: locale, timeZone: timeZone)
    }

    private func expected(_ drive: DriveTimelineDrive) -> DriveTimelineProjection {
        DriveTimelineProjection.make(from: drive, locale: locale, timeZone: timeZone)
    }

    func testLoadingStates() {
        XCTAssertEqual(resolve(.idle), .loading)
        XCTAssertEqual(resolve(.loading(cached: nil, stale: false)), .loading)
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
        XCTAssertEqual(
            resolve(.loaded(sample(), stale: true)),
            .content(expected(sample()), freshness: .stale, refreshing: false)
        )
        XCTAssertEqual(resolve(.empty(stale: false)), .empty)
    }

    func testOfflineStates() {
        XCTAssertEqual(resolve(.failed(.offline, cached: nil, stale: false)), .offlineNoData)
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
        XCTAssertEqual(
            DriveTimelineModel.loadState(drive: sample(), loading: true),
            .loading(cached: sample(), stale: false)
        )
        XCTAssertEqual(
            DriveTimelineModel.loadState(drive: sample(), loading: false),
            .loaded(sample(), stale: false)
        )
        XCTAssertEqual(
            resolve(DriveTimelineModel.loadState(drive: sample(), loading: false)),
            .content(expected(sample()), freshness: .live, refreshing: false)
        )
    }
}

// MARK: - Telemetry + model

@MainActor final class DriveTimelineModelTests: XCTestCase {
    private func sample() -> DriveTimelineDrive {
        DriveTimelineDrive(startTs: Date(timeIntervalSince1970: 1_717_500_000), endTs: nil, durationS: 1500)
    }

    func testViewOpenedEventCarriesSurfaceSlug() {
        XCTAssertEqual(DriveTimeline.surfaceSlug, "DriveTimeline")
        XCTAssertEqual(
            DriveTimeline.viewOpenedEvent,
            DashboardWidgetTelemetryEvent(name: "view.opened", surface: "DriveTimeline")
        )
    }

    func testBufferedTelemetryRecordsEvent() {
        let sink = BufferedDashboardWidgetTelemetry()
        sink.record(DriveTimeline.viewOpenedEvent)
        XCTAssertEqual(
            sink.events,
            [DashboardWidgetTelemetryEvent(name: "view.opened", surface: "DriveTimeline")]
        )
    }

    func testPreviewModelExposesInjectedState() {
        let model = DriveTimelineModel(previewState: .loaded(sample(), stale: false))
        XCTAssertEqual(model.state, .loaded(sample(), stale: false))
    }

    func testWebPropConvenienceInit() {
        let model = DriveTimelineModel(drive: sample())
        XCTAssertEqual(model.state, .loaded(sample(), stale: false))
    }

    func testSourceBackedModelStartsOnceRefreshesAndPushes() {
        let source = InMemoryDriveTimelineSource(initial: .loaded(sample(), stale: false))
        let model = DriveTimelineModel(source: source)
        model.start()
        model.start()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.state, .loaded(sample(), stale: false))
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
        source.push(.empty(stale: false))
        XCTAssertEqual(model.state, .empty(stale: false))
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
