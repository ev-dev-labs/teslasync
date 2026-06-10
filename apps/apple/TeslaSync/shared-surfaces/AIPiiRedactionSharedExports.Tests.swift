//
//  AIPiiRedactionSharedExports.Tests.swift
//  TeslaSync — P4 shared surface · 0038 · AIPiiRedactionSharedExports (Apple)
//
//  Unit coverage for the AIPiiRedactionSharedExports surface:
//    • Adapter/Projection — the cached-inputs → render-decisions map (the web `AIFeatureCard` +
//      `AiOutputPanel` branches) that the view reads and the model derives.
//    • Logic — the export-type/stream-lifecycle button predicates (isBusy / canStart /
//      buttonDisabled / output visibility / idle-invite / emptyHint) + the gate render axis.
//    • Export-type catalog — the six canonical slugs, their declared order, and the i18n
//      key/label derivation.
//    • Accessibility — the spoken card summary across the stream lifecycle.
//    • i18n facade — the per-surface table resolves each key to its English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets and in the SwiftPM verification harness.
//  They have no network and no real store. Per-state view rendering is covered by the #Preview
//  blocks (compiled by the app targets); the per-state *behaviour* is asserted in
//  `…ModelTests.swift` through the model's derived flags.
//

import XCTest
@testable import TeslaSync

// MARK: - Render axis (web `withAiFeature` gate + P4 leaf gate-error)

@MainActor final class PiiRedactionExportsRenderStateTests: XCTestCase {
    func testGatedOffWinsOverEverything() {
        XCTAssertEqual(PiiRedactionExportsLogic.renderState(gate: .off, gateError: nil), .gatedOff)
        XCTAssertEqual(PiiRedactionExportsLogic.renderState(gate: .off, gateError: "ignored"), .gatedOff)
    }

    func testErrorBeatsLoadingWhenGateOn() {
        XCTAssertEqual(
            PiiRedactionExportsLogic.renderState(gate: .loading, gateError: "boom"), .gateError("boom")
        )
        XCTAssertEqual(
            PiiRedactionExportsLogic.renderState(gate: .on, gateError: "boom"), .gateError("boom")
        )
    }

    func testEmptyErrorIsNotAnError() {
        XCTAssertEqual(PiiRedactionExportsLogic.renderState(gate: .loading, gateError: ""), .gateLoading)
        XCTAssertEqual(PiiRedactionExportsLogic.renderState(gate: .on, gateError: ""), .ready)
    }

    func testLoadingAndReady() {
        XCTAssertEqual(PiiRedactionExportsLogic.renderState(gate: .loading, gateError: nil), .gateLoading)
        XCTAssertEqual(PiiRedactionExportsLogic.renderState(gate: .on, gateError: nil), .ready)
    }
}

// MARK: - Button / output logic (web AIFeatureCard + AiOutputPanel)

@MainActor final class PiiRedactionExportsLogicTests: XCTestCase {
    func testIsBusy() {
        XCTAssertTrue(PiiRedactionExportsLogic.isBusy(.streaming))
        XCTAssertTrue(PiiRedactionExportsLogic.isBusy(.pausedConfirm))
        XCTAssertFalse(PiiRedactionExportsLogic.isBusy(.idle))
        XCTAssertFalse(PiiRedactionExportsLogic.isBusy(.done))
        XCTAssertFalse(PiiRedactionExportsLogic.isBusy(.error("x")))
    }

    func testCanStartRequiresAnExportTypeAndNotPaused() {
        // Web `canStart = exportType !== ''` — a chosen type enables, nil (the empty string
        // resting state) does not, and a paused-confirm stream blocks a fresh start.
        XCTAssertTrue(PiiRedactionExportsLogic.canStart(exportType: .drives, phase: .idle))
        XCTAssertFalse(PiiRedactionExportsLogic.canStart(exportType: nil, phase: .idle))
        XCTAssertFalse(PiiRedactionExportsLogic.canStart(exportType: .drives, phase: .pausedConfirm))
        XCTAssertTrue(PiiRedactionExportsLogic.canStart(exportType: .charging, phase: .streaming))
    }

    func testButtonDisabled() {
        XCTAssertFalse(PiiRedactionExportsLogic.buttonDisabled(
            exportType: .drives, phase: .idle, connection: .live
        ))
        XCTAssertTrue(PiiRedactionExportsLogic.buttonDisabled(
            exportType: .drives, phase: .streaming, connection: .live
        ))
        XCTAssertTrue(PiiRedactionExportsLogic.buttonDisabled(
            exportType: nil, phase: .idle, connection: .live
        ))
        XCTAssertTrue(PiiRedactionExportsLogic.buttonDisabled(
            exportType: .drives, phase: .idle, connection: .offline
        ))
    }

    func testOutputVisible() {
        XCTAssertFalse(PiiRedactionExportsLogic.outputVisible(phase: .idle, hasText: false))
        XCTAssertTrue(PiiRedactionExportsLogic.outputVisible(phase: .idle, hasText: true))
        XCTAssertTrue(PiiRedactionExportsLogic.outputVisible(phase: .streaming, hasText: false))
        XCTAssertTrue(PiiRedactionExportsLogic.outputVisible(phase: .done, hasText: false))
        XCTAssertTrue(PiiRedactionExportsLogic.outputVisible(phase: .error("x"), hasText: false))
    }

    func testThinkingVisible() {
        XCTAssertTrue(PiiRedactionExportsLogic.thinkingVisible(phase: .streaming, hasText: false))
        XCTAssertFalse(PiiRedactionExportsLogic.thinkingVisible(phase: .streaming, hasText: true))
        XCTAssertFalse(PiiRedactionExportsLogic.thinkingVisible(phase: .idle, hasText: false))
    }

    func testIsIdleInvite() {
        XCTAssertTrue(PiiRedactionExportsLogic.isIdleInvite(phase: .idle, hasText: false))
        XCTAssertFalse(PiiRedactionExportsLogic.isIdleInvite(phase: .idle, hasText: true))
        XCTAssertFalse(PiiRedactionExportsLogic.isIdleInvite(phase: .streaming, hasText: false))
    }

    func testEmptyHintTracksTheSingleInputPredicate() {
        XCTAssertEqual(
            PiiRedactionExportsLogic.emptyHint(exportType: nil, phase: .idle), .pickExportType
        )
        XCTAssertNil(PiiRedactionExportsLogic.emptyHint(exportType: .drives, phase: .idle))
        // No hint while busy/paused — the disabled reason there is the stream, not input.
        XCTAssertNil(PiiRedactionExportsLogic.emptyHint(exportType: nil, phase: .streaming))
        XCTAssertNil(PiiRedactionExportsLogic.emptyHint(exportType: nil, phase: .pausedConfirm))
    }
}

// MARK: - Export-type catalog (web SHARED_EXPORT_TYPES)

@MainActor final class PiiRedactionExportTypeTests: XCTestCase {
    func testCanonicalSlugsInWebOrder() {
        // The declared order must match the web `SHARED_EXPORT_TYPES` array exactly so the menu
        // lists the options in the same sequence.
        XCTAssertEqual(
            PiiRedactionExportType.allCases.map(\.slug),
            ["drives", "charging", "trips", "analytics", "backup", "account"]
        )
    }

    func testLabelKeyAndDefaultLabelDerivation() {
        XCTAssertEqual(PiiRedactionExportType.drives.labelKey, "exports.aiRedaction.exportType.drives")
        XCTAssertEqual(PiiRedactionExportType.drives.defaultLabel, "Drives")
        XCTAssertEqual(PiiRedactionExportType.analytics.defaultLabel, "Analytics")
        XCTAssertEqual(PiiRedactionExportType.account.labelKey, "exports.aiRedaction.exportType.account")
    }
}

// MARK: - Projection (cached inputs → render decisions)

@MainActor final class PiiRedactionExportsProjectionTests: XCTestCase {
    private func project(
        _ snapshot: PiiRedactionExportsInputSnapshot,
        exportType: PiiRedactionExportType?,
        phase: PiiRedactionExportsStreamPhase,
        streamText: String = ""
    ) -> PiiRedactionExportsProjection {
        PiiRedactionExportsProjection.make(
            snapshot: snapshot, exportType: exportType, phase: phase, streamText: streamText
        )
    }

    func testReadyIdleInviteProjection() {
        let projection = project(
            PiiRedactionExportsInputSnapshot(gate: .on), exportType: nil, phase: .idle
        )
        XCTAssertEqual(projection.renderState, .ready)
        XCTAssertFalse(projection.canStart)
        XCTAssertTrue(projection.buttonDisabled)
        XCTAssertFalse(projection.isStreaming)
        XCTAssertFalse(projection.outputVisible)
        XCTAssertFalse(projection.thinkingVisible)
        XCTAssertEqual(projection.emptyHint, .pickExportType)
        XCTAssertEqual(projection.connection, .live)
    }

    func testChosenTypeEnablesAction() {
        let projection = project(
            PiiRedactionExportsInputSnapshot(gate: .on), exportType: .drives, phase: .idle
        )
        XCTAssertTrue(projection.canStart)
        XCTAssertFalse(projection.buttonDisabled)
        XCTAssertNil(projection.emptyHint)
    }

    func testStreamingProjection() {
        let projection = project(
            PiiRedactionExportsInputSnapshot(gate: .on), exportType: .charging, phase: .streaming
        )
        XCTAssertTrue(projection.isStreaming)
        XCTAssertTrue(projection.buttonDisabled)
        XCTAssertTrue(projection.outputVisible)
        XCTAssertTrue(projection.thinkingVisible)
        XCTAssertNil(projection.emptyHint)
    }

    func testStreamedTextHidesThinking() {
        let projection = project(
            PiiRedactionExportsInputSnapshot(gate: .on),
            exportType: .trips, phase: .streaming, streamText: "Recommended…"
        )
        XCTAssertTrue(projection.outputVisible)
        XCTAssertFalse(projection.thinkingVisible)
    }

    func testOfflineDisablesAction() {
        let projection = project(
            PiiRedactionExportsInputSnapshot(gate: .on, connection: .offline),
            exportType: .backup, phase: .idle
        )
        XCTAssertTrue(projection.canStart)
        XCTAssertTrue(projection.buttonDisabled)
        XCTAssertEqual(projection.connection, .offline)
    }

    func testGateProjectionAxes() {
        XCTAssertEqual(
            project(
                PiiRedactionExportsInputSnapshot(gate: .off), exportType: .drives, phase: .idle
            ).renderState, .gatedOff
        )
        XCTAssertEqual(
            project(
                PiiRedactionExportsInputSnapshot(gate: .loading), exportType: nil, phase: .idle
            ).renderState, .gateLoading
        )
        XCTAssertEqual(
            project(
                PiiRedactionExportsInputSnapshot(gate: .on, errorMessage: "down"),
                exportType: .drives, phase: .idle
            ).renderState, .gateError("down")
        )
    }
}

// MARK: - Accessibility summary

@MainActor final class PiiRedactionExportsAccessibilityTests: XCTestCase {
    private let labels = PiiRedactionExportsAccessibility.Labels(
        title: "Plan PII redactions before sharing",
        thinking: "Helix is thinking…",
        errorLabel: "Helix error:",
        errorUnknown: "unknown"
    )

    func testTitleOnlyWhenIdle() {
        let summary = PiiRedactionExportsAccessibility.summary(labels: labels, phase: .idle, streamText: "")
        XCTAssertEqual(summary, "Plan PII redactions before sharing")
    }

    func testThinkingWhileStreamingWithNoText() {
        let summary = PiiRedactionExportsAccessibility.summary(
            labels: labels, phase: .streaming, streamText: ""
        )
        XCTAssertEqual(summary, "Plan PII redactions before sharing. Helix is thinking…")
    }

    func testStreamedTextIsRead() {
        let summary = PiiRedactionExportsAccessibility.summary(
            labels: labels, phase: .streaming, streamText: "Redact precise GPS"
        )
        XCTAssertEqual(summary, "Plan PII redactions before sharing. Redact precise GPS")
    }

    func testDoneWithTextIsRead() {
        let summary = PiiRedactionExportsAccessibility.summary(
            labels: labels, phase: .done, streamText: "Plan ready"
        )
        XCTAssertEqual(summary, "Plan PII redactions before sharing. Plan ready")
    }

    func testErrorReadsLabelAndMessage() {
        let summary = PiiRedactionExportsAccessibility.summary(
            labels: labels, phase: .error("rate limited"), streamText: ""
        )
        XCTAssertEqual(summary, "Plan PII redactions before sharing. Helix error: rate limited")
    }

    func testEmptyErrorMessageFallsBackToUnknown() {
        let summary = PiiRedactionExportsAccessibility.summary(
            labels: labels, phase: .error(""), streamText: ""
        )
        XCTAssertEqual(summary, "Plan PII redactions before sharing. Helix error: unknown")
    }
}

// MARK: - Surface identity + stream event

@MainActor final class PiiRedactionExportsSurfaceTests: XCTestCase {
    func testSurfaceConstants() {
        XCTAssertEqual(PiiRedactionExportsSurface.slug, "AIPiiRedactionSharedExports")
        XCTAssertEqual(PiiRedactionExportsSurface.featureID, "pii-redaction-shared-exports")
        // The View's public aliases match the non-UI constants (source of truth here so the
        // assertion also runs in the SwiftUI-free harness).
        XCTAssertEqual(AIPiiRedactionSharedExports.surfaceSlug, PiiRedactionExportsSurface.slug)
        XCTAssertEqual(AIPiiRedactionSharedExports.featureID, PiiRedactionExportsSurface.featureID)
    }

    func testStreamEventEquatable() {
        XCTAssertEqual(PiiRedactionExportsStreamEvent.delta(text: "a"), .delta(text: "a"))
        XCTAssertNotEqual(PiiRedactionExportsStreamEvent.delta(text: "a"), .delta(text: "b"))
        XCTAssertNotEqual(
            PiiRedactionExportsStreamEvent.done(finishReason: "stop"), .error(message: "x")
        )
    }
}

// MARK: - i18n facade

@MainActor final class PiiRedactionExportsStringsTests: XCTestCase {
    /// The "AIPiiRedactionSharedExports" table folds in at integration time, so the test bundle
    /// resolves each key to its `value:` fallback — deterministic for assertions.
    func testResolvesKeysToFallback() {
        XCTAssertEqual(
            PiiRedactionExportsStrings.string(
                "exports.aiRedaction.title", "Plan PII redactions before sharing"
            ),
            "Plan PII redactions before sharing"
        )
        XCTAssertEqual(
            PiiRedactionExportsStrings.string("exports.aiRedaction.button", "Suggest redactions"),
            "Suggest redactions"
        )
        XCTAssertEqual(PiiRedactionExportsStrings.string("helix.askHelix", "Ask Helix"), "Ask Helix")
        XCTAssertEqual(PiiRedactionExportsStrings.table, "AIPiiRedactionSharedExports")
    }
}
