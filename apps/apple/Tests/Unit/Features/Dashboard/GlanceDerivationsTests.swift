import XCTest
@testable import TeslaSync

/// Pure-derivation + formatter tests for the Quick Glance surface — the web page's inline
/// `isOnline`, `batteryColor` thresholds, `getLocationLabel`, the security tone/icon, the
/// lock/climate command + label maps, the command wire strings, and the display formatters
/// (`fmtNumber` + the SI `convertDistanceFromSI` / `convertTempFromSI` renders). Split from
/// `GlancePageModelTests` so each test type stays within the body-length budget.
@MainActor
final class GlanceDerivationsTests: XCTestCase {
    private func state(
        locked: Bool? = true,
        climate: Bool? = false,
        connection: String = "online"
    ) -> GlanceVehicleState {
        GlanceVehicleState(
            state: connection,
            batteryLevel: 72,
            ratedRangeM: 384_000,
            insideTempC: 21.5,
            isLocked: locked,
            isClimateOn: climate
        )
    }

    private func location(
        home: Bool? = nil,
        work: Bool? = nil,
        favorite: Bool? = nil,
        destination: String? = nil
    ) -> GlanceLocation {
        GlanceLocation(
            locatedAtHome: home,
            locatedAtWork: work,
            locatedAtFavorite: favorite,
            destinationName: destination
        )
    }

    // MARK: isOnline (web `state === 'online' || 'parked'`)

    func testIsOnlineMap() {
        XCTAssertTrue(state(connection: "online").isOnline)
        XCTAssertTrue(state(connection: "parked").isOnline)
        XCTAssertFalse(state(connection: "asleep").isOnline)
        XCTAssertFalse(state(connection: "offline").isOnline)
    }

    func testStatusTone() {
        XCTAssertEqual(state(connection: "online").statusTone, .success)
        XCTAssertEqual(state(connection: "offline").statusTone, .neutral)
    }

    // MARK: Battery tone (web batteryColor + MUTED fallback)

    func testBatteryToneThresholds() {
        XCTAssertEqual(GlanceBattery.tone(nil), .neutral)
        XCTAssertEqual(GlanceBattery.tone(61), .success)
        XCTAssertEqual(GlanceBattery.tone(60), .warning)
        XCTAssertEqual(GlanceBattery.tone(26), .warning)
        XCTAssertEqual(GlanceBattery.tone(25), .danger)
        XCTAssertEqual(GlanceBattery.tone(5), .danger)
    }

    func testBatteryFractionAndPercentClamp() {
        XCTAssertEqual(GlanceBattery.fraction(72), 0.72, accuracy: 0.0001)
        XCTAssertEqual(GlanceBattery.fraction(nil), 0)
        XCTAssertEqual(GlanceBattery.fraction(150), 1)
        XCTAssertEqual(GlanceBattery.percent(72), 72)
        XCTAssertEqual(GlanceBattery.percent(nil), 0)
        XCTAssertEqual(GlanceBattery.percent(150), 100)
    }

    // MARK: Location label (web getLocationLabel)

    func testLocationLabelResolution() {
        XCTAssertEqual(GlanceLocationLabel.resolve(nil), .unknown)
        XCTAssertEqual(GlanceLocationLabel.resolve(location(home: true)), .home)
        XCTAssertEqual(GlanceLocationLabel.resolve(location(work: true)), .work)
        XCTAssertEqual(GlanceLocationLabel.resolve(location(favorite: true)), .favorite)
        XCTAssertEqual(GlanceLocationLabel.resolve(location(destination: "Office")), .destination("Office"))
        XCTAssertEqual(GlanceLocationLabel.resolve(location()), .unknown)
    }

    func testLocationLabelKeys() {
        XCTAssertEqual(GlanceLocationLabel.home.localizationKey, "glance.location.home")
        XCTAssertEqual(GlanceLocationLabel.work.localizationKey, "glance.location.work")
        XCTAssertEqual(GlanceLocationLabel.favorite.localizationKey, "glance.location.favorite")
        XCTAssertNil(GlanceLocationLabel.unknown.localizationKey)
        XCTAssertEqual(GlanceLocationLabel.destination("X").destinationText, "X")
        XCTAssertNil(GlanceLocationLabel.home.destinationText)
    }

    // MARK: Security + command/label maps

    func testSecurityDerivations() {
        let locked = state(locked: true)
        XCTAssertTrue(locked.isLockedResolved)
        XCTAssertEqual(locked.securityTone, .success)
        XCTAssertEqual(locked.securityIcon, "lock.fill")

        let unlocked = state(locked: false)
        XCTAssertFalse(unlocked.isLockedResolved)
        XCTAssertEqual(unlocked.securityTone, .danger)
        XCTAssertEqual(unlocked.securityIcon, "lock.open.fill")

        let unknown = state(locked: nil)
        XCTAssertFalse(unknown.isLockedResolved)
        XCTAssertEqual(unknown.securityTone, .danger)
    }

    func testLockAndClimateToggleMaps() {
        let locked = state(locked: true, climate: false)
        XCTAssertEqual(locked.lockToggleCommand, .unlock)
        XCTAssertEqual(locked.lockToggleLabelKey, "glance.action.unlock")
        XCTAssertEqual(locked.lockToggleIcon, "lock.open.fill")
        XCTAssertEqual(locked.climateToggleCommand, .climateOn)
        XCTAssertEqual(locked.climateToggleLabelKey, "glance.action.climateOn")

        let unlockedCooling = state(locked: false, climate: true)
        XCTAssertEqual(unlockedCooling.lockToggleCommand, .lock)
        XCTAssertEqual(unlockedCooling.lockToggleLabelKey, "glance.action.lock")
        XCTAssertEqual(unlockedCooling.lockToggleIcon, "lock.fill")
        XCTAssertEqual(unlockedCooling.climateToggleCommand, .climateOff)
        XCTAssertEqual(unlockedCooling.climateToggleLabelKey, "glance.action.climateOff")
    }

    func testCommandWireStrings() {
        XCTAssertEqual(GlanceCommand.lock.wire, "lock")
        XCTAssertEqual(GlanceCommand.unlock.wire, "unlock")
        XCTAssertEqual(GlanceCommand.climateOn.wire, "climate_on")
        XCTAssertEqual(GlanceCommand.climateOff.wire, "climate_off")
        XCTAssertEqual(GlanceCommand.honkHorn.wire, "honk_horn")
    }

    func testResolvedVehicleName() {
        XCTAssertEqual(GlanceVehicle(id: 1, displayName: "Rocinante", model: "Model 3").resolvedName, "Rocinante")
        XCTAssertEqual(GlanceVehicle(id: 1, displayName: "", model: "Model Y").resolvedName, "Model Y")
        XCTAssertNil(GlanceVehicle(id: 1, displayName: "", model: "").resolvedName)
    }

    // MARK: Formatters (web fmtNumber + SI converters)

    func testNumberFormatting() {
        XCTAssertEqual(GlanceFormat.number(1234.56, decimals: 2), "1,234.56")
        XCTAssertEqual(GlanceFormat.number(7.4, decimals: 2), "7.40")
        XCTAssertEqual(GlanceFormat.number(.nan, decimals: 1), "—")
    }

    func testRangeFormattingMetric() {
        XCTAssertEqual(GlanceFormat.range(384_000, .metric), "384 km")
        XCTAssertEqual(GlanceFormat.range(nil, .metric), "—")
    }

    func testTemperatureFormattingMetric() {
        XCTAssertEqual(GlanceFormat.temperature(21.5, .metric), "21.5°C")
        XCTAssertEqual(GlanceFormat.temperature(nil, .metric), "—")
    }

    func testStaleAndRelativeTime() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertFalse(GlanceFormat.isStale(now.addingTimeInterval(-30), now: now))
        XCTAssertTrue(GlanceFormat.isStale(now.addingTimeInterval(-300), now: now))
        XCTAssertFalse(GlanceFormat.isStale(nil, now: now))
        XCTAssertNotNil(GlanceFormat.relativeTime(since: now.addingTimeInterval(-60), now: now))
        XCTAssertNil(GlanceFormat.relativeTime(since: nil, now: now))
    }
}
