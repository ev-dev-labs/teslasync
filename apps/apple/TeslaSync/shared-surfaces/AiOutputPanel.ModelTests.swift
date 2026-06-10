//
//  AiOutputPanel.ModelTests.swift
//  TeslaSync — P4 shared surface · 0036 · AiOutputPanel (Apple)
//
//  Telemetry + render-visibility coverage split out of `…Tests.swift` (one file per the SwiftLint
//  contract): the P1/S11 `view.opened` emission seam (emitted exactly once, the first time the
//  panel is visible; never when hidden; never double-counted), the stable diagnostics slug, and
//  the `AiOutputPanelRender.isVisible` mapping that gates emission. Driven by a spy telemetry; no
//  network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Diagnostics emission seam (P1/S11 view.opened)

@MainActor final class AiOutputPanelDiagnosticsTests: XCTestCase {
    func testEmitsOnceWhenFirstVisible() {
        let spy = SpyAiOutputPanelTelemetry()
        let emitted = AiOutputPanelDiagnostics.openIfVisible(
            render: .text("answer"),
            alreadyEmitted: false,
            telemetry: spy
        )
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [AiOutputPanelSurface.slug])
    }

    func testDoesNotEmitWhenHidden() {
        let spy = SpyAiOutputPanelTelemetry()
        let emitted = AiOutputPanelDiagnostics.openIfVisible(
            render: .hidden,
            alreadyEmitted: false,
            telemetry: spy
        )
        XCTAssertFalse(emitted)
        XCTAssertTrue(spy.surfaces.isEmpty)
    }

    func testDoesNotDoubleEmit() {
        let spy = SpyAiOutputPanelTelemetry()
        var emitted = AiOutputPanelDiagnostics.openIfVisible(
            render: .pending,
            alreadyEmitted: false,
            telemetry: spy
        )
        emitted = AiOutputPanelDiagnostics.openIfVisible(
            render: .text("now answered"),
            alreadyEmitted: emitted,
            telemetry: spy
        )
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [AiOutputPanelSurface.slug])
    }

    func testHiddenThenVisibleEmitsOnTransition() {
        let spy = SpyAiOutputPanelTelemetry()
        // First appear while idle/empty → hidden, nothing emitted.
        var emitted = AiOutputPanelDiagnostics.openIfVisible(
            render: AiOutputPanelLogic.render(text: "", state: .idle, error: nil),
            alreadyEmitted: false,
            telemetry: spy
        )
        XCTAssertFalse(emitted)
        // Stream opens → pending becomes visible → emit once.
        emitted = AiOutputPanelDiagnostics.openIfVisible(
            render: AiOutputPanelLogic.render(text: "", state: .streaming, error: nil),
            alreadyEmitted: emitted,
            telemetry: spy
        )
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [AiOutputPanelSurface.slug])
    }

    func testOSLogTelemetryIsInvokable() {
        // Smoke: the production default conforms and does not trap when invoked.
        OSLogAiOutputPanelTelemetry().viewOpened(surface: AiOutputPanelSurface.slug)
    }
}

// MARK: - Surface identity + render visibility

@MainActor final class AiOutputPanelRenderTests: XCTestCase {
    func testSlugIsStable() {
        XCTAssertEqual(AiOutputPanelSurface.slug, "AiOutputPanel")
        XCTAssertEqual(AiOutputPanel<AiOutputPanelThinkingIndicator>.surfaceSlug, "AiOutputPanel")
    }

    func testIsVisiblePerBranch() {
        XCTAssertFalse(AiOutputPanelRender.hidden.isVisible)
        XCTAssertTrue(AiOutputPanelRender.error(nil).isVisible)
        XCTAssertTrue(AiOutputPanelRender.pending.isVisible)
        XCTAssertTrue(AiOutputPanelRender.text("x").isVisible)
    }

    func testVisibilityAgreesWithHasAnything() {
        for state in AiOutputPanelStreamState.allCases {
            for text in ["", "content"] {
                let render = AiOutputPanelLogic.render(text: text, state: state, error: nil)
                let expected = AiOutputPanelLogic.hasAnything(text: text, state: state)
                XCTAssertEqual(render.isVisible, expected, "state=\(state) text=\"\(text)\"")
            }
        }
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyAiOutputPanelTelemetry: AiOutputPanelTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
