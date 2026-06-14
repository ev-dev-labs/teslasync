//
//  WidgetGaugeHero.Tests.swift
//  TeslaSync — P4 widget primitive · 0007 · WidgetGaugeHero (Apple)
//
//  The SwiftUI view-composition half of the coverage (the Foundation-pure projector + formatter + value
//  types + model + strings live in WidgetGaugeHero.AdapterTests.swift, which also runs in the isolated
//  SwiftPM harness):
//    • Views — the public surface + the subviews compose in every real branch (standard with stats +
//      accessory, standard without accessory, gauge-only, compact) via the prop initializer, the no-
//      accessory convenience, and the injected-model seam.
//    • Tint — every ``GaugeTint`` maps to a design-token color (the arc never falls back to a default).
//    • Accessibility — the ring's composed VoiceOver label + spoken percent value, and the stat cell's
//      composed label, reproduce exactly what the views apply via `.accessibilityLabel` / `.accessibilityValue`.
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum Fixture {
    static let locale = Locale(identifier: "en_US")

    static func gauge(value: Double = 74, max: Double = 100, tint: GaugeTint = .battery) -> GaugeHeroConfig {
        GaugeHeroConfig(value: value, max: max, label: "State of charge", unit: "%", tint: tint)
    }

    static func stats(_ count: Int) -> [GaugeHeroStat] {
        (0 ..< count).map { GaugeHeroStat(label: "S\($0)", value: "\($0)", unit: "km") }
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class WidgetGaugeHeroViewTests: XCTestCase {
    func testSurfaceComposesForEveryBranch() {
        _ = WidgetGaugeHero(gauge: Fixture.gauge(), stats: Fixture.stats(3), locale: Fixture.locale) {
            Text(verbatim: "footnote")
        }
        _ = WidgetGaugeHero(gauge: Fixture.gauge(), stats: Fixture.stats(2), locale: Fixture.locale)
        _ = WidgetGaugeHero(gauge: Fixture.gauge(), locale: Fixture.locale)
        _ = WidgetGaugeHero(gauge: Fixture.gauge(), stats: Fixture.stats(3), compact: true, locale: Fixture.locale)
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = WidgetGaugeHeroModel(
            input: WidgetGaugeHeroInput(gauge: Fixture.gauge(), stats: Fixture.stats(2)),
            locale: Fixture.locale,
            telemetry: SpyTelemetry()
        )
        _ = WidgetGaugeHero(model: injected) { Text(verbatim: "x") }
        _ = WidgetGaugeHero(model: injected)
        XCTAssertEqual(WidgetGaugeHero<EmptyView>.surfaceSlug, "WidgetGaugeHero")
    }

    func testSubviewsCompose() {
        let layout = WidgetGaugeHeroProjector.resolve(
            WidgetGaugeHeroInput(gauge: Fixture.gauge(), stats: Fixture.stats(3)),
            precision: 2,
            locale: Fixture.locale
        )
        _ = GaugeRingView(ring: layout.ring)
        _ = GaugeStatsRow(stats: layout.stats)
        _ = GaugeStatCell(stat: GaugeHeroStat(label: "Range", value: "284", unit: "km"))
        _ = GaugeStatsFlowLayout(horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.xs)
    }

    func testEveryTintMapsToAColor() {
        for tint in GaugeTint.allCases {
            _ = tint.color
        }
        XCTAssertEqual(GaugeTint.allCases.count, 11)
    }
}

// MARK: - Accessibility (the ring + stat spoken readings)

@MainActor
final class WidgetGaugeHeroAccessibilityTests: XCTestCase {
    /// Reproduces the exact composition the ring applies via `.accessibilityLabel`.
    private func ringLabel(for ring: GaugeRingModel) -> String {
        WidgetGaugeHeroStrings.gaugeAccessibilityLabel(
            label: ring.label,
            value: ring.displayValue,
            unit: ring.unit
        )
    }

    func testRingLabelFoldsCaptionValueAndUnit() {
        let ring = WidgetGaugeHeroProjector.ring(
            Fixture.gauge(value: 74, max: 100),
            compact: false,
            precision: 2,
            locale: Fixture.locale
        )
        XCTAssertEqual(ringLabel(for: ring), "State of charge, 74 %")
        XCTAssertEqual(
            WidgetGaugeHeroStrings.gaugeAccessibilityValue(percent: ring.percentFilled),
            "74% of maximum"
        )
    }

    func testStatLabelFoldsValueAndUnit() {
        let stat = GaugeHeroStat(label: "Range", value: "284", unit: "km")
        XCTAssertEqual(
            WidgetGaugeHeroStrings.statAccessibilityLabel(label: stat.label, value: stat.value, unit: stat.unit),
            "Range, 284 km"
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
