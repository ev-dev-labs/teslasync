//
//  GuardedLink.Tests.swift
//  TeslaSync — P4 shared surface · 0122 · GuardedLink (Apple)
//
//  Adapter + projection + model coverage: target mapping, modifier bypass, the VERBATIM web
//  `shouldSkipGuard`, the VoiceOver hint, every projection branch (incl. a usable destination surviving
//  transient loading/failure), and the model guard-or-navigate flow + stale auto-refresh. Pure adapter
//  reads or an in-memory source + recording navigator; identity-fallback resolver keeps copy deterministic.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

/// Identity-fallback resolver — returns the web English default so the asserted copy is independent of
/// the bundle / locale catalog.
private let fallbackStrings: GuardedResolve = { _, fallback in fallback }

private func dest(_ path: String) -> GuardedDestination {
    GuardedDestination(path: path)
}

// MARK: - Target (web `target` prop)

final class GuardedLinkTargetTests: XCTestCase {
    func testNilTargetStaysInContext() {
        XCTAssertEqual(GuardedLinkTarget(rawTarget: nil), .sameContext)
    }

    func testEmptyTargetStaysInContext() {
        XCTAssertEqual(GuardedLinkTarget(rawTarget: ""), .sameContext)
    }

    func testSelfTargetStaysInContext() {
        XCTAssertEqual(GuardedLinkTarget(rawTarget: "_self"), .sameContext)
    }

    func testBlankTargetOpensNewContext() {
        XCTAssertEqual(GuardedLinkTarget(rawTarget: "_blank"), .newContext)
    }

    func testNamedTargetOpensNewContext() {
        XCTAssertEqual(GuardedLinkTarget(rawTarget: "report-window"), .newContext)
    }
}

// MARK: - Destination

final class GuardedDestinationTests: XCTestCase {
    func testTrimsWhitespace() {
        XCTAssertEqual(dest("  /drives  ").path, "/drives")
    }

    func testBlankPathIsEmpty() {
        XCTAssertTrue(dest("   ").isEmpty)
    }

    func testRealPathIsNotEmpty() {
        XCTAssertFalse(dest("/drives").isEmpty)
    }
}

// MARK: - Modifiers (web `metaKey | ctrlKey | shiftKey | altKey`)

final class GuardedActivationModifiersTests: XCTestCase {
    func testEmptyDoesNotBypass() {
        XCTAssertFalse(GuardedActivationModifiers().bypassesGuard)
    }

    func testEachModifierBypasses() {
        XCTAssertTrue(GuardedActivationModifiers.command.bypassesGuard)
        XCTAssertTrue(GuardedActivationModifiers.control.bypassesGuard)
        XCTAssertTrue(GuardedActivationModifiers.shift.bypassesGuard)
        XCTAssertTrue(GuardedActivationModifiers.option.bypassesGuard)
    }

    func testCombinedModifiersBypass() {
        let combined: GuardedActivationModifiers = [.command, .shift]
        XCTAssertTrue(combined.bypassesGuard)
    }
}

// MARK: - Decision (web `shouldSkipGuard`)

final class GuardDecisionTests: XCTestCase {
    func testPlainPrimaryDoesNotSkip() {
        XCTAssertFalse(GuardDecision.shouldSkipGuard(.primary))
    }

    func testModifierSkips() {
        XCTAssertTrue(GuardDecision.shouldSkipGuard(GuardedActivation(modifiers: .command)))
        XCTAssertTrue(GuardDecision.shouldSkipGuard(GuardedActivation(modifiers: .option)))
    }

    func testNonPrimarySkips() {
        XCTAssertTrue(GuardDecision.shouldSkipGuard(GuardedActivation(isPrimary: false)))
    }

    func testNewContextSkips() {
        XCTAssertTrue(GuardDecision.shouldSkipGuard(.newContext))
        XCTAssertTrue(GuardDecision.shouldSkipGuard(GuardedActivation(target: .newContext)))
    }

    func testPreemptedDoesNotAffectSkipDecision() {
        // Preemption is handled separately by the model; the skip decision itself ignores it.
        XCTAssertFalse(GuardDecision.shouldSkipGuard(GuardedActivation(isPreempted: true)))
    }
}

// MARK: - Accessibility

final class GuardedAccessibilityTests: XCTestCase {
    func testHintReflectsGuardedState() {
        XCTAssertEqual(
            GuardedAccessibility.hint(isDirty: true, strings: fallbackStrings),
            "Confirms unsaved changes before navigating"
        )
        XCTAssertEqual(
            GuardedAccessibility.hint(isDirty: false, strings: fallbackStrings),
            "Navigates within the app"
        )
    }

    func testNormalizeCollapsesWhitespace() {
        XCTAssertEqual(GuardedAccessibility.normalize("Open   Automations"), "Open Automations")
    }

    func testNormalizeTrimsEnds() {
        XCTAssertEqual(GuardedAccessibility.normalize("  Open  "), "Open")
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class GuardedLinkProjectionTests: XCTestCase {
    private func resolve(_ input: GuardedLinkInput) -> GuardedLinkResolved {
        GuardedLinkProjection.resolve(input: input)
    }

    func testErrorWithNoDestinationIsError() {
        let resolved = resolve(GuardedLinkInput(errorMessage: "boom"))
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertNil(resolved.data)
    }

    func testErrorWithUsableDestinationKeepsShowingData() {
        let resolved = resolve(GuardedLinkInput(destination: dest("/drives"), errorMessage: "boom"))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.data?.destination, dest("/drives"))
    }

    func testLoadingWithNoDestinationIsLoading() {
        XCTAssertEqual(resolve(GuardedLinkInput(isLoading: true)).phase, .loading)
    }

    func testLoadingWithUsableDestinationShowsData() {
        let resolved = resolve(GuardedLinkInput(destination: dest("/drives"), isLoading: true))
        XCTAssertEqual(resolved.phase, .data)
    }

    func testNoDestinationIsEmpty() {
        XCTAssertEqual(resolve(GuardedLinkInput()).phase, .empty)
    }

    func testBlankDestinationIsEmpty() {
        XCTAssertEqual(resolve(GuardedLinkInput(destination: dest("   "))).phase, .empty)
    }

    func testUsableDestinationRendersDataWithPropagatedFields() {
        let options = GuardedNavigationOptions(replace: true, relative: .path, state: ["from": "list"])
        let input = GuardedLinkInput(
            destination: dest("/automations"),
            options: options,
            isDirty: true,
            guardMessage: "unsaved rule"
        )
        let resolved = resolve(input)
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.data?.destination, dest("/automations"))
        XCTAssertEqual(resolved.data?.options, options)
        XCTAssertEqual(resolved.data?.isDirty, true)
        XCTAssertEqual(resolved.data?.guardMessage, "unsaved rule")
    }
}

// MARK: - Model (state holder + guard-or-navigate flow + auto-refresh)

private final class SpyGuardedLinkTelemetry: GuardedLinkTelemetry, @unchecked Sendable {
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
final class GuardedLinkModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryNavigationGuardSource,
        navigator: RecordingGuardedNavigator,
        telemetry: GuardedLinkTelemetry = SpyGuardedLinkTelemetry()
    ) -> GuardedLinkModel {
        GuardedLinkModel(
            source: source,
            navigator: navigator,
            telemetry: telemetry,
            strings: fallbackStrings
        )
    }

    func testStartEmitsViewOpenedAndStartsSource() {
        let source = InMemoryNavigationGuardSource(initial: GuardedLinkInput())
        let telemetry = SpyGuardedLinkTelemetry()
        let model = makeModel(source: source, navigator: RecordingGuardedNavigator(), telemetry: telemetry)

        model.start()
        model.start() // idempotent

        XCTAssertEqual(telemetry.openedSurfaces, ["GuardedLink"])
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(model.phase, .empty)
    }

    func testApplyDrivesPhaseAndConnection() {
        let source = InMemoryNavigationGuardSource()
        let model = makeModel(source: source, navigator: RecordingGuardedNavigator())
        model.start()

        source.push(GuardedLinkInput(destination: dest("/drives")))

        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(model.data?.destination, dest("/drives"))
    }

    func testActivateCleanNavigatesImmediately() {
        let source = InMemoryNavigationGuardSource(initial: GuardedLinkInput(
            destination: dest("/drives"),
            options: GuardedNavigationOptions(replace: true)
        ))
        let navigator = RecordingGuardedNavigator()
        let model = makeModel(source: source, navigator: navigator)
        model.start()

        model.activate(.primary)

        XCTAssertEqual(navigator.navigations.count, 1)
        XCTAssertEqual(navigator.navigations.first?.destination, dest("/drives"))
        XCTAssertEqual(navigator.navigations.first?.options.replace, true)
        XCTAssertNil(model.confirmRequest)
    }

    func testActivateDirtyRaisesConfirmWithoutNavigating() {
        let source = InMemoryNavigationGuardSource(initial: GuardedLinkInput(
            destination: dest("/automations"),
            isDirty: true,
            guardMessage: "You have an unsaved alert rule."
        ))
        let navigator = RecordingGuardedNavigator()
        let model = makeModel(source: source, navigator: navigator)
        model.start()

        model.activate(.primary)

        XCTAssertEqual(navigator.navigations.count, 0)
        XCTAssertEqual(model.confirmRequest?.message, "You have an unsaved alert rule.")
        XCTAssertEqual(model.confirmRequest?.destination, dest("/automations"))
    }

    func testActivateDirtyWithoutGuardMessageUsesFallbackCopy() {
        let source = InMemoryNavigationGuardSource(initial: GuardedLinkInput(
            destination: dest("/automations"),
            isDirty: true
        ))
        let model = makeModel(source: source, navigator: RecordingGuardedNavigator())
        model.start()

        model.activate(.primary)

        XCTAssertEqual(model.confirmRequest?.message, "You have unsaved changes. Discard them?")
    }

    func testConfirmDiscardNavigatesAndClears() {
        let source = InMemoryNavigationGuardSource(initial: GuardedLinkInput(
            destination: dest("/automations"),
            isDirty: true
        ))
        let navigator = RecordingGuardedNavigator()
        let model = makeModel(source: source, navigator: navigator)
        model.start()
        model.activate(.primary)
        XCTAssertNotNil(model.confirmRequest)

        model.confirmDiscard()

        XCTAssertNil(model.confirmRequest)
        XCTAssertEqual(navigator.navigations.count, 1)
        XCTAssertEqual(navigator.navigations.first?.destination, dest("/automations"))
    }

    func testKeepEditingCancelsWithoutNavigating() {
        let source = InMemoryNavigationGuardSource(initial: GuardedLinkInput(
            destination: dest("/automations"),
            isDirty: true
        ))
        let navigator = RecordingGuardedNavigator()
        let model = makeModel(source: source, navigator: navigator)
        model.start()
        model.activate(.primary)

        model.cancelConfirm()

        XCTAssertNil(model.confirmRequest)
        XCTAssertEqual(navigator.navigations.count, 0)
    }

    func testNewContextActivationBypassesGuard() {
        let source = InMemoryNavigationGuardSource(initial: GuardedLinkInput(
            destination: dest("/drives"),
            isDirty: true // even dirty, a new-context open must bypass the guard
        ))
        let navigator = RecordingGuardedNavigator()
        let model = makeModel(source: source, navigator: navigator)
        model.start()

        model.activate(.newContext)

        XCTAssertEqual(navigator.newContextOpens, [dest("/drives")])
        XCTAssertEqual(navigator.navigations.count, 0)
        XCTAssertNil(model.confirmRequest)
    }

    func testModifierActivationBypassesGuard() {
        let source = InMemoryNavigationGuardSource(initial: GuardedLinkInput(
            destination: dest("/drives"),
            isDirty: true
        ))
        let navigator = RecordingGuardedNavigator()
        let model = makeModel(source: source, navigator: navigator)
        model.start()

        model.activate(GuardedActivation(modifiers: .command))

        XCTAssertEqual(navigator.newContextOpens, [dest("/drives")])
        XCTAssertNil(model.confirmRequest)
    }

    func testPreemptedActivationDoesNothing() {
        let source = InMemoryNavigationGuardSource(initial: GuardedLinkInput(destination: dest("/drives")))
        let navigator = RecordingGuardedNavigator()
        let model = makeModel(source: source, navigator: navigator)
        model.start()

        model.activate(.preempted)

        XCTAssertEqual(navigator.navigations.count, 0)
        XCTAssertEqual(navigator.newContextOpens.count, 0)
        XCTAssertNil(model.confirmRequest)
    }

    func testActivateWhileNotDataPhaseDoesNothing() {
        let source = InMemoryNavigationGuardSource(initial: GuardedLinkInput()) // empty phase
        let navigator = RecordingGuardedNavigator()
        let model = makeModel(source: source, navigator: navigator)
        model.start()
        XCTAssertEqual(model.phase, .empty)

        model.activate(.primary)

        XCTAssertEqual(navigator.navigations.count, 0)
        XCTAssertNil(model.confirmRequest)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let source = InMemoryNavigationGuardSource()
        let model = makeModel(source: source, navigator: RecordingGuardedNavigator())
        model.start()

        source.push(GuardedLinkInput(destination: dest("/drives"), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)

        // A second stale snapshot does not re-trigger the one-shot auto-refresh.
        source.push(GuardedLinkInput(destination: dest("/drives"), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopStopsSource() {
        let source = InMemoryNavigationGuardSource()
        let model = makeModel(source: source, navigator: RecordingGuardedNavigator())
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}
