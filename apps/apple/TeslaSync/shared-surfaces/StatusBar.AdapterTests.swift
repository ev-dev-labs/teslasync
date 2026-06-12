//
//  StatusBar.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0182 · StatusBar (Apple)
//
//  Pure-core coverage for the status bar (the projection lives in StatusBar.ProjectionTests.swift; the model
//  + view-composition + a11y in StatusBar.Tests.swift; split to keep each file within the SwiftLint budget).
//  This is the "adapter (cached → projection)" unit test the acceptance calls for at the value-type level:
//  the surface slug, the i18next interpolation, the verbatim formatter ports (ageSecondsLabel /
//  convertDistanceFromSI+round / uptimeLabel), the tone maps, the vehicle name fallback chain, the version
//  provenance helpers, and the prefs Codable round-trip + boolean-validating defaults.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no SwiftUI, no model instance.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity + interpolation

final class StatusBarSurfaceTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(StatusBarSurface.slug, "StatusBar")
    }

    func testInterpolationSubstitutesSlots() {
        XCTAssertEqual(
            StatusBarInterpolation.format("Last message {{age}} ago", ["age": "5s"]),
            "Last message 5s ago"
        )
        XCTAssertEqual(StatusBarInterpolation.format("{{count}} tasks", ["count": "3"]), "3 tasks")
    }

    func testInterpolationLeavesUnreferencedSlots() {
        XCTAssertEqual(StatusBarInterpolation.format("{{a}} {{b}}", ["a": "x"]), "x {{b}}")
    }
}

// MARK: - StatusBarFormat (verbatim formatter ports)

final class StatusBarFormatTests: XCTestCase {
    func testAgeLabelSecondsMinutesHours() {
        XCTAssertEqual(StatusBarFormat.ageLabel(secondsAgo: 0), "0s")
        XCTAssertEqual(StatusBarFormat.ageLabel(secondsAgo: 59), "59s")
        XCTAssertEqual(StatusBarFormat.ageLabel(secondsAgo: 60), "1m")
        XCTAssertEqual(StatusBarFormat.ageLabel(secondsAgo: 3599), "59m")
        XCTAssertEqual(StatusBarFormat.ageLabel(secondsAgo: 3600), "1h")
        XCTAssertEqual(StatusBarFormat.ageLabel(secondsAgo: 7200), "2h")
    }

    func testAgeLabelNegativeIsDash() {
        XCTAssertEqual(StatusBarFormat.ageLabel(secondsAgo: -1), StatusBarFormat.dash)
    }

    func testAgeLabelSinceReferenceClock() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        XCTAssertEqual(StatusBarFormat.ageLabel(since: now.addingTimeInterval(-65), now: now), "1m")
        // A future timestamp yields the dash sentinel (web `ms < 0`).
        XCTAssertEqual(StatusBarFormat.ageLabel(since: now.addingTimeInterval(30), now: now), StatusBarFormat.dash)
    }

    func testDistanceConvertsAndRounds() {
        XCTAssertEqual(StatusBarFormat.distance(meters: 386_240, unit: .km), 386)
        XCTAssertEqual(StatusBarFormat.distance(meters: 386_240, unit: .mi), 240)
        XCTAssertEqual(StatusBarFormat.distance(meters: 0, unit: .km), 0)
        XCTAssertEqual(StatusBarFormat.distance(meters: .infinity, unit: .km), 0)
    }

    func testUptimeLabelBranches() {
        XCTAssertEqual(StatusBarFormat.uptime(seconds: 93600), "1d 2h")
        XCTAssertEqual(StatusBarFormat.uptime(seconds: 7260), "2h 1m")
        XCTAssertEqual(StatusBarFormat.uptime(seconds: 300), "5m")
        XCTAssertNil(StatusBarFormat.uptime(seconds: 0))
        XCTAssertNil(StatusBarFormat.uptime(seconds: nil))
        XCTAssertNil(StatusBarFormat.uptime(seconds: -5))
    }
}

// MARK: - StatusBarTone (color paired with an icon)

final class StatusBarToneTests: XCTestCase {
    func testApiHealthToneMap() {
        XCTAssertEqual(StatusBarTone.forApiHealth(.ok), .positive)
        XCTAssertEqual(StatusBarTone.forApiHealth(.degraded), .caution)
        XCTAssertEqual(StatusBarTone.forApiHealth(.offline), .critical)
        XCTAssertEqual(StatusBarTone.forApiHealth(.unknown), .neutral)
    }

    func testLiveStatusToneMap() {
        XCTAssertEqual(StatusBarTone.forLiveStatus(.connected), .positive)
        XCTAssertEqual(StatusBarTone.forLiveStatus(.reconnecting), .caution)
        XCTAssertEqual(StatusBarTone.forLiveStatus(.stale), .caution)
        XCTAssertEqual(StatusBarTone.forLiveStatus(.disconnected), .critical)
        XCTAssertEqual(StatusBarTone.forLiveStatus(.unknown), .neutral)
    }
}

// MARK: - StatusBarVehicleRef (web name fallback chain)

final class StatusBarVehicleRefTests: XCTestCase {
    func testResolvedNamePrefersDisplayName() {
        let ref = StatusBarVehicleRef(id: 7, displayName: "Garage", vin: "VIN", model: "Model 3")
        XCTAssertEqual(ref.resolvedName(vehicleFallback: "Vehicle"), "Garage")
    }

    func testResolvedNameFallsBackToVIN() {
        let ref = StatusBarVehicleRef(id: 7, displayName: nil, vin: "5YJ3E", model: nil)
        XCTAssertEqual(ref.resolvedName(vehicleFallback: "Vehicle"), "5YJ3E")
    }

    func testResolvedNameFallsBackToVehicleId() {
        let ref = StatusBarVehicleRef(id: 7, displayName: "", vin: "", model: nil)
        XCTAssertEqual(ref.resolvedName(vehicleFallback: "Vehicle"), "Vehicle 7")
    }
}

// MARK: - StatusBarVersionInfo (platform join + SHA sentinel)

final class StatusBarVersionInfoTests: XCTestCase {
    func testPlatformJoinsOsAndArch() {
        let info = StatusBarVersionInfo(appVersion: "1.0", sha: "abc", os: "linux", arch: "arm64")
        XCTAssertEqual(info.platform, "linux/arm64")
    }

    func testPlatformNilWhenBothAbsent() {
        XCTAssertNil(StatusBarVersionInfo(appVersion: "1.0", sha: "abc").platform)
    }

    func testPlatformUsesWhicheverIsPresent() {
        XCTAssertEqual(StatusBarVersionInfo(appVersion: "1.0", sha: "abc", os: "linux").platform, "linux")
        XCTAssertEqual(StatusBarVersionInfo(appVersion: "1.0", sha: "abc", arch: "arm64").platform, "arm64")
    }

    func testHasRealSHA() {
        XCTAssertTrue(StatusBarVersionInfo(appVersion: "1.0", sha: "a1b2c3d").hasRealSHA)
        XCTAssertFalse(StatusBarVersionInfo(appVersion: "1.0", sha: "dev").hasRealSHA)
        XCTAssertFalse(StatusBarVersionInfo(appVersion: "1.0", sha: "").hasRealSHA)
    }
}

// MARK: - StatusBarPrefs (Codable round-trip + defaults)

final class StatusBarPrefsTests: XCTestCase {
    func testDefaults() {
        XCTAssertTrue(StatusBarPrefs.defaults.enabled)
        XCTAssertFalse(StatusBarPrefs.defaults.iconOnly)
    }

    func testCodableRoundTrip() throws {
        let prefs = StatusBarPrefs(enabled: false, iconOnly: true)
        let data = try JSONEncoder().encode(prefs)
        let decoded = try JSONDecoder().decode(StatusBarPrefs.self, from: data)
        XCTAssertEqual(decoded, prefs)
    }
}

// MARK: - Prefs store (P1/S8 read/write seam)

@MainActor
final class StatusBarPrefsStoreTests: XCTestCase {
    func testInMemoryStoreReadsAndWrites() {
        let store = InMemoryStatusBarPrefsStore()
        XCTAssertEqual(store.current, .defaults)
        store.update(StatusBarPrefs(enabled: false, iconOnly: true))
        XCTAssertEqual(store.current, StatusBarPrefs(enabled: false, iconOnly: true))
    }

    func testUserDefaultsStoreRoundTrips() throws {
        let suite = try XCTUnwrap(UserDefaults(suiteName: "StatusBarPrefsStoreTests"))
        suite.removePersistentDomain(forName: "StatusBarPrefsStoreTests")
        let store = UserDefaultsStatusBarPrefsStore(defaults: suite)
        XCTAssertEqual(store.current, .defaults, "absent value falls back to defaults (web readPrefs)")
        store.update(StatusBarPrefs(enabled: false, iconOnly: true))
        let reread = UserDefaultsStatusBarPrefsStore(defaults: suite)
        XCTAssertEqual(reread.current, StatusBarPrefs(enabled: false, iconOnly: true))
        suite.removePersistentDomain(forName: "StatusBarPrefsStoreTests")
    }
}
