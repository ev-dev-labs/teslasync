//
//  DensityToggle.Adapter.swift
//  TeslaSync — P4 shared surface · 0153 · DensityToggle (Apple)
//
//  The Foundation-only core for the list-density selector — the SwiftUI parity of
//  `components/forms/DensityToggle.tsx`. This file owns the surface identity (the diagnostics slug), the
//  ``Density`` value (web `Density`, with its lucide → SF Symbol mapping + i18n key/fallback), the props
//  value type (``DensityToggleInput``), one resolved option (``DensitySegment``), the view-ready
//  ``DensityToggleProjection``, and the pure ``DensityToggleProjector`` that maps props → projection and
//  reproduces the web arrow-key navigation. No SwiftUI and no `@Observable`, so every rule is
//  unit-testable in isolation.
//
//  Faithful-parity note: the web `<DensityToggle>` is a PURE, CONTROLLED presentational component. It takes
//  its value as a plain prop and reports changes back through `onChange` — there is no fetch, no
//  React-Query cache, and no Promise — so it has NO loading, error, stale, or offline branch (there is
//  nothing to fetch, fail, age, or lose connectivity to; its only "hook" is `useTranslation`). Inventing
//  such chrome would fabricate states the source does not have, so this surface reproduces only the
//  source's REAL branches — exactly as the sibling presentational primitives ActiveFilterChips (0147),
//  InlineCallout (0124), Delta (0081), and MetricCard (0095) did. The real branches are: the populated
//  radiogroup (default or a constrained option list), the per-option selected / unselected state, the
//  value-not-in-options edge (arrow keys are a no-op), the custom-vs-default group label, and the
//  degenerate empty-options case (rendered as a friendly empty state rather than a blank box, per the HIG).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum DensityToggleSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "DensityToggle"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// closure so the pure core has no dependency on a bundle: the production app passes the P1/S10 facade,
/// while tests pass an identity-fallback resolver.
public typealias DensityToggleResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Density (web `Density`)

/// One list-density mode — the native peer of the web `Density` union (`'comfortable' | 'compact' |
/// 'table'`). Carries the web's lucide-icon mapping (as an SF Symbol), the i18n key, and the English
/// fallback, so the projector can resolve a fully view-ready option without the view knowing the mapping.
public enum Density: String, Sendable, Equatable, CaseIterable, Identifiable {
    /// The dense, spreadsheet-like layout (web `'table'`, icon `Table2`).
    case table
    /// The reduced-padding layout (web `'compact'`, icon `Rows3`).
    case compact
    /// The roomy, default layout (web `'comfortable'`, icon `Rows`).
    case comfortable

    /// Stable identity for `ForEach` / `Identifiable` (the raw value matches the web string literal).
    public var id: String {
        rawValue
    }

    /// The default option order — the verbatim port of the web `DEFAULT_OPTIONS = ['table', 'compact',
    /// 'comfortable']`.
    public static let defaultOptions: [Density] = [.table, .compact, .comfortable]

    /// The group-label i18n key (web `t('density.groupLabel', 'List density')`).
    public static let groupLabelKey = "density.groupLabel"
    /// The group-label English fallback (web default `'List density'`).
    public static let groupLabelFallback = "List density"

    /// The per-option i18n key (web `t('density.table' | 'density.compact' | 'density.comfortable')`).
    var labelKey: String {
        "density.\(rawValue)"
    }

    /// The per-option English fallback — byte-identical to the web defaults.
    var labelFallback: String {
        switch self {
        case .table: "Table"
        case .compact: "Compact"
        case .comfortable: "Comfortable"
        }
    }

    /// The SF Symbol mapped from the web lucide icon — `Table2` → a cell grid, `Rows3` → a vertically
    /// compressed rectangle (dense rows), `Rows` → a vertically expanded rectangle (roomy rows), so the
    /// glyph reads the same density semantics on both platforms.
    var systemImage: String {
        switch self {
        case .table: "tablecells"
        case .compact: "rectangle.compress.vertical"
        case .comfortable: "rectangle.expand.vertical"
        }
    }
}

// MARK: - DensityToggleInput (web props, closure-free)

/// The component's props — the native peer of `DensityToggleProps`, minus the `onChange` closure (held by
/// the state-holder so this value stays `Equatable`/`Sendable`). A value type so the view, the
/// state-holder, and the pure projection agree on one shape, and so a SwiftUI `.onChange` can detect a prop
/// change cheaply when the page rebinds a fresh value.
public struct DensityToggleInput: Sendable, Equatable {
    /// The currently selected density (web `value`).
    public let value: Density
    /// The rendered options, in order (web `options`, default `['table', 'compact', 'comfortable']`).
    public let options: [Density]
    /// An optional accessible name for the group, overriding the default (web `ariaLabel`).
    public let ariaLabel: String?
    /// An optional accessibility identifier for UI tests (web `testId`, applied to the group + segments).
    public let identifier: String?

    public init(
        value: Density,
        options: [Density] = Density.defaultOptions,
        ariaLabel: String? = nil,
        identifier: String? = nil
    ) {
        self.value = value
        self.options = options
        self.ariaLabel = ariaLabel
        self.identifier = identifier
    }
}

// MARK: - DensitySegment (one resolved option)

/// One fully resolved option — the i18n'd label, the SF Symbol, and whether it is the selected one. A pure
/// function of the props (no view derivation), so the SwiftUI body just renders it.
public struct DensitySegment: Sendable, Equatable, Identifiable {
    /// The density this segment selects (web `opt`).
    public let density: Density
    /// The resolved, i18n'd label (web `labelMap[opt]`).
    public let label: String
    /// The SF Symbol glyph (web `ICONS[opt]`).
    public let systemImage: String
    /// Whether this is the selected option (web `opt === value` → `aria-checked`).
    public let isSelected: Bool

    public init(density: Density, label: String, systemImage: String, isSelected: Bool) {
        self.density = density
        self.label = label
        self.systemImage = systemImage
        self.isSelected = isSelected
    }

    /// Stable identity (the density raw value).
    public var id: String {
        density.rawValue
    }
}

// MARK: - DensityToggleProjection (view-ready)

/// The resolved, view-ready selector — everything the SwiftUI body needs as a pure function of the props.
/// `segments` is the ordered, resolved option list; `groupLabel` is the resolved radiogroup name;
/// `selectedIndex` is the position of the selected value in the options (web `options.indexOf(value)`), or
/// `nil` when the value is not present (the web arrow-key no-op edge).
public struct DensityToggleProjection: Sendable, Equatable {
    /// The ordered, resolved options (web `options.map(...)`).
    public let segments: [DensitySegment]
    /// The resolved radiogroup accessible name (web `ariaLabel ?? t('density.groupLabel', 'List density')`).
    public let groupLabel: String
    /// The selected option's index in `segments`, or `nil` when the value is not in the options.
    public let selectedIndex: Int?
    /// The optional UI-test identifier (web `testId`).
    public let identifier: String?

    public init(segments: [DensitySegment], groupLabel: String, selectedIndex: Int?, identifier: String?) {
        self.segments = segments
        self.groupLabel = groupLabel
        self.selectedIndex = selectedIndex
        self.identifier = identifier
    }

    /// No options were supplied — the surface shows a friendly empty state rather than a blank box (the web
    /// would render an empty radiogroup; the native HIG calls for a labelled empty state).
    public var isEmpty: Bool {
        segments.isEmpty
    }

    /// The radiogroup's accessibility identifier — the supplied `testId`, falling back to the surface slug
    /// so the group is always deterministically findable by UI tests (web `data-testid`).
    public var resolvedIdentifier: String {
        identifier ?? DensityToggleSurface.slug
    }

    /// One segment's accessibility identifier — the native peer of the web `${testId}-${opt}`, built from
    /// ``resolvedIdentifier`` so it is always present and stable (e.g. `DensityToggle-table`).
    public func segmentIdentifier(for density: Density) -> String {
        "\(resolvedIdentifier)-\(density.rawValue)"
    }
}

// MARK: - DensityToggleProjector (web render body + onKeyDown)

/// The pure projection from props to the view-ready model — the surface's data adapter in the "cached →
/// projection" sense the acceptance calls for: it takes the props a page already holds (no fetch, no clock)
/// and derives the resolved options, the group label, and the selected index, plus the arrow-key
/// navigation (web `onKeyDown`). Unit tested across the option mapping, the default / custom group label,
/// the selected-index lookup, and every wraparound + no-op branch of the navigation.
public enum DensityToggleProjector {
    /// The arrow-key navigation direction — the native peer of the web `ArrowRight` / `ArrowLeft` keys.
    public enum Direction: Sendable, Equatable {
        /// Web `ArrowRight` — advance to the next option.
        case forward
        /// Web `ArrowLeft` — retreat to the previous option.
        case backward
    }

    /// Resolves the whole selector from the props — the native peer of the web component's render decision.
    public static func resolve(_ input: DensityToggleInput, strings: DensityToggleResolve) -> DensityToggleProjection {
        let segments = input.options.map { density in
            DensitySegment(
                density: density,
                label: strings(density.labelKey, density.labelFallback),
                systemImage: density.systemImage,
                isSelected: density == input.value
            )
        }
        let groupLabel = input.ariaLabel ?? strings(Density.groupLabelKey, Density.groupLabelFallback)
        return DensityToggleProjection(
            segments: segments,
            groupLabel: groupLabel,
            selectedIndex: input.options.firstIndex(of: input.value),
            identifier: input.identifier
        )
    }

    /// The next option for an arrow press — the verbatim port of the web `onKeyDown`: it finds the current
    /// value's index (`options.indexOf(value)`), returns `nil` when the value is not present (web `if (idx <
    /// 0) return;`, a no-op), and otherwise wraps modulo the option count (`(idx ± 1 + len) % len`).
    public static func next(after value: Density, in options: [Density], moving direction: Direction) -> Density? {
        guard let index = options.firstIndex(of: value) else { return nil }
        let count = options.count
        guard count > 0 else { return nil }
        let nextIndex: Int = switch direction {
        case .forward: (index + 1) % count
        case .backward: (index - 1 + count) % count
        }
        return options[nextIndex]
    }
}
