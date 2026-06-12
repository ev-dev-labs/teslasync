//
//  EditableText.Adapter.swift
//  TeslaSync — P4 shared surface · 0213 · EditableText (Apple)
//
//  The testable, dependency-light core for the inline-edit primitive — the SwiftUI parity of
//  `components/ui/EditableText.tsx`. Everything here is pure (Foundation only): the surface identity
//  (the diagnostics slug), the localization seam shape, the props value type
//  (``EditableTextFieldInput``), the view-ready ``EditableTextFieldResolved``, and the pure
//  ``EditableTextFieldEngine`` that ports the web `commitDraft()` decision tree (no-op /
//  validation / skip-resubmit / proceed), the per-keystroke live-validation rule (web
//  `handleInputChange`), the maxLength clamp, the save-rejection message resolution (web
//  `err instanceof Error ? err.message : t(...)`), and the display-content selection (web
//  `visibleText`). No SwiftUI and no `@Observable`, so every
//  rule is unit-testable in isolation against the web's own behaviour.
//
//  Faithful-parity note: the web `<EditableText>` is a CONTROLLED primitive. The parent owns `value`
//  and passes it on every render; the field calls `onSave(next): Promise<void>` on commit and re-syncs
//  its draft from `value` whenever it is NOT being edited. There is no fetch, no React-Query cache, and
//  no Promise other than the caller's `onSave`, so the SOURCE component has no loading / error / stale /
//  offline branch of its own. This native surface reproduces every REAL web branch (display populated /
//  empty-prompt / empty / disabled; edit idle / saving / validation-error / save-failure; the no-op
//  and skip-resubmit commit exits) AND layers the P4 leaf-contract states (loading / error / stale /
//  offline) on top via the source snapshot — exactly as the sibling controlled-field surfaces
//  CurrencyInput (0150) and TagInput (0160) did, so the surface never collapses to a blank box.
//
//  Naming note: the component-library bundle already declares a module-public `TSEditableText` atomic
//  view, so this surface's symbols are namespaced `EditableTextField*` (the precedent set by the
//  CurrencyInput surface vs. the `Currency` display type). The diagnostics slug stays "EditableText"
//  (the web source filename); see ``EditableTextFieldMeta``.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Static, non-identifying surface constants. The slug is the web source name (`EditableText`) so the
/// P1/S11 `view.opened` event matches across platforms even though the Swift type is namespaced.
public enum EditableTextFieldMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "EditableText"
}

// MARK: - Localization seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `useTranslation` `t(key,
/// default)` call. Kept as a plain closure so the pure core needs no bundle: the production app passes
/// the P1/S10 facade, tests pass an identity-fallback resolver.
public typealias EditableTextFieldResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Variant (web `'body' | 'heading'`)

/// The visible text scale of the surface — the verbatim port of the web `EditableTextVariant`. Controls
/// the display + edit font only (web `text-sm font-normal` vs `text-base font-semibold`).
public enum EditableTextFieldVariant: String, Sendable, Equatable, CaseIterable {
    /// Web `'body'` — `text-sm font-normal`.
    case body
    /// Web `'heading'` — `text-base font-semibold`.
    case heading
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound value feed — the orthogonal connectivity axis rendered as the freshness
/// chip. `live` hides the chip; `stale` / `offline` show it. Not present in the controlled web source;
/// a P4 leaf-contract addition (see the file header).
public enum EditableTextFieldConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (the web props + parent lifecycle)

/// One coalesced snapshot of the field's inputs — the web `value` / `ariaLabel` / field-prompt /
/// `maxLength` / `variant` / `disabled` props plus the parent's lifecycle (`isLoading`, an error message,
/// and connectivity). The closures (`onSave`, `validate`) are NOT here — they are held by the source +
/// the state-holder so this value type stays `Equatable` + `Sendable`, the same split CurrencyInput uses
/// for `onChange`.
public struct EditableTextFieldInput: Sendable, Equatable {
    /// The currently-saved value (web `value`). The starting point for each edit; `""` is the web empty.
    public var value: String
    /// The accessible name describing the editable field (web `ariaLabel`) — required, non-empty.
    public var ariaLabel: String
    /// Input prompt + empty-display fallback (web `placeholder`). // parity:allow web prop name
    public var prompt: String?
    /// The native `maxLength` on the input (web `maxLength`). `nil` = unbounded.
    public var maxLength: Int?
    /// The visible text scale (web `variant`, default `.body`).
    public var variant: EditableTextFieldVariant
    /// Renders display-only with no edit affordance (web `disabled`).
    public var isDisabled: Bool
    /// The bound value's fetch is in flight (P4 leaf — drives the skeleton).
    public var isLoading: Bool
    /// The parent's fetch failed (P4 leaf — drives the `QueryError` peer). `nil` / `""` = no error.
    public var errorMessage: String?
    /// The freshness of the feed (P4 leaf — drives the chip + the stale auto-refresh).
    public var connection: EditableTextFieldConnection

    public init(
        value: String = "",
        ariaLabel: String = "",
        prompt: String? = nil,
        maxLength: Int? = nil,
        variant: EditableTextFieldVariant = .body,
        isDisabled: Bool = false,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: EditableTextFieldConnection = .live
    ) {
        self.value = value
        self.ariaLabel = ariaLabel
        self.prompt = prompt
        self.maxLength = maxLength
        self.variant = variant
        self.isDisabled = isDisabled
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Display content (web `visibleText`)

/// What the display state shows — the resolved port of the web `visibleText`
/// selection. A populated value renders as primary text; an empty value renders the caller prompt
/// (muted + italic, web `text-[var(--text-muted)] italic`); an empty value with no prompt renders
/// the native "Not set" leaf (muted + italic) so the surface is never a blank box. The view maps
/// ``notSet`` through the P1/S10 facade — the pure core never resolves a string.
public enum EditableTextFieldDisplayContent: Sendable, Equatable {
    /// Show the saved value as primary text (web non-empty `value`).
    case value(String)
    /// Show the caller prompt, muted + italic (the web empty-value display branch).
    case prompt(String)
    /// Show the native "Not set" hint, muted + italic (native — empty value, no prompt).
    case notSet
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body, and for the `ready` phase the display
/// content, edit prompt, accessibility name, variant, and field flags are carried so the view is a pure
/// function of this value. The live editing draft + saving + error live on the model (they change on
/// every keystroke / await), not here.
public struct EditableTextFieldResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case ready
        case error(String)
    }

    public let phase: Phase
    /// The display-state content (web `visibleText`).
    public let displayContent: EditableTextFieldDisplayContent
    /// The accessible name forwarded to the button + the input (web `aria-label`).
    public let ariaLabel: String
    /// The input prompt, `""` when none.
    public let inputPrompt: String
    /// The visible text scale (web `variant`).
    public let variant: EditableTextFieldVariant
    /// `true` when the saved value is empty (web `value === ''`).
    public let isEmptyValue: Bool
    /// Renders display-only, no pencil (web `disabled`).
    public let isDisabled: Bool
    /// The native `maxLength` on the input (web `maxLength`).
    public let maxLength: Int?

    public init(
        phase: Phase,
        displayContent: EditableTextFieldDisplayContent = .notSet,
        ariaLabel: String = "",
        inputPrompt: String = "",
        variant: EditableTextFieldVariant = .body,
        isEmptyValue: Bool = true,
        isDisabled: Bool = false,
        maxLength: Int? = nil
    ) {
        self.phase = phase
        self.displayContent = displayContent
        self.ariaLabel = ariaLabel
        self.inputPrompt = inputPrompt
        self.variant = variant
        self.isEmptyValue = isEmptyValue
        self.isDisabled = isDisabled
        self.maxLength = maxLength
    }
}

// MARK: - Commit decision (web `commitDraft()` return semantics)

/// The outcome of evaluating a commit attempt — the pure port of the web `commitDraft()` decision tree.
/// The model acts on it (exit / stay / await the save); keeping it a value makes the whole branch table
/// unit-testable without a store, a clock, or a Promise.
public enum EditableTextFieldCommitDecision: Sendable, Equatable {
    /// `trim(draft) == trim(value)` — leave edit mode without touching the server (web no-op exit).
    case noOp
    /// The draft is invalid — stay in edit mode and surface the message (web `setError` + return false).
    case invalid(String)
    /// The trimmed draft equals the last submitted value — exit without re-submitting (web guard).
    case skipResubmit
    /// The draft is valid + changed + new — perform the async save with this normalised value.
    case proceed(String)
}

// MARK: - Engine (web `normalise` / `commitDraft` / `handleInputChange` / error message / display)

/// The pure decision core — the surface's data adapter in the "inputs → projection / decision" sense the
/// acceptance calls for. It ports the web normaliser (trim), the `commitDraft()` branch table, the
/// per-keystroke live-validation rule, the maxLength clamp, the save-rejection message resolution, and
/// the display-content selection — all deterministic, all unit tested against the web's own cases.
public enum EditableTextFieldEngine {
    /// The canonical normaliser — trim, the same value sent to the server (web `normalise`).
    public static func normalise(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Clamp typed text to `maxLength` graphemes (the native peer of the web `<input maxLength>`; SwiftUI
    /// has no built-in cap, so the model enforces it on every keystroke). `nil` / non-positive = no cap.
    public static func clamp(_ text: String, maxLength: Int?) -> String {
        guard let maxLength, maxLength > 0, text.count > maxLength else { return text }
        return String(text.prefix(maxLength))
    }

    /// The per-keystroke live-validation rule — the verbatim port of the web `handleInputChange`: an
    /// empty trimmed draft surfaces no error (the web "don't pre-empt empty on every backspace"), a
    /// non-empty draft surfaces the validator's message (or `nil`), and with no validator there is never
    /// a live error. Returns the message to show, or `nil` to clear it.
    public static func liveValidationMessage(
        for text: String,
        validate: ((String) -> String?)?
    ) -> String? {
        guard let validate else { return nil }
        let trimmed = normalise(text)
        guard !trimmed.isEmpty else { return nil }
        return validate(trimmed)
    }

    /// The commit decision — the verbatim port of the web `commitDraft()` guard order: no-op (unchanged)
    /// → empty (built-in message) → custom validator → skip-resubmit (identical to the last submit) →
    /// proceed. `emptyMessage` is the resolved `editableText.error.empty` string (the view/model passes
    /// it so the pure core stays bundle-free).
    public static func decideCommit(
        draft: String,
        value: String,
        lastSubmitted: String?,
        validate: ((String) -> String?)?,
        emptyMessage: String
    ) -> EditableTextFieldCommitDecision {
        let next = normalise(draft)
        let current = normalise(value)

        if next == current {
            return .noOp
        }
        if next.isEmpty {
            return .invalid(emptyMessage)
        }
        if let validate, let message = validate(next), !message.isEmpty {
            return .invalid(message)
        }
        if lastSubmitted == next {
            return .skipResubmit
        }
        return .proceed(next)
    }

    /// Resolve the message shown on a rejected save — the port of the web `err instanceof Error ?
    /// err.message : t('editableText.error.saveFailed')`. A surface-thrown ``EditableTextFieldSaveError``
    /// or any `LocalizedError` with a description yields its message; anything else falls back to the
    /// resolved `saveFailed` string.
    public static func saveErrorMessage(from error: Error, fallback: String) -> String {
        if let saveError = error as? EditableTextFieldSaveError {
            let trimmed = saveError.message.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? fallback : trimmed
        }
        if let description = localizedDescription(from: error) {
            return description
        }
        return fallback
    }

    /// The non-blank `errorDescription` of a `LocalizedError`, else `nil` — split out so the multi-clause
    /// check stays single-line (the codebase's brace-placement convention).
    private static func localizedDescription(from error: Error) -> String? {
        guard let description = (error as? LocalizedError)?.errorDescription else { return nil }
        let trimmed = description.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : description
    }

    /// Select the display-state content — the port of the web `visibleText` / `isPrompt`: a
    /// non-empty value shows as primary text; an empty value with a non-empty prompt shows the
    /// prompt (muted + italic); an empty value with no prompt shows the native "Not set" leaf.
    public static func displayContent(
        value: String,
        prompt: String?
    ) -> EditableTextFieldDisplayContent {
        if !value.isEmpty {
            return .value(value)
        }
        if let prompt, !prompt.isEmpty {
            return .prompt(prompt)
        }
        return .notSet
    }

    /// The spoken text for a display content — the value, the prompt, or the resolved "Not set"
    /// leaf. The view renders each case with its own styling but voices this string, so VoiceOver reads
    /// the same content the eye sees (the web button's text content). Kept here so the accessibility
    /// mapping is unit-tested and shared by the view.
    public static func displayText(
        content: EditableTextFieldDisplayContent,
        notSet: String
    ) -> String {
        switch content {
        case let .value(value): value
        case let .prompt(prompt): prompt
        case .notSet: notSet
        }
    }

    /// Resolve the whole render state from the input snapshot — a non-empty error message surfaces as
    /// `error` (web `QueryError` peer), an in-flight parent fetch as `loading`, otherwise the editable
    /// `ready` field (which always renders, empty OR populated — never a hidden box).
    public static func resolve(_ input: EditableTextFieldInput) -> EditableTextFieldResolved {
        if let message = nonBlank(input.errorMessage) {
            return EditableTextFieldResolved(phase: .error(message))
        }
        if input.isLoading {
            return EditableTextFieldResolved(phase: .loading)
        }
        return EditableTextFieldResolved(
            phase: .ready,
            displayContent: displayContent(value: input.value, prompt: input.prompt),
            ariaLabel: input.ariaLabel,
            inputPrompt: input.prompt ?? "",
            variant: input.variant,
            isEmptyValue: input.value.isEmpty,
            isDisabled: input.isDisabled,
            maxLength: input.maxLength
        )
    }

    /// The string trimmed of surrounding whitespace, or `nil` when it is absent / blank — the native peer
    /// of the web `!message.trim()` guard, kept single-line so the brace stays on the statement line.
    private static func nonBlank(_ value: String?) -> String? {
        guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return value
    }
}

// MARK: - Save error (web `Error` thrown from `onSave`)

/// The error a host's save closure throws to surface a human-readable failure — the native peer of the
/// web `onSave` rejecting with an `Error` whose `message` the field renders inline. `LocalizedError`
/// conformance means `error.localizedDescription` also reads correctly off the boundary.
public struct EditableTextFieldSaveError: LocalizedError, Equatable {
    /// The message rendered inline beneath the field (web `err.message`).
    public let message: String

    public init(_ message: String) {
        self.message = message
    }

    public var errorDescription: String? {
        message
    }
}
