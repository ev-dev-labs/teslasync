//
//  Delta.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0081 · Delta (Apple)
//
//  Pure-core coverage for the change indicator (the model + view-composition + facade half lives in
//  Delta.Tests.swift; split to keep each file within the SwiftLint file-length budget). This is the
//  "adapter (cached → projection)" unit test the acceptance calls for: it drives the props + bound
//  unit preferences through ``DeltaProjector`` and asserts the verbatim port of the web `<Delta>`
//  render body, plus the value types it is built on:
//    • semantics — the metric registry lookup + the unknown-id / inline / explicit fallbacks.
//    • units     — the `useUnitLabels` affix resolution (distance / speed / temp / pressure /
//                  efficiency / currency), under both metric and imperial preferences.
//    • format    — fixed-precision locale grouping + the `formatAbsolute` affix rules.
//    • projector — loading / empty / percent / absolute / both, tone + arrow, the previous==0 percent
//                  fallback, hideArrow, the precision overrides, and the title endpoints.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no model instance, so
//  each assertion reads the pure projection directly.
//

import XCTest
@testable import TeslaSync

// MARK: - DeltaMetricRegistry (web `METRIC_SEMANTICS` + `resolveSemantic`)

final class DeltaMetricRegistryTests: XCTestCase {
    func testRegisteredIDResolvesToEntry() {
        let semantic = DeltaMetricRegistry.resolve(.id("range"))
        XCTAssertEqual(semantic.id, "range")
        XCTAssertEqual(semantic.direction, .higherBetter)
        XCTAssertEqual(semantic.unit, .mi)
    }

    func testUnknownIDFallsBackToNeutralUnitless() {
        let semantic = DeltaMetricRegistry.resolve(.id("totally_made_up"))
        XCTAssertEqual(semantic.id, "totally_made_up")
        XCTAssertEqual(semantic.direction, .neutral)
        XCTAssertNil(semantic.unit)
    }

    func testExplicitSemanticPassesThrough() {
        let custom = DeltaMetricSemantic(id: "custom", direction: .lowerBetter, unit: .percent)
        XCTAssertEqual(DeltaMetricRegistry.resolve(.semantic(custom)), custom)
    }

    func testInlineBecomesInlineSemantic() {
        let semantic = DeltaMetricRegistry.resolve(.inline(direction: .lowerBetter, unit: .kwh))
        XCTAssertEqual(semantic.id, "inline")
        XCTAssertEqual(semantic.direction, .lowerBetter)
        XCTAssertEqual(semantic.unit, .kwh)
    }
}

// MARK: - DeltaMetricUnit (web `MetricUnit` raw tokens)

final class DeltaMetricUnitTests: XCTestCase {
    func testRawValuesMatchWebTokens() {
        XCTAssertEqual(DeltaMetricUnit.whPerMi.rawValue, "wh_per_mi")
        XCTAssertEqual(DeltaMetricUnit.hours.rawValue, "h")
        XCTAssertEqual(DeltaMetricUnit.minutes.rawValue, "min")
        XCTAssertEqual(DeltaMetricUnit.celsius.rawValue, "c")
        XCTAssertEqual(DeltaMetricUnit.fahrenheit.rawValue, "f")
        XCTAssertEqual(DeltaMetricUnit.currency.rawValue, "currency")
        XCTAssertEqual(DeltaMetricUnit.allCases.count, 15)
    }
}

// MARK: - DeltaUnitLabelResolver (web `useUnitLabels`)

final class DeltaUnitLabelResolverTests: XCTestCase {
    private func resolve(_ unit: DeltaMetricUnit?, _ units: UnitPreferences) -> DeltaUnitLabels {
        DeltaUnitLabelResolver.resolve(unit, units: units)
    }

    func testDistanceSpeedTempPressureFollowPreferences() {
        XCTAssertEqual(resolve(.mi, .metric).suffix, "km")
        XCTAssertEqual(resolve(.km, .imperial).suffix, "mi")
        XCTAssertEqual(resolve(.mph, .metric).suffix, "km/h")
        XCTAssertEqual(resolve(.kph, .imperial).suffix, "mph")
        XCTAssertEqual(resolve(.celsius, .metric).suffix, "°C")
        XCTAssertEqual(resolve(.fahrenheit, .imperial).suffix, "°F")
        XCTAssertEqual(resolve(.bar, .metric).suffix, "kPa")
        XCTAssertEqual(resolve(.bar, .imperial).suffix, "psi")
    }

    func testEfficiencyFlipsWithDistanceUnit() {
        XCTAssertEqual(resolve(.whPerMi, .metric).suffix, "Wh/km")
        XCTAssertEqual(resolve(.whPerMi, .imperial).suffix, "Wh/mi")
    }

    func testFixedAndDimensionlessAffixes() {
        XCTAssertEqual(resolve(.percent, .metric).suffix, "%")
        XCTAssertEqual(resolve(.kwh, .metric).suffix, "kWh")
        XCTAssertEqual(resolve(.wh, .metric).suffix, "Wh")
        XCTAssertEqual(resolve(.hours, .metric).suffix, "h")
        XCTAssertEqual(resolve(.minutes, .metric).suffix, "min")
        XCTAssertEqual(resolve(.count, .metric), DeltaUnitLabels(prefix: "", suffix: ""))
        XCTAssertEqual(resolve(nil, .metric), DeltaUnitLabels(prefix: "", suffix: ""))
    }

    func testCurrencyPrefixFromLocale() {
        XCTAssertEqual(resolve(.currency, .metric).prefix, "$")
        XCTAssertEqual(resolve(.currency, .metric).suffix, "")
        XCTAssertEqual(DeltaUnitLabelResolver.currencySymbol(locale: "en-US"), "$")
        XCTAssertEqual(DeltaUnitLabelResolver.currencySymbol(locale: nil), "$")
    }
}

// MARK: - DeltaNumberFormat (web `fmtNumber` / `formatAbsolute`)

final class DeltaNumberFormatTests: XCTestCase {
    func testFixedPrecisionWithGrouping() {
        XCTAssertEqual(DeltaNumberFormat.fixed(5, precision: 1, locale: "en-US"), "5.0")
        XCTAssertEqual(DeltaNumberFormat.fixed(1234.5, precision: 1, locale: "en-US"), "1,234.5")
        XCTAssertEqual(DeltaNumberFormat.fixed(0, precision: 2, locale: "en-US"), "0.00")
    }

    func testAbsoluteAffixRules() {
        XCTAssertEqual(
            DeltaNumberFormat.absolute(13, prefix: "", suffix: "mi", precision: 1, locale: "en-US"),
            "13.0 mi"
        )
        XCTAssertEqual(
            DeltaNumberFormat.absolute(3.5, prefix: "$", suffix: "", precision: 2, locale: "en-US"),
            "$3.50"
        )
        XCTAssertEqual(
            DeltaNumberFormat.absolute(5, prefix: "", suffix: "%", precision: 1, locale: "en-US"),
            "5.0%"
        )
        XCTAssertEqual(
            DeltaNumberFormat.absolute(7, prefix: "", suffix: "", precision: 0, locale: "en-US"),
            "7"
        )
    }
}

// MARK: - DeltaProjector (web `<Delta>` render body)

final class DeltaProjectorTests: XCTestCase {
    private func resolve(_ inputs: DeltaInputs, units: UnitPreferences = .metric) -> DeltaProjection {
        DeltaProjector.resolve(inputs, units: units)
    }

    private func inputs(
        _ metric: DeltaMetric,
        current: Double?,
        previous: Double?,
        display: DeltaDisplay = .percent,
        comparedTo: String? = nil,
        hideArrow: Bool = false,
        loading: Bool = false,
        precision: Int? = nil
    ) -> DeltaInputs {
        DeltaInputs(
            metric: metric,
            current: current,
            previous: previous,
            display: display,
            comparedTo: comparedTo,
            hideArrow: hideArrow,
            loading: loading,
            precision: precision
        )
    }

    func testLoadingArm() {
        let projection = resolve(inputs(.id("range"), current: 312, previous: 298, loading: true))
        guard case .loading = projection else { return XCTFail("expected loading") }
    }

    func testEmptyArmForMissingOrNonFinite() {
        if case .value = resolve(inputs(.id("range"), current: nil, previous: 298)) {
            XCTFail("nil current should be empty")
        }
        if case .value = resolve(inputs(.id("range"), current: 312, previous: nil)) {
            XCTFail("nil previous should be empty")
        }
        if case .value = resolve(inputs(.id("range"), current: .nan, previous: 298)) {
            XCTFail("non-finite current should be empty")
        }
    }

    func testEmptyArmCarriesComparedTo() {
        guard case let .empty(comparedTo, size) = resolve(
            inputs(.id("range"), current: nil, previous: 298, comparedTo: "vs last week")
        ) else { return XCTFail("expected empty") }
        XCTAssertEqual(comparedTo, "vs last week")
        XCTAssertEqual(size, .sm)
    }

    func testHigherBetterRiseIsSuccessUpPercent() {
        guard case let .value(value) = resolve(
            inputs(.id("range"), current: 312, previous: 298, comparedTo: "vs last week"),
            units: .imperial
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(value.tone, .success)
        XCTAssertEqual(value.arrow, .up)
        XCTAssertEqual(value.text, "4.7%")
        XCTAssertEqual(value.comparedTo, "vs last week")
        XCTAssertEqual(value.currentText, "312.00")
        XCTAssertEqual(value.previousText, "298.00")
    }

    func testLowerBetterDropIsSuccessDown() {
        guard case let .value(value) = resolve(
            inputs(.id("efficiency"), current: 268, previous: 281)
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(value.tone, .success)
        XCTAssertEqual(value.arrow, .down)
        XCTAssertEqual(value.text, "4.6%")
    }

    func testHigherBetterDropIsDanger() {
        guard case let .value(value) = resolve(
            inputs(.id("range"), current: 290, previous: 298)
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(value.tone, .danger)
        XCTAssertEqual(value.arrow, .down)
    }

    func testNeutralNonZeroIsSecondary() {
        guard case let .value(value) = resolve(
            inputs(.id("distance"), current: 20, previous: 18)
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(value.tone, .secondary)
        XCTAssertEqual(value.arrow, .up)
    }

    func testZeroDeltaIsMutedRight() {
        guard case let .value(value) = resolve(
            inputs(.id("range"), current: 100, previous: 100)
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(value.tone, .muted)
        XCTAssertEqual(value.arrow, .right)
        XCTAssertEqual(value.text, "0.0%")
    }

    func testPreviousZeroPercentFallsBackToDash() {
        guard case let .value(value) = resolve(
            inputs(.id("range"), current: 5, previous: 0)
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(value.text, "—")
        XCTAssertEqual(value.arrow, .up)
        XCTAssertEqual(value.tone, .success)
    }

    func testAbsoluteUsesBoundUnitSuffix() {
        guard case let .value(metricValue) = resolve(
            inputs(.id("range"), current: 312, previous: 298, display: .absolute),
            units: .metric
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(metricValue.text, "14.00 km")

        guard case let .value(imperialValue) = resolve(
            inputs(.id("range"), current: 312, previous: 298, display: .absolute),
            units: .imperial
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(imperialValue.text, "14.00 mi")
    }

    func testCurrencyAbsoluteAndBothDisplay() {
        guard case let .value(currency) = resolve(
            inputs(.id("cost"), current: 42.5, previous: 39, display: .absolute, precision: 2)
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(currency.text, "$3.50")
        XCTAssertEqual(currency.tone, .danger)

        guard case let .value(both) = resolve(
            inputs(.id("range"), current: 312, previous: 298, display: .both),
            units: .imperial
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(both.text, "14.00 mi (4.7%)")
    }

    func testHideArrow() {
        guard case let .value(value) = resolve(
            inputs(.id("range"), current: 10, previous: 5, hideArrow: true)
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(value.arrow, .hidden)
    }

    func testPrecisionOverrideAppliesToPercentAndTitle() {
        guard case let .value(value) = resolve(
            inputs(.id("range"), current: 312, previous: 298, precision: 0)
        ) else { return XCTFail("expected value") }
        XCTAssertEqual(value.text, "5%")
        XCTAssertEqual(value.currentText, "312")
        XCTAssertEqual(value.previousText, "298")
    }
}
