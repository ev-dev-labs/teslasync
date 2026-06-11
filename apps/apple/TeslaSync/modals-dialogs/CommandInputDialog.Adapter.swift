//
//  CommandInputDialog.Adapter.swift
//  TeslaSync — P4 modal/dialog · 0030 · CommandInputDialog (Apple)
//
//  The testable projection core for the vehicle-command input dialog — the faithful port of
//  features/system/components/CommandInputDialog.tsx. The web source is a `Modal` wrapping a command's
//  `inputConfig` as a form: either a list of named `fields` (the multi-field commands, e.g. HomeLink
//  lat/lon) or a single `paramName` field whose initial value can come from a `getDefaultValue(vehicle)`
//  hook. Each field validates by kind — `pin` (exactly four digits), `number` (a canonical whole
//  integer with optional min/max), `decimal` (a `parseFloat`-parseable value with optional min/max), or
//  `text`/none (non-empty only) — and the dialog only routes `onSubmit(values)` once every field is
//  valid.
//
//  Everything here is pure and dependency-free (Foundation only) so the projection — phase resolution,
//  the field-entry-mode mapping (web `resolveInputType`/`resolveInputMode`), the initial-value builder
//  (web `buildInitialValues`), the per-field validation (web `validateField`, ported verbatim incl. the
//  `String(parseInt) === trimmed` canonical-integer guard and the lenient `parseFloat` decimal rule),
//  and the all-fields-valid gate (web `isValid`) — can be unit-tested without a store, a bundle, or a
//  rendered view.
//
//  Web parity notes:
//    • `InputConfig.fields` vs `paramName` single field   → one unified `CommandInputSpec.fields` list,
//      the single field projected as one entry whose `initialValue` is the resolved default.
//    • `validateField(value, validation, min, max)`        → `CommandInputProjection.validate(...)`.
//    • `resolveInputType` + `resolveInputMode`             → `CommandInputProjection.entryMode(for:)`.
//    • `buildInitialValues`                                → `CommandInputProjection.initialValues(_:)`.
//    • `isValid`                                           → `CommandInputProjection.isValid(...)`.
//    • The web only ever shows the form; `resolvePhase` widens that into the prompt-required
//      loading / empty / error envelopes so no state is ever a blank panel.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, in the dependency-free core so the
/// projection's unit tests can reach it.
public enum CommandInputSurface {
    public static let slug = "CommandInputDialog"
}

// MARK: - Load status / render phase / freshness

/// The bound source's load status for the command-input context (the resolved command definition + the
/// vehicle context that seeds default values). The web reads the command synchronously from the page;
/// the native surface models the load lifecycle here so every state renders.
public enum CommandInputLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so the dialog
/// labels when the bound command/vehicle context may be momentarily out of date during a proxy flip.
public enum CommandInputConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// What the surface renders at the top level. The web only ever shows the form when a command is
/// selected; the loading + empty + error envelopes are added so the first-resolve, no-command, and
/// context-resolution-failure cases never render a blank panel.
public enum CommandInputPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Field validation + entry mode (web `validation` union / `resolveInput*`)

/// The validation kind for a field — the native parity of the web
/// `'pin' | 'number' | 'decimal' | 'text'` union.
public enum CommandFieldValidation: String, Sendable, Equatable {
    case pin
    case number
    case decimal
    case text
}

/// How a field should be entered on a native keyboard — the fold of the web `resolveInputType`
/// (pin → password) and `resolveInputMode` (pin/number → numeric, decimal → decimal, else text).
public enum CommandFieldEntryMode: Sendable, Equatable {
    /// Masked + numeric keypad (web `type="password"` + `inputMode="numeric"`), used for PINs.
    case secureNumeric
    /// Numeric keypad (web `inputMode="numeric"`), used for whole numbers.
    case numeric
    /// Decimal keypad (web `inputMode="decimal"`).
    case decimal
    /// Plain text (web `type="text"` + `inputMode="text"`).
    case text
}

// MARK: - Field + spec + context (web `InputField` / `InputConfig` / `CommandDef`)

/// One input field to render — the native parity of the web `InputField`, unified with the single-field
/// case (where the field is synthesised from `paramName` + the command `sublabel`). `initialValue` is
/// resolved upstream by the source (the web `getDefaultValue(vehicle)` / `defaultValue`); the projection
/// stays pure.
public struct CommandInputField: Sendable, Equatable, Identifiable {
    public let name: String
    public let labelKey: String?
    public let labelFallback: String?
    /// The grayed-out sample shown while the field is empty (the web `InputField` hint).
    public let hint: String
    public let validation: CommandFieldValidation?
    public let minValue: Double?
    public let maxValue: Double?
    public let initialValue: String

    public var id: String {
        name
    }

    public init(
        name: String,
        labelKey: String? = nil,
        labelFallback: String? = nil,
        hint: String = "",
        validation: CommandFieldValidation? = nil,
        minValue: Double? = nil,
        maxValue: Double? = nil,
        initialValue: String = ""
    ) {
        self.name = name
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.hint = hint
        self.validation = validation
        self.minValue = minValue
        self.maxValue = maxValue
        self.initialValue = initialValue
    }
}

/// The resolved command input config — the native parity of the web `CommandDef` + its `inputConfig`,
/// flattened by the source so the view binds to a single value type. `commandID` keys the form reset
/// (web `useEffect` on `open`/the active command); `fields` is the unified render list (≥ 1 entry).
public struct CommandInputSpec: Sendable, Equatable {
    public let commandID: String
    public let titleKey: String
    public let titleFallback: String
    public let promptKey: String
    public let promptFallback: String
    public let iconSystemName: String
    public let isDangerous: Bool
    public let fields: [CommandInputField]

    public init(
        commandID: String,
        titleKey: String,
        titleFallback: String,
        promptKey: String,
        promptFallback: String,
        iconSystemName: String = "terminal",
        isDangerous: Bool = false,
        fields: [CommandInputField]
    ) {
        self.commandID = commandID
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.promptKey = promptKey
        self.promptFallback = promptFallback
        self.iconSystemName = iconSystemName
        self.isDangerous = isDangerous
        self.fields = fields
    }
}

/// The command-input context a source resolves: the active command spec plus the bound vehicle's
/// display name (web `vehicle.display_name`, used by `getDefaultValue` upstream and the VoiceOver
/// summary). Modelled as loadable so the dialog can show loading / empty / error before the form.
public struct CommandInputContext: Sendable, Equatable {
    public let spec: CommandInputSpec
    public let vehicleDisplayName: String?

    public init(spec: CommandInputSpec, vehicleDisplayName: String? = nil) {
        self.spec = spec
        self.vehicleDisplayName = vehicleDisplayName
    }
}

// MARK: - Localization keys (web validation literals → P1/S10 keys)

/// The i18n keys + web English fallbacks for the validation messages. The web `validateField` returns
/// bare English literals; the native surface routes them through the P1/S10 facade (keys here, copy in
/// the per-surface `.strings` table) so no hardcoded English lives in the views. `{{value}}` is the
/// interpolation marker the projection substitutes with the formatted bound (web `` `Minimum: ${min}` ``).
public enum CommandInputCopy {
    public static let requiredKey = "commands.input.errors.required"
    public static let requiredFallback = "Required"
    public static let pinKey = "commands.input.errors.pin"
    public static let pinFallback = "Enter a 4-digit PIN"
    public static let wholeNumberKey = "commands.input.errors.wholeNumber"
    public static let wholeNumberFallback = "Enter a whole number"
    public static let numberKey = "commands.input.errors.number"
    public static let numberFallback = "Enter a valid number"
    public static let minKey = "commands.input.errors.min"
    public static let minFallback = "Minimum: {{value}}"
    public static let maxKey = "commands.input.errors.max"
    public static let maxFallback = "Maximum: {{value}}"
}

// MARK: - Projection core (pure)

/// The dependency-free rules shared by the model and the views: phase resolution, the entry-mode
/// mapping, the initial-value builder, the per-field validation (the verbatim web `validateField` port),
/// and the all-fields-valid gate. Validation copy resolves through an injected localizer so it stays
/// bundle-free.
public enum CommandInputProjection {
    /// The largest exactly-representable integer (`Number.MAX_SAFE_INTEGER`). Beyond it, JS
    /// `String(parseInt(s,10)) === s` can never hold, so such inputs fail the whole-number guard.
    public static let maxSafeInteger: Double = 9_007_199_254_740_991

    /// Resolves the render phase. Loading shows only before the command resolves; a resolved
    /// no-command state shows the empty envelope; a resolution failure with no cached context shows the
    /// error state; once a command is on hand the form stays on screen (freshness shown by the chip /
    /// banner).
    public static func resolvePhase(
        status: CommandInputLoadStatus,
        context: CommandInputContext?
    ) -> CommandInputPhase {
        switch status {
        case .loading:
            context == nil ? .loading : .content
        case .loaded:
            context == nil ? .empty : .content
        case let .failed(message):
            context == nil ? .error(message) : .content
        }
    }

    /// Maps a field's validation kind to its native entry mode — the fold of the web `resolveInputType`
    /// (pin → password) and `resolveInputMode` (pin/number → numeric, decimal → decimal, else text).
    public static func entryMode(for validation: CommandFieldValidation?) -> CommandFieldEntryMode {
        switch validation {
        case .pin:
            .secureNumeric
        case .number:
            .numeric
        case .decimal:
            .decimal
        case .text, .none:
            .text
        }
    }

    /// Builds the initial form values — the web `buildInitialValues`: each field seeded with its
    /// resolved `initialValue` (empty for the multi-field commands; the `getDefaultValue` / `defaultValue`
    /// for the single-field commands, resolved upstream by the source).
    public static func initialValues(_ spec: CommandInputSpec) -> [String: String] {
        var values: [String: String] = [:]
        for field in spec.fields {
            values[field.name] = field.initialValue
        }
        return values
    }

    /// Whether a field renders a visible label — the web single-field rule (label shown only when a
    /// `sublabel` fallback exists); multi-field entries always carry a label.
    public static func showsLabel(_ field: CommandInputField) -> Bool {
        guard let fallback = field.labelFallback else { return false }
        return !fallback.isEmpty
    }

    /// Validates one field's value — the verbatim port of the web `validateField`: empty → Required;
    /// `pin` → exactly four ASCII digits; `number` → a canonical whole integer (the `String(parseInt) ===
    /// trimmed` guard) then min/max; `decimal` → a `parseFloat`-parseable value then min/max; `text` /
    /// none → no further check. Returns the localized message, or `nil` when the field is valid.
    public static func validate(
        value: String,
        validation: CommandFieldValidation?,
        min: Double?,
        max: Double?,
        localize: (String, String) -> String
    ) -> String? {
        let trimmed = value.commandInputTrimmed
        if trimmed.isEmpty {
            return localize(CommandInputCopy.requiredKey, CommandInputCopy.requiredFallback)
        }
        switch validation {
        case .pin:
            return isFourDigitPIN(trimmed)
                ? nil
                : localize(CommandInputCopy.pinKey, CommandInputCopy.pinFallback)
        case .number:
            guard let num = canonicalInteger(trimmed) else {
                return localize(CommandInputCopy.wholeNumberKey, CommandInputCopy.wholeNumberFallback)
            }
            return boundsError(value: num, min: min, max: max, localize: localize)
        case .decimal:
            guard let num = jsParseFloat(trimmed) else {
                return localize(CommandInputCopy.numberKey, CommandInputCopy.numberFallback)
            }
            return boundsError(value: num, min: min, max: max, localize: localize)
        case .text, .none:
            return nil
        }
    }

    /// Convenience over `validate(...)` taking a `CommandInputField`.
    public static func validateField(
        _ field: CommandInputField,
        value: String,
        localize: (String, String) -> String
    ) -> String? {
        validate(
            value: value,
            validation: field.validation,
            min: field.minValue,
            max: field.maxValue,
            localize: localize
        )
    }

    /// Whether every field passes validation — the web `isValid`. Validity is independent of copy, so a
    /// passthrough localizer is used internally.
    public static func isValid(spec: CommandInputSpec, values: [String: String]) -> Bool {
        let passthrough: (String, String) -> String = { _, fallback in fallback }
        return spec.fields.allSatisfy { field in
            validateField(field, value: values[field.name] ?? "", localize: passthrough) == nil
        }
    }

    // MARK: Bounds + number parsing (web parseInt / parseFloat semantics)

    /// The min/max bound message, or `nil` when in range — the web `` `Minimum: ${min}` `` /
    /// `` `Maximum: ${max}` `` checks (`num < min` / `num > max`).
    private static func boundsError(
        value: Double,
        min: Double?,
        max: Double?,
        localize: (String, String) -> String
    ) -> String? {
        if let min, value < min {
            return substituteValue(localize(CommandInputCopy.minKey, CommandInputCopy.minFallback), formatBound(min))
        }
        if let max, value > max {
            return substituteValue(localize(CommandInputCopy.maxKey, CommandInputCopy.maxFallback), formatBound(max))
        }
        return nil
    }

    /// Whether `text` is exactly four ASCII digits — the web `/^\d{4}$/.test(trimmed)`.
    private static func isFourDigitPIN(_ text: String) -> Bool {
        text.count == 4 && text.allSatisfy { $0.isASCII && $0.isNumber }
    }

    /// Formats a numeric bound the way the web template literal does — integers without a decimal point
    /// (`50`, not `50.0`), otherwise a trimmed decimal.
    private static func formatBound(_ value: Double) -> String {
        if value.rounded() == value, abs(value) <= maxSafeInteger {
            return String(Int(value))
        }
        return String(value)
    }

    /// Substitutes the `{{value}}` interpolation marker in a min/max template.
    private static func substituteValue(_ template: String, _ value: String) -> String {
        template.replacingOccurrences(of: "{{value}}", with: value)
    }
}

// MARK: - Small helpers

extension String {
    /// Whitespace/newline-trimmed copy (web `String.prototype.trim`).
    var commandInputTrimmed: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
