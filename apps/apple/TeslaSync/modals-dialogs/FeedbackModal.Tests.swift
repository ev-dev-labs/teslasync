//
//  FeedbackModal.Tests.swift
//  TeslaSync — P4 modal/dialog · 0004 · FeedbackModal (Apple)
//
//  Adapter + projection + accessibility coverage for the FeedbackModal surface:
//    • `FeedbackCategory` — the three categories in web `categoryOptions` order with their i18n keys
//      + glyphs.
//    • `FeedbackLimits` — the web `FEEDBACK_*` constants.
//    • `FeedbackValidation` — the zod min/max on the RAW value (title 5–120, body 20–4000).
//    • `FeedbackProjection` — context-phase resolution, the submit guard, the console-tail truncation
//      (last `CONSOLE_TAIL_MAX`), and the validated submission assembly (trim + conditional attach).
//    • `FeedbackAccessibility` — the dialog summary + context-row + submit-button VoiceOver content.
//
//  Pure, bundle-free: copy resolves through an identity localizer.
//

import XCTest
@testable import TeslaSync

/// Identity localizer: returns each call's English fallback so assertions read the real copy without
/// a bundle.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

// MARK: - Category catalog (web categoryOptions)

final class FeedbackCategoryTests: XCTestCase {
    func testOrderMatchesWebCategoryOptions() {
        XCTAssertEqual(FeedbackCategory.order.map(\.rawValue), ["bug", "feature", "other"])
    }

    func testEveryOptionCarriesKeyGlyphAndLabel() {
        for category in FeedbackCategory.order {
            let option = category.option
            XCTAssertEqual(option.labelKey, "feedback.category.\(category.rawValue)")
            XCTAssertFalse(option.labelFallback.isEmpty)
            XCTAssertFalse(option.systemImage.isEmpty)
        }
    }

    func testOptionFallbacksMatchWeb() {
        XCTAssertEqual(FeedbackCategory.bug.option.labelFallback, "Bug report")
        XCTAssertEqual(FeedbackCategory.feature.option.labelFallback, "Feature request")
        XCTAssertEqual(FeedbackCategory.other.option.labelFallback, "Other / question")
    }
}

// MARK: - Limits (web FEEDBACK_* constants)

final class FeedbackLimitsTests: XCTestCase {
    func testBoundsMatchWebConstants() {
        XCTAssertEqual(FeedbackLimits.titleMin, 5)
        XCTAssertEqual(FeedbackLimits.titleMax, 120)
        XCTAssertEqual(FeedbackLimits.bodyMin, 20)
        XCTAssertEqual(FeedbackLimits.bodyMax, 4000)
        XCTAssertEqual(FeedbackLimits.consoleTailMax, 4000)
    }
}

// MARK: - Validation (web zod min/max on the raw value)

final class FeedbackValidationTests: XCTestCase {
    func testTitleTooShort() {
        XCTAssertEqual(FeedbackValidation.titleError("hi"), .tooShort(min: 5))
        XCTAssertEqual(FeedbackValidation.titleError(""), .tooShort(min: 5))
    }

    func testTitleValidAtBounds() {
        XCTAssertNil(FeedbackValidation.titleError("12345"))
        XCTAssertNil(FeedbackValidation.titleError(String(repeating: "a", count: 120)))
    }

    func testTitleTooLong() {
        XCTAssertEqual(FeedbackValidation.titleError(String(repeating: "a", count: 121)), .tooLong(max: 120))
    }

    func testBodyTooShortAndValidAndTooLong() {
        XCTAssertEqual(FeedbackValidation.bodyError("too short"), .tooShort(min: 20))
        XCTAssertNil(FeedbackValidation.bodyError(String(repeating: "x", count: 20)))
        XCTAssertNil(FeedbackValidation.bodyError(String(repeating: "x", count: 4000)))
        XCTAssertEqual(FeedbackValidation.bodyError(String(repeating: "x", count: 4001)), .tooLong(max: 4000))
    }

    func testIsValidRequiresBothFields() {
        XCTAssertTrue(FeedbackValidation.isValid(title: "Valid title", body: String(repeating: "x", count: 25)))
        XCTAssertFalse(FeedbackValidation.isValid(title: "ok", body: String(repeating: "x", count: 25)))
        XCTAssertFalse(FeedbackValidation.isValid(title: "Valid title", body: "short"))
    }
}

// MARK: - Projection: context phase

final class FeedbackContextPhaseTests: XCTestCase {
    private let context = FeedbackContext(pageRoute: "/dash", appVersion: "1.0", userAgent: "iOS")
    private let blank = FeedbackContext(pageRoute: "", appVersion: "", userAgent: "")

    func testLoadingResolvesByContextPresence() {
        XCTAssertEqual(FeedbackProjection.resolveContextPhase(status: .loading, context: nil), .loading)
        XCTAssertEqual(FeedbackProjection.resolveContextPhase(status: .loading, context: context), .content)
    }

    func testLoadedNoContextOrBlankResolvesEmpty() {
        XCTAssertEqual(FeedbackProjection.resolveContextPhase(status: .loaded, context: nil), .empty)
        XCTAssertEqual(FeedbackProjection.resolveContextPhase(status: .loaded, context: blank), .empty)
    }

    func testLoadedWithDiagnosticsResolvesContent() {
        XCTAssertEqual(FeedbackProjection.resolveContextPhase(status: .loaded, context: context), .content)
    }

    func testFailedResolvesErrorOrKeepsContent() {
        XCTAssertEqual(
            FeedbackProjection.resolveContextPhase(status: .failed("boom"), context: nil),
            .error("boom")
        )
        XCTAssertEqual(FeedbackProjection.resolveContextPhase(status: .failed("boom"), context: context), .content)
    }

    func testHasDiagnosticsDetectsAnySignal() {
        XCTAssertFalse(FeedbackProjection.hasDiagnostics(blank))
        XCTAssertTrue(FeedbackProjection.hasDiagnostics(context))
        let errorsOnly = FeedbackContext(
            pageRoute: "",
            appVersion: "",
            userAgent: "",
            recentErrors: [FeedbackErrorReport(name: "E", message: "m", route: "/r", occurredAt: "t")]
        )
        XCTAssertTrue(FeedbackProjection.hasDiagnostics(errorsOnly))
        let tailOnly = FeedbackContext(pageRoute: "", appVersion: "", userAgent: "", consoleTail: "log")
        XCTAssertTrue(FeedbackProjection.hasDiagnostics(tailOnly))
    }
}

// MARK: - Projection: console-tail truncation

final class FeedbackConsoleTailTests: XCTestCase {
    func testShortTailUnchanged() {
        XCTAssertEqual(FeedbackProjection.truncatedTail("only a few lines"), "only a few lines")
    }

    func testLongTailKeepsLastWindow() {
        let tail = String(repeating: "a", count: 3999) + "TAIL"
        let result = FeedbackProjection.truncatedTail(tail)
        XCTAssertEqual(result.count, FeedbackLimits.consoleTailMax)
        XCTAssertTrue(result.hasSuffix("TAIL"))
    }
}

// MARK: - Projection: submission assembly (web onSubmit)

final class FeedbackSubmissionTests: XCTestCase {
    private func context(errors: Int = 1, tail: String = "console output") -> FeedbackContext {
        let reports = (0 ..< errors).map { index in
            FeedbackErrorReport(name: "E\(index)", message: "m", route: "/r", occurredAt: "t\(index)")
        }
        return FeedbackContext(
            pageRoute: "/vehicles/1",
            appVersion: "1.2.3",
            userAgent: "TeslaSync iOS",
            recentErrors: reports,
            consoleTail: tail
        )
    }

    private func attach(errors: Bool = false, console: Bool = false) -> FeedbackAttachments {
        FeedbackAttachments(includeRecentErrors: errors, includeConsoleTail: console)
    }

    func testSubmissionTrimsAndCopiesContext() {
        let submission = FeedbackProjection.submission(
            category: .bug,
            title: "  A clear title  ",
            body: "  " + String(repeating: "x", count: 25) + "  ",
            context: context(),
            attachments: attach()
        )
        XCTAssertEqual(submission?.category, .bug)
        XCTAssertEqual(submission?.title, "A clear title")
        XCTAssertEqual(submission?.body, String(repeating: "x", count: 25))
        XCTAssertEqual(submission?.pageRoute, "/vehicles/1")
        XCTAssertEqual(submission?.appVersion, "1.2.3")
        XCTAssertEqual(submission?.userAgent, "TeslaSync iOS")
        XCTAssertNil(submission?.recentErrors)
        XCTAssertNil(submission?.consoleTail)
    }

    func testAttachesRecentErrorsOnlyWhenToggledAndPresent() {
        let on = FeedbackProjection.submission(
            category: .bug, title: "Valid title", body: String(repeating: "x", count: 25),
            context: context(errors: 2), attachments: attach(errors: true)
        )
        XCTAssertEqual(on?.recentErrors?.count, 2)
        let noneCaptured = FeedbackProjection.submission(
            category: .bug, title: "Valid title", body: String(repeating: "x", count: 25),
            context: context(errors: 0), attachments: attach(errors: true)
        )
        XCTAssertNil(noneCaptured?.recentErrors)
    }

    func testAttachesConsoleTailOnlyWhenToggledAndNonEmpty() {
        let on = FeedbackProjection.submission(
            category: .other, title: "Valid title", body: String(repeating: "x", count: 25),
            context: context(tail: "the tail"), attachments: attach(console: true)
        )
        XCTAssertEqual(on?.consoleTail, "the tail")
        let emptyTail = FeedbackProjection.submission(
            category: .other, title: "Valid title", body: String(repeating: "x", count: 25),
            context: context(tail: ""), attachments: attach(console: true)
        )
        XCTAssertNil(emptyTail?.consoleTail)
    }

    func testConsoleTailTruncatedInSubmission() {
        let long = String(repeating: "a", count: 4100)
        let submission = FeedbackProjection.submission(
            category: .other, title: "Valid title", body: String(repeating: "x", count: 25),
            context: context(tail: long), attachments: attach(console: true)
        )
        XCTAssertEqual(submission?.consoleTail?.count, FeedbackLimits.consoleTailMax)
    }

    func testSubmissionNilWhenInvalid() {
        XCTAssertNil(FeedbackProjection.submission(
            category: .bug, title: "no", body: String(repeating: "x", count: 25),
            context: context(), attachments: attach()
        ))
        XCTAssertNil(FeedbackProjection.submission(
            category: .bug, title: "Valid title", body: "short",
            context: context(), attachments: attach()
        ))
    }

    func testCanSubmitMatchesValidation() {
        XCTAssertTrue(FeedbackProjection.canSubmit(title: "Valid title", body: String(repeating: "x", count: 20)))
        XCTAssertFalse(FeedbackProjection.canSubmit(title: "no", body: String(repeating: "x", count: 20)))
    }
}

// MARK: - Accessibility

final class FeedbackAccessibilityTests: XCTestCase {
    func testSummaryIsDialogTitle() {
        XCTAssertEqual(
            FeedbackAccessibility.summary(localize: passthroughLocalize),
            "Report a bug / Send feedback"
        )
    }

    func testContextRowLabelCombinesLabelAndValue() {
        XCTAssertEqual(
            FeedbackAccessibility.contextRowLabel(label: "Page", value: "/dash"),
            "Page: /dash"
        )
    }

    func testSubmitLabelReflectsInFlightState() {
        XCTAssertEqual(
            FeedbackAccessibility.submitLabel(submitting: false, localize: passthroughLocalize),
            "Send feedback"
        )
        XCTAssertEqual(
            FeedbackAccessibility.submitLabel(submitting: true, localize: passthroughLocalize),
            "Submitting…"
        )
    }
}
