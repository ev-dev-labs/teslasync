//
//  Select.Adapter.swift
//  TeslaSync — P4 shared surface · 0225 · Select (Apple)
//
//  The Foundation-only core for the form select — the SwiftUI parity of `components/ui/Select.tsx`. This
//  file owns the surface identity (the diagnostics slug), the props value types (``SelectOptionInput``,
//  ``SelectSize``, ``SelectInput``), the view-ready ``SelectProjection``, and the pure ``SelectProjector``
//  that reproduces every render decision the web source makes: the resolved control id (web
//  `id || label?.toLowerCase().replace(/\s+/g, '-')`), the help trigger's `for` fallback (web
//  `help.for ?? selectId`), the unselected prompt option (the web empty-value `<option value="">`), the
//  described-by id (web `error ? \(id)-error : hint ? \(id)-hint : undefined`), the hint-suppressed-by-error
//  rule (web `hint && !error`), and the invalid flag (web `aria-invalid`). No SwiftUI and no `@Observable`,
//  so every rule is unit-testable in isolation (see Select.AdapterTests.swift).
//
//  Faithful-parity note: the web `<Select>` is a PURE presentational primitive. It is a styled native
//  `<select>` that takes its data as plain props (`options`, `label`, `help`, `error`, `hint`, `prompt`,
//  `size`, `required`, `disabled`, plus the controlled `value`/`onChange`) and renders — there is NO fetch,
//  NO React-Query cache, and NO Promise, so it has NO loading, stale, or offline branch (there is nothing to
//  fetch, age, or lose connectivity to). Inventing such chrome would fabricate states the source does not
//  have, so this surface reproduces only the source's REAL branches — exactly as the sibling presentational
//  primitives Label (0218), HelpIcon (0215), CopyButton (0207), and Accordion (0203) did. The real branches:
//    • the labelled / unlabelled select (web `{label && …}`),
//    • the help affordance after the label (web `{help && <HelpIcon … />}`),
//    • the unselected prompt option (the web empty-value `<option value="">`),
//    • each option, honouring the per-option `disabled` flag (web `<option disabled>`),
//    • the four size scales (web `sm` / `md` / `lg` / `auto`),
//    • the required control (web `required` → `aria-required` + the `<Label required>` marker),
//    • the error branch (web `{error && …}` → red border, the error caption, `aria-invalid`, described-by),
//    • the hint branch (web `{hint && !error && …}` → the muted caption, described-by),
//    • and the native "never a blank box" empty leaf when no options resolve (the web renders a bare box;
//      native HIG substitutes a friendly disabled prompt — a REAL "no rows" branch, the acceptance `empty`).
//
//  Naming: the public SwiftUI view is `FormSelect`, NOT `Select` — Swift's standard library / SwiftUI use the
//  `Select`-adjacent vocabulary and a bare module-level `Select` reads ambiguously next to the SwiftUI
//  `Picker`/`Menu` primitives this surface composes; `FormSelect` mirrors the sibling `FormLabel` (0218)
//  naming convention. The diagnostics slug stays "Select".
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum SelectSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "Select"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. The web
/// `<Select>` resolves NONE of its own copy (its `label` / `error` / `hint` / `prompt` arrive as
/// already-localized props, and it delegates `form.required` to `<Label>` + the help keys to `<HelpIcon>`);
/// the native peer adds two a11y leaves of its own (the empty-options copy + the untitled-control spoken
/// name + the required suffix). Kept as a plain closure so the pure core has no dependency on a bundle: the
/// production app passes the P1/S10 facade, tests an identity resolver.
public typealias SelectResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - SelectOptionInput (web `SelectOption`)

/// One selectable option — the native peer of the web `SelectOption { value, label, disabled? }`. `value` is
/// the stable identity bound to the selection (web `<option value>`), `label` is the visible, already-
/// localized title (web `<option>{label}`), and `isDisabled` greys the row out and blocks selection (web
/// `<option disabled>`). Identifiable by `value` so SwiftUI can diff the option rows.
public struct SelectOptionInput: Sendable, Equatable, Identifiable {
    /// The option's stable value bound to the selection (web `value`).
    public let value: String
    /// The visible, already-localized option title (web `label`).
    public let label: String
    /// Whether the option is non-selectable + greyed (web `disabled`).
    public let isDisabled: Bool

    public var id: String {
        value
    }

    public init(value: String, label: String, isDisabled: Bool = false) {
        self.value = value
        self.label = label
        self.isDisabled = isDisabled
    }
}

// MARK: - SelectSize (web `size`)

/// The sizing scale — the native peer of the web `size` prop (`'sm' | 'md' | 'lg' | 'auto'`, default `'md'`).
/// The web maps each to a Tailwind padding/text class; the native peer maps each to a SwiftUI `controlSize`
/// in the view so the control scales with Dynamic Type rather than baking fixed point sizes. The web `'auto'`
/// follows the user's `ui_density` setting; on native that density is an app-level concern applied above this
/// presentational surface, so `auto` resolves to the regular metrics here (the same back-compat default the
/// web `'md'` uses), documented rather than faked.
public enum SelectSize: String, Sendable, CaseIterable {
    case small
    case medium
    case large
    case auto

    /// The web default (`size = 'md'`).
    public static let defaultSize: SelectSize = .medium

    /// Maps a web `size` literal to the native size; unknown values fold to the web default `md`.
    public static func fromWeb(_ raw: String) -> SelectSize {
        switch raw {
        case "sm": .small
        case "lg": .large
        case "auto": .auto
        default: .medium
        }
    }
}

// MARK: - SelectInput (web props, closure-free)

/// The component's props — the native peer of `SelectProps`. A value type so the view, the state-holder, and
/// the pure projection agree on one shape, and so a SwiftUI `.onChange` can detect a prop change cheaply when
/// the page rebinds. The controlled `value` / `onChange` live on the state-holder (the interaction owner),
/// not here, so this stays a pure description of the rendered chrome.
public struct SelectInput: Sendable, Equatable {
    /// The selectable options (web `options`).
    public let options: [SelectOptionInput]
    /// The field label (web `label`); `nil` / empty renders no label row (web `{label && …}`).
    public let label: String?
    /// The optional help affordance shown after the label (web `help`), reusing the `<HelpIcon>` props. Its
    /// `forID` defaults to the resolved control id when absent (web `help.for ?? selectId`).
    public let help: HelpIconInput?
    /// The error message (web `error`); when present it reds the border, shows the error caption, flags the
    /// control invalid, and wins the described-by id over the hint.
    public let error: String?
    /// The helper hint (web `hint`); shown only when there is no error (web `hint && !error`).
    public let hint: String?
    /// The unselected prompt option's title (the web empty-value `<option value="">`); `nil` / empty renders
    /// no prompt row.
    public let prompt: String?
    /// The sizing scale (web `size`, default `md`).
    public let size: SelectSize
    /// The explicit control id (web `id`); when absent the id is derived from the label.
    public let explicitID: String?
    /// Whether the field is required (web `required` → `aria-required` + the `<Label>` marker).
    public let isRequired: Bool
    /// Whether the whole control is disabled (web `disabled`).
    public let isDisabled: Bool

    public init(
        options: [SelectOptionInput],
        label: String? = nil,
        help: HelpIconInput? = nil,
        error: String? = nil,
        hint: String? = nil,
        prompt: String? = nil,
        size: SelectSize = .defaultSize,
        explicitID: String? = nil,
        isRequired: Bool = false,
        isDisabled: Bool = false
    ) {
        self.options = options
        self.label = label
        self.help = help
        self.error = error
        self.hint = hint
        self.prompt = prompt
        self.size = size
        self.explicitID = explicitID
        self.isRequired = isRequired
        self.isDisabled = isDisabled
    }
}

// MARK: - SelectProjector (web render body)

/// The pure projection from the props + the resolved a11y copy to the view-ready model — the surface's data
/// adapter in the "props → projection" sense the acceptance calls for: it takes the props a page already
/// holds (no fetch, no clock) and derives the rendered select. Every web render decision is a function here
/// so the view holds no logic and every branch is unit tested in isolation.
public enum SelectProjector {
    /// JS string truthiness for an optional prop — `nil` and `""` are absent (web `{prop && …}`); any other
    /// value (including whitespace) is present, matching JavaScript's `&&` on a string.
    public static func isPresent(_ value: String?) -> Bool {
        guard let value else { return false }
        return !value.isEmpty
    }

    /// Slugifies a label into a control id — the verbatim port of `label.toLowerCase().replace(/\s+/g, '-')`:
    /// lowercased, with every run of whitespace collapsed to a single hyphen (no trimming, matching the web).
    public static func slug(fromLabel label: String) -> String {
        label
            .lowercased()
            .replacingOccurrences(of: "\\s+", with: "-", options: .regularExpression)
    }

    /// Resolves the control id — the verbatim port of `id || label?.toLowerCase().replace(/\s+/g, '-')`. An
    /// explicit non-empty id wins; otherwise the label is slugified; otherwise `nil` (no label, no id).
    public static func resolveID(explicitID: String?, label: String?) -> String? {
        if let explicitID, !explicitID.isEmpty { return explicitID }
        if let label, isPresent(label) { return slug(fromLabel: label) }
        return nil
    }

    /// The error caption's element id (web `\(selectId)-error`); `nil` when no error or no resolved id.
    public static func errorID(resolvedID: String?, hasError: Bool) -> String? {
        guard hasError, let resolvedID else { return nil }
        return "\(resolvedID)-error"
    }

    /// The hint caption's element id (web `\(selectId)-hint`); `nil` when the hint is not shown or no id.
    public static func hintID(resolvedID: String?, showsHint: Bool) -> String? {
        guard showsHint, let resolvedID else { return nil }
        return "\(resolvedID)-hint"
    }

    /// The control's described-by id — the verbatim port of
    /// `error ? \(selectId)-error : hint ? \(selectId)-hint : undefined`. Resolves to the error id when
    /// errored, else the hint id when a hint is shown, else `nil`.
    public static func describedByID(errorID: String?, hintID: String?) -> String? {
        errorID ?? hintID
    }

    /// Resolves the help props' effective `for` — the verbatim port of `help.for ?? selectId`. A help-
    /// supplied `forID` wins; otherwise the resolved control id backs the "Help for {{id}}" trigger label.
    public static func resolveHelp(_ help: HelpIconInput?, resolvedID: String?) -> HelpIconInput? {
        guard let help else { return nil }
        let effectiveFor = SelectProjector.isPresent(help.forID) ? help.forID : resolvedID
        return HelpIconInput(
            i18nKey: help.i18nKey,
            content: help.content,
            forID: effectiveFor,
            side: help.side,
            ariaLabelOverride: help.ariaLabelOverride
        )
    }

    /// Composes the control's spoken name — the visible `label` (or the untitled fallback when blank) with
    /// the localized "required" word appended when required, the native peer of `aria-required` plus the
    /// label↔control association VoiceOver would otherwise read from the paired `<Label>`.
    public static func accessibilityLabel(
        label: String?,
        isRequired: Bool,
        untitled: String,
        requiredWord: String
    ) -> String {
        let base = isPresent(label) ? (label ?? untitled) : untitled
        return isRequired ? "\(base) \(requiredWord)" : base
    }

    /// The trigger's display title — the selected option's label (web `options.find(o => o.value === value)`),
    /// else the unselected prompt (the web empty-value option), else the first option (a native menu shows a
    /// concrete row), else the untitled fallback. A pure derivation so the trigger text is unit tested.
    public static func displayTitle(
        options: [SelectOptionInput],
        selection: String,
        prompt: String?,
        untitled: String
    ) -> String {
        if let match = options.first(where: { $0.value == selection }) {
            return match.label
        }
        if isPresent(prompt), let prompt {
            return prompt
        }
        if let first = options.first {
            return first.label
        }
        return untitled
    }

    /// Resolves the whole select from the props + the localized a11y copy — the native peer of the web
    /// component's render decision. `emptyText`, `untitled`, and `requiredWord` are injected so this core
    /// stays bundle-free.
    public static func resolve(
        input: SelectInput,
        emptyText: String,
        untitled: String,
        requiredWord: String
    ) -> SelectProjection {
        let resolvedID = resolveID(explicitID: input.explicitID, label: input.label)
        let hasError = isPresent(input.error)
        let showsHint = isPresent(input.hint) && !hasError
        let resolvedErrorID = errorID(resolvedID: resolvedID, hasError: hasError)
        let resolvedHintID = hintID(resolvedID: resolvedID, showsHint: showsHint)
        let showsLabel = isPresent(input.label)
        let resolvedHelp = resolveHelp(input.help, resolvedID: resolvedID)
        let showsPrompt = isPresent(input.prompt)
        return SelectProjection(
            resolvedID: resolvedID,
            label: showsLabel ? input.label : nil,
            showsLabel: showsLabel,
            help: resolvedHelp,
            showsHelp: resolvedHelp != nil,
            prompt: showsPrompt ? input.prompt : nil,
            showsPrompt: showsPrompt,
            options: input.options,
            isEmpty: input.options.isEmpty,
            emptyText: emptyText,
            size: input.size,
            isRequired: input.isRequired,
            isDisabled: input.isDisabled,
            errorText: hasError ? input.error : nil,
            showsError: hasError,
            errorID: resolvedErrorID,
            hintText: showsHint ? input.hint : nil,
            showsHint: showsHint,
            hintID: resolvedHintID,
            describedByID: describedByID(errorID: resolvedErrorID, hintID: resolvedHintID),
            isInvalid: hasError,
            accessibilityLabel: accessibilityLabel(
                label: input.label,
                isRequired: input.isRequired,
                untitled: untitled,
                requiredWord: requiredWord
            )
        )
    }
}
