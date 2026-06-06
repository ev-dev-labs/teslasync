import XCTest
@testable import TeslaSync

/// The APNs payload parser: category resolution, deep-link routing, severity, and
/// silent-push detection. Pure, so every case is deterministic.
final class PushPayloadParserTests: XCTestCase {
    func testChargingDeepLinkRoutesToCharging() {
        let note = PushPayloadParser.parse([
            "aps": ["alert": ["title": "Charging started", "body": "11 kW"], "category": "charging"],
            "category": "charging",
            "deeplink": "teslasync://charging",
            "vehicle_id": 1,
            "severity": "info"
        ])
        XCTAssertEqual(note.category, .charging)
        XCTAssertEqual(note.route, .charging)
        XCTAssertEqual(note.vehicleID, 1)
        XCTAssertEqual(note.title, "Charging started")
        XCTAssertEqual(note.body, "11 kW")
        XCTAssertEqual(note.severity, .info)
    }

    func testCommandRoutesToVehicles() {
        let note = PushPayloadParser.parse([
            "aps": ["alert": ["title": "Climate on"]],
            "category": "command",
            "deeplink": "teslasync://vehicles"
        ])
        XCTAssertEqual(note.category, .command)
        XCTAssertEqual(note.route, .vehicles)
    }

    func testSecurityFallsBackToCategoryRouteAndCriticalSeverity() {
        let note = PushPayloadParser.parse([
            "aps": ["alert": ["title": "Sentry event"], "category": "security"],
            "category": "security",
            "severity": "critical"
        ])
        XCTAssertEqual(note.category, .security)
        XCTAssertEqual(note.route, .vehicleSystems)
        XCTAssertEqual(note.severity, .critical)
        XCTAssertNil(note.deepLink)
    }

    func testUnknownCategoryRoutesToDashboard() {
        let note = PushPayloadParser.parse(["aps": ["alert": "hello"]])
        XCTAssertEqual(note.category, .generic)
        XCTAssertEqual(note.route, .dashboard)
        XCTAssertEqual(note.body, "hello")
    }

    func testExplicitRoutePathWinsOverCategory() {
        let note = PushPayloadParser.parse([
            "category": "alerts",
            "route": "/charging",
            "aps": ["alert": "x"]
        ])
        XCTAssertEqual(note.category, .alert, "alias 'alerts' resolves to .alert")
        XCTAssertEqual(note.route, .charging, "an explicit route path overrides the category default")
    }

    func testSilentContentAvailablePushHasNoAlertContent() {
        let note = PushPayloadParser.parse(["aps": ["content-available": 1], "category": "charging"])
        XCTAssertTrue(note.isContentAvailable)
        XCTAssertFalse(note.hasAlertContent)
    }

    func testStringVehicleIdAndAliasCategory() {
        let note = PushPayloadParser.parse([
            "aps": ["alert": ["title": "Drive"]],
            "category": "drive",
            "vehicle_id": "42"
        ])
        XCTAssertEqual(note.category, .trip)
        XCTAssertEqual(note.route, .trips)
        XCTAssertEqual(note.vehicleID, 42)
    }
}
