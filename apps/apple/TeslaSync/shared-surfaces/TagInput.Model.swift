//
//  TagInput.Model.swift
//  TeslaSync — P4 shared surface · 0160 · TagInput (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the polite-announcement seam (the native
//  parity of the web `useAnnouncer` live region), the i18n facade (P1/S10), and the pure view-state
//  projection for the tag chip input. The view binds through `TagInputModel`; no networking lives in the
//  view. The web `TagInput` is a CONTROLLED field: the parent owns `value` and receives `onChange(next)`,
//  while the field keeps only the in-progress `pending` text + a validation `error`. The native model
//  keeps that contract — a source emits the current value snapshot plus the parent's loading / error /
//  connectivity, the model derives the render phase, threads typed text + commits through the pure
//  `TagInputEngine`, writes the new value back through the source (the web `onChange`), and voices the
//  add / remove / duplicate / cap announcements politely (the web live region).
//

import Foundation
import Observation

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound value feed — the orthogonal connectivity axis rendered as the freshness
/// chip. `live` hides the chip; `stale` / `offline` show it.
public enum TagInputConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (the web props + parent lifecycle)

/// One coalesced snapshot of the field's inputs — the web `value` / `label` / `hideLabel` / field-prompt
/// / `maxTags` / `separators` / `lowercase` / `disabled` / `hint` props plus the parent's lifecycle
/// (`isLoading`, an error message, connectivity). The `validateTag` and `onChange` closures are NOT here
/// — they live on the source / model so this value stays `Equatable` / `Sendable`.
public struct TagInputSnapshot: Sendable, Equatable {
    /// The current committed tags (web controlled `value`).
    public var tags: [String]
    /// The required visible / aria label (web `label`).
    public var label: String
    /// When true, the label is rendered visually-hidden but still announced (web `hideLabel`).
    public var hideLabel: Bool
    /// The typing field prompt shown when empty (web field prompt); `nil` falls back to the localized
    /// default.
    public var prompt: String?
    /// Maximum number of tags; when reached the field disables (web `maxTags`).
    public var maxTags: Int?
    /// Additional in-text commit separators (web `separators`, default comma).
    public var separators: [TagSeparator]
    /// Lower-case all tags before commit (web `lowercase`).
    public var lowercase: Bool
    /// Disable the input + chip remove buttons (web `disabled`).
    public var disabled: Bool
    /// Optional helper hint under the field when there is no error (web `hint`).
    public var hint: String?
    /// The parent's value fetch is in flight → loading chrome (P4 leaf).
    public var isLoading: Bool
    /// The parent's value fetch failed → error chrome (P4 leaf, web `QueryError` peer).
    public var errorMessage: String?
    /// The bound feed freshness (P4 leaf connectivity axis).
    public var connection: TagInputConnection

    public init(
        tags: [String] = [],
        label: String = "",
        hideLabel: Bool = false,
        prompt: String? = nil,
        maxTags: Int? = nil,
        separators: [TagSeparator] = TagInputMeta.defaultSeparators,
        lowercase: Bool = false,
        disabled: Bool = false,
        hint: String? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: TagInputConnection = .live
    ) {
        self.tags = tags
        self.label = label
        self.hideLabel = hideLabel
        self.prompt = prompt
        self.maxTags = maxTags
        self.separators = separators
        self.lowercase = lowercase
        self.disabled = disabled
        self.hint = hint
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body, and for the `ready` phase the tags, label,
/// prompt facts, count text, cap + disabled flags, and hint are carried so the view is a pure function of
/// this value. The in-progress text + validation error live on the model (they change per keystroke).
public struct TagInputResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case ready
        case error(String)
    }

    public let phase: Phase
    /// The committed tags rendered as chips (web `value`).
    public let tags: [String]
    /// The field label (web `label`).
    public let label: String
    /// Render the label visually-hidden (web `hideLabel`).
    public let hideLabel: Bool
    /// The caller-supplied prompt (web field prompt); `nil` → the localized default at the view.
    public let customPrompt: String?
    /// The cap, for the count text + the max hint (web `maxTags`).
    public let maxTags: Int?
    /// The "n/max" count appended to the label (web `({value.length}/{maxTags})`); `nil` when uncapped.
    public let countText: String?
    /// The cap has been reached (web `atMax`) — disables the input + shows the cap hint / prompt.
    public let atMax: Bool
    /// No tags are present (the empty ready sub-state — still renders the field, never a blank box).
    public let isEmpty: Bool
    /// The typing field is disabled (web `inputDisabled = disabled || atMax`).
    public let isDisabled: Bool
    /// The chip remove buttons are disabled (web `disabled` only — independent of the cap).
    public let chipsDisabled: Bool
    /// Optional helper hint shown under the field when there is no error / cap (web `hint`).
    public let hint: String?

    public init(
        phase: Phase,
        tags: [String] = [],
        label: String = "",
        hideLabel: Bool = false,
        customPrompt: String? = nil,
        maxTags: Int? = nil,
        countText: String? = nil,
        atMax: Bool = false,
        isEmpty: Bool = true,
        isDisabled: Bool = false,
        chipsDisabled: Bool = false,
        hint: String? = nil
    ) {
        self.phase = phase
        self.tags = tags
        self.label = label
        self.hideLabel = hideLabel
        self.customPrompt = customPrompt
        self.maxTags = maxTags
        self.countText = countText
        self.atMax = atMax
        self.isEmpty = isEmpty
        self.isDisabled = isDisabled
        self.chipsDisabled = chipsDisabled
        self.hint = hint
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state. A non-empty error message surfaces
/// as `error` (web `QueryError` peer), an in-flight parent fetch as `loading`, otherwise the editable
/// `ready` field — which always renders (empty OR populated), never a hidden box. The cap, count text,
/// and disabled flags are computed here so the view holds no derivation. Unit tested across loading /
/// ready-empty / ready-populated / at-max / error.
public enum TagInputProjection {
    public static func resolve(_ input: TagInputSnapshot) -> TagInputResolved {
        let phase: TagInputResolved.Phase = if let message = input.errorMessage, !message.isEmpty {
            .error(message)
        } else if input.isLoading {
            .loading
        } else {
            .ready
        }
        let atMax = input.maxTags.map { input.tags.count >= $0 } ?? false
        let countText = input.maxTags.map { "\(input.tags.count)/\($0)" }
        return TagInputResolved(
            phase: phase,
            tags: input.tags,
            label: input.label,
            hideLabel: input.hideLabel,
            customPrompt: input.prompt,
            maxTags: input.maxTags,
            countText: countText,
            atMax: atMax,
            isEmpty: input.tags.isEmpty,
            isDisabled: input.disabled || atMax,
            chipsDisabled: input.disabled,
            hint: input.hint
        )
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `TagInputSource`, recomputes the resolved
/// projection, exposes the render `phase` + the committed tags + the live `pending` text + the validation
/// `error` + the `connection` axis, threads typed text / Enter / blur / backspace / removal through the
/// pure ``TagInputEngine``, writes the new value back through the source (the web `onChange`), voices the
/// add / remove / duplicate / cap announcements politely (the web live region), and auto-refreshes once
/// when the feed transitions to stale.
@MainActor
@Observable
public final class TagInputModel {
    public private(set) var resolved: TagInputResolved = .init(phase: .loading)
    public private(set) var connection: TagInputConnection = .live

    /// The live in-progress text the typing field binds to (the web local `pending` state). Mutated as
    /// the user types via ``updatePending(_:)``; never overwritten by an external value change.
    public private(set) var editingText: String = ""

    /// The current validation error shown under the field (web `error`), or `nil`. Set by a blocked
    /// commit, cleared when the user edits or removes a chip.
    public private(set) var errorText: String?

    /// The most-recent polite live-region text (web announce). Observed so a UI test can read what
    /// VoiceOver was asked to speak; the real voicing happens through the announcer seam.
    public private(set) var announcement = ""

    public var phase: TagInputResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private var current = TagInputSnapshot()
    @ObservationIgnored private let validate: ((String) -> String?)?
    @ObservationIgnored private let source: any TagInputSource
    @ObservationIgnored private let telemetry: any TagInputTelemetry
    @ObservationIgnored private let announcer: any TagInputAnnouncer
    @ObservationIgnored private var announceCounter = 0
    @ObservationIgnored private var started = false

    public init(
        source: any TagInputSource,
        validate: ((String) -> String?)? = nil,
        telemetry: any TagInputTelemetry = OSLogTagInputTelemetry(),
        announcer: any TagInputAnnouncer = OSLogTagInputAnnouncer()
    ) {
        self.source = source
        self.validate = validate
        self.telemetry = telemetry
        self.announcer = announcer
        source.onUpdate = { [weak self] snapshot in self?.applySnapshot(snapshot) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TagInputMeta.surfaceSlug)
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

    // MARK: Editing (web handleInputChange / handleKeyDown / handleBlur / handlePaste)

    /// Handle a change to the typing field — the web `handleInputChange`. When the new text contains a
    /// separator (a typed separator OR a paste), commit everything up to the last separator and keep the
    /// trailing fragment as the new pending text; otherwise just store the text and clear a stale error.
    public func updatePending(_ text: String) {
        if TagInputEngine.containsSeparator(text, separators: current.separators) {
            let result = engineCommit(text)
            applyCommit(result)
        } else {
            editingText = text
            if errorText != nil { errorText = nil }
        }
    }

    /// Commit the pending text unconditionally — the web Enter path (`handleKeyDown` → `commitAll`). An
    /// empty field clears any stale error and does nothing else.
    public func submit() {
        commitAll()
    }

    /// Commit the pending text only when it is non-blank — the web blur path (`handleBlur`) and the
    /// imperative `commitPending()` handle. Avoids committing on a focus loss with nothing typed.
    public func commitPendingIfNeeded() {
        guard !editingText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        commitAll()
    }

    /// Remove the trailing chip when Backspace is pressed at the empty field — the web `handleKeyDown`
    /// Backspace branch. A no-op when text is present, the list is empty, or the field is disabled.
    public func backspaceAtStart() {
        guard !current.disabled, editingText.isEmpty, !current.tags.isEmpty else { return }
        removeTag(at: current.tags.count - 1)
    }

    /// Remove the chip at `index` — the web chip remove button / `removeAt`. Writes the new value back
    /// through the source, clears a stale error, and announces the removal politely.
    public func removeTag(at index: Int) {
        guard !current.disabled else { return }
        let removal = TagInputEngine.removeAt(index, from: current.tags)
        guard let removed = removal.removed else { return }
        current.tags = removal.tags
        resolved = TagInputProjection.resolve(current)
        source.commit(removal.tags)
        if errorText != nil { errorText = nil }
        voice(.removed(removed))
    }

    // MARK: Private

    /// Force-commit the entire pending text (Enter / blur / imperative) — the web `commitAll`: append the
    /// primary separator so the trailing fragment is consumed too, then run the engine.
    private func commitAll() {
        let text = editingText
        if text.isEmpty {
            if errorText != nil { errorText = nil }
            return
        }
        let separator = String(current.separators.first?.rawValue ?? ",")
        applyCommit(engineCommit(text + separator))
    }

    private func engineCommit(_ text: String) -> TagInputCommit {
        TagInputEngine.commit(
            text: text,
            into: current.tags,
            separators: current.separators,
            lowercase: current.lowercase,
            maxTags: current.maxTags,
            validate: validate
        )
    }

    /// Apply a commit result — write the new value back through the source (Live re-emits the snapshot;
    /// the model also updates its own value optimistically so the chips reflect the edit immediately even
    /// behind an in-memory source), keep the trailing fragment as pending, set / clear the error, and
    /// voice the announcement when no error blocked the commit. Mirrors the web `commitText` tail +
    /// `commitAll`'s `setPending(remainder)`.
    private func applyCommit(_ result: TagInputCommit) {
        if result.tags != current.tags {
            current.tags = result.tags
            resolved = TagInputProjection.resolve(current)
            source.commit(result.tags)
        }
        editingText = result.remainder
        errorText = result.error
        if result.error == nil {
            voice(result.announcement)
        }
    }

    private func applySnapshot(_ snapshot: TagInputSnapshot) {
        current = snapshot
        resolved = TagInputProjection.resolve(snapshot)
        let previous = connection
        connection = snapshot.connection
        if snapshot.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    /// Voice a semantic announcement — map it to the localized string, append the rotating zero-width
    /// padding so the assistive technology re-reads identical consecutive messages, and post it.
    private func voice(_ kind: TagInputAnnouncementKind) {
        let text: String
        switch kind {
        case .none:
            return
        case let .added(count):
            text = count == 1 ? TagInputStrings.addedOne : TagInputStrings.added(count)
        case let .duplicate(tag):
            text = TagInputStrings.duplicate(tag)
        case .maxReached:
            text = TagInputStrings.maxReachedAnnounce
        case let .removed(tag):
            text = TagInputStrings.removed(tag)
        }
        announceCounter += 1
        let padded = text + TagInputEngine.announcementPadding(sequence: announceCounter)
        announcement = padded
        announcer.announce(padded)
    }
}
