//
//  FormatterPrefsBridge.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0146 · FormatterPrefsBridge (Apple)
//
//  Pure coverage for the dependency-light core: the `resolveLocale` fallback + `isExplicit` predicate
//  (the verbatim web `lib/locale.ts` port), the process-wide formatter-globals store guards (the
//  verbatim web `setGlobalLocale` / `setGlobalPrecision` ports — empty → en-US, clamp [0, 20], the
//  en-US / 2 defaults), the diagnostics slug, and the VoiceOver label builders. No store, no view.
//

import XCTest
@testable import TeslaSync

// MARK: - Locale resolution (web `resolveLocale` + `isExplicit`)

final class FormatterPrefsBridgeLocaleTests: XCTestCase {
    func testExplicitTagIsReturnedUnchanged() {
        XCTAssertEqual(FormatterPrefsBridgeLocale.resolve("de-DE"), "de-DE")
        XCTAssertTrue(FormatterPrefsBridgeLocale.isExplicit("de-DE"))
    }

    func testNilEmptyAndWhitespaceFallBackToEnUS() {
        XCTAssertEqual(FormatterPrefsBridgeLocale.resolve(nil), "en-US")
        XCTAssertEqual(FormatterPrefsBridgeLocale.resolve(""), "en-US")
        XCTAssertEqual(FormatterPrefsBridgeLocale.resolve("   "), "en-US")
        XCTAssertFalse(FormatterPrefsBridgeLocale.isExplicit(nil))
        XCTAssertFalse(FormatterPrefsBridgeLocale.isExplicit(""))
        XCTAssertFalse(FormatterPrefsBridgeLocale.isExplicit("  \n "))
    }
}

// MARK: - Formatter globals store (web `numberFormat` module globals)

final class FormatterPrefsBridgeStoreTests: XCTestCase {
    func testDefaultsMatchTheWebGlobals() {
        let store = FormatterPrefsBridgeStore()
        XCTAssertEqual(store.locale, "en-US")
        XCTAssertEqual(store.precision, 2)
    }

    func testSetLocaleKeepsExplicitButEmptiesToEnUS() {
        let store = FormatterPrefsBridgeStore()
        store.setLocale("fr-FR")
        XCTAssertEqual(store.locale, "fr-FR")
        store.setLocale("   ")
        XCTAssertEqual(store.locale, "en-US")
    }

    func testSetPrecisionClampsToZeroThroughTwenty() {
        let store = FormatterPrefsBridgeStore()
        store.setPrecision(5)
        XCTAssertEqual(store.precision, 5)
        store.setPrecision(-3)
        XCTAssertEqual(store.precision, 0)
        store.setPrecision(25)
        XCTAssertEqual(store.precision, 20)
    }

    func testCustomInitialState() {
        let store = FormatterPrefsBridgeStore(locale: "ja-JP", precision: 4)
        XCTAssertEqual(store.locale, "ja-JP")
        XCTAssertEqual(store.precision, 4)
    }
}

// MARK: - Globals applier (the production seam over the store)

final class FormatterPrefsBridgeGlobalsApplierTests: XCTestCase {
    func testApplierReadsAndWritesTheStore() {
        let store = FormatterPrefsBridgeStore()
        let applier = FormatterPrefsBridgeGlobalsApplier(store: store)
        XCTAssertEqual(applier.currentLocale(), "en-US")
        XCTAssertEqual(applier.currentPrecision(), 2)
        applier.apply(locale: "es-ES")
        applier.apply(precision: 1)
        XCTAssertEqual(store.locale, "es-ES")
        XCTAssertEqual(store.precision, 1)
        XCTAssertEqual(applier.currentLocale(), "es-ES")
        XCTAssertEqual(applier.currentPrecision(), 1)
    }
}

// MARK: - Metadata + accessibility builders

final class FormatterPrefsBridgeMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(FormatterPrefsBridgeMeta.surfaceSlug, "FormatterPrefsBridge")
        XCTAssertEqual(FormatterPrefsBridge.surfaceSlug, "FormatterPrefsBridge")
    }

    func testAppliedAccessibilityLabelComposition() {
        let label = FormatterPrefsBridgeAccessibility.appliedLabel(
            title: "Formatting preferences",
            localeLabel: "Locale",
            locale: "en-US",
            precisionLabel: "Decimal precision",
            precision: 2
        )
        XCTAssertEqual(label, "Formatting preferences. Locale en-US. Decimal precision 2")
    }

    func testTitledAccessibilityLabelComposition() {
        XCTAssertEqual(
            FormatterPrefsBridgeAccessibility.titledLabel(title: "Using device defaults", message: "Body."),
            "Using device defaults. Body."
        )
        XCTAssertEqual(
            FormatterPrefsBridgeAccessibility.titledLabel(title: "Only title", message: ""),
            "Only title"
        )
    }
}
