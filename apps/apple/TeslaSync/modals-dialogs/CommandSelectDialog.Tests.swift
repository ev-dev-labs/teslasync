//
//  CommandSelectDialog.Tests.swift
//  TeslaSync — P4 modal / dialog · 0031 · CommandSelectDialog (Apple)
//
//  Adapter + projection + accessibility coverage for the CommandSelectDialog surface:
//    • `CommandSelectProjection.resolvePhase` — the loading / empty / error / content envelope rules,
//      including keeping content while a delivered request survives a failed reload.
//    • `CommandSelectProjection.resolveVisibility` — the web early-return (request → presented, none →
//      hidden, `pinned` suppresses the ambient hide).
//    • `CommandSelectProjection.inlineFailure` — the cached-request-with-failure inline error.
//    • `CommandSelectProjection.cancelLabel` / `title` — the copy + the default-icon / dialog
//      fallbacks.
//    • `CommandSelectRequest` — the empty-icon → default-icon normalization.
//    • `CommandSelectAccessibility` — the dialog summary + the option label (with description + busy
//      suffix) + the close label.
//
//  Pure, bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy without
/// a bundle.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

private func option(
    _ value: String,
    label: String = "Option",
    description: String? = nil
) -> CommandSelectOption {
    CommandSelectOption(value: value, label: label, description: description)
}

private func request(
    options: [CommandSelectOption] = [option("a", label: "Rear trunk")],
    title: String = "Open trunk",
    icon: String = "shippingbox",
    loading: Bool = false
) -> CommandSelectRequest {
    CommandSelectRequest(id: "trunk", title: title, iconSystemName: icon, options: options, loading: loading)
}

// MARK: - Phase resolution

final class CommandSelectPhaseTests: XCTestCase {
    func testNoRequestResolvesByStatus() {
        XCTAssertEqual(
            CommandSelectProjection.resolvePhase(status: .loading, hasRequest: false, hasOptions: false),
            .loading
        )
        XCTAssertEqual(
            CommandSelectProjection.resolvePhase(status: .loaded, hasRequest: false, hasOptions: false),
            .empty
        )
        XCTAssertEqual(
            CommandSelectProjection.resolvePhase(status: .failed("boom"), hasRequest: false, hasOptions: false),
            .error("boom")
        )
    }

    func testRequestWithOptionsResolvesContent() {
        for status: CommandSelectLoadStatus in [.loading, .loaded, .failed("stale")] {
            XCTAssertEqual(
                CommandSelectProjection.resolvePhase(status: status, hasRequest: true, hasOptions: true),
                .content
            )
        }
    }

    func testRequestWithoutOptionsResolvesEmpty() {
        for status: CommandSelectLoadStatus in [.loading, .loaded, .failed("stale")] {
            XCTAssertEqual(
                CommandSelectProjection.resolvePhase(status: status, hasRequest: true, hasOptions: false),
                .empty
            )
        }
    }
}

// MARK: - Visibility resolution

final class CommandSelectVisibilityTests: XCTestCase {
    func testRequestPresents() {
        XCTAssertEqual(
            CommandSelectProjection.resolveVisibility(hasRequest: true, pinned: false),
            .presented
        )
    }

    func testNoRequestHidesUnlessPinned() {
        XCTAssertEqual(
            CommandSelectProjection.resolveVisibility(hasRequest: false, pinned: false),
            .hidden
        )
        XCTAssertEqual(
            CommandSelectProjection.resolveVisibility(hasRequest: false, pinned: true),
            .presented
        )
    }
}

// MARK: - Inline failure

final class CommandSelectInlineFailureTests: XCTestCase {
    func testInlineFailureOnlyWhenCachedRequestSurvivesFailure() {
        XCTAssertEqual(
            CommandSelectProjection.inlineFailure(status: .failed("retry me"), hasRequest: true),
            "retry me"
        )
        XCTAssertNil(CommandSelectProjection.inlineFailure(status: .failed("x"), hasRequest: false))
        XCTAssertNil(CommandSelectProjection.inlineFailure(status: .loaded, hasRequest: true))
        XCTAssertNil(CommandSelectProjection.inlineFailure(status: .loading, hasRequest: true))
    }
}

// MARK: - Copy + request normalization

final class CommandSelectCopyTests: XCTestCase {
    func testCancelLabel() {
        XCTAssertEqual(CommandSelectProjection.cancelLabel(localize: passthroughLocalize), "Cancel")
    }

    func testTitleUsesRequestTitleElseFallback() {
        XCTAssertEqual(
            CommandSelectProjection.title(request(title: "Open trunk"), localize: passthroughLocalize),
            "Open trunk"
        )
        XCTAssertEqual(
            CommandSelectProjection.title(request(title: ""), localize: passthroughLocalize),
            "Select an option"
        )
        XCTAssertEqual(
            CommandSelectProjection.title(nil, localize: passthroughLocalize),
            "Select an option"
        )
    }

    func testEmptyIconNormalizesToDefault() {
        XCTAssertEqual(request(icon: "").iconSystemName, CommandSelectProjection.defaultIcon)
        XCTAssertEqual(request(icon: "bolt.fill").iconSystemName, "bolt.fill")
    }

    func testOptionIdentityIsValue() {
        XCTAssertEqual(option("rear").id, "rear")
    }
}

// MARK: - Accessibility

final class CommandSelectAccessibilityTests: XCTestCase {
    func testSummaryIsTitle() {
        XCTAssertEqual(
            CommandSelectAccessibility.summary(request: request(title: "Open trunk"), localize: passthroughLocalize),
            "Open trunk"
        )
        XCTAssertEqual(
            CommandSelectAccessibility.summary(request: nil, localize: passthroughLocalize),
            "Select an option"
        )
    }

    func testCloseLabel() {
        XCTAssertEqual(CommandSelectAccessibility.closeLabel(localize: passthroughLocalize), "Close")
    }

    func testOptionLabelCombinesLabelAndDescription() {
        XCTAssertEqual(
            CommandSelectAccessibility.optionLabel(
                label: "Rear trunk",
                description: "Open or close the rear trunk",
                busy: false,
                localize: passthroughLocalize
            ),
            "Rear trunk, Open or close the rear trunk"
        )
    }

    func testOptionLabelWithoutDescription() {
        XCTAssertEqual(
            CommandSelectAccessibility.optionLabel(
                label: "Off",
                description: nil,
                busy: false,
                localize: passthroughLocalize
            ),
            "Off"
        )
    }

    func testOptionLabelAppendsBusySuffix() {
        XCTAssertEqual(
            CommandSelectAccessibility.optionLabel(
                label: "Off",
                description: nil,
                busy: true,
                localize: passthroughLocalize
            ),
            "Off, Sending…"
        )
    }
}
