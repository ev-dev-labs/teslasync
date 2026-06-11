//
//  LiveStateIndicators.Tests.swift
//  TeslaSync — P4 feature view · 0292 · LiveStateIndicators (Apple)
//
//  Unit coverage for the LiveStateIndicators surface:
//    • Adapter / Format — the SI m/s → km/h·mph conversion, the number formatter (locale
//      grouping, half-up, non-finite guard), the empty sentinel, and the per-badge
//      projection (cached → projection): value + tone for every chip.
//    • State holder — `LiveStateIndicatorsProjector` across loading / empty / error /
//      data, plus the `LiveStateIndicatorsModel` wiring, the P1/S11 `view.opened`
//      telemetry, and the stale auto-refresh transition.
//    • Accessibility / i18n — the badge label composition + the value resolution facade.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryLiveStateIndicatorsSource`, and the locale is
//  injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func metricUnits(precision: Int? = nil) -> LiveStateUnits {
    LiveStateUnits(speed: .kilometersPerHour, precision: precision, locale: "en_US")
}

private func imperialUnits(precision: Int? = nil) -> LiveStateUnits {
    LiveStateUnits(speed: .milesPerHour, precision: precision, locale: "en_US")
}

@MainActor
final class LiveStateIndicatorsTests: XCTestCase {
    // MARK: - Speed conversion (ports of convertSpeedFromSI)

    func testSpeedUnitConversionMatchesWeb() {
        // 22.352 m/s = 50 mph exactly = 80.4672 km/h.
        XCTAssertEqual(LiveStateSpeedUnit.milesPerHour.fromMetersPerSecond(22.352), 50, accuracy: 0.0001)
        XCTAssertEqual(LiveStateSpeedUnit.kilometersPerHour.fromMetersPerSecond(22.352), 80.4672, accuracy: 0.0001)
        XCTAssertEqual(LiveStateSpeedUnit.kilometersPerHour.fromMetersPerSecond(0), 0, accuracy: 0.0001)
    }

    func testSpeedUnitSymbolAndInit() {
        XCTAssertEqual(LiveStateSpeedUnit.kilometersPerHour.symbol, "km/h")
        XCTAssertEqual(LiveStateSpeedUnit.milesPerHour.symbol, "mph")
        XCTAssertEqual(LiveStateSpeedUnit(symbol: "mph"), .milesPerHour)
        XCTAssertEqual(LiveStateSpeedUnit(symbol: "km/h"), .kilometersPerHour)
        XCTAssertEqual(LiveStateSpeedUnit(symbol: "kn"), .kilometersPerHour) // default
    }

    // MARK: - Number / speed formatting (ports of numberFormat.ts + formatSpeed)

    func testNumberUsesGroupingFixedDigitsAndHalfUp() {
        XCTAssertEqual(LiveStateFormat.number(1500, decimals: 0, locale: enUS), "1,500")
        XCTAssertEqual(LiveStateFormat.number(80.4672, decimals: 0, locale: enUS), "80")
        XCTAssertEqual(LiveStateFormat.number(80.5, decimals: 0, locale: enUS), "81") // half away from zero
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(LiveStateFormat.number(.infinity, decimals: 0, locale: enUS), "0")
        XCTAssertEqual(LiveStateFormat.number(.nan, decimals: 2, locale: enUS), "0.00")
    }

    func testFormatSpeedDefaultsToZeroDecimalsWithUnitAndSpace() {
        XCTAssertEqual(LiveStateFormat.speed(metersPerSecond: 22.352, units: metricUnits()), "80 km/h")
        XCTAssertEqual(LiveStateFormat.speed(metersPerSecond: 22.352, units: imperialUnits()), "50 mph")
        XCTAssertEqual(LiveStateFormat.speed(metersPerSecond: 0, units: metricUnits()), "0 km/h")
    }

    func testFormatSpeedHonoursPrecisionOverride() {
        XCTAssertEqual(LiveStateFormat.speed(metersPerSecond: 22.352, units: metricUnits(precision: 1)), "80.5 km/h")
    }

    func testFormatSpeedNonFiniteIsEmptySentinel() {
        XCTAssertEqual(LiveStateFormat.speed(metersPerSecond: .infinity, units: metricUnits()), "—")
        XCTAssertEqual(LiveStateFormat.speed(metersPerSecond: nil, units: metricUnits()), "—")
        let custom = LiveStateUnits(speed: .kilometersPerHour, locale: "en_US", emptyDisplay: "n/a")
        XCTAssertEqual(LiveStateFormat.speed(metersPerSecond: .nan, units: custom), "n/a")
    }

    // MARK: - Reading moving branch (web `state.speed > 0`)

    func testReadingMovingBranch() {
        XCTAssertFalse(LiveStateReading(speedMetersPerSecond: 0).isMoving)
        XCTAssertFalse(LiveStateReading(speedMetersPerSecond: -1).isMoving)
        XCTAssertFalse(LiveStateReading(speedMetersPerSecond: .nan).isMoving)
        XCTAssertTrue(LiveStateReading(speedMetersPerSecond: 0.1).isMoving)
    }

    // MARK: - Projection (cached → projection): value + tone per chip

    func testProjectionActiveReadingValuesAndTones() {
        let reading = LiveStateReading(
            speedMetersPerSecond: 22.352,
            isLocked: true,
            sentryMode: true,
            isClimateOn: true,
            isCharging: true
        )
        let indicators = LiveStateProjection.make(reading: reading, units: metricUnits()).indicators
        XCTAssertEqual(indicators.map(\.kind), [.speed, .lock, .sentry, .climate, .charging])

        XCTAssertEqual(indicators[0].prefix, .speedLabel)
        XCTAssertEqual(indicators[0].value, .literal("80 km/h"))
        XCTAssertEqual(indicators[0].tone, .success) // moving
        XCTAssertEqual(indicators[1].value, .locked)
        XCTAssertEqual(indicators[1].tone, .success)
        XCTAssertEqual(indicators[2].value, .active) // sentry armed
        XCTAssertEqual(indicators[2].tone, .warning)
        XCTAssertEqual(indicators[3].value, .on) // climate on
        XCTAssertEqual(indicators[3].tone, .info)
        XCTAssertEqual(indicators[4].value, .charging)
        XCTAssertEqual(indicators[4].tone, .warning)
    }

    func testProjectionRestingReadingValuesAndTones() {
        let indicators = LiveStateProjection.make(reading: LiveStateReading(), units: imperialUnits()).indicators

        XCTAssertEqual(indicators[0].value, .literal("0 mph"))
        XCTAssertEqual(indicators[0].tone, .neutral) // not moving
        XCTAssertNil(indicators[1].prefix)
        XCTAssertEqual(indicators[1].value, .unlocked)
        XCTAssertEqual(indicators[1].tone, .danger) // unlocked is the danger branch
        XCTAssertEqual(indicators[2].value, .off)
        XCTAssertEqual(indicators[2].tone, .neutral)
        XCTAssertEqual(indicators[3].value, .off)
        XCTAssertEqual(indicators[3].tone, .neutral)
        XCTAssertNil(indicators[4].prefix)
        XCTAssertEqual(indicators[4].value, .notCharging)
        XCTAssertEqual(indicators[4].tone, .neutral)
    }

    func testProjectionAlwaysRendersFiveBadges() {
        XCTAssertEqual(LiveStateProjection.make(reading: LiveStateReading(), units: metricUnits()).indicators.count, 5)
    }

    // MARK: - Projector (loading / empty / error / data precedence)

    func testProjectorErrorTakesPrecedence() {
        let input = LiveStateIndicatorsInput(reading: LiveStateReading(isLocked: true), errorMessage: "boom")
        guard case let .error(message) = LiveStateIndicatorsProjector.resolve(input).phase else {
            return XCTFail("expected .error")
        }
        XCTAssertEqual(message, "boom")
    }

    func testProjectorLoadingWhenFetching() {
        let input = LiveStateIndicatorsInput(reading: LiveStateReading(), isLoading: true)
        XCTAssertEqual(LiveStateIndicatorsProjector.resolve(input).phase, .loading)
    }

    func testProjectorEmptyWhenNoReading() {
        XCTAssertEqual(LiveStateIndicatorsProjector.resolve(LiveStateIndicatorsInput(reading: nil)).phase, .empty)
    }

    func testProjectorDataWhenReadingPresent() {
        let input = LiveStateIndicatorsInput(reading: LiveStateReading(isCharging: true), units: metricUnits())
        guard case let .data(projection) = LiveStateIndicatorsProjector.resolve(input).phase else {
            return XCTFail("expected .data")
        }
        XCTAssertEqual(projection.indicators[4].value, .charging)
    }

    // MARK: - Model wiring + telemetry (P1/S11 view.opened)

    func testModelStartEmitsViewOpenedSlugOnce() {
        let spy = SpyLiveStateIndicatorsTelemetry()
        let model = LiveStateIndicatorsModel(source: InMemoryLiveStateIndicatorsSource(), telemetry: spy)
        model.start()
        model.start() // idempotent
        XCTAssertEqual(spy.openedSurfaces, ["LiveStateIndicators"])
        XCTAssertEqual(LiveStateIndicators.surfaceSlug, "LiveStateIndicators")
    }

    func testModelAppliesPushedSnapshot() {
        let source = InMemoryLiveStateIndicatorsSource()
        let model = LiveStateIndicatorsModel(source: source, telemetry: SpyLiveStateIndicatorsTelemetry())
        model.start()
        source.push(LiveStateIndicatorsInput(reading: LiveStateReading(sentryMode: true), units: metricUnits()))
        guard case let .data(projection) = model.phase else {
            return XCTFail("expected .data after push")
        }
        XCTAssertEqual(projection.indicators[2].value, .active)
        XCTAssertEqual(model.connection, .live)
    }

    func testModelStartStopRefreshForwardToSource() {
        let source = InMemoryLiveStateIndicatorsSource()
        let model = LiveStateIndicatorsModel(source: source, telemetry: SpyLiveStateIndicatorsTelemetry())
        model.start()
        model.refresh()
        model.stop()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testModelAutoRefreshesOnceOnStaleTransition() {
        let source = InMemoryLiveStateIndicatorsSource()
        let model = LiveStateIndicatorsModel(source: source, telemetry: SpyLiveStateIndicatorsTelemetry())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(LiveStateIndicatorsInput(reading: LiveStateReading(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "stale transition triggers one auto-refresh")
        source.push(LiveStateIndicatorsInput(reading: LiveStateReading(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "staying stale does not re-refresh")
        XCTAssertEqual(model.connection, .stale)
    }

    func testModelOfflineKeepsLastKnownData() {
        let source = InMemoryLiveStateIndicatorsSource()
        let model = LiveStateIndicatorsModel(source: source, telemetry: SpyLiveStateIndicatorsTelemetry())
        model.start()
        source.push(LiveStateIndicatorsInput(reading: LiveStateReading(isLocked: true), connection: .offline))
        guard case .data = model.phase else {
            return XCTFail("offline still shows the cached reading")
        }
        XCTAssertEqual(model.connection, .offline)
    }

    // MARK: - Accessibility + i18n facade

    func testBadgeLabelComposesPrefixAndValue() {
        XCTAssertEqual(LiveStateIndicatorsAccessibility.badgeLabel(prefix: "Speed", value: "80 km/h"), "Speed: 80 km/h")
        XCTAssertEqual(LiveStateIndicatorsAccessibility.badgeLabel(prefix: nil, value: "Locked"), "Locked")
        XCTAssertEqual(LiveStateIndicatorsAccessibility.badgeLabel(prefix: "", value: "Charging"), "Charging")
    }

    func testStringsResolveLocalizedAndLiteral() {
        XCTAssertEqual(LiveStateIndicatorsStrings.resolve(.speedLabel), "Speed")
        XCTAssertEqual(LiveStateIndicatorsStrings.resolve(.locked), "Locked")
        XCTAssertEqual(LiveStateIndicatorsStrings.resolve(.unlocked), "Unlocked")
        XCTAssertEqual(LiveStateIndicatorsStrings.resolve(.off), "Off")
        XCTAssertEqual(LiveStateIndicatorsStrings.resolve(.notCharging), "Not Charging")
        XCTAssertEqual(LiveStateIndicatorsStrings.resolve(.literal("80 km/h")), "80 km/h")
    }

    func testKindOrderingIsStable() {
        XCTAssertEqual(
            LiveStateIndicatorKind.allCases,
            [.speed, .lock, .sentry, .climate, .charging]
        )
    }
}

// MARK: - Test doubles

/// Records the surfaces opened so the `view.opened` contract can be asserted without an
/// `os_log` round-trip. Single-threaded test usage only.
private final class SpyLiveStateIndicatorsTelemetry: LiveStateIndicatorsTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}
