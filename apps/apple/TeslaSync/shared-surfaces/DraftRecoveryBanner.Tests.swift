//
//  DraftRecoveryBanner.Tests.swift
//  TeslaSync — P4 shared surface · 0116 · DraftRecoveryBanner (Apple)
//
//  Adapter + projection + model coverage for the DraftRecoveryBanner surface:
//    • Interpolation — the `{{token}}` substitution (web i18next `{{noun}}` / `{{when}}` / `{{count}}`).
//    • Relative time — the web `formatRelativeTime` thresholds (Just now / Nm ago / Nh ago / absolute).
//    • Message — the web `draft.restoredItem` (noun) vs `draft.restored` branch + the `draft.unknownTime`
//      fallback for a missing save instant.
//    • Accessibility — the collapsed VoiceOver banner label.
//    • Projection — every render branch across dismissed / error / loading / empty / data, with a cached
//      draft surviving a transient loading or failure (the P4 leaf contract).
//    • Model — start telemetry, snapshot application, restore / discard semantics (restore keeps the
//      stored draft, discard clears it), the sticky dismissed flag, and the stale auto-refresh.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure adapter / projection directly or drives the model through an in-memory
//  source. The string resolver is the identity-fallback so the asserted copy is deterministic.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

/// Identity-fallback resolver — returns the web English default so the asserted copy is independent of
/// the bundle / locale catalog.
private let fallbackStrings: DraftRecoveryResolve = { _, fallback in fallback }

private let posix = Locale(identifier: "en_US_POSIX")
private let referenceNow = Date(timeIntervalSince1970: 1_700_000_000)

private func minutesAgo(_ minutes: Int) -> Date {
    referenceNow.addingTimeInterval(-Double(minutes) * 60)
}

private func hoursAgo(_ hours: Int) -> Date {
    referenceNow.addingTimeInterval(-Double(hours) * 3600)
}

// MARK: - Interpolation (web i18next `{{token}}`)

final class DraftRecoveryInterpolationTests: XCTestCase {
    func testReplacesASingleToken() {
        XCTAssertEqual(
            DraftRecoveryInterpolation.apply("Draft restored from {{when}}.", ["when": "5m ago"]),
            "Draft restored from 5m ago."
        )
    }

    func testReplacesMultipleTokens() {
        XCTAssertEqual(
            DraftRecoveryInterpolation.apply("{{noun}} draft restored from {{when}}.", [
                "noun": "rule",
                "when": "2h ago"
            ]),
            "rule draft restored from 2h ago."
        )
    }

    func testLeavesUnknownTokensUntouched() {
        XCTAssertEqual(
            DraftRecoveryInterpolation.apply("Hello {{name}}", ["other": "x"]),
            "Hello {{name}}"
        )
    }
}

// MARK: - Relative time (web `formatRelativeTime`)

final class DraftRecoveryRelativeTimeTests: XCTestCase {
    private func stamp(_ instant: Date) -> String {
        DraftRecoveryRelativeTime.string(for: instant, now: referenceNow, locale: posix, strings: fallbackStrings)
    }

    func testUnderOneMinuteIsJustNow() {
        XCTAssertEqual(stamp(referenceNow.addingTimeInterval(-30)), "Just now")
    }

    func testMinutesAgo() {
        XCTAssertEqual(stamp(minutesAgo(5)), "5m ago")
        XCTAssertEqual(stamp(minutesAgo(59)), "59m ago")
    }

    func testHoursAgo() {
        XCTAssertEqual(stamp(minutesAgo(60)), "1h ago")
        XCTAssertEqual(stamp(hoursAgo(3)), "3h ago")
        XCTAssertEqual(stamp(hoursAgo(23)), "23h ago")
    }

    func testOlderThanADayUsesTheLocaleAbsoluteForm() {
        let instant = hoursAgo(25)
        let expected = instant.formatted(
            .dateTime.month(.abbreviated).day().hour().minute().locale(posix)
        )
        let result = stamp(instant)
        XCTAssertEqual(result, expected)
        XCTAssertFalse(result.hasSuffix("ago"))
    }
}

// MARK: - Message (web `draft.restoredItem` / `draft.restored` + `draft.unknownTime`)

final class DraftRecoveryMessageTests: XCTestCase {
    func testWhenUsesUnknownTimeFallbackForMissingInstant() {
        XCTAssertEqual(
            DraftRecoveryMessage.when(savedAt: nil, now: referenceNow, locale: posix, strings: fallbackStrings),
            "a moment ago"
        )
    }

    func testWhenFormatsAKnownInstant() {
        let stamp = DraftRecoveryMessage.when(
            savedAt: minutesAgo(5),
            now: referenceNow,
            locale: posix,
            strings: fallbackStrings
        )
        XCTAssertEqual(stamp, "5m ago")
    }

    func testBuildWithNounUsesTheNounQualifiedKey() {
        XCTAssertEqual(
            DraftRecoveryMessage.build(itemNoun: "rule", when: "5m ago", strings: fallbackStrings),
            "rule draft restored from 5m ago."
        )
    }

    func testBuildWithoutNounUsesThePlainKey() {
        XCTAssertEqual(
            DraftRecoveryMessage.build(itemNoun: nil, when: "5m ago", strings: fallbackStrings),
            "Draft restored from 5m ago."
        )
    }

    func testBuildTreatsEmptyNounAsAbsent() {
        XCTAssertEqual(
            DraftRecoveryMessage.build(itemNoun: "", when: "5m ago", strings: fallbackStrings),
            "Draft restored from 5m ago."
        )
    }

    func testRenderComposesWhenAndMessage() {
        let draft = DraftRecoveryDraft(savedAt: hoursAgo(2), itemNoun: "automation")
        XCTAssertEqual(
            DraftRecoveryMessage.render(draft: draft, now: referenceNow, locale: posix, strings: fallbackStrings),
            "automation draft restored from 2h ago."
        )
    }
}

// MARK: - Accessibility

final class DraftRecoveryAccessibilityTests: XCTestCase {
    func testBannerLabelCollapsesWhitespace() {
        XCTAssertEqual(
            DraftRecoveryAccessibility.bannerLabel(message: "Draft restored from  5m ago."),
            "Draft restored from 5m ago."
        )
    }

    func testBannerLabelTrimsEnds() {
        XCTAssertEqual(
            DraftRecoveryAccessibility.bannerLabel(message: "  Use draft  "),
            "Use draft"
        )
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class DraftRecoveryProjectionTests: XCTestCase {
    private func resolve(
        _ input: DraftRecoveryInput,
        dismissed: Bool = false
    ) -> DraftRecoveryResolved {
        DraftRecoveryProjection.resolve(
            input: input,
            now: referenceNow,
            locale: posix,
            dismissed: dismissed,
            strings: fallbackStrings
        )
    }

    func testDismissedIsEmpty() {
        let input = DraftRecoveryInput(draft: DraftRecoveryDraft(savedAt: minutesAgo(5)))
        XCTAssertEqual(resolve(input, dismissed: true).phase, .empty)
    }

    func testErrorWithNoDraftIsError() {
        let resolved = resolve(DraftRecoveryInput(errorMessage: "boom"))
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.data)
    }

    func testErrorWithCachedDraftKeepsShowingData() {
        let input = DraftRecoveryInput(
            draft: DraftRecoveryDraft(savedAt: minutesAgo(5), itemNoun: "rule"),
            errorMessage: "boom"
        )
        let resolved = resolve(input)
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.data?.message, "rule draft restored from 5m ago.")
    }

    func testLoadingWithNoDraftIsLoading() {
        XCTAssertEqual(resolve(DraftRecoveryInput(isLoading: true)).phase, .loading)
    }

    func testLoadingWithCachedDraftShowsData() {
        let input = DraftRecoveryInput(
            draft: DraftRecoveryDraft(savedAt: minutesAgo(5)),
            isLoading: true
        )
        XCTAssertEqual(resolve(input).phase, .data)
    }

    func testNoDraftIsEmpty() {
        XCTAssertEqual(resolve(DraftRecoveryInput()).phase, .empty)
    }

    func testDraftRendersDataWithPropagatedFields() {
        let savedAt = hoursAgo(2)
        let input = DraftRecoveryInput(draft: DraftRecoveryDraft(savedAt: savedAt, itemNoun: "automation"))
        let resolved = resolve(input)
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.data?.savedAt, savedAt)
        XCTAssertEqual(resolved.data?.itemNoun, "automation")
        XCTAssertEqual(resolved.data?.message, "automation draft restored from 2h ago.")
    }

    func testDraftWithoutSaveInstantUsesUnknownTimeCopy() {
        let input = DraftRecoveryInput(draft: DraftRecoveryDraft(savedAt: nil))
        XCTAssertEqual(resolve(input).data?.message, "Draft restored from a moment ago.")
    }
}

// MARK: - Model (state holder + restore / discard + auto-refresh)

private final class SpyDraftRecoveryTelemetry: DraftRecoveryBannerTelemetry, @unchecked Sendable {
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
private final class CallFlag {
    private(set) var count = 0
    func fire() {
        count += 1
    }
}

@MainActor
final class DraftRecoveryBannerModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryDraftRecoverySource,
        telemetry: DraftRecoveryBannerTelemetry = SpyDraftRecoveryTelemetry(),
        onRestore: (@MainActor () -> Void)? = nil,
        onDiscard: (@MainActor () -> Void)? = nil
    ) -> DraftRecoveryBannerModel {
        let now = referenceNow
        return DraftRecoveryBannerModel(
            source: source,
            telemetry: telemetry,
            locale: posix,
            clock: { now },
            onRestore: onRestore,
            onDiscard: onDiscard
        )
    }

    func testStartEmitsViewOpenedAndStartsSource() {
        let source = InMemoryDraftRecoverySource(initial: DraftRecoveryInput())
        let telemetry = SpyDraftRecoveryTelemetry()
        let model = makeModel(source: source, telemetry: telemetry)

        model.start()
        model.start() // idempotent

        XCTAssertEqual(telemetry.openedSurfaces, ["DraftRecoveryBanner"])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.phase, .empty)
    }

    func testApplyDrivesPhaseAndConnection() {
        let source = InMemoryDraftRecoverySource()
        let model = makeModel(source: source)
        model.start()

        source.push(DraftRecoveryInput(draft: DraftRecoveryDraft(savedAt: minutesAgo(5), itemNoun: "rule")))

        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(model.data?.message, "rule draft restored from 5m ago.")
    }

    func testRestoreHidesBannerKeepsDraftAndInvokesHandler() {
        let source = InMemoryDraftRecoverySource(initial: DraftRecoveryInput(
            draft: DraftRecoveryDraft(savedAt: minutesAgo(5))
        ))
        let restored = CallFlag()
        let model = makeModel(source: source, onRestore: { restored.fire() })
        model.start()
        XCTAssertEqual(model.phase, .data)

        model.restore()

        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(restored.count, 1)
        XCTAssertEqual(source.discardCount, 0) // restore must NOT clear the stored draft
    }

    func testDiscardHidesBannerClearsDraftAndInvokesHandler() {
        let source = InMemoryDraftRecoverySource(initial: DraftRecoveryInput(
            draft: DraftRecoveryDraft(savedAt: minutesAgo(5))
        ))
        let discarded = CallFlag()
        let model = makeModel(source: source, onDiscard: { discarded.fire() })
        model.start()

        model.discard()

        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(discarded.count, 1)
        XCTAssertEqual(source.discardCount, 1) // discard clears the stored draft upstream
    }

    func testDismissedIsStickyAcrossReEmit() {
        let source = InMemoryDraftRecoverySource(initial: DraftRecoveryInput(
            draft: DraftRecoveryDraft(savedAt: minutesAgo(5))
        ))
        let model = makeModel(source: source, onRestore: {})
        model.start()
        model.restore()
        XCTAssertEqual(model.phase, .empty)

        // A later snapshot carrying a draft must not re-show an acknowledged banner.
        source.push(DraftRecoveryInput(draft: DraftRecoveryDraft(savedAt: minutesAgo(1))))
        XCTAssertEqual(model.phase, .empty)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let source = InMemoryDraftRecoverySource()
        let model = makeModel(source: source)
        model.start()

        source.push(DraftRecoveryInput(
            draft: DraftRecoveryDraft(savedAt: minutesAgo(5)),
            connection: .stale
        ))
        XCTAssertEqual(source.refreshCount, 1)

        // A second stale snapshot does not re-trigger the one-shot auto-refresh.
        source.push(DraftRecoveryInput(
            draft: DraftRecoveryDraft(savedAt: minutesAgo(5)),
            connection: .stale
        ))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let source = InMemoryDraftRecoverySource()
        let model = makeModel(source: source)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
