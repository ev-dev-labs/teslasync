//
//  SignalSparklinePreview.Tests.swift
//  TeslaSync — P4 feature view · 0271 · SignalSparklinePreview (Apple)
//
//  Unit coverage for the SignalSparklinePreview surface:
//    • Adapter (envelopes → numbers → projection) — `SignalSparklineBuilder` parity
//      with the web `envelopesToNumbers` reducer + the `numericSeries.length < 2`
//      content boundary, plus the `SignalSparklineKind` numeric/non-numeric split.
//    • State holder — `SignalSparklineModel` phase resolution across disabled /
//      non-numeric / loading / empty / error / content, the P1/S11 `view.opened`
//      telemetry, and the stale one-shot auto-refresh + offline no-refresh.
//    • Accessibility — the VoiceOver trend / empty / non-numeric summaries.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemorySignalSparklineSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: reducer + projection (web `envelopesToNumbers` / `numericSeries`)

final class SignalSparklineBuilderTests: XCTestCase {
    func testNumbersKeepsFiniteNumbers() {
        let envelopes = [
            SignalSparklineEnvelope(value: .number(12.5)),
            SignalSparklineEnvelope(value: .number(-3)),
            SignalSparklineEnvelope(value: .number(0))
        ]
        XCTAssertEqual(SignalSparklineBuilder.numbers(from: envelopes), [12.5, -3, 0])
    }

    func testNumbersDropsNonFiniteNumbers() {
        let envelopes = [
            SignalSparklineEnvelope(value: .number(1)),
            SignalSparklineEnvelope(value: .number(.nan)),
            SignalSparklineEnvelope(value: .number(.infinity)),
            SignalSparklineEnvelope(value: .number(2))
        ]
        XCTAssertEqual(SignalSparklineBuilder.numbers(from: envelopes), [1, 2])
    }

    func testNumbersMapsBooleansToOneAndZero() {
        let envelopes = [
            SignalSparklineEnvelope(value: .bool(true)),
            SignalSparklineEnvelope(value: .bool(false)),
            SignalSparklineEnvelope(value: .bool(true))
        ]
        XCTAssertEqual(SignalSparklineBuilder.numbers(from: envelopes), [1, 0, 1])
    }

    func testNumbersDropsStringsAndNulls() {
        let envelopes = [
            SignalSparklineEnvelope(value: .string("driving")),
            SignalSparklineEnvelope(value: .null),
            SignalSparklineEnvelope(value: .number(7))
        ]
        XCTAssertEqual(SignalSparklineBuilder.numbers(from: envelopes), [7])
    }

    func testHasTrendNeedsTwoSamples() {
        XCTAssertFalse(SignalSparklineBuilder.hasTrend([]))
        XCTAssertFalse(SignalSparklineBuilder.hasTrend([42]))
        XCTAssertTrue(SignalSparklineBuilder.hasTrend([1, 2]))
    }

    func testProjectReportsContentSplit() {
        let single = SignalSparklineBuilder.project(from: [SignalSparklineEnvelope(value: .number(1))])
        XCTAssertEqual(single.values, [1])
        XCTAssertFalse(single.hasTrend)

        let many = SignalSparklineBuilder.project(from: [
            SignalSparklineEnvelope(value: .number(1)),
            SignalSparklineEnvelope(value: .bool(true)),
            SignalSparklineEnvelope(value: .string("skip"))
        ])
        XCTAssertEqual(many.values, [1, 1])
        XCTAssertTrue(many.hasTrend)
    }

    func testEmptyProjectionIsEmpty() {
        XCTAssertEqual(SignalSparklineProjection.empty.values, [])
        XCTAssertFalse(SignalSparklineProjection.empty.hasTrend)
        XCTAssertEqual(SignalSparklineBuilder.project(from: []), .empty)
    }
}

// MARK: - Adapter: value kind (web `NON_NUMERIC` set)

final class SignalSparklineKindTests: XCTestCase {
    func testNumericKindsHaveTrend() {
        for kind in [SignalSparklineKind.bool, .int, .float] {
            XCTAssertTrue(kind.isNumeric, "\(kind) should be numeric")
        }
    }

    func testNonNumericKindsMatchWebSet() {
        for kind in [SignalSparklineKind.string, .time, .unknown] {
            XCTAssertFalse(kind.isNumeric, "\(kind) should be non-numeric")
        }
    }

    func testTokenIsRawValue() {
        XCTAssertEqual(SignalSparklineKind.float.token, "float")
        XCTAssertEqual(SignalSparklineKind.string.token, "string")
    }
}

// MARK: - State holder: phase resolution (web branch order)

@MainActor
final class SignalSparklineModelTests: XCTestCase {
    private func makeModel(
        _ update: SignalSparklineUpdate,
        telemetry: SignalSparklineTelemetry = OSLogSignalSparklineTelemetry()
    ) -> (SignalSparklineModel, InMemorySignalSparklineSource) {
        let source = InMemorySignalSparklineSource(initial: update)
        let model = SignalSparklineModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func envelopes(_ count: Int) -> [SignalSparklineEnvelope] {
        (0 ..< count).map { SignalSparklineEnvelope(value: .number(Double($0))) }
    }

    func testDisabledWinsBeforeEverything() {
        let (model, _) = makeModel(SignalSparklineUpdate(status: .loaded, enabled: false, envelopes: envelopes(5)))
        model.start()
        XCTAssertEqual(model.phase, .disabled)
    }

    func testNonNumericShowsKindChipEvenWhileLoading() {
        let (model, _) = makeModel(SignalSparklineUpdate(status: .loading, kind: .string))
        model.start()
        XCTAssertEqual(model.phase, .nonNumeric(token: "string"))
    }

    func testLoadingWithoutTrendShowsLoading() {
        let (model, _) = makeModel(SignalSparklineUpdate(status: .loading, kind: .float))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutEnoughSamplesShowsEmpty() {
        let (model, _) = makeModel(SignalSparklineUpdate(status: .loaded, kind: .float, envelopes: envelopes(1)))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(SignalSparklineUpdate(status: .failed("boom"), kind: .float))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testTrendWinsAsContentEvenWhileFailed() {
        let (model, _) = makeModel(SignalSparklineUpdate(status: .failed("net"), kind: .int, envelopes: envelopes(4)))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.sampleCount, 4)
    }

    func testNumericSeriesAndDisplayInputsTracked() {
        let update = SignalSparklineUpdate(
            status: .loaded,
            kind: .float,
            envelopes: [
                SignalSparklineEnvelope(value: .number(10)),
                SignalSparklineEnvelope(value: .bool(true)),
                SignalSparklineEnvelope(value: .string("x"))
            ],
            width: 96,
            height: 20,
            colorIndex: 2
        )
        let (model, _) = makeModel(update)
        model.start()
        XCTAssertEqual(model.values, [10, 1])
        XCTAssertEqual(model.width, 96)
        XCTAssertEqual(model.height, 20)
        XCTAssertEqual(model.colorIndex, 2)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySignalSparklineTelemetry()
        let (model, source) = makeModel(SignalSparklineUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SignalSparklineSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshAndStopDelegateToSource() {
        let (model, source) = makeModel(SignalSparklineUpdate(status: .loaded, kind: .float, envelopes: envelopes(3)))
        model.start()
        model.refresh()
        model.stop()
        model.start()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.startCount, 2)
    }

    func testStaleTriggersExactlyOneAutoRefreshUntilLive() {
        let live = SignalSparklineUpdate(status: .loaded, kind: .float, envelopes: envelopes(3))
        let (model, source) = makeModel(live)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        let stale = SignalSparklineUpdate(status: .loaded, connection: .stale, kind: .float, envelopes: envelopes(3))
        source.push(stale)
        source.push(stale)
        XCTAssertEqual(source.refreshCount, 1, "stale auto-refresh is one-shot")
        source.push(live)
        source.push(stale)
        XCTAssertEqual(source.refreshCount, 2, "re-arms after returning live")
    }

    func testOfflineKeepsCachedTrendWithoutRefetch() {
        let (model, source) = makeModel(SignalSparklineUpdate(status: .loaded, kind: .float, envelopes: envelopes(3)))
        model.start()
        let offline = SignalSparklineUpdate(
            status: .loaded,
            connection: .offline,
            kind: .float,
            envelopes: envelopes(3)
        )
        source.push(offline)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testResolvePhasePureFunctionOrder() {
        XCTAssertEqual(
            SignalSparklineModel.resolvePhase(enabled: false, kind: .float, status: .loaded, hasTrend: true),
            .disabled
        )
        XCTAssertEqual(
            SignalSparklineModel.resolvePhase(enabled: true, kind: .time, status: .loaded, hasTrend: true),
            .nonNumeric(token: "time")
        )
        XCTAssertEqual(
            SignalSparklineModel.resolvePhase(enabled: true, kind: .float, status: .loading, hasTrend: false),
            .loading
        )
        XCTAssertEqual(
            SignalSparklineModel.resolvePhase(enabled: true, kind: .float, status: .loaded, hasTrend: false),
            .empty
        )
    }
}

// MARK: - Accessibility

final class SignalSparklineAccessibilityTests: XCTestCase {
    func testTrendSummaryIncludesSignalAndCount() {
        let summary = SignalSparklineAccessibility.trendSummary(
            signal: "vehicle_speed",
            sampleCount: 24,
            connection: .live,
            localize: SignalSparklineStrings.string
        )
        XCTAssertTrue(summary.contains("vehicle_speed"))
        XCTAssertTrue(summary.contains("24"))
        XCTAssertFalse(summary.contains("Stale"))
    }

    func testTrendSummaryAppendsFreshnessWhenNotLive() {
        let summary = SignalSparklineAccessibility.trendSummary(
            signal: "battery_level",
            sampleCount: 12,
            connection: .stale,
            localize: SignalSparklineStrings.string
        )
        XCTAssertTrue(summary.contains("Stale"))
    }

    func testEmptySummaryMentionsNoSamples() {
        let summary = SignalSparklineAccessibility.emptySummary(
            signal: "charge_power",
            localize: SignalSparklineStrings.string
        )
        XCTAssertTrue(summary.contains("charge_power"))
        XCTAssertTrue(summary.lowercased().contains("no samples"))
    }

    func testNonNumericSummaryMentionsKindToken() {
        let summary = SignalSparklineAccessibility.nonNumericSummary(
            signal: "shift_state",
            token: "string",
            localize: SignalSparklineStrings.string
        )
        XCTAssertTrue(summary.contains("shift_state"))
        XCTAssertTrue(summary.contains("string"))
    }

    func testNonNumericTitleFormatsToken() {
        XCTAssertEqual(SignalSparklineStrings.nonNumericTitle("time"), "Non-numeric signal (time)")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySignalSparklineTelemetry: SignalSparklineTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
