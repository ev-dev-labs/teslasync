//
//  TripLegList.Tests.swift
//  TeslaSync — P4 feature view · 0177 · TripLegList (Apple)
//
//  Adapter + projection coverage for the TripLegList surface:
//    • Format — the SI distance conversion + JS `toFixed` distance text, the
//      `Math.round` SOC / duration ports, the locale-aware `formatEnergy` (→ kWh) and
//      `formatCurrency` (symbol + grouped number), and the from→to label fallback.
//    • Config — the `make(from:)` derivations (mi/km, the trim-then-keep currency
//      symbol, the floor/finite/≥0 precision, the blank-locale → en-US fallback).
//    • Row builder — the web `legItems.map((leg, idx) => …)` interleave, including the
//      `idx < stops.length` charge-stop attach rule and the `arrival_soc < 20` flag.
//    • Projection — the render branches plus the P4 leaf contract across
//      loading / empty / error / data.
//    • Accessibility — the composed VoiceOver summary join.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store.
//

import XCTest
@testable import TeslaSync

private func makeLocation(name: String = "Home", lat: Double = 0, lng: Double = 0) -> TripLocationData {
    TripLocationData(lat: lat, lng: lng, name: name)
}

private func makeLeg(
    from: TripLocationData = makeLocation(name: "Home"),
    to: TripLocationData = makeLocation(name: "Work"),
    distanceM: Double = 12340,
    durationS: Double = 1234,
    energyWh: Double = 12300,
    startSoc: Double = 80,
    arrivalSoc: Double = 60
) -> TripLegData {
    TripLegData(
        from: from,
        to: to,
        distanceM: distanceM,
        durationS: durationS,
        energyWh: energyWh,
        startSoc: startSoc,
        arrivalSoc: arrivalSoc
    )
}

private func makeStop(
    name: String = "Supercharger",
    chargeFromSoc: Double = 20,
    chargeToSoc: Double = 80,
    chargeDurationS: Double = 1500,
    energyWh: Double = 30000,
    cost: Double = 12.5,
    isRecommended: Bool = false
) -> TripChargeStopData {
    TripChargeStopData(
        name: name,
        location: makeLocation(name: name),
        chargeFromSoc: chargeFromSoc,
        chargeToSoc: chargeToSoc,
        chargeDurationS: chargeDurationS,
        energyWh: energyWh,
        cost: cost,
        isRecommended: isRecommended
    )
}

/// `en-US` config so the grouped/decimal output is deterministic on every runner.
private let usConfig = TripLegFormatConfig(
    distanceUnit: .km,
    currencySymbol: "$",
    currencyPrecision: 2,
    localeIdentifier: "en-US"
)

// MARK: - Distance conversion + text (web `convertDistanceFromSI(...).toFixed(1)`)

final class TripLegDistanceTests: XCTestCase {
    func testConvertFromSI() {
        XCTAssertEqual(TripLegFormat.convertDistanceFromSI(1000, to: .km), 1, accuracy: 1e-9)
        XCTAssertEqual(TripLegFormat.convertDistanceFromSI(1609.344, to: .mi), 1, accuracy: 1e-9)
        XCTAssertEqual(TripLegFormat.convertDistanceFromSI(12340, to: .km), 12.34, accuracy: 1e-9)
    }

    func testToFixedMatchesJS() {
        XCTAssertEqual(TripLegFormat.toFixed(12.34, 1), "12.3")
        XCTAssertEqual(TripLegFormat.toFixed(12.36, 1), "12.4")
        XCTAssertEqual(TripLegFormat.toFixed(1, 1), "1.0")
        XCTAssertEqual(TripLegFormat.toFixed(0, 1), "0.0")
        XCTAssertEqual(TripLegFormat.toFixed(37.7749, 2), "37.77")
    }

    func testDistanceTextAppendsUnit() {
        XCTAssertEqual(TripLegFormat.distanceText(meters: 12340, config: usConfig), "12.3 km")
        let miConfig = TripLegFormatConfig(distanceUnit: .mi, localeIdentifier: "en-US")
        XCTAssertEqual(TripLegFormat.distanceText(meters: 1609.344, config: miConfig), "1.0 mi")
    }

    func testDistanceTextGuardsNonFinite() {
        XCTAssertEqual(TripLegFormat.distanceText(meters: .infinity, config: usConfig), "—")
        XCTAssertEqual(TripLegFormat.distanceText(meters: .nan, config: usConfig), "—")
    }
}

// MARK: - Rounding (port of `Math.round`)

final class TripLegRoundingTests: XCTestCase {
    func testJSRoundHalfTowardPositive() {
        XCTAssertEqual(TripLegFormat.jsRound(1234.4), 1234)
        XCTAssertEqual(TripLegFormat.jsRound(1234.5), 1235)
        XCTAssertEqual(TripLegFormat.jsRound(1234.6), 1235)
        XCTAssertEqual(TripLegFormat.jsRound(0.5), 1)
        XCTAssertEqual(TripLegFormat.jsRound(-0.5), 0)
    }

    func testJSRoundNonFiniteIsZero() {
        XCTAssertEqual(TripLegFormat.jsRound(.nan), 0)
        XCTAssertEqual(TripLegFormat.jsRound(.infinity), 0)
    }

    func testSocText() {
        XCTAssertEqual(TripLegFormat.socText(79.6), "80%")
        XCTAssertEqual(TripLegFormat.socText(19.4), "19%")
        XCTAssertEqual(TripLegFormat.socText(0), "0%")
    }

    func testSocRangeText() {
        XCTAssertEqual(TripLegFormat.socRangeText(from: 20.2, to: 80.4), "20% → 80%")
    }
}

// MARK: - Energy (web `formatEnergy(wh, { precision: 1 })` → kWh)

final class TripLegEnergyTests: XCTestCase {
    func testEnergyTextConvertsToKwhAtOneDecimal() {
        XCTAssertEqual(TripLegFormat.energyText(wh: 12300, config: usConfig), "12.3 kWh")
        XCTAssertEqual(TripLegFormat.energyText(wh: 30000, config: usConfig), "30.0 kWh")
        XCTAssertEqual(TripLegFormat.energyText(wh: 1234, config: usConfig), "1.2 kWh")
    }

    func testEnergyTextGroupsThousands() {
        XCTAssertEqual(TripLegFormat.energyText(wh: 12_345_678, config: usConfig), "12,345.7 kWh")
    }

    func testEnergyTextGuardsNonFinite() {
        XCTAssertEqual(TripLegFormat.energyText(wh: .nan, config: usConfig), "—")
        XCTAssertEqual(TripLegFormat.energyText(wh: .infinity, config: usConfig), "—")
    }
}

// MARK: - Currency (web `formatCurrency` → symbol + fmtNumber)

final class TripLegCurrencyTests: XCTestCase {
    func testCurrencyTextPrependsSymbol() {
        XCTAssertEqual(TripLegFormat.currencyText(amount: 12.5, config: usConfig), "$12.50")
        XCTAssertEqual(TripLegFormat.currencyText(amount: 1234.5, config: usConfig), "$1,234.50")
    }

    func testCurrencyTextRespectsSymbolAndPrecision() {
        let euro = TripLegFormatConfig(currencySymbol: "€", currencyPrecision: 0, localeIdentifier: "en-US")
        XCTAssertEqual(TripLegFormat.currencyText(amount: 9.6, config: euro), "€10")
    }

    func testCurrencyTextNonFiniteCollapsesToZero() {
        XCTAssertEqual(TripLegFormat.currencyText(amount: .nan, config: usConfig), "$0.00")
    }
}

// MARK: - Location label (web `name || \`${lat.toFixed(2)}, ${lng.toFixed(2)}\``)

final class TripLegLocationLabelTests: XCTestCase {
    func testUsesNameWhenPresent() {
        XCTAssertEqual(TripLegFormat.locationLabel(makeLocation(name: "Home")), "Home")
    }

    func testFallsBackToCoordinatesWhenNameEmpty() {
        let loc = makeLocation(name: "", lat: 37.7749, lng: -122.4194)
        XCTAssertEqual(TripLegFormat.locationLabel(loc), "37.77, -122.42")
    }

    func testWhitespaceNameIsKeptLikeJSTruthiness() {
        // JS `||` treats only the empty string as falsy, so a whitespace name wins.
        XCTAssertEqual(TripLegFormat.locationLabel(makeLocation(name: " ")), " ")
    }
}

// MARK: - Config derivation (web useUnits + useFormatting)

final class TripLegConfigTests: XCTestCase {
    func testDistanceUnitDerivation() {
        XCTAssertEqual(TripLegFormatConfig.make(from: .init(unitOfLength: "mi")).distanceUnit, .mi)
        XCTAssertEqual(TripLegFormatConfig.make(from: .init(unitOfLength: "km")).distanceUnit, .km)
        XCTAssertEqual(TripLegFormatConfig.make(from: .init(unitOfLength: nil)).distanceUnit, .km)
    }

    func testCurrencySymbolDerivation() {
        XCTAssertEqual(TripLegFormatConfig.make(from: .init(currencySymbol: "€")).currencySymbol, "€")
        XCTAssertEqual(TripLegFormatConfig.make(from: .init(currencySymbol: "  ")).currencySymbol, "$")
        XCTAssertEqual(TripLegFormatConfig.make(from: .init(currencySymbol: nil)).currencySymbol, "$")
        // Trim is non-empty ⇒ the untrimmed symbol is kept verbatim (web parity).
        XCTAssertEqual(TripLegFormatConfig.make(from: .init(currencySymbol: " € ")).currencySymbol, " € ")
    }

    func testPrecisionDerivation() {
        XCTAssertEqual(TripLegFormatConfig.make(from: .init(decimalPrecision: 3)).currencyPrecision, 3)
        XCTAssertEqual(TripLegFormatConfig.make(from: .init(decimalPrecision: 2.9)).currencyPrecision, 2)
        XCTAssertEqual(TripLegFormatConfig.make(from: .init(decimalPrecision: -1)).currencyPrecision, 2)
        XCTAssertEqual(TripLegFormatConfig.make(from: .init(decimalPrecision: nil)).currencyPrecision, 2)
    }

    func testLocaleDerivation() {
        XCTAssertEqual(TripLegFormatConfig.make(from: .init(locale: "fr-FR")).localeIdentifier, "fr-FR")
        XCTAssertEqual(TripLegFormatConfig.make(from: .init(locale: "  ")).localeIdentifier, "en-US")
        XCTAssertEqual(TripLegFormatConfig.make(from: .init(locale: nil)).localeIdentifier, "en-US")
    }
}

// MARK: - Row builder (web `legItems.map((leg, idx) => …)` + interleave)

final class TripLegRowBuilderTests: XCTestCase {
    func testEmptyLegsProduceNoRows() {
        let rows = TripLegRowBuilder.build(legs: [], chargeStops: [makeStop()], config: usConfig)
        XCTAssertTrue(rows.isEmpty)
    }

    func testRowsAreOneBasedAndFormatted() {
        let rows = TripLegRowBuilder.build(legs: [makeLeg()], chargeStops: [], config: usConfig)
        XCTAssertEqual(rows.count, 1)
        let row = rows[0]
        XCTAssertEqual(row.index, 1)
        XCTAssertEqual(row.id, 1)
        XCTAssertEqual(row.fromLabel, "Home")
        XCTAssertEqual(row.toLabel, "Work")
        XCTAssertEqual(row.distanceText, "12.3 km")
        XCTAssertEqual(row.durationMinutesValue, "1234")
        XCTAssertEqual(row.energyText, "12.3 kWh")
        XCTAssertEqual(row.startSocText, "80%")
        XCTAssertEqual(row.arrivalSocText, "60%")
        XCTAssertNil(row.chargeStop)
    }

    func testChargeStopAttachesOnlyWhenIndexInRange() {
        // 2 legs + 1 stop ⇒ only the first leg gets a stop (web `idx < stops.length`).
        let rows = TripLegRowBuilder.build(
            legs: [makeLeg(), makeLeg()],
            chargeStops: [makeStop(name: "SC-A")],
            config: usConfig
        )
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0].chargeStop?.name, "SC-A")
        XCTAssertNil(rows[1].chargeStop)
    }

    func testExtraStopsBeyondLegsAreDropped() {
        let rows = TripLegRowBuilder.build(
            legs: [makeLeg()],
            chargeStops: [makeStop(name: "SC-A"), makeStop(name: "SC-B")],
            config: usConfig
        )
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows[0].chargeStop?.name, "SC-A")
    }

    func testChargeStopIsFormatted() {
        let rows = TripLegRowBuilder.build(
            legs: [makeLeg()],
            chargeStops: [makeStop(
                chargeFromSoc: 20, chargeToSoc: 80, chargeDurationS: 1500,
                energyWh: 30000, cost: 12.5, isRecommended: true
            )],
            config: usConfig
        )
        guard let stop = rows[0].chargeStop else {
            return XCTFail("expected a charge stop on the first leg")
        }
        XCTAssertEqual(stop.durationMinutesValue, "25") // 1500s / 60 = 25 min
        XCTAssertEqual(stop.socRangeText, "20% → 80%")
        XCTAssertEqual(stop.energyText, "30.0 kWh")
        XCTAssertEqual(stop.costText, "$12.50")
        XCTAssertTrue(stop.isRecommended)
    }

    func testArrivalLowThreshold() {
        let low = TripLegRowBuilder.build(legs: [makeLeg(arrivalSoc: 15)], chargeStops: [], config: usConfig)
        XCTAssertTrue(low[0].arrivalSocLow)
        let edge = TripLegRowBuilder.build(legs: [makeLeg(arrivalSoc: 20)], chargeStops: [], config: usConfig)
        XCTAssertFalse(edge[0].arrivalSocLow) // web `< 20`, so exactly 20 is not low
        let high = TripLegRowBuilder.build(legs: [makeLeg(arrivalSoc: 55)], chargeStops: [], config: usConfig)
        XCTAssertFalse(high[0].arrivalSocLow)
    }
}

// MARK: - Projection (web render branch + P4 leaf contract)

final class TripLegListProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let resolved = TripLegListProjection.resolve(TripLegListInput(
            legs: [makeLeg()], isLoading: true, errorMessage: "boom"
        ))
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertTrue(resolved.rows.isEmpty)
    }

    func testLoadingWhenFlagged() {
        let resolved = TripLegListProjection.resolve(TripLegListInput(isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyWhenNoLegs() {
        let resolved = TripLegListProjection.resolve(TripLegListInput(chargeStops: [makeStop()]))
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.rows.isEmpty)
    }

    func testDataBuildsRows() {
        let resolved = TripLegListProjection.resolve(TripLegListInput(
            legs: [makeLeg(), makeLeg()],
            chargeStops: [makeStop()],
            config: usConfig
        ))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.rows.count, 2)
        XCTAssertNotNil(resolved.rows[0].chargeStop)
        XCTAssertNil(resolved.rows[1].chargeStop)
    }
}

// MARK: - Accessibility summary content

final class TripLegAccessibilityTests: XCTestCase {
    func testSummaryJoinsParts() {
        XCTAssertEqual(
            TripLegAccessibility.summary(["Leg 1", "Distance 12.3 km", "Energy 12.3 kWh"]),
            "Leg 1, Distance 12.3 km, Energy 12.3 kWh"
        )
    }

    func testSummaryDropsEmptyParts() {
        XCTAssertEqual(
            TripLegAccessibility.summary(["Charging stop, SC-A", "", "Cost $12.50"]),
            "Charging stop, SC-A, Cost $12.50"
        )
    }
}
