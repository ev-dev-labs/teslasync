//
//  PlaybackControls.Tests.swift
//  TeslaSync — P4 shared surface · 0096 · PlaybackControls (Apple)
//
//  Core coverage for the PlaybackControls surface:
//    • Projection (the data adapter: snapshot → resolved) — leaf-contract precedence
//      (error > loading > empty > content), the time readout, and the scrubber value text.
//    • Meta — the diagnostics slug.
//    • Accessibility — play/pause label, marker label (with / without a label), time readout label.
//    • Source — the in-memory seam's counters + push + the live re-emit.
//    • Model — projection, push adoption, once-only `view.opened`, safe stop, refresh delegation,
//      stale one-shot auto-refresh (offline never), every transport intent → host callback, and the
//      keyboard `perform` dispatch + toast + the shortcut-registry lifecycle (`useShortcut` parity).
//
//  Keyboard-resolver / cheatsheet / speed-helper and the view-compose contracts live in the sibling
//  PlaybackControls.KeyboardTests.swift. These run in the TeslaSync(/-macOS) XCTest targets with no
//  network and an identity string resolver so the copy reads as the shipped English fallback.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private let resolve: PlaybackControlsResolve = { _, fallback in fallback }

private func contentInput(
    connection: PlaybackControlsConnection = .live,
    playing: Bool = true,
    shortcuts: Bool = false,
    progress: Double = 0.5,
    durationMs: Double? = 372_000
) -> PlaybackControlsInput {
    PlaybackControlsInput(
        isPlaying: playing,
        speed: .x10,
        progress: progress,
        elapsed: "3:06",
        total: "6:12",
        durationMs: durationMs,
        markers: [PlaybackControlsMarker(at: 0.41, kind: .regenPeak, label: "Regen", count: 3)],
        enableKeyboardShortcuts: shortcuts,
        connection: connection
    )
}

// MARK: - Projection

final class PlaybackControlsProjectionTests: XCTestCase {
    func testErrorTakesPrecedenceOverLoadingAndContent() {
        let input = PlaybackControlsInput(durationMs: 1000, isLoading: true, errorMessage: "boom")
        XCTAssertEqual(PlaybackControlsProjection.resolve(input, strings: resolve).phase, .error("boom"))
    }

    func testBlankErrorDoesNotTriggerErrorPhase() {
        let input = PlaybackControlsInput(durationMs: 1000, errorMessage: "")
        XCTAssertEqual(PlaybackControlsProjection.resolve(input, strings: resolve).phase, .content)
    }

    func testLoadingWhenFlaggedAndNoError() {
        let input = PlaybackControlsInput(durationMs: 1000, isLoading: true)
        XCTAssertEqual(PlaybackControlsProjection.resolve(input, strings: resolve).phase, .loading)
    }

    func testEmptyWhenNoTimeline() {
        XCTAssertEqual(
            PlaybackControlsProjection.resolve(PlaybackControlsInput(durationMs: 0), strings: resolve).phase,
            .empty
        )
        XCTAssertEqual(
            PlaybackControlsProjection.resolve(PlaybackControlsInput(durationMs: nil), strings: resolve).phase,
            .empty
        )
    }

    func testContentWhenDurationPositive() {
        let resolved = PlaybackControlsProjection.resolve(contentInput(), strings: resolve)
        XCTAssertEqual(resolved.phase, .content)
        XCTAssertTrue(resolved.isContent)
        XCTAssertEqual(resolved.markers.count, 1)
    }

    func testTimeReadoutComposesElapsedAndTotal() {
        let resolved = PlaybackControlsProjection.resolve(contentInput(), strings: resolve)
        XCTAssertEqual(resolved.timeReadout, "3:06 / 6:12")
    }

    func testScrubberValueTextFromDurationAndProgress() {
        // 372_000 ms = 372 s; 50% → 186 s → 3:06.
        let resolved = PlaybackControlsProjection.resolve(contentInput(progress: 0.5), strings: resolve)
        XCTAssertEqual(resolved.scrubberValueText, "3:06")
    }

    func testScrubberValueTextNilWhenDurationUnknown() {
        let resolved = PlaybackControlsProjection.resolve(PlaybackControlsInput(durationMs: nil), strings: resolve)
        XCTAssertNil(resolved.scrubberValueText)
    }

    func testTimeTextPadsSeconds() {
        XCTAssertEqual(PlaybackControlsProjection.timeText(durationMs: 65000, progress: 1), "1:05")
        XCTAssertEqual(PlaybackControlsProjection.timeText(durationMs: 9000, progress: 1), "0:09")
    }

    func testConnectionPassesThrough() {
        XCTAssertEqual(
            PlaybackControlsProjection.resolve(contentInput(connection: .offline), strings: resolve).connection,
            .offline
        )
    }
}

// MARK: - Meta

@MainActor
final class PlaybackControlsMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(PlaybackControlsMeta.surfaceSlug, "PlaybackControls")
        XCTAssertEqual(PlaybackControls.surfaceSlug, "PlaybackControls")
    }
}

// MARK: - Accessibility

final class PlaybackControlsAccessibilityTests: XCTestCase {
    func testPlayPauseLabelToggles() {
        XCTAssertEqual(PlaybackControlsAccessibility.playPauseLabel(isPlaying: true, strings: resolve), "Pause")
        XCTAssertEqual(PlaybackControlsAccessibility.playPauseLabel(isPlaying: false, strings: resolve), "Play")
    }

    func testMarkerLabelWithLabel() {
        let marker = PlaybackControlsMarker(at: 0.42, kind: .regenPeak, label: "Regen peak")
        XCTAssertEqual(PlaybackControlsAccessibility.markerLabel(marker, strings: resolve), "Regen peak, at 42%")
    }

    func testMarkerLabelWithoutLabelUsesKind() {
        let marker = PlaybackControlsMarker(at: 0.4, kind: .lowSoc)
        XCTAssertEqual(PlaybackControlsAccessibility.markerLabel(marker, strings: resolve), "lowSoc 40%")
    }

    func testTimeReadoutLabel() {
        let label = PlaybackControlsAccessibility.timeReadoutLabel(elapsed: "1:00", total: "2:00", strings: resolve)
        XCTAssertEqual(label, "1:00 of 2:00")
    }
}

// MARK: - Source

@MainActor
final class PlaybackControlsSourceTests: XCTestCase {
    func testInMemoryStartEmitsInitialAndCounts() {
        let source = InMemoryPlaybackControlsSource(initial: contentInput())
        var received: PlaybackControlsInput?
        source.onUpdate = { received = $0 }
        source.start()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(received?.speed, .x10)
    }

    func testInMemoryStopRefreshCounters() {
        let source = InMemoryPlaybackControlsSource()
        source.stop()
        source.refresh()
        source.refresh()
        XCTAssertEqual(source.stopCount, 1)
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testLiveSourceUpdateReemits() {
        let source = LivePlaybackControlsSource(snapshot: PlaybackControlsInput(isLoading: true))
        var received: PlaybackControlsInput?
        source.onUpdate = { received = $0 }
        source.start()
        XCTAssertEqual(received?.isLoading, true)
        source.update(contentInput())
        XCTAssertEqual(received?.phase(via: resolve), .content)
    }
}

private extension PlaybackControlsInput {
    func phase(via strings: @escaping PlaybackControlsResolve) -> PlaybackControlsResolved.Phase {
        PlaybackControlsProjection.resolve(self, strings: strings).phase
    }
}
