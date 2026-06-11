//
//  BatteryRangePanel.ProjectionTests.swift
//  TeslaSync — P4 feature view · 0289 · BatteryRangePanel (Apple)
//
//  Projection + distance-math coverage for the BatteryRangePanel surface:
//    • Math — the SI-meters → display conversion + `formatDistance` parity (null → em-dash, the
//      "<n> <unit>" suffix, the precision default + per-call override, locale grouping), the
//      `fmtNumber` helper, and the `batteryColor` band thresholds.
//    • Projection — the radial gauge (clamp + integer/fractional precision + band), the Rated /
//      Ideal range cards, and the Charging card (charging vs. not, the `/h` suffix, the
//      `time_to_full_charge > 0` "Full in {h}h" subtitle), plus the VoiceOver labels each composes.
//
//  The state-holder (`BatteryRangePanelModel`) wiring is covered in BatteryRangePanel.Tests.swift.
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no real store.
//

import XCTest
@testable import TeslaSync

/// Echo localizer: returns the web English fallback so projected strings can be asserted without the
/// catalog (the P1/S10 facade is exercised separately).
private let echo: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Kilometer / mile preference bags pinned to en_US so number formatting is deterministic in tests.
private let cPrefs = BatteryRangePanelUnitPrefs(distance: .kilometers, localeIdentifier: "en_US")
private let iPrefs = BatteryRangePanelUnitPrefs(distance: .miles, localeIdentifier: "en_US")

// MARK: - Distance math (web `convertDistanceFromSI` / `formatDistance` / `fmtNumber`)

final class BatteryRangePanelMathTests: XCTestCase {
    func testConvertDistanceFromSI() {
        XCTAssertEqual(BatteryRangePanelMath.convertDistanceFromSI(1000, to: .kilometers), 1.0, accuracy: 1e-9)
        XCTAssertEqual(BatteryRangePanelMath.convertDistanceFromSI(1609.344, to: .miles), 1.0, accuracy: 1e-9)
        XCTAssertEqual(BatteryRangePanelMath.convertDistanceFromSI(0.3048, to: .feet), 1.0, accuracy: 1e-9)
    }

    func testNumberFormattingGroupingAndNaN() {
        XCTAssertEqual(BatteryRangePanelMath.number(1234.5, decimals: 1, localeIdentifier: "en_US"), "1,234.5")
        XCTAssertEqual(BatteryRangePanelMath.number(48, decimals: 1, localeIdentifier: "en_US"), "48.0")
        XCTAssertEqual(BatteryRangePanelMath.number(.nan, decimals: 0, localeIdentifier: "en_US"), "0")
    }

    func testResolvePrecisionOverrideThenPreferenceThenFallback() {
        XCTAssertEqual(BatteryRangePanelMath.resolvePrecision(override: 0, preference: nil, fallback: 1), 0)
        XCTAssertEqual(BatteryRangePanelMath.resolvePrecision(override: nil, preference: 3, fallback: 1), 3)
        XCTAssertEqual(BatteryRangePanelMath.resolvePrecision(override: nil, preference: nil, fallback: 1), 1)
        // Negative override / preference are ignored (web `>= 0` guard).
        XCTAssertEqual(BatteryRangePanelMath.resolvePrecision(override: -1, preference: nil, fallback: 1), 1)
        XCTAssertEqual(BatteryRangePanelMath.resolvePrecision(override: nil, preference: -2, fallback: 1), 1)
    }

    func testDistanceNullishIsEmDash() {
        XCTAssertEqual(distanceKm(nil), "—")
        XCTAssertEqual(distanceKm(.nan), "—")
    }

    func testDistanceFormatsWithUnitSuffixAndGrouping() {
        XCTAssertEqual(distanceKm(402_000, override: 0), "402 km")
        XCTAssertEqual(distanceKm(1_234_000, override: 0), "1,234 km")
        // Default distance precision (1) when no override.
        XCTAssertEqual(distanceKm(48000), "48.0 km")
    }

    func testDistanceConvertsToMiles() {
        XCTAssertEqual(distanceMi(402_000, override: 0), "250 mi")
        XCTAssertEqual(distanceMi(48000), "29.8 mi")
    }

    func testBatteryBandThresholds() {
        XCTAssertEqual(BatteryRangePanelMath.band(for: 82), .high)
        XCTAssertEqual(BatteryRangePanelMath.band(for: 61), .high)
        XCTAssertEqual(BatteryRangePanelMath.band(for: 60), .medium)
        XCTAssertEqual(BatteryRangePanelMath.band(for: 26), .medium)
        XCTAssertEqual(BatteryRangePanelMath.band(for: 25), .low)
        XCTAssertEqual(BatteryRangePanelMath.band(for: nil), .unknown)
        XCTAssertEqual(BatteryRangePanelMath.band(for: .nan), .unknown)
    }

    private func distanceKm(_ meters: Double?, override: Int? = nil) -> String {
        BatteryRangePanelMath.distance(
            meters,
            unit: .kilometers,
            precisionOverride: override,
            preferencePrecision: nil,
            localeIdentifier: "en_US"
        )
    }

    private func distanceMi(_ meters: Double?, override: Int? = nil) -> String {
        BatteryRangePanelMath.distance(
            meters,
            unit: .miles,
            precisionOverride: override,
            preferencePrecision: nil,
            localeIdentifier: "en_US"
        )
    }
}

// MARK: - Projection: radial gauge (web `RadialGauge`)

@MainActor final class BatteryRangePanelGaugeTests: XCTestCase {
    private func gauge(_ level: Double?, _ prefs: BatteryRangePanelUnitPrefs = cPrefs) -> BatteryRangePanelGaugeModel {
        BatteryRangePanelProjection.content(
            snapshot: BatteryRangePanelSnapshot(batteryLevel: level),
            prefs: prefs,
            localize: echo
        ).gauge
    }

    func testIntegerLevelRendersNoDecimalsWithBand() {
        let model = gauge(82)
        XCTAssertEqual(model.label, "Battery")
        XCTAssertEqual(model.valueText, "82")
        XCTAssertEqual(model.unit, "%")
        XCTAssertTrue(model.hasValue)
        XCTAssertEqual(model.fraction, 0.82, accuracy: 1e-9)
        XCTAssertEqual(model.band, .high)
        XCTAssertEqual(model.accessibilityLabel, "Battery: 82%")
    }

    func testFractionalLevelUsesGaugePrecision() {
        let model = gauge(47.5)
        XCTAssertEqual(model.valueText, "47.50")
        XCTAssertEqual(model.band, .medium)
        XCTAssertEqual(model.accessibilityLabel, "Battery: 47.50%")
    }

    func testNilLevelIsEmDashEmptyRing() {
        let model = gauge(nil)
        XCTAssertEqual(model.valueText, "—")
        XCTAssertFalse(model.hasValue)
        XCTAssertEqual(model.fraction, 0, accuracy: 1e-9)
        XCTAssertEqual(model.band, .unknown)
        XCTAssertEqual(model.accessibilityLabel, "Battery: —")
    }

    func testLevelClampsToZeroToHundred() {
        XCTAssertEqual(gauge(150).valueText, "100")
        XCTAssertEqual(gauge(150).fraction, 1.0, accuracy: 1e-9)
        XCTAssertEqual(gauge(-5).valueText, "0")
        XCTAssertEqual(gauge(-5).fraction, 0, accuracy: 1e-9)
    }

    func testNilSnapshotGaugeIsEmDash() {
        let model = BatteryRangePanelProjection.content(snapshot: nil, prefs: cPrefs, localize: echo).gauge
        XCTAssertEqual(model.valueText, "—")
        XCTAssertEqual(model.band, .unknown)
    }
}

// MARK: - Projection: range cards (web `MetricCard` — Rated / Ideal)

@MainActor final class BatteryRangePanelRangeCardTests: XCTestCase {
    private func metric(_ snapshot: BatteryRangePanelSnapshot, _ id: String) -> BatteryRangePanelMetricModel? {
        BatteryRangePanelProjection.content(snapshot: snapshot, prefs: cPrefs, localize: echo)
            .metrics.first { $0.id == id }
    }

    func testMetricOrder() {
        let ids = BatteryRangePanelProjection.content(
            snapshot: BatteryRangePanelSnapshot(),
            prefs: cPrefs,
            localize: echo
        ).metrics.map(\.id)
        XCTAssertEqual(ids, ["ratedRange", "idealRange", "charging"])
    }

    func testRatedRangeCard() {
        let card = metric(BatteryRangePanelSnapshot(ratedRangeMeters: 402_000), "ratedRange")
        XCTAssertEqual(card?.label, "Rated Range")
        XCTAssertEqual(card?.value, "402 km")
        XCTAssertEqual(card?.tone, .accent)
        XCTAssertEqual(card?.systemImage, "location.north.fill")
        XCTAssertNil(card?.subtitle)
        XCTAssertEqual(card?.accessibilityLabel, "Rated Range: 402 km")
    }

    func testIdealRangeCard() {
        let card = metric(BatteryRangePanelSnapshot(idealRangeMeters: 431_000), "idealRange")
        XCTAssertEqual(card?.label, "Ideal Range")
        XCTAssertEqual(card?.value, "431 km")
        XCTAssertEqual(card?.tone, .success)
        XCTAssertEqual(card?.systemImage, "mappin.and.ellipse")
        XCTAssertEqual(card?.accessibilityLabel, "Ideal Range: 431 km")
    }

    func testNilRangesRenderEmDash() {
        XCTAssertEqual(metric(BatteryRangePanelSnapshot(), "ratedRange")?.value, "—")
        XCTAssertEqual(metric(BatteryRangePanelSnapshot(), "idealRange")?.value, "—")
        XCTAssertEqual(metric(BatteryRangePanelSnapshot(), "ratedRange")?.accessibilityLabel, "Rated Range: —")
    }

    func testImperialPreferenceConvertsRanges() {
        let card = BatteryRangePanelProjection.content(
            snapshot: BatteryRangePanelSnapshot(ratedRangeMeters: 402_000),
            prefs: iPrefs,
            localize: echo
        ).metrics.first { $0.id == "ratedRange" }
        XCTAssertEqual(card?.value, "250 mi")
    }
}

// MARK: - Projection: charging card (web `is_charging ? "{rate}/h" : "Not Charging"` + subtitle)

@MainActor final class BatteryRangePanelChargingTests: XCTestCase {
    private func charging(
        _ snapshot: BatteryRangePanelSnapshot,
        _ prefs: BatteryRangePanelUnitPrefs = cPrefs
    ) -> BatteryRangePanelMetricModel? {
        BatteryRangePanelProjection.content(snapshot: snapshot, prefs: prefs, localize: echo)
            .metrics.first { $0.id == "charging" }
    }

    func testChargingShowsRatePerHourAndFullInSubtitle() {
        let snapshot = BatteryRangePanelSnapshot(
            isCharging: true,
            chargeRateMeters: 48000,
            timeToFullChargeHours: 1.5
        )
        let card = charging(snapshot)
        XCTAssertEqual(card?.label, "Charging")
        XCTAssertEqual(card?.value, "48.0 km/h")
        XCTAssertEqual(card?.subtitle, "Full in 1.5h")
        XCTAssertEqual(card?.tone, .success)
        XCTAssertEqual(card?.systemImage, "bolt.batteryblock.fill")
        XCTAssertEqual(card?.accessibilityLabel, "Charging: 48.0 km/h. Full in 1.5h")
    }

    func testNotChargingShowsLabelAndCyanTone() {
        let card = charging(BatteryRangePanelSnapshot(isCharging: false))
        XCTAssertEqual(card?.value, "Not Charging")
        XCTAssertNil(card?.subtitle)
        XCTAssertEqual(card?.tone, .accent)
        XCTAssertEqual(card?.accessibilityLabel, "Charging: Not Charging")
    }

    func testNilChargingIsTreatedAsNotCharging() {
        let card = charging(BatteryRangePanelSnapshot())
        XCTAssertEqual(card?.value, "Not Charging")
        XCTAssertEqual(card?.tone, .accent)
    }

    func testChargingWithoutPositiveTimeOmitsSubtitle() {
        let zero = charging(BatteryRangePanelSnapshot(
            isCharging: true,
            chargeRateMeters: 12000,
            timeToFullChargeHours: 0
        ))
        XCTAssertEqual(zero?.value, "12.0 km/h")
        XCTAssertNil(zero?.subtitle)
        let absent = charging(BatteryRangePanelSnapshot(isCharging: true, chargeRateMeters: 12000))
        XCTAssertNil(absent?.subtitle)
    }

    func testImperialChargingRate() {
        let snapshot = BatteryRangePanelSnapshot(
            isCharging: true,
            chargeRateMeters: 48000,
            timeToFullChargeHours: 1.5
        )
        let card = charging(snapshot, iPrefs)
        XCTAssertEqual(card?.value, "29.8 mi/h")
        XCTAssertEqual(card?.accessibilityLabel, "Charging: 29.8 mi/h. Full in 1.5h")
    }
}

// MARK: - Accessibility: every projected element exposes a non-empty VoiceOver label

@MainActor final class BatteryRangePanelAccessibilityTests: XCTestCase {
    func testAllLabelsPresent() {
        let snapshot = BatteryRangePanelSnapshot(
            batteryLevel: 64,
            ratedRangeMeters: 300_000,
            idealRangeMeters: 320_000,
            isCharging: true,
            chargeRateMeters: 40000,
            timeToFullChargeHours: 2
        )
        let content = BatteryRangePanelProjection.content(snapshot: snapshot, prefs: cPrefs, localize: echo)
        XCTAssertFalse(content.gauge.accessibilityLabel.isEmpty)
        XCTAssertEqual(content.metrics.count, 3)
        for metric in content.metrics {
            XCTAssertFalse(metric.accessibilityLabel.isEmpty, "metric \(metric.id) is missing a VoiceOver label")
            XCTAssertTrue(
                metric.accessibilityLabel.contains(metric.label),
                "metric \(metric.id) label not announced"
            )
        }
    }
}
