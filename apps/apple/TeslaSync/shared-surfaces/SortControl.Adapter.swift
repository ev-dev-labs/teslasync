//
//  SortControl.Adapter.swift
//  TeslaSync — P4 shared surface · 0159 · SortControl (Apple)
//
//  The Foundation-only core for the list sort control — the SwiftUI parity of
//  `components/forms/SortControl.tsx`. This file owns the surface identity (the diagnostics slug), the
//  ``SortDirection`` value (web `'asc' | 'desc'`, with its lucide → SF Symbol mapping + i18n key/fallback),
//  one sort field (``SortOption`` — the web `SortOption<F>` value/label pair), the props value type
//  (``SortControlInput``), the view-ready ``SortControlProjection``, and the pure ``SortControlProjector``
//  that maps props → projection and reproduces the web direction flip. No SwiftUI and no `@Observable`, so
//  every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<SortControl>` is a PURE, CONTROLLED presentational component. It takes
//  its `field` + `direction` as plain props and reports changes back through `onFieldChange` /
//  `onDirectionChange` — there is no fetch, no React-Query cache, and no Promise — so it has NO loading,
//  error, stale, or offline branch (there is nothing to fetch, fail, age, or lose connectivity to; its only
//  "hook" is `useTranslation`). Inventing such chrome would fabricate states the source does not have, so
//  this surface reproduces only the source's REAL branches — exactly as the sibling presentational
//  primitives DensityToggle (0153) and ActiveFilterChips (0147) did. The real branches are: the populated
//  field dropdown (one option selected), the ascending / descending direction toggle, the
//  field-not-in-options edge (the trigger falls back to the raw field key), the custom-vs-default direction
//  accessibility label, and the degenerate empty-options case (the field dropdown becomes a friendly empty
//  chip rather than a bare box, per the HIG, while the independent direction toggle keeps rendering — the
//  web renders the button unconditionally).
//
//  Generic note: the web component is generic over a string-literal field union (`F extends string`). The
//  native peer uses a plain `String` field key (the stable value carried in URL state), so the same
//  value/label option list and the same selection semantics survive without a Swift generic.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum SortControlSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "SortControl"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// closure so the pure core has no dependency on a bundle: the production app passes the P1/S10 facade,
/// while tests pass an identity-fallback resolver.
public typealias SortControlResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - SortDirection (web `SortDirection` union)

/// The sort direction — the native peer of the web `SortDirection` union (`'asc' | 'desc'`). Carries the
/// web's lucide-icon mapping (as an SF Symbol), the i18n key, and the English fallback, so the projector
/// can resolve a fully view-ready toggle without the view knowing the mapping.
public enum SortDirection: String, Sendable, Equatable, CaseIterable, Identifiable {
    /// Ascending order (web `'asc'`, icon `ArrowUp`).
    case asc
    /// Descending order (web `'desc'`, icon `ArrowDown`).
    case desc

    /// Stable identity for `ForEach` / `Identifiable` (the raw value matches the web string literal).
    public var id: String {
        rawValue
    }

    /// The flipped direction — the verbatim port of the web `direction === 'asc' ? 'desc' : 'asc'`.
    public var toggled: SortDirection {
        self == .asc ? .desc : .asc
    }

    /// The per-direction label i18n key (web `t('sortControl.ascending' | 'sortControl.descending')`).
    var labelKey: String {
        switch self {
        case .asc: "sortControl.ascending"
        case .desc: "sortControl.descending"
        }
    }

    /// The per-direction English fallback — byte-identical to the web defaults.
    var labelFallback: String {
        switch self {
        case .asc: "Ascending"
        case .desc: "Descending"
        }
    }

    /// The SF Symbol mapped from the web lucide icon — `ArrowUp` → `arrow.up`, `ArrowDown` → `arrow.down`,
    /// so the glyph reads the same direction semantics on both platforms.
    var systemImage: String {
        switch self {
        case .asc: "arrow.up"
        case .desc: "arrow.down"
        }
    }
}

// MARK: - SortOption (web `SortOption<F>`)

/// One sort field — the native peer of the web `SortOption<F>` (`{ value, label }`). `value` is the stable
/// field key (also used in URL state, web `value: F`); `label` is the localised, user-visible name (web
/// `label: string`). The host already localises the labels, exactly like the web caller.
public struct SortOption: Sendable, Equatable, Identifiable {
    /// The stable field key (web `value`, also used in URL state).
    public let value: String
    /// The localised, user-visible label (web `label`).
    public let label: String

    public init(value: String, label: String) {
        self.value = value
        self.label = label
    }

    /// Stable identity for `ForEach` / `Identifiable` (the field key).
    public var id: String {
        value
    }
}

// MARK: - SortControlInput (web props, closure-free)

/// The component's props — the native peer of `SortControlProps`, minus the `onFieldChange` /
/// `onDirectionChange` closures (held by the state-holder so this value stays `Equatable`/`Sendable`). A
/// value type so the view, the state-holder, and the pure projection agree on one shape, and so a SwiftUI
/// `.onChange` can detect a prop change cheaply when the page rebinds a fresh value.
public struct SortControlInput: Sendable, Equatable {
    /// The currently selected sort field key (web `field`).
    public let field: String
    /// The currently selected direction (web `direction`).
    public let direction: SortDirection
    /// The sortable fields, in order (web `options`).
    public let options: [SortOption]
    /// An optional explicit accessible name for the direction button, overriding the default (web
    /// `directionAriaLabel`).
    public let directionAriaLabel: String?
    /// An optional accessibility identifier for UI tests (web `testId`, applied to the field + direction
    /// controls).
    public let identifier: String?

    public init(
        field: String,
        direction: SortDirection,
        options: [SortOption],
        directionAriaLabel: String? = nil,
        identifier: String? = nil
    ) {
        self.field = field
        self.direction = direction
        self.options = options
        self.directionAriaLabel = directionAriaLabel
        self.identifier = identifier
    }
}

// MARK: - SortControlProjection (view-ready)

/// The resolved, view-ready control — everything the SwiftUI body needs as a pure function of the props.
/// `options` is the ordered field list; `selectedOption` is the option whose `value` matches `field` (web
/// `<select value>`), or `nil` when the field is not present (the field-not-in-options edge);
/// `fieldTriggerLabel` is what the dropdown trigger shows (the selected label, falling back to the raw field
/// key so the trigger is never blank); the direction members carry the resolved glyph, label, and
/// accessibility text.
public struct SortControlProjection: Sendable, Equatable {
    /// The ordered, sortable field options (web `options`).
    public let options: [SortOption]
    /// The selected field key (web `field`).
    public let field: String
    /// The option matching `field`, or `nil` when the field is not among the options.
    public let selectedOption: SortOption?
    /// The label shown on the dropdown trigger — the selected option's label, falling back to the raw field
    /// key so the trigger never renders blank (the web `<select>` would show nothing for an unknown value).
    public let fieldTriggerLabel: String
    /// The dropdown's accessible name (web `t('sortControl.fieldLabel', 'Sort by')`).
    public let fieldMenuLabel: String
    /// The current direction (web `direction`).
    public let direction: SortDirection
    /// The direction glyph (web `direction === 'asc' ? <ArrowUp/> : <ArrowDown/>`).
    public let directionSystemImage: String
    /// The resolved direction word (web `dirLabel` — "Ascending" / "Descending"); also the button `title`.
    public let directionLabel: String
    /// The direction button's accessible name (web `directionAriaLabel ?? `${t('sortControl.direction',
    /// 'Sort direction')}: ${dirLabel}``).
    public let directionAccessibilityLabel: String
    /// The optional UI-test identifier (web `testId`).
    public let identifier: String?

    public init(
        options: [SortOption],
        field: String,
        selectedOption: SortOption?,
        fieldTriggerLabel: String,
        fieldMenuLabel: String,
        direction: SortDirection,
        directionSystemImage: String,
        directionLabel: String,
        directionAccessibilityLabel: String,
        identifier: String?
    ) {
        self.options = options
        self.field = field
        self.selectedOption = selectedOption
        self.fieldTriggerLabel = fieldTriggerLabel
        self.fieldMenuLabel = fieldMenuLabel
        self.direction = direction
        self.directionSystemImage = directionSystemImage
        self.directionLabel = directionLabel
        self.directionAccessibilityLabel = directionAccessibilityLabel
        self.identifier = identifier
    }

    /// No field options were supplied — the dropdown shows a friendly empty chip rather than a bare box (the
    /// web would render an empty `<select>`; the native HIG calls for a labelled empty state). The
    /// independent direction toggle still renders, matching the web (which renders the button
    /// unconditionally).
    public var hasNoOptions: Bool {
        options.isEmpty
    }

    /// The control's base accessibility identifier — the supplied `testId`, falling back to the surface slug
    /// so the control is always deterministically findable by UI tests (web `data-testid`).
    public var resolvedIdentifier: String {
        identifier ?? SortControlSurface.slug
    }

    /// The field dropdown's accessibility identifier — the native peer of the web `${testId}-field`.
    public var fieldIdentifier: String {
        "\(resolvedIdentifier)-field"
    }

    /// The direction button's accessibility identifier — the native peer of the web `${testId}-direction`.
    public var directionIdentifier: String {
        "\(resolvedIdentifier)-direction"
    }
}

// MARK: - SortControlProjector (web render body + flip)

/// The pure projection from props to the view-ready model — the surface's data adapter in the "cached →
/// projection" sense the acceptance calls for: it takes the props a page already holds (no fetch, no clock)
/// and derives the resolved field options, the selected option, the trigger label, and the fully resolved
/// direction toggle (glyph + label + accessibility text), plus the direction flip (web `flip`). Unit tested
/// across the option mapping, the selected / not-in-options lookup, the direction label + glyph, the
/// default / custom direction accessibility label, and the flip in both directions.
public enum SortControlProjector {
    /// Resolves the whole control from the props — the native peer of the web component's render decision.
    public static func resolve(_ input: SortControlInput, strings: SortControlResolve) -> SortControlProjection {
        let selected = input.options.first { $0.value == input.field }
        let directionLabel = strings(input.direction.labelKey, input.direction.labelFallback)
        let directionWord = strings("sortControl.direction", "Sort direction")
        let directionAccessibilityLabel = input.directionAriaLabel ?? "\(directionWord): \(directionLabel)"
        return SortControlProjection(
            options: input.options,
            field: input.field,
            selectedOption: selected,
            fieldTriggerLabel: selected?.label ?? input.field,
            fieldMenuLabel: strings("sortControl.fieldLabel", "Sort by"),
            direction: input.direction,
            directionSystemImage: input.direction.systemImage,
            directionLabel: directionLabel,
            directionAccessibilityLabel: directionAccessibilityLabel,
            identifier: input.identifier
        )
    }

    /// The flipped direction for a toggle press — the verbatim port of the web `flip = () =>
    /// onDirectionChange(direction === 'asc' ? 'desc' : 'asc')`.
    public static func toggled(_ direction: SortDirection) -> SortDirection {
        direction.toggled
    }
}
