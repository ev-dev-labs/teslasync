import SwiftUI
import XCTest
@testable import TeslaSync

/// Binding + logic tests for `SharedDrivePage`'s model layer — the 20 web `share.*` parity keys, the
/// `normalizeSharedDriveData` v1 → SI lift (and v2 passthrough), the page phases (success / expired /
/// empty-token), the derived map + chart selectors, the unit-aware display helpers, and the
/// `/s/:token` deep-link parse (with no-regression checks for non-share paths).
@MainActor
final class SharedDrivePageModelTests: XCTestCase {
    // MARK: - Parity strings (web share.* keys)

    func testParityStringConstantsMatchWebKeys() {
        XCTAssertEqual(SharedDriveStrings.header, LocalizedStringKey("share.header"))
        XCTAssertEqual(SharedDriveStrings.distance, LocalizedStringKey("share.distance"))
        XCTAssertEqual(SharedDriveStrings.duration, LocalizedStringKey("share.duration"))
        XCTAssertEqual(SharedDriveStrings.efficiency, LocalizedStringKey("share.efficiency"))
        XCTAssertEqual(SharedDriveStrings.battery, LocalizedStringKey("share.battery"))
        XCTAssertEqual(SharedDriveStrings.maxSpeed, LocalizedStringKey("share.maxSpeed"))
        XCTAssertEqual(SharedDriveStrings.avgSpeed, LocalizedStringKey("share.avgSpeed"))
        XCTAssertEqual(SharedDriveStrings.elevGain, LocalizedStringKey("share.elevGain"))
        XCTAssertEqual(SharedDriveStrings.elevation, LocalizedStringKey("share.elevation"))
        XCTAssertEqual(SharedDriveStrings.elevationAria, LocalizedStringKey("share.elevation.aria"))
        XCTAssertEqual(SharedDriveStrings.elevTooltipLabel, LocalizedStringKey("share.elevTooltipLabel"))
        XCTAssertEqual(SharedDriveStrings.speed, LocalizedStringKey("share.speed"))
        XCTAssertEqual(SharedDriveStrings.speedAria, LocalizedStringKey("share.speed.aria"))
        XCTAssertEqual(SharedDriveStrings.speedTooltipLabel, LocalizedStringKey("share.speedTooltipLabel"))
        XCTAssertEqual(SharedDriveStrings.noMapData, LocalizedStringKey("share.noMapData"))
        XCTAssertEqual(SharedDriveStrings.footer, LocalizedStringKey("share.footer"))
        XCTAssertEqual(SharedDriveStrings.learnMore, LocalizedStringKey("share.learnMore"))
        XCTAssertEqual(SharedDriveStrings.expiredTitle, LocalizedStringKey("share.expired.title"))
        XCTAssertEqual(SharedDriveStrings.expiredDescription, LocalizedStringKey("share.expired.description"))
        XCTAssertEqual(SharedDriveStrings.expiredHome, LocalizedStringKey("share.expired.home"))
    }

    func testParityStringKeysAreTwentyUniqueShareKeys() {
        XCTAssertEqual(SharedDriveStrings.rawKeys.count, 20)
        XCTAssertEqual(Set(SharedDriveStrings.rawKeys).count, 20)
        XCTAssertTrue(SharedDriveStrings.rawKeys.allSatisfy { $0.hasPrefix("share.") })
    }

    // MARK: - Normalization (web normalizeSharedDriveData)

    func testV1PayloadNormalizesToSI() {
        let payload = Self.legacyV1.normalized()
        XCTAssertEqual(payload.drive.distanceM, 18200, accuracy: 0.001)
        XCTAssertEqual(payload.drive.durationS, 1440, accuracy: 0.001)
        XCTAssertEqual(payload.drive.maxSpeedMps ?? 0, 104.76 / 3.6, accuracy: 0.001)
        XCTAssertEqual(payload.drive.avgSpeedMps ?? 0, 45.36 / 3.6, accuracy: 0.001)
        XCTAssertEqual(payload.drive.efficiencyWhPerM ?? 0, 0.178, accuracy: 0.000001)
        XCTAssertEqual(payload.drive.elevationGainM ?? 0, 142, accuracy: 0.001) // v1 already meters
        XCTAssertEqual(payload.elevationProfile.last?.distanceM ?? 0, 18200, accuracy: 0.001)
        XCTAssertEqual(payload.speedProfile[1].speedMps, 94 / 3.6, accuracy: 0.001)
    }

    func testV1DurationRoundsToWholeSecond() {
        let payload = SharedDriveV1Payload(
            title: "t", description: nil, date: "d",
            distanceKm: 1, durationMin: 1.005, startAddress: nil, endAddress: nil,
            startBattery: nil, endBattery: nil, elevationGainM: nil, elevationLossM: nil,
            maxSpeedKmh: nil, avgSpeedKmh: nil, efficiencyWhKm: nil, vehicle: nil,
            mapPoints: [], elevationProfile: [], speedProfile: [], telemetry: []
        ).normalized()
        XCTAssertEqual(payload.drive.durationS, 60) // round(1.005 * 60) = round(60.3) = 60
    }

    func testV2WireIsPassthrough() {
        let original = SampleSharedDriveDataSource.payload
        XCTAssertEqual(SharedDriveWire.v2(original).normalized(), original)
    }

    // MARK: - Phases (web isLoading / error || !data / success)

    func testSuccessPhaseAfterLoad() async {
        let model = SharedDrivePageModel(token: "demo")
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertNotNil(model.payload)
        XCTAssertTrue(model.hasRoute)
        XCTAssertFalse(model.hasNoRouteData)
    }

    func testExpiredPhaseOnFetchFailure() async {
        let model = SharedDrivePageModel(token: "demo", dataSource: FailingSharedDriveDataSource())
        await model.load()
        XCTAssertEqual(model.phase, .expired)
        XCTAssertNil(model.payload)
    }

    func testEmptyTokenResolvesToExpiredWithoutFetch() async {
        let model = SharedDrivePageModel(token: "", dataSource: FailingSharedDriveDataSource())
        await model.load()
        XCTAssertEqual(model.phase, .expired)
        XCTAssertNil(model.payload)
    }

    func testNoRouteDataEmptyBranch() async {
        let model = SharedDrivePageModel(token: "demo", dataSource: NoRouteSharedDriveDataSource())
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertFalse(model.hasRoute)
        XCTAssertTrue(model.hasNoRouteData)
    }

    func testLegacyV1SourceNormalizesThroughModel() async {
        let model = SharedDrivePageModel(token: "demo", dataSource: LegacySharedDriveDataSource())
        await model.load()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.payload?.drive.distanceM ?? 0, 18200, accuracy: 0.001)
    }

    // MARK: - Display helpers (web boundary converters)

    func testDurationMinutesFormatting() {
        XCTAssertEqual(SharedDriveFormat.durationMinutes(24 * 60), "24m")
        XCTAssertEqual(SharedDriveFormat.durationMinutes(3690), "1h 2m") // 1h 1.5m -> rounds to 2
        XCTAssertEqual(SharedDriveFormat.durationMinutes(3600), "1h")
        XCTAssertEqual(SharedDriveFormat.durationMinutes(nil), "—")
        XCTAssertEqual(SharedDriveFormat.durationMinutes(-5), "—")
    }

    func testEfficiencyValueConvertsForImperial() {
        // 0.178 Wh/m -> 178 Wh/km (metric); * 1.609344 -> 286 Wh/mi (imperial).
        XCTAssertEqual(SharedDriveFormat.efficiencyValue(0.178, .metric), "178 Wh/km")
        XCTAssertEqual(SharedDriveFormat.efficiencyValue(0.178, .imperial), "286 Wh/mi")
    }

    func testElevationGainValueConvertsForImperial() {
        XCTAssertEqual(SharedDriveFormat.elevationGainValue(142, .metric), "142 m")
        // 142 m / 0.3048 = 465.9 ft -> 466 ft
        XCTAssertEqual(SharedDriveFormat.elevationGainValue(142, .imperial), "466 ft")
    }

    func testBatteryValue() {
        XCTAssertEqual(SharedDriveFormat.batteryValue(start: 78, end: 64), "78% → 64%")
    }

    // MARK: - Deep-link parse (web /s/:token)

    func testDeepLinkParsesShareToken() {
        XCTAssertEqual(SharedDriveDeepLink.link(forPath: "/s/abc123")?.token, "abc123")
        XCTAssertEqual(SharedDriveDeepLink.link(forPath: "s/abc123")?.token, "abc123")
        XCTAssertEqual(SharedDriveDeepLink.link(forPath: "/s/abc123/")?.token, "abc123")
    }

    func testDeepLinkRejectsNonShareOrEmpty() {
        XCTAssertNil(SharedDriveDeepLink.link(forPath: "/s/"))
        XCTAssertNil(SharedDriveDeepLink.link(forPath: "/s"))
        XCTAssertNil(SharedDriveDeepLink.link(forPath: "/drives/7"))
        XCTAssertNil(SharedDriveDeepLink.link(forPath: "/s/abc/extra"))
    }

    func testDeepLinkParsesURLForms() throws {
        XCTAssertEqual(try SharedDriveDeepLink.link(for: XCTUnwrap(URL(string: "teslasync://s/xyz")))?.token, "xyz")
        XCTAssertEqual(
            try SharedDriveDeepLink.link(for: XCTUnwrap(URL(string: "https://app.example.com/s/xyz")))?.token,
            "xyz"
        )
        XCTAssertNil(try SharedDriveDeepLink.link(for: XCTUnwrap(URL(string: "teslasync://dashboard"))))
    }

    func testRouteRegistrationForwardsDeepLinkParse() throws {
        XCTAssertEqual(SharedDriveRouteRegistration.link(forPath: "/s/tok")?.token, "tok")
        XCTAssertEqual(
            try SharedDriveRouteRegistration.link(for: XCTUnwrap(URL(string: "teslasync://s/tok")))?.token,
            "tok"
        )
    }

    // MARK: - Fixtures

    private static let legacyV1 = SharedDriveV1Payload(
        title: "Legacy Trip",
        description: "Imported share (v1 payload)",
        date: "Jun 16, 2026",
        distanceKm: 18.2,
        durationMin: 24,
        startAddress: "Mountain View, CA",
        endAddress: "Palo Alto, CA",
        startBattery: 78,
        endBattery: 64,
        elevationGainM: 142,
        elevationLossM: 88,
        maxSpeedKmh: 104.76,
        avgSpeedKmh: 45.36,
        efficiencyWhKm: 178,
        vehicle: SharedVehicle(model: "Model Y", color: "Pearl White"),
        mapPoints: [
            SharedMapPoint(lat: 37.4220, lng: -122.0841),
            SharedMapPoint(lat: 37.4602, lng: -122.1338)
        ],
        elevationProfile: [
            SharedElevationPointV1(distanceKm: 0, elevationM: 24),
            SharedElevationPointV1(distanceKm: 18.2, elevationM: 30)
        ],
        speedProfile: [
            SharedSpeedPointV1(distanceKm: 0, speedKmh: 0),
            SharedSpeedPointV1(distanceKm: 9.1, speedKmh: 94)
        ],
        telemetry: []
    )
}
