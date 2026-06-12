//
//  Label.Adapter.swift
//  TeslaSync — P4 shared surface · 0218 · Label (Apple)
//
//  The Foundation-only core for the form label — the SwiftUI parity of `components/ui/Label.tsx`. This
//  file owns the surface identity (the diagnostics slug), the i18n facade seam, the props value type
//  (``LabelInput``), the view-ready ``LabelProjection``, and the pure ``LabelProjector`` that composes the
//  visible text + the required marker + the accessible name (the native peer of the web visible `*` marked
//  `aria-hidden` PLUS the `<VisuallyHidden> required</VisuallyHidden>` folded into the control's accessible
//  name). No SwiftUI and no `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<Label>` is a PURE presentational primitive. It renders an HTML `<label>`
//  around caller-supplied `children`, and when `required` is set appends a red `*` (`aria-hidden`) plus a
//  visually-hidden ` ${t('form.required', 'required')}` so the paired control's accessible name reads
//  "<label> required" (WCAG 3.3.2). It takes its data as plain props (`children`, `required`, the
//  pass-through `htmlFor` + `className`) — there is NO fetch, NO React-Query cache, and NO Promise, so it
//  has NO loading, error, stale, or offline branch (there is nothing to fetch, fail, age, or lose
//  connectivity to). Inventing such chrome would fabricate states the source does not have, so this surface
//  reproduces only the source's REAL branches — exactly as the sibling presentational primitives Delta
//  (0081), MetricCard (0095), InlineCallout (0124), ActiveFilterChips (0147), StaggerItem (0194), and
//  Accordion (0203) did. The real branches: the plain (not-required) label, the required label (visible `*`
//  + the screen-reader "required" suffix), and the native "never a blank box" empty-text leaf.
//
//  Naming: the public SwiftUI view is `FormLabel`, NOT `Label` — `Label` is a SwiftUI built-in used at many
//  call sites in this module (`Label(_, systemImage:)`), so a module-level `Label` would shadow it and
//  break those call sites. `FormLabel` also matches the web source's own note that this form label is
//  "semantically distinct from" the typography `Label`. The diagnostics slug stays "Label".
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum LabelSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "Label"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. The web
/// `<Label>` resolves exactly one key of its own — `t('form.required', 'required')` for the screen-reader
/// suffix — and the native peer adds the empty-text leaf's a11y copy. Kept as a plain closure so the pure
/// core has no dependency on a bundle: the production app passes the P1/S10 facade, tests an identity
/// resolver.
public typealias LabelResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - LabelInput (web props, closure-free)

/// The component's props — the native peer of `LabelProps`. The web takes `children` (the label content),
/// `required`, and the pass-through `htmlFor` / `className` / `...rest`. Here `text` carries the
/// already-localized caller content (web `children`, rendered verbatim), `isRequired` is the web
/// `required`, and `fieldIdentifier` carries the web `htmlFor` (the control association) so the native
/// label can expose the same association via its accessibility identifier. A value type so the view, the
/// state-holder, and the pure projection agree on one shape, and so a SwiftUI `.onChange` can detect a prop
/// change cheaply when the page rebinds.
public struct LabelInput: Sendable, Equatable {
    /// The label content (web `children`) — caller-supplied + already localized, rendered verbatim.
    public let text: String
    /// Whether the required marker + screen-reader "required" suffix are rendered (web `required`).
    public let isRequired: Bool
    /// The associated control's identifier (web `htmlFor`), surfaced as the native accessibility
    /// identifier; `nil` when the label is standalone.
    public let fieldIdentifier: String?

    public init(text: String, isRequired: Bool = false, fieldIdentifier: String? = nil) {
        self.text = text
        self.isRequired = isRequired
        self.fieldIdentifier = fieldIdentifier
    }
}

// MARK: - LabelProjection (view-ready)

/// The resolved, view-ready label — everything the SwiftUI body needs as a pure function of the props + the
/// resolved copy (no derivation in the view). `displayText` is the visible text (the web `children`, or the
/// empty-leaf fallback when blank); `showsRequiredMarker` is the web `{required && ...}`;
/// `requiredMarkerGlyph` is the web literal `*`; `accessibilityLabel` is the composed accessible name (web
/// `children` + the visually-hidden ` required`); `isEmpty` flags the native "never a blank box" leaf.
public struct LabelProjection: Sendable, Equatable {
    /// The visible label text — the caller content, or the empty-leaf fallback when the content is blank.
    public let displayText: String
    /// Whether the required marker renders (web `required`).
    public let showsRequiredMarker: Bool
    /// The required marker glyph — the web literal `*`.
    public let requiredMarkerGlyph: String
    /// The composed accessible name — `displayText` plus the localized "required" suffix when required (the
    /// native peer of the web visually-hidden ` ${t('form.required')}`).
    public let accessibilityLabel: String
    /// Whether the caller content was blank, triggering the native "never a blank box" fallback styling.
    public let isEmpty: Bool
    /// The associated control's identifier (web `htmlFor`), surfaced as the accessibility identifier.
    public let fieldIdentifier: String?

    public init(
        displayText: String,
        showsRequiredMarker: Bool,
        requiredMarkerGlyph: String,
        accessibilityLabel: String,
        isEmpty: Bool,
        fieldIdentifier: String?
    ) {
        self.displayText = displayText
        self.showsRequiredMarker = showsRequiredMarker
        self.requiredMarkerGlyph = requiredMarkerGlyph
        self.accessibilityLabel = accessibilityLabel
        self.isEmpty = isEmpty
        self.fieldIdentifier = fieldIdentifier
    }
}

// MARK: - LabelProjector (web render body)

/// The pure projection from the props + the resolved copy to the view-ready model — the surface's data
/// adapter in the "props → projection" sense the acceptance calls for: it takes the props a page already
/// holds plus the localized "required" word + empty fallback (no fetch, no clock) and derives the
/// rendered label. Unit tested across the not-required / required split, the accessible-name composition,
/// and the empty-text leaf.
public enum LabelProjector {
    /// The required marker glyph — the verbatim web literal `*`.
    public static let requiredMarker = "*"

    /// Whether the caller content is blank (empty or whitespace only) — the native "never a blank box"
    /// trigger. The web simply renders an empty `<label>`; the native peer substitutes a fallback.
    public static func isBlank(_ text: String) -> Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Composes the accessible name — the native peer of the web `children` followed by the visually-hidden
    /// ` ${t('form.required', 'required')}`. When required the localized word is appended after a single
    /// space; otherwise the base text stands alone.
    public static func accessibilityLabel(base: String, isRequired: Bool, requiredWord: String) -> String {
        isRequired ? "\(base) \(requiredWord)" : base
    }

    /// Resolves the whole label from the props + the localized copy — the native peer of the web
    /// component's render decision. `requiredWord` is the resolved `form.required` string and
    /// `emptyFallback` is the native empty-leaf copy; both are injected so this core stays bundle-free.
    public static func resolve(
        input: LabelInput,
        requiredWord: String,
        emptyFallback: String
    ) -> LabelProjection {
        let blank = isBlank(input.text)
        let display = blank ? emptyFallback : input.text
        return LabelProjection(
            displayText: display,
            showsRequiredMarker: input.isRequired,
            requiredMarkerGlyph: requiredMarker,
            accessibilityLabel: accessibilityLabel(
                base: display,
                isRequired: input.isRequired,
                requiredWord: requiredWord
            ),
            isEmpty: blank,
            fieldIdentifier: input.fieldIdentifier
        )
    }
}
