//
//  AiUsageCard.Tests.swift
//  TeslaSync — P4 feature view · 0237 · AiUsageCard (Apple)
//
//  Unit coverage for the AiUsageCard surface:
//    • Adapter — the number / integer / count / plain-int formatters (port of numberFormat.ts),
//      the `microCentsAsDollars` scaling + non-finite guard, the `currency` prefix, the
//      `errorIntent` thresholds, the relative-time bucketing, and the recent-row summary.
//    • State holder — `AiUsageProjection` across gated / loading / empty / error / data (the bands,
//      details, and by-feature / recent top-lists), plus the `AiUsageModel` wiring, the P1/S11
//      `view.opened` telemetry (deferred past the gate), and the stale auto-refresh.
//    • Accessibility — the VoiceOver cell-label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryAiUsageSource`, and the locale + `now` are injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

private func iso(_ secondsAgo: TimeInterval) -> String {
    ISO8601DateFormatter().string(from: fixedNow.addingTimeInterval(-secondsAgo))
}

private let sampleToday = AiUsageToday(
    callCount: 42,
    inputTokens: 18450,
    outputTokens: 7320,
    costMicroCents: 1_234_560,
    errorCount: 1,
    avgLatencyMs: 642
)

// MARK: - Projection phases

@MainActor
final class AiUsageProjectionPhaseTests: XCTestCase {
    func testGatedWhenAiModeOff() {
        let resolved = AiUsageProjection.resolve(AiUsageInput(aiModeOff: true, today: sampleToday), locale: enUS)
        XCTAssertEqual(resolved.phase, .gated)
        XCTAssertTrue(resolved.bands.isEmpty)
        XCTAssertTrue(resolved.details.isEmpty)
    }

    func testErrorTakesPrecedenceOverData() {
        let resolved = AiUsageProjection.resolve(
            AiUsageInput(today: sampleToday, errorMessage: "boom"),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingOnlyWhenNoToday() {
        let loading = AiUsageProjection.resolve(AiUsageInput(isLoading: true), locale: enUS)
        XCTAssertEqual(loading.phase, .loading)
        // Web parity: isLoading with today present is NOT the loading branch — it renders data.
        let withData = AiUsageProjection.resolve(AiUsageInput(today: sampleToday, isLoading: true), locale: enUS)
        XCTAssertEqual(withData.phase, .data)
    }

    func testEmptyWhenAbsentOrZeroCalls() {
        let absent = AiUsageProjection.resolve(AiUsageInput(today: nil), locale: enUS)
        let zero = AiUsageProjection.resolve(AiUsageInput(today: .zero), locale: enUS)
        for resolved in [absent, zero] {
            guard case let .empty(message) = resolved.phase else {
                return XCTFail("expected empty phase")
            }
            XCTAssertTrue(message.contains("No Helix calls"))
            XCTAssertTrue(resolved.bands.isEmpty)
        }
    }

    func testDataWhenCallsPresent() {
        let resolved = AiUsageProjection.resolve(AiUsageInput(today: sampleToday), locale: enUS)
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.bands.count, 3)
        XCTAssertEqual(resolved.details.count, 4)
    }
}

// MARK: - Projection bands / details

@MainActor
final class AiUsageProjectionContentTests: XCTestCase {
    private func resolve() -> AiUsageResolved {
        AiUsageProjection.resolve(AiUsageInput(today: sampleToday, currencySymbol: "$"), locale: enUS)
    }

    func testBandIdentityValuesAndUnits() {
        let bands = resolve().bands
        XCTAssertEqual(bands.map(\.id), ["today", "tokens", "cost"])
        XCTAssertEqual(bands.map(\.value), ["42", "25,770", "$1.23"])
        XCTAssertEqual(bands.map(\.unit), ["calls", "total", nil])
    }

    func testTodayBandSubAndIntent() {
        let today = resolve().bands[0]
        XCTAssertEqual(today.sub, "1 error")
        XCTAssertEqual(today.intent, .warn) // 1 / 42 < 5%
    }

    func testTokensBandSub() {
        XCTAssertEqual(resolve().bands[1].sub, "18,450 in · 7,320 out")
    }

    func testCostBandSubUsesPlainMilliseconds() {
        XCTAssertEqual(resolve().bands[2].sub, "642 ms avg")
    }

    func testPluralisationSingularVsPlural() {
        let one = AiUsageToday(callCount: 10, errorCount: 1)
        let many = AiUsageToday(callCount: 10, errorCount: 3)
        let oneBand = AiUsageProjection.resolve(AiUsageInput(today: one), locale: enUS).bands[0]
        let manyBand = AiUsageProjection.resolve(AiUsageInput(today: many), locale: enUS).bands[0]
        XCTAssertEqual(oneBand.sub, "1 error")
        XCTAssertEqual(manyBand.sub, "3 errors")
        XCTAssertEqual(manyBand.intent, .danger) // 3 / 10 >= 5%
    }

    func testDetailsValuesAndErrorIntent() {
        let details = resolve().details
        XCTAssertEqual(details.map(\.id), ["avgLatency", "errors", "inputTokens", "outputTokens"])
        XCTAssertEqual(details.map(\.value), ["642 ms", "1", "18,450", "7,320"])
        XCTAssertEqual(details.first { $0.id == "errors" }?.intent, .danger)
    }

    func testCostHonoursCurrencyContext() {
        let resolved = AiUsageProjection.resolve(
            AiUsageInput(today: sampleToday, currencySymbol: "€", decimalPrecision: 2),
            locale: enUS
        )
        XCTAssertEqual(resolved.bands[2].value, "€1.23")
    }
}

// MARK: - Projection top-lists

@MainActor
final class AiUsageProjectionTopListTests: XCTestCase {
    func testNoTopListsWhenSourcesEmpty() {
        let resolved = AiUsageProjection.resolve(AiUsageInput(today: sampleToday), locale: enUS)
        XCTAssertTrue(resolved.topLists.isEmpty)
    }

    func testByFeatureSortsDescAndCapsAtFive() {
        let rows = [
            AiUsageFeatureRow(featureID: "a", callCount: 3),
            AiUsageFeatureRow(featureID: "b", callCount: 30),
            AiUsageFeatureRow(featureID: "c", callCount: 12),
            AiUsageFeatureRow(featureID: "d", callCount: 7),
            AiUsageFeatureRow(featureID: "e", callCount: 1),
            AiUsageFeatureRow(featureID: "f", callCount: 25)
        ]
        let resolved = AiUsageProjection.resolve(AiUsageInput(today: sampleToday, byFeature: rows), locale: enUS)
        let features = resolved.topLists.first { $0.id == "features" }
        XCTAssertEqual(features?.title, "By feature (7 days)")
        XCTAssertEqual(features?.items.count, 5)
        XCTAssertEqual(features?.items.map(\.label), ["b", "f", "c", "d", "a"])
        XCTAssertEqual(features?.items.first?.value, "30")
    }

    func testRecentListGlyphsAndCap() {
        let rows = (1 ... 7).map { index in
            AiUsageRecentRow(
                id: index,
                featureID: "chat",
                model: "m",
                inputTokens: 10,
                outputTokens: 5,
                startedAt: iso(Double(index)),
                error: index.isMultiple(of: 2) ? "boom" : ""
            )
        }
        let resolved = AiUsageProjection.resolve(AiUsageInput(today: sampleToday, recent: rows), locale: enUS)
        let recent = resolved.topLists.first { $0.id == "recent" }
        XCTAssertEqual(recent?.title, "Recent calls")
        XCTAssertEqual(recent?.items.count, 5)
        XCTAssertEqual(recent?.items.first?.value, "✓") // id 1, no error
        XCTAssertEqual(recent?.items[1].value, "✗") // id 2, error
    }

    func testBothListsPresentInOrder() {
        let resolved = AiUsageProjection.resolve(
            AiUsageInput(
                today: sampleToday,
                byFeature: [AiUsageFeatureRow(featureID: "a", callCount: 1)],
                recent: [AiUsageRecentRow(
                    id: 1,
                    featureID: "a",
                    model: "m",
                    inputTokens: 1,
                    outputTokens: 1,
                    startedAt: iso(1)
                )]
            ),
            locale: enUS
        )
        XCTAssertEqual(resolved.topLists.map(\.id), ["features", "recent"])
    }
}

// MARK: - State holder: wiring, telemetry, freshness, gate

@MainActor
final class AiUsageModelTests: XCTestCase {
    private func makeModel(
        _ input: AiUsageInput,
        telemetry: AiUsageTelemetry = OSLogAiUsageTelemetry()
    ) -> (AiUsageModel, InMemoryAiUsageSource) {
        let source = InMemoryAiUsageSource(initial: input)
        let model = AiUsageModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyAiUsageTelemetry()
        let (model, source) = makeModel(AiUsageInput(today: sampleToday), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.bands.count, 3)
        XCTAssertEqual(spy.surfaces, [AiUsageCard.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testGatedStartEmitsNoTelemetry() {
        let spy = SpyAiUsageTelemetry()
        let (model, _) = makeModel(AiUsageInput(aiModeOff: true), telemetry: spy)
        model.start()
        XCTAssertTrue(model.isGated)
        XCTAssertEqual(spy.surfaces, [])
    }

    func testTelemetryEmitsOnGatedToPresentedTransition() {
        let spy = SpyAiUsageTelemetry()
        let (model, source) = makeModel(AiUsageInput(aiModeOff: true), telemetry: spy)
        model.start()
        XCTAssertEqual(spy.surfaces, [])
        source.push(AiUsageInput(today: sampleToday))
        XCTAssertFalse(model.isGated)
        XCTAssertEqual(spy.surfaces, [AiUsageCard.surfaceSlug])
        // Staying presented must not re-emit.
        source.push(AiUsageInput(today: sampleToday, connection: .live))
        XCTAssertEqual(spy.surfaces, [AiUsageCard.surfaceSlug])
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(AiUsageInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(AiUsageInput(today: sampleToday))
        XCTAssertEqual(model.phase, .data)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(AiUsageInput(today: sampleToday))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(AiUsageInput(today: sampleToday, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(AiUsageInput(today: sampleToday, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(AiUsageInput(today: sampleToday))
        model.start()
        source.push(AiUsageInput(today: sampleToday, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testLiveResetsStaleAutoRefreshArming() {
        let (model, source) = makeModel(AiUsageInput(today: sampleToday))
        model.start()
        source.push(AiUsageInput(today: sampleToday, connection: .stale)) // refresh 1
        source.push(AiUsageInput(today: sampleToday, connection: .live)) // re-arm
        source.push(AiUsageInput(today: sampleToday, connection: .stale)) // refresh 2
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(AiUsageInput(today: sampleToday))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(AiUsageInput(today: sampleToday))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AiUsageCard.surfaceSlug, "AiUsageCard")
    }
}

// MARK: - Accessibility summary

@MainActor
final class AiUsageAccessibilityTests: XCTestCase {
    func testLabelJoinsLabelAndValue() {
        XCTAssertEqual(AiUsageAccessibility.label("Today", "42 calls"), "Today: 42 calls")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyAiUsageTelemetry: AiUsageTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
