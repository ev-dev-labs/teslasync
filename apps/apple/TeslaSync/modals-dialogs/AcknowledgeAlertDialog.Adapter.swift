//
//  AcknowledgeAlertDialog.Adapter.swift
//  TeslaSync — P4 modal/dialog · 0017 · AcknowledgeAlertDialog (Apple)
//
//  The testable projection core for the alert-acknowledgement dialog — the faithful port of
//  features/admin/components/AcknowledgeAlertDialog.tsx. The web source is a `Modal` wrapping a small
//  form: an optional alert-title subtitle, a multi-line note `Textarea` (label "Note (optional)", the
//  "Optional: what's being done?" prompt, hard-capped at `NOTE_MAX + 50` input units and flagged when the
//  trimmed value exceeds `NOTE_MAX`), the "Up to {{max}} characters…" hint, and the ghost Cancel +
//  primary Acknowledge footer. Submitting hands the parent the trimmed note (empty allowed — the backend
//  records an ack with no note so the audit timeline still captures who + when).
//
//  Everything here is pure and dependency-free (Foundation only) so the projection — the note limits,
//  the trim, the too-long guard, the field-error mapping, the {{max}} hint substitution, the submit-
//  enablement rule, the render-phase resolution, and the mode-free copy — can be unit-tested without a
//  store, a bundle, or a rendered view.
//
//  Web parity notes:
//    • `NOTE_MAX = 1000`                              → `AckAlertProjection.noteMaxLength`.
//    • `maxLength={NOTE_MAX + 50}`                    → `AckAlertProjection.noteInputLimit` (1050).
//    • `note.trim()`                                  → `AckAlertProjection.trimmedNote`.
//    • `trimmed.length > NOTE_MAX`                    → `AckAlertProjection.isTooLong` (UTF-16 units, web `.length`).
//    • `disabled={submitting || tooLong}`             → `AckAlertProjection.submitDisabled`.
//    • `error={tooLong ? noteHint : undefined}`       → `AckAlertProjection.fieldError`.
//    • `onSubmit(trimmed)`                            → `AckAlertSubmitBody.note`.
//    • The web only ever shows the form; `resolvePhase` widens that into the prompt-required
//      loading / empty / error envelopes so no state is ever a blank panel.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so the
/// projection's unit tests can reach it.
public enum AckAlertSurface {
    public static let slug = "AcknowledgeAlertDialog"
}

// MARK: - Load status / render phase / freshness

/// The bound source's load status for the alert being acknowledged. The web reads the target row from
/// the page that opened the dialog; the native surface models the load lifecycle here so every state
/// renders.
public enum AckAlertLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so the dialog
/// labels when the alert context may be momentarily out of date.
public enum AckAlertConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface renders at the top level. The web only ever shows the form when an alert is being
/// acknowledged; the loading + empty + error envelopes are added so the first-resolve, no-target, and
/// resolution-failure cases never render a blank panel.
public enum AckAlertPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Alert context + submit payloads

/// The alert the dialog acknowledges: its identity (so a re-open for a different row resets the note)
/// and its optional human title (web `alertTitle`, shown as the subtitle for context).
public struct AckAlertContext: Sendable, Equatable {
    public let alertID: String
    public let title: String?

    public init(alertID: String, title: String? = nil) {
        self.alertID = alertID
        self.title = title
    }
}

/// The body submitted to the acknowledge service — the native parity of the web `onSubmit(note)`. The
/// note is already trimmed (web `note.trim()`) and may be empty (an ack with no note).
public struct AckAlertSubmitBody: Sendable, Equatable {
    public let note: String

    public init(note: String) {
        self.note = note
    }
}

/// The result of an acknowledge submission. The web parent owns the mutation + toast/undo; the native
/// surface — a richer client — additionally surfaces a failure inline so the user can retry.
public enum AckAlertSubmitOutcome: Sendable, Equatable {
    case success
    case failure(message: String)
}

// MARK: - Projection core (pure)

/// The dependency-free rules shared by the model and the views: the note limits, the trim + too-long
/// guard, the field-error + hint copy with `{{max}}` substitution, the submit-enablement rule, the
/// render-phase resolution, and the dialog copy. All copy resolves through an injected localizer so it
/// stays bundle-free.
public enum AckAlertProjection {
    /// The maximum trimmed note length before the field is flagged too long (web `NOTE_MAX`).
    public static let noteMaxLength = 1000

    /// The hard input cap applied to the raw note as the user types (web `maxLength={NOTE_MAX + 50}`).
    public static let noteInputLimit = noteMaxLength + 50

    /// Whitespace/newline-trimmed note (web `note.trim()`).
    public static func trimmedNote(_ note: String) -> String {
        note.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The UTF-16 length of a string — the faithful port of JS `String.prototype.length`, which counts
    /// UTF-16 code units (used by both the web `tooLong` check and the `maxLength` cap).
    public static func length(_ value: String) -> Int {
        value.utf16.count
    }

    /// Whether the trimmed note exceeds `noteMaxLength` (web `trimmed.length > NOTE_MAX`).
    public static func isTooLong(_ note: String) -> Bool {
        length(trimmedNote(note)) > noteMaxLength
    }

    /// Clamps a raw note to `noteInputLimit` UTF-16 units without splitting a grapheme (web `maxLength`
    /// applied to the controlled value). Already-short notes return unchanged.
    public static func clampToInputLimit(_ raw: String) -> String {
        guard length(raw) > noteInputLimit else { return raw }
        var result = ""
        var units = 0
        for character in raw {
            let next = units + character.utf16.count
            if next > noteInputLimit { break }
            result.append(character)
            units = next
        }
        return result
    }

    /// The submit body for the current note — the trimmed value handed to the parent (web
    /// `onSubmit(trimmed)`).
    public static func submitBody(for note: String) -> AckAlertSubmitBody {
        AckAlertSubmitBody(note: trimmedNote(note))
    }

    /// Whether the Acknowledge action is disabled (web `disabled={submitting || tooLong}`).
    public static func submitDisabled(submitting: Bool, note: String) -> Bool {
        submitting || isTooLong(note)
    }

    /// The render phase. Loading shows only before the alert resolves; a resolved no-target state shows
    /// the empty envelope; a resolution failure with no cached context shows the error state; once an
    /// alert is on hand the form stays on screen (freshness shown by the chip / banner).
    public static func resolvePhase(status: AckAlertLoadStatus, context: AckAlertContext?) -> AckAlertPhase {
        switch status {
        case .loading:
            context == nil ? .loading : .content
        case .loaded:
            context == nil ? .empty : .content
        case let .failed(message):
            context == nil ? .error(message) : .content
        }
    }

    // MARK: Copy

    /// The dialog title (web `t('alerts.ack.dialogTitle', 'Acknowledge alert')`).
    public static func dialogTitle(localize: (String, String) -> String) -> String {
        localize("alerts.ack.dialogTitle", "Acknowledge alert")
    }

    /// The note field label (web `t('alerts.ack.noteLabel', 'Note (optional)')`).
    public static func noteLabel(localize: (String, String) -> String) -> String {
        localize("alerts.ack.noteLabel", "Note (optional)")
    }

    /// The note field prompt shown when empty — the web Textarea prompt copy.
    public static func notePromptText(localize: (String, String) -> String) -> String {
        localize("alerts.ack.notePlaceholder", "Optional: what's being done?") // parity:allow web i18n key
    }

    /// The note hint with `{{max}}` substituted (web `t('alerts.ack.noteHint', 'Up to {{max}}
    /// characters. Shared in the audit timeline.', { max: NOTE_MAX })`).
    public static func noteHint(localize: (String, String) -> String) -> String {
        let template = localize(
            "alerts.ack.noteHint",
            "Up to {{max}} characters. Shared in the audit timeline."
        )
        return template.replacingOccurrences(of: "{{max}}", with: String(noteMaxLength))
    }

    /// The field error shown under the note when it is too long — the web `error={tooLong ? noteHint :
    /// undefined}` (the hint, reused as the validation message), else `nil`.
    public static func fieldError(note: String, localize: (String, String) -> String) -> String? {
        isTooLong(note) ? noteHint(localize: localize) : nil
    }

    /// The Cancel button title (web `t('alerts.ack.cancel', 'Cancel')`).
    public static func cancelTitle(localize: (String, String) -> String) -> String {
        localize("alerts.ack.cancel", "Cancel")
    }

    /// The Acknowledge button title (web `t('alerts.ack.submit', 'Acknowledge')`).
    public static func submitTitle(localize: (String, String) -> String) -> String {
        localize("alerts.ack.submit", "Acknowledge")
    }

    /// Maps a failed acknowledge submission to the message the dialog shows inline: the server message
    /// when present, else the generic fallback.
    public static func submitErrorMessage(_ message: String, localize: (String, String) -> String) -> String {
        let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty
            ? localize("alerts.ack.error", "Couldn't acknowledge the alert. Try again.")
            : trimmed
    }
}
