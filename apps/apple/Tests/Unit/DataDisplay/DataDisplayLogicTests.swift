import XCTest
@testable import TeslaSync

/// Pure-logic tests for data-display formatters + helpers (no rendering needed).
@MainActor
final class DataDisplayLogicTests: XCTestCase {
    func testPercentageFormatting() {
        XCTAssertEqual(TSPercentage.format(0.5), "50%")
        XCTAssertEqual(TSPercentage.format(1), "100%")
        XCTAssertEqual(TSPercentage.format(nil), "—")
        XCTAssertEqual(TSPercentage.format(.nan), "—")
    }

    func testVoltageCurrentFormatting() {
        XCTAssertEqual(TSVoltage.unitValue(12, suffix: "V"), "12.0 V")
        XCTAssertEqual(TSVoltage.unitValue(nil, suffix: "V"), "—")
        XCTAssertEqual(TSVoltage.unitValue(.infinity, suffix: "A"), "—")
    }

    func testCurrencyAndNumberGuardNonFinite() {
        XCTAssertEqual(TSCurrency.format(nil, code: "USD"), "—")
        XCTAssertEqual(TSFormattedNumber.format(.nan, fractionDigits: 0), "—")
        XCTAssertNotEqual(TSCurrency.format(1234.5, code: "USD"), "—")
        XCTAssertNotEqual(TSFormattedNumber.format(1000, fractionDigits: 0), "—")
    }

    func testAvatarInitials() {
        XCTAssertEqual(TSAvatar.initials(from: "John Doe"), "JD")
        XCTAssertEqual(TSAvatar.initials(from: "madonna"), "M")
        XCTAssertEqual(TSAvatar.initials(from: ""), "?")
        XCTAssertEqual(TSAvatar.initials(from: "Ada B Lovelace"), "AB")
    }

    func testPlaybackSpeedLabel() {
        XCTAssertEqual(TSPlaybackSpeedMenu.speedLabel(1), "1x")
        XCTAssertEqual(TSPlaybackSpeedMenu.speedLabel(0.5), "0.5x")
        XCTAssertEqual(TSPlaybackSpeedMenu.speedLabel(2), "2x")
    }
}
