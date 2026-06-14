//
//  Input.Projection.swift
//  TeslaSync — P4 shared surface · 0217 · Input (Apple)
//
//  The pure projection from the input snapshot (+ the P1/S10 resolver) to the resolved, view-ready
//  state — the native port of the web `Input` render. The web has no async branches (see
//  Input.Adapter "states" note); the genuine structural branches are the optional label (+ required
//  marker), the optional help affordance, the leading icon + trailing suffix regions, the error
//  branch (which suppresses the hint), the hint branch, the disabled / secure state, and the size
//  variant. Everything the view needs is computed here — the normalized copy, the presence flags, the
//  child element ids (web `${id}-error` / `${id}-hint`), the mutually-exclusive describedby target
//  (web `aria-describedby`), and the accessible name + hint — so the view is a pure function of this
//  value and every branch is unit tested without a store or SwiftUI.
//

import Foundation

// MARK: - Resolved view-state (web rendered output)

/// The resolved, view-ready field state. The view renders these fields directly: `labelText` /
/// `isRequired` drive the label row (web `{label && <Label required>}`); `helpText` mounts the help
/// trigger (web `{help && <HelpIcon>}`); `hasLeadingIcon` / `hasTrailingSuffix` inset the field (web
/// `pl-10` / `pr-10`); `errorText` paints the error border + message and marks the field invalid (web
/// `border-red-500` / `aria-invalid`); `hintText` is the surviving supporting line (web `{hint &&
/// !error}`); `isDisabled` / `isSecure` / `size` configure the control; the accessibility fields
/// carry the spoken name + hint and the element ids.
public struct InputFieldResolved: Sendable, Equatable {
    /// The resolved element id (web `inputId`).
    public let identifier: String
    /// The visible label — `nil` when the web `{label && …}` guard omits it.
    public let labelText: String?
    /// Whether the field is required — drives the visible `*` + spoken "required" (web `required`).
    public let isRequired: Bool
    /// The help text shown by the help affordance — `nil` when the web HelpIcon would render nothing.
    public let helpText: String?
    /// The help trigger's accessible name (web HelpIcon `aria-label` "Help for {field}").
    public let helpAccessibilityLabel: String
    /// The placeholder prompt — `nil` when none was supplied.
    public let placeholder: String?
    /// The error message — `nil` when the field is valid (web falsy `error`).
    public let errorText: String?
    /// The surviving hint — `nil` when absent OR suppressed by an error (web `{hint && !error}`).
    public let hintText: String?
    /// Whether a leading icon region is rendered (web `icon != null`).
    public let hasLeadingIcon: Bool
    /// Whether a trailing suffix region is rendered (web `suffix != null`).
    public let hasTrailingSuffix: Bool
    /// Whether the field is disabled (web `disabled`).
    public let isDisabled: Bool
    /// Whether the field masks its content (web `type="password"`).
    public let isSecure: Bool
    /// The size variant (web `size`).
    public let size: InputFieldSize
    /// The field's accessible name (label / placeholder / fallback, plus "required").
    public let accessibilityLabel: String
    /// The field's accessible hint — the error or surviving hint (web `aria-describedby`), or `nil`.
    public let accessibilityHint: String?

    public init(
        identifier: String,
        labelText: String?,
        isRequired: Bool,
        helpText: String?,
        helpAccessibilityLabel: String,
        placeholder: String?,
        errorText: String?,
        hintText: String?,
        hasLeadingIcon: Bool,
        hasTrailingSuffix: Bool,
        isDisabled: Bool,
        isSecure: Bool,
        size: InputFieldSize,
        accessibilityLabel: String,
        accessibilityHint: String?
    ) {
        self.identifier = identifier
        self.labelText = labelText
        self.isRequired = isRequired
        self.helpText = helpText
        self.helpAccessibilityLabel = helpAccessibilityLabel
        self.placeholder = placeholder
        self.errorText = errorText
        self.hintText = hintText
        self.hasLeadingIcon = hasLeadingIcon
        self.hasTrailingSuffix = hasTrailingSuffix
        self.isDisabled = isDisabled
        self.isSecure = isSecure
        self.size = size
        self.accessibilityLabel = accessibilityLabel
        self.accessibilityHint = accessibilityHint
    }

    /// Whether the label row is shown (web truthiness of `label`).
    public var showsLabel: Bool {
        labelText != nil
    }

    /// Whether the help trigger is shown (web truthiness of the HelpIcon text).
    public var showsHelp: Bool {
        helpText != nil
    }

    /// Whether the error message row is shown (web `{error && …}`).
    public var showsError: Bool {
        errorText != nil
    }

    /// Whether the hint row is shown (web `{hint && !error}`).
    public var showsHint: Bool {
        hintText != nil
    }

    /// Whether the field is in its invalid styling (web `aria-invalid` / `border-red-500`).
    public var isInvalid: Bool {
        errorText != nil
    }

    /// Whether the field border wears the error color (web `error && 'border-red-500'`).
    public var borderIsError: Bool {
        isInvalid
    }

    /// The point metrics for the size variant.
    public var metrics: InputFieldMetrics {
        size.metrics
    }

    /// The error message element id (web `${inputId}-error`).
    public var errorElementID: String {
        InputFieldMeta.elementID(identifier, "error")
    }

    /// The hint element id (web `${inputId}-hint`).
    public var hintElementID: String {
        InputFieldMeta.elementID(identifier, "hint")
    }

    /// The help body element id (web `${for}-help`).
    public var helpElementID: String {
        InputFieldMeta.elementID(identifier, "help")
    }

    /// The single describedby target — the verbatim port of the web `aria-describedby={error ?
    /// `${id}-error` : hint ? `${id}-hint` : undefined}`: the error id wins, then the hint id, else
    /// none.
    public var accessibilityDescribedByID: String? {
        if showsError { return errorElementID }
        if showsHint { return hintElementID }
        return nil
    }
}

// MARK: - Projection (web component body)

/// Pure projection + state derivation for the field — the native port of the web `Input` render
/// decision. It normalizes the caller copy (empty strings are falsy, exactly as the web `{x && …}`
/// guards treat them), suppresses the hint when an error is present (web `{hint && !error}`), routes
/// the accessible name + hint + help label through the P1/S10 resolver, and passes the presence flags
/// / disabled / secure / size / id through. Unit tested across every branch.
public enum InputFieldProjection {
    /// Normalize an optional caller string to web truthiness — `nil` for a `nil` or empty value, so a
    /// blank `label` / `error` / `hint` / `help` / `placeholder` is treated as absent.
    public static func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    /// Resolve the full view-state from the input snapshot.
    public static func resolve(
        input: InputFieldInput,
        strings: InputFieldResolve = InputFieldStrings.string
    ) -> InputFieldResolved {
        let label = nonEmpty(input.label)
        let help = nonEmpty(input.helpText)
        let error = nonEmpty(input.error)
        let hint = error == nil ? nonEmpty(input.hint) : nil
        let placeholder = nonEmpty(input.placeholder)
        return InputFieldResolved(
            identifier: input.identifier,
            labelText: label,
            isRequired: input.isRequired,
            helpText: help,
            helpAccessibilityLabel: InputFieldAccessibility.helpLabel(
                field: input.helpFieldName,
                strings: strings
            ),
            placeholder: placeholder,
            errorText: error,
            hintText: hint,
            hasLeadingIcon: input.hasIcon,
            hasTrailingSuffix: input.hasSuffix,
            isDisabled: input.isDisabled,
            isSecure: input.isSecure,
            size: input.size,
            accessibilityLabel: InputFieldAccessibility.name(
                label: label,
                placeholder: placeholder,
                isRequired: input.isRequired,
                strings: strings
            ),
            accessibilityHint: InputFieldAccessibility.hint(error: error, hint: hint, strings: strings)
        )
    }
}
