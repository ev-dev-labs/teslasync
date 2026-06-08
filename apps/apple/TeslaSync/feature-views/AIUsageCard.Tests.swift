//
//  AIUsageCard.Tests.swift
//  TeslaSync — P4 feature view · 0203 · AIUsageCard (Apple)
//
//  Unit coverage for the AIUsageCard surface:
//    • Adapter — the number / integer / count formatters (port of numberFormat.ts fmtNumber /
//      fmtInt), the `microCentsAsDollars` scaling + non-finite guard, the `formatCurrency`
//      prefix, the live-caption composition, and the three-cell metrics builder
//      (cached → projection).
//    • State holder — `AIUsageProjection` across loading / empty / error / data, plus the
//      `AIUsageModel` wiring, the P1/S11 `view.opened` telemetry, and the stale auto-refresh.
//    • Accessibility — the VoiceOver usage-cell label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store:
//  the model is driven by `InMemoryAIUsageSource`, and the locale is injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private let sampleUsage = AIUsageData(
    callCount: 42,
    inputTokens: 18450,
    outputTokens: 7320,
    costMicroCents: 1_234_560
)

// MARK: - Number / integer / count formatting (port of numberFormat.ts)

final class AIUsageFormatNumberTests: XCTestCase {
    func testNumberGroupsAndFixesTwoDecimals() {
        XCTAssertEqual(AIUsageFormat.number(1234.5, locale: enUS), "1,234.50")
        XCTAssertEqual(AIUsageFormat.number(0, locale: enUS), "0.00")
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(AIUsageFormat.number(.nan, locale: enUS), "0.00")
        XCTAssertEqual(AIUsageFormat.number(.infinity, locale: enUS), "0.00")
        XCTAssertEqual(AIUsageFormat.number(-.infinity, locale: enUS), "0.00")
    }

    func testIntegerGroupsWithNoFractionAndRounds() {
        XCTAssertEqual(AIUsageFormat.integer(18450, locale: enUS), "18,450")
        XCTAssertEqual(AIUsageFormat.integer(7320, locale: enUS), "7,320")
        XCTAssertEqual(AIUsageFormat.integer(12345.6, locale: enUS), "12,346")
        XCTAssertEqual(AIUsageFormat.integer(0, locale: enUS), "0")
    }

    func testCountFormatsFiniteAndDashesOtherwise() {
        XCTAssertEqual(AIUsageFormat.count(42, locale: enUS), "42")
        XCTAssertEqual(AIUsageFormat.count(18450, locale: enUS), "18,450")
        XCTAssertEqual(AIUsageFormat.count(nil, locale: enUS), "—")
        XCTAssertEqual(AIUsageFormat.count(.nan, locale: enUS), "—")
        XCTAssertEqual(AIUsageFormat.count(.infinity, locale: enUS), "—")
    }
}

// MARK: - Micro-cents → dollars (web `microCentsAsDollars`)

final class AIUsageFormatMicroCentsTests: XCTestCase {
    func testDividesByOneMillion() {
        XCTAssertEqual(AIUsageFormat.microCentsAsDollars(1_234_560), 1.23456, accuracy: 1e-9)
        XCTAssertEqual(AIUsageFormat.microCentsAsDollars(50_000_000), 50, accuracy: 1e-9)
        XCTAssertEqual(AIUsageFormat.microCentsAsDollars(0), 0, accuracy: 1e-9)
    }

    func testCoercesNullAndNonFiniteToZero() {
        XCTAssertEqual(AIUsageFormat.microCentsAsDollars(nil), 0, accuracy: 1e-9)
        XCTAssertEqual(AIUsageFormat.microCentsAsDollars(.nan), 0, accuracy: 1e-9)
        XCTAssertEqual(AIUsageFormat.microCentsAsDollars(.infinity), 0, accuracy: 1e-9)
    }
}

// MARK: - Currency (web `useFormatting().formatCurrency`)

final class AIUsageFormatCurrencyTests: XCTestCase {
    func testPrefixesSymbolAndFormatsAtPrecision() {
        XCTAssertEqual(AIUsageFormat.currency(1.23456, symbol: "$", precision: 2, locale: enUS), "$1.23")
        XCTAssertEqual(AIUsageFormat.currency(50, symbol: "$", precision: 2, locale: enUS), "$50.00")
        XCTAssertEqual(AIUsageFormat.currency(1234.5, symbol: "$", precision: 2, locale: enUS), "$1,234.50")
    }

    func testHonoursAlternateSymbolAndPrecision() {
        XCTAssertEqual(AIUsageFormat.currency(1.23456, symbol: "€", precision: 2, locale: enUS), "€1.23")
        XCTAssertEqual(AIUsageFormat.currency(1.23456, symbol: "$", precision: 0, locale: enUS), "$1")
        XCTAssertEqual(AIUsageFormat.currency(1.23456, symbol: "$", precision: 4, locale: enUS), "$1.2346")
    }
}

// MARK: - Live caption composition (web `${count} ${liveSuffix}`)

final class AIUsageFormatCaptionTests: XCTestCase {
    func testLiveCaptionJoinsCountAndSuffix() {
        XCTAssertEqual(
            AIUsageFormat.liveCaption(callCount: "42", suffix: "Helix calls today."),
            "42 Helix calls today."
        )
    }
}

// MARK: - Metrics builder (cached → projection)

final class AIUsageMetricsBuilderTests: XCTestCase {
    func testBuildsThreeCellsInSourceOrder() {
        let metrics = AIUsageMetricsBuilder.metrics(
            for: sampleUsage,
            currencySymbol: "$",
            precision: 2,
            locale: enUS
        )
        XCTAssertEqual(metrics.map(\.id), ["tokensIn", "tokensOut", "cost"])
        XCTAssertEqual(metrics.map(\.value), ["18,450", "7,320", "$1.23"])
        XCTAssertEqual(metrics.map(\.labelKey), [
            "ai.settings.usage.tokensIn",
            "ai.settings.usage.tokensOut",
            "ai.settings.usage.cost"
        ])
    }

    func testZeroDataRendersZeroedCellsNeverDashes() {
        let metrics = AIUsageMetricsBuilder.metrics(
            for: .zero,
            currencySymbol: "$",
            precision: 2,
            locale: enUS
        )
        XCTAssertEqual(metrics.map(\.value), ["0", "0", "$0.00"])
    }

    func testCostCellHonoursCurrencyContext() {
        let metrics = AIUsageMetricsBuilder.metrics(
            for: sampleUsage,
            currencySymbol: "€",
            precision: 2,
            locale: enUS
        )
        XCTAssertEqual(metrics.first { $0.id == "cost" }?.value, "€1.23")
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

final class AIUsageProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let resolved = AIUsageProjection.resolve(
            AIUsageInput(data: sampleUsage, errorMessage: "boom"),
            locale: enUS
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.metrics.isEmpty)
        XCTAssertEqual(resolved.caption, .hint)
    }

    func testLoadingWhenFlagged() {
        let resolved = AIUsageProjection.resolve(AIUsageInput(isLoading: true), locale: enUS)
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertTrue(resolved.metrics.isEmpty)
        XCTAssertEqual(resolved.caption, .hint)
    }

    func testEmptyWhenAbsentSnapshotResolvesZeroedCells() {
        let resolved = AIUsageProjection.resolve(AIUsageInput(data: nil), locale: enUS)
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertEqual(resolved.metrics.map(\.value), ["0", "0", "$0.00"])
        XCTAssertEqual(resolved.caption, .hint)
    }

    func testEmptyWhenNoCallsTodayButTokensPresent() {
        let zeroCalls = AIUsageData(callCount: 0, inputTokens: 100, outputTokens: 50, costMicroCents: 0)
        let resolved = AIUsageProjection.resolve(AIUsageInput(data: zeroCalls), locale: enUS)
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertEqual(resolved.metrics.map(\.value), ["100", "50", "$0.00"])
        XCTAssertEqual(resolved.caption, .hint)
    }

    func testDataResolvesThreeCellsAndLiveCaption() {
        let resolved = AIUsageProjection.resolve(AIUsageInput(data: sampleUsage), locale: enUS)
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.metrics.count, 3)
        XCTAssertEqual(resolved.metrics.first?.value, "18,450")
        XCTAssertEqual(resolved.caption, .live(callCount: "42"))
    }

    func testDataPropagatesCurrencyContext() {
        let resolved = AIUsageProjection.resolve(
            AIUsageInput(data: sampleUsage, currencySymbol: "€", decimalPrecision: 2),
            locale: enUS
        )
        XCTAssertEqual(resolved.metrics.first { $0.id == "cost" }?.value, "€1.23")
    }
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor
final class AIUsageModelTests: XCTestCase {
    private func makeModel(
        _ input: AIUsageInput,
        telemetry: AIUsageTelemetry = OSLogAIUsageTelemetry()
    ) -> (AIUsageModel, InMemoryAIUsageSource) {
        let source = InMemoryAIUsageSource(initial: input)
        let model = AIUsageModel(source: source, telemetry: telemetry, locale: enUS)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyAIUsageTelemetry()
        let (model, source) = makeModel(AIUsageInput(data: sampleUsage), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.metrics.count, 3)
        XCTAssertEqual(model.caption, .live(callCount: "42"))
        XCTAssertEqual(spy.surfaces, [AIUsageCard.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(AIUsageInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertTrue(model.metrics.isEmpty)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(AIUsageInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(AIUsageInput(data: sampleUsage))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.metrics.count, 3)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(AIUsageInput(data: sampleUsage))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(AIUsageInput(data: sampleUsage, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(AIUsageInput(data: sampleUsage, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(AIUsageInput(data: sampleUsage))
        model.start()
        source.push(AIUsageInput(data: sampleUsage, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(AIUsageInput(data: sampleUsage))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(AIUsageInput(data: sampleUsage))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AIUsageCard.surfaceSlug, "AIUsageCard")
    }
}

// MARK: - Accessibility summary content

final class AIUsageAccessibilityTests: XCTestCase {
    func testCellLabelJoinsLabelAndValue() {
        XCTAssertEqual(
            AIUsageAccessibility.cellLabel(label: "Tokens in", value: "18,450"),
            "Tokens in: 18,450"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyAIUsageTelemetry: AIUsageTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
