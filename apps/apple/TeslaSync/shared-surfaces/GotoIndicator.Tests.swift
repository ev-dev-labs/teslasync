//
//  GotoIndicator.Tests.swift
//  TeslaSync — P4 shared surface · 0121 · GotoIndicator (Apple)
//
//  Adapter + projection + model coverage for the GotoIndicator surface:
//    • Interpolation — the `{{token}}` substitution (web i18next `{{keys}}`).
//    • Chord — the ordered key caps, the visual separator, and the spoken form (web `<kbd>g</kbd> +
//      <kbd>?</kbd>` → "g then ?"), including empty-cap dropping.
//    • Accessibility — whitespace normalization + the spoken hint built from the chord.
//    • Projection — every render branch across error / loading / empty / data, with a known visibility
//      surviving a transient loading or failure (the P4 leaf contract), and the derived hint fields.
//    • Model — start telemetry, snapshot application, the stale one-shot auto-refresh, and stop.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real controller, so
//  each assertion reads the pure adapter / projection directly or drives the model through an in-memory
//  source. The string resolver is the identity-fallback so the asserted copy is deterministic.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

/// Identity-fallback resolver — returns the web English default so the asserted copy is independent of
/// the bundle / locale catalog.
private let fallbackStrings: GotoResolve = { _, fallback in fallback }

// MARK: - Interpolation (web i18next `{{token}}`)

final class GotoInterpolationTests: XCTestCase {
    func testReplacesASingleToken() {
        XCTAssertEqual(
            GotoInterpolation.apply("Press {{keys}} to jump.", ["keys": "g then ?"]),
            "Press g then ? to jump."
        )
    }

    func testReplacesMultipleTokens() {
        XCTAssertEqual(
            GotoInterpolation.apply("{{a}} and {{b}}", ["a": "x", "b": "y"]),
            "x and y"
        )
    }

    func testLeavesUnknownTokensUntouched() {
        XCTAssertEqual(
            GotoInterpolation.apply("Hello {{name}}", ["other": "x"]),
            "Hello {{name}}"
        )
    }
}

// MARK: - Chord (web `<kbd>` sequence)

final class GotoChordTests: XCTestCase {
    func testKeysMirrorTheWebSequence() {
        XCTAssertEqual(GotoChord.keys(strings: fallbackStrings), ["g", "?"])
    }

    func testSeparatorIsThePlusGlyph() {
        XCTAssertEqual(GotoChord.separator(strings: fallbackStrings), "+")
    }

    func testSpokenJoinsKeysWithTheConjunction() {
        XCTAssertEqual(
            GotoChord.spoken(keys: ["g", "?"], strings: fallbackStrings),
            "g then ?"
        )
    }

    func testSpokenDropsEmptyCaps() {
        XCTAssertEqual(GotoChord.spoken(keys: ["g", "", "  "], strings: fallbackStrings), "g")
        XCTAssertEqual(GotoChord.spoken(keys: ["", "?"], strings: fallbackStrings), "?")
    }

    func testSpokenOfEmptyChordIsEmpty() {
        XCTAssertEqual(GotoChord.spoken(keys: [], strings: fallbackStrings), "")
    }
}

// MARK: - Accessibility

final class GotoAccessibilityTests: XCTestCase {
    func testNormalizeCollapsesWhitespace() {
        XCTAssertEqual(GotoAccessibility.normalize("Press  g   then ?"), "Press g then ?")
    }

    func testNormalizeTrimsEnds() {
        XCTAssertEqual(GotoAccessibility.normalize("  Go to  "), "Go to")
    }

    func testHintInterpolatesTheSpokenChord() {
        XCTAssertEqual(
            GotoAccessibility.hint(spokenChord: "g then ?", strings: fallbackStrings),
            "Press g then ? to jump to a section."
        )
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class GotoIndicatorProjectionTests: XCTestCase {
    private func resolve(_ input: GotoIndicatorInput) -> GotoIndicatorResolved {
        GotoIndicatorProjection.resolve(input: input, strings: fallbackStrings)
    }

    func testErrorWithNoVisibilityIsError() {
        let resolved = resolve(GotoIndicatorInput(errorMessage: "boom"))
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.hint)
    }

    func testErrorWithKnownVisibleKeepsShowingData() {
        let resolved = resolve(GotoIndicatorInput(visibility: true, errorMessage: "boom"))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.hint?.prompt, "Go to...")
    }

    func testErrorWithKnownHiddenKeepsShowingEmpty() {
        let resolved = resolve(GotoIndicatorInput(visibility: false, errorMessage: "boom"))
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertNil(resolved.hint)
    }

    func testLoadingWithNoVisibilityIsLoading() {
        XCTAssertEqual(resolve(GotoIndicatorInput(isLoading: true)).phase, .loading)
    }

    func testLoadingWithKnownVisibleShowsData() {
        XCTAssertEqual(resolve(GotoIndicatorInput(visibility: true, isLoading: true)).phase, .data)
    }

    func testUnresolvedVisibilityIsLoading() {
        XCTAssertEqual(resolve(GotoIndicatorInput()).phase, .loading)
    }

    func testHiddenIsEmpty() {
        XCTAssertEqual(resolve(GotoIndicatorInput(visibility: false)).phase, .empty)
    }

    func testVisibleRendersDataWithDerivedHintFields() {
        let resolved = resolve(GotoIndicatorInput(visibility: true))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.hint?.prompt, "Go to...")
        XCTAssertEqual(resolved.hint?.keys, ["g", "?"])
        XCTAssertEqual(resolved.hint?.separator, "+")
        XCTAssertEqual(resolved.hint?.accessibilityHint, "Press g then ? to jump to a section.")
    }
}

// MARK: - Model (state holder + telemetry + auto-refresh)

private final class SpyGotoTelemetry: GotoIndicatorTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var opened: [String] = []

    var openedSurfaces: [String] {
        lock.withLock { opened }
    }

    func viewOpened(surface: String) {
        lock.withLock { opened.append(surface) }
    }
}

@MainActor
final class GotoIndicatorModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryGotoIndicatorSource,
        telemetry: GotoIndicatorTelemetry = SpyGotoTelemetry()
    ) -> GotoIndicatorModel {
        GotoIndicatorModel(source: source, telemetry: telemetry, strings: fallbackStrings)
    }

    func testStartEmitsViewOpenedAndStartsSource() {
        let source = InMemoryGotoIndicatorSource(initial: GotoIndicatorInput(visibility: false))
        let telemetry = SpyGotoTelemetry()
        let model = makeModel(source: source, telemetry: telemetry)

        model.start()
        model.start() // idempotent

        XCTAssertEqual(telemetry.openedSurfaces, ["GotoIndicator"])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.phase, .empty)
    }

    func testApplyDrivesPhaseAndConnection() {
        let source = InMemoryGotoIndicatorSource()
        let model = makeModel(source: source)
        model.start()

        source.push(GotoIndicatorInput(visibility: true))

        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(model.hint?.keys, ["g", "?"])
        XCTAssertEqual(model.hint?.accessibilityHint, "Press g then ? to jump to a section.")
    }

    func testHiddenSnapshotDrivesEmpty() {
        let source = InMemoryGotoIndicatorSource()
        let model = makeModel(source: source)
        model.start()

        source.push(GotoIndicatorInput(visibility: false))

        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.hint)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let source = InMemoryGotoIndicatorSource()
        let model = makeModel(source: source)
        model.start()

        source.push(GotoIndicatorInput(visibility: true, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(model.connection, .stale)

        // A second stale snapshot does not re-trigger the one-shot auto-refresh.
        source.push(GotoIndicatorInput(visibility: true, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let source = InMemoryGotoIndicatorSource()
        let model = makeModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
