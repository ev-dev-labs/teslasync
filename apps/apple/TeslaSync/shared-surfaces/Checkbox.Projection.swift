//
//  Checkbox.Projection.swift
//  TeslaSync — P4 shared surface · 0204 · Checkbox (Apple)
//
//  The pure projection from the input snapshot (+ the uncontrolled local flag + the P1/S10 resolver) to
//  the resolved, view-ready state — the native port of the web `Checkbox` render. The web has no async
//  branches (see Checkbox.Adapter "states" note); the genuine structural branches are the unchecked /
//  checked / indeterminate state, the disabled state, the optional trailing label, and the size
//  variant. Everything the view needs is computed here — the resolved checked flag, the glyph, the
//  accent-active flag, the label, the size, and the accessible name + value + identifier — so the view
//  is a pure function of this value and every branch is unit tested without a store or SwiftUI.
//

import Foundation

// MARK: - Resolved view-state (web rendered output)

/// The resolved, view-ready checkbox state. The view renders these fields directly: `isChecked` /
/// `isIndeterminate` drive the box styling + glyph (web `peer-checked` / `peer-indeterminate`);
/// `glyph` selects the check / minus / no icon; `isActive` tints the box with the accent (web checked /
/// indeterminate border + fill); `isDisabled` dims and blocks it (web `disabled`); `labelText` is the
/// trailing label shown only when present (web `{label != null && …}`); `size` selects the box
/// dimensions; the accessibility fields carry the spoken name + checked value and the element id.
public struct CheckboxResolved: Sendable, Equatable {
    /// The resolved checked state (web `checked`).
    public let isChecked: Bool
    /// The mixed state (web `indeterminate`).
    public let isIndeterminate: Bool
    /// The disabled state (web `disabled`).
    public let isDisabled: Bool
    /// The glyph drawn inside the box (web check / minus / transparent).
    public let glyph: CheckboxGlyph
    /// Whether the box is in its accent (checked or indeterminate) styling (web checked / indeterminate
    /// border + fill).
    public let isActive: Bool
    /// The box size variant (web `size`).
    public let size: CheckboxSize
    /// The trailing visible label — `nil` when the web `{label != null && …}` guard omits it.
    public let labelText: String?
    /// The accessible name (the label, or the localized unlabeled fallback).
    public let accessibilityLabel: String
    /// The spoken checked value — the native peer of `aria-checked` (checked / unchecked / mixed).
    public let accessibilityValue: String
    /// The resolved element id (web `id` / `useId()`).
    public let accessibilityIdentifier: String

    public init(
        isChecked: Bool,
        isIndeterminate: Bool,
        isDisabled: Bool,
        glyph: CheckboxGlyph,
        isActive: Bool,
        size: CheckboxSize,
        labelText: String?,
        accessibilityLabel: String,
        accessibilityValue: String,
        accessibilityIdentifier: String
    ) {
        self.isChecked = isChecked
        self.isIndeterminate = isIndeterminate
        self.isDisabled = isDisabled
        self.glyph = glyph
        self.isActive = isActive
        self.size = size
        self.labelText = labelText
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityValue = accessibilityValue
        self.accessibilityIdentifier = accessibilityIdentifier
    }

    /// Whether the trailing visible label row is shown (web truthiness of `label`).
    public var hasLabel: Bool {
        labelText != nil
    }
}

// MARK: - Projection (web component body)

/// Pure projection + state derivation for the checkbox — the native port of the web render decision.
/// It resolves the checked value from the controlled / uncontrolled source (the web `checked` prop vs
/// the box's own value), derives the glyph + accent-active flag (web `indeterminate ? <Minus/> :
/// <Check/>` painted only when checked / indeterminate), routes the accessible name + value through the
/// P1/S10 resolver, and passes the disabled / label / size / id through. Unit tested across every
/// branch.
public enum CheckboxProjection {
    /// Resolve the checked value — the native peer of the web controlled / uncontrolled value source.
    /// When controlled the parent-owned value wins; otherwise the local (uncontrolled) flag is
    /// authoritative.
    public static func resolvedChecked(input: CheckboxInput, internalChecked: Bool) -> Bool {
        input.isControlled ? input.controlledChecked : internalChecked
    }

    /// The glyph for a state — minus when indeterminate (web `<Minus>`, mixed wins over checked),
    /// checkmark when checked (web `<Check>`), otherwise none (web transparent icon → empty box).
    public static func glyph(isChecked: Bool, isIndeterminate: Bool) -> CheckboxGlyph {
        if isIndeterminate { return .minus }
        return isChecked ? .check : .none
    }

    /// Whether the box wears its accent styling — checked OR indeterminate (web
    /// `peer-checked`/`peer-indeterminate` border + fill).
    public static func isActive(isChecked: Bool, isIndeterminate: Bool) -> Bool {
        isChecked || isIndeterminate
    }

    /// The next checked value for a user toggle — the web `onChange(!checked)`.
    public static func nextChecked(current: Bool) -> Bool {
        !current
    }

    /// Resolve the whole view-state from the input snapshot + the uncontrolled local flag.
    public static func resolve(
        input: CheckboxInput,
        internalChecked: Bool,
        strings: CheckboxResolve = CheckboxStrings.string
    ) -> CheckboxResolved {
        let checked = resolvedChecked(input: input, internalChecked: internalChecked)
        let a11yState = CheckboxAccessibility.state(isChecked: checked, isIndeterminate: input.isIndeterminate)
        return CheckboxResolved(
            isChecked: checked,
            isIndeterminate: input.isIndeterminate,
            isDisabled: input.isDisabled,
            glyph: glyph(isChecked: checked, isIndeterminate: input.isIndeterminate),
            isActive: isActive(isChecked: checked, isIndeterminate: input.isIndeterminate),
            size: input.size,
            labelText: CheckboxAccessibility.visibleLabel(input.label),
            accessibilityLabel: CheckboxAccessibility.name(input.label, strings: strings),
            accessibilityValue: CheckboxAccessibility.stateValue(a11yState, strings: strings),
            accessibilityIdentifier: input.identifier
        )
    }
}
