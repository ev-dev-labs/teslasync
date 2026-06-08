import XCTest
@testable import TeslaSync

/// Pure tests for the settings value type, measurement system, and stores.
@MainActor final class AppSettingsDataTests: XCTestCase {
    func testDefaultsArePrivacyFirst() {
        let settings = AppSettings.default
        XCTAssertFalse(settings.analyticsOptIn, "analytics must be opt-in (off by default)")
        XCTAssertTrue(settings.recordRecentActivity)
        XCTAssertTrue(settings.handoffEnabled)
        XCTAssertEqual(settings.appearance, .system)
        XCTAssertEqual(settings.measurementSystem, .metric)
    }

    func testCodableRoundTrip() throws {
        var settings = AppSettings.default
        settings.appearance = .dark
        settings.measurementSystem = .imperial
        settings.analyticsOptIn = true
        let data = try JSONEncoder().encode(settings)
        let decoded = try JSONDecoder().decode(AppSettings.self, from: data)
        XCTAssertEqual(decoded, settings)
    }

    func testLenientDecodeFillsMissingKeys() throws {
        // Simulates older persisted JSON that predates several settings.
        let json = Data(#"{"appearance":"dark"}"#.utf8)
        let decoded = try JSONDecoder().decode(AppSettings.self, from: json)
        XCTAssertEqual(decoded.appearance, .dark)
        XCTAssertEqual(decoded.measurementSystem, .metric)
        XCTAssertFalse(decoded.analyticsOptIn)
    }

    func testLenientInitFallsBackOnGarbage() {
        let settings = AppSettings(decodingLenient: Data("not json".utf8))
        XCTAssertEqual(settings, .default)
    }

    func testMeasurementSystemLabels() {
        XCTAssertEqual(MeasurementSystem.metric.distanceLabel, "km")
        XCTAssertEqual(MeasurementSystem.metric.speedLabel, "km/h")
        XCTAssertEqual(MeasurementSystem.imperial.distanceLabel, "mi")
        XCTAssertEqual(MeasurementSystem.imperial.energyLabel, "kWh")
    }

    func testInMemoryStoreRoundTrip() {
        let store = InMemoryAppSettingsStore()
        var settings = AppSettings.default
        settings.diagnosticsVerboseLogging = true
        store.save(settings)
        XCTAssertTrue(store.load().diagnosticsVerboseLogging)
    }

    func testUserDefaultsStoreRoundTrip() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "test.settings.\(UUID().uuidString)"))
        let store = UserDefaultsAppSettingsStore(defaults: defaults, key: "k")
        XCTAssertEqual(store.load(), .default)
        var settings = AppSettings.default
        settings.offlineCacheEnabled = false
        store.save(settings)
        XCTAssertFalse(store.load().offlineCacheEnabled)
    }
}

/// Fake biometric seam for the model tests.
@MainActor
private final class FakeBiometric: BiometricSettingControlling {
    private let available: Bool
    private(set) var enabled: Bool

    init(available: Bool, enabled: Bool = false) {
        self.available = available
        self.enabled = enabled
    }

    var isBiometricAvailable: Bool {
        available
    }

    var isBiometricEnabled: Bool {
        enabled
    }

    func setBiometricEnabled(_ value: Bool) {
        enabled = value && available
    }
}

/// Tests the observable settings model: persistence, change hook, biometric
/// reconciliation, and cache clearing.
@MainActor final class AppSettingsModelTests: XCTestCase {
    func testSettersPersistThroughStore() {
        let store = InMemoryAppSettingsStore()
        let model = AppSettingsModel(storage: store)
        model.setAppearance(.light)
        model.setMeasurementSystem(.imperial)
        model.setAnalyticsOptIn(true)
        XCTAssertEqual(model.settings.appearance, .light)
        XCTAssertEqual(store.load().measurementSystem, .imperial)
        XCTAssertTrue(store.load().analyticsOptIn)
    }

    func testChangeHookFires() {
        var observed: AppSettings?
        let model = AppSettingsModel(storage: InMemoryAppSettingsStore(), onChange: { observed = $0 })
        model.setHandoff(false)
        XCTAssertEqual(observed?.handoffEnabled, false)
    }

    func testBiometricToggleHonorsAvailability() {
        let available = AppSettingsModel(storage: InMemoryAppSettingsStore(), biometric: FakeBiometric(available: true))
        available.setBiometricUnlock(true)
        XCTAssertTrue(available.settings.biometricUnlockEnabled)

        let unavailable = AppSettingsModel(
            storage: InMemoryAppSettingsStore(),
            biometric: FakeBiometric(available: false)
        )
        unavailable.setBiometricUnlock(true)
        XCTAssertFalse(unavailable.settings.biometricUnlockEnabled, "cannot enable when unavailable")
        XCTAssertFalse(unavailable.isBiometricAvailable)
    }

    func testInitReconcilesBiometricFromCoordinator() {
        let store = InMemoryAppSettingsStore()
        let model = AppSettingsModel(storage: store, biometric: FakeBiometric(available: true, enabled: true))
        XCTAssertTrue(model.settings.biometricUnlockEnabled)
    }

    func testClearCacheInvokesHook() {
        var cleared = false
        let model = AppSettingsModel(storage: InMemoryAppSettingsStore(), onClearCache: { cleared = true })
        model.clearCache()
        XCTAssertTrue(cleared)
    }
}
