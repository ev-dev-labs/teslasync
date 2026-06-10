//
//  AiLimitBanner.Tests.swift
//  TeslaSync — P4 shared surface · 0025 · AiLimitBanner (Apple)
//
//  Adapter + projection coverage for the AiLimitBanner surface:
//    • Severity — the web `bannerLevel` → variant mapping (critical → danger, warn → warning,
//      else → info) and the per-severity SF Symbol.
//    • Reason taxonomy — the verbatim port of the web `titleForReason` / `descriptionForReason`
//      switch tables, including the token aliases and the unknown → generic fallback.
//    • Countdown — the web `secondsLeft` arithmetic (initial / tick / retryReady) and the
//      "Try again in Ns" interpolation.
//    • Projection — the render branches plus the P4 leaf contract across loading / empty / error /
//      data, including the affordance gating (baseline / retry / dismiss).
//    • Accessibility — the composed VoiceOver banner label.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure adapter / projection directly.
//

import XCTest
@testable import TeslaSync

private func info(
    _ reason: String,
    retryAfterS: Int = 0,
    bannerLevel: String = "",
    baselineAvailable: Bool = true
) -> AiLimitInfo {
    AiLimitInfo(
        reason: reason,
        retryAfterS: retryAfterS,
        bannerLevel: bannerLevel,
        baselineAvailable: baselineAvailable,
        message: "test message"
    )
}

// MARK: - Severity (web variant ternary)

final class AiLimitSeverityTests: XCTestCase {
    func testBannerLevelMapsToVariant() {
        XCTAssertEqual(AiLimitSeverity.forBannerLevel("critical"), .danger)
        XCTAssertEqual(AiLimitSeverity.forBannerLevel("warn"), .warning)
        XCTAssertEqual(AiLimitSeverity.forBannerLevel(""), .info)
    }

    func testUnknownBannerLevelFallsBackToInfo() {
        XCTAssertEqual(AiLimitSeverity.forBannerLevel("something-new"), .info)
        XCTAssertEqual(AiLimitSeverity.forBannerLevel("WARN"), .info) // case-sensitive, web parity
    }

    func testEachSeverityHasADistinctSymbol() {
        let symbols = Set(AiLimitSeverity.allCases.map(\.systemImageName))
        XCTAssertEqual(symbols.count, AiLimitSeverity.allCases.count)
        XCTAssertFalse(symbols.contains(""))
    }
}

// MARK: - Reason taxonomy (web `titleForReason` / `descriptionForReason`)

final class AiLimitReasonCopyTests: XCTestCase {
    func testKnownReasonsMapToTheirTitleKeys() {
        XCTAssertEqual(AiLimitReasonCopy.copy(for: "cost_cap").titleKey, "ai.limit.title.costCap")
        XCTAssertEqual(
            AiLimitReasonCopy.copy(for: "cost_cap_unavailable").titleKey,
            "ai.limit.title.costCapUnavailable"
        )
        XCTAssertEqual(
            AiLimitReasonCopy.copy(for: "settings_unavailable").titleKey,
            "ai.limit.title.settingsUnavailable"
        )
        XCTAssertEqual(AiLimitReasonCopy.copy(for: "burst").titleKey, "ai.limit.title.burst")
        XCTAssertEqual(AiLimitReasonCopy.copy(for: "per_minute").titleKey, "ai.limit.title.perMinute")
        XCTAssertEqual(AiLimitReasonCopy.copy(for: "per_day").titleKey, "ai.limit.title.perDay")
        XCTAssertEqual(
            AiLimitReasonCopy.copy(for: "provider_unavailable").titleKey,
            "ai.limit.title.providerUnavailable"
        )
    }

    func testTokenReasonsShareTheTokenCopy() {
        let input = AiLimitReasonCopy.copy(for: "input_tokens")
        let output = AiLimitReasonCopy.copy(for: "output_tokens")
        XCTAssertEqual(input, output)
        XCTAssertEqual(input.titleKey, "ai.limit.title.tokens")
        XCTAssertEqual(input.titleFallback, "Helix token quota exhausted")
    }

    func testFeatureMisconfigurationReasonsShareCopy() {
        let missing = AiLimitReasonCopy.copy(for: "missing_feature_id")
        let unknown = AiLimitReasonCopy.copy(for: "unknown_feature_id")
        XCTAssertEqual(missing, unknown)
        XCTAssertEqual(missing.titleKey, "ai.limit.title.featureMisconfigured")
    }

    func testUnknownReasonFallsBackToGeneric() {
        let copy = AiLimitReasonCopy.copy(for: "brand_new_backend_reason")
        XCTAssertEqual(copy.titleKey, "ai.limit.title.generic")
        XCTAssertEqual(copy.titleFallback, "Helix temporarily unavailable")
        XCTAssertEqual(copy.descriptionKey, "ai.limit.desc.generic")
    }

    func testEmptyReasonFallsBackToGeneric() {
        XCTAssertEqual(AiLimitReasonCopy.copy(for: "").titleKey, "ai.limit.title.generic")
    }

    func testDescriptionFallbacksMatchWebCopy() {
        XCTAssertEqual(
            AiLimitReasonCopy.copy(for: "cost_cap").descriptionFallback,
            "You have reached your daily Helix cost limit. Helix features will resume tomorrow or "
                + "after you raise the cap in Settings."
        )
        XCTAssertEqual(
            AiLimitReasonCopy.copy(for: "per_day").descriptionFallback,
            "You have used your daily Helix request budget. The budget resets at UTC midnight."
        )
    }

    func testEveryTitleAndDescriptionKeyIsNonEmptyAndDistinctRole() {
        let reasons = [
            "cost_cap", "cost_cap_unavailable", "settings_unavailable", "burst", "per_minute",
            "per_day", "input_tokens", "output_tokens", "provider_unavailable",
            "missing_feature_id", "unknown_feature_id", "other"
        ]
        for reason in reasons {
            let copy = AiLimitReasonCopy.copy(for: reason)
            XCTAssertTrue(copy.titleKey.hasPrefix("ai.limit.title."))
            XCTAssertTrue(copy.descriptionKey.hasPrefix("ai.limit.desc."))
            XCTAssertFalse(copy.titleFallback.isEmpty)
            XCTAssertFalse(copy.descriptionFallback.isEmpty)
        }
    }
}

// MARK: - Countdown (web `secondsLeft`)

final class AiLimitCountdownTests: XCTestCase {
    func testInitialClampsNegativeToZero() {
        XCTAssertEqual(AiLimitCountdown.initial(retryAfterS: 30), 30)
        XCTAssertEqual(AiLimitCountdown.initial(retryAfterS: 0), 0)
        XCTAssertEqual(AiLimitCountdown.initial(retryAfterS: -5), 0)
    }

    func testTickDecrementsAndFloorsAtZero() {
        XCTAssertEqual(AiLimitCountdown.tick(3), 2)
        XCTAssertEqual(AiLimitCountdown.tick(1), 0)
        XCTAssertEqual(AiLimitCountdown.tick(0), 0)
        XCTAssertEqual(AiLimitCountdown.tick(-2), 0)
    }

    func testRetryReadyOnlyAtZeroOrBelow() {
        XCTAssertFalse(AiLimitCountdown.isRetryReady(secondsLeft: 5))
        XCTAssertTrue(AiLimitCountdown.isRetryReady(secondsLeft: 0))
        XCTAssertTrue(AiLimitCountdown.isRetryReady(secondsLeft: -1))
    }

    func testRetryInTextSubstitutesSeconds() {
        XCTAssertEqual(
            AiLimitCountdown.retryInText(seconds: 12, template: "Try again in {seconds}s"),
            "Try again in 12s"
        )
        XCTAssertEqual(
            AiLimitCountdown.retryInText(seconds: 0, template: "Try again in {seconds}s"),
            "Try again in 0s"
        )
    }

    func testRetryInTextClampsNegativeSeconds() {
        XCTAssertEqual(
            AiLimitCountdown.retryInText(seconds: -3, template: "{seconds}s left"),
            "0s left"
        )
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class AiLimitBannerProjectionTests: XCTestCase {
    private let allCaps = AiLimitBannerCapabilities(canRetry: true, canUseBaseline: true, canDismiss: true)

    func testErrorTakesPrecedenceOverEverything() {
        let resolved = AiLimitBannerProjection.resolve(
            input: AiLimitBannerInput(info: info("cost_cap"), isLoading: true, errorMessage: "boom"),
            secondsLeft: 0,
            capabilities: allCaps
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.data)
    }

    func testEmptyErrorMessageDoesNotForceErrorPhase() {
        let resolved = AiLimitBannerProjection.resolve(
            input: AiLimitBannerInput(info: info("burst"), errorMessage: ""),
            secondsLeft: 0,
            capabilities: allCaps
        )
        XCTAssertEqual(resolved.phase, .data)
    }

    func testLoadingWhenFlaggedAndNoError() {
        let resolved = AiLimitBannerProjection.resolve(
            input: AiLimitBannerInput(isLoading: true),
            secondsLeft: 0,
            capabilities: allCaps
        )
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyWhenNoInfo() {
        let resolved = AiLimitBannerProjection.resolve(
            input: AiLimitBannerInput(),
            secondsLeft: 0,
            capabilities: allCaps
        )
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertNil(resolved.data)
    }

    func testDataDerivesSeverityCopyAndCountdown() throws {
        let resolved = AiLimitBannerProjection.resolve(
            input: AiLimitBannerInput(info: info("per_minute", retryAfterS: 30, bannerLevel: "warn")),
            secondsLeft: 18,
            capabilities: allCaps
        )
        XCTAssertEqual(resolved.phase, .data)
        let data = try XCTUnwrap(resolved.data)
        XCTAssertEqual(data.reason, "per_minute")
        XCTAssertEqual(data.severity, .warning)
        XCTAssertEqual(data.copy.titleKey, "ai.limit.title.perMinute")
        XCTAssertEqual(data.secondsLeft, 18)
        XCTAssertFalse(data.retryReady)
    }

    func testDataClampsNegativeSecondsAndMarksRetryReady() throws {
        let resolved = AiLimitBannerProjection.resolve(
            input: AiLimitBannerInput(info: info("cost_cap", bannerLevel: "critical")),
            secondsLeft: -4,
            capabilities: allCaps
        )
        let data = try XCTUnwrap(resolved.data)
        XCTAssertEqual(data.secondsLeft, 0)
        XCTAssertTrue(data.retryReady)
        XCTAssertEqual(data.severity, .danger)
    }

    func testRetryShownOnlyWhenReadyAndCapable() {
        // Counting down → retry hidden even though capable.
        let counting = AiLimitBannerProjection.resolve(
            input: AiLimitBannerInput(info: info("per_minute", retryAfterS: 30)),
            secondsLeft: 10,
            capabilities: allCaps
        ).data
        XCTAssertEqual(counting?.showRetry, false)

        // Ready + capable → retry shown.
        let ready = AiLimitBannerProjection.resolve(
            input: AiLimitBannerInput(info: info("per_minute")),
            secondsLeft: 0,
            capabilities: allCaps
        ).data
        XCTAssertEqual(ready?.showRetry, true)

        // Ready but no handler → retry hidden.
        let noHandler = AiLimitBannerProjection.resolve(
            input: AiLimitBannerInput(info: info("per_minute")),
            secondsLeft: 0,
            capabilities: AiLimitBannerCapabilities(canRetry: false, canUseBaseline: true, canDismiss: true)
        ).data
        XCTAssertEqual(noHandler?.showRetry, false)
    }

    func testBaselineShownOnlyWhenAvailableAndCapable() {
        let available = AiLimitBannerProjection.resolve(
            input: AiLimitBannerInput(info: info("cost_cap", baselineAvailable: true)),
            secondsLeft: 0,
            capabilities: allCaps
        ).data
        XCTAssertEqual(available?.showBaseline, true)

        let unavailable = AiLimitBannerProjection.resolve(
            input: AiLimitBannerInput(info: info("cost_cap", baselineAvailable: false)),
            secondsLeft: 0,
            capabilities: allCaps
        ).data
        XCTAssertEqual(unavailable?.showBaseline, false)

        let noHandler = AiLimitBannerProjection.resolve(
            input: AiLimitBannerInput(info: info("cost_cap", baselineAvailable: true)),
            secondsLeft: 0,
            capabilities: AiLimitBannerCapabilities(canRetry: true, canUseBaseline: false, canDismiss: true)
        ).data
        XCTAssertEqual(noHandler?.showBaseline, false)
    }

    func testDismissShownOnlyWhenCapable() {
        let withDismiss = AiLimitBannerProjection.resolve(
            input: AiLimitBannerInput(info: info("burst")),
            secondsLeft: 0,
            capabilities: AiLimitBannerCapabilities(canRetry: false, canUseBaseline: false, canDismiss: true)
        ).data
        XCTAssertEqual(withDismiss?.showDismiss, true)

        let withoutDismiss = AiLimitBannerProjection.resolve(
            input: AiLimitBannerInput(info: info("burst")),
            secondsLeft: 0,
            capabilities: AiLimitBannerCapabilities(canRetry: false, canUseBaseline: false, canDismiss: false)
        ).data
        XCTAssertEqual(withoutDismiss?.showDismiss, false)
    }
}

// MARK: - Accessibility

final class AiLimitBannerAccessibilityTests: XCTestCase {
    func testBannerLabelReadsTitleThenDescription() {
        let label = AiLimitBannerAccessibility.bannerLabel(
            title: "Daily cost cap reached",
            description: "You have reached your daily Helix cost limit.",
            countdown: nil
        )
        XCTAssertEqual(label, "Daily cost cap reached. You have reached your daily Helix cost limit.")
    }

    func testBannerLabelAppendsCountdownWhenPresent() {
        let label = AiLimitBannerAccessibility.bannerLabel(
            title: "Helix rate limit hit",
            description: "The window resets shortly.",
            countdown: "Try again in 12s"
        )
        XCTAssertEqual(label, "Helix rate limit hit. The window resets shortly. Try again in 12s")
    }

    func testBannerLabelIgnoresEmptyCountdown() {
        let label = AiLimitBannerAccessibility.bannerLabel(
            title: "A",
            description: "B",
            countdown: ""
        )
        XCTAssertEqual(label, "A. B")
    }
}
