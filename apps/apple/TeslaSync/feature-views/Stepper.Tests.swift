//
//  Stepper.Tests.swift
//  TeslaSync — P4 feature view · 0195 · Stepper (Apple)
//
//  Unit coverage for the Stepper surface:
//    • State ladder — the web `stateOf` (own-done → done; first not-done →
//      current; the rest → pending; a done row after the current one stays done).
//    • Projection — steps → display rows (1-based position, total, last-row flag,
//      stable keys, CTA gating, indicator + tone + connector derivation) + empty.
//    • Render — the parent-query phase ladder (loading / failed / empty / steps).
//    • State holder — model wiring, the P1/S11 view.opened telemetry, the stale
//      rising-edge auto-refresh, and CTA-activation delegation.
//    • Accessibility — the position clause + the row VoiceOver summary.
//    • Copy — the catalog key set (incl. the web source aria-label key).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by InMemoryStepperSource.
//

import XCTest
@testable import TeslaSync

/// Localizer that returns the English fallback, so resolution tests are
/// locale-independent.
private let fallbackLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private func makeStep(
    key: String = "step",
    title: String = "Title",
    description: String = "Description",
    isDone: Bool = false,
    cta: StepperStepCTA? = nil
) -> StepperStep {
    StepperStep(key: key, title: title, description: description, isDone: isDone, cta: cta)
}

// MARK: - State ladder (web `stateOf`)

final class StepperProjectionStateTests: XCTestCase {
    func testFirstNotDoneIsCurrentRestPending() {
        let steps = [
            makeStep(key: "a", isDone: false),
            makeStep(key: "b", isDone: false),
            makeStep(key: "c", isDone: false)
        ]
        XCTAssertEqual(StepperProjection.state(for: steps, at: 0), .current)
        XCTAssertEqual(StepperProjection.state(for: steps, at: 1), .pending)
        XCTAssertEqual(StepperProjection.state(for: steps, at: 2), .pending)
    }

    func testCompletedPrefixAdvancesCurrent() {
        let steps = [
            makeStep(key: "a", isDone: true),
            makeStep(key: "b", isDone: false),
            makeStep(key: "c", isDone: false)
        ]
        XCTAssertEqual(StepperProjection.state(for: steps, at: 0), .done)
        XCTAssertEqual(StepperProjection.state(for: steps, at: 1), .current)
        XCTAssertEqual(StepperProjection.state(for: steps, at: 2), .pending)
    }

    func testDoneStepAfterCurrentStaysDone() {
        // Web checks `steps[index].done` first, so a satisfied step that follows
        // the current step still reads as done — not pending.
        let steps = [
            makeStep(key: "a", isDone: false),
            makeStep(key: "b", isDone: false),
            makeStep(key: "c", isDone: true)
        ]
        XCTAssertEqual(StepperProjection.state(for: steps, at: 0), .current)
        XCTAssertEqual(StepperProjection.state(for: steps, at: 1), .pending)
        XCTAssertEqual(StepperProjection.state(for: steps, at: 2), .done)
    }

    func testAllDoneHaveNoCurrent() {
        let steps = [makeStep(key: "a", isDone: true), makeStep(key: "b", isDone: true)]
        XCTAssertEqual(StepperProjection.state(for: steps, at: 0), .done)
        XCTAssertEqual(StepperProjection.state(for: steps, at: 1), .done)
    }
}

// MARK: - Projection rows

final class StepperProjectionRowsTests: XCTestCase {
    private func sampleSteps() -> [StepperStep] {
        [
            makeStep(key: "a", title: "Connect", isDone: true, cta: StepperStepCTA(label: "Open")),
            makeStep(key: "b", title: "Stream", isDone: false, cta: StepperStepCTA(label: "Set up")),
            makeStep(key: "c", title: "Automate", isDone: false, cta: StepperStepCTA(label: "Create"))
        ]
    }

    func testPositionsTotalsAndLastFlag() {
        let rows = StepperProjection.rows(from: sampleSteps())
        XCTAssertEqual(rows.map(\.position), [1, 2, 3])
        XCTAssertEqual(Set(rows.map(\.total)), [3])
        XCTAssertEqual(rows.map(\.isLast), [false, false, true])
    }

    func testStableKeysPreserved() {
        let rows = StepperProjection.rows(from: sampleSteps())
        XCTAssertEqual(rows.map(\.id), ["a", "b", "c"])
    }

    func testCTAShowsOnlyOnCurrent() {
        let rows = StepperProjection.rows(from: sampleSteps())
        // a = done (has cta, but not current), b = current (has cta), c = pending (has cta).
        XCTAssertFalse(rows[0].showsCTA, "done row must not surface its CTA")
        XCTAssertTrue(rows[1].showsCTA, "current row surfaces its CTA")
        XCTAssertFalse(rows[2].showsCTA, "pending row must not surface its CTA")
    }

    func testCurrentWithoutCTADoesNotShow() {
        let steps = [makeStep(key: "a", isDone: false)]
        let rows = StepperProjection.rows(from: steps)
        XCTAssertEqual(rows[0].state, .current)
        XCTAssertFalse(rows[0].showsCTA)
    }

    func testIndicatorMapping() {
        let rows = StepperProjection.rows(from: sampleSteps())
        XCTAssertEqual(rows[0].indicator, .check)
        XCTAssertEqual(rows[1].indicator, .spinner)
        XCTAssertEqual(rows[2].indicator, .number(3))
    }

    func testToneMapping() {
        let rows = StepperProjection.rows(from: sampleSteps())
        XCTAssertEqual(rows[0].tone, .success)
        XCTAssertEqual(rows[1].tone, .accent)
        XCTAssertEqual(rows[2].tone, .muted)
    }

    func testConnectorCompleteMatchesDone() {
        let rows = StepperProjection.rows(from: sampleSteps())
        XCTAssertEqual(rows.map(\.connectorIsComplete), [true, false, false])
    }

    func testEmptyStepsProjectToNoRows() {
        XCTAssertTrue(StepperProjection.rows(from: []).isEmpty)
    }
}

// MARK: - Render resolution

final class StepperRenderTests: XCTestCase {
    func testLoadingPhase() {
        XCTAssertEqual(StepperModel.render(for: .loading), .loading)
    }

    func testFailedPhase() {
        XCTAssertEqual(StepperModel.render(for: .failed), .failed)
    }

    func testLoadedEmptyResolvesToEmpty() {
        XCTAssertEqual(StepperModel.render(for: .loaded([])), .empty)
    }

    func testLoadedNonEmptyResolvesToSteps() {
        let steps = [makeStep(key: "a", isDone: false)]
        XCTAssertEqual(
            StepperModel.render(for: .loaded(steps)),
            .steps(StepperProjection.rows(from: steps))
        )
    }
}

// MARK: - Accessibility

final class StepperAccessibilityTests: XCTestCase {
    func testPositionFormatting() {
        let clause = StepperAccessibility.position(format: "Step %1$d of %2$d", position: 2, total: 4)
        XCTAssertEqual(clause, "Step 2 of 4")
    }

    func testStepSummaryComposition() {
        let summary = StepperAccessibility.stepSummary(
            title: "Enable Fleet Telemetry",
            position: "Step 2 of 3",
            stateWord: "In progress",
            description: "Stream live signals."
        )
        XCTAssertEqual(summary, "Enable Fleet Telemetry, Step 2 of 3, In progress. Stream live signals.")
    }
}

// MARK: - Copy catalog

final class StepperCopyTests: XCTestCase {
    func testCatalogKeysAndFallbacksNonEmpty() {
        XCTAssertFalse(StepperCopy.all.isEmpty)
        for entry in StepperCopy.all {
            XCTAssertFalse(entry.key.isEmpty, "empty key")
            XCTAssertFalse(entry.fallback.isEmpty, "empty fallback for \(entry.key)")
        }
    }

    func testCatalogContainsWebSourceKey() {
        XCTAssertTrue(StepperCopy.all.contains {
            $0.key == "onboarding.stepper.label" && $0.fallback == "Onboarding steps"
        })
    }

    func testStateWordMapping() {
        XCTAssertEqual(StepperCopy.stateWord(for: .done).key, "onboarding.stepper.state.done")
        XCTAssertEqual(StepperCopy.stateWord(for: .current).key, "onboarding.stepper.state.current")
        XCTAssertEqual(StepperCopy.stateWord(for: .pending).key, "onboarding.stepper.state.pending")
        XCTAssertEqual(StepperCopy.listLabel.resolved(fallbackLocalize), "Onboarding steps")
    }
}

// MARK: - State holder

@MainActor
final class StepperModelTests: XCTestCase {
    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let step = makeStep(key: "a", isDone: false)
        let source = InMemoryStepperSource(
            initial: StepperInput(phase: .loaded([step]), isOffline: true)
        )
        let spy = SpyStepperTelemetry()
        let model = StepperModel(source: source, telemetry: spy)

        model.start()
        model.start()

        XCTAssertEqual(model.render, .steps(StepperProjection.rows(from: [step])))
        XCTAssertTrue(model.isOffline)
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(spy.opened, ["Stepper"])
    }

    func testPushUpdatesRenderAndFlags() {
        let source = InMemoryStepperSource()
        let model = StepperModel(source: source, telemetry: SpyStepperTelemetry())
        model.start()

        source.push(StepperInput(phase: .failed))
        XCTAssertEqual(model.render, .failed)

        source.push(StepperInput(phase: .loaded([])))
        XCTAssertEqual(model.render, .empty)
    }

    func testStaleRisingEdgeAutoRefreshesOncePerEdge() {
        let source = InMemoryStepperSource()
        let model = StepperModel(source: source, telemetry: SpyStepperTelemetry())
        model.start()
        let steps = [makeStep(key: "a", isDone: false)]

        source.push(StepperInput(phase: .loaded(steps), isStale: false))
        XCTAssertEqual(source.refreshCount, 0)

        source.push(StepperInput(phase: .loaded(steps), isStale: true))
        XCTAssertEqual(source.refreshCount, 1, "rising edge should auto-refresh")
        XCTAssertTrue(model.isStale)

        source.push(StepperInput(phase: .loaded(steps), isStale: true))
        XCTAssertEqual(source.refreshCount, 1, "staying stale must not re-refresh")

        source.push(StepperInput(phase: .loaded(steps), isStale: false))
        source.push(StepperInput(phase: .loaded(steps), isStale: true))
        XCTAssertEqual(source.refreshCount, 2, "a new rising edge refreshes again")
    }

    func testActivateRefreshAndStopDelegateToSource() {
        let source = InMemoryStepperSource()
        let model = StepperModel(source: source, telemetry: SpyStepperTelemetry())
        model.start()

        model.activateStep("telemetry")
        XCTAssertEqual(source.activatedSteps, ["telemetry"])

        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)

        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

/// Telemetry spy recording the surfaces opened, thread-safe for the `Sendable`
/// protocol requirement.
final class SpyStepperTelemetry: StepperTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var opened: [String] {
        lock.withLock { storage }
    }

    func viewOpened(surface: String) {
        lock.withLock { storage.append(surface) }
    }
}
