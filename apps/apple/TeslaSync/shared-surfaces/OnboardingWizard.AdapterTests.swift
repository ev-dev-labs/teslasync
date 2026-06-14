//
//  OnboardingWizard.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0131 · OnboardingWizard (Apple)
//
//  The pure half of the coverage (the value types + the projector live in OnboardingWizard.Adapter.swift;
//  split from the state-holder / view tests for the SwiftLint file-length budget). These are Foundation-only
//  and need no main actor, no bundle, and no clock — the derivation is pure:
//    • OnboardingWizardStepCatalog — four ordered steps, every `OnboardingWizardStep` has a descriptor, and
//      the accent + SF-Symbol mapping matches the web steps[].
//    • OnboardingWizardProjector — the index clamp, the last-step test, the Next-vs-Get-Started role, the
//      `handleNext` outcome, the indicator completion (`i <= currentStep`) + active (`i === currentStep`)
//      logic, and the fully-resolved projection (title/body via an identity resolver + the progress label).
//

import XCTest
@testable import TeslaSync

// MARK: - Catalog (web steps[])

final class OnboardingWizardCatalogTests: XCTestCase {
    func testCatalogHasFourOrderedSteps() {
        let entries = OnboardingWizardStepCatalog.entries
        XCTAssertEqual(entries.count, 4)
        XCTAssertEqual(entries.map(\.step), [.welcome, .connect, .configure, .allSet])
        XCTAssertEqual(OnboardingWizardStepCatalog.count, 4)
    }

    func testEveryStepHasADescriptor() {
        for step in OnboardingWizardStep.allCases {
            XCTAssertEqual(OnboardingWizardStepCatalog.descriptor(for: step).step, step)
        }
    }

    func testAccentMappingMatchesWebSteps() {
        XCTAssertEqual(OnboardingWizardStepCatalog.descriptor(for: .welcome).accent, .primary)
        XCTAssertEqual(OnboardingWizardStepCatalog.descriptor(for: .connect).accent, .success)
        XCTAssertEqual(OnboardingWizardStepCatalog.descriptor(for: .configure).accent, .warning)
        XCTAssertEqual(OnboardingWizardStepCatalog.descriptor(for: .allSet).accent, .highlight)
    }

    func testSymbolMappingMatchesWebLucideIcons() {
        XCTAssertEqual(OnboardingWizardStepCatalog.descriptor(for: .welcome).symbolName, "bolt.fill")
        XCTAssertEqual(OnboardingWizardStepCatalog.descriptor(for: .connect).symbolName, "car.fill")
        XCTAssertEqual(OnboardingWizardStepCatalog.descriptor(for: .configure).symbolName, "gearshape.fill")
        XCTAssertEqual(
            OnboardingWizardStepCatalog.descriptor(for: .allSet).symbolName,
            "checkmark.circle.fill"
        )
    }

    func testDescriptorAtIndexClampsOutOfRange() {
        XCTAssertEqual(OnboardingWizardStepCatalog.descriptor(atIndex: -3).step, .welcome)
        XCTAssertEqual(OnboardingWizardStepCatalog.descriptor(atIndex: 99).step, .allSet)
    }

    func testFallbacksAreTheVerbatimWebCopy() {
        XCTAssertEqual(OnboardingWizardStepCatalog.descriptor(for: .welcome).titleFallback, "Welcome to TeslaSync")
        XCTAssertEqual(OnboardingWizardStepCatalog.descriptor(for: .connect).titleFallback, "Connect Your Tesla")
        XCTAssertEqual(
            OnboardingWizardStepCatalog.descriptor(for: .configure).titleFallback,
            "Configure Settings"
        )
        XCTAssertEqual(OnboardingWizardStepCatalog.descriptor(for: .allSet).titleFallback, "You're All Set!")
    }
}

// MARK: - Projector (web render rules)

final class OnboardingWizardProjectorTests: XCTestCase {
    private let identity: OnboardingWizardResolve = { _, fallback in fallback }

    func testClampIndexBoundsTheStep() {
        XCTAssertEqual(OnboardingWizardProjector.clampIndex(-1), 0)
        XCTAssertEqual(OnboardingWizardProjector.clampIndex(0), 0)
        XCTAssertEqual(OnboardingWizardProjector.clampIndex(2), 2)
        XCTAssertEqual(OnboardingWizardProjector.clampIndex(3), 3)
        XCTAssertEqual(OnboardingWizardProjector.clampIndex(10), 3)
    }

    func testIsLastStepOnlyTrueAtTheEnd() {
        XCTAssertFalse(OnboardingWizardProjector.isLastStep(currentStep: 0, stepCount: 4))
        XCTAssertFalse(OnboardingWizardProjector.isLastStep(currentStep: 2, stepCount: 4))
        XCTAssertTrue(OnboardingWizardProjector.isLastStep(currentStep: 3, stepCount: 4))
    }

    func testPrimaryActionSwapsOnLastStep() {
        XCTAssertEqual(OnboardingWizardProjector.primaryAction(currentStep: 0, stepCount: 4), .advance)
        XCTAssertEqual(OnboardingWizardProjector.primaryAction(currentStep: 2, stepCount: 4), .advance)
        XCTAssertEqual(OnboardingWizardProjector.primaryAction(currentStep: 3, stepCount: 4), .finish)
    }

    func testNextOutcomeAdvancesThenFinishes() {
        XCTAssertEqual(OnboardingWizardProjector.nextOutcome(currentStep: 0, stepCount: 4), .move(to: 1))
        XCTAssertEqual(OnboardingWizardProjector.nextOutcome(currentStep: 2, stepCount: 4), .move(to: 3))
        XCTAssertEqual(OnboardingWizardProjector.nextOutcome(currentStep: 3, stepCount: 4), .finish)
    }

    func testIndicatorsCompletionAndActiveLogic() {
        let dots = OnboardingWizardProjector.indicators(currentStep: 1, stepCount: 4)
        XCTAssertEqual(dots.count, 4)
        // i <= currentStep is complete; i == currentStep is active (web rules).
        XCTAssertEqual(dots.map(\.isComplete), [true, true, false, false])
        XCTAssertEqual(dots.map(\.isActive), [false, true, false, false])
    }

    func testIndicatorsAtFirstAndLastStep() {
        XCTAssertEqual(
            OnboardingWizardProjector.indicators(currentStep: 0, stepCount: 4).map(\.isComplete),
            [true, false, false, false]
        )
        XCTAssertEqual(
            OnboardingWizardProjector.indicators(currentStep: 3, stepCount: 4).map(\.isComplete),
            [true, true, true, true]
        )
    }

    func testResolveProducesViewReadyProjection() {
        let projection = OnboardingWizardProjector.resolve(currentStep: 1, resolve: identity)
        XCTAssertEqual(projection.stepIndex, 1)
        XCTAssertEqual(projection.stepCount, 4)
        XCTAssertEqual(projection.title, "Connect Your Tesla")
        XCTAssertEqual(projection.accent, .success)
        XCTAssertEqual(projection.symbolName, "car.fill")
        XCTAssertEqual(projection.indicators.count, 4)
        XCTAssertEqual(projection.primaryAction, .advance)
        XCTAssertEqual(projection.progressLabel, "Step 2 of 4")
    }

    func testResolveOnLastStepUsesFinishAction() {
        let projection = OnboardingWizardProjector.resolve(currentStep: 3, resolve: identity)
        XCTAssertEqual(projection.title, "You're All Set!")
        XCTAssertEqual(projection.accent, .highlight)
        XCTAssertEqual(projection.primaryAction, .finish)
        XCTAssertEqual(projection.progressLabel, "Step 4 of 4")
    }

    func testResolveClampsOutOfRangeStep() {
        let projection = OnboardingWizardProjector.resolve(currentStep: 42, resolve: identity)
        XCTAssertEqual(projection.stepIndex, 3)
        XCTAssertEqual(projection.primaryAction, .finish)
    }

    func testResolveRoutesProseThroughResolver() {
        // A non-identity resolver proves the projection localizes by key (no hardcoded prose).
        let upcasing: OnboardingWizardResolve = { key, _ in key }
        let projection = OnboardingWizardProjector.resolve(currentStep: 0, resolve: upcasing)
        XCTAssertEqual(projection.title, "onboardingWizard.welcome.title")
        XCTAssertEqual(projection.body, "onboardingWizard.welcome.body")
    }
}
