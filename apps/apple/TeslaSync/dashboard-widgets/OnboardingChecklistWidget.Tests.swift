//
//  OnboardingChecklistWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0071 · OnboardingChecklistWidget (Apple)
//
//  Unit coverage for the OnboardingChecklistWidget surface:
//    • Adapter (cached → projection) — `ChecklistBuilder` parity with the web
//      `useChecklistTasks` + `shouldHideChecklist` (features/onboarding/checklist.ts).
//    • State holder — `OnboardingChecklistModel` phase resolution across loading /
//      empty / error / hidden / content, dismiss/restart transitions, plus the
//      P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `onboarding-checklist` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryOnboardingChecklistSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached inputs → projection (port of useChecklistTasks)

@MainActor final class OnboardingChecklistBuilderTests: XCTestCase {
    func testCatalogShapeMatchesWebOrder() {
        let tasks = ChecklistBuilder.catalog(for: ChecklistInputs())
        XCTAssertEqual(tasks.map(\.id), [
            .connectVehicle,
            .pickTheme,
            .firstAlert,
            .notificationChannel,
            .tryCommandPalette,
            .enablePush,
            .customizeDashboard
        ])
        XCTAssertEqual(tasks.first?.titleFallback, "Connect your Tesla")
        XCTAssertEqual(tasks.first?.ctaTo, "/tesla-account")
    }

    func testDefaultInputsCompleteNothing() {
        let projection = ChecklistBuilder.buildProjection(from: ChecklistInputs())
        XCTAssertEqual(projection.totalCount, 7)
        XCTAssertEqual(projection.completeCount, 0)
        XCTAssertFalse(projection.allComplete)
        XCTAssertEqual(projection.progressPercent, 0)
    }

    func testEachFlagFlipsItsTask() {
        let inputs = ChecklistInputs(
            vehicleCount: 1,
            alertRuleCount: 2,
            channelCount: 1,
            themeID: "sunset",
            commandPaletteDiscovered: true,
            pushGranted: true,
            customizeDashboardCompleted: true
        )
        let byID = Dictionary(uniqueKeysWithValues: ChecklistBuilder.catalog(for: inputs).map { ($0.id, $0.complete) })
        XCTAssertEqual(byID[.connectVehicle], true)
        XCTAssertEqual(byID[.pickTheme], true)
        XCTAssertEqual(byID[.firstAlert], true)
        XCTAssertEqual(byID[.notificationChannel], true)
        XCTAssertEqual(byID[.tryCommandPalette], true)
        XCTAssertEqual(byID[.enablePush], true)
        XCTAssertEqual(byID[.customizeDashboard], true)
    }

    func testDefaultThemeDoesNotCompletePickTheme() {
        let defaulted = ChecklistBuilder.catalog(for: ChecklistInputs(themeID: "neon-cyan"))
        let nilTheme = ChecklistBuilder.catalog(for: ChecklistInputs(themeID: nil))
        XCTAssertEqual(defaulted.first(where: { $0.id == .pickTheme })?.complete, false)
        XCTAssertEqual(nilTheme.first(where: { $0.id == .pickTheme })?.complete, false)
        let custom = ChecklistBuilder.catalog(for: ChecklistInputs(themeID: "aurora"))
        XCTAssertEqual(custom.first(where: { $0.id == .pickTheme })?.complete, true)
    }

    func testProjectionCountsAndPercent() {
        let inputs = ChecklistInputs(vehicleCount: 1, commandPaletteDiscovered: true)
        let projection = ChecklistBuilder.buildProjection(from: inputs)
        XCTAssertEqual(projection.completeCount, 2)
        XCTAssertEqual(projection.totalCount, 7)
        XCTAssertFalse(projection.allComplete)
        XCTAssertEqual(projection.progressPercent, 29)
    }

    func testAllCompleteWhenEveryStepDone() {
        let inputs = ChecklistInputs(
            vehicleCount: 1,
            alertRuleCount: 1,
            channelCount: 1,
            themeID: "sunset",
            commandPaletteDiscovered: true,
            pushGranted: true,
            customizeDashboardCompleted: true
        )
        let projection = ChecklistBuilder.buildProjection(from: inputs)
        XCTAssertTrue(projection.allComplete)
        XCTAssertEqual(projection.completeCount, 7)
        XCTAssertEqual(projection.progressPercent, 100)
    }

    func testPercentRounding() {
        XCTAssertEqual(ChecklistBuilder.percent(complete: 0, total: 0), 0)
        XCTAssertEqual(ChecklistBuilder.percent(complete: 1, total: 7), 14)
        XCTAssertEqual(ChecklistBuilder.percent(complete: 2, total: 7), 29)
        XCTAssertEqual(ChecklistBuilder.percent(complete: 7, total: 7), 100)
    }

    func testShouldHideHonorsDismissAndCelebrationWindow() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        // Dismissed always hides.
        XCTAssertTrue(ChecklistBuilder.shouldHide(dismissed: true, allComplete: false, completedAt: nil, now: now))
        // Incomplete never hides.
        XCTAssertFalse(ChecklistBuilder.shouldHide(dismissed: false, allComplete: false, completedAt: nil, now: now))
        // Complete + within window stays visible (celebration).
        let recent = now.addingTimeInterval(-60 * 60)
        XCTAssertFalse(ChecklistBuilder.shouldHide(dismissed: false, allComplete: true, completedAt: recent, now: now))
        // Complete + past the 24h window hides.
        let stale = now.addingTimeInterval(-(ChecklistBuilder.celebrationWindow + 1))
        XCTAssertTrue(ChecklistBuilder.shouldHide(dismissed: false, allComplete: true, completedAt: stale, now: now))
    }

    func testCommandPaletteSentinelMatchesWeb() {
        XCTAssertEqual(ChecklistRouting.commandPaletteCTA, "#open-command-palette")
        let task = ChecklistBuilder.catalog(for: ChecklistInputs()).first { $0.id == .tryCommandPalette }
        XCTAssertEqual(task?.ctaTo, ChecklistRouting.commandPaletteCTA)
    }
}

// MARK: - State holder: phases + transitions + telemetry

@MainActor final class OnboardingChecklistModelTests: XCTestCase {
    private func makeModel(
        _ update: ChecklistUpdate,
        telemetry: OnboardingChecklistTelemetry = OSLogOnboardingChecklistTelemetry()
    ) -> (OnboardingChecklistModel, InMemoryOnboardingChecklistSource) {
        let source = InMemoryOnboardingChecklistSource(initial: update)
        let model = OnboardingChecklistModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private var inProgress: ChecklistInputs {
        ChecklistInputs(vehicleCount: 1, themeID: "neon-cyan", commandPaletteDiscovered: true)
    }

    func testLoadingWithoutInputsShowsLoading() {
        let (model, _) = makeModel(ChecklistUpdate(status: .loading, inputs: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutInputsShowsEmpty() {
        let (model, _) = makeModel(ChecklistUpdate(status: .loaded, inputs: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutInputsShowsError() {
        let (model, _) = makeModel(ChecklistUpdate(status: .failed("boom"), inputs: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testInputsPresentShowsContentEvenWhileFetchingOrFailed() {
        let (loading, _) = makeModel(ChecklistUpdate(status: .loading, inputs: inProgress))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
        XCTAssertEqual(loading.projection.completeCount, 2)

        let (failed, _) = makeModel(ChecklistUpdate(status: .failed("net"), inputs: inProgress))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testExplicitEmptyStatusShowsEmpty() {
        let (model, _) = makeModel(ChecklistUpdate(status: .empty, inputs: inProgress))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testDismissedInputsResolveToHidden() {
        let dismissed = ChecklistInputs(vehicleCount: 1, themeID: "neon-cyan", dismissed: true)
        let (model, _) = makeModel(ChecklistUpdate(status: .loaded, inputs: dismissed))
        model.start()
        XCTAssertEqual(model.phase, .hidden)
        XCTAssertFalse(model.hiddenAllComplete)
    }

    func testCompletedThenExpiredResolvesToHiddenCelebratory() {
        let done = ChecklistInputs(
            vehicleCount: 1,
            alertRuleCount: 1,
            channelCount: 1,
            themeID: "sunset",
            commandPaletteDiscovered: true,
            pushGranted: true,
            customizeDashboardCompleted: true,
            completedAt: Date().addingTimeInterval(-(ChecklistBuilder.celebrationWindow + 60))
        )
        let (model, _) = makeModel(ChecklistUpdate(status: .loaded, inputs: done))
        model.start()
        XCTAssertEqual(model.phase, .hidden)
        XCTAssertTrue(model.hiddenAllComplete)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyOnboardingChecklistTelemetry()
        let (model, source) = makeModel(ChecklistUpdate(status: .loading, inputs: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [OnboardingChecklistWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ChecklistUpdate(status: .loaded, inputs: inProgress))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testDismissTransitionsContentToHidden() {
        let (model, source) = makeModel(ChecklistUpdate(status: .loaded, inputs: inProgress))
        model.start()
        XCTAssertEqual(model.phase, .content)
        model.dismiss()
        XCTAssertEqual(source.dismissCount, 1)
        XCTAssertEqual(model.phase, .hidden)
    }

    func testRestartTransitionsHiddenToContent() {
        let dismissed = ChecklistInputs(vehicleCount: 1, themeID: "neon-cyan", dismissed: true)
        let (model, source) = makeModel(ChecklistUpdate(status: .loaded, inputs: dismissed))
        model.start()
        XCTAssertEqual(model.phase, .hidden)
        model.restart()
        XCTAssertEqual(source.restartCount, 1)
        XCTAssertEqual(model.phase, .content)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(ChecklistUpdate(status: .loading, inputs: nil))
        model.start()
        source.push(ChecklistUpdate(status: .loaded, connection: .offline, inputs: inProgress, updatedAt: Date()))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.completeCount, 2)
    }
}

// MARK: - Registry parity

@MainActor final class OnboardingChecklistRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = OnboardingChecklistWidget.registration
        XCTAssertEqual(registration.id, "onboarding-checklist")
        XCTAssertEqual(registration.category, "system")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 3))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 8))
    }

    func testClampHonorsMinAndMax() {
        let registration = OnboardingChecklistWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)), DashboardWidgetSize(cols: 2, rows: 3))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 8)
        )
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 3, rows: 5)), DashboardWidgetSize(cols: 3, rows: 5))
    }
}

// MARK: - Accessibility summary content

@MainActor final class OnboardingChecklistAccessibilityTests: XCTestCase {
    func testSummaryIncludesProgressAndTaskStatuses() {
        let projection = ChecklistBuilder.buildProjection(
            from: ChecklistInputs(vehicleCount: 1, commandPaletteDiscovered: true)
        )
        let summary = OnboardingChecklistAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("2 of 7 steps complete"))
        XCTAssertTrue(summary.contains("Connect your Tesla, Completed"))
        XCTAssertTrue(summary.contains("Pick a theme, Not started"))
    }

    func testProgressLabelFormat() {
        let projection = ChecklistBuilder.buildProjection(from: ChecklistInputs(vehicleCount: 1))
        XCTAssertEqual(OnboardingChecklistAccessibility.progressLabel(projection), "1 of 7 steps complete")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyOnboardingChecklistTelemetry: OnboardingChecklistTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
