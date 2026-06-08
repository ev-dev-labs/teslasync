//
//  GeneralSettings.Tests.swift
//  TeslaSync — P4 feature view · 0207 · GeneralSettings (Apple)
//
//  Adapter + localization + accessibility coverage for the General Settings
//  surface: the Tesla setting-enum parser + unit detectors (port parity with
//  lib/parseSettingEnum.ts), the sync-units-from-car projection, the render-phase
//  + freshness resolution (ADR-013), the decimal-precision preview, the
//  currency-glyph → ISO map, the option catalogs, the P1/S10 i18n facade, and the
//  VoiceOver copy. Pure: no network, no view. The view-model behaviour lives in
//  GeneralSettings.ModelTests.swift.
//

import XCTest
@testable import TeslaSync

// MARK: - Setting-enum parsing (port of lib/parseSettingEnum.ts)

@MainActor
final class GeneralSettingsEnumParseTests: XCTestCase {
    func testDistanceEnumVariants() {
        XCTAssertEqual(GeneralSettingsAdapter.parseSettingEnum("DistanceUnitMiles", category: .distance), "Miles")
        XCTAssertEqual(GeneralSettingsAdapter.parseSettingEnum("distanceunitkm", category: .distance), "Kilometers")
        XCTAssertEqual(GeneralSettingsAdapter.parseSettingEnum("Kilometers", category: .distance), "Kilometers")
        XCTAssertEqual(GeneralSettingsAdapter.parseSettingEnum("mi", category: .distance), "Miles")
    }

    func testTemperatureAndPressureEnumVariants() {
        XCTAssertEqual(
            GeneralSettingsAdapter.parseSettingEnum("TemperatureUnitCelsius", category: .temperature), "Celsius"
        )
        XCTAssertEqual(GeneralSettingsAdapter.parseSettingEnum("f", category: .temperature), "Fahrenheit")
        XCTAssertEqual(GeneralSettingsAdapter.parseSettingEnum("PressureUnitPsi", category: .pressure), "PSI")
        XCTAssertEqual(GeneralSettingsAdapter.parseSettingEnum("bar", category: .pressure), "Bar")
        XCTAssertEqual(GeneralSettingsAdapter.parseSettingEnum("kpa", category: .pressure), "kPa")
    }

    func testUnknownFallsBackToRawAndEmptyToDash() {
        XCTAssertEqual(GeneralSettingsAdapter.parseSettingEnum("WeirdUnit", category: .distance), "WeirdUnit")
        XCTAssertEqual(GeneralSettingsAdapter.parseSettingEnum(nil, category: .distance), "—")
        XCTAssertEqual(GeneralSettingsAdapter.parseSettingEnum("", category: .temperature), "—")
    }

    func testUnitDetectors() {
        XCTAssertTrue(GeneralSettingsAdapter.isMiles("DistanceUnitMiles"))
        XCTAssertFalse(GeneralSettingsAdapter.isMiles("DistanceUnitKilometers"))
        XCTAssertTrue(GeneralSettingsAdapter.isFahrenheit("TemperatureUnitFahrenheit"))
        XCTAssertTrue(GeneralSettingsAdapter.isPSI("PressureUnitPsi"))
        XCTAssertTrue(GeneralSettingsAdapter.isBar("PressureUnitBar"))
        XCTAssertFalse(GeneralSettingsAdapter.isBar(nil))
        XCTAssertFalse(GeneralSettingsAdapter.isPSI(""))
    }
}

// MARK: - Sync units from car (port of `syncUnitsFromCar`)

@MainActor
final class GeneralSettingsSyncTests: XCTestCase {
    func testImperialCarSnapsFormToImperial() {
        let prefs = CarPreferences(
            distanceUnit: "DistanceUnitMiles",
            temperatureUnit: "TemperatureUnitFahrenheit",
            tirePressureUnit: "PressureUnitPsi"
        )
        let outcome = GeneralSettingsAdapter.syncUnitsFromCar(form: .default, preferences: prefs)
        XCTAssertTrue(outcome.didChange)
        XCTAssertEqual(outcome.form.unitOfLength, "mi")
        XCTAssertEqual(outcome.form.unitOfTemp, "F")
        XCTAssertEqual(outcome.form.unitOfPressure, "psi")
    }

    func testMetricCarSnapsFormToMetric() {
        let prefs = CarPreferences(
            distanceUnit: "DistanceUnitKilometers",
            temperatureUnit: "TemperatureUnitCelsius",
            tirePressureUnit: "PressureUnitBar"
        )
        var imperial = AppSettingsState.default
        imperial.unitOfLength = "mi"
        imperial.unitOfTemp = "F"
        imperial.unitOfPressure = "psi"
        let outcome = GeneralSettingsAdapter.syncUnitsFromCar(form: imperial, preferences: prefs)
        XCTAssertEqual(outcome.form.unitOfLength, "km")
        XCTAssertEqual(outcome.form.unitOfTemp, "C")
        XCTAssertEqual(outcome.form.unitOfPressure, "bar")
    }

    func testUnmappablePressureLeavesPressureUntouched() {
        let prefs = CarPreferences(tirePressureUnit: "PressureUnitKpa")
        var form = AppSettingsState.default
        form.unitOfPressure = "psi"
        let outcome = GeneralSettingsAdapter.syncUnitsFromCar(form: form, preferences: prefs)
        // kPa is neither psi nor bar → pressure is left as-is, and no distance /
        // temperature was reported, so nothing changed.
        XCTAssertEqual(outcome.form.unitOfPressure, "psi")
        XCTAssertFalse(outcome.didChange)
    }

    func testEmptyPreferencesReportNoChange() {
        let outcome = GeneralSettingsAdapter.syncUnitsFromCar(form: .default, preferences: CarPreferences())
        XCTAssertFalse(outcome.didChange)
    }

    func testSummaryReflectsResultingUnits() {
        var form = AppSettingsState.default
        form.unitOfLength = "mi"
        form.unitOfTemp = "F"
        form.unitOfPressure = "psi"
        let summary = GeneralSettingsAdapter.syncSummary(for: form)
        XCTAssertTrue(summary.contains("Miles"))
        XCTAssertTrue(summary.contains("Fahrenheit"))
        XCTAssertTrue(summary.contains("PSI"))
    }
}

// MARK: - Phase + freshness resolution (ADR-013)

@MainActor
final class GeneralSettingsResolutionTests: XCTestCase {
    func testPhaseResolution() {
        XCTAssertEqual(GeneralSettingsAdapter.resolvePhase(settings: .loading, hasCachedForm: false), .loading)
        XCTAssertEqual(GeneralSettingsAdapter.resolvePhase(settings: .loading, hasCachedForm: true), .content)
        XCTAssertEqual(GeneralSettingsAdapter.resolvePhase(settings: .empty, hasCachedForm: false), .empty)
        XCTAssertEqual(GeneralSettingsAdapter.resolvePhase(settings: .loaded(.default), hasCachedForm: true), .content)
        XCTAssertEqual(
            GeneralSettingsAdapter.resolvePhase(settings: .failed("boom"), hasCachedForm: false), .error("boom")
        )
        XCTAssertEqual(GeneralSettingsAdapter.resolvePhase(settings: .failed("boom"), hasCachedForm: true), .content)
    }

    func testFreshnessPrecedence() {
        XCTAssertEqual(
            GeneralSettingsAdapter.resolveFreshness(connection: .offline, isFetching: true, isError: true), .offline
        )
        XCTAssertEqual(
            GeneralSettingsAdapter.resolveFreshness(connection: .live, isFetching: false, isError: true), .error
        )
        XCTAssertEqual(
            GeneralSettingsAdapter.resolveFreshness(connection: .live, isFetching: true, isError: false), .fetching
        )
        XCTAssertEqual(
            GeneralSettingsAdapter.resolveFreshness(connection: .stale, isFetching: false, isError: false), .stale
        )
        XCTAssertEqual(
            GeneralSettingsAdapter.resolveFreshness(connection: .live, isFetching: false, isError: false), .fresh
        )
    }

    func testRelativeTimeBuckets() {
        let now = Date()
        XCTAssertEqual(GeneralSettingsAdapter.relativeTime(since: now, now: now), "just now")
        XCTAssertEqual(
            GeneralSettingsAdapter.relativeTime(since: now.addingTimeInterval(-300), now: now), "5m ago"
        )
        XCTAssertEqual(
            GeneralSettingsAdapter.relativeTime(since: now.addingTimeInterval(-7200), now: now), "2h ago"
        )
        XCTAssertEqual(
            GeneralSettingsAdapter.relativeTime(since: now.addingTimeInterval(-259_200), now: now), "3d ago"
        )
    }
}

// MARK: - Decimal preview + currency + catalogs

@MainActor
final class GeneralSettingsFormattingTests: XCTestCase {
    func testDecimalPreviewMatchesToFixed() {
        XCTAssertEqual(GeneralSettingsAdapter.decimalPreview(precision: 0, locale: "en-US"), "14")
        XCTAssertEqual(GeneralSettingsAdapter.decimalPreview(precision: 2, locale: "en-US"), "14.25")
        XCTAssertEqual(GeneralSettingsAdapter.decimalPreview(precision: 5, locale: "de-DE"), "14.24854")
    }

    func testDecimalPreviewClampsOutOfRange() {
        XCTAssertEqual(GeneralSettingsAdapter.decimalPreview(precision: -3, locale: "en-US"), "14")
    }

    func testCurrencyCodeMapping() {
        XCTAssertEqual(GeneralSettingsAdapter.currencyCode(for: "$"), "USD")
        XCTAssertEqual(GeneralSettingsAdapter.currencyCode(for: "€"), "EUR")
        XCTAssertEqual(GeneralSettingsAdapter.currencyCode(for: "₹"), "INR")
        XCTAssertEqual(GeneralSettingsAdapter.currencyCode(for: "??"), "USD")
        XCTAssertEqual(GeneralSettingsAdapter.currencyCode(for: nil), "USD")
    }

    func testOptionCatalogs() {
        XCTAssertEqual(GeneralSettingsAdapter.distanceOptions().map(\.value), ["km", "mi"])
        XCTAssertEqual(GeneralSettingsAdapter.temperatureOptions().map(\.value), ["C", "F"])
        XCTAssertEqual(GeneralSettingsAdapter.pressureOptions().map(\.value), ["bar", "psi"])
        XCTAssertEqual(GeneralSettingsAdapter.rangeOptions().map(\.value), ["rated", "ideal"])
        XCTAssertEqual(GeneralSettingsAdapter.languageOptions().count, 5)
        XCTAssertEqual(GeneralSettingsAdapter.currencyOptions().count, 10)
        XCTAssertEqual(GeneralSettingsAdapter.localeOptions().count, 7)
        XCTAssertEqual(GeneralSettingsAdapter.timezoneDisplayOptions().map(\.value), ["vehicle", "user", "utc"])
        XCTAssertEqual(GeneralSettingsAdapter.gasUnitOptions().map(\.value), ["gallon", "liter"])
    }
}

// MARK: - Localization facade (P1/S10) + identity

@MainActor
final class GeneralSettingsLocalizationTests: XCTestCase {
    func testStringResolvesFallback() {
        // With no catalog at unit-test time, NSLocalizedString returns the
        // `value` fallback — proving the key + English default are wired.
        XCTAssertEqual(GeneralSettingsStrings.string("app.title", "Application"), "Application")
        XCTAssertEqual(GeneralSettingsStrings.string("app.save", "Save Settings"), "Save Settings")
    }

    func testFormatAndCountHelpers() {
        XCTAssertEqual(
            GeneralSettingsStrings.format("k", "Unsaved %@ draft restored", "Settings"),
            "Unsaved Settings draft restored"
        )
        XCTAssertEqual(GeneralSettingsStrings.count("k", "%lldm ago", 5), "5m ago")
    }

    func testTableAndSlugAreStable() {
        XCTAssertEqual(GeneralSettingsStrings.table, "GeneralSettings")
        XCTAssertEqual(GeneralSettingsSurface.slug, "GeneralSettings")
        XCTAssertEqual(GeneralSettingsModel.surfaceSlug, "GeneralSettings")
    }
}

// MARK: - Accessibility copy

@MainActor
final class GeneralSettingsAccessibilityTests: XCTestCase {
    func testFreshnessLabels() {
        XCTAssertEqual(GeneralSettingsAccessibility.freshnessLabel(.fresh), "Live")
        XCTAssertEqual(GeneralSettingsAccessibility.freshnessLabel(.fetching), "Updating…")
        XCTAssertEqual(GeneralSettingsAccessibility.freshnessLabel(.stale), "Stale")
        XCTAssertEqual(GeneralSettingsAccessibility.freshnessLabel(.error), "Error")
        XCTAssertEqual(GeneralSettingsAccessibility.freshnessLabel(.offline), "Offline")
    }

    func testCarUnitsSummaryParsesEnums() {
        let prefs = CarPreferences(
            distanceUnit: "DistanceUnitMiles",
            temperatureUnit: "TemperatureUnitFahrenheit",
            tirePressureUnit: "PressureUnitPsi"
        )
        XCTAssertEqual(GeneralSettingsAccessibility.carUnitsSummary(prefs), "Miles / Fahrenheit / PSI")
    }

    func testCarClockLabel() {
        XCTAssertEqual(GeneralSettingsAccessibility.carClockLabel(true), "24-hour")
        XCTAssertEqual(GeneralSettingsAccessibility.carClockLabel(false), "12-hour")
    }
}
