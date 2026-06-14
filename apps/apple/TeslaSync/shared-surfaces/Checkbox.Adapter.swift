//
//  Checkbox.Adapter.swift
//  TeslaSync — P4 shared surface · 0204 · Checkbox (Apple)
//
//  The testable, dependency-light core for the checkbox primitive — the SwiftUI parity of
//  `components/ui/Checkbox.tsx`. Everything here is pure (Foundation only): the input snapshot, the
//  size variants + their pixel metrics, the `useId`-equivalent identifier resolution, the visible-label
//  guard, and the VoiceOver name / value builders. No store, no rendered view, so each piece is unit
//  tested in isolation.
//
//  Parity note — states. The web source is a thin, presentational wrapper over a visually-hidden
//  `<input type="checkbox">`: it receives `checked` / `defaultChecked` / `indeterminate` / `disabled` /
//  `size` / `label` / `onChange` from its parent and renders a styled indicator. It performs NO data
//  fetch — there is no React-Query cache, no Promise — so it has no loading / empty / error / stale /
//  offline axis (there is nothing to fetch, fail, age, or lose connectivity to). Synthesising network
//  chrome here would invent state the source does not have — the same disposition as the sibling
//  synchronous-primitive surfaces Toggle (0230), Slider (0226), Accordion (0203), and AnimatedNumber
//  (0075). The genuine render branches this core models are exactly the web's: the unchecked / checked /
//  indeterminate (mixed) state, the controlled (`checked`) vs uncontrolled (`defaultChecked`) value
//  source, the disabled state, the optional trailing label (web `{label != null && …}`), and the three
//  size variants (web `size: 'sm' | 'md' | 'lg'`).
//
//  Parity note — i18n. The web `Checkbox` renders NO translatable copy of its own: the visible `label`
//  is a caller-supplied (already-localized) node. The only native-owned strings are accessibility
//  refinements over the web — the fallback name for an unlabeled box (the web leaves it unnamed) and the
//  spoken checked / unchecked / mixed value (the native peer of `aria-checked`). They resolve through
//  the injected P1/S10 facade. See Checkbox.strings.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `t(key, fallback)`
/// call. A plain closure so the pure core needs no bundle: the app passes the P1/S10 facade, tests
/// pass an identity / echo resolver.
public typealias CheckboxResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Size variants (web `size: 'sm' | 'md' | 'lg'`)

/// The pixel metrics of a checkbox size — the native peer of the web Tailwind box / icon dimensions
/// (`sm: box 3.5/icon 2.5`, `md: box 4/icon 3`, `lg: box 5/icon 3.5`, all in `0.25rem` units). Kept as
/// `Double` so the pure core has no CoreGraphics dependency; the views cast to `CGFloat`.
public struct CheckboxMetrics: Sendable, Equatable {
    /// The side length of the square indicator box, in points (web `h-/w-` box class).
    public let boxSide: Double
    /// The point size of the check / minus glyph drawn inside the box (web `h-/w-` icon class).
    public let iconPointSize: Double

    public init(boxSide: Double, iconPointSize: Double) {
        self.boxSide = boxSide
        self.iconPointSize = iconPointSize
    }
}

/// The three box sizes the web source supports. The web draws explicit Tailwind dimensions; the native
/// parity maps each to a ``CheckboxMetrics`` so the custom indicator scales faithfully. Raw values
/// mirror the web prop literals so a string prop round-trips through `from(_:)`.
public enum CheckboxSize: String, Sendable, Equatable, CaseIterable {
    /// Web `'sm'` — the compact box (`h-3.5 w-3.5`, icon `h-2.5 w-2.5`).
    case small = "sm"
    /// Web `'md'` — the default box (`h-4 w-4`, icon `h-3 w-3`).
    case medium = "md"
    /// Web `'lg'` — the large box (`h-5 w-5`, icon `h-3.5 w-3.5`).
    case large = "lg"

    /// Map a web `size` literal to the variant — the parity of `size = 'md'`'s default. An absent or
    /// unrecognised value falls back to the default size.
    public static func from(_ web: String?) -> CheckboxSize {
        guard let web, let size = CheckboxSize(rawValue: web) else { return CheckboxMeta.defaultSize }
        return size
    }

    /// The point metrics for the variant — the native peer of the web per-size box / icon dimensions
    /// (`0.25rem` Tailwind units rendered at 1rem = 16pt: `3.5 → 14`, `4 → 16`, `5 → 20`; icon
    /// `2.5 → 10`, `3 → 12`, `3.5 → 14`).
    public var metrics: CheckboxMetrics {
        switch self {
        case .small: CheckboxMetrics(boxSide: 14, iconPointSize: 10)
        case .medium: CheckboxMetrics(boxSide: 16, iconPointSize: 12)
        case .large: CheckboxMetrics(boxSide: 20, iconPointSize: 14)
        }
    }
}

// MARK: - Glyph (web `indeterminate ? <Minus/> : <Check/>`, shown only when active)

/// The glyph drawn inside the indicator box — the native peer of the web icon choice. The web always
/// mounts an icon but paints it transparent until checked / indeterminate; the native peer simply
/// omits the glyph when neither is set, so the box reads as empty.
public enum CheckboxGlyph: String, Sendable, Equatable {
    /// Neither checked nor indeterminate — an empty box (web transparent icon).
    case none
    /// Checked — a checkmark (web `<Check>`).
    case check
    /// Indeterminate / mixed — a minus (web `<Minus>`), regardless of the checked value.
    case minus
}

// MARK: - Surface metadata (diagnostics slug + lib defaults)

/// Static, non-identifying surface constants — the P1/S11 diagnostics slug emitted with `view.opened`,
/// the web `size` default (`md`), the indicator corner radius (web `rounded`), and the
/// `useId`-equivalent identifier prefix.
public enum CheckboxMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the web source name.
    public static let surfaceSlug = "Checkbox"

    /// Web `size = 'md'` default.
    public static let defaultSize: CheckboxSize = .medium

    /// The indicator corner radius, in points — the native peer of the web `rounded` (4px) box,
    /// size-independent exactly as the web class is.
    public static let cornerRadius: Double = 4

    /// The auto-generated identifier prefix — the native parity of the web `useId()` label id.
    public static let identifierPrefix = "checkbox"

    /// Resolve the element identifier — the native parity of the web `useId()` label association id.
    /// An explicit, non-blank id wins; otherwise a stable unique id is generated.
    public static func makeIdentifier(_ explicit: String?) -> String {
        if let explicit, !explicit.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return explicit
        }
        return "\(identifierPrefix)-\(UUID().uuidString.lowercased())"
    }
}

// MARK: - Input snapshot (web `CheckboxProps` minus the closure)

/// One coalesced snapshot of the checkbox's value-type inputs — the web `checked` / `defaultChecked` /
/// `indeterminate` / `disabled` / `label` / `size` props plus the resolved element id. The `onChange`
/// closure is NOT part of the snapshot (closures are not `Equatable`); it is held by the model and
/// applied to this snapshot, so the view can re-sync the model whenever any value-type prop changes via
/// `onChange(of:)`.
///
/// `isControlled` is the native peer of the web distinction between a supplied `checked` (controlled —
/// the parent owns the value) and a supplied `defaultChecked` (uncontrolled — the box owns it). When
/// controlled, ``controlledChecked`` is authoritative; when uncontrolled, ``defaultChecked`` only seeds
/// the model's local flag at init (the web `<input defaultChecked>` is initial-only).
public struct CheckboxInput: Sendable, Equatable {
    /// Whether the parent drives the checked value (web `checked` supplied) vs the box owning it (web
    /// `defaultChecked`).
    public var isControlled: Bool
    /// The parent-owned checked value, meaningful only when ``isControlled`` (web `checked`).
    public var controlledChecked: Bool
    /// The initial checked value when uncontrolled (web `defaultChecked`). Initial-only — like the DOM
    /// `defaultChecked` it never resets the value after first render.
    public var defaultChecked: Bool
    /// The mixed state (web `indeterminate`). A pure visual / accessibility flag fed by the parent; a
    /// user toggle does not clear it locally (the parent re-renders with a new value, as in "select
    /// all" headers).
    public var isIndeterminate: Bool
    /// Whether the box is disabled (web `disabled`) — dimmed and non-interactive.
    public var isDisabled: Bool
    /// The optional trailing label (web `label`). `nil` or empty renders no label — matching the web
    /// `{label != null && …}` guard.
    public var label: String?
    /// The box size variant (web `size`, default `md`).
    public var size: CheckboxSize
    /// Resolved element id (web `id` / `useId()` label association).
    public var identifier: String

    public init(
        isControlled: Bool = false,
        controlledChecked: Bool = false,
        defaultChecked: Bool = false,
        isIndeterminate: Bool = false,
        isDisabled: Bool = false,
        label: String? = nil,
        size: CheckboxSize = CheckboxMeta.defaultSize,
        identifier: String = CheckboxMeta.identifierPrefix
    ) {
        self.isControlled = isControlled
        self.controlledChecked = controlledChecked
        self.defaultChecked = defaultChecked
        self.isIndeterminate = isIndeterminate
        self.isDisabled = isDisabled
        self.label = label
        self.size = size
        self.identifier = identifier
    }
}

// MARK: - Accessibility (testable seam)

/// The spoken checked state of the box — the native peer of the web `aria-checked` tri-state (`true` /
/// `false` / `"mixed"`).
public enum CheckboxA11yState: String, Sendable, Equatable {
    case checked
    case unchecked
    case mixed
}

/// Builds the box's visible label + VoiceOver name / value without rendering the view. The visible
/// label mirrors the web `{label != null && …}` guard (a `nil` or empty string is no label); the
/// accessible name is that label, or — for the unlabeled box — the localized fallback (the native
/// refinement over the web, whose indicator has no accessible name when no label is given).
public enum CheckboxAccessibility {
    /// The visible label — the web `{label != null && <span>…</span>}` branch. Returns `nil` for a
    /// `nil` or empty string, so the trailing label row is omitted.
    public static func visibleLabel(_ label: String?) -> String? {
        guard let label, !label.isEmpty else { return nil }
        return label
    }

    /// The accessible name — the visible label when present, otherwise the localized fallback so the
    /// box is always named for VoiceOver (the web leaves an unlabeled checkbox unnamed).
    public static func name(_ label: String?, strings: CheckboxResolve) -> String {
        visibleLabel(label) ?? strings("checkbox.accessibility.unlabeled", "Checkbox")
    }

    /// The spoken checked state — the native peer of `aria-checked`. Indeterminate wins (web mixed),
    /// otherwise the checked flag selects checked / unchecked.
    public static func state(isChecked: Bool, isIndeterminate: Bool) -> CheckboxA11yState {
        if isIndeterminate { return .mixed }
        return isChecked ? .checked : .unchecked
    }

    /// The localized spoken value for a state — routed through the injected facade so no English is
    /// hardcoded (web `aria-checked` is read by the platform; the native peer voices it explicitly).
    public static func stateValue(_ state: CheckboxA11yState, strings: CheckboxResolve) -> String {
        switch state {
        case .checked: strings("checkbox.accessibility.checked", "Checked")
        case .unchecked: strings("checkbox.accessibility.unchecked", "Not checked")
        case .mixed: strings("checkbox.accessibility.mixed", "Mixed")
        }
    }
}
