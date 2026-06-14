//
//  WidgetBigNumber.AdapterTests.swift
//  TeslaSync — P4 widget primitive · 0001 · WidgetBigNumber (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity + web defaults, the value
//  resolution (the verbatim port of `value !== null ? (animated ? <AnimatedNumber/> : <span/>) :
//  <span muted>{nullDisplay}</span>`), the locale-aware formatting (the animated `decimals = 0` grouping
//  vs the static natural-fraction grouping, plus the non-finite guard), the affix passthrough, the spoken
//  text, and the value-type equality. Split from WidgetBigNumber.Tests.swift (the SwiftUI / state-holder
//  half) to keep each file within the SwiftLint file-length budget. These run in the TeslaSync(/-macOS)
//  XCTest targets; the derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum Fixture {
    static let locale = Locale(identifier: "en_US")

    static func input(
        value: Double?,
        unit: String? = nil,
        label: String? = nil,
        subtitle: String? = nil,
        badge: BigNumberBadge? = nil,
        valueTone: BigNumberValueTone = .primary,
        nullDisplay: String = WidgetBigNumberSurface.defaultNullDisplay,
        animated: Bool = true
    ) -> WidgetBigNumberInput {
        WidgetBigNumberInput(
            value: value,
            unit: unit,
            label: label,
            subtitle: subtitle,
            badge: badge,
            valueTone: valueTone,
            nullDisplay: nullDisplay,
            animated: animated,
            locale: locale
        )
    }
}

// MARK: - Surface identity + web defaults

final class WidgetBigNumberAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(WidgetBigNumberSurface.slug, "WidgetBigNumber")
    }

    func testWebDefaultsMatchSource() {
        XCTAssertEqual(WidgetBigNumberSurface.defaultNullDisplay, "—")
        XCTAssertTrue(WidgetBigNumberSurface.defaultAnimated)
        XCTAssertEqual(WidgetBigNumberSurface.defaultValueTone, .primary)
    }

    func testInputDefaultsApplyWebDefaults() {
        let input = WidgetBigNumberInput(value: 1)
        XCTAssertEqual(input.nullDisplay, "—")
        XCTAssertTrue(input.animated)
        XCTAssertEqual(input.valueTone, .primary)
        XCTAssertNil(input.unit)
        XCTAssertNil(input.badge)
    }
}

// MARK: - Value resolution (web value decision)

final class WidgetBigNumberValueDisplayTests: XCTestCase {
    func testNilValueResolvesToNullDisplayWithNullText() {
        let display = WidgetBigNumberProjector.valueDisplay(Fixture.input(value: nil, nullDisplay: "n/a"))
        XCTAssertEqual(display, .nullDisplay(text: "n/a"))
    }

    func testNilValueUsesDefaultNullDisplay() {
        let display = WidgetBigNumberProjector.valueDisplay(Fixture.input(value: nil))
        XCTAssertEqual(display, .nullDisplay(text: "—"))
    }

    func testAnimatedValueResolvesToAnimatedWithSettledFormatting() {
        let display = WidgetBigNumberProjector.valueDisplay(Fixture.input(value: 1420, animated: true))
        XCTAssertEqual(display, .animated(raw: 1420, settled: "1,420", tone: .primary, locale: Fixture.locale))
    }

    func testStaticValueResolvesToStaticDisplay() {
        let display = WidgetBigNumberProjector.valueDisplay(Fixture.input(value: 3.7, animated: false))
        XCTAssertEqual(display, .staticValue(text: "3.7", tone: .primary))
    }

    func testValueDisplayCarriesTone() {
        let animated = WidgetBigNumberProjector.valueDisplay(
            Fixture.input(value: 5, valueTone: .success, animated: true)
        )
        XCTAssertEqual(animated, .animated(raw: 5, settled: "5", tone: .success, locale: Fixture.locale))
        let staticValue = WidgetBigNumberProjector.valueDisplay(
            Fixture.input(value: 5, valueTone: .danger, animated: false)
        )
        XCTAssertEqual(staticValue, .staticValue(text: "5", tone: .danger))
    }

    func testSpokenTextReadsTheSettledFigure() {
        XCTAssertEqual(
            BigNumberValueDisplay.animated(raw: 1420, settled: "1,420", tone: .primary, locale: Fixture.locale)
                .spokenText,
            "1,420"
        )
        XCTAssertEqual(BigNumberValueDisplay.staticValue(text: "3.7", tone: .primary).spokenText, "3.7")
        XCTAssertEqual(BigNumberValueDisplay.nullDisplay(text: "—").spokenText, "—")
    }
}

// MARK: - Formatting (web `<AnimatedNumber>` decimals=0 vs raw `{value}`)

final class WidgetBigNumberFormattingTests: XCTestCase {
    func testAnimatedSettledUsesZeroFractionDigitsAndGrouping() {
        XCTAssertEqual(BigNumberFormatting.animatedSettled(1420, locale: Fixture.locale), "1,420")
        XCTAssertEqual(BigNumberFormatting.animatedSettled(86.7, locale: Fixture.locale), "87")
        XCTAssertEqual(BigNumberFormatting.animatedSettled(1_234_567, locale: Fixture.locale), "1,234,567")
    }

    func testStaticDisplayKeepsNaturalFractionDigitsWithGrouping() {
        XCTAssertEqual(BigNumberFormatting.staticDisplay(42, locale: Fixture.locale), "42")
        XCTAssertEqual(BigNumberFormatting.staticDisplay(3.7, locale: Fixture.locale), "3.7")
        XCTAssertEqual(BigNumberFormatting.staticDisplay(1234.5, locale: Fixture.locale), "1,234.5")
    }

    func testStaticDisplayClampsFloatingPointNoise() {
        XCTAssertEqual(BigNumberFormatting.staticDisplay(0.1 + 0.2, locale: Fixture.locale), "0.3")
    }

    func testSafeMapsNonFiniteToZero() {
        XCTAssertEqual(BigNumberFormatting.safe(.nan), 0)
        XCTAssertEqual(BigNumberFormatting.safe(.infinity), 0)
        XCTAssertEqual(BigNumberFormatting.safe(-.infinity), 0)
        XCTAssertEqual(BigNumberFormatting.safe(12.5), 12.5)
    }

    func testNonFiniteValueFormatsAsZero() {
        XCTAssertEqual(BigNumberFormatting.animatedSettled(.nan, locale: Fixture.locale), "0")
        XCTAssertEqual(BigNumberFormatting.staticDisplay(.infinity, locale: Fixture.locale), "0")
    }
}

// MARK: - Resolve (affix passthrough)

final class WidgetBigNumberResolveTests: XCTestCase {
    func testResolvePassesThroughAffixes() {
        let badge = BigNumberBadge(text: "Optimal", variant: .success)
        let projection = WidgetBigNumberProjector.resolve(
            Fixture.input(value: 1420, unit: "mi", label: "Range", subtitle: "EPA", badge: badge)
        )
        XCTAssertEqual(projection.unit, "mi")
        XCTAssertEqual(projection.label, "Range")
        XCTAssertEqual(projection.subtitle, "EPA")
        XCTAssertEqual(projection.badge, badge)
        XCTAssertEqual(projection.value, .animated(raw: 1420, settled: "1,420", tone: .primary, locale: Fixture.locale))
    }

    func testResolveNilValueStillCarriesAffixes() {
        let projection = WidgetBigNumberProjector.resolve(Fixture.input(value: nil, unit: "kWh", label: "Energy"))
        XCTAssertEqual(projection.value, .nullDisplay(text: "—"))
        XCTAssertEqual(projection.unit, "kWh")
        XCTAssertEqual(projection.label, "Energy")
    }
}

// MARK: - Value-type equality

final class WidgetBigNumberValueTypeTests: XCTestCase {
    func testBadgeEqualityDistinguishesFields() {
        let base = BigNumberBadge(text: "Optimal", variant: .success)
        XCTAssertEqual(base, BigNumberBadge(text: "Optimal", variant: .success))
        XCTAssertNotEqual(base, BigNumberBadge(text: "Degraded", variant: .success))
        XCTAssertNotEqual(base, BigNumberBadge(text: "Optimal", variant: .warning))
    }

    func testInputEqualityDistinguishesFields() {
        let base = Fixture.input(value: 10, unit: "mi")
        XCTAssertEqual(base, Fixture.input(value: 10, unit: "mi"))
        XCTAssertNotEqual(base, Fixture.input(value: 11, unit: "mi"))
        XCTAssertNotEqual(base, Fixture.input(value: 10, unit: "km"))
        XCTAssertNotEqual(base, Fixture.input(value: 10, unit: "mi", valueTone: .success))
        XCTAssertNotEqual(base, Fixture.input(value: 10, unit: "mi", animated: false))
        XCTAssertNotEqual(base, Fixture.input(value: 10, unit: "mi", nullDisplay: "n/a"))
    }

    func testProjectionEquality() {
        let lhs = WidgetBigNumberProjector.resolve(Fixture.input(value: 10, unit: "mi"))
        let rhs = WidgetBigNumberProjector.resolve(Fixture.input(value: 10, unit: "mi"))
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, WidgetBigNumberProjector.resolve(Fixture.input(value: 11, unit: "mi")))
    }
}
