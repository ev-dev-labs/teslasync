//
//  ConflictWarnings.Tests.swift
//  TeslaSync — P4 feature view · 0084 · ConflictWarnings (Apple)
//
//  Unit coverage for the ConflictWarnings surface:
//    • Projection — wire conflicts → display rows (web list key `${id}-${i}`,
//      severity passthrough, SF-Symbol mapping, `"{name}": {reason}` body) + empty.
//    • Severity — the `'warning' | 'info'` decode with the web else-branch default.
//    • Render — the parent-query phase ladder (loading / failed / empty / conflicts).
//    • State holder — model wiring, the P1/S11 view.opened telemetry, and the
//      stale rising-edge auto-refresh.
//    • Accessibility — the banner VoiceOver summary.
//    • Copy — the catalog key set (incl. the web source key).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by InMemoryConflictWarningsSource.
//

import XCTest
@testable import TeslaSync

/// Localizer that returns the English fallback, so resolution tests are
/// locale-independent.
private let fallbackLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private func makeConflict(
    id: Int = 1,
    name: String = "Morning Charge",
    reason: String = "Overlaps with Nightly Precondition",
    severity: ConflictWarningsAutomationConflictSeverity = .warning
) -> AutomationConflict {
    AutomationConflict(automationId: id, automationName: name, reason: reason, severity: severity)
}

// MARK: - Projection

@MainActor final class ConflictWarningsProjectionTests: XCTestCase {
    func testRowsPreserveOrderAndStableKeysForRepeatedIds() {
        let conflicts = [
            makeConflict(id: 5, name: "A", reason: "r1", severity: .warning),
            makeConflict(id: 5, name: "B", reason: "r2", severity: .info)
        ]
        let rows = ConflictWarningsProjection.rows(from: conflicts)
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0].id, "5-0")
        XCTAssertEqual(rows[1].id, "5-1")
        XCTAssertEqual(rows[0].severity, .warning)
        XCTAssertEqual(rows[1].severity, .info)
    }

    func testRowDetailMatchesWebTemplate() {
        let rows = ConflictWarningsProjection.rows(from: [makeConflict(
            name: "Garage Lights",
            reason: "shared trigger"
        )])
        XCTAssertEqual(rows[0].detail, "\"Garage Lights\": shared trigger")
    }

    func testRowIconMatchesSeverity() {
        let rows = ConflictWarningsProjection.rows(from: [
            makeConflict(severity: .warning),
            makeConflict(severity: .info)
        ])
        XCTAssertEqual(rows[0].iconSystemName, "exclamationmark.triangle.fill")
        XCTAssertEqual(rows[1].iconSystemName, "info.circle.fill")
    }

    func testEmptyConflictsProjectToNoRows() {
        XCTAssertTrue(ConflictWarningsProjection.rows(from: []).isEmpty)
    }
}

// MARK: - Severity decode

@MainActor final class AutomationConflictSeverityTests: XCTestCase {
    func testKnownWireValues() {
        XCTAssertEqual(ConflictWarningsAutomationConflictSeverity(wire: "warning"), .warning)
        XCTAssertEqual(ConflictWarningsAutomationConflictSeverity(wire: "info"), .info)
    }

    func testUnknownWireValueDefaultsToInfo() {
        // Web: `severity === 'warning' ? 'warning' : 'info'` — anything not exactly
        // "warning" falls through to the info variant.
        XCTAssertEqual(ConflictWarningsAutomationConflictSeverity(wire: "critical"), .info)
        XCTAssertEqual(ConflictWarningsAutomationConflictSeverity(wire: ""), .info)
        XCTAssertEqual(ConflictWarningsAutomationConflictSeverity(wire: "Warning"), .info)
    }
}

// MARK: - Render resolution

@MainActor final class ConflictWarningsRenderTests: XCTestCase {
    func testLoadingPhase() {
        XCTAssertEqual(ConflictWarningsModel.render(for: .loading), .loading)
    }

    func testFailedPhase() {
        XCTAssertEqual(ConflictWarningsModel.render(for: .failed), .failed)
    }

    func testLoadedEmptyResolvesToEmpty() {
        XCTAssertEqual(ConflictWarningsModel.render(for: .loaded([])), .empty)
    }

    func testLoadedNonEmptyResolvesToConflicts() {
        let conflicts = [makeConflict(id: 9, name: "X", reason: "y", severity: .info)]
        XCTAssertEqual(
            ConflictWarningsModel.render(for: .loaded(conflicts)),
            .conflicts(ConflictWarningsProjection.rows(from: conflicts))
        )
    }
}

// MARK: - Accessibility

@MainActor final class ConflictWarningsAccessibilityTests: XCTestCase {
    func testBannerSummaryComposesTitleSeverityAndDetail() {
        let summary = ConflictWarningsAccessibility.bannerSummary(
            title: "Potential Conflict",
            severityWord: "Warning",
            detail: "\"Morning Charge\": Overlaps"
        )
        XCTAssertEqual(summary, "Potential Conflict, Warning. \"Morning Charge\": Overlaps")
    }
}

// MARK: - Copy catalog

@MainActor final class ConflictWarningsCopyTests: XCTestCase {
    func testCatalogKeysAndFallbacksNonEmpty() {
        XCTAssertFalse(CWCopy.all.isEmpty)
        for entry in CWCopy.all {
            XCTAssertFalse(entry.key.isEmpty, "empty key")
            XCTAssertFalse(entry.fallback.isEmpty, "empty fallback for \(entry.key)")
        }
    }

    func testCatalogContainsWebSourceKey() {
        XCTAssertTrue(CWCopy.all.contains {
            $0.key == "automations.builder.conflict" && $0.fallback == "Potential Conflict"
        })
    }

    func testSeverityWordMapping() {
        XCTAssertEqual(CWCopy.severityWord(for: .warning).key, "automations.conflicts.severity.warning")
        XCTAssertEqual(CWCopy.severityWord(for: .info).key, "automations.conflicts.severity.info")
        XCTAssertEqual(CWCopy.title.resolved(fallbackLocalize), "Potential Conflict")
    }
}

// MARK: - State holder

@MainActor final class ConflictWarningsModelTests: XCTestCase {
    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let conflict = makeConflict()
        let source = InMemoryConflictWarningsSource(
            initial: ConflictWarningsInput(phase: .loaded([conflict]), isOffline: true)
        )
        let spy = SpyConflictWarningsTelemetry()
        let model = ConflictWarningsModel(source: source, telemetry: spy)

        model.start()
        model.start()

        XCTAssertEqual(model.render, .conflicts(ConflictWarningsProjection.rows(from: [conflict])))
        XCTAssertTrue(model.isOffline)
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(spy.opened, ["ConflictWarnings"])
    }

    func testPushUpdatesRenderAndFlags() {
        let source = InMemoryConflictWarningsSource()
        let model = ConflictWarningsModel(source: source, telemetry: SpyConflictWarningsTelemetry())
        model.start()

        source.push(ConflictWarningsInput(phase: .failed))
        XCTAssertEqual(model.render, .failed)

        source.push(ConflictWarningsInput(phase: .loaded([])))
        XCTAssertEqual(model.render, .empty)
    }

    func testStaleRisingEdgeAutoRefreshesOncePerEdge() {
        let source = InMemoryConflictWarningsSource()
        let model = ConflictWarningsModel(source: source, telemetry: SpyConflictWarningsTelemetry())
        model.start()
        let conflicts = [makeConflict()]

        source.push(ConflictWarningsInput(phase: .loaded(conflicts), isStale: false))
        XCTAssertEqual(source.refreshCount, 0)

        source.push(ConflictWarningsInput(phase: .loaded(conflicts), isStale: true))
        XCTAssertEqual(source.refreshCount, 1, "rising edge should auto-refresh")
        XCTAssertTrue(model.isStale)

        source.push(ConflictWarningsInput(phase: .loaded(conflicts), isStale: true))
        XCTAssertEqual(source.refreshCount, 1, "staying stale must not re-refresh")

        source.push(ConflictWarningsInput(phase: .loaded(conflicts), isStale: false))
        source.push(ConflictWarningsInput(phase: .loaded(conflicts), isStale: true))
        XCTAssertEqual(source.refreshCount, 2, "a new rising edge refreshes again")
    }

    func testRefreshAndStopDelegateToSource() {
        let source = InMemoryConflictWarningsSource()
        let model = ConflictWarningsModel(source: source, telemetry: SpyConflictWarningsTelemetry())
        model.start()

        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)

        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

/// Telemetry spy recording the surfaces opened, thread-safe for the `Sendable`
/// protocol requirement.
final class SpyConflictWarningsTelemetry: ConflictWarningsTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var opened: [String] {
        lock.withLock { storage }
    }

    func viewOpened(surface: String) {
        lock.withLock { storage.append(surface) }
    }
}
