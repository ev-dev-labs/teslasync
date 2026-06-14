//
//  NavigationGuardProvider.Tests.swift
//  TeslaSync — P4 shared surface · 0128 · NavigationGuardProvider (Apple)
//
//  Pure unit tests for the dependency-light core (Adapter + Model value types): the ordered registry
//  (web `Map<id, GuardEntry>`), the `confirmIfDirty` decision + silence honoring, the back-navigation
//  intent (web `popstate`), the confirm-copy builder (the four `forms.*` keys verbatim), the VoiceOver
//  label builders, and the resolved render-state accessors. No SwiftUI, no async — every branch the
//  web source has is asserted here.
//

import XCTest
@testable import TeslaSync

final class NavigationGuardProviderTests: XCTestCase {
    // Echo localizers: one returns the KEY (to assert which keys are requested), one returns the
    // FALLBACK (to assert the English copy).
    private let echoKey: NavigationGuardResolve = { key, _ in key }
    private let echoFallback: NavigationGuardResolve = { _, fallback in fallback }

    // MARK: Registry (web `Map<id, GuardEntry>`)

    func testRegistryInsertionOrderFirstDirty() {
        var registry = NavigationGuardRegistry()
        registry.set(NavigationGuardEntry(id: "a", isDirty: { false }))
        registry.set(NavigationGuardEntry(id: "b", isDirty: { true }, message: { "b dirty" }))
        registry.set(NavigationGuardEntry(id: "c", isDirty: { true }, message: { "c dirty" }))

        XCTAssertEqual(registry.count, 3)
        XCTAssertFalse(registry.isEmpty)
        // First dirty in registration order is "b", not "c".
        XCTAssertEqual(registry.firstDirty()?.id, "b")
        XCTAssertEqual(registry.firstDirty()?.message(), "b dirty")
    }

    func testRegistryReplaceSameIdKeepsOrder() {
        var registry = NavigationGuardRegistry()
        registry.set(NavigationGuardEntry(id: "a", isDirty: { false }))
        registry.set(NavigationGuardEntry(id: "b", isDirty: { false }))
        // Re-register "a" as dirty — replaces in place without moving to the back.
        registry.set(NavigationGuardEntry(id: "a", isDirty: { true }, message: { "a now dirty" }))

        XCTAssertEqual(registry.count, 2)
        XCTAssertEqual(registry.firstDirty()?.id, "a")
    }

    func testRegistryRemove() {
        var registry = NavigationGuardRegistry()
        registry.set(NavigationGuardEntry(id: "a", isDirty: { true }))
        XCTAssertTrue(registry.contains(id: "a"))
        registry.remove(id: "a")
        XCTAssertFalse(registry.contains(id: "a"))
        XCTAssertTrue(registry.isEmpty)
        XCTAssertNil(registry.firstDirty())
    }

    func testRegistryFirstDirtyNilWhenAllClean() {
        var registry = NavigationGuardRegistry()
        registry.set(NavigationGuardEntry(id: "a", isDirty: { false }))
        registry.set(NavigationGuardEntry(id: "b", isDirty: { false }))
        XCTAssertNil(registry.firstDirty())
    }

    // MARK: Decision (web `confirmIfDirty` + silence)

    func testDecisionProceedWhenNoDirtyGuard() {
        let outcome = NavigationGuardDecision.resolve(hasDirtyGuard: false, dirtyMessage: nil, isSilenced: false)
        XCTAssertEqual(outcome, .proceed)
    }

    func testDecisionProceedWhenSilenced() {
        let outcome = NavigationGuardDecision.resolve(hasDirtyGuard: true, dirtyMessage: "x", isSilenced: true)
        XCTAssertEqual(outcome, .proceed)
    }

    func testDecisionPromptWithCustomMessage() {
        let outcome = NavigationGuardDecision.resolve(
            hasDirtyGuard: true,
            dirtyMessage: "Discard rule?",
            isSilenced: false
        )
        XCTAssertEqual(outcome, .prompt(customMessage: "Discard rule?"))
    }

    func testDecisionPromptWithNilMessage() {
        let outcome = NavigationGuardDecision.resolve(hasDirtyGuard: true, dirtyMessage: nil, isSilenced: false)
        XCTAssertEqual(outcome, .prompt(customMessage: nil))
    }

    func testSilenceHonored() {
        XCTAssertTrue(NavigationGuardDecision.silenceHonored(silenceKey: "unsaved-navigation"))
        XCTAssertFalse(NavigationGuardDecision.silenceHonored(silenceKey: ""))
    }

    // MARK: Back intent (web `popstate`)

    func testBackIntentEvaluate() {
        XCTAssertEqual(NavigationGuardBackIntent.evaluate(isDirty: true), .confirm)
        XCTAssertEqual(NavigationGuardBackIntent.evaluate(isDirty: false), .allow)
    }

    // MARK: Confirm copy (web `<ConfirmDialog>` props)

    func testConfirmContentUsesVerbatimWebKeys() {
        let copy = NavigationGuardConfirmContent.build(customMessage: nil, localize: echoKey)
        XCTAssertEqual(copy.title, "forms.unsavedTitle")
        XCTAssertEqual(copy.message, "forms.unsavedWarning")
        XCTAssertEqual(copy.confirmLabel, "forms.discard")
        XCTAssertEqual(copy.cancelLabel, "forms.keepEditing")
    }

    func testConfirmContentFallbacks() {
        let copy = NavigationGuardConfirmContent.build(customMessage: nil, localize: echoFallback)
        XCTAssertEqual(copy.title, "Unsaved changes")
        XCTAssertEqual(copy.message, "You have unsaved changes. Discard them?")
        XCTAssertEqual(copy.confirmLabel, "Discard changes")
        XCTAssertEqual(copy.cancelLabel, "Keep editing")
    }

    func testConfirmContentCustomMessageTrimmed() {
        let copy = NavigationGuardConfirmContent.build(customMessage: "  Discard draft?  ", localize: echoFallback)
        XCTAssertEqual(copy.message, "Discard draft?")
        // Title / labels still come from the catalog, not the custom message.
        XCTAssertEqual(copy.title, "Unsaved changes")
    }

    func testConfirmContentBlankCustomFallsBackToGeneric() {
        let copy = NavigationGuardConfirmContent.build(customMessage: "   ", localize: echoFallback)
        XCTAssertEqual(copy.message, "You have unsaved changes. Discard them?")
    }

    // MARK: Accessibility

    func testAccessibilityConfirmSummary() {
        let summary = NavigationGuardAccessibility.confirmSummary(
            title: "Unsaved changes",
            message: "Discard them?",
            localize: echoFallback
        )
        XCTAssertEqual(summary, "Warning. Unsaved changes. Discard them?")
    }

    func testAccessibilitySilenceLabel() {
        let checked = NavigationGuardAccessibility.silenceLabel(checked: true, localize: echoFallback)
        XCTAssertEqual(checked, "Don't ask again, checked")
        let unchecked = NavigationGuardAccessibility.silenceLabel(checked: false, localize: echoFallback)
        XCTAssertEqual(unchecked, "Don't ask again, not checked")
    }

    func testAccessibilityFreshnessLabel() {
        XCTAssertEqual(
            NavigationGuardAccessibility.freshnessLabel(connection: .live, localize: echoFallback),
            "Live"
        )
        XCTAssertEqual(
            NavigationGuardAccessibility.freshnessLabel(connection: .stale, localize: echoFallback),
            "Stale — tap to refresh"
        )
        XCTAssertEqual(
            NavigationGuardAccessibility.freshnessLabel(connection: .offline, localize: echoFallback),
            "Offline — guard state may be out of date"
        )
    }

    func testAccessibilityNormalizeCollapsesWhitespace() {
        XCTAssertEqual(NavigationGuardAccessibility.normalize("  a   b \n c  "), "a b c")
    }

    // MARK: Resolution + value types

    func testResolutionPhaseAndAccessors() {
        XCTAssertEqual(NavigationGuardResolution.loading.phase, .loading)
        XCTAssertNil(NavigationGuardResolution.loading.request)

        let idle = NavigationGuardResolution.idle(connection: .stale)
        XCTAssertEqual(idle.phase, .idle)
        XCTAssertEqual(idle.connection, .stale)
        XCTAssertNil(idle.failureMessage)

        let request = NavigationGuardConfirmRequest(
            copy: NavigationGuardConfirmContent.build(customMessage: "m", localize: echoFallback),
            showsSilenceToggle: true,
            connection: .offline
        )
        let confirming = NavigationGuardResolution.confirming(request)
        XCTAssertEqual(confirming.phase, .confirming)
        XCTAssertEqual(confirming.request, request)
        XCTAssertEqual(confirming.connection, .offline)

        let failed = NavigationGuardResolution.failed(message: "boom", connection: .live)
        XCTAssertEqual(failed.phase, .error)
        XCTAssertEqual(failed.failureMessage, "boom")
    }

    func testConfirmRequestIdentifiableIsDeterministic() {
        let copy = NavigationGuardConfirmContent.build(customMessage: "same", localize: echoFallback)
        let first = NavigationGuardConfirmRequest(copy: copy, showsSilenceToggle: true, connection: .live)
        let second = NavigationGuardConfirmRequest(copy: copy, showsSilenceToggle: true, connection: .live)
        XCTAssertEqual(first.id, second.id)
        XCTAssertEqual(first, second)
    }

    func testConnectionCaseIterable() {
        XCTAssertEqual(NavigationGuardConnection.allCases, [.live, .stale, .offline])
    }

    func testPhaseCaseIterable() {
        XCTAssertEqual(NavigationGuardPhase.allCases, [.loading, .idle, .confirming, .error])
    }
}
