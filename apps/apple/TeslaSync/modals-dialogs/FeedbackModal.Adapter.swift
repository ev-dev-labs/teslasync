//
//  FeedbackModal.Adapter.swift
//  TeslaSync — P4 modal/dialog · 0004 · FeedbackModal (Apple)
//
//  The testable projection core for the in-app feedback / bug-report dialog — the faithful port of
//  components/feedback/FeedbackModal.tsx. The web source is a `Modal` wrapping a form: a category
//  `<Select>` (bug / feature / other), a required title `<Input>` (5–120 chars), a required details
//  `<Textarea>` (20–4000 chars), an "Auto-attached context" panel (page route + app version + the
//  client user-agent, plus two consent toggles — attach recent errors, default ON; attach recent
//  console messages, default OFF), an inline submit error, and the Cancel / Send-feedback footer.
//  On submit it POSTs a `FeedbackSubmitInput` (category, title, body, page_route, user_agent,
//  app_version, and the optionally-attached recent_errors + console_tail).
//
//  Everything here is pure and dependency-free (Foundation only) so the projection — the category
//  catalog, the validation bounds (the web `FEEDBACK_*` constants + the zod min/max), the context
//  phase resolution, the submit-enabled predicate, the console-tail truncation, and the validated
//  submission assembly — can be unit-tested without a network, a bundle, or a rendered view.
//
//  Web parity notes:
//    • `FeedbackModalCategory` union + `categoryOptions`     → `FeedbackModalCategory` + `.option`.
//    • `FEEDBACK_TITLE_MIN/MAX`, `FEEDBACK_BODY_MIN/MAX` → `FeedbackLimits`.
//    • zod `safeParse` (raw length min/max)              → `FeedbackValidation` (raw `count`).
//    • `getConsoleTail()` last-`CONSOLE_TAIL_MAX` slice  → `FeedbackProjection.truncatedTail`.
//    • `onSubmit` payload assembly (trim + conditional   → `FeedbackProjection.submission(...)`.
//      recent_errors / console_tail attach)
//    • The web always renders the form; `resolveContextPhase` widens the auto-context panel into the
//      prompt-required loading / empty / error envelopes so that section is never a blank box, while
//      the form itself stays on screen (matching the ShareDriveDialog section-scoped phase pattern).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, kept in the dependency-free
/// core so the projection's unit tests can reach it.
public enum FeedbackSurface {
    public static let slug = "FeedbackModal"
}

// MARK: - Validation bounds (web FEEDBACK_* constants)

/// The field bounds ported verbatim from the web module constants: the title 5–120 / body 20–4000
/// zod range and the 4000-char console-tail cap.
public enum FeedbackLimits {
    public static let titleMin = 5
    public static let titleMax = 120
    public static let bodyMin = 20
    public static let bodyMax = 4000
    public static let consoleTailMax = 4000
}

// MARK: - Category (web `FeedbackModalCategory` + `categoryOptions`)

/// One feedback category — the native parity of the web `FeedbackModalCategory` union. Order matches the
/// web `categoryOptions` array so the selector renders identically.
public enum FeedbackModalCategory: String, Sendable, Equatable, CaseIterable, Identifiable {
    case bug
    case feature
    case other

    public var id: String {
        rawValue
    }

    /// The display order (web `categoryOptions`).
    public static let order: [FeedbackModalCategory] = [.bug, .feature, .other]
}

/// A display-ready category descriptor: the i18n key + web English fallback for the option label and
/// the SF Symbol that stands in for the category in the native selector.
public struct FeedbackCategoryOption: Sendable, Equatable, Identifiable {
    public let category: FeedbackModalCategory
    public let labelKey: String
    public let labelFallback: String
    public let systemImage: String

    public var id: String {
        category.rawValue
    }

    public init(category: FeedbackModalCategory, labelKey: String, labelFallback: String, systemImage: String) {
        self.category = category
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.systemImage = systemImage
    }
}

public extension FeedbackModalCategory {
    /// This category's display descriptor. Labels mirror `t('feedback.category.<id>', '<Label>')`; the
    /// glyph maps the category to its closest SF Symbol.
    var option: FeedbackCategoryOption {
        switch self {
        case .bug:
            .init(
                category: .bug,
                labelKey: "feedback.category.bug",
                labelFallback: "Bug report",
                systemImage: "ladybug.fill"
            )
        case .feature:
            .init(
                category: .feature,
                labelKey: "feedback.category.feature",
                labelFallback: "Feature request",
                systemImage: "lightbulb.fill"
            )
        case .other:
            .init(
                category: .other,
                labelKey: "feedback.category.other",
                labelFallback: "Other / question",
                systemImage: "questionmark.bubble.fill"
            )
        }
    }
}

// MARK: - Context load status / freshness / render phase

/// The bound source's load status for the auto-attached diagnostics context. The web reads its
/// context synchronously (location / navigator / errorReporter); the native surface models the
/// gather lifecycle here so every state renders.
public enum FeedbackContextStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so the dialog
/// labels when the gathered diagnostics may be out of date.
public enum FeedbackConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the auto-attached-context panel renders. The web always shows the panel; the loading /
/// empty / error envelopes are added so that section is never a blank box.
public enum FeedbackContextPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Diagnostics context + error report (web errorReporter `FeedbackErrorReport`)

/// One captured frontend error report — the native parity of the web `FeedbackErrorReport`
/// (errorReporter ring buffer). Attached to the submission when the user opts in.
public struct FeedbackErrorReport: Sendable, Equatable, Identifiable {
    public let name: String
    public let message: String
    public let stack: String?
    public let route: String
    public let occurredAt: String

    public var id: String {
        "\(occurredAt)|\(name)|\(message)"
    }

    public init(name: String, message: String, stack: String? = nil, route: String, occurredAt: String) {
        self.name = name
        self.message = message
        self.stack = stack
        self.route = route
        self.occurredAt = occurredAt
    }
}

/// The auto-collected context a source resolves, shown to the user before submit so nothing ships
/// without consent (web `page_route` / `app_version` / `user_agent` + the errorReporter ring + the
/// console tail). `userAgent` is the native client-identity string (the web `navigator.userAgent`
/// analog). Modeled as loadable so the panel can show loading / empty / error before the rows.
public struct FeedbackContext: Sendable, Equatable {
    public let pageRoute: String
    public let appVersion: String
    public let userAgent: String
    public let recentErrors: [FeedbackErrorReport]
    public let consoleTail: String

    public init(
        pageRoute: String,
        appVersion: String,
        userAgent: String,
        recentErrors: [FeedbackErrorReport] = [],
        consoleTail: String = ""
    ) {
        self.pageRoute = pageRoute
        self.appVersion = appVersion
        self.userAgent = userAgent
        self.recentErrors = recentErrors
        self.consoleTail = consoleTail
    }

    /// The number of attachable recent errors (web `getRecentReportsForFeedback().length`).
    public var recentErrorCount: Int {
        recentErrors.count
    }

    /// An all-empty context — the fallback used when the user submits before diagnostics resolve.
    public static let empty = FeedbackContext(pageRoute: "", appVersion: "", userAgent: "")
}

// MARK: - Submission (web `FeedbackSubmitInput`)

/// The validated payload handed to the submit controller — the native parity of the web
/// `FeedbackSubmitInput` POSTed to `/feedback` (snake_case JSON shape preserved by field name).
public struct FeedbackSubmission: Sendable, Equatable {
    public let category: FeedbackModalCategory
    public let title: String
    public let body: String
    public let pageRoute: String
    public let userAgent: String
    public let appVersion: String
    public let recentErrors: [FeedbackErrorReport]?
    public let consoleTail: String?

    public init(
        category: FeedbackModalCategory,
        title: String,
        body: String,
        pageRoute: String,
        userAgent: String,
        appVersion: String,
        recentErrors: [FeedbackErrorReport]? = nil,
        consoleTail: String? = nil
    ) {
        self.category = category
        self.title = title
        self.body = body
        self.pageRoute = pageRoute
        self.userAgent = userAgent
        self.appVersion = appVersion
        self.recentErrors = recentErrors
        self.consoleTail = consoleTail
    }
}

/// The two consent attach toggles (web `includeRecentErrors`, default ON; `includeConsoleTail`,
/// default OFF), grouped so the submission builder stays within the parameter budget.
public struct FeedbackAttachments: Sendable, Equatable {
    public let includeRecentErrors: Bool
    public let includeConsoleTail: Bool

    public init(includeRecentErrors: Bool, includeConsoleTail: Bool) {
        self.includeRecentErrors = includeRecentErrors
        self.includeConsoleTail = includeConsoleTail
    }
}

// MARK: - Field validation (web zod min/max)

/// A field's validation failure — the native parity of the zod min/max issues, carrying the bound so
/// the view can localize the message with the actual character count.
public enum FeedbackFieldError: Sendable, Equatable {
    case tooShort(min: Int)
    case tooLong(max: Int)
}

/// The pure field validation, mirroring the web `z.string().min().max()` on the RAW (untrimmed)
/// value — `safeParse` runs on `values`, the trim happens only at submission time.
public enum FeedbackValidation {
    /// The title's validation error (web `title: z.string().min(5).max(120)`), or `nil` when valid.
    public static func titleError(_ title: String) -> FeedbackFieldError? {
        lengthError(title, min: FeedbackLimits.titleMin, max: FeedbackLimits.titleMax)
    }

    /// The body's validation error (web `body: z.string().min(20).max(4000)`), or `nil` when valid.
    public static func bodyError(_ body: String) -> FeedbackFieldError? {
        lengthError(body, min: FeedbackLimits.bodyMin, max: FeedbackLimits.bodyMax)
    }

    /// Whether both fields satisfy the zod schema (web `validation.success`).
    public static func isValid(title: String, body: String) -> Bool {
        titleError(title) == nil && bodyError(body) == nil
    }

    private static func lengthError(_ value: String, min: Int, max: Int) -> FeedbackFieldError? {
        let length = value.count
        if length < min { return .tooShort(min: min) }
        if length > max { return .tooLong(max: max) }
        return nil
    }
}

// MARK: - Projection core (pure)

/// The dependency-free rules shared by the model and the views: the context-panel phase resolution,
/// the submit-enabled predicate, the console-tail truncation, and the validated submission assembly.
public enum FeedbackProjection {
    /// Resolves the auto-context panel phase. Loading shows only before the first context resolves; a
    /// resolved context with no diagnostics at all shows the friendly empty state; a failure with no
    /// cached context shows the error+retry state; once a context is on hand the rows stay on screen
    /// (freshness shown by the chip/banner).
    public static func resolveContextPhase(
        status: FeedbackContextStatus,
        context: FeedbackContext?
    ) -> FeedbackContextPhase {
        switch status {
        case .loading:
            return context == nil ? .loading : .content
        case .loaded:
            guard let context else { return .empty }
            return hasDiagnostics(context) ? .content : .empty
        case let .failed(message):
            return context == nil ? .error(message) : .content
        }
    }

    /// Whether a resolved context carries any diagnostics worth showing (route / version / client
    /// identity / a captured error / a console tail).
    public static func hasDiagnostics(_ context: FeedbackContext) -> Bool {
        if !context.pageRoute.isEmpty { return true }
        if !context.appVersion.isEmpty { return true }
        if !context.userAgent.isEmpty { return true }
        if !context.recentErrors.isEmpty { return true }
        return !context.consoleTail.isEmpty
    }

    /// The web submit guard (`submitDisabled = isSubmitting || !validation.success`, minus the
    /// in-flight flag): a schema-valid title AND body. Independent of the auto-context.
    public static func canSubmit(title: String, body: String) -> Bool {
        FeedbackValidation.isValid(title: title, body: body)
    }

    /// Port of `getConsoleTail`: keep only the last `CONSOLE_TAIL_MAX` characters so the newest
    /// failure context survives the cap.
    public static func truncatedTail(_ tail: String) -> String {
        guard tail.count > FeedbackLimits.consoleTailMax else { return tail }
        return String(tail.suffix(FeedbackLimits.consoleTailMax))
    }

    /// Assembles the validated submission, or `nil` when the guard fails. Mirrors the web `onSubmit`:
    /// trims the title + body, copies the auto-context, and conditionally attaches `recent_errors`
    /// (only when the toggle is on AND there is at least one report) and `console_tail` (only when
    /// the toggle is on AND the truncated tail is non-empty).
    public static func submission(
        category: FeedbackModalCategory,
        title: String,
        body: String,
        context: FeedbackContext,
        attachments: FeedbackAttachments
    ) -> FeedbackSubmission? {
        guard canSubmit(title: title, body: body) else { return nil }
        let errors = attachments.includeRecentErrors && !context.recentErrors.isEmpty ? context.recentErrors : nil
        var tail: String?
        if attachments.includeConsoleTail {
            let trimmed = truncatedTail(context.consoleTail)
            tail = trimmed.isEmpty ? nil : trimmed
        }
        return FeedbackSubmission(
            category: category,
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            body: body.trimmingCharacters(in: .whitespacesAndNewlines),
            pageRoute: context.pageRoute,
            userAgent: context.userAgent,
            appVersion: context.appVersion,
            recentErrors: errors,
            consoleTail: tail
        )
    }
}
