//
//  SwipeRow.Tests.swift
//  TeslaSync — P4 shared surface · 0189 · SwipeRow (Apple)
//
//  The Foundation-only coverage for the SwipeRow surface:
//    • Geometry (the data adapter) — the web drag math: the vertical-drift cancel, the 8px horizontal
//      lock, the wired-side + overshoot offset clamp, the reveal-threshold haptic decision, the
//      release-outcome ladder (fire past half-width / peek past threshold / closed), and the resting
//      offsets.
//    • Tone — the action tone → default SF Symbol (web `Archive` / `Trash2`).
//    • Accessibility — the action label (override / visible / empty → generic) + the row hint.
//    • Projection (cached snapshot → resolved) — leaf-contract precedence (error > loading > empty >
//      content) + the carried coarse-pointer capability / connection.
//    • Meta — the diagnostics slug.
//
//  The state-holder / source-seam coverage lives in the sibling SwipeRow.ModelTests.swift. These run
//  in the TeslaSync(/-macOS) XCTest targets with no network and an identity string resolver so the
//  copy reads as the shipped English fallback.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private let identityResolver: SwipeRowResolve = { _, fallback in fallback }
private let keyResolver: SwipeRowResolve = { key, _ in key }

// MARK: - Geometry — axis lock + cancel

final class SwipeRowGeometryAxisTests: XCTestCase {
    func testVerticalDriftCancelsWhenDominant() {
        XCTAssertTrue(SwipeRowGeometry.shouldCancelForVerticalDrift(dx: 4, dy: 24))
    }

    func testVerticalDriftDoesNotCancelWhenHorizontalDominates() {
        XCTAssertFalse(SwipeRowGeometry.shouldCancelForVerticalDrift(dx: 40, dy: 20))
    }

    func testVerticalDriftDoesNotCancelWithinTolerance() {
        XCTAssertFalse(SwipeRowGeometry.shouldCancelForVerticalDrift(dx: 2, dy: 12))
    }

    func testHorizontalLockThreshold() {
        XCTAssertFalse(SwipeRowGeometry.hasHorizontalLock(dx: 7.9))
        XCTAssertTrue(SwipeRowGeometry.hasHorizontalLock(dx: 8))
        XCTAssertTrue(SwipeRowGeometry.hasHorizontalLock(dx: -20))
    }
}

// MARK: - Geometry — offset clamp

final class SwipeRowGeometryOffsetTests: XCTestCase {
    func testPinsToZeroWhenSideHasNoAction() {
        // Dragging left (negative) with no right action is pinned to 0.
        XCTAssertEqual(
            SwipeRowGeometry.constrainedOffset(dx: -50, width: 320, hasLeftAction: true, hasRightAction: false),
            0
        )
        // Dragging right (positive) with no left action is pinned to 0.
        XCTAssertEqual(
            SwipeRowGeometry.constrainedOffset(dx: 50, width: 320, hasLeftAction: false, hasRightAction: true),
            0
        )
    }

    func testPassesThroughWiredSide() {
        XCTAssertEqual(
            SwipeRowGeometry.constrainedOffset(dx: -50, width: 320, hasLeftAction: false, hasRightAction: true),
            -50
        )
    }

    func testClampsToWidth() {
        XCTAssertEqual(
            SwipeRowGeometry.constrainedOffset(dx: -900, width: 320, hasLeftAction: true, hasRightAction: true),
            -320
        )
        XCTAssertEqual(
            SwipeRowGeometry.constrainedOffset(dx: 900, width: 320, hasLeftAction: true, hasRightAction: true),
            320
        )
    }

    func testNonFiniteWidthFallsBackTo320() {
        XCTAssertEqual(
            SwipeRowGeometry.constrainedOffset(dx: -900, width: .nan, hasLeftAction: true, hasRightAction: true),
            -320
        )
    }

    func testCrossedRevealThreshold() {
        XCTAssertFalse(SwipeRowGeometry.crossedRevealThreshold(offset: -63))
        XCTAssertTrue(SwipeRowGeometry.crossedRevealThreshold(offset: -64))
        XCTAssertTrue(SwipeRowGeometry.crossedRevealThreshold(offset: 80))
    }
}

// MARK: - Geometry — release outcome

final class SwipeRowOutcomeTests: XCTestCase {
    private let width: Double = 320 // half = 160

    func testAutoFireRightPastHalfWidth() {
        let outcome = SwipeRowGeometry.releaseOutcome(
            finalOffset: -200, width: width, hasLeftAction: true, hasRightAction: true
        )
        XCTAssertEqual(outcome, .fireRight)
    }

    func testAutoFireLeftPastHalfWidth() {
        let outcome = SwipeRowGeometry.releaseOutcome(
            finalOffset: 200, width: width, hasLeftAction: true, hasRightAction: true
        )
        XCTAssertEqual(outcome, .fireLeft)
    }

    func testPeekRightPastThreshold() {
        let outcome = SwipeRowGeometry.releaseOutcome(
            finalOffset: -80, width: width, hasLeftAction: true, hasRightAction: true
        )
        XCTAssertEqual(outcome, .peekRight)
    }

    func testPeekLeftPastThreshold() {
        let outcome = SwipeRowGeometry.releaseOutcome(
            finalOffset: 80, width: width, hasLeftAction: true, hasRightAction: true
        )
        XCTAssertEqual(outcome, .peekLeft)
    }

    func testClosedBelowThreshold() {
        let outcome = SwipeRowGeometry.releaseOutcome(
            finalOffset: -40, width: width, hasLeftAction: true, hasRightAction: true
        )
        XCTAssertEqual(outcome, .closed)
    }

    func testUnwiredSideNeverFiresOrPeeks() {
        // Dragged far left but no right action → closed (the web branch guards on the wired side).
        XCTAssertEqual(
            SwipeRowGeometry.releaseOutcome(
                finalOffset: -200, width: width, hasLeftAction: true, hasRightAction: false
            ),
            .closed
        )
    }

    func testRestingOffsets() {
        XCTAssertEqual(SwipeRowGeometry.restingOffset(for: .peekRight), -96)
        XCTAssertEqual(SwipeRowGeometry.restingOffset(for: .peekLeft), 96)
        XCTAssertEqual(SwipeRowGeometry.restingOffset(for: .fireRight), 0)
        XCTAssertEqual(SwipeRowGeometry.restingOffset(for: .closed), 0)
    }
}

// MARK: - Tone

final class SwipeActionToneTests: XCTestCase {
    func testDefaultSymbols() {
        XCTAssertEqual(SwipeActionTone.default.defaultSymbolName, "archivebox")
        XCTAssertEqual(SwipeActionTone.danger.defaultSymbolName, "trash")
    }

    func testCases() {
        XCTAssertEqual(SwipeActionTone.allCases, [.default, .danger])
    }
}

// MARK: - Accessibility

final class SwipeRowAccessibilityTests: XCTestCase {
    func testActionLabelPrefersOverride() {
        XCTAssertEqual(
            SwipeRowAccessibility.actionLabel(label: "Del", override: "Delete notification", strings: identityResolver),
            "Delete notification"
        )
    }

    func testActionLabelFallsBackToVisibleLabel() {
        XCTAssertEqual(
            SwipeRowAccessibility.actionLabel(label: "Archive", override: nil, strings: identityResolver),
            "Archive"
        )
    }

    func testActionLabelEmptyResolvesGenericKey() {
        XCTAssertEqual(
            SwipeRowAccessibility.actionLabel(label: "   ", override: "  ", strings: keyResolver),
            "swipeRow.action.generic"
        )
    }

    func testRowHintNilWhenNoActions() {
        XCTAssertNil(SwipeRowAccessibility.rowActionsHint(
            hasLeftAction: false, hasRightAction: false, strings: identityResolver
        ))
    }

    func testRowHintPresentWhenActionWired() {
        XCTAssertEqual(
            SwipeRowAccessibility.rowActionsHint(hasLeftAction: false, hasRightAction: true, strings: identityResolver),
            "Actions available"
        )
    }
}

// MARK: - Projection

final class SwipeRowProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let input = SwipeRowInput(hasContent: false, isLoading: true, errorMessage: "boom")
        XCTAssertEqual(SwipeRowProjection.resolve(input).phase, .error("boom"))
    }

    func testBlankErrorDoesNotTriggerErrorPhase() {
        let input = SwipeRowInput(errorMessage: "")
        XCTAssertEqual(SwipeRowProjection.resolve(input).phase, .content)
    }

    func testLoadingWhenFlaggedAndNoError() {
        XCTAssertEqual(SwipeRowProjection.resolve(SwipeRowInput(isLoading: true)).phase, .loading)
    }

    func testEmptyWhenNoContent() {
        XCTAssertEqual(SwipeRowProjection.resolve(SwipeRowInput(hasContent: false)).phase, .empty)
    }

    func testContentWhenHealthy() {
        let resolved = SwipeRowProjection.resolve(SwipeRowInput())
        XCTAssertEqual(resolved.phase, .content)
        XCTAssertTrue(resolved.isContent)
    }

    func testCarriesCapabilityAndConnection() {
        let resolved = SwipeRowProjection.resolve(SwipeRowInput(isCoarsePointer: false, connection: .offline))
        XCTAssertFalse(resolved.isCoarsePointer)
        XCTAssertEqual(resolved.connection, .offline)
    }

    func testConnectionDoesNotChangePhase() {
        for connection in SwipeRowConnection.allCases {
            let resolved = SwipeRowProjection.resolve(SwipeRowInput(connection: connection))
            XCTAssertEqual(resolved.phase, .content, "connection \(connection) must not change the content phase")
        }
    }
}

// MARK: - Meta

@MainActor
final class SwipeRowMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(SwipeRowMeta.surfaceSlug, "SwipeRow")
        XCTAssertEqual(SwipeRowModel.surfaceSlug, "SwipeRow")
    }
}
