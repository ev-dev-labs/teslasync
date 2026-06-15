//
//  FeedbackModal.Model.swift
//  TeslaSync — P4 modal/dialog · 0004 · FeedbackModal (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `FeedbackModal` owns its own form state
//  (`category`, `title`, `body`, `includeRecentErrors`, `includeConsoleTail` + per-field `touched`),
//  validates on every change (zod `safeParse`), gathers the auto-attached context (location /
//  navigator / errorReporter), and POSTs via `useSubmitFeedback`, closing on success and surfacing an
//  inline error on failure. The native surface reproduces that whole lifecycle here: a
//  `FeedbackContextSource` pushes the resolved diagnostics + freshness, and the model owns the form
//  field state, the derived validation, the resolved context phase, the async submit lifecycle, and
//  the command seams for SwiftUI to bind. No network access lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `FeedbackContextSource`, holds the latest
/// diagnostics context + freshness, owns the editable form fields, exposes the derived validation +
/// the resolved context phase, drives the async submit / retry command seams, and emits the P1/S11
/// `view.opened` event once on first appearance.
@MainActor
@Observable
public final class FeedbackModel {
    // Auto-context load + freshness (from the source)
    public private(set) var contextPhase: FeedbackContextPhase = .loading
    public private(set) var connection: FeedbackConnection = .live
    public private(set) var context: FeedbackContext?
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    // Form fields (web `useState`)
    public var category: FeedbackModalCategory = .bug
    public var title = ""
    public var details = ""
    public var includeRecentErrors = true
    public var includeConsoleTail = false
    public private(set) var titleTouched = false
    public private(set) var bodyTouched = false

    // Submit lifecycle (web `submit.isPending` / `submit.isError`)
    public private(set) var submitting = false
    public private(set) var submitFailed = false

    /// The query failure message kept while a cached context remains on screen, so the content branch
    /// can surface the inline reload error above the rows (web reload-failure-with-cached-context).
    public private(set) var loadFailure: String?

    @ObservationIgnored private let source: any FeedbackContextSource
    @ObservationIgnored private let telemetry: any FeedbackTelemetry
    @ObservationIgnored private let submitter: any FeedbackSubmitting
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any FeedbackContextSource,
        telemetry: any FeedbackTelemetry = OSLogFeedbackTelemetry(),
        submitter: any FeedbackSubmitting = OSLogFeedbackSubmitter(),
        localize: @escaping (String, String) -> String = FeedbackStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.submitter = submitter
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived (categories + validation + a11y)

    /// The category option descriptors in web `categoryOptions` order.
    public var categoryOptions: [FeedbackCategoryOption] {
        FeedbackModalCategory.order.map(\.option)
    }

    /// The title field error to show (web `touched.title ? errors.title : undefined`).
    public var titleError: FeedbackFieldError? {
        titleTouched ? FeedbackValidation.titleError(title) : nil
    }

    /// The body field error to show (web `touched.body ? errors.body : undefined`).
    public var bodyError: FeedbackFieldError? {
        bodyTouched ? FeedbackValidation.bodyError(details) : nil
    }

    /// Whether the form passes the schema (web `validation.success`).
    public var canSubmit: Bool {
        FeedbackProjection.canSubmit(title: title, body: details)
    }

    /// Whether the Send button is disabled (web `submitDisabled = isSubmitting || !validation.success`).
    public var submitDisabled: Bool {
        submitting || !canSubmit
    }

    /// The attachable recent-error count (web `getRecentReportsForFeedback().length`).
    public var recentErrorCount: Int {
        context?.recentErrorCount ?? 0
    }

    /// The inline reload error shown above the context rows (web cached-context-with-failure), present
    /// only while the rows are on screen despite a failed reload.
    public var inlineErrorMessage: String? {
        guard case .content = contextPhase else { return nil }
        return loadFailure
    }

    /// The VoiceOver summary for the dialog.
    public var accessibilitySummary: String {
        FeedbackAccessibility.summary(localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: FeedbackSurface.slug)
        source.start()
    }

    /// Stops observing and clears the draft so a stale form doesn't leak between presentations (web
    /// `useEffect(!open)` reset + `submit.reset()`).
    public func stop() {
        started = false
        source.stop()
        resetForm()
    }

    /// Re-resolves the diagnostics context (web refetch) — the context error-state retry action.
    public func retryContext() {
        source.refresh()
    }

    // MARK: Field interaction (web onBlur)

    /// Marks the title field touched so its error surfaces (web `handleBlur('title')`).
    public func markTitleTouched() {
        titleTouched = true
    }

    /// Marks the body field touched so its error surfaces (web `handleBlur('body')`).
    public func markBodyTouched() {
        bodyTouched = true
    }

    // MARK: Commands (web `onSubmit`)

    /// Validates + submits the feedback (web form `onSubmit`): marks every field touched, builds the
    /// payload from the current fields + the resolved context, awaits the submit seam, and on success
    /// resets the form and reports `true` so the host can dismiss (web `await mutateAsync; onClose()`).
    /// On failure it surfaces the inline error and keeps the form open (web `catch`), returning `false`.
    public func submit() async -> Bool {
        titleTouched = true
        bodyTouched = true
        guard let submission = FeedbackProjection.submission(
            category: category,
            title: title,
            body: details,
            context: context ?? .empty,
            attachments: FeedbackAttachments(
                includeRecentErrors: includeRecentErrors,
                includeConsoleTail: includeConsoleTail
            )
        ) else { return false }
        submitFailed = false
        submitting = true
        defer { submitting = false }
        do {
            try await submitter.submit(submission)
            resetForm()
            return true
        } catch {
            submitFailed = true
            return false
        }
    }

    // MARK: Snapshot application

    private func apply(_ update: FeedbackContextUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        context = update.context
        loadFailure = Self.failureMessage(update.status)
        contextPhase = FeedbackProjection.resolveContextPhase(status: update.status, context: update.context)
        handleAutoRefresh(for: update.connection)
    }

    /// Clears the form back to web defaults (`category='bug'`, empty title/body, errors ON, console
    /// OFF, untouched, no submit error).
    private func resetForm() {
        category = .bug
        title = ""
        details = ""
        includeRecentErrors = true
        includeConsoleTail = false
        titleTouched = false
        bodyTouched = false
        submitFailed = false
    }

    /// The failure message carried by a failed status, else `nil`.
    private static func failureMessage(_ status: FeedbackContextStatus) -> String? {
        if case let .failed(message) = status { return message }
        return nil
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached context on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: FeedbackConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}
