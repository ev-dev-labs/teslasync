// Pure, framework-free model + projection for the CommandInputDialog modal/dialog surface — the native analogue
// of everything the web component derives before it returns JSX
// (web/src/features/system/components/CommandInputDialog.tsx). No Compose, no Android, no HTTP: every declaration
// here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable stays a thin render
// layer over these pure functions.
//
// The web component is the vehicle-command parameter prompt. It is a *controlled* dialog whose only data
// dependency is `useTranslation` (i18n, P1/S10) — it binds no fetch and owns no store. Its command spec (`def` /
// `inputConfig`) and its submit/close handlers are caller-supplied props, and the `loading` flag reflects the
// OWNING command page's mutation, not this dialog's. So (exactly like the sibling ConfirmDialog surface) the
// cache-then-network lifecycle (loading / empty / error / stale / offline) belongs to the owner that decides to
// raise the prompt, not here; modelling those phases would invent behaviour the web spec does not have (drift).
// The branches the web source actually defines are the complete state set this surface renders, and each is
// projected here:
//   1. the per-field validation (web `validateField`) — Required on empty, the 4-digit-PIN / whole-number /
//      decimal rules, and the min / max bound checks — surfaced as a typed [FieldError] so the localized message
//      is resolved at the Compose boundary (P1/S10), never as a literal here,
//   2. the initial form values (web `buildInitialValues`) — empty for every multi-field, the resolved default
//      for the single-param case (the caller bakes `getDefaultValue({ vehicle })` / `defaultValue` into
//      [CommandInputField.initialValue]),
//   3. the whole-form validity gate (web `isValid`) that drives the disabled Send button,
//   4. the on-submit pass (web `handleSubmit`) that validates + touches every field at once,
//   5. the keyboard / masking resolution (web `resolveInputType` / `resolveInputMode`) — PIN masks + numeric,
//      number numeric, decimal decimal, text plain.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/CommandInputDialog — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling modal surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.commandinputdialog

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The validation vocabulary a command parameter can declare — the native union of the web
 * `validation?: 'pin' | 'number' | 'decimal' | 'text'` (with [None] standing in for the web `undefined`). It
 * selects both the [CommandInputDialogProjection.validate] rule and the [KeyboardKind] / masking the field uses.
 */
enum class FieldValidation {
    /** No declared rule (web `undefined`): any non-empty value passes. */
    None,

    /** Free text (web `'text'`): any non-empty value passes; plain keyboard. */
    Text,

    /** A 4-digit PIN (web `'pin'`): masked numeric input matching `^\d{4}$`. */
    Pin,

    /** A whole number (web `'number'`): canonical base-10 integer, optionally bounded by min / max. */
    Number,

    /** A decimal number (web `'decimal'`): a parseable float, optionally bounded by min / max. */
    Decimal,
}

/**
 * The typed result of validating one field — the native analogue of the English string `validateField` returns
 * inline in the web source. Kept as a type (not a message) so the composable resolves the localized copy at the
 * Compose boundary (P1/S10); the bounded cases carry the numeric bound the message interpolates (web
 * `Minimum: ${min}` / `Maximum: ${max}`). A `null` result means the field is valid.
 */
sealed interface FieldError {
    /** The value was empty after trimming (web `if (!trimmed) return 'Required'`). */
    data object Required : FieldError

    /** A PIN field whose value is not exactly four digits (web `'Enter a 4-digit PIN'`). */
    data object Pin : FieldError

    /** A number field whose value is not a canonical whole number (web `'Enter a whole number'`). */
    data object WholeNumber : FieldError

    /** A decimal field whose value is not a parseable number (web `'Enter a valid number'`). */
    data object ValidNumber : FieldError

    /** The numeric value is below the declared minimum (web `Minimum: ${min}`); [bound] is that minimum. */
    data class Min(
        val bound: Double,
    ) : FieldError

    /** The numeric value is above the declared maximum (web `Maximum: ${max}`); [bound] is that maximum. */
    data class Max(
        val bound: Double,
    ) : FieldError
}

/**
 * The keyboard flavour a field requests — the native fusion of the web `resolveInputMode` (numeric / decimal /
 * text) and `resolveInputType` (password for PIN). The Compose boundary maps each to a `KeyboardType` plus, for
 * [NumericPassword], a masking `VisualTransformation`.
 */
enum class KeyboardKind {
    /** Plain text keyboard (web `inputMode='text'`, `type='text'`). */
    Text,

    /** Numeric keyboard (web `inputMode='numeric'`, `type='text'`). */
    Numeric,

    /** Decimal keyboard (web `inputMode='decimal'`, `type='text'`). */
    Decimal,

    /** Masked numeric keyboard for PINs (web `inputMode='numeric'`, `type='password'`). */
    NumericPassword,
}

/**
 * One editable field the dialog renders — the native, already-localized projection of a web `InputField`
 * (multi-field case) or the single `inputConfig` param. [label] / [hint] are caller-localized (web
 * `t(field.labelKey, …)` / `def.sublabel`), so the pure layer never holds an i18n key. [initialValue] mirrors the
 * web `buildInitialValues` seed: empty for the multi-field case, the resolved default for the single-param case.
 *
 * @property name the wire param name (web `field.name` / `inputConfig.paramName`); the [onSubmit] map key.
 * @property label the caller-localized field label (web `t(field.labelKey, field.labelFallback)` / the single
 *   param's `def.sublabel`); `null` renders an unlabelled field (web single param with no `sublabelFallback`).
 * @property hint the caller-supplied example text shown in an empty field (web input example text /
 *   `inputConfig.defaultValue`).
 * @property validation the rule this field enforces (web `field.validation` / `inputConfig.validation`).
 * @property min the inclusive lower bound for number / decimal fields (web `min`); `null` when unbounded.
 * @property max the inclusive upper bound for number / decimal fields (web `max`); `null` when unbounded.
 * @property initialValue the value the field opens with (web `buildInitialValues`): `""` for multi-field, the
 *   resolved default for the single-param case.
 */
data class CommandInputField(
    val name: String,
    val label: String?,
    val hint: String?,
    val validation: FieldValidation = FieldValidation.None,
    val min: Double? = null,
    val max: Double? = null,
    val initialValue: String = "",
)

/**
 * The fully-localized command-prompt spec the dialog renders — the native projection of the web `def` +
 * `inputConfig` the component reads. [title] / [prompt] are caller-localized (web `t(def.labelKey, …)` /
 * `t(inputConfig.promptKey, …)`). [fields] is always non-empty: the web's single-param branch is modelled as a
 * one-element list (whose sole field carries the `paramName`, the resolved default, and the param validation), so
 * the two web render branches unify into one list with no behaviour loss — `onSubmit` still emits exactly the web
 * `{ [paramName]: value }` / `{ [field.name]: value, … }` shape.
 *
 * @property title the dialog title (web `t(def.labelKey, def.labelFallback)`); caller-localized.
 * @property prompt the prompt line under the title (web `t(inputConfig.promptKey, inputConfig.promptFallback)`).
 * @property fields the ordered fields to render (web `inputConfig.fields` or the single `paramName`); non-empty.
 */
data class CommandInputSpec(
    val title: String,
    val prompt: String,
    val fields: List<CommandInputField>,
)

/**
 * Pure projection from the dialog's inputs to its render + validation decisions — a 1:1 port of the derivations
 * the web component performs (the `validateField` switch, `buildInitialValues`, `isValid`, the `handleSubmit`
 * touch-all pass, and the `resolveInputType` / `resolveInputMode` keyboard mapping). No Compose, no side effects,
 * so it is fully covered by the off-device unit gate.
 */
object CommandInputDialogProjection {
    private val pinRegex = Regex("^\\d{4}$")
    private val integerPrefixRegex = Regex("^[+-]?\\d+")
    private val floatPrefixRegex = Regex("^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?")

    /**
     * The initial value map the form opens with — the web `buildInitialValues`. Each field seeds its own
     * [CommandInputField.initialValue] (`""` for multi-field, the resolved default for the single-param case).
     */
    fun initialValues(spec: CommandInputSpec): Map<String, String> = spec.fields.associate { it.name to it.initialValue }

    /**
     * Validates [field]'s current [value] — the web `validateField(value, field.validation, field.min,
     * field.max)`. Returns `null` when the field is valid.
     */
    fun validate(
        field: CommandInputField,
        value: String,
    ): FieldError? = validate(value, field.validation, field.min, field.max)

    /**
     * The core single-field validator — a faithful port of the web `validateField`. An empty (trimmed) value is
     * always [FieldError.Required]; otherwise the [validation] rule decides. Text / none always pass once
     * non-empty.
     */
    fun validate(
        value: String,
        validation: FieldValidation,
        min: Double?,
        max: Double?,
    ): FieldError? {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) return FieldError.Required
        return when (validation) {
            FieldValidation.Pin -> if (pinRegex.matches(trimmed)) null else FieldError.Pin
            FieldValidation.Number -> validateWholeNumber(trimmed, min, max)
            FieldValidation.Decimal -> validateDecimal(trimmed, min, max)
            FieldValidation.Text, FieldValidation.None -> null
        }
    }

    /**
     * Whether the whole form passes — the web `isValid`. Drives the disabled Send button: every field must
     * validate to `null` against its current value (missing keys treated as empty, i.e. [FieldError.Required]).
     */
    fun isValid(
        spec: CommandInputSpec,
        values: Map<String, String>,
    ): Boolean = spec.fields.all { validate(it, values[it.name].orEmpty()) == null }

    /**
     * The validate-and-touch-all pass the web `handleSubmit` runs before deciding to submit — returns the error
     * for every field (web builds `newErrors` + `newTouched` for all fields). The composable marks every field
     * touched and submits only when the whole map is error-free (web `if (valid) onSubmit(values)`).
     */
    fun errorsOnSubmit(
        spec: CommandInputSpec,
        values: Map<String, String>,
    ): Map<String, FieldError?> = spec.fields.associate { it.name to validate(it, values[it.name].orEmpty()) }

    /**
     * The keyboard flavour for a [validation] — the web `resolveInputMode` fused with `resolveInputType`. PIN is
     * masked numeric; number is numeric; decimal is decimal; text / none are plain.
     */
    fun keyboardKind(validation: FieldValidation): KeyboardKind =
        when (validation) {
            FieldValidation.Pin -> KeyboardKind.NumericPassword
            FieldValidation.Number -> KeyboardKind.Numeric
            FieldValidation.Decimal -> KeyboardKind.Decimal
            FieldValidation.Text, FieldValidation.None -> KeyboardKind.Text
        }

    /** Whether a [validation]'s input should be masked — the web `resolveInputType === 'password'` (PIN only). */
    fun isMasked(validation: FieldValidation): Boolean = validation == FieldValidation.Pin

    /**
     * Formats a numeric [bound] the way the web interpolates `${min}` / `${max}` — an integral value renders with
     * no fractional part (`50`, `30`), a genuinely fractional one renders normally (`0.5`). Mirrors JS
     * `String(Number)` for the bounds the command catalog actually declares.
     */
    fun formatBound(bound: Double): String =
        when {
            bound.isFinite() && bound % 1.0 == 0.0 -> bound.toLong().toString()
            else -> bound.toString()
        }

    private fun validateWholeNumber(
        trimmed: String,
        min: Double?,
        max: Double?,
    ): FieldError? {
        val parsed = jsParseInt(trimmed)
        // web: `isNaN(num) || String(num) !== trimmed` — reject non-canonical integers ("01", "+5", "1.5", "1e3").
        if (parsed == null || parsed.toString() != trimmed) return FieldError.WholeNumber
        // Compare the parsed integer directly against the bounds (web compares `num`); no float widening needed.
        return when {
            min != null && parsed < min -> FieldError.Min(min)
            max != null && parsed > max -> FieldError.Max(max)
            else -> null
        }
    }

    private fun validateDecimal(
        trimmed: String,
        min: Double?,
        max: Double?,
    ): FieldError? {
        val parsed = jsParseFloat(trimmed) ?: return FieldError.ValidNumber
        return checkBounds(parsed, min, max)
    }

    private fun checkBounds(
        num: Double,
        min: Double?,
        max: Double?,
    ): FieldError? =
        when {
            min != null && num < min -> FieldError.Min(min)
            max != null && num > max -> FieldError.Max(max)
            else -> null
        }

    /**
     * The leading-integer parse the web gets from `parseInt(trimmed, 10)`: an optional sign then base-10 digits,
     * stopping at the first non-digit. Returns `null` for the JS `NaN` case (no leading digits). The caller
     * re-stringifies the result to reproduce the web `String(num) !== trimmed` canonical-form check.
     */
    private fun jsParseInt(trimmed: String): Long? = integerPrefixRegex.find(trimmed)?.value?.toLongOrNull()

    /**
     * The leading-float parse the web gets from `parseFloat(trimmed)`: an optional sign, an integer / fractional
     * mantissa, and an optional exponent, stopping at the first character that cannot extend the number (so
     * "1.5abc" yields 1.5, matching JS). Returns `null` for the JS `NaN` case (no leading number).
     */
    private fun jsParseFloat(trimmed: String): Double? {
        val match = floatPrefixRegex.find(trimmed)?.value ?: return null
        return match.toDoubleOrNull() // parity:allow stdlib parse; substring false positive
    }
}

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object CommandInputDialogRegistration {
    /** Stable surface id. */
    const val ID: String = "command-input-dialog"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "CommandInputDialog"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface
 * [CommandInputDialogRegistration.SLUG] — never a field value, the typed PIN, or the command — so a diagnostics
 * line can never leak what the operator is entering. Kept free of Compose so it is unit-tested with a recording
 * [Logger]; the composable calls it from its first-composition effect.
 */
object CommandInputDialogDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to CommandInputDialogRegistration.SLUG))
    }
}
