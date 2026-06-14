//
//  MaintenanceBanner.Tests.swift
//  TeslaSync — P4 shared surface · 0127 · MaintenanceBanner (Apple)
//
//  Adapter + projection coverage for the MaintenanceBanner surface (the model / state-holder tests live
//  in the sibling MaintenanceBanner.ModelTests.swift for the lint file-length budget):
//    • MaintenanceBannerServiceMode — the `data.mode` taxonomy (`ok` / `degraded` / `maintenance`, unknown → ok), the
//      active / maintenance predicates, and the SF Symbol mapping.
//    • Fingerprint — the web `fingerprint(...)` (updated-at key vs the mode/message/until composite).
//    • Instant — the `Date.parse(until)` → epoch-millis bridge (fractional / plain / offset / junk).
//    • Remaining + Duration — the countdown if-ladder thresholds and the `formatRemaining` short form.
//    • Interpolation + Message — the `{{time}}` substitution and every title / body / countdown / dismiss
//      branch (maintenance vs degraded, the `message.trim() || default` fallback).
//    • Accessibility — the combined, whitespace-collapsed VoiceOver banner label.
//    • Projection — every render branch: loading / error / empty (mode ok or dismissed) / banner, with an
//      active banner surviving a background failure (the P4 leaf contract) and the per-snapshot dismissal.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real query, so each
//  assertion reads the pure adapter / projection directly. The string resolver is the identity-fallback
//  so the asserted copy is deterministic.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

/// Identity-fallback resolver — returns the web English default so the asserted copy is independent of
/// the bundle / locale catalog.
private let fallbackStrings: MaintenanceBannerResolve = { _, fallback in fallback }

private let defaultMaintenance = "Maintenance is in progress. Live data may be paused."
private let defaultDegraded = "Some features may be slow or unavailable while we work on it."

// MARK: - MaintenanceBannerServiceMode (web `data.mode`)

final class MaintenanceServiceModeTests: XCTestCase {
    func testForRawMapsKnownValues() {
        XCTAssertEqual(MaintenanceBannerServiceMode.forRaw("ok"), .ok)
        XCTAssertEqual(MaintenanceBannerServiceMode.forRaw("degraded"), .degraded)
        XCTAssertEqual(MaintenanceBannerServiceMode.forRaw("maintenance"), .maintenance)
    }

    func testForRawUnknownAndEmptyFallBackToOk() {
        XCTAssertEqual(MaintenanceBannerServiceMode.forRaw("unhealthy"), .ok)
        XCTAssertEqual(MaintenanceBannerServiceMode.forRaw(""), .ok)
        XCTAssertEqual(MaintenanceBannerServiceMode.forRaw("Maintenance"), .ok) // case-sensitive, matching web `===`
    }

    func testIsActiveOnlyForNonOkModes() {
        XCTAssertFalse(MaintenanceBannerServiceMode.ok.isActive)
        XCTAssertTrue(MaintenanceBannerServiceMode.degraded.isActive)
        XCTAssertTrue(MaintenanceBannerServiceMode.maintenance.isActive)
    }

    func testIsMaintenance() {
        XCTAssertTrue(MaintenanceBannerServiceMode.maintenance.isMaintenance)
        XCTAssertFalse(MaintenanceBannerServiceMode.degraded.isMaintenance)
        XCTAssertFalse(MaintenanceBannerServiceMode.ok.isMaintenance)
    }

    func testSystemImageNamePerMode() {
        XCTAssertEqual(MaintenanceBannerServiceMode.maintenance.systemImageName, "wrench.and.screwdriver.fill")
        XCTAssertEqual(MaintenanceBannerServiceMode.degraded.systemImageName, "exclamationmark.triangle.fill")
        XCTAssertEqual(MaintenanceBannerServiceMode.ok.systemImageName, "checkmark.circle.fill")
    }
}

// MARK: - Fingerprint (web `fingerprint(...)`)

final class MaintenanceFingerprintTests: XCTestCase {
    func testUsesUpdatedAtWhenPresent() {
        let key = MaintenanceBannerFingerprint.make(
            mode: "maintenance",
            message: "hi",
            until: "2026-06-13T05:00:00Z",
            updatedAt: "2026-06-13T04:00:00Z"
        )
        XCTAssertEqual(key, "u:2026-06-13T04:00:00Z")
    }

    func testFallsBackToCompositeWhenUpdatedAtEmpty() {
        let key = MaintenanceBannerFingerprint.make(
            mode: "degraded",
            message: "slow",
            until: "2026-06-13T05:00:00Z",
            updatedAt: ""
        )
        XCTAssertEqual(key, "s:degraded|slow|2026-06-13T05:00:00Z")
    }

    func testCompositeDistinguishesSnapshots() {
        let first = MaintenanceBannerFingerprint.make(mode: "degraded", message: "a", until: "", updatedAt: "")
        let second = MaintenanceBannerFingerprint.make(mode: "degraded", message: "b", until: "", updatedAt: "")
        XCTAssertNotEqual(first, second)
    }
}

// MARK: - Instant parsing (web `Date.parse(until)`)

final class MaintenanceBannerInstantTests: XCTestCase {
    func testParsesPlainRFC3339() {
        XCTAssertEqual(MaintenanceBannerInstant.parseMs("1970-01-01T00:00:01Z"), 1000)
    }

    func testParsesEpochZero() {
        XCTAssertEqual(MaintenanceBannerInstant.parseMs("1970-01-01T00:00:00Z"), 0)
    }

    func testParsesFractionalSeconds() {
        XCTAssertEqual(MaintenanceBannerInstant.parseMs("1970-01-01T00:00:00.500Z"), 500)
    }

    func testParsesNumericOffset() {
        // 01:00:00 at +01:00 is the same instant as 00:00:00Z → 0 ms.
        XCTAssertEqual(MaintenanceBannerInstant.parseMs("1970-01-01T01:00:00+01:00"), 0)
    }

    func testEmptyAndJunkReturnNil() {
        XCTAssertNil(MaintenanceBannerInstant.parseMs(""))
        XCTAssertNil(MaintenanceBannerInstant.parseMs("   "))
        XCTAssertNil(MaintenanceBannerInstant.parseMs("not-a-date"))
    }
}

// MARK: - Remaining classification (web countdown if-ladder)

final class MaintenanceRemainingTests: XCTestCase {
    func testUpcomingAboveOneSecond() {
        XCTAssertEqual(MaintenanceBannerRemaining.classify(remainingMs: 2000), .upcoming)
        XCTAssertEqual(MaintenanceBannerRemaining.classify(remainingMs: 1001), .upcoming)
    }

    func testEndingNowWithinThreshold() {
        XCTAssertEqual(MaintenanceBannerRemaining.classify(remainingMs: 1000), .endingNow)
        XCTAssertEqual(MaintenanceBannerRemaining.classify(remainingMs: 0), .endingNow)
        XCTAssertEqual(MaintenanceBannerRemaining.classify(remainingMs: -999), .endingNow)
    }

    func testEndedBelowNegativeThreshold() {
        XCTAssertEqual(MaintenanceBannerRemaining.classify(remainingMs: -1000), .ended)
        XCTAssertEqual(MaintenanceBannerRemaining.classify(remainingMs: -5000), .ended)
    }
}

// MARK: - Duration short-form (web `formatRemaining`)

final class MaintenanceDurationTests: XCTestCase {
    func testHoursForm() {
        // 2h 17m 33s → "2h 17m"
        let ms = Double((2 * 3600 + 17 * 60 + 33) * 1000)
        XCTAssertEqual(MaintenanceBannerDuration.format(ms: ms), "2h 17m")
    }

    func testHoursPadsMinutes() {
        // 1h 05m → minutes zero-padded.
        let ms = Double((3600 + 5 * 60) * 1000)
        XCTAssertEqual(MaintenanceBannerDuration.format(ms: ms), "1h 05m")
    }

    func testMinutesForm() {
        // 5m 09s → seconds zero-padded.
        let ms = Double((5 * 60 + 9) * 1000)
        XCTAssertEqual(MaintenanceBannerDuration.format(ms: ms), "5m 09s")
    }

    func testSecondsForm() {
        XCTAssertEqual(MaintenanceBannerDuration.format(ms: 42000), "42s")
    }

    func testClampsNegativeAndZeroToZeroSeconds() {
        XCTAssertEqual(MaintenanceBannerDuration.format(ms: 0), "0s")
        XCTAssertEqual(MaintenanceBannerDuration.format(ms: -5000), "0s")
    }
}

// MARK: - Interpolation (web i18next `{{token}}`)

final class MaintenanceInterpolationTests: XCTestCase {
    func testReplacesToken() {
        XCTAssertEqual(
            MaintenanceBannerInterpolation.apply("Ends in {{time}}", ["time": "2h 17m"]),
            "Ends in 2h 17m"
        )
    }

    func testReplacesEveryOccurrence() {
        XCTAssertEqual(MaintenanceBannerInterpolation.apply("{{x}}-{{x}}", ["x": "1"]), "1-1")
    }

    func testLeavesTemplateWhenNoToken() {
        XCTAssertEqual(MaintenanceBannerInterpolation.apply("Ending now", ["time": "x"]), "Ending now")
    }
}

// MARK: - Copy (web `t('serviceMode.banner.*', …)`)

final class MaintenanceMessageTests: XCTestCase {
    func testTitleBranches() {
        XCTAssertEqual(
            MaintenanceBannerMessage.title(isMaintenance: true, strings: fallbackStrings),
            "Scheduled maintenance"
        )
        XCTAssertEqual(
            MaintenanceBannerMessage.title(isMaintenance: false, strings: fallbackStrings),
            "Service is degraded"
        )
    }

    func testBodyUsesTrimmedMessageWhenPresent() {
        XCTAssertEqual(
            MaintenanceBannerMessage.body(isMaintenance: true, message: "  Upgrading.  ", strings: fallbackStrings),
            "Upgrading."
        )
    }

    func testBodyFallsBackToDefaultMaintenance() {
        XCTAssertEqual(
            MaintenanceBannerMessage.body(isMaintenance: true, message: "   ", strings: fallbackStrings),
            defaultMaintenance
        )
    }

    func testBodyFallsBackToDefaultDegraded() {
        XCTAssertEqual(
            MaintenanceBannerMessage.body(isMaintenance: false, message: "", strings: fallbackStrings),
            defaultDegraded
        )
    }

    func testCountdownUpcomingInterpolatesShortForm() {
        let ms = Double(3600 + 60) * 1000 // 1h 01m
        XCTAssertEqual(
            MaintenanceBannerMessage.countdown(remainingMs: ms, strings: fallbackStrings),
            "Ends in 1h 01m"
        )
    }

    func testCountdownEndingNow() {
        XCTAssertEqual(MaintenanceBannerMessage.countdown(remainingMs: 0, strings: fallbackStrings), "Ending now")
    }

    func testCountdownEnded() {
        XCTAssertEqual(
            MaintenanceBannerMessage.countdown(remainingMs: -5000, strings: fallbackStrings),
            "Window has ended; refresh to confirm."
        )
    }

    func testDismissLabel() {
        XCTAssertEqual(MaintenanceBannerMessage.dismiss(strings: fallbackStrings), "Dismiss")
    }
}

// MARK: - Accessibility (combined VoiceOver label)

final class MaintenanceBannerAccessibilityTests: XCTestCase {
    func testJoinsTitleBodyCountdown() {
        let label = MaintenanceBannerAccessibility.bannerLabel(
            title: "Scheduled maintenance",
            body: "Upgrading.",
            countdown: "Ends in 2h 17m"
        )
        XCTAssertEqual(label, "Scheduled maintenance. Upgrading.. Ends in 2h 17m")
    }

    func testOmitsCountdownWhenNil() {
        let label = MaintenanceBannerAccessibility.bannerLabel(
            title: "Service is degraded",
            body: "Slow.",
            countdown: nil
        )
        XCTAssertEqual(label, "Service is degraded. Slow.")
    }

    func testCollapsesWhitespaceAndDropsEmptyParts() {
        let label = MaintenanceBannerAccessibility.bannerLabel(
            title: "  Scheduled   maintenance ",
            body: "",
            countdown: "  Ending now "
        )
        XCTAssertEqual(label, "Scheduled maintenance. Ending now")
    }
}

// MARK: - Input derivations

final class MaintenanceInputTests: XCTestCase {
    func testServiceModeAndActiveBanner() {
        let ok = MaintenanceBannerInput(mode: "ok", hasData: true)
        XCTAssertEqual(ok.serviceMode, .ok)
        XCTAssertFalse(ok.hasActiveBanner)

        let banner = MaintenanceBannerInput(mode: "maintenance", hasData: true)
        XCTAssertEqual(banner.serviceMode, .maintenance)
        XCTAssertTrue(banner.hasActiveBanner)

        let notLoaded = MaintenanceBannerInput(mode: "maintenance", hasData: false)
        XCTAssertFalse(notLoaded.hasActiveBanner) // no payload yet → not active
    }

    func testFingerprintMatchesAdapter() {
        let input = MaintenanceBannerInput(mode: "degraded", message: "slow", until: "u", updatedAt: "")
        XCTAssertEqual(input.fingerprint, "s:degraded|slow|u")
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

final class MaintenanceProjectionTests: XCTestCase {
    private func resolve(_ input: MaintenanceBannerInput, dismissedKey: String? = nil) -> MaintenanceBannerResolved {
        MaintenanceBannerProjection.resolve(input: input, dismissedKey: dismissedKey, strings: fallbackStrings)
    }

    func testNoPayloadIsLoading() {
        XCTAssertEqual(resolve(MaintenanceBannerInput()).phase, .loading)
    }

    func testNoPayloadWithErrorIsError() {
        let resolved = resolve(MaintenanceBannerInput(errorMessage: "down"))
        XCTAssertEqual(resolved.phase, .error("down"))
        XCTAssertNil(resolved.data)
    }

    func testModeOkIsEmpty() {
        XCTAssertEqual(resolve(MaintenanceBannerInput(mode: "ok", hasData: true)).phase, .empty)
    }

    func testActiveMaintenanceIsBannerWithPayload() {
        let input = MaintenanceBannerInput(
            mode: "maintenance",
            message: "Upgrading.",
            until: "1970-01-01T00:00:10Z",
            updatedAt: "2026-06-13T04:00:00Z",
            hasData: true
        )
        let resolved = resolve(input)
        XCTAssertEqual(resolved.phase, .banner)
        guard let data = resolved.data else {
            return XCTFail("expected a banner payload")
        }
        XCTAssertEqual(data.mode, .maintenance)
        XCTAssertTrue(data.isMaintenance)
        XCTAssertEqual(data.title, "Scheduled maintenance")
        XCTAssertEqual(data.body, "Upgrading.")
        XCTAssertEqual(data.fingerprint, "u:2026-06-13T04:00:00Z")
        XCTAssertEqual(data.untilMs, 10000)
        XCTAssertEqual(data.systemImageName, "wrench.and.screwdriver.fill")
    }

    func testActiveDegradedPayload() {
        let resolved = resolve(MaintenanceBannerInput(mode: "degraded", updatedAt: "x", hasData: true))
        XCTAssertEqual(resolved.phase, .banner)
        XCTAssertEqual(resolved.data?.isMaintenance, false)
        XCTAssertEqual(resolved.data?.body, defaultDegraded)
        XCTAssertEqual(resolved.data?.systemImageName, "exclamationmark.triangle.fill")
        XCTAssertNil(resolved.data?.untilMs) // no `until` → no countdown
    }

    func testDismissedSnapshotIsEmpty() {
        let input = MaintenanceBannerInput(mode: "maintenance", updatedAt: "2026-06-13T04:00:00Z", hasData: true)
        XCTAssertEqual(resolve(input, dismissedKey: input.fingerprint).phase, .empty)
    }

    func testDismissalForADifferentSnapshotStillShowsBanner() {
        let input = MaintenanceBannerInput(mode: "maintenance", updatedAt: "2026-06-13T04:00:00Z", hasData: true)
        XCTAssertEqual(resolve(input, dismissedKey: "u:some-older-instant").phase, .banner)
    }

    func testActiveBannerSurvivesBackgroundError() {
        // hasData == true with a background error → data still governs (P4 leaf contract), not `.error`.
        let input = MaintenanceBannerInput(
            mode: "maintenance",
            updatedAt: "x",
            hasData: true,
            errorMessage: "refetch failed"
        )
        XCTAssertEqual(resolve(input).phase, .banner)
    }

    func testModeOkSurvivesBackgroundErrorAsEmpty() {
        let input = MaintenanceBannerInput(mode: "ok", hasData: true, errorMessage: "refetch failed")
        XCTAssertEqual(resolve(input).phase, .empty)
    }
}
