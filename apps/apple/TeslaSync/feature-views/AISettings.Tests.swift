//
//  AISettings.Tests.swift
//  TeslaSync — P4 feature view · 0202 · AISettings (Apple)
//
//  Unit coverage for the AISettings surface:
//    • Adapter — the `AiMode` parse, the mode catalogue, the `toFixed(2)` dollar
//      formatter, and the cost-cap arithmetic (pct / level thresholds / dollar
//      conversions) ported from the web `AICostCapSpendBar`.
//    • State holder — `AiSettingsProjection` across loading / empty / error / data,
//      plus the `AiSettingsModel` wiring: the P1/S11 `view.opened` telemetry, the
//      draft hydration + preservation, the mode-gated banners, the save lifecycle,
//      and the stale auto-refresh transition.
//    • Accessibility — the cost-cap spoken value content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryAiSettingsSource`, and the locale is
//  injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US_POSIX")

// MARK: - AiMode (web `isAiMode` parse + canonical set)

@MainActor final class AiModeTests: XCTestCase {
    func testParseCanonicalValues() {
        XCTAssertEqual(AiMode.parse("off"), .off)
        XCTAssertEqual(AiMode.parse("local"), .local)
        XCTAssertEqual(AiMode.parse("cloud"), .cloud)
    }

    func testParseUnknownOrNilFallsBackToOff() {
        XCTAssertEqual(AiMode.parse(nil), .off)
        XCTAssertEqual(AiMode.parse(""), .off)
        XCTAssertEqual(AiMode.parse("legacy"), .off)
    }

    func testCanonicalOrder() {
        XCTAssertEqual(AiMode.allCases, [.off, .local, .cloud])
    }
}

// MARK: - Mode catalogue (web `<ModeRadio>` × 3)

@MainActor final class AiModeCatalogTests: XCTestCase {
    func testOrderMatchesWebSource() {
        XCTAssertEqual(AiModeCatalog.options.map(\.mode), [.off, .local, .cloud])
    }

    func testKeysAndFallbacksMatchSource() {
        let off = AiModeCatalog.option(for: .off)
        XCTAssertEqual(off.labelKey, "ai.settings.mode.off")
        XCTAssertEqual(off.labelFallback, "Off (default)")
        XCTAssertEqual(off.hintFallback, "No Helix features. The app works fully without them.")

        let cloud = AiModeCatalog.option(for: .cloud)
        XCTAssertEqual(cloud.labelKey, "ai.settings.mode.cloud")
        XCTAssertEqual(cloud.labelFallback, "Cloud")
        XCTAssertEqual(cloud.hintFallback, "Use a cloud provider (e.g. OpenAI). Requires an API key.")

        let local = AiModeCatalog.option(for: .local)
        XCTAssertEqual(local.labelFallback, "Local-only")
    }
}

// MARK: - Dollar formatting (port of web `toFixed(2)`)

@MainActor final class HelixFormatTests: XCTestCase {
    func testFixedTwoFractionDigits() {
        XCTAssertEqual(HelixFormat.fixed2(2, locale: enUS), "2.00")
        XCTAssertEqual(HelixFormat.fixed2(4.5, locale: enUS), "4.50")
        XCTAssertEqual(HelixFormat.fixed2(0, locale: enUS), "0.00")
    }

    func testRoundsHalfAway() {
        XCTAssertEqual(HelixFormat.fixed2(12.349, locale: enUS), "12.35")
        XCTAssertEqual(HelixFormat.fixed2(1.20, locale: enUS), "1.20")
    }

    func testNonFiniteCoercesToZero() {
        XCTAssertEqual(HelixFormat.fixed2(.nan, locale: enUS), "0.00")
        XCTAssertEqual(HelixFormat.fixed2(.infinity, locale: enUS), "0.00")
    }
}

// MARK: - Cost-cap math (port of `AICostCapSpendBar`)

@MainActor final class HelixCostCapTests: XCTestCase {
    func testInformationalBelowEightyPercent() {
        let cap = HelixCostCap.compute(todayMicroCents: 2_000_000, capCents: 500)
        XCTAssertEqual(cap.percent, 40, accuracy: 1e-9)
        XCTAssertEqual(cap.level, .ok)
        XCTAssertEqual(cap.todayDollars, 2.0, accuracy: 1e-9)
        XCTAssertEqual(cap.capDollars, 5.0, accuracy: 1e-9)
    }

    func testWarnAtEightyPercent() {
        let cap = HelixCostCap.compute(todayMicroCents: 4_000_000, capCents: 500)
        XCTAssertEqual(cap.percent, 80, accuracy: 1e-9)
        XCTAssertEqual(cap.level, .warn)
    }

    func testCriticalAtOneHundredPercent() {
        let cap = HelixCostCap.compute(todayMicroCents: 5_000_000, capCents: 500)
        XCTAssertEqual(cap.percent, 100, accuracy: 1e-9)
        XCTAssertEqual(cap.level, .critical)
    }

    func testPercentClampsAtOneHundred() {
        let cap = HelixCostCap.compute(todayMicroCents: 9_000_000, capCents: 500)
        XCTAssertEqual(cap.percent, 100, accuracy: 1e-9)
        XCTAssertEqual(cap.level, .critical)
    }

    func testZeroCapYieldsNoFill() {
        let cap = HelixCostCap.compute(todayMicroCents: 1_000_000, capCents: 0)
        XCTAssertEqual(cap.percent, 0, accuracy: 1e-9)
        XCTAssertEqual(cap.level, .ok)
        XCTAssertEqual(cap.capDollars, 0, accuracy: 1e-9)
    }

    func testNonFiniteSpendTreatedAsZero() {
        let cap = HelixCostCap.compute(todayMicroCents: .nan, capCents: 500)
        XCTAssertEqual(cap.todayDollars, 0, accuracy: 1e-9)
        XCTAssertEqual(cap.percent, 0, accuracy: 1e-9)
    }

    func testAmountPartsFormatBothDollars() {
        let cap = HelixCostCap.compute(todayMicroCents: 2_000_000, capCents: 500)
        let parts = cap.amountParts(locale: enUS)
        XCTAssertEqual(parts.spent, "2.00")
        XCTAssertEqual(parts.cap, "5.00")
    }
}

// MARK: - Projection (web render gate + P4 leaf contract)

@MainActor final class AiSettingsProjectionTests: XCTestCase {
    func testErrorTakesPrecedence() {
        let resolved = AiSettingsProjection.resolve(
            AiSettingsInput(savedMode: .cloud, isLoading: true, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testLoadingWhenFlagged() {
        XCTAssertEqual(AiSettingsProjection.resolve(AiSettingsInput(isLoading: true)).phase, .loading)
    }

    func testEmptyWhenResolvedWithoutPayload() {
        XCTAssertEqual(AiSettingsProjection.resolve(AiSettingsInput(savedMode: nil)).phase, .empty)
    }

    func testDataWhenSettingsPresent() {
        let resolved = AiSettingsProjection.resolve(AiSettingsInput(savedMode: .local))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.savedMode, .local)
    }

    func testNegativeCapClampsToZero() {
        let resolved = AiSettingsProjection.resolve(AiSettingsInput(savedMode: .cloud, costCapCents: -5))
        XCTAssertEqual(resolved.costCapCents, 0)
    }
}

// MARK: - State holder: wiring, telemetry, draft, save, freshness

@MainActor final class AiSettingsModelTests: XCTestCase {
    private func makeModel(
        _ input: AiSettingsInput,
        saveOutcome: AiSaveOutcome? = nil,
        telemetry: AiSettingsTelemetry = OSLogAiSettingsTelemetry()
    ) -> (AiSettingsModel, InMemoryAiSettingsSource) {
        let source = InMemoryAiSettingsSource(initial: input, saveOutcome: saveOutcome)
        let model = AiSettingsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartEmitsTelemetryOnceAndAppliesInitial() {
        let spy = SpyAiSettingsTelemetry()
        let (model, source) = makeModel(AiSettingsInput(savedMode: .cloud), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(spy.surfaces, [AISettings.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testHydratesSelectedModeFromSavedMode() {
        let (model, _) = makeModel(AiSettingsInput(savedMode: .cloud))
        model.start()
        XCTAssertEqual(model.selectedMode, .cloud)
        XCTAssertFalse(model.isDirty)
    }

    func testHydrationIsOneShotAndPreservesUserDraft() {
        let (model, source) = makeModel(AiSettingsInput(savedMode: .cloud))
        model.start()
        model.selectMode(.off)
        XCTAssertTrue(model.isDirty)
        // A later refresh that re-delivers the persisted mode must NOT clobber the draft.
        source.push(AiSettingsInput(savedMode: .cloud))
        XCTAssertEqual(model.selectedMode, .off)
    }

    func testLoadingThenDataHydrates() {
        let (model, source) = makeModel(AiSettingsInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        XCTAssertEqual(model.selectedMode, .off)
        source.push(AiSettingsInput(savedMode: .local))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.selectedMode, .local)
    }

    func testSelectModeUpdatesDraftAndIgnoresNoOp() {
        let (model, _) = makeModel(AiSettingsInput(savedMode: .off))
        model.start()
        model.selectMode(.local)
        XCTAssertEqual(model.selectedMode, .local)
        XCTAssertTrue(model.isDirty)
        model.selectMode(.local)
        XCTAssertEqual(model.selectedMode, .local)
    }

    func testOffBannerGating() {
        let (model, _) = makeModel(AiSettingsInput(savedMode: .off))
        model.start()
        XCTAssertTrue(model.showsOffBanner)
        model.selectMode(.cloud)
        XCTAssertFalse(model.showsOffBanner)
    }

    func testCostCapBarGating() {
        let (model, _) = makeModel(AiSettingsInput(savedMode: .cloud, costCapCents: 500))
        model.start()
        XCTAssertTrue(model.showsCostCapBar)
        model.selectMode(.local)
        XCTAssertFalse(model.showsCostCapBar)
    }

    func testCostCapBarHiddenWhenCapZero() {
        let (model, _) = makeModel(AiSettingsInput(savedMode: .cloud, costCapCents: 0))
        model.start()
        XCTAssertFalse(model.showsCostCapBar)
    }

    func testDerivedCostCapLevel() {
        let (model, _) = makeModel(
            AiSettingsInput(savedMode: .cloud, costCapCents: 500, todayMicroCents: 4_500_000)
        )
        model.start()
        XCTAssertEqual(model.costCap.level, .warn)
    }

    func testSaveSuccessFlow() {
        let (model, source) = makeModel(AiSettingsInput(savedMode: .off), saveOutcome: .saved)
        model.start()
        model.selectMode(.local)
        model.save()
        XCTAssertEqual(model.savePhase, .saved)
        XCTAssertEqual(source.saveCount, 1)
        XCTAssertEqual(source.lastSavedDraft, AiSettingsDraft(mode: .local))
    }

    func testSaveFailureFlow() {
        let (model, _) = makeModel(AiSettingsInput(savedMode: .off), saveOutcome: .failed("nope"))
        model.start()
        model.save()
        XCTAssertEqual(model.savePhase, .failed("nope"))
    }

    func testSaveIsReentrancyGuarded() {
        // No canned outcome → the model stays `.saving`, so a second tap is dropped.
        let (model, source) = makeModel(AiSettingsInput(savedMode: .cloud))
        model.start()
        model.save()
        XCTAssertTrue(model.savePhase.isSaving)
        model.save()
        XCTAssertEqual(source.saveCount, 1)
    }

    func testSelectingModeClearsFailedSave() {
        let (model, _) = makeModel(AiSettingsInput(savedMode: .off), saveOutcome: .failed("nope"))
        model.start()
        model.save()
        XCTAssertEqual(model.savePhase, .failed("nope"))
        model.selectMode(.cloud)
        XCTAssertEqual(model.savePhase, .idle)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(AiSettingsInput(savedMode: .off))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(AiSettingsInput(savedMode: .cloud))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(AiSettingsInput(savedMode: .cloud, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(AiSettingsInput(savedMode: .cloud, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(AiSettingsInput(savedMode: .cloud))
        model.start()
        source.push(AiSettingsInput(savedMode: .cloud, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(AiSettingsInput(savedMode: .off))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(AISettings.surfaceSlug, "AISettings")
    }
}

// MARK: - Accessibility summary content

@MainActor final class AiSettingsAccessibilityTests: XCTestCase {
    func testCostCapValueJoinsParts() {
        XCTAssertEqual(
            AiSettingsAccessibility.costCapValue(spent: "$2.00", cap: "$5.00", percent: 40),
            "$2.00 / $5.00, 40%"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyAiSettingsTelemetry: AiSettingsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
