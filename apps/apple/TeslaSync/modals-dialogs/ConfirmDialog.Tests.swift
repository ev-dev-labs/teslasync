//
//  ConfirmDialog.Tests.swift
//  TeslaSync — P4 modal / dialog · 0012 · ConfirmDialog (Apple)
//
//  Adapter + projection + accessibility coverage for the ConfirmDialog surface:
//    • `ConfirmDialogProjection.severity` + `ConfirmSeverity.iconSystemName` — the verbatim
//      `variantToSeverity` + `iconComponents` ports.
//    • `ConfirmDialogProjection.silenceHonored` — the destructive / typed suppression rules.
//    • `ConfirmDialogProjection.typedMatches` + `confirmDisabled` — the typed gate + disabled rule.
//    • `ConfirmDialogProjection.resolvePhase` / `resolveVisibility` / `inlineFailure` — the body
//      phase, the visibility machine (incl. pinned + silence auto-resolve), and the inline envelope.
//    • `ConfirmDialogProjection.confirmLabel` / `cancelLabel` / `typedConfirmationLabel` — the
//      caller-label fallbacks + the `Type "X" to confirm` template.
//    • `ConfirmDialogAccessibility` — the dialog summary, severity-prefixed message, typed-field,
//      and checkbox VoiceOver copy.
//
//  Pure, bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Severity + icon (web variantToSeverity / iconComponents)

final class ConfirmDialogSeverityTests: XCTestCase {
    func testVariantMapsToSeverity() {
        XCTAssertEqual(ConfirmDialogProjection.severity(for: .danger), .critical)
        XCTAssertEqual(ConfirmDialogProjection.severity(for: .warning), .warn)
    }

    func testSeverityIconMirrorsLucide() {
        XCTAssertEqual(ConfirmSeverity.critical.iconSystemName, "exclamationmark.octagon.fill")
        XCTAssertEqual(ConfirmSeverity.warn.iconSystemName, "exclamationmark.triangle.fill")
    }
}

// MARK: - silenceHonored (web silenceHonored)

final class ConfirmDialogSilenceHonoredTests: XCTestCase {
    func testNoKeyIsNeverHonored() {
        XCTAssertFalse(ConfirmDialogProjection.silenceHonored(
            variant: .warning, silenceKey: nil, requireTypedConfirmation: nil
        ))
        XCTAssertFalse(ConfirmDialogProjection.silenceHonored(
            variant: .warning, silenceKey: "", requireTypedConfirmation: nil
        ))
    }

    func testDangerIsNeverHonoredEvenWithKey() {
        XCTAssertFalse(ConfirmDialogProjection.silenceHonored(
            variant: .danger, silenceKey: "remove-widget", requireTypedConfirmation: nil
        ))
    }

    func testTypedConfirmationIsNeverHonored() {
        XCTAssertFalse(ConfirmDialogProjection.silenceHonored(
            variant: .warning, silenceKey: "remove-widget", requireTypedConfirmation: "DELETE"
        ))
    }

    func testWarningWithKeyAndNoTypedIsHonored() {
        XCTAssertTrue(ConfirmDialogProjection.silenceHonored(
            variant: .warning, silenceKey: "remove-widget", requireTypedConfirmation: nil
        ))
    }
}

// MARK: - typedMatches + confirmDisabled (web typedMatches / confirmDisabled)

final class ConfirmDialogGateTests: XCTestCase {
    func testNoGateAlwaysMatches() {
        XCTAssertTrue(ConfirmDialogProjection.typedMatches(requireTypedConfirmation: nil, typed: ""))
        XCTAssertTrue(ConfirmDialogProjection.typedMatches(requireTypedConfirmation: nil, typed: "anything"))
    }

    func testGateMatchesOnlyExactString() {
        XCTAssertFalse(ConfirmDialogProjection.typedMatches(requireTypedConfirmation: "DELETE", typed: ""))
        XCTAssertFalse(ConfirmDialogProjection.typedMatches(requireTypedConfirmation: "DELETE", typed: "delete"))
        XCTAssertTrue(ConfirmDialogProjection.typedMatches(requireTypedConfirmation: "DELETE", typed: "DELETE"))
    }

    func testConfirmDisabledMirrorsWeb() {
        XCTAssertTrue(ConfirmDialogProjection.confirmDisabled(busy: true, typedMatches: true))
        XCTAssertTrue(ConfirmDialogProjection.confirmDisabled(busy: false, typedMatches: false))
        XCTAssertTrue(ConfirmDialogProjection.confirmDisabled(busy: true, typedMatches: false))
        XCTAssertFalse(ConfirmDialogProjection.confirmDisabled(busy: false, typedMatches: true))
    }
}

// MARK: - phase / visibility / inline failure

final class ConfirmDialogVisibilityTests: XCTestCase {
    func testBodyPhase() {
        XCTAssertEqual(ConfirmDialogProjection.resolvePhase(status: .loading, hasRequest: false), .loading)
        XCTAssertEqual(ConfirmDialogProjection.resolvePhase(status: .loading, hasRequest: true), .content)
        XCTAssertEqual(ConfirmDialogProjection.resolvePhase(status: .loaded, hasRequest: false), .empty)
        XCTAssertEqual(ConfirmDialogProjection.resolvePhase(status: .loaded, hasRequest: true), .content)
        XCTAssertEqual(
            ConfirmDialogProjection.resolvePhase(status: .failed("x"), hasRequest: false), .error("x")
        )
        XCTAssertEqual(
            ConfirmDialogProjection.resolvePhase(status: .failed("x"), hasRequest: true), .content
        )
    }

    func testVisibilityPresentsWithRequestAndHidesWithout() {
        XCTAssertEqual(
            ConfirmDialogProjection.resolveVisibility(hasRequest: true, pinned: false, autoResolved: false),
            .presented
        )
        XCTAssertEqual(
            ConfirmDialogProjection.resolveVisibility(hasRequest: false, pinned: false, autoResolved: false),
            .hidden
        )
    }

    func testPinnedSuppressesAmbientHide() {
        XCTAssertEqual(
            ConfirmDialogProjection.resolveVisibility(hasRequest: false, pinned: true, autoResolved: false),
            .presented
        )
    }

    func testAutoResolvedAlwaysHides() {
        XCTAssertEqual(
            ConfirmDialogProjection.resolveVisibility(hasRequest: true, pinned: true, autoResolved: true),
            .hidden
        )
    }

    func testInlineFailureEnvelope() {
        XCTAssertEqual(
            ConfirmDialogProjection.inlineFailure(status: .failed("boom"), hasRequest: true), "boom"
        )
        XCTAssertNil(ConfirmDialogProjection.inlineFailure(status: .failed("boom"), hasRequest: false))
        XCTAssertNil(ConfirmDialogProjection.inlineFailure(status: .loaded, hasRequest: true))
    }
}

// MARK: - Caller labels (web confirmLabel / cancelLabel / inputLabel)

final class ConfirmDialogLabelTests: XCTestCase {
    private func request(
        confirm: String? = nil,
        cancel: String? = nil,
        required: String? = nil,
        typedLabel: String? = nil
    ) -> ConfirmRequest {
        ConfirmRequest(
            title: "t",
            message: "m",
            confirmLabel: confirm,
            cancelLabel: cancel,
            requireTypedConfirmation: required,
            typedConfirmationLabel: typedLabel
        )
    }

    func testConfirmLabelFallsBackToDefault() {
        XCTAssertEqual(ConfirmDialogProjection.confirmLabel(request(), localize: passthroughLocalize), "Confirm")
        XCTAssertEqual(
            ConfirmDialogProjection.confirmLabel(request(confirm: "Delete"), localize: passthroughLocalize),
            "Delete"
        )
    }

    func testCancelLabelFallsBackToDefault() {
        XCTAssertEqual(ConfirmDialogProjection.cancelLabel(request(), localize: passthroughLocalize), "Cancel")
        XCTAssertEqual(
            ConfirmDialogProjection.cancelLabel(request(cancel: "Keep"), localize: passthroughLocalize),
            "Keep"
        )
    }

    func testTypedLabelTemplateAndOverride() {
        // No gate → empty label.
        XCTAssertEqual(
            ConfirmDialogProjection.typedConfirmationLabel(request(), localize: passthroughLocalize), ""
        )
        // Gate with no override → template with the required string substituted.
        XCTAssertEqual(
            ConfirmDialogProjection.typedConfirmationLabel(
                request(required: "Model 3"), localize: passthroughLocalize
            ),
            "Type \"Model 3\" to confirm"
        )
        // Caller override wins.
        XCTAssertEqual(
            ConfirmDialogProjection.typedConfirmationLabel(
                request(required: "Model 3", typedLabel: "Enter the name"), localize: passthroughLocalize
            ),
            "Enter the name"
        )
    }
}

// MARK: - Accessibility

final class ConfirmDialogAccessibilityTests: XCTestCase {
    func testSummaryUsesTitleAndFallsBack() {
        XCTAssertEqual(
            ConfirmDialogAccessibility.summary(title: "Delete vehicle?", localize: passthroughLocalize),
            "Delete vehicle?"
        )
        XCTAssertEqual(
            ConfirmDialogAccessibility.summary(title: "", localize: passthroughLocalize), "Confirm"
        )
    }

    func testMessageLabelPrefixesSeverity() {
        XCTAssertEqual(
            ConfirmDialogAccessibility.messageLabel(
                severity: .critical, message: "This is permanent.", localize: passthroughLocalize
            ),
            "Critical. This is permanent."
        )
        XCTAssertEqual(
            ConfirmDialogAccessibility.messageLabel(
                severity: .warn, message: "Heads up.", localize: passthroughLocalize
            ),
            "Warning. Heads up."
        )
    }

    func testSilenceLabelAppendsCheckedState() {
        XCTAssertEqual(
            ConfirmDialogAccessibility.silenceLabel(checked: true, localize: passthroughLocalize),
            "Don't ask again for this action, Checked"
        )
        XCTAssertEqual(
            ConfirmDialogAccessibility.silenceLabel(checked: false, localize: passthroughLocalize),
            "Don't ask again for this action, Unchecked"
        )
    }

    func testTypedFieldLabelPassesThrough() {
        XCTAssertEqual(
            ConfirmDialogAccessibility.typedFieldLabel("Type \"X\" to confirm"), "Type \"X\" to confirm"
        )
    }
}
