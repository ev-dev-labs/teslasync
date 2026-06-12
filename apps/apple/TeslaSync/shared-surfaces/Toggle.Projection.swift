//
//  Toggle.Projection.swift
//  TeslaSync — P4 shared surface · 0230 · Toggle (Apple)
//
//  The pure projection from the input snapshot (+ the P1/S10 resolver) to the resolved, view-ready
//  state — the native port of the web `Toggle` render. The web has no async branches (see
//  Toggle.Adapter "states" note); the genuine structural branches are the on / off state, the optional
//  trailing label, and the size variant. Everything the view needs is computed here — the on / off
//  flag, the visible label (or its absence), the size, and the accessible name + identifier — so the
//  view is a pure function of this value and every branch is unit tested without a store or SwiftUI.
//

import Foundation

// MARK: - Resolved view-state (web rendered output)

/// The resolved, view-ready toggle state. The view renders these fields directly: `isOn` binds the
/// native switch (web `aria-checked` / the track tint + thumb offset); `labelText` is the trailing
/// label shown only when present (web `{label && …}`); `size` selects the control size; the
/// accessibility fields carry the web `aria-labelledby` name and the element id.
public struct ToggleResolved: Sendable, Equatable {
    /// The on / off state (web `checked`).
    public let isOn: Bool
    /// The trailing visible label — `nil` when the web `{label && …}` guard omits it.
    public let labelText: String?
    /// The track size variant (web `size`).
    public let size: ToggleSize
    /// The accessible name (web `aria-labelledby` target, or the localized unlabeled fallback).
    public let accessibilityLabel: String
    /// The resolved element id (web `id` / `useId()`).
    public let accessibilityIdentifier: String

    public init(
        isOn: Bool,
        labelText: String?,
        size: ToggleSize,
        accessibilityLabel: String,
        accessibilityIdentifier: String
    ) {
        self.isOn = isOn
        self.labelText = labelText
        self.size = size
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityIdentifier = accessibilityIdentifier
    }

    /// Whether the trailing visible label row is shown (web truthiness of `label`).
    public var hasLabel: Bool {
        labelText != nil
    }
}

// MARK: - Projection (web component body)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `Toggle` render. The visible label + accessible name are built through `ToggleAccessibility` (which
/// routes the unlabeled fallback through the P1/S10 resolver); the on / off flag, size, and identifier
/// pass through. Unit tested across the on / off state, the labelled / unlabelled branches, and the
/// size variants.
public enum ToggleProjection {
    public static func resolve(
        _ input: ToggleInput,
        strings: ToggleResolve = ToggleStrings.string
    ) -> ToggleResolved {
        ToggleResolved(
            isOn: input.isOn,
            labelText: ToggleAccessibility.visibleLabel(input.label),
            size: input.size,
            accessibilityLabel: ToggleAccessibility.name(input.label, strings: strings),
            accessibilityIdentifier: input.identifier
        )
    }
}
