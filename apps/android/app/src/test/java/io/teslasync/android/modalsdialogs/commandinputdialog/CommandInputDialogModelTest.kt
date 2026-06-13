// Off-device unit coverage for the CommandInputDialog modal/dialog's pure model (P3 acceptance: adapter +
// per-branch + diagnostics tests). Exercises the full `validateField` port — Required on empty, the 4-digit-PIN
// rule, the canonical-whole-number rule (web `String(num) !== trimmed`), the decimal parse (web `parseFloat`
// leniency), and the min / max bound checks — the initial-values seeding (web `buildInitialValues`), the
// whole-form validity gate (web `isValid`), the validate-all submit pass (web `handleSubmit`), the keyboard /
// masking resolution (web `resolveInputMode` / `resolveInputType`), the JS-style bound formatting, the registry
// identifiers, and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in
// :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.commandinputdialog

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CommandInputDialogModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Triple(level, event, fields)
        }
    }

    // ---- Required on empty (web `if (!trimmed) return 'Required'`) ----------------

    @Test
    fun validate_emptyOrBlankValueIsAlwaysRequired() {
        // Regardless of the declared rule, an empty / whitespace value is Required (web trims first).
        assertEquals(FieldError.Required, CommandInputDialogProjection.validate("", FieldValidation.None, null, null))
        assertEquals(FieldError.Required, CommandInputDialogProjection.validate("   ", FieldValidation.Pin, null, null))
        assertEquals(FieldError.Required, CommandInputDialogProjection.validate("", FieldValidation.Number, 50.0, 90.0))
        assertEquals(FieldError.Required, CommandInputDialogProjection.validate("\t", FieldValidation.Decimal, null, null))
    }

    // ---- Text / none always pass once non-empty (web `default: return null`) ------

    @Test
    fun validate_textAndNoneAcceptAnyNonEmptyValue() {
        assertNull(CommandInputDialogProjection.validate("anything", FieldValidation.Text, null, null))
        assertNull(CommandInputDialogProjection.validate("x", FieldValidation.None, null, null))
    }

    // ---- PIN rule (web `/^\d{4}$/`) ----------------------------------------------

    @Test
    fun validate_pinRequiresExactlyFourDigits() {
        assertNull(CommandInputDialogProjection.validate("1234", FieldValidation.Pin, null, null))
        assertEquals(FieldError.Pin, CommandInputDialogProjection.validate("123", FieldValidation.Pin, null, null))
        assertEquals(FieldError.Pin, CommandInputDialogProjection.validate("12345", FieldValidation.Pin, null, null))
        assertEquals(FieldError.Pin, CommandInputDialogProjection.validate("12ab", FieldValidation.Pin, null, null))
        assertEquals(FieldError.Pin, CommandInputDialogProjection.validate("abcd", FieldValidation.Pin, null, null))
    }

    // ---- Whole-number rule (web `parseInt` + `String(num) !== trimmed`) -----------

    @Test
    fun validate_numberAcceptsOnlyCanonicalIntegers() {
        assertNull(CommandInputDialogProjection.validate("75", FieldValidation.Number, 50.0, 90.0))
        // Non-canonical integer forms all fail the web `String(num) !== trimmed` round-trip check.
        assertEquals(FieldError.WholeNumber, CommandInputDialogProjection.validate("01", FieldValidation.Number, null, null))
        assertEquals(FieldError.WholeNumber, CommandInputDialogProjection.validate("+5", FieldValidation.Number, null, null))
        assertEquals(FieldError.WholeNumber, CommandInputDialogProjection.validate("1.5", FieldValidation.Number, null, null))
        assertEquals(FieldError.WholeNumber, CommandInputDialogProjection.validate("1e3", FieldValidation.Number, null, null))
        assertEquals(FieldError.WholeNumber, CommandInputDialogProjection.validate("abc", FieldValidation.Number, null, null))
        // A canonical negative integer is fine when unbounded.
        assertNull(CommandInputDialogProjection.validate("-5", FieldValidation.Number, null, null))
    }

    @Test
    fun validate_numberEnforcesMinAndMax() {
        assertEquals(FieldError.Min(50.0), CommandInputDialogProjection.validate("40", FieldValidation.Number, 50.0, 90.0))
        assertEquals(FieldError.Max(90.0), CommandInputDialogProjection.validate("95", FieldValidation.Number, 50.0, 90.0))
        // Boundary values are inclusive (web `num < min` / `num > max`).
        assertNull(CommandInputDialogProjection.validate("50", FieldValidation.Number, 50.0, 90.0))
        assertNull(CommandInputDialogProjection.validate("90", FieldValidation.Number, 50.0, 90.0))
    }

    // ---- Decimal rule (web `parseFloat`) -----------------------------------------

    @Test
    fun validate_decimalAcceptsParseableNumbersAndEnforcesBounds() {
        assertNull(CommandInputDialogProjection.validate("21.5", FieldValidation.Decimal, 15.0, 30.0))
        assertNull(CommandInputDialogProjection.validate("-122.4194", FieldValidation.Decimal, null, null))
        assertNull(CommandInputDialogProjection.validate(".5", FieldValidation.Decimal, null, null))
        // parseFloat leniency: a numeric prefix with trailing junk still parses (web `parseFloat('1.5abc') === 1.5`).
        assertNull(CommandInputDialogProjection.validate("1.5abc", FieldValidation.Decimal, null, null))
        // No leading number -> NaN -> the "valid number" message.
        assertEquals(FieldError.ValidNumber, CommandInputDialogProjection.validate("abc", FieldValidation.Decimal, null, null))
        assertEquals(FieldError.Min(15.0), CommandInputDialogProjection.validate("10", FieldValidation.Decimal, 15.0, 30.0))
        assertEquals(FieldError.Max(30.0), CommandInputDialogProjection.validate("35", FieldValidation.Decimal, 15.0, 30.0))
    }

    // ---- Field overload + initial values (web `buildInitialValues`) ---------------

    @Test
    fun validate_fieldOverloadDelegatesToFieldRuleAndBounds() {
        val field = CommandInputField("limit_mph", "Set MPH", null, FieldValidation.Number, min = 50.0, max = 90.0)
        assertNull(CommandInputDialogProjection.validate(field, "75"))
        assertEquals(FieldError.Min(50.0), CommandInputDialogProjection.validate(field, "40"))
    }

    @Test
    fun initialValues_seedsMultiFieldEmptyAndSingleParamDefault() {
        val multi =
            CommandInputSpec(
                title = "Share Destination",
                prompt = "Enter GPS coordinates",
                fields =
                    listOf(
                        CommandInputField("lat", "Latitude", "37.7749", FieldValidation.Decimal),
                        CommandInputField("lon", "Longitude", "-122.4194", FieldValidation.Decimal),
                    ),
            )
        assertEquals(mapOf("lat" to "", "lon" to ""), CommandInputDialogProjection.initialValues(multi))

        // The single-param case carries the resolved default the caller baked in (web `getDefaultValue` / `defaultValue`).
        val single =
            CommandInputSpec(
                title = "Set Temperature",
                prompt = "Enter temperature in °C (e.g., 21):",
                fields = listOf(CommandInputField("driver_temp", "Driver", "21", FieldValidation.Decimal, 15.0, 30.0, initialValue = "21")),
            )
        assertEquals(mapOf("driver_temp" to "21"), CommandInputDialogProjection.initialValues(single))
    }

    // ---- Whole-form validity (web `isValid`) -------------------------------------

    @Test
    fun isValid_requiresEveryFieldToPass() {
        val spec =
            CommandInputSpec(
                title = "Share Destination",
                prompt = "Enter GPS coordinates",
                fields =
                    listOf(
                        CommandInputField("lat", "Latitude", "37.7749", FieldValidation.Decimal),
                        CommandInputField("lon", "Longitude", "-122.4194", FieldValidation.Decimal),
                    ),
            )
        assertFalse(CommandInputDialogProjection.isValid(spec, emptyMap()))
        assertFalse(CommandInputDialogProjection.isValid(spec, mapOf("lat" to "37.77", "lon" to "abc")))
        assertTrue(CommandInputDialogProjection.isValid(spec, mapOf("lat" to "37.77", "lon" to "-122.41")))
    }

    // ---- Validate-all submit pass (web `handleSubmit`) ----------------------------

    @Test
    fun errorsOnSubmit_reportsEveryFieldsError() {
        val spec =
            CommandInputSpec(
                title = "Share Destination",
                prompt = "Enter GPS coordinates",
                fields =
                    listOf(
                        CommandInputField("lat", "Latitude", "37.7749", FieldValidation.Decimal),
                        CommandInputField("lon", "Longitude", "-122.4194", FieldValidation.Decimal),
                    ),
            )
        val errors = CommandInputDialogProjection.errorsOnSubmit(spec, mapOf("lat" to "37.77", "lon" to ""))
        assertEquals(setOf("lat", "lon"), errors.keys)
        assertNull(errors["lat"])
        assertEquals(FieldError.Required, errors["lon"])
    }

    // ---- Keyboard + masking (web `resolveInputMode` / `resolveInputType`) ---------

    @Test
    fun keyboardKindAndMasking_matchWebInputModeAndType() {
        assertEquals(KeyboardKind.NumericPassword, CommandInputDialogProjection.keyboardKind(FieldValidation.Pin))
        assertEquals(KeyboardKind.Numeric, CommandInputDialogProjection.keyboardKind(FieldValidation.Number))
        assertEquals(KeyboardKind.Decimal, CommandInputDialogProjection.keyboardKind(FieldValidation.Decimal))
        assertEquals(KeyboardKind.Text, CommandInputDialogProjection.keyboardKind(FieldValidation.Text))
        assertEquals(KeyboardKind.Text, CommandInputDialogProjection.keyboardKind(FieldValidation.None))

        // Only PIN masks (web `type === 'password'`).
        assertTrue(CommandInputDialogProjection.isMasked(FieldValidation.Pin))
        assertFalse(CommandInputDialogProjection.isMasked(FieldValidation.Number))
        assertFalse(CommandInputDialogProjection.isMasked(FieldValidation.Text))
    }

    // ---- Bound formatting (web `${min}` / `${max}`) -------------------------------

    @Test
    fun formatBound_rendersIntegralBoundsWithoutADecimalPoint() {
        assertEquals("50", CommandInputDialogProjection.formatBound(50.0))
        assertEquals("90", CommandInputDialogProjection.formatBound(90.0))
        assertEquals("30", CommandInputDialogProjection.formatBound(30.0))
        // A genuinely fractional bound keeps its fraction (web `String(0.5) === '0.5'`).
        assertEquals("0.5", CommandInputDialogProjection.formatBound(0.5))
    }

    // ---- Registry + diagnostics --------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("command-input-dialog", CommandInputDialogRegistration.ID)
        assertEquals("CommandInputDialog", CommandInputDialogRegistration.SLUG)
    }

    @Test
    fun recordViewOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        CommandInputDialogDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "CommandInputDialog"), fields)
    }
}
