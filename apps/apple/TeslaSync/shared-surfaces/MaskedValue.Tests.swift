//
//  MaskedValue.Tests.swift
//  TeslaSync — P4 shared surface · 0220 · MaskedValue (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure masking rules + value
//  types live in MaskedValue.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • MaskedValueModel — the once-only `view.opened`, the reveal/hide/toggle flow, the auto-hide arm +
//      cancel, the reveal-audit firing ONLY when opted in (web `auditOnReveal`), the empty-value no-op,
//      the props-update guard + empty-collapse, and the reset-to-masked on teardown.
//    • Views — the public surface + the subviews compose in every branch; the revealed → token tint
//      projection resolves.
//    • Strings — the toggle + copy labels resolve through the P1/S10 facade with the English fallbacks
//      (byte-identical to the web copy); the audit kind constant matches the web POST body.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure and
//  the auto-hide arming is asserted via the model's synchronous `isAutoHideArmed` seam (no real sleeping).
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - MaskedValueModel (interaction lifecycle + derivation)

@MainActor
final class MaskedValueModelTests: XCTestCase {
    private func model(
        _ input: MaskedValueInput,
        auditRecorder: any MaskedValueAuditRecorder = OSLogMaskedValueAuditRecorder(),
        telemetry: any MaskedValueTelemetry = OSLogMaskedValueTelemetry()
    ) -> MaskedValueModel {
        MaskedValueModel(input: input, auditRecorder: auditRecorder, telemetry: telemetry)
    }

    private func input(
        _ value: String?,
        variant: MaskVariant = .token,
        auditOnReveal: Bool = false,
        autoHideMs: Int = MaskedValueInput.defaultAutoHideMs
    ) -> MaskedValueInput {
        MaskedValueInput(
            value: value,
            variant: variant,
            auditOnReveal: auditOnReveal,
            ariaLabel: "Secret",
            autoHideMs: autoHideMs
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyMaskedValueTelemetry()
        let masked = model(input("secret"), telemetry: spy)
        masked.start()
        masked.start()
        XCTAssertEqual(spy.surfaces, [MaskedValueSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyMaskedValueTelemetry()
        let masked = model(input("secret"), telemetry: spy)
        masked.start()
        masked.stop()
        masked.start()
        XCTAssertEqual(spy.surfaces, [MaskedValueSurface.slug], "view.opened fires once per instance")
    }

    func testRevealShowsCleartextAndArmsAutoHide() {
        let masked = model(input("secret", autoHideMs: 30000))
        XCTAssertFalse(masked.revealed)
        masked.reveal()
        XCTAssertTrue(masked.revealed)
        XCTAssertTrue(masked.isAutoHideArmed)
    }

    func testHideMasksAndCancelsAutoHide() {
        let masked = model(input("secret", autoHideMs: 30000))
        masked.reveal()
        masked.hide()
        XCTAssertFalse(masked.revealed)
        XCTAssertFalse(masked.isAutoHideArmed)
    }

    func testToggleAlternatesRevealState() {
        let masked = model(input("secret", autoHideMs: 0))
        masked.toggle()
        XCTAssertTrue(masked.revealed)
        masked.toggle()
        XCTAssertFalse(masked.revealed)
    }

    func testRevealIsNoOpWhenEmpty() {
        let masked = model(input(nil))
        masked.reveal()
        XCTAssertFalse(masked.revealed)
        XCTAssertFalse(masked.isAutoHideArmed)
    }

    func testAutoHideDisabledWhenZero() {
        let masked = model(input("secret", autoHideMs: 0))
        masked.reveal()
        XCTAssertTrue(masked.revealed)
        XCTAssertFalse(masked.isAutoHideArmed)
    }

    func testRevealRecordsAuditOnlyWhenOptedIn() {
        let optedOut = RecordingMaskedValueAuditRecorder()
        let mOut = model(input("secret", auditOnReveal: false, autoHideMs: 0), auditRecorder: optedOut)
        mOut.reveal()
        XCTAssertEqual(optedOut.variants, [], "no audit when auditOnReveal is false (web default)")

        let optedIn = RecordingMaskedValueAuditRecorder()
        let mIn = model(
            input("secret", variant: .vin, auditOnReveal: true, autoHideMs: 0),
            auditRecorder: optedIn
        )
        mIn.reveal()
        XCTAssertEqual(optedIn.variants, ["vin"], "audit fires with the variant payload when opted in")
    }

    func testUpdateGuardsIdenticalAndCollapsesOnEmpty() {
        let masked = model(input("secret", autoHideMs: 30000))
        masked.reveal()
        masked.update(input("secret", autoHideMs: 30000)) // identical → still revealed
        XCTAssertTrue(masked.revealed)
        masked.update(input(nil)) // value cleared → collapse to masked + cancel timer
        XCTAssertFalse(masked.revealed)
        XCTAssertFalse(masked.isAutoHideArmed)
        XCTAssertTrue(masked.projection.isEmpty)
    }

    func testStopResetsToMasked() {
        let masked = model(input("secret", autoHideMs: 30000))
        masked.reveal()
        masked.stop()
        XCTAssertFalse(masked.revealed)
        XCTAssertFalse(masked.isAutoHideArmed)
    }

    func testProjectionReflectsInput() {
        let masked = model(input("ABCDEFGH", variant: .token))
        XCTAssertFalse(masked.projection.isEmpty)
        XCTAssertEqual(masked.projection.rawText, "ABCDEFGH")
        XCTAssertEqual(masked.projection.variant, .token)
    }
}

// MARK: - Views (every branch composes + tone projection)

@MainActor
final class MaskedValueViewTests: XCTestCase {
    func testSurfaceComposesForEveryVariant() {
        for variant in MaskVariant.allCases {
            _ = MaskedValue(value: "5YJ3E1EA7JF000316", variant: variant, ariaLabel: "Secret")
        }
    }

    func testSurfaceComposesForEveryBranch() {
        _ = MaskedValue(value: "token-value", variant: .token, copyable: true, ariaLabel: "Token")
        _ = MaskedValue(value: nil, variant: .token, ariaLabel: "Token") // empty branch
        _ = MaskedValue(
            value: "5YJ3E1EA7JF000316",
            variant: .vin,
            copyable: true,
            auditOnReveal: true,
            ariaLabel: "VIN",
            autoHideMs: 0
        )
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = MaskedValueModel(
            input: MaskedValueInput(value: "secret", variant: .generic, ariaLabel: "Secret"),
            telemetry: SpyMaskedValueTelemetry()
        )
        _ = MaskedValue(model: injected)
        XCTAssertEqual(MaskedValue.surfaceSlug, "MaskedValue")
    }

    func testSubviewsCompose() {
        let projection = MaskedValueProjector.resolve(
            MaskedValueInput(value: "ABCDEFGH", variant: .token, copyable: true, ariaLabel: "Token"),
            revealLabel: MaskedValueStrings.reveal,
            hideLabel: MaskedValueStrings.hide,
            copyLabel: MaskedValueStrings.copy
        )
        _ = MaskedValueCodeText(projection: projection, revealed: false)
        _ = MaskedValueCodeText(projection: projection, revealed: true)
        _ = MaskedValueToggle(projection: projection, revealed: false, onToggle: {})
        _ = MaskedValueEmptyView(glyph: "\u{2014}", accessibilityLabel: "Token")
        _ = MaskedValueContainer(projection: projection, revealed: false, onToggle: {})
    }

    func testCodeToneProjection() {
        XCTAssertEqual(MaskedValueCodeText.tone(revealed: true), Color.TS.accent)
        XCTAssertEqual(MaskedValueCodeText.tone(revealed: false), Color.TS.textSecondary)
    }
}

// MARK: - Strings facade (P1/S10) + audit constant

final class MaskedValueStringsTests: XCTestCase {
    func testToggleAndCopyLabelFallbacks() {
        XCTAssertEqual(MaskedValueStrings.reveal, "Reveal value")
        XCTAssertEqual(MaskedValueStrings.hide, "Hide value")
        XCTAssertEqual(MaskedValueStrings.copy, "Copy value")
    }

    func testAuditKindMatchesWebPayload() {
        XCTAssertEqual(MaskedValueAudit.kind, "masked_reveal")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyMaskedValueTelemetry: MaskedValueTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}

/// Records each `recordReveal` variant so the audit-opt-in contract can be asserted. Lock-guarded for the
/// `Sendable` audit seam under Swift 6 strict concurrency.
private final class RecordingMaskedValueAuditRecorder: MaskedValueAuditRecorder, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var variants: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func recordReveal(variant: String) {
        lock.lock()
        storage.append(variant)
        lock.unlock()
    }
}
