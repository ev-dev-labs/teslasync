//
//  WidgetGaugeHero.AdapterTests.swift
//  TeslaSync — P4 widget primitive · 0007 · WidgetGaugeHero (Apple)
//
//  The host-runnable, Foundation-pure coverage for the gauge hero — everything that does not need SwiftUI,
//  so it executes both in the TeslaSync(/-macOS) XCTest targets AND in the isolated SwiftPM harness the
//  Apple surface gate uses while the full app build is deferred: the projector (size table, clamp +
//  fraction incl. the `max <= 0` guard, ring/stats/resolve), the formatter (decimals rule + locale-aware
//  grouping + `safeNumber`), field-distinguishing value-type equality, the model (once-only `view.opened`,
//  `update` re-derivation), and the P1/S10 strings facade. The SwiftUI view-composition half lives in
//  WidgetGaugeHero.Tests.swift. No network; the derivation is pure, with no clock.
//

import XCTest
@testable import TeslaSync

private enum Fixture {
    static let locale = Locale(identifier: "en_US")

    static func gauge(
        value: Double = 74,
        max: Double = 100,
        label: String = "State of charge",
        unit: String = "%",
        tint: GaugeTint = .battery
    ) -> GaugeHeroConfig {
        GaugeHeroConfig(value: value, max: max, label: label, unit: unit, tint: tint)
    }

    static func stat(_ label: String, value: String = "10", unit: String? = "km") -> GaugeHeroStat {
        GaugeHeroStat(label: label, value: value, unit: unit)
    }

    static func stats(_ count: Int) -> [GaugeHeroStat] {
        (0 ..< count).map { stat("S\($0)", value: "\($0)") }
    }

    static func input(
        value: Double = 74,
        max: Double = 100,
        stats: [GaugeHeroStat] = [],
        compact: Bool = false
    ) -> WidgetGaugeHeroInput {
        WidgetGaugeHeroInput(gauge: gauge(value: value, max: max), stats: stats, compact: compact)
    }
}

// MARK: - Surface identity + geometry

final class WidgetGaugeHeroAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(WidgetGaugeHeroSurface.slug, "WidgetGaugeHero")
    }

    func testGeometryMatchesWeb() {
        // Web `size = compact ? 70 : 100`, `STROKE_WIDTH = 8`.
        XCTAssertEqual(WidgetGaugeHeroProjector.diameter(compact: false), 100)
        XCTAssertEqual(WidgetGaugeHeroProjector.diameter(compact: true), 70)
        XCTAssertEqual(WidgetGaugeHeroProjector.strokeWidth, 8)
    }
}

// MARK: - Clamp + fraction (web `Math.max(0, Math.min(value, max))` / `clamped / max`)

final class WidgetGaugeHeroClampTests: XCTestCase {
    func testClamp() {
        XCTAssertEqual(WidgetGaugeHeroProjector.clamp(value: 60, maximum: 100), 60)
        XCTAssertEqual(WidgetGaugeHeroProjector.clamp(value: 140, maximum: 100), 100)
        XCTAssertEqual(WidgetGaugeHeroProjector.clamp(value: -25, maximum: 100), 0)
    }

    func testFraction() {
        XCTAssertEqual(WidgetGaugeHeroProjector.fraction(value: 74, maximum: 100), 0.74, accuracy: 1e-9)
        XCTAssertEqual(WidgetGaugeHeroProjector.fraction(value: 250, maximum: 100), 1, accuracy: 1e-9)
        XCTAssertEqual(WidgetGaugeHeroProjector.fraction(value: -10, maximum: 100), 0, accuracy: 1e-9)
    }

    func testFractionGuardsAgainstNonPositiveMaximum() {
        // Web `clamped / max` would divide by zero -> NaN; the native projector guards to 0.
        XCTAssertEqual(WidgetGaugeHeroProjector.fraction(value: 5, maximum: 0), 0, accuracy: 1e-9)
        XCTAssertEqual(WidgetGaugeHeroProjector.fraction(value: 5, maximum: -100), 0, accuracy: 1e-9)
    }
}

// MARK: - Formatter (web `Number.isInteger ? 0 : precision` + `fmtNumber`)

final class WidgetGaugeHeroFormatterTests: XCTestCase {
    func testIsIntegerMatchesWeb() {
        XCTAssertTrue(GaugeValueFormatter.isInteger(74))
        XCTAssertTrue(GaugeValueFormatter.isInteger(-3))
        XCTAssertFalse(GaugeValueFormatter.isInteger(74.5))
        XCTAssertFalse(GaugeValueFormatter.isInteger(.nan))
        XCTAssertFalse(GaugeValueFormatter.isInteger(.infinity))
    }

    func testDecimalsRuleAndPrecisionClamp() {
        XCTAssertEqual(GaugeValueFormatter.decimals(forClamped: 74, precision: 2), 0)
        XCTAssertEqual(GaugeValueFormatter.decimals(forClamped: 74.5, precision: 2), 2)
        XCTAssertEqual(GaugeValueFormatter.decimals(forClamped: 1.5, precision: 25), 20)
        XCTAssertEqual(GaugeValueFormatter.decimals(forClamped: 1.5, precision: -4), 0)
    }

    func testFormatGroupsAndFixesFractionDigits() {
        XCTAssertEqual(GaugeValueFormatter.format(48213, decimals: 0, locale: Fixture.locale), "48,213")
        XCTAssertEqual(GaugeValueFormatter.format(1234.5, decimals: 2, locale: Fixture.locale), "1,234.50")
        XCTAssertEqual(GaugeValueFormatter.format(162, decimals: 0, locale: Fixture.locale), "162")
        XCTAssertEqual(GaugeValueFormatter.format(0, decimals: 0, locale: Fixture.locale), "0")
        XCTAssertEqual(GaugeValueFormatter.format(74.25, decimals: 2, locale: Fixture.locale), "74.25")
    }

    func testFormatFallsBackToZeroForNonFinite() {
        XCTAssertEqual(GaugeValueFormatter.format(.nan, decimals: 2, locale: Fixture.locale), "0.00")
        XCTAssertEqual(GaugeValueFormatter.format(.infinity, decimals: 0, locale: Fixture.locale), "0")
    }
}

// MARK: - Ring + stats + resolve

final class WidgetGaugeHeroRingTests: XCTestCase {
    func testRingProjectsIntegerReading() {
        let ring = WidgetGaugeHeroProjector.ring(
            Fixture.gauge(value: 74, max: 100), compact: false, precision: 2, locale: Fixture.locale
        )
        XCTAssertEqual(ring.clampedValue, 74)
        XCTAssertEqual(ring.fraction, 0.74, accuracy: 1e-9)
        XCTAssertEqual(ring.displayValue, "74")
        XCTAssertEqual(ring.unit, "%")
        XCTAssertEqual(ring.label, "State of charge")
        XCTAssertEqual(ring.tint, .battery)
        XCTAssertEqual(ring.diameter, 100)
        XCTAssertEqual(ring.strokeWidth, 8)
        XCTAssertEqual(ring.percentFilled, 74)
    }

    func testRingProjectsFractionalReadingWithPrecision() {
        let ring = WidgetGaugeHeroProjector.ring(
            Fixture.gauge(value: 48.6, max: 75, label: "Usable energy", unit: "kWh", tint: .energy),
            compact: true, precision: 2, locale: Fixture.locale
        )
        XCTAssertEqual(ring.displayValue, "48.60")
        XCTAssertEqual(ring.fraction, 0.648, accuracy: 1e-9)
        XCTAssertEqual(ring.diameter, 70)
        XCTAssertEqual(ring.percentFilled, 65)
    }

    func testRingClampsOverScaleAndZeroFillsDegenerateMaximum() {
        let over = WidgetGaugeHeroProjector.ring(
            Fixture.gauge(value: 140, max: 100), compact: false, precision: 2, locale: Fixture.locale
        )
        XCTAssertEqual(over.clampedValue, 100)
        XCTAssertEqual(over.fraction, 1, accuracy: 1e-9)

        let degenerate = WidgetGaugeHeroProjector.ring(
            Fixture.gauge(value: 5, max: 0, unit: ""), compact: false, precision: 2, locale: Fixture.locale
        )
        XCTAssertEqual(degenerate.fraction, 0, accuracy: 1e-9)
        XCTAssertEqual(degenerate.clampedValue, 0)
    }

    func testStatsGate() {
        // Web `!compact && stats.length > 0`.
        XCTAssertEqual(WidgetGaugeHeroProjector.stats(Fixture.input(stats: Fixture.stats(3))).map(\.id), [0, 1, 2])
        XCTAssertTrue(WidgetGaugeHeroProjector.stats(Fixture.input(stats: Fixture.stats(3), compact: true)).isEmpty)
        XCTAssertTrue(WidgetGaugeHeroProjector.stats(Fixture.input(stats: [])).isEmpty)
        let stat = Fixture.stat("Range", value: "284", unit: "km")
        XCTAssertEqual(WidgetGaugeHeroProjector.stats(Fixture.input(stats: [stat]))[0].stat, stat)
    }

    func testResolveGatesAccessoriesByCompact() {
        let standard = WidgetGaugeHeroProjector.resolve(
            Fixture.input(stats: Fixture.stats(2)), precision: 2, locale: Fixture.locale
        )
        XCTAssertEqual(standard.ring.diameter, 100)
        XCTAssertEqual(standard.stats.count, 2)
        XCTAssertFalse(standard.isCompact)
        XCTAssertTrue(standard.showsAccessories)

        let compact = WidgetGaugeHeroProjector.resolve(
            Fixture.input(stats: Fixture.stats(2), compact: true), precision: 2, locale: Fixture.locale
        )
        XCTAssertEqual(compact.ring.diameter, 70)
        XCTAssertTrue(compact.stats.isEmpty)
        XCTAssertTrue(compact.isCompact)
        XCTAssertFalse(compact.showsAccessories)
    }
}

// MARK: - Value-type equality

final class WidgetGaugeHeroValueTypeTests: XCTestCase {
    func testConfigEqualityDistinguishesFields() {
        let base = Fixture.gauge(value: 74, max: 100, label: "A", unit: "%", tint: .battery)
        XCTAssertEqual(base, Fixture.gauge(value: 74, max: 100, label: "A", unit: "%", tint: .battery))
        XCTAssertNotEqual(base, Fixture.gauge(value: 75, max: 100, label: "A", unit: "%", tint: .battery))
        XCTAssertNotEqual(base, Fixture.gauge(value: 74, max: 200, label: "A", unit: "%", tint: .battery))
        XCTAssertNotEqual(base, Fixture.gauge(value: 74, max: 100, label: "B", unit: "%", tint: .battery))
        XCTAssertNotEqual(base, Fixture.gauge(value: 74, max: 100, label: "A", unit: "kWh", tint: .battery))
        XCTAssertNotEqual(base, Fixture.gauge(value: 74, max: 100, label: "A", unit: "%", tint: .energy))
    }

    func testStatEqualityDistinguishesFields() {
        let base = GaugeHeroStat(label: "Range", value: "284", unit: "km")
        XCTAssertEqual(base, GaugeHeroStat(label: "Range", value: "284", unit: "km"))
        XCTAssertNotEqual(base, GaugeHeroStat(label: "Added", value: "284", unit: "km"))
        XCTAssertNotEqual(base, GaugeHeroStat(label: "Range", value: "285", unit: "km"))
        XCTAssertNotEqual(base, GaugeHeroStat(label: "Range", value: "284", unit: "mi"))
        XCTAssertNotEqual(base, GaugeHeroStat(label: "Range", value: "284", unit: nil))
    }

    func testInputAndLayoutEqualityDistinguishCompact() {
        let stats = Fixture.stats(2)
        let base = WidgetGaugeHeroInput(gauge: Fixture.gauge(), stats: stats, compact: false)
        XCTAssertEqual(base, WidgetGaugeHeroInput(gauge: Fixture.gauge(), stats: stats, compact: false))
        XCTAssertNotEqual(base, WidgetGaugeHeroInput(gauge: Fixture.gauge(value: 1), stats: stats, compact: false))
        XCTAssertNotEqual(base, WidgetGaugeHeroInput(gauge: Fixture.gauge(), stats: stats, compact: true))

        let lhs = WidgetGaugeHeroProjector.resolve(base, precision: 2, locale: Fixture.locale)
        XCTAssertEqual(lhs, WidgetGaugeHeroProjector.resolve(base, precision: 2, locale: Fixture.locale))
        let compactInput = WidgetGaugeHeroInput(gauge: Fixture.gauge(), stats: stats, compact: true)
        XCTAssertNotEqual(lhs, WidgetGaugeHeroProjector.resolve(compactInput, precision: 2, locale: Fixture.locale))
    }

    func testRingAndStatModelEquality() {
        let base = GaugeRingModel(
            clampedValue: 74, fraction: 0.74, displayValue: "74", unit: "%",
            label: "SoC", tint: .battery, diameter: 100, strokeWidth: 8
        )
        XCTAssertEqual(base, base)
        let other = GaugeRingModel(
            clampedValue: 74, fraction: 0.5, displayValue: "74", unit: "%",
            label: "SoC", tint: .battery, diameter: 100, strokeWidth: 8
        )
        XCTAssertNotEqual(base, other)

        let stat = Fixture.stat("Rate", value: "11", unit: "kW")
        XCTAssertEqual(GaugeStatModel(id: 4, stat: stat).id, 4)
        XCTAssertNotEqual(GaugeStatModel(id: 4, stat: stat), GaugeStatModel(id: 5, stat: stat))
        XCTAssertEqual(GaugeTint.allCases.count, 11)
    }
}

// MARK: - Model (telemetry + derivation)

@MainActor
final class WidgetGaugeHeroModelTests: XCTestCase {
    private func model(
        _ input: WidgetGaugeHeroInput,
        precision: Int = 2,
        telemetry: WidgetGaugeHeroTelemetry = OSLogWidgetGaugeHeroTelemetry()
    ) -> WidgetGaugeHeroModel {
        WidgetGaugeHeroModel(input: input, precision: precision, locale: Fixture.locale, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(Fixture.input(stats: Fixture.stats(2)), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [WidgetGaugeHeroSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(Fixture.input(), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [WidgetGaugeHeroSurface.slug], "view.opened fires once per instance")
    }

    func testUpdateReDerivesProjectionAndHonorsPrecision() {
        let holder = model(Fixture.input(value: 74, max: 100))
        XCTAssertEqual(holder.projection.ring.displayValue, "74")
        XCTAssertTrue(holder.projection.showsAccessories)
        holder.update(Fixture.input(value: 48.6, max: 75, stats: Fixture.stats(2)))
        XCTAssertEqual(holder.projection.ring.displayValue, "48.60")
        XCTAssertEqual(holder.projection.stats.count, 2)

        let precise = model(Fixture.input(value: 33.3333, max: 100), precision: 3)
        XCTAssertEqual(precise.projection.ring.displayValue, "33.333")
    }
}

// MARK: - Strings facade (P1/S10)

final class WidgetGaugeHeroStringsTests: XCTestCase {
    func testValueWithUnitJoinsWhenPresentAndOmitsWhenAbsent() {
        XCTAssertEqual(WidgetGaugeHeroStrings.valueWithUnit(value: "284", unit: "km"), "284 km")
        XCTAssertEqual(WidgetGaugeHeroStrings.valueWithUnit(value: "284", unit: nil), "284")
        XCTAssertEqual(WidgetGaugeHeroStrings.valueWithUnit(value: "284", unit: ""), "284")
    }

    func testGaugeReadings() {
        XCTAssertEqual(
            WidgetGaugeHeroStrings.gaugeAccessibilityLabel(label: "State of charge", value: "74", unit: "%"),
            "State of charge, 74 %"
        )
        XCTAssertEqual(
            WidgetGaugeHeroStrings.gaugeAccessibilityLabel(label: "Speed", value: "63", unit: ""),
            "Speed, 63"
        )
        XCTAssertEqual(WidgetGaugeHeroStrings.gaugeAccessibilityValue(percent: 74), "74% of maximum")
    }

    func testStatReading() {
        XCTAssertEqual(
            WidgetGaugeHeroStrings.statAccessibilityLabel(label: "Range", value: "284", unit: "km"),
            "Range, 284 km"
        )
        XCTAssertEqual(
            WidgetGaugeHeroStrings.statAccessibilityLabel(label: "Reserve", value: "10", unit: nil),
            "Reserve, 10"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: WidgetGaugeHeroTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}
