//
//  PlaybackControls.KeyboardTests.swift
//  TeslaSync — P4 shared surface · 0096 · PlaybackControls (Apple)
//
//  The keyboard-layer + composition coverage, split from the core tests for the lint length budget:
//    • Speed helpers — the web `nextSpeed` / `shiftSpeed` parity (wrap + clamp) + the label.
//    • Keyboard command resolver — every key (with / without Shift) → its intent (web keydown switch).
//    • Toast wording — every key → its toast label (web `showShortcutToast` strings); reserved = none.
//    • Cheatsheet — the seven localized rows (web help tooltip + `useShortcut` defs); empty when off.
//    • Marker — the `at` clamp + derived id.
//    • Views — the public surface in every phase + every subview composes (signature contract).
//

import SwiftUI
import XCTest
@testable import TeslaSync

private let resolve: PlaybackControlsResolve = { _, fallback in fallback }

// MARK: - Speed helpers (web nextSpeed / shiftSpeed)

final class PlaybackControlsSpeedTests: XCTestCase {
    func testNextWraps() {
        XCTAssertEqual(PlaybackControlsSpeed.x1.next, .x10)
        XCTAssertEqual(PlaybackControlsSpeed.x25.next, .x50)
        XCTAssertEqual(PlaybackControlsSpeed.x100.next, .x1)
    }

    func testShiftedClampsAtEnds() {
        XCTAssertEqual(PlaybackControlsSpeed.x1.shifted(by: -1), .x1)
        XCTAssertEqual(PlaybackControlsSpeed.x100.shifted(by: 1), .x100)
        XCTAssertEqual(PlaybackControlsSpeed.x10.shifted(by: 1), .x25)
        XCTAssertEqual(PlaybackControlsSpeed.x1.shifted(by: 2), .x25)
    }

    func testLabelAndMultiplier() {
        XCTAssertEqual(PlaybackControlsSpeed.x10.label, "10x")
        XCTAssertEqual(PlaybackControlsSpeed.x100.multiplier, 100)
    }
}

// MARK: - Keyboard command resolver

final class PlaybackControlsCommandTests: XCTestCase {
    func testTransportKeys() {
        XCTAssertEqual(PlaybackControlsKeyboard.command(for: .space), .togglePlay)
        XCTAssertEqual(PlaybackControlsKeyboard.command(for: .letterK), .togglePlay)
        XCTAssertEqual(PlaybackControlsKeyboard.command(for: .letterM), .reserved)
    }

    func testArrowSkipsHonorShift() {
        XCTAssertEqual(PlaybackControlsKeyboard.command(for: .arrowLeft), .seekBySeconds(-5))
        XCTAssertEqual(PlaybackControlsKeyboard.command(for: .arrowLeft, shift: true), .seekBySeconds(-30))
        XCTAssertEqual(PlaybackControlsKeyboard.command(for: .arrowRight), .seekBySeconds(5))
        XCTAssertEqual(PlaybackControlsKeyboard.command(for: .arrowRight, shift: true), .seekBySeconds(30))
    }

    func testJlSkips() {
        XCTAssertEqual(PlaybackControlsKeyboard.command(for: .letterJ), .seekBySeconds(-10))
        XCTAssertEqual(PlaybackControlsKeyboard.command(for: .letterL), .seekBySeconds(10))
    }

    func testFrameStep() {
        XCTAssertEqual(PlaybackControlsKeyboard.command(for: .comma), .stepFrame(-1))
        XCTAssertEqual(PlaybackControlsKeyboard.command(for: .period), .stepFrame(1))
    }

    func testJumpKeys() {
        XCTAssertEqual(PlaybackControlsKeyboard.command(for: .home), .seekToProgress(0))
        XCTAssertEqual(PlaybackControlsKeyboard.command(for: .end), .seekToProgress(1))
        XCTAssertEqual(PlaybackControlsKeyboard.command(for: .digit(3)), .seekToProgress(0.3))
        XCTAssertEqual(PlaybackControlsKeyboard.command(for: .digit(0)), .seekToProgress(0))
    }

    func testSpeedKeys() {
        XCTAssertEqual(PlaybackControlsKeyboard.command(for: .plus), .speedRelative(1))
        XCTAssertEqual(PlaybackControlsKeyboard.command(for: .minus), .speedRelative(-1))
    }
}

// MARK: - Toast wording

final class PlaybackControlsToastLabelTests: XCTestCase {
    private func label(_ key: PlaybackControlsKey, shift: Bool = false, playing: Bool = false) -> String? {
        PlaybackControlsKeyboard.toastLabel(for: key, shift: shift, isPlaying: playing, strings: resolve)
    }

    func testTransportTogglesByPlayingState() {
        XCTAssertEqual(label(.space, playing: true), "Pause")
        XCTAssertEqual(label(.space, playing: false), "Play")
        XCTAssertEqual(label(.letterK, playing: true), "Pause")
        XCTAssertNil(label(.letterM))
    }

    func testSkipWording() {
        XCTAssertEqual(label(.arrowLeft), "⏪ −5s")
        XCTAssertEqual(label(.arrowLeft, shift: true), "⏪ −30s")
        XCTAssertEqual(label(.arrowRight), "⏩ +5s")
        XCTAssertEqual(label(.arrowRight, shift: true), "⏩ +30s")
        XCTAssertEqual(label(.letterJ), "⏪ −10s")
        XCTAssertEqual(label(.letterL), "⏩ +10s")
    }

    func testFrameJumpWording() {
        XCTAssertEqual(label(.comma), "⏮ frame")
        XCTAssertEqual(label(.period), "⏭ frame")
        XCTAssertEqual(label(.home), "⏮ start")
        XCTAssertEqual(label(.end), "⏭ end")
    }

    func testSpeedAndDigitWording() {
        XCTAssertEqual(label(.plus), "Faster")
        XCTAssertEqual(label(.minus), "Slower")
        XCTAssertEqual(label(.digit(3)), "30%")
        XCTAssertEqual(label(.digit(0)), "0%")
    }
}

// MARK: - Cheatsheet

final class PlaybackControlsCheatsheetTests: XCTestCase {
    func testDisabledReturnsEmpty() {
        XCTAssertTrue(PlaybackControlsKeyboard.cheatsheet(enabled: false, strings: resolve).isEmpty)
    }

    func testEnabledReturnsSevenRows() {
        let rows = PlaybackControlsKeyboard.cheatsheet(enabled: true, strings: resolve)
        XCTAssertEqual(rows.count, 7)
        XCTAssertEqual(rows.first?.id, "replay.scrubber.playPause")
        XCTAssertEqual(rows.first?.keyCap, "Space / K")
        XCTAssertEqual(rows.first?.description, "Play / Pause")
        XCTAssertEqual(rows.first?.group, "Trip replay")
        XCTAssertEqual(rows.last?.keyCap, "+ / −")
        XCTAssertEqual(rows[5].keyCap, "0 – 9")
    }
}

// MARK: - Marker

final class PlaybackControlsMarkerTests: XCTestCase {
    func testAtClampsAndDerivesID() {
        XCTAssertEqual(PlaybackControlsMarker(at: 1.4, kind: .stop).at, 1)
        XCTAssertEqual(PlaybackControlsMarker(at: -0.2, kind: .start).at, 0)
        XCTAssertEqual(PlaybackControlsMarker(at: 0.5, kind: .event).id, "event-0.5")
    }
}

// MARK: - Views compose (every state + subview — signature contract)

@MainActor
final class PlaybackControlsViewTests: XCTestCase {
    private func input(_ phaseTuner: (inout PlaybackControlsInput) -> Void) -> PlaybackControlsInput {
        var base = PlaybackControlsInput(
            speed: .x10, progress: 0.4, durationMs: 60000,
            markers: [PlaybackControlsMarker(at: 0.5, kind: .regenPeak, label: "Regen", count: 2)],
            enableKeyboardShortcuts: true
        )
        phaseTuner(&base)
        return base
    }

    func testPublicSurfaceComposesEachPhase() {
        _ = PlaybackControls(input: input { _ in })
        _ = PlaybackControls(input: input { $0.isLoading = true })
        _ = PlaybackControls(input: input { $0.durationMs = 0 })
        _ = PlaybackControls(input: input { $0.errorMessage = "boom" })
        _ = PlaybackControls(
            input: input { $0.connection = .stale },
            preview: { PlaybackControlsPreview(at: $0, speed: "10 mph") }
        )
    }

    func testStateSubviewsCompose() {
        _ = PlaybackControlsLoadingView()
        _ = PlaybackControlsEmptyView()
        _ = PlaybackControlsErrorView(message: "boom") {}
    }

    func testBarAndChildSubviewsCompose() {
        let model = PlaybackControlsModel(
            source: InMemoryPlaybackControlsSource(initial: input { _ in }), strings: resolve
        )
        _ = PlaybackControlsBarView(model: model, preview: nil)
        _ = PlaybackControlsTransportButton(systemImage: "play.fill", label: "Play", prominent: true) {}
        _ = PlaybackControlsSpeedControl(speed: .x10, onCycle: {}, onSelect: { _ in })
        _ = PlaybackControlsTimeReadout(text: "1:00 / 2:00", accessibilityText: "1:00 of 2:00")
        _ = PlaybackControlsHelpButton(
            shortcuts: PlaybackControlsKeyboard.cheatsheet(enabled: true, strings: resolve),
            isPresented: .constant(true)
        )
        _ = PlaybackControlsHelpSheet(shortcuts: PlaybackControlsKeyboard.cheatsheet(enabled: true, strings: resolve))
        _ = PlaybackControlsToastView(toast: PlaybackControlsToast(id: 1, label: "Pause"))
    }

    func testScrubberAndMarkerAndFreshnessCompose() {
        _ = PlaybackControlsScrubber(
            progress: 0.4, durationMs: 60000, valueText: "0:24",
            markers: [PlaybackControlsMarker(at: 0.5, kind: .regenPeak, count: 3)],
            preview: { PlaybackControlsPreview(at: $0, speed: "10 mph", power: "5 kW", soc: "80%") },
            onSeek: { _ in }
        )
        _ = PlaybackControlsMarkerTick(marker: PlaybackControlsMarker(at: 0.5, kind: .stop), onSeek: { _ in })
        _ = PlaybackControlsPreviewTooltip(point: PlaybackControlsPreview(at: 0.5, speed: "10 mph"), time: "0:30")
        for connection in PlaybackControlsConnection.allCases {
            _ = PlaybackControlsFreshnessChip(connection: connection) {}
        }
    }
}
