//
//  WeatherAtCarWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0115 · WeatherAtCarWidget (Apple)
//
//  Unit coverage for the WeatherAtCarWidget surface:
//    • Adapter (cached → projection) — `WeatherAtCarProjector` value parity with the web
//      widget's pipeline (convertTempFromSI(c, unit) then fmtInt, the `WeatherIcon` thresholds,
//      and the `toFixed(2)` coordinate line).
//    • State holder — `WeatherAtCarModel` phase resolution across loading / empty / error /
//      content, plus the P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Registry — canonical `weather-at-car` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store:
//  the model is driven by `InMemoryWeatherAtCarSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with the web widget)

final class WeatherAtCarAdapterTests: XCTestCase {
    private let sample = WeatherStateDTO(outsideTempCelsius: 21.6, latitude: 37.4221, longitude: -122.0841)

    /// Pins the exact display the web widget produces for the °C preference:
    /// convertTempFromSI(21.6, '°C') = 21.6, then fmtInt → "22", suffixed with "°C".
    func testProjectionCelsius() throws {
        let projection = try XCTUnwrap(
            WeatherAtCarProjector.project(state: sample, units: WeatherUnitPrefs(temperature: .celsius))
        )
        XCTAssertEqual(projection.temperatureValue, "22")
        XCTAssertEqual(projection.temperatureUnit, "°C")
        XCTAssertEqual(projection.temperatureText, "22°C")
        XCTAssertEqual(projection.condition, .mild)
        XCTAssertEqual(projection.conditionSymbol, "cloud.sun.fill")
        XCTAssertEqual(projection.coordinateText, "37.42°, -122.08°")
        XCTAssertEqual(projection.outsideTempCelsius, 21.6, accuracy: 1e-9)
    }

    /// Pins the °F branch: convertTempFromSI(21.6, '°F') = 70.88, then fmtInt → "71".
    func testProjectionFahrenheit() throws {
        let projection = try XCTUnwrap(
            WeatherAtCarProjector.project(state: sample, units: WeatherUnitPrefs(temperature: .fahrenheit))
        )
        XCTAssertEqual(projection.temperatureValue, "71")
        XCTAssertEqual(projection.temperatureUnit, "°F")
        XCTAssertEqual(projection.temperatureText, "71°F")
    }

    /// The web `hasData = outsideTemp != null` gate: a state with no reading projects to nil so
    /// the model can switch to the empty state.
    func testNilTemperatureProjectsToNil() {
        XCTAssertNil(
            WeatherAtCarProjector.project(
                state: WeatherStateDTO(outsideTempCelsius: nil, latitude: 1, longitude: 2),
                units: WeatherUnitPrefs(temperature: .celsius)
            )
        )
    }

    /// A reading without coordinates omits the location line (web `lat != null && long != null`).
    func testProjectionWithoutCoordinates() throws {
        let projection = try XCTUnwrap(
            WeatherAtCarProjector.project(
                state: WeatherStateDTO(outsideTempCelsius: 10),
                units: WeatherUnitPrefs(temperature: .celsius)
            )
        )
        XCTAssertEqual(projection.temperatureText, "10°C")
        XCTAssertNil(projection.coordinateText)
    }

    /// `WeatherIcon` thresholds run on the RAW Celsius value: ≤0 → snow, ≥25 → sun, else cloud.
    func testConditionThresholdsMatchWebIcon() {
        XCTAssertEqual(WeatherCondition.forCelsius(-3), .freezing)
        XCTAssertEqual(WeatherCondition.forCelsius(0), .freezing)
        XCTAssertEqual(WeatherCondition.forCelsius(0.1), .mild)
        XCTAssertEqual(WeatherCondition.forCelsius(24.9), .mild)
        XCTAssertEqual(WeatherCondition.forCelsius(25), .warm)
        XCTAssertEqual(WeatherCondition.forCelsius(31.2), .warm)
        XCTAssertEqual(WeatherCondition.freezing.symbolName, "cloud.snow.fill")
        XCTAssertEqual(WeatherCondition.warm.symbolName, "sun.max.fill")
        XCTAssertEqual(WeatherCondition.mild.symbolName, "cloud.sun.fill")
    }

    /// The icon band is chosen from the raw Celsius even when the display unit is Fahrenheit —
    /// a 31.2°C reading shows "88°F" but still the sun glyph.
    func testConditionUsesRawCelsiusNotDisplayUnit() throws {
        let projection = try XCTUnwrap(
            WeatherAtCarProjector.project(
                state: WeatherStateDTO(outsideTempCelsius: 31.2),
                units: WeatherUnitPrefs(temperature: .fahrenheit)
            )
        )
        XCTAssertEqual(projection.temperatureText, "88°F")
        XCTAssertEqual(projection.condition, .warm)
    }

    func testCoordinateFormattingMatchesToFixed() {
        XCTAssertEqual(weatherCoordinatePair(latitude: 37.4221, longitude: -122.0841), "37.42°, -122.08°")
        XCTAssertEqual(weatherCoordinatePair(latitude: 0, longitude: 0), "0.00°, 0.00°")
        XCTAssertNil(weatherCoordinatePair(latitude: nil, longitude: -122))
        XCTAssertNil(weatherCoordinatePair(latitude: 37, longitude: nil))
        XCTAssertNil(weatherCoordinatePair(latitude: .nan, longitude: 1))
    }

    func testTemperatureConversionFactors() {
        XCTAssertEqual(convertWeatherTempFromSI(25, to: .celsius), 25, accuracy: 1e-9)
        XCTAssertEqual(convertWeatherTempFromSI(0, to: .fahrenheit), 32, accuracy: 1e-9)
        XCTAssertEqual(convertWeatherTempFromSI(100, to: .fahrenheit), 212, accuracy: 1e-9)
        XCTAssertEqual(convertWeatherTempFromSI(-40, to: .fahrenheit), -40, accuracy: 1e-9)
        XCTAssertEqual(convertWeatherTempFromSI(.nan, to: .celsius), 0)
    }

    func testNumberFormattingRoundsHalfAwayFromZero() {
        XCTAssertEqual(WeatherAtCarFormat.int(1234.5), "1,235")
        XCTAssertEqual(WeatherAtCarFormat.int(21.6), "22")
        XCTAssertEqual(WeatherAtCarFormat.int(-3.5), "-4")
        XCTAssertEqual(WeatherAtCarFormat.int(.infinity), "0")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

final class WeatherAtCarPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(WeatherAtCarModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(WeatherAtCarModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(WeatherAtCarModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(WeatherAtCarModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(WeatherAtCarModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(WeatherAtCarModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(WeatherAtCarModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(WeatherAtCarModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }
}

@MainActor
final class WeatherAtCarModelTests: XCTestCase {
    private func makeModel(
        _ update: WeatherAtCarUpdate,
        telemetry: WeatherAtCarTelemetry = OSLogWeatherAtCarTelemetry()
    ) -> (WeatherAtCarModel, InMemoryWeatherAtCarSource) {
        let source = InMemoryWeatherAtCarSource(initial: update)
        let model = WeatherAtCarModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(WeatherAtCarUpdate(status: .loading, state: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutReadingShowsEmpty() {
        let (model, _) = makeModel(
            WeatherAtCarUpdate(status: .loaded, state: WeatherStateDTO(outsideTempCelsius: nil))
        )
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.projection)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(WeatherAtCarUpdate(status: .failed("boom"), state: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testReadingPresentShowsContentEvenWhileFailed() {
        let state = WeatherStateDTO(outsideTempCelsius: 21.6, latitude: 37.4221, longitude: -122.0841)
        let (model, _) = makeModel(WeatherAtCarUpdate(status: .failed("net"), state: state))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.temperatureText, "22°C")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyWeatherAtCarTelemetry()
        let (model, source) = makeModel(WeatherAtCarUpdate(status: .loading, state: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [WeatherAtCarWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(WeatherAtCarUpdate(status: .loaded, state: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let state = WeatherStateDTO(outsideTempCelsius: 18)
        let (model, source) = makeModel(WeatherAtCarUpdate(status: .loaded, state: state))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(WeatherAtCarUpdate(status: .loaded, connection: .stale, isFetching: true, state: state))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(WeatherAtCarUpdate(status: .loaded, connection: .stale, isFetching: false, state: state))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndUnitsTrackUpdates() {
        let (model, source) = makeModel(WeatherAtCarUpdate(status: .loading, state: nil))
        model.start()
        source.push(
            WeatherAtCarUpdate(
                status: .loaded,
                connection: .offline,
                state: WeatherStateDTO(outsideTempCelsius: 21.6),
                units: WeatherUnitPrefs(temperature: .fahrenheit),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.units.temperature, .fahrenheit)
        XCTAssertEqual(model.projection?.temperatureUnit, "°F")
    }
}

// MARK: - Registry parity

final class WeatherAtCarRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = WeatherAtCarWidget.registration
        XCTAssertEqual(registration.id, "weather-at-car")
        XCTAssertEqual(registration.category, "climate")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 3, rows: 40))
        XCTAssertEqual(WeatherAtCarWidget.surfaceSlug, "WeatherAtCarWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = WeatherAtCarWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 3, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 10)),
            DashboardWidgetSize(cols: 2, rows: 10)
        )
    }
}

// MARK: - Accessibility summary content

final class WeatherAtCarAccessibilityTests: XCTestCase {
    func testSummaryIncludesTemperatureAndCoordinates() throws {
        let projection = try XCTUnwrap(
            WeatherAtCarProjector.project(
                state: WeatherStateDTO(outsideTempCelsius: 21.6, latitude: 37.4221, longitude: -122.0841),
                units: WeatherUnitPrefs(temperature: .celsius)
            )
        )
        let summary = WeatherAtCarAccessibility.summary(for: projection)
        XCTAssertEqual(summary, "Weather at Car. Outside Temperature 22°C. 37.42°, -122.08°")
    }

    func testSummaryOmitsCoordinatesWhenAbsent() throws {
        let projection = try XCTUnwrap(
            WeatherAtCarProjector.project(
                state: WeatherStateDTO(outsideTempCelsius: 10),
                units: WeatherUnitPrefs(temperature: .celsius)
            )
        )
        let summary = WeatherAtCarAccessibility.summary(for: projection)
        XCTAssertEqual(summary, "Weather at Car. Outside Temperature 10°C")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyWeatherAtCarTelemetry: WeatherAtCarTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
