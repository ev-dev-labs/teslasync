import XCTest
@testable import TeslaSync

/// Page-level tests for the standalone `ConflictWarnings` screen seam. The reused P4 feature view
/// owns the projection/banner/state internals (covered by `ConflictWarnings.Tests`); these assert
/// the PAGE hosting contract — that `ConflictWarningsPageModel` drives the hosted surface across the
/// manifest's required `empty` and `error` data states plus the loaded list, that `refresh()`
/// delegates to the bound source, and that the parity string `automations.builder.conflict` flows
/// through the hosted banner.
@MainActor final class ConflictWarningsPageModelTests: XCTestCase {
    private func conflict(
        _ identifier: Int,
        severity: ConflictWarningsAutomationConflictSeverity = .warning
    ) -> AutomationConflict {
        AutomationConflict(
            automationId: identifier,
            automationName: "Automation \(identifier)",
            reason: "reason \(identifier)",
            severity: severity
        )
    }

    private func pageModel(_ input: ConflictWarningsInput) -> ConflictWarningsPageModel {
        ConflictWarningsPageModel(source: InMemoryConflictWarningsSource(initial: input))
    }

    // MARK: - Hosted render states (manifest data states)

    func testLoadResolvesConflicts() {
        let conflicts = [conflict(1), conflict(2, severity: .info)]
        let model = pageModel(ConflictWarningsInput(phase: .loaded(conflicts)))
        model.load()
        XCTAssertEqual(model.surface.render, .conflicts(ConflictWarningsProjection.rows(from: conflicts)))
    }

    func testLoadEmptyResolvesEmptyState() {
        let model = pageModel(ConflictWarningsInput(phase: .loaded([])))
        model.load()
        XCTAssertEqual(model.surface.render, .empty)
    }

    func testLoadFailureResolvesErrorState() {
        let model = pageModel(ConflictWarningsInput(phase: .failed))
        model.load()
        XCTAssertEqual(model.surface.render, .failed)
    }

    func testStaleAndOfflineChromeFlowThrough() {
        let model = pageModel(
            ConflictWarningsInput(phase: .loaded([conflict(1)]), isStale: true, isOffline: true)
        )
        model.load()
        XCTAssertTrue(model.surface.isStale)
        XCTAssertTrue(model.surface.isOffline)
    }

    // MARK: - Page seam

    func testDefaultSourceProducesConflicts() {
        let model = ConflictWarningsPageModel()
        model.load()
        guard case let .conflicts(rows) = model.surface.render else {
            return XCTFail("expected conflicts render, got \(model.surface.render)")
        }
        XCTAssertFalse(rows.isEmpty)
    }

    func testRefreshDelegatesToSource() {
        let source = InMemoryConflictWarningsSource(initial: ConflictWarningsInput(phase: .loaded([conflict(1)])))
        let model = ConflictWarningsPageModel(source: source)
        model.load()
        model.refresh()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.refreshCount, 1)
    }

    // MARK: - Parity string + banner projection (web AlertBanner)

    func testParityBannerTitleKeyIsWebKey() {
        XCTAssertEqual(CWCopy.title.key, "automations.builder.conflict")
        XCTAssertEqual(CWCopy.title.fallback, "Potential Conflict")
    }

    func testBannerDetailMatchesWebTemplate() {
        let rows = ConflictWarningsProjection.rows(from: [
            AutomationConflict(
                automationId: 7,
                automationName: "Lock when away",
                reason: "Also controls the door locks",
                severity: .info
            )
        ])
        XCTAssertEqual(rows.first?.detail, "\"Lock when away\": Also controls the door locks")
        XCTAssertEqual(rows.first?.iconSystemName, "info.circle.fill")
    }
}
