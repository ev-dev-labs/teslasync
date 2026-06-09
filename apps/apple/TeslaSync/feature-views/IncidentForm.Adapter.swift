//
//  IncidentForm.Adapter.swift
//  TeslaSync — P4 feature view · 0246 · IncidentForm (Apple)
//
//  The testable projection core for the manual incident-logging form — the SwiftUI
//  parity of features/system/components/status/IncidentForm.tsx. The web component
//  validates the title client-side (`title.trim().length < 3`), builds the create body
//  (`initial_message: message.trim() || undefined`, `affected_components:
//  components.split(',').map(trim).filter(Boolean)`), flips the submit button to
//  "Logging…" while pending, and surfaces the outcome through the app `useToast`.
//
//  Everything here is pure + dependency-free (Foundation only, no SwiftUI, no view
//  state) so the projections can be unit-tested without a seam, a bundle, or a rendered
//  view: the title validity rule, the request builder, the field clamps (web
//  `maxLength`), the submit-button label projection, the settled outcome, the toast
//  content projection (web `toast.success` / `toast.error`), and the accessibility
//  builders. All user-facing copy is carried as `LocalizedText` descriptors resolved at
//  the display boundary through the P1/S10 facade.
//

import Foundation

// MARK: - Localized copy descriptors (web `t(key, default)` / literal toast text)

/// Every user-facing string the surface renders, as `LocalizedText` (key + web English
/// fallback). The web source holds these as literals (its only hook is the form state +
/// `useToast`); routing them through descriptors keeps the native view free of hardcoded
/// copy while reproducing the web wording verbatim.
public enum IncidentFormText {
    // Surface chrome (web `<Modal title="Log an incident">`)
    public static let title = LocalizedText("status.incidentForm.title", "Log an incident")
    public static let surfaceA11y = LocalizedText("status.incidentForm.surfaceA11y", "Log an incident form")
    public static let close = LocalizedText("status.incidentForm.close", "Close")

    // Title field (web "Title" label + prompt)
    public static let titleLabel = LocalizedText("status.incidentForm.field.title", "Title")
    public static let titlePrompt = LocalizedText(
        "status.incidentForm.field.title.prompt",
        "e.g. Wall connector restart at 14:00"
    )

    /// Severity field (web "Severity" label + options)
    public static let severityLabel = LocalizedText("status.incidentForm.field.severity", "Severity")
    /// Status field (web "Status" label + options)
    public static let statusLabel = LocalizedText("status.incidentForm.field.status", "Status")

    // Affected components (web label + muted note + prompt)
    public static let componentsLabel = LocalizedText("status.incidentForm.field.components", "Affected components")
    public static let componentsNote = LocalizedText(
        "status.incidentForm.field.components.note",
        "(comma-separated, optional)"
    )
    public static let componentsPrompt = LocalizedText(
        "status.incidentForm.field.components.prompt",
        "e.g. tesla, telemetry"
    )

    // Initial message (web label + muted note + prompt)
    public static let messageLabel = LocalizedText("status.incidentForm.field.message", "Initial timeline message")
    public static let messageNote = LocalizedText("status.incidentForm.field.message.note", "(optional)")
    public static let messagePrompt = LocalizedText("status.incidentForm.field.message.prompt", "What’s the situation?")

    // Actions (web Cancel / "Log incident" / "Logging…")
    public static let cancel = LocalizedText("status.incidentForm.action.cancel", "Cancel")
    public static let submit = LocalizedText("status.incidentForm.action.submit", "Log incident")
    public static let submitting = LocalizedText("status.incidentForm.action.submitting", "Logging…")
    public static let submitHint = LocalizedText(
        "status.incidentForm.action.submit.hint",
        "Logs the incident and closes the form."
    )
    public static let cancelHint = LocalizedText(
        "status.incidentForm.action.cancel.hint",
        "Discards this incident and closes the form."
    )

    /// Toasts (web `useToast` success / error)
    public static let toastValidation = LocalizedText(
        "status.incidentForm.toast.validation",
        "Title must be at least 3 characters."
    )
    public static let toastSuccess = LocalizedText("status.incidentForm.toast.success", "Incident logged.")
    public static let toastFailedFallback = LocalizedText(
        "status.incidentForm.toast.error",
        "Failed to log incident"
    )
    public static let toastOffline = LocalizedText(
        "status.incidentForm.toast.offline",
        "You appear to be offline. The incident couldn’t be logged."
    )
    public static let dismiss = LocalizedText("status.incidentForm.dismiss", "Dismiss")

    /// The dropdown label for a severity (web option text).
    public static func severity(_ severity: IncidentSeverity) -> LocalizedText {
        switch severity {
        case .minor: LocalizedText("status.incidentForm.severity.minor", "Minor")
        case .major: LocalizedText("status.incidentForm.severity.major", "Major")
        case .critical: LocalizedText("status.incidentForm.severity.critical", "Critical")
        }
    }

    /// The dropdown label for a status (web option text).
    public static func status(_ status: IncidentStatus) -> LocalizedText {
        switch status {
        case .investigating: LocalizedText("status.incidentForm.status.investigating", "Investigating")
        case .identified: LocalizedText("status.incidentForm.status.identified", "Identified")
        case .monitoring: LocalizedText("status.incidentForm.status.monitoring", "Monitoring")
        case .resolved: LocalizedText("status.incidentForm.status.resolved", "Resolved")
        }
    }
}

// MARK: - Settled outcome (web submit success / validation / error)

/// The settled outcome of a submit attempt, mirroring the branches the web `handleSubmit`
/// collapses to: the client-side title-too-short guard (web `toast.error` before any
/// network call), a successful create, the transport failure the native app surfaces as
/// `offline`, and any other server/validation error (web `toast.error(err.message …)`).
public enum IncidentSubmitOutcome: Sendable, Equatable {
    case validationFailed
    case succeeded
    case offline
    case failed(message: String)
}

// MARK: - Toast tone (web `toast.success` / `toast.error`)

/// The transient feedback tone — the port of the web `toast.success` / `toast.error`
/// plus a neutral tone for the native offline branch. View-layer free (mapped to a
/// design-system color when rendered) so the projection stays Sendable + testable.
public enum IncidentFormTone: Sendable, Equatable {
    case success
    case danger
    case neutral
}

/// One resolved toast — the native counterpart of the web `useToast()` feedback. The
/// model publishes the latest toast; the view renders it and clears it after a delay (or
/// on dismiss). `kind` drives tests + the icon; `message` is already localized/resolved.
public struct IncidentFormToast: Sendable, Equatable, Identifiable {
    /// The outcome class the toast represents (web validation vs success vs error).
    public enum Kind: Sendable, Equatable {
        case validation
        case success
        case offline
        case failed
    }

    public let id: UUID
    public let kind: Kind
    public let tone: IncidentFormTone
    public let message: String
    public let systemImage: String

    public init(kind: Kind, tone: IncidentFormTone, message: String, systemImage: String, id: UUID = UUID()) {
        self.kind = kind
        self.tone = tone
        self.message = message
        self.systemImage = systemImage
        self.id = id
    }

    /// Projects the toast for a settled outcome, resolving each web message through the
    /// `localize` (key, fallback) seam so the projection stays bundle-free and
    /// unit-testable. The validation + success copy is preserved verbatim from the web
    /// source; the generic-failure branch shows the server error message when present
    /// (web `err.message`), else the generic fallback (web `'Failed to log incident'`).
    public static func project(
        _ outcome: IncidentSubmitOutcome,
        localize: (LocalizedText) -> String
    ) -> IncidentFormToast? {
        switch outcome {
        case .validationFailed:
            return IncidentFormToast(
                kind: .validation,
                tone: .danger,
                message: localize(IncidentFormText.toastValidation),
                systemImage: "exclamationmark.triangle.fill"
            )
        case .succeeded:
            return IncidentFormToast(
                kind: .success,
                tone: .success,
                message: localize(IncidentFormText.toastSuccess),
                systemImage: "checkmark.circle.fill"
            )
        case .offline:
            return IncidentFormToast(
                kind: .offline,
                tone: .neutral,
                message: localize(IncidentFormText.toastOffline),
                systemImage: "wifi.slash"
            )
        case let .failed(message):
            let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
            return IncidentFormToast(
                kind: .failed,
                tone: .danger,
                message: trimmed.isEmpty ? localize(IncidentFormText.toastFailedFallback) : trimmed,
                systemImage: "exclamationmark.triangle.fill"
            )
        }
    }
}

// MARK: - Pure projections (validation, request build, labels, a11y)

/// The pure, view-free transforms for the incident form. Mirrors the web `handleSubmit`
/// + field plumbing so each rule is unit-tested without a model or a rendered view.
public enum IncidentFormAdapter {
    /// Web `title.trim().length < 3` guard, expressed as the positive predicate. The
    /// trimmed title must be at least `titleMinLength` chars to submit.
    public static func isTitleValid(_ title: String) -> Bool {
        title.trimmingCharacters(in: .whitespacesAndNewlines).count >= IncidentFieldBounds.titleMinLength
    }

    /// Whether the draft can be submitted (web enables submit but guards in `handleSubmit`;
    /// the native button stays enabled and the guard runs on submit for parity, while this
    /// drives the accessibility "is valid" hint + tests).
    public static func isValid(_ draft: IncidentDraft) -> Bool {
        isTitleValid(draft.title)
    }

    /// Caps the title to the web `maxLength={200}` so the bound input mirrors the DOM
    /// constraint (the native `TextField` has no intrinsic max length).
    public static func clampTitle(_ title: String) -> String {
        clamp(title, to: IncidentFieldBounds.titleMaxLength)
    }

    /// Caps the message to the web `maxLength={4000}`.
    public static func clampMessage(_ message: String) -> String {
        clamp(message, to: IncidentFieldBounds.messageMaxLength)
    }

    /// Splits the raw components text into the request array — web
    /// `components.split(',').map((c) => c.trim()).filter(Boolean)`.
    public static func parseComponents(_ raw: String) -> [String] {
        raw.split(separator: ",", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    /// Builds the create request from the draft, or `nil` when the title guard fails (web
    /// returns before calling the mutation). Mirrors the web body exactly: trimmed title,
    /// `initial_message: message.trim() || undefined`, comma-split affected components.
    public static func makeRequest(from draft: IncidentDraft) -> CreateIncidentRequest? {
        let trimmedTitle = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedTitle.count >= IncidentFieldBounds.titleMinLength else { return nil }
        let trimmedMessage = draft.message.trimmingCharacters(in: .whitespacesAndNewlines)
        return CreateIncidentRequest(
            title: trimmedTitle,
            severity: draft.severity,
            status: draft.status,
            initialMessage: trimmedMessage.isEmpty ? nil : trimmedMessage,
            affectedComponents: parseComponents(draft.components)
        )
    }

    /// The submit-button label — web `create.isPending ? 'Logging…' : 'Log incident'`.
    public static func submitLabel(isSubmitting: Bool) -> LocalizedText {
        isSubmitting ? IncidentFormText.submitting : IncidentFormText.submit
    }

    private static func clamp(_ value: String, to maxLength: Int) -> String {
        guard value.count > maxLength else { return value }
        return String(value.prefix(maxLength))
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver labels + stable identifiers for the surface. Pure + public so the
/// spoken content / automation IDs can be unit-tested without rendering the view.
public enum IncidentFormAccessibility {
    /// Stable automation identifiers (web `data-testid` analogues).
    public static let submitID = "incident-form-submit"
    public static let cancelID = "incident-form-cancel"

    /// The submit button's spoken label (web button name; "Logging…" while pending).
    public static func submitLabel(isSubmitting: Bool, localize: (LocalizedText) -> String) -> String {
        localize(IncidentFormAdapter.submitLabel(isSubmitting: isSubmitting))
    }

    /// The cancel button's spoken label (web "Cancel").
    public static func cancelLabel(localize: (LocalizedText) -> String) -> String {
        localize(IncidentFormText.cancel)
    }
}
