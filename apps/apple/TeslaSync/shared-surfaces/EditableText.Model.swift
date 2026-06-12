//
//  EditableText.Model.swift
//  TeslaSync — P4 shared surface · 0213 · EditableText (Apple)
//
//  The observable state-holder (P1/S8) and the i18n facade (P1/S10) for the inline-edit primitive. The
//  view binds through ``EditableTextFieldModel``; no networking lives in the view. The web
//  `EditableText` keeps four pieces of local state (`editing`, `draft`, `saving`, `error`) plus two refs
//  (`savingRef` blocking duplicate submits, `lastSubmittedRef` blocking identical re-submits) and a
//  `useEffect` that re-syncs the draft from the canonical `value` ONLY while not editing. The native
//  model keeps the same contract: a source emits the value snapshot plus the parent loading / error /
//  connectivity state, the model derives the render phase, owns the editing session, runs the single
//  asynchronous `commitDraft()` path (no-op / validation / skip-resubmit / await `onSave`), announces a
//  successful save through the P1/S10 facade + the announcer seam, and re-syncs the draft only while the
//  field is idle (the web focus guard).
//

import Foundation
import Observation

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to an ``EditableTextFieldSource``, recomputes the
/// resolved projection, owns the editing session (`isEditing` / `draft` / `isSaving` / `errorText`),
/// commits drafts back through the source's async `save(_:)` (the web `onSave`), announces a successful
/// save, auto-refreshes once when the feed transitions to stale, and re-syncs the draft to the canonical
/// value only while the field is NOT being edited (the web `useEffect` focus guard).
@MainActor
@Observable
public final class EditableTextFieldModel {
    public private(set) var resolved: EditableTextFieldResolved = .init(phase: .loading)
    public private(set) var connection: EditableTextFieldConnection = .live

    /// Whether the field is in edit mode (web `editing`). Drives the display ⇄ input swap.
    public private(set) var isEditing = false
    /// The live draft the input binds to (web `draft`). Mutated on every keystroke by the view.
    public var draft = ""
    /// Whether a commit is in flight (web `saving`) — drives the spinner + disables the input.
    public private(set) var isSaving = false
    /// The current inline error (web `error`) — validation message or a rejected-save message.
    public private(set) var errorText: String?

    public var phase: EditableTextFieldResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private var current = EditableTextFieldInput()
    /// Blocks a duplicate commit while one is in flight (web `savingRef`).
    @ObservationIgnored private var savingInFlight = false
    /// The last value handed to `save` (web `lastSubmittedRef`) — blocks identical re-submits.
    @ObservationIgnored private var lastSubmitted: String?
    @ObservationIgnored private let source: any EditableTextFieldSource
    @ObservationIgnored private let telemetry: any EditableTextFieldTelemetry
    @ObservationIgnored private let announcer: any EditableTextFieldAnnouncer
    /// The optional synchronous validator (web `validate`) — held here so the snapshot stays `Equatable`.
    @ObservationIgnored private let validate: ((String) -> String?)?
    @ObservationIgnored private var started = false

    public init(
        source: any EditableTextFieldSource,
        validate: ((String) -> String?)? = nil,
        telemetry: any EditableTextFieldTelemetry = OSLogEditableTextFieldTelemetry(),
        announcer: any EditableTextFieldAnnouncer = OSLogEditableTextFieldAnnouncer()
    ) {
        self.source = source
        self.validate = validate
        self.telemetry = telemetry
        self.announcer = announcer
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: EditableTextFieldMeta.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    // MARK: Edit session (web startEdit / cancelEdit)

    /// Enters edit mode — the web `startEdit`: ignore when disabled, seed the draft from the canonical
    /// value, clear the error + the last-submitted guard, and flip to editing.
    public func startEdit() {
        guard !current.isDisabled else { return }
        draft = current.value
        errorText = nil
        lastSubmitted = nil
        isEditing = true
    }

    /// Cancels edit mode — the web `cancelEdit`: blocked while a commit is in flight, otherwise reset the
    /// draft to the canonical value, clear the error, and leave editing (web Escape).
    public func cancelEdit() {
        guard !savingInFlight else { return }
        draft = current.value
        errorText = nil
        isEditing = false
    }

    /// Handles a keystroke — the web `handleInputChange`: clamp to `maxLength`, store the draft, and run
    /// the live-validation rule (empty stays silent until commit; a validator message surfaces live).
    public func updateDraft(_ next: String) {
        let clamped = EditableTextFieldEngine.clamp(next, maxLength: current.maxLength)
        draft = clamped
        errorText = EditableTextFieldEngine.liveValidationMessage(for: clamped, validate: validate)
    }

    /// Whether a focus-loss should commit — the web `handleInputBlur` guard: never while saving, never
    /// while an error is showing (stay so the user can fix or Escape out), otherwise commit.
    public func shouldCommitOnBlur() -> Bool {
        !savingInFlight && errorText == nil
    }

    // MARK: Commit (web commitDraft — the single commit path)

    /// The single commit path — the verbatim port of the web `commitDraft()`. Returns `true` when the
    /// editor should exit edit mode (success or a no-op / skip-resubmit), `false` when it should stay
    /// (invalid input or a rejected save). Guards against duplicate in-flight commits (web `savingRef`),
    /// the unchanged no-op, empty + custom validation, and identical re-submits (web `lastSubmittedRef`).
    /// On success it exits, records the submitted value, and announces "{label} saved"; on rejection it
    /// surfaces the error and stays in edit mode so the view can keep focus for a retry.
    @discardableResult
    public func commitDraft() async -> Bool {
        guard !savingInFlight else { return false }

        let decision = EditableTextFieldEngine.decideCommit(
            draft: draft,
            value: current.value,
            lastSubmitted: lastSubmitted,
            validate: validate,
            emptyMessage: EditableTextFieldStrings.emptyError
        )

        switch decision {
        case .noOp:
            errorText = nil
            isEditing = false
            return true
        case let .invalid(message):
            errorText = message
            return false
        case .skipResubmit:
            errorText = nil
            isEditing = false
            return true
        case let .proceed(next):
            return await performSave(next)
        }
    }

    private func performSave(_ next: String) async -> Bool {
        savingInFlight = true
        isSaving = true
        errorText = nil
        defer {
            savingInFlight = false
            isSaving = false
        }
        do {
            try await source.save(next)
            lastSubmitted = next
            isEditing = false
            announcer.announce(EditableTextFieldStrings.saved(label: current.ariaLabel))
            return true
        } catch {
            errorText = EditableTextFieldEngine.saveErrorMessage(
                from: error,
                fallback: EditableTextFieldStrings.saveFailedError
            )
            return false
        }
    }

    // MARK: Source application

    private func apply(_ input: EditableTextFieldInput) {
        current = input
        resolved = EditableTextFieldEngine.resolve(input)
        // Web focus guard: re-sync the draft to the canonical value only while NOT editing.
        if !isEditing {
            draft = input.value
        }
        let previous = connection
        connection = input.connection
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views + the model hold no
/// hardcoded literals. The web `t()` keys (`editableText.error.empty`, `editableText.announce.saved`,
/// `editableText.error.saveFailed`, `editableText.saving`) are mirrored verbatim; the remaining keys are
/// native P4 leaf chrome + a11y additions. Keys live in the "EditableText" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings. In test / preview bundles `NSLocalizedString` returns the `value:` fallback.
public enum EditableTextFieldStrings {
    public static let table = "EditableText"

    public static let string: EditableTextFieldResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    // MARK: Web `t()` keys (mirrored verbatim)

    /// Web `editableText.error.empty` — the built-in empty-input validation message.
    public static var emptyError: String {
        string("editableText.error.empty", "Value cannot be empty")
    }

    /// Web `editableText.error.saveFailed` — the fallback when a rejected save carries no message.
    public static var saveFailedError: String {
        string("editableText.error.saveFailed", "Save failed")
    }

    /// Web `editableText.saving` — the in-flight spinner's accessible label.
    public static var saving: String {
        string("editableText.saving", "Saving…")
    }

    /// Web `editableText.announce.saved` (`{{label}} saved`) — the polite announcement after a save. The
    /// web `{{label}}` interpolation maps to a native `%@` format prompt.
    public static func saved(label: String) -> String {
        String(format: string("editableText.announce.saved", "%@ saved"), label)
    }

    // MARK: Native P4 leaf + a11y additions

    /// VoiceOver label for the initial-fetch skeleton (native — the web source never fetches).
    public static var loadingA11y: String {
        string("editableText.loadingA11y", "Loading the field")
    }

    /// Title of the feed-failure tile (native `QueryError` peer).
    public static var errorTitle: String {
        string("editableText.errorTitle", "Couldn't load the field")
    }

    /// Retry button label on the feed-failure tile.
    public static var retry: String {
        string("editableText.retry", "Retry")
    }

    /// The empty-display leaf shown when the value is empty and no prompt was supplied (native —
    /// the P4 "never a blank box" peer of the web empty display).
    public static var notSet: String {
        string("editableText.notSet", "Not set")
    }

    /// VoiceOver hint on the display button — the action a tap performs (native; the web button's
    /// affordance is implicit in its `role="button"`).
    public static var editHint: String {
        string("editableText.editHint", "Double-tap to edit")
    }

    // MARK: Freshness (P4 connectivity axis)

    public static var live: String {
        string("editableText.live", "Live")
    }

    public static var stale: String {
        string("editableText.stale", "Stale")
    }

    public static var offline: String {
        string("editableText.offline", "Offline")
    }

    public static var staleA11y: String {
        string("editableText.staleA11y", "Stale — tap to refresh")
    }

    public static var offlineA11y: String {
        string("editableText.offlineA11y", "Offline — showing the last saved value")
    }
}
