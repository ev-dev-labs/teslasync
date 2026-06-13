//
//  TimeMachineBanner.Tests.swift
//  TeslaSync — P4 shared surface · 0143 · TimeMachineBanner (Apple)
//
//  Adapter + projection coverage for the TimeMachineBanner surface:
//    • Copy — the verbatim web keys (`timeMachine.banner.title` / `.body` / `.pickPrompt` / `.pick` /
//      `.returnToLive` / `.submit` / `.cancel` / `.inputLabel`) and a title template carrying `{when}`.
//    • Title — the `{when}` interpolation (web `t('…title', { when })`), the empty-when trim, and a
//      token-less template.
//    • RFC 3339 — the validation / parse / format round-trip (web `looksLikeIso` + `toISOString`),
//      including offsets, fractional seconds, minute resolution, and rejected garbage.
//    • Format — the locale-aware display formatter (web `formatDateTime`).
//    • Seed — the "yesterday at noon" picker default (web open-picker seed).
//    • Projection — the render branches plus the P4 leaf contract across loading / empty / error /
//      data (historical + live-with-picker), including precedence.
//    • Accessibility — the composed VoiceOver banner label (web `role="status"` notice).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no persistence, so each assertion
//  reads the pure adapter / projection directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Copy (web `timeMachine.banner.*`)

final class TimeMachineCopyTests: XCTestCase {
    func testKeysMatchWebSourceVerbatim() {
        XCTAssertEqual(TimeMachineCopy.titleKey, "timeMachine.banner.title")
        XCTAssertEqual(TimeMachineCopy.bodyKey, "timeMachine.banner.body")
        XCTAssertEqual(TimeMachineCopy.pickPromptKey, "timeMachine.banner.pickPrompt")
        XCTAssertEqual(TimeMachineCopy.pickKey, "timeMachine.banner.pick")
        XCTAssertEqual(TimeMachineCopy.returnToLiveKey, "timeMachine.banner.returnToLive")
        XCTAssertEqual(TimeMachineCopy.submitKey, "timeMachine.banner.submit")
        XCTAssertEqual(TimeMachineCopy.cancelKey, "timeMachine.banner.cancel")
        XCTAssertEqual(TimeMachineCopy.inputLabelKey, "timeMachine.banner.inputLabel")
    }

    func testTitleTemplateCarriesWhenToken() {
        XCTAssertTrue(TimeMachineCopy.titleFallback.contains(TimeMachineTitle.whenToken))
    }

    func testFallbacksAreNonEmpty() {
        for fallback in [
            TimeMachineCopy.titleFallback, TimeMachineCopy.bodyFallback, TimeMachineCopy.pickPromptFallback,
            TimeMachineCopy.pickFallback, TimeMachineCopy.returnToLiveFallback, TimeMachineCopy.submitFallback,
            TimeMachineCopy.cancelFallback, TimeMachineCopy.inputLabelFallback
        ] {
            XCTAssertFalse(fallback.isEmpty)
        }
    }
}

// MARK: - Title interpolation (web i18next `{{when}}`)

final class TimeMachineTitleTests: XCTestCase {
    func testSubstitutesWhenToken() {
        let result = TimeMachineTitle.text(when: "Nov 12, 2024, 2:30 PM", template: "Viewing data as of {when}")
        XCTAssertEqual(result, "Viewing data as of Nov 12, 2024, 2:30 PM")
    }

    func testEmptyWhenTrimsTrailingSeparator() {
        // The live-mode picker edge (web `effective == null`) interpolates an empty `when`.
        let result = TimeMachineTitle.text(when: "", template: "Viewing data as of {when}")
        XCTAssertEqual(result, "Viewing data as of")
    }

    func testToleratesTemplateWithoutToken() {
        let result = TimeMachineTitle.text(when: "anything", template: "Historical view")
        XCTAssertEqual(result, "Historical view")
    }
}

// MARK: - RFC 3339 (web `useAsOfDate` validation + `toISOString`)

final class TimeMachineRfc3339Tests: XCTestCase {
    func testAcceptsWellFormedTimestamps() {
        XCTAssertTrue(TimeMachineRfc3339.isValid("2024-11-12T14:30:00Z"))
        XCTAssertTrue(TimeMachineRfc3339.isValid("2024-11-12T14:30:00.250Z"))
        XCTAssertTrue(TimeMachineRfc3339.isValid("2024-11-12T14:30:00+02:00"))
        XCTAssertTrue(TimeMachineRfc3339.isValid("2024-11-12T14:30Z"))
    }

    func testRejectsGarbage() {
        XCTAssertFalse(TimeMachineRfc3339.isValid(""))
        XCTAssertFalse(TimeMachineRfc3339.isValid("not-a-date"))
        XCTAssertFalse(TimeMachineRfc3339.isValid("2024-11-12 14:30:00Z"))
        XCTAssertFalse(TimeMachineRfc3339.isValid("2024/11/12T14:30:00Z"))
        XCTAssertFalse(TimeMachineRfc3339.isValid("2024-11-12T14:30:00"))
    }

    func testFormatProducesUtcZuluString() {
        let date = Date(timeIntervalSince1970: 1_731_421_800)
        let formatted = TimeMachineRfc3339.format(date)
        XCTAssertTrue(formatted.hasSuffix("Z"))
        XCTAssertTrue(TimeMachineRfc3339.isValid(formatted))
    }

    func testFormatParseRoundTrips() throws {
        let date = Date(timeIntervalSince1970: 1_731_421_800)
        let serialized = TimeMachineRfc3339.format(date)
        let parsed = try XCTUnwrap(TimeMachineRfc3339.parse(serialized))
        XCTAssertEqual(TimeMachineRfc3339.format(parsed), serialized)
    }
}

// MARK: - Display formatting (web `formatDateTime`)

final class TimeMachineFormatTests: XCTestCase {
    func testDateTimeIsLocaleAwareAndNonEmpty() {
        let date = Date(timeIntervalSince1970: 1_731_421_800)
        let text = TimeMachineFormat.dateTime(date, locale: Locale(identifier: "en_US"), timeZone: .gmt)
        XCTAssertFalse(text.isEmpty)
        XCTAssertTrue(text.contains("2024"))
        XCTAssertTrue(text.contains("Nov"))
    }
}

// MARK: - Picker seed (web open-picker default)

final class TimeMachineSeedTests: XCTestCase {
    func testDefaultAnchorIsYesterdayAtNoon() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .gmt
        let now = Date(timeIntervalSince1970: 1_731_421_800) // 2024-11-12T14:30:00Z
        let seed = TimeMachineSeed.defaultAnchor(now: now, calendar: calendar)
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: seed)
        XCTAssertEqual(parts.year, 2024)
        XCTAssertEqual(parts.month, 11)
        XCTAssertEqual(parts.day, 11)
        XCTAssertEqual(parts.hour, 12)
        XCTAssertEqual(parts.minute, 0)
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class TimeMachineProjectionTests: XCTestCase {
    private let anchor = Date(timeIntervalSince1970: 1_731_421_800)

    func testHistoricalProjectsData() throws {
        let resolved = TimeMachineProjection.resolve(input: TimeMachineInput(asOf: anchor), pickerOpen: false)
        XCTAssertEqual(resolved.phase, .data)
        let data = try XCTUnwrap(resolved.data)
        XCTAssertEqual(data.asOf, anchor)
        XCTAssertTrue(data.isHistorical)
    }

    func testLivePickerOpenProjectsData() throws {
        let resolved = TimeMachineProjection.resolve(input: TimeMachineInput(), pickerOpen: true)
        XCTAssertEqual(resolved.phase, .data)
        let data = try XCTUnwrap(resolved.data)
        XCTAssertNil(data.asOf)
        XCTAssertFalse(data.isHistorical)
    }

    func testLivePickerClosedProjectsEmpty() {
        let resolved = TimeMachineProjection.resolve(input: TimeMachineInput(), pickerOpen: false)
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertNil(resolved.data)
    }

    func testErrorInputProjectsError() {
        let resolved = TimeMachineProjection.resolve(
            input: TimeMachineInput(asOf: anchor, errorMessage: "boom"),
            pickerOpen: true
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.data)
    }

    func testLoadingInputProjectsLoading() {
        let resolved = TimeMachineProjection.resolve(input: TimeMachineInput(isLoading: true), pickerOpen: false)
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testErrorBeatsLoading() {
        let resolved = TimeMachineProjection.resolve(
            input: TimeMachineInput(isLoading: true, errorMessage: "timeout"),
            pickerOpen: false
        )
        XCTAssertEqual(resolved.phase, .error("timeout"))
    }

    func testLoadingBeatsData() {
        let resolved = TimeMachineProjection.resolve(
            input: TimeMachineInput(asOf: anchor, isLoading: true),
            pickerOpen: false
        )
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyErrorMessageDoesNotForceError() {
        let resolved = TimeMachineProjection.resolve(
            input: TimeMachineInput(asOf: anchor, errorMessage: ""),
            pickerOpen: false
        )
        XCTAssertEqual(resolved.phase, .data)
    }
}

// MARK: - Accessibility

final class TimeMachineAccessibilityTests: XCTestCase {
    func testBannerLabelJoinsTitleAndBody() {
        XCTAssertEqual(
            TimeMachineAccessibility.bannerLabel(
                title: "Viewing data as of Nov 12, 2024, 2:30 PM",
                body: "Read-only point-in-time mode."
            ),
            "Viewing data as of Nov 12, 2024, 2:30 PM. Read-only point-in-time mode."
        )
    }

    func testBannerLabelDoesNotDoubleTerminalPunctuation() {
        XCTAssertEqual(
            TimeMachineAccessibility.bannerLabel(title: "Historical view.", body: "Read-only."),
            "Historical view. Read-only."
        )
    }

    func testBannerLabelHandlesEmptyParts() {
        XCTAssertEqual(TimeMachineAccessibility.bannerLabel(title: "", body: "Only body"), "Only body")
        XCTAssertEqual(TimeMachineAccessibility.bannerLabel(title: "Only title", body: ""), "Only title")
    }
}
