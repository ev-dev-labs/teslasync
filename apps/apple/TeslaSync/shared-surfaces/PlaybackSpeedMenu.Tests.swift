//
//  PlaybackSpeedMenu.Tests.swift
//  TeslaSync — P4 shared surface · 0097 · PlaybackSpeedMenu (Apple)
//
//  Unit coverage for the PlaybackSpeedMenu surface logic:
//    • Logic — the speed projection (the verbatim port of the web `REPLAY_SPEEDS` order, the wrapping
//      `nextSpeed`, and the clamped `shiftSpeed`, including multi-slot jumps and both end clamps).
//    • Accessibility — the spoken-label seam: the control label is non-empty and every speed resolves
//      a non-empty `{speed}x` value label.
//    • i18n facade — the per-surface table resolves the one web key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no store. The telemetry +
//  change-dispatch contract is asserted in `…ModelTests.swift`; per-branch view rendering is covered
//  by the #Preview blocks.
//

import XCTest
@testable import TeslaSync

// MARK: - Speed projection (web REPLAY_SPEEDS / nextSpeed / shiftSpeed)

@MainActor final class PlaybackSpeedMenuLogicTests: XCTestCase {
    func testReplaySpeedsOrderMatchesWebConstant() {
        XCTAssertEqual(PlaybackSpeedMenuLogic.replaySpeeds.map(\.multiplier), [1, 10, 25, 50, 100])
    }

    func testNextSpeedAdvancesThroughEachSlot() {
        XCTAssertEqual(PlaybackSpeedMenuLogic.nextSpeed(.x1), .x10)
        XCTAssertEqual(PlaybackSpeedMenuLogic.nextSpeed(.x10), .x25)
        XCTAssertEqual(PlaybackSpeedMenuLogic.nextSpeed(.x25), .x50)
        XCTAssertEqual(PlaybackSpeedMenuLogic.nextSpeed(.x50), .x100)
    }

    func testNextSpeedWrapsFromFastestToSlowest() {
        XCTAssertEqual(PlaybackSpeedMenuLogic.nextSpeed(.x100), .x1)
    }

    func testShiftSpeedForwardAndBackwardSingleSteps() {
        XCTAssertEqual(PlaybackSpeedMenuLogic.shiftSpeed(.x10, by: 1), .x25)
        XCTAssertEqual(PlaybackSpeedMenuLogic.shiftSpeed(.x25, by: -1), .x10)
    }

    func testShiftSpeedClampsAtBothEnds() {
        XCTAssertEqual(PlaybackSpeedMenuLogic.shiftSpeed(.x1, by: -1), .x1)
        XCTAssertEqual(PlaybackSpeedMenuLogic.shiftSpeed(.x1, by: -5), .x1)
        XCTAssertEqual(PlaybackSpeedMenuLogic.shiftSpeed(.x100, by: 1), .x100)
        XCTAssertEqual(PlaybackSpeedMenuLogic.shiftSpeed(.x100, by: 9), .x100)
    }

    func testShiftSpeedMultiSlotJumps() {
        XCTAssertEqual(PlaybackSpeedMenuLogic.shiftSpeed(.x1, by: 2), .x25)
        XCTAssertEqual(PlaybackSpeedMenuLogic.shiftSpeed(.x100, by: -3), .x10)
    }

    func testShiftSpeedZeroDeltaIsIdentity() {
        for speed in PlaybackSpeedMenuLogic.replaySpeeds {
            XCTAssertEqual(PlaybackSpeedMenuLogic.shiftSpeed(speed, by: 0), speed)
        }
    }

    func testReplaySpeedComparableIdentityAndCount() {
        XCTAssertTrue(ReplaySpeed.x1 < ReplaySpeed.x100)
        XCTAssertEqual(ReplaySpeed.x50.id, 50)
        XCTAssertEqual(ReplaySpeed.allCases.count, 5)
    }
}

// MARK: - Accessibility label seam (the spoken content VoiceOver reads)

@MainActor final class PlaybackSpeedMenuAccessibilityTests: XCTestCase {
    func testSpeedValueLabelFormatsAsMultiplier() {
        XCTAssertEqual(PlaybackSpeedMenuStrings.speedValueLabel(.x1), "1x")
        XCTAssertEqual(PlaybackSpeedMenuStrings.speedValueLabel(.x10), "10x")
        XCTAssertEqual(PlaybackSpeedMenuStrings.speedValueLabel(.x100), "100x")
    }

    func testControlLabelIsNonEmpty() {
        XCTAssertFalse(PlaybackSpeedMenuStrings.speedControlLabel.isEmpty)
    }

    func testEverySpeedHasNonEmptyValueLabel() {
        for speed in PlaybackSpeedMenuLogic.replaySpeeds {
            XCTAssertFalse(
                PlaybackSpeedMenuStrings.speedValueLabel(speed).isEmpty,
                "\(speed) must resolve a non-empty value label"
            )
        }
    }
}

// MARK: - i18n facade (web `t(key, default)` parity)

@MainActor final class PlaybackSpeedMenuStringsTests: XCTestCase {
    func testControlLabelResolvesToWebFallback() {
        XCTAssertEqual(PlaybackSpeedMenuStrings.speedControlLabel, "Playback speed")
    }

    func testFacadeResolvesKeyToWebFallback() {
        XCTAssertEqual(
            PlaybackSpeedMenuStrings.string("replay.controls.speed", "Playback speed"),
            "Playback speed"
        )
    }

    func testFacadeTableNameIsStable() {
        XCTAssertEqual(PlaybackSpeedMenuStrings.table, "PlaybackSpeedMenu")
    }
}
