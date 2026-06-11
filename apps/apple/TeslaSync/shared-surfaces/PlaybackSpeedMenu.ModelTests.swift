//
//  PlaybackSpeedMenu.ModelTests.swift
//  TeslaSync — P4 shared surface · 0097 · PlaybackSpeedMenu (Apple)
//
//  Telemetry + change-dispatch coverage split out of `…Tests.swift` (one concern per file): the
//  P1/S11 `view.opened` emission seam (emitted exactly once on first appearance; never
//  double-counted), the stable diagnostics slug, and the `PlaybackSpeedMenuModel` behaviour — the
//  forward cycle (wrapping), the backward step (clamped), and the direct select all dispatch the
//  projected value to the host `onChange`. Driven by spies; no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Diagnostics emission seam (P1/S11 view.opened)

@MainActor final class PlaybackSpeedMenuDiagnosticsTests: XCTestCase {
    func testOpenIfNeededEmitsOnce() {
        let spy = SpyPlaybackSpeedMenuTelemetry()
        let emitted = PlaybackSpeedMenuDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [PlaybackSpeedMenuMeta.surfaceSlug])
    }

    func testOpenIfNeededDoesNotDoubleEmit() {
        let spy = SpyPlaybackSpeedMenuTelemetry()
        var emitted = PlaybackSpeedMenuDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        emitted = PlaybackSpeedMenuDiagnostics.openIfNeeded(alreadyEmitted: emitted, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [PlaybackSpeedMenuMeta.surfaceSlug])
    }

    func testModelMarkAppearedEmitsOnceAcrossRepeatedAppearances() {
        let spy = SpyPlaybackSpeedMenuTelemetry()
        let model = makeModel(telemetry: spy)
        model.markAppeared()
        model.markAppeared()
        model.markAppeared()
        XCTAssertEqual(spy.surfaces, [PlaybackSpeedMenuMeta.surfaceSlug])
    }

    func testSlugIsStable() {
        XCTAssertEqual(PlaybackSpeedMenuMeta.surfaceSlug, "PlaybackSpeedMenu")
        XCTAssertEqual(PlaybackSpeedMenu.surfaceSlug, "PlaybackSpeedMenu")
    }

    func testOSLogTelemetryIsInvokable() {
        OSLogPlaybackSpeedMenuTelemetry().viewOpened(surface: PlaybackSpeedMenuMeta.surfaceSlug)
    }
}

// MARK: - Action model dispatch (forward / backward / select → onChange)

@MainActor final class PlaybackSpeedMenuModelTests: XCTestCase {
    func testCycleForwardEmitsNextSpeed() {
        let spy = ChangeSpy()
        let model = makeModel(spy: spy)
        model.cycleForward(from: .x10)
        XCTAssertEqual(spy.values, [.x25])
    }

    func testCycleForwardWrapsAtFastest() {
        let spy = ChangeSpy()
        let model = makeModel(spy: spy)
        model.cycleForward(from: .x100)
        XCTAssertEqual(spy.values, [.x1])
    }

    func testCycleBackwardEmitsSlowerSpeed() {
        let spy = ChangeSpy()
        let model = makeModel(spy: spy)
        model.cycleBackward(from: .x25)
        XCTAssertEqual(spy.values, [.x10])
    }

    func testCycleBackwardClampsAtSlowest() {
        let spy = ChangeSpy()
        let model = makeModel(spy: spy)
        model.cycleBackward(from: .x1)
        XCTAssertEqual(spy.values, [.x1])
    }

    func testSelectEmitsExactSpeed() {
        let spy = ChangeSpy()
        let model = makeModel(spy: spy)
        model.select(.x50)
        XCTAssertEqual(spy.values, [.x50])
    }
}

// MARK: - Helpers + test doubles

@MainActor
private func makeModel(
    spy: ChangeSpy = ChangeSpy(),
    telemetry: any PlaybackSpeedMenuTelemetry = OSLogPlaybackSpeedMenuTelemetry()
) -> PlaybackSpeedMenuModel {
    PlaybackSpeedMenuModel(onChange: { spy.values.append($0) }, telemetry: telemetry)
}

/// Records the speeds dispatched to the host `onChange` so the cycle/select mapping can be asserted.
@MainActor private final class ChangeSpy {
    var values: [ReplaySpeed] = []
}

/// Records `view.opened` surfaces so the telemetry contract can be asserted.
private final class SpyPlaybackSpeedMenuTelemetry: PlaybackSpeedMenuTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
