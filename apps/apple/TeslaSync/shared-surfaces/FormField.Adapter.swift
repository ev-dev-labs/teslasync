//
//  FormField.Adapter.swift
//  TeslaSync — P4 shared surface · 0154 · FormField (Apple)
//
//  The testable projection core for the form-field wrapper — the SwiftUI parity of
//  components/forms/FormField.tsx. Everything here is pure + dependency-free (no
//  store, no bundle, no rendered view) so the error-hides-hint rule, the required
//  decoration, the field-id (web `useId`) wiring, and the VoiceOver summary are all
//  unit tested in isolation.
//
//  The web source is a presentational wrapper fed by its caller (and, in practice,
//  a react-hook-form `Controller`): `label` / `hint` / `error` / `required` arrive
//  as already-localized props, and the only lifecycle the leaf owns is the inline
//  validation state (error vs. hint vs. neither). It issues no requests, so the
//  data loading / empty / stale / offline chrome is owned by the host form, not
//  duplicated here — the same boundary the web leaf draws.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics identity for the surface. The slug is the web component
/// name so the `view.opened` product-analytics event lines up across platforms.
public enum FormFieldSurface {
    /// The `view.opened` diagnostics slug (P1/S11 contract).
    public static let slug = "FormField"
}

// MARK: - Inline message (web `error ? <alert> : hint ? <hint> : null`)

/// The single inline message a field renders beneath its control, reduced to the
/// three mutually-exclusive cases the web source has. `error` takes precedence over
/// `hint` (web `error ? … : hint ? … : null`) and is exposed to assistive tech as an
/// alert; `hint` is advisory help text; `none` renders no message row at all.
public enum FormFieldMessage: Equatable, Sendable {
    case none
    case hint(String)
    case error(String)

    /// Whether this message is the validation-error case (web `role="alert"`).
    public var isError: Bool {
        if case .error = self { return true }
        return false
    }

    /// The visible text, or `nil` for the `none` case.
    public var text: String? {
        switch self {
        case .none: nil
        case let .hint(value), let .error(value): value
        }
    }
}

// MARK: - Input snapshot (web props)

/// One coalesced snapshot of the wrapper's inputs — the native mirror of the web
/// props (`label`, `required`, `hint`, `error`, `htmlFor`). The strings arrive
/// already-localized by the caller, exactly as the web `label={t(…)}` /
/// `error={fieldState.error?.message}` props do; there are no units at this layer.
public struct FormFieldInput: Sendable, Equatable {
    /// The required, always-visible label (web `label`).
    public var label: String
    /// Marks the field required — drives the visual asterisk + the a11y suffix.
    public var required: Bool
    /// Advisory help text shown only when there is no error (web `hint`).
    public var hint: String?
    /// Validation error; when present it hides the hint (web `error`).
    public var error: String?
    /// Caller-supplied control id (web `htmlFor`); `nil` defers to a generated id.
    public var fieldID: String?

    public init(
        label: String,
        required: Bool = false,
        hint: String? = nil,
        error: String? = nil,
        fieldID: String? = nil
    ) {
        self.label = label
        self.required = required
        self.hint = hint
        self.error = error
        self.fieldID = fieldID
    }
}

// MARK: - Resolved state (web render branch)

/// The resolved, view-ready state — the pure result of applying the web source's
/// `error ? … : hint ? … : null` branch plus the required flag and the field id.
public struct FormFieldResolved: Sendable, Equatable {
    /// The always-visible label text (web `label`).
    public let label: String
    /// Whether the required asterisk + a11y suffix render (web `required`).
    public let isRequired: Bool
    /// The single inline message (error / hint / none).
    public let message: FormFieldMessage
    /// The caller-supplied control id, or `nil` to defer to a generated one.
    public let fieldID: String?

    public init(
        label: String,
        isRequired: Bool,
        message: FormFieldMessage,
        fieldID: String?
    ) {
        self.label = label
        self.isRequired = isRequired
        self.message = message
        self.fieldID = fieldID
    }
}

// MARK: - Projection (web branch, ported verbatim)

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's body. Whitespace-only `error` / `hint` collapse to no
/// message (React renders an empty string as nothing), and `error` strictly hides
/// `hint`. Unit tested across every combination.
public enum FormFieldProjection {
    public static func resolve(_ input: FormFieldInput) -> FormFieldResolved {
        FormFieldResolved(
            label: input.label,
            isRequired: input.required,
            message: message(error: input.error, hint: input.hint),
            fieldID: input.fieldID
        )
    }

    /// Web precedence: `error ? error : hint ? hint : null`, treating a
    /// whitespace-only value as absent so a blank validation string never renders an
    /// empty message row.
    static func message(error: String?, hint: String?) -> FormFieldMessage {
        if let error = nonBlank(error) { return .error(error) }
        if let hint = nonBlank(hint) { return .hint(hint) }
        return .none
    }

    private static func nonBlank(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : value
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver strings so the spoken content is asserted without rendering
/// the view. The required suffix is injected (the localized word) so this stays pure
/// and bundle-free while the view supplies the P1/S10 translation.
public enum FormFieldAccessibility {
    /// The field's spoken label: the web `<label>` text, with the required word
    /// appended when `required` (web `aria-label="required"` on the asterisk) so the
    /// state is announced once rather than reading a bare "*".
    public static func fieldLabel(label: String, required: Bool, requiredWord: String) -> String {
        required ? "\(label), \(requiredWord)" : label
    }
}
