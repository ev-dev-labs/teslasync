import XCTest
@testable import TeslaSync

// MARK: - Test doubles (file scope so neither test class body grows)

/// Controlled provider that records lifecycle calls and lets a test drive the
/// emitted state — the test double for the production live provider.
@MainActor
private final class RecordingProvider: DrivetrainHealthProvider {
    private(set) var startCount = 0
    private(set) var stopCount = 0
    private(set) var refreshCount = 0
    private var sink: ((DrivetrainHealthViewState) -> Void)?

    func start(onState: @escaping (DrivetrainHealthViewState) -> Void) {
        startCount += 1
        sink = onState
    }

    func stop() {
        stopCount += 1
    }

    func refresh() {
        refreshCount += 1
    }

    func send(_ state: DrivetrainHealthViewState) {
        sink?(state)
    }
}

/// Spy proving the `view.opened` diagnostics contract is invokable with the
/// surface slug (the view fires this in `.onAppear`).
@MainActor
private final class DrivetrainHealthWidgetTestsTelemetrySpy: DashboardWidgetTelemetry {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

private let healthJSON = """
{
  "frontMotorTempC": 64.4,
  "rearMotorTempC": 58.0,
  "inverterTempC": 49.2,
  "batteryTempC": 31.0,
  "motorStatus": "drive",
  "overallHealth": "good"
}
"""

private let motorJSON = """
{
  "motor_temp_c_front": 66.0,
  "di_stator_temp": 71.5,
  "inverter_temp_c": 50.0,
  "state_front": "D"
}
"""

// MARK: - Adapter / pure-logic tests

@MainActor final class DrivetrainHealthAdapterTests: XCTestCase {
    func testDecodesHealthCamelCaseJSON() {
        let reading = DrivetrainHealthDecoder.reading(from: Data(healthJSON.utf8))
        XCTAssertEqual(reading?.frontMotorTempC, 64.4)
        XCTAssertEqual(reading?.rearMotorTempC, 58.0)
        XCTAssertEqual(reading?.inverterTempC, 49.2)
        XCTAssertEqual(reading?.motorStatus, "drive")
        XCTAssertEqual(reading?.overallHealth, "good")
    }

    func testDecodesMotorSnakeCaseJSON() {
        let motor = DrivetrainHealthDecoder.motor(from: Data(motorJSON.utf8))
        XCTAssertEqual(motor?.motorTempCFront, 66.0)
        XCTAssertEqual(motor?.diStatorTemp, 71.5)
        XCTAssertEqual(motor?.inverterTempC, 50.0)
        XCTAssertEqual(motor?.stateFront, "D")
    }

    func testDecodeReturnsNilForEmptyOrInvalid() {
        XCTAssertNil(DrivetrainHealthDecoder.reading(from: nil))
        XCTAssertNil(DrivetrainHealthDecoder.reading(from: Data()))
        XCTAssertNil(DrivetrainHealthDecoder.motor(from: Data("not json".utf8)))
    }

    func testFallbackPrecedenceUsesHealthThenMotor() {
        let projection = DrivetrainHealthDecoder.projection(
            healthJSON: Data(healthJSON.utf8),
            motorJSON: Data(motorJSON.utf8)
        )
        // motorTemp: health.frontMotorTempC ?? motor.motor_temp_c_front
        XCTAssertEqual(projection.motorTempC, 64.4)
        // statorTemp: motor.di_stator_temp ?? health.rearMotorTempC
        XCTAssertEqual(projection.statorTempC, 71.5)
        // inverter: health.inverterTempC ?? motor.inverter_temp_c
        XCTAssertEqual(projection.inverterTempC, 49.2)
        // driveState: motor.state_front ?? health.motorStatus ?? '—'
        XCTAssertEqual(projection.driveState, "D")
    }

    func testFallbackPrecedenceFallsBackToMotorThenHealth() {
        let health = DrivetrainHealthReading(rearMotorTempC: 40, motorStatus: "park", overallHealth: "warning")
        let motor = DrivetrainMotorReading(motorTempCFront: 55, inverterTempC: 48)
        let projection = DrivetrainHealthProjection(health: health, motor: motor)
        XCTAssertEqual(projection.motorTempC, 55) // health.front nil → motor.front
        XCTAssertEqual(projection.statorTempC, 40) // motor.stator nil → health.rear
        XCTAssertEqual(projection.inverterTempC, 48) // health.inverter nil → motor.inverter
        XCTAssertEqual(projection.driveState, "park") // motor.state nil → health.status
    }

    func testDriveStateEmDashWhenAbsent() {
        let projection = DrivetrainHealthProjection(
            health: DrivetrainHealthReading(overallHealth: "good"),
            motor: nil
        )
        XCTAssertEqual(projection.driveState, "—")
    }

    func testHealthScoreMapping() {
        XCTAssertEqual(DrivetrainHealthStatus(overallHealth: "good").score, 95)
        XCTAssertEqual(DrivetrainHealthStatus(overallHealth: "warning").score, 60)
        XCTAssertEqual(DrivetrainHealthStatus(overallHealth: "critical").score, 25)
        XCTAssertEqual(DrivetrainHealthStatus(overallHealth: nil).score, 0)
        XCTAssertEqual(DrivetrainHealthStatus(overallHealth: "weird").score, 0)
    }

    func testHealthColorThresholds() {
        XCTAssertEqual(DrivetrainHealthStatus.tone(forScore: 95), .success)
        XCTAssertEqual(DrivetrainHealthStatus.tone(forScore: 80), .success)
        XCTAssertEqual(DrivetrainHealthStatus.tone(forScore: 79), .warning)
        XCTAssertEqual(DrivetrainHealthStatus.tone(forScore: 60), .warning)
        XCTAssertEqual(DrivetrainHealthStatus.tone(forScore: 50), .warning)
        XCTAssertEqual(DrivetrainHealthStatus.tone(forScore: 49), .danger)
        XCTAssertEqual(DrivetrainHealthStatus.tone(forScore: 25), .danger)
        XCTAssertEqual(DrivetrainHealthStatus.tone(forScore: 0), .danger)
    }

    func testTemperatureFormatCelsius() {
        XCTAssertEqual(DrivetrainHealthFormat.temperature(64.4, unit: .celsius), "64")
        XCTAssertEqual(DrivetrainHealthFormat.temperature(64.6, unit: .celsius), "65")
        XCTAssertEqual(DrivetrainHealthFormat.temperature(nil, unit: .celsius), "—")
    }

    func testTemperatureFormatFahrenheit() {
        XCTAssertEqual(DrivetrainHealthFormat.temperature(0, unit: .fahrenheit), "32")
        XCTAssertEqual(DrivetrainHealthFormat.temperature(100, unit: .fahrenheit), "212")
        XCTAssertEqual(DrivetrainHealthFormat.temperature(20, unit: .fahrenheit), "68")
        XCTAssertEqual(DrivetrainHealthFormat.temperature(nil, unit: .fahrenheit), "—")
    }

    func testTemperatureUnitSymbol() {
        XCTAssertEqual(DrivetrainTemperatureUnit.celsius.symbol, "°C")
        XCTAssertEqual(DrivetrainTemperatureUnit.fahrenheit.symbol, "°F")
    }

    func testHasData() {
        XCTAssertTrue(DrivetrainHealthProjection(health: DrivetrainHealthReading(), motor: nil).hasData)
        XCTAssertTrue(DrivetrainHealthProjection(health: nil, motor: DrivetrainMotorReading()).hasData)
        XCTAssertTrue(
            DrivetrainHealthProjection(health: DrivetrainHealthReading(), motor: DrivetrainMotorReading()).hasData
        )
        XCTAssertFalse(DrivetrainHealthProjection(health: nil, motor: nil).hasData)
    }

    func testStatBuilderOrderAndUnits() {
        let projection = DrivetrainHealthDecoder.projection(
            healthJSON: Data(healthJSON.utf8),
            motorJSON: Data(motorJSON.utf8)
        )
        let stats = drivetrainStats(projection, unit: .celsius)
        XCTAssertEqual(stats.map(\.id), ["motorTemp", "statorTemp", "inverter", "driveState"])
        XCTAssertEqual(stats.map(\.labelKey), [
            DrivetrainHealthStrings.motorTemp,
            DrivetrainHealthStrings.statorTemp,
            DrivetrainHealthStrings.inverterHealth,
            DrivetrainHealthStrings.driveState
        ])
        XCTAssertEqual(stats[0].value, "64")
        XCTAssertEqual(stats[0].unit, "°C")
        XCTAssertEqual(stats[1].value, "72") // 71.5 → 72
        XCTAssertEqual(stats[2].value, "49")
        XCTAssertEqual(stats[3].value, "D")
        XCTAssertNil(stats[3].unit) // drive state carries no unit
    }
}

// MARK: - Model / view-state / contract tests

@MainActor final class DrivetrainHealthWidgetViewTests: XCTestCase {
    func testModelStartsAndRepublishesProviderState() {
        let provider = RecordingProvider()
        let model = DrivetrainHealthWidgetModel(provider: provider)
        if case .loading = model.state {} else { XCTFail("expected initial loading state") }

        model.start()
        XCTAssertEqual(provider.startCount, 1)

        let projection = DrivetrainHealthProjection(
            health: DrivetrainHealthReading(overallHealth: "good"),
            motor: nil
        )
        provider.send(.loaded(projection, freshness: .fresh))
        XCTAssertEqual(model.state, .loaded(projection, freshness: .fresh))

        provider.send(.empty(freshness: .offline))
        XCTAssertEqual(model.state, .empty(freshness: .offline))

        provider.send(.failed(message: nil, cached: nil))
        XCTAssertEqual(model.state, .failed(message: nil, cached: nil))
    }

    func testModelStopAndRefreshForwardToProvider() {
        let provider = RecordingProvider()
        let model = DrivetrainHealthWidgetModel(provider: provider)
        model.refresh()
        model.stop()
        XCTAssertEqual(provider.refreshCount, 1)
        XCTAssertEqual(provider.stopCount, 1)
    }

    func testEveryViewStateIsRenderable() {
        let projection = DrivetrainHealthProjection(
            health: DrivetrainHealthReading(overallHealth: "warning"),
            motor: DrivetrainMotorReading(motorTempCFront: 50)
        )
        let states: [DrivetrainHealthViewState] = [
            .loading(cached: nil),
            .loading(cached: projection),
            .loaded(projection, freshness: .fresh),
            .loaded(projection, freshness: .stale),
            .empty(freshness: .fresh),
            .empty(freshness: .offline),
            .failed(message: nil, cached: nil),
            .failed(message: nil, cached: projection)
        ]
        for size in [DashboardWidgetSize(cols: 2, rows: 4), DashboardWidgetSize(cols: 1, rows: 2)] {
            for state in states {
                let model = DrivetrainHealthWidgetModel(provider: RecordingProvider(), initialState: state)
                let widget = DrivetrainHealthWidget(model: model, size: size, unit: .celsius)
                XCTAssertNotNil(widget.body)
            }
        }
    }

    func testFreshnessInfoMapping() {
        XCTAssertEqual(DrivetrainHealthFreshness.info(for: .fresh).labelKey, "widget.freshness.live")
        XCTAssertEqual(DrivetrainHealthFreshness.info(for: .fresh).tone, .success)
        XCTAssertEqual(DrivetrainHealthFreshness.info(for: .stale).labelKey, "widget.freshness.stale")
        XCTAssertEqual(DrivetrainHealthFreshness.info(for: .stale).tone, .warning)
        XCTAssertEqual(DrivetrainHealthFreshness.info(for: .offline).labelKey, "widget.freshness.offline")
        XCTAssertEqual(DrivetrainHealthFreshness.info(for: .offline).tone, .neutral)
    }

    func testCurrentFreshnessOnlyWhenStateCarriesIt() {
        let projection = DrivetrainHealthProjection(health: DrivetrainHealthReading(), motor: nil)
        func freshness(_ state: DrivetrainHealthViewState) -> WidgetFreshness? {
            let model = DrivetrainHealthWidgetModel(provider: RecordingProvider(), initialState: state)
            return DrivetrainHealthWidget(
                model: model,
                size: DashboardWidgetSize(cols: 2, rows: 4),
                unit: .celsius
            ).currentFreshness
        }
        XCTAssertEqual(freshness(.loaded(projection, freshness: .stale)), .stale)
        XCTAssertEqual(freshness(.empty(freshness: .offline)), .offline)
        XCTAssertNil(freshness(.loading(cached: nil)))
        XCTAssertNil(freshness(.failed(message: nil, cached: nil)))
    }

    func testRegistryDescriptorMatchesWeb() {
        let descriptor = DrivetrainHealthWidget.descriptor
        XCTAssertEqual(descriptor.id, "drivetrain-health")
        XCTAssertEqual(descriptor.category, "vehicle")
        XCTAssertEqual(descriptor.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(descriptor.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(descriptor.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(descriptor.displayNameKey, "widget.drivetrainHealth.displayName")
        XCTAssertEqual(descriptor.descriptionKey, "widget.drivetrainHealth.description")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(DrivetrainHealthWidget.surfaceSlug, "DrivetrainHealthWidget")
    }

    func testI18nKeysAreNamespaced() {
        let keys = [
            DrivetrainHealthStrings.title,
            DrivetrainHealthStrings.displayName,
            DrivetrainHealthStrings.description,
            DrivetrainHealthStrings.score,
            DrivetrainHealthStrings.motorTemp,
            DrivetrainHealthStrings.statorTemp,
            DrivetrainHealthStrings.inverterHealth,
            DrivetrainHealthStrings.driveState,
            DrivetrainHealthStrings.noData,
            DrivetrainHealthStrings.refreshAccessibility
        ]
        for key in keys {
            XCTAssertTrue(key.hasPrefix("widget.drivetrainHealth."), "unexpected key \(key)")
        }
    }

    func testTelemetryContract() {
        let spy = DrivetrainHealthWidgetTestsTelemetrySpy()
        spy.viewOpened(surface: DrivetrainHealthWidget.surfaceSlug)
        XCTAssertEqual(spy.surfaces, ["DrivetrainHealthWidget"])
    }
}
