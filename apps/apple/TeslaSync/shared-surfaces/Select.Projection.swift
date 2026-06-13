//
//  Select.Projection.swift
//  TeslaSync — P4 shared surface · 0225 · Select (Apple)
//
//  The view-ready projection for the form select — the resolved shape the SwiftUI body consumes as a pure
//  function of the props + the localized a11y copy, derived by ``SelectProjector`` (Select.Adapter.swift) and
//  observed by ``SelectModel`` (Select.Model.swift). Split into its own file (the sibling precedent
//  FormatterPrefsBridge.Projection.swift) to keep each source within the SwiftLint length budget. Foundation-
//  only and `Equatable`, so it diffs cheaply across re-renders and is asserted directly in the unit tests.
//

import Foundation

// MARK: - SelectProjection (view-ready)

/// The resolved, view-ready select — everything the SwiftUI body needs as a pure function of the props + the
/// resolved a11y copy (no derivation in the view). Mirrors the web render output field-for-field so the view
/// is a thin renderer: the label row, the help affordance + its resolved `for`, the prompt option, the
/// options, the empty leaf, the error + hint captions with their ids, the described-by id, and the invalid
/// flag.
public struct SelectProjection: Sendable, Equatable {
    /// The resolved control id — web `id || slug(label)`; `nil` when neither an id nor a label is supplied.
    public let resolvedID: String?
    /// The label text (web `label`); `nil` / empty when no label row renders.
    public let label: String?
    /// Whether the label row renders (web `{label && …}`).
    public let showsLabel: Bool
    /// The help props with the `for` already resolved (web `help.for ?? selectId`); `nil` when no help.
    public let help: HelpIconInput?
    /// Whether the help affordance renders (web `{help && …}`).
    public let showsHelp: Bool
    /// The unselected prompt option's title (the web empty-value option); `nil` when no prompt row renders.
    public let prompt: String?
    /// Whether the prompt option renders (web `{prompt && …}`).
    public let showsPrompt: Bool
    /// The selectable options (web `options`).
    public let options: [SelectOptionInput]
    /// Whether there are no options (the native "never a blank box" empty leaf — the acceptance `empty`).
    public let isEmpty: Bool
    /// The localized empty-leaf copy shown when `isEmpty` (native a11y addition).
    public let emptyText: String
    /// The sizing scale (web `size`).
    public let size: SelectSize
    /// Whether the field is required (web `required` → `aria-required`).
    public let isRequired: Bool
    /// Whether the control is disabled (web `disabled`).
    public let isDisabled: Bool
    /// The error caption text (web `error`); `nil` when no error.
    public let errorText: String?
    /// Whether the error caption renders (web `{error && …}`).
    public let showsError: Bool
    /// The error caption's element id (web `\(selectId)-error`); `nil` when no error / no id.
    public let errorID: String?
    /// The hint caption text (web `hint`); `nil` when no hint or when an error suppresses it.
    public let hintText: String?
    /// Whether the hint caption renders (web `hint && !error`).
    public let showsHint: Bool
    /// The hint caption's element id (web `\(selectId)-hint`); `nil` when no hint / no id.
    public let hintID: String?
    /// The control's described-by id — web `error ? errorID : hint ? hintID : undefined`.
    public let describedByID: String?
    /// Whether the control is in the invalid state (web `aria-invalid`).
    public let isInvalid: Bool
    /// The control's spoken name (the visible `label`, or the localized untitled fallback) with the localized
    /// "required" suffix folded in when required — the native peer of `aria-required` + the label association.
    public let accessibilityLabel: String

    public init(
        resolvedID: String?,
        label: String?,
        showsLabel: Bool,
        help: HelpIconInput?,
        showsHelp: Bool,
        prompt: String?,
        showsPrompt: Bool,
        options: [SelectOptionInput],
        isEmpty: Bool,
        emptyText: String,
        size: SelectSize,
        isRequired: Bool,
        isDisabled: Bool,
        errorText: String?,
        showsError: Bool,
        errorID: String?,
        hintText: String?,
        showsHint: Bool,
        hintID: String?,
        describedByID: String?,
        isInvalid: Bool,
        accessibilityLabel: String
    ) {
        self.resolvedID = resolvedID
        self.label = label
        self.showsLabel = showsLabel
        self.help = help
        self.showsHelp = showsHelp
        self.prompt = prompt
        self.showsPrompt = showsPrompt
        self.options = options
        self.isEmpty = isEmpty
        self.emptyText = emptyText
        self.size = size
        self.isRequired = isRequired
        self.isDisabled = isDisabled
        self.errorText = errorText
        self.showsError = showsError
        self.errorID = errorID
        self.hintText = hintText
        self.showsHint = showsHint
        self.hintID = hintID
        self.describedByID = describedByID
        self.isInvalid = isInvalid
        self.accessibilityLabel = accessibilityLabel
    }
}
