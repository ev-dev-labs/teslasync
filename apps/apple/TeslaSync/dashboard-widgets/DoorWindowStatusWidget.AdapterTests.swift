//
//  DoorWindowStatusWidget.AdapterTests.swift
//  TeslaSync — P4 dashboard widget · 0037 · DoorWindowStatusWidget (Apple)
//
//  Adapter (cached → projection) coverage: `DoorWindowSignalParser` door/window
//  parsing + open counts, the `DoorWindowState` mapping, the `DoorWindowCellStatus`
//  tone/tinting, the `DoorWindowCellsBuilder` projection, and the compact badge
//  phrasing — all asserted for parity with the web `parseDoorStates` /
//  `parseWindowState` helpers + the `doorCells`/`windowCells` `useMemo`. No
//  network, no store: every assertion is over the pure adapter.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: door parsing (port parity with the web parseDoorStates)

@MainActor final class DoorWindowDoorParsingTests: XCTestCase {
    func testBooleanTrueOpensEveryDoor() {
        XCTAssertEqual(DoorWindowSignalParser.parseDoorStates(.boolean(true)), .uniform(.open))
    }

    func testBooleanFalseClosesEveryDoor() {
        XCTAssertEqual(DoorWindowSignalParser.parseDoorStates(.boolean(false)), .uniform(.closed))
    }

    func testAbsentAndEmptyLeaveEveryDoorUnknown() {
        XCTAssertEqual(DoorWindowSignalParser.parseDoorStates(.absent), .uniform(.unknown))
        XCTAssertEqual(DoorWindowSignalParser.parseDoorStates(.text("")), .uniform(.unknown))
        XCTAssertEqual(DoorWindowSignalParser.parseDoorStates(.text("   ")), .uniform(.unknown))
    }

    func testAllClosedTokenClosesEveryDoor() {
        XCTAssertEqual(DoorWindowSignalParser.parseDoorStates(.text("AllClosed")), .uniform(.closed))
        XCTAssertEqual(DoorWindowSignalParser.parseDoorStates(.text("all_closed")), .uniform(.closed))
    }

    func testDriverPassengerNamingOpensTheNamedCorner() {
        let states = DoorWindowSignalParser.parseDoorStates(.text("DriverFrontOpen,PassengerRearOpen"))
        XCTAssertEqual(states, DoorWindowStates(fl: .open, fr: .closed, rl: .closed, rr: .open))
    }

    func testLeftRightNamingOpensTheNamedCorner() {
        let states = DoorWindowSignalParser.parseDoorStates(.text("FrontRightOpen,RearLeftOpen"))
        XCTAssertEqual(states, DoorWindowStates(fl: .closed, fr: .open, rl: .open, rr: .closed))
    }

    func testPresentTokensDefaultUnnamedCornersToClosed() {
        let states = DoorWindowSignalParser.parseDoorStates(.text("DriverFrontClosed,PassengerFrontClosed"))
        XCTAssertEqual(states, .uniform(.closed))
    }

    func testBareOpenTokenOpensEveryDoor() {
        XCTAssertEqual(DoorWindowSignalParser.parseDoorStates(.text("open")), .uniform(.open))
    }

    func testParsingTrimsCaseFoldsAndDropsEmpties() {
        let states = DoorWindowSignalParser.parseDoorStates(.text("  driverfrontopen , ,  "))
        XCTAssertEqual(states, DoorWindowStates(fl: .open, fr: .closed, rl: .closed, rr: .closed))
    }

    func testOpenDoorCountCountsOnlyOpenCorners() {
        let states = DoorWindowSignalParser.parseDoorStates(.text("DriverFrontOpen,PassengerRearOpen"))
        XCTAssertEqual(DoorWindowSignalParser.openCount(doors: states), 2)
        XCTAssertEqual(DoorWindowSignalParser.openCount(doors: .uniform(.closed)), 0)
    }
}

// MARK: - Adapter: window parsing (port parity with the web parseWindowState)

@MainActor final class DoorWindowWindowParsingTests: XCTestCase {
    func testBooleanWindowsMapToOpenOrClosed() {
        XCTAssertEqual(DoorWindowSignalParser.parseWindowState(.boolean(true)), .open)
        XCTAssertEqual(DoorWindowSignalParser.parseWindowState(.boolean(false)), .closed)
    }

    func testClosedStringIsClosedCaseInsensitively() {
        XCTAssertEqual(DoorWindowSignalParser.parseWindowState(.text("closed")), .closed)
        XCTAssertEqual(DoorWindowSignalParser.parseWindowState(.text("CLOSED")), .closed)
    }

    func testVentedOrPartialStringIsPartial() {
        XCTAssertEqual(DoorWindowSignalParser.parseWindowState(.text("vented")), .partial)
        XCTAssertEqual(DoorWindowSignalParser.parseWindowState(.text("PartiallyOpen")), .partial)
    }

    func testOtherNonEmptyStringIsOpen() {
        XCTAssertEqual(DoorWindowSignalParser.parseWindowState(.text("open")), .open)
        XCTAssertEqual(DoorWindowSignalParser.parseWindowState(.text("DriverOpen")), .open)
    }

    func testEmptyAndAbsentWindowIsUnknown() {
        XCTAssertEqual(DoorWindowSignalParser.parseWindowState(.text("")), .unknown)
        XCTAssertEqual(DoorWindowSignalParser.parseWindowState(.absent), .unknown)
    }

    func testWindowStatesMapFieldsToCornersInWebOrder() {
        let input = DoorWindowLatestInput(
            frontDriverWindow: .text("vented"),
            frontPassengerWindow: .text("closed"),
            rearDriverWindow: .boolean(true),
            rearPassengerWindow: .absent
        )
        XCTAssertEqual(
            DoorWindowSignalParser.windowStates(from: input),
            DoorWindowStates(fl: .partial, fr: .closed, rl: .open, rr: .unknown)
        )
    }

    func testOpenWindowCountTreatsOpenAndPartialAsOpen() {
        let windows = DoorWindowStates(fl: .partial, fr: .closed, rl: .open, rr: .unknown)
        XCTAssertEqual(DoorWindowSignalParser.openCount(windows: windows), 2)
        XCTAssertEqual(DoorWindowSignalParser.openCount(windows: .uniform(.closed)), 0)
    }
}

// MARK: - Adapter: state mapping

@MainActor final class DoorWindowStateTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testGridStatusMapping() {
        XCTAssertEqual(DoorWindowState.closed.gridStatus, .ok)
        XCTAssertEqual(DoorWindowState.open.gridStatus, .warning)
        XCTAssertEqual(DoorWindowState.partial.gridStatus, .warning)
        XCTAssertEqual(DoorWindowState.unknown.gridStatus, .unknown)
    }

    func testValueLabelMatchesWebToValueLabel() {
        XCTAssertEqual(DoorWindowState.closed.valueLabel(localize: echo), "Closed")
        XCTAssertEqual(DoorWindowState.open.valueLabel(localize: echo), "Open")
        XCTAssertEqual(DoorWindowState.partial.valueLabel(localize: echo), "Partial")
        XCTAssertEqual(DoorWindowState.unknown.valueLabel(localize: echo), "—")
    }

    func testAccessibilityValueSpeaksUnknownAsAWord() {
        XCTAssertEqual(DoorWindowState.unknown.accessibilityValue(localize: echo), "Unknown")
        XCTAssertEqual(DoorWindowState.closed.accessibilityValue(localize: echo), "Closed")
    }
}

// MARK: - Adapter: status → tone mapping

@MainActor final class DoorWindowCellStatusTests: XCTestCase {
    func testToneMapping() {
        XCTAssertEqual(DoorWindowCellStatus.ok.tone, .success)
        XCTAssertEqual(DoorWindowCellStatus.warning.tone, .warning)
        XCTAssertEqual(DoorWindowCellStatus.error.tone, .danger)
        XCTAssertEqual(DoorWindowCellStatus.inactive.tone, .neutral)
        XCTAssertEqual(DoorWindowCellStatus.unknown.tone, .neutral)
    }

    func testTintingMatchesWebStatusStyles() {
        XCTAssertTrue(DoorWindowCellStatus.ok.isTinted)
        XCTAssertTrue(DoorWindowCellStatus.warning.isTinted)
        XCTAssertTrue(DoorWindowCellStatus.error.isTinted)
        XCTAssertFalse(DoorWindowCellStatus.inactive.isTinted)
        XCTAssertFalse(DoorWindowCellStatus.unknown.isTinted)
    }
}

// MARK: - Adapter: cell projection (parity with web doorCells/windowCells)

@MainActor final class DoorWindowCellsBuilderTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let keyTap: (String, String) -> String = { key, _ in "L:\(key)" }

    func testBuildReturnsEmptyProjectionWhenNoLatestEvent() {
        XCTAssertEqual(DoorWindowCellsBuilder.build(latest: nil, localize: echo), .empty)
    }

    func testBuildProducesFourOrderedDoorAndWindowCells() {
        let projection = DoorWindowCellsBuilder.build(
            latest: DoorWindowLatestInput(doorState: .text("AllClosed")),
            localize: echo
        )
        XCTAssertEqual(projection.doorCells.map(\.id), ["door-fl", "door-fr", "door-rl", "door-rr"])
        XCTAssertEqual(projection.windowCells.map(\.id), ["window-fl", "window-fr", "window-rl", "window-rr"])
    }

    func testCornerLabelsResolveThroughTheLocalizerKeys() {
        let projection = DoorWindowCellsBuilder.build(
            latest: DoorWindowLatestInput(doorState: .text("AllClosed")),
            localize: keyTap
        )
        XCTAssertEqual(projection.doorCells.map(\.label), [
            "L:widget.doorWindow.fl", "L:widget.doorWindow.fr",
            "L:widget.doorWindow.rl", "L:widget.doorWindow.rr"
        ])
    }

    func testCellValuesAndStatusesReflectParsedState() {
        let projection = DoorWindowCellsBuilder.build(
            latest: DoorWindowLatestInput(
                doorState: .text("DriverFrontOpen"),
                frontDriverWindow: .text("vented"),
                frontPassengerWindow: .text("closed"),
                rearDriverWindow: .absent,
                rearPassengerWindow: .text("closed")
            ),
            localize: echo
        )
        let doors = Dictionary(uniqueKeysWithValues: projection.doorCells.map { ($0.id, $0) })
        XCTAssertEqual(doors["door-fl"]?.value, "Open")
        XCTAssertEqual(doors["door-fl"]?.status, .warning)
        XCTAssertEqual(doors["door-fr"]?.value, "Closed")
        XCTAssertEqual(doors["door-fr"]?.status, .ok)

        let windows = Dictionary(uniqueKeysWithValues: projection.windowCells.map { ($0.id, $0) })
        XCTAssertEqual(windows["window-fl"]?.value, "Partial")
        XCTAssertEqual(windows["window-fl"]?.status, .warning)
        XCTAssertEqual(windows["window-rl"]?.value, "—")
        XCTAssertEqual(windows["window-rl"]?.status, .unknown)
    }

    func testOpenCountsRollUpDoorsAndWindows() {
        let projection = DoorWindowCellsBuilder.build(
            latest: DoorWindowLatestInput(
                doorState: .text("DriverFrontOpen,PassengerRearOpen"),
                frontDriverWindow: .text("vented"),
                rearDriverWindow: .boolean(true)
            ),
            localize: echo
        )
        XCTAssertEqual(projection.openDoorCount, 2)
        XCTAssertEqual(projection.openWindowCount, 2)
    }
}

// MARK: - Adapter: compact badge phrasing

@MainActor final class DoorWindowBadgeTextTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testDoorBadgePhrase() {
        XCTAssertEqual(DoorWindowBadgeText.doors(openCount: 0, localize: echo), "Doors ✓")
        XCTAssertEqual(DoorWindowBadgeText.doors(openCount: 2, localize: echo), "2 door(s) open")
    }

    func testWindowBadgePhrase() {
        XCTAssertEqual(DoorWindowBadgeText.windows(openCount: 0, localize: echo), "Windows ✓")
        XCTAssertEqual(DoorWindowBadgeText.windows(openCount: 1, localize: echo), "1 window(s) open")
    }

    func testBadgeToneMatchesWebVariant() {
        XCTAssertEqual(DoorWindowBadgeText.tone(openCount: 0), .success)
        XCTAssertEqual(DoorWindowBadgeText.tone(openCount: 3), .warning)
    }
}
