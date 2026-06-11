// Pure, framework-free model + projection for the Byte Size Converter feature view — the native analogue of
// everything the web component derives via `useMemo` before returning JSX
// (web/src/features/admin/components/devtools/tools/ByteSizeConverter.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// The web tool is a self-contained calculator. Its only data hook is `useTranslation`; the binary-unit ladder
// (`BYTE_UNITS`) is a static constant and the conversions are pure math over the user's input — there is no
// network feed. This file owns the parts the web `useMemo` computes from the typed value + selected unit: the
// `parseFloat` guard, the bytes base, the per-unit rescale, the precision rule (0 fraction digits for `B`, 4
// for every scaled unit), and the locale-aware number formatting (`fmtNumber`). It also carries the
// `t(key, default)` resolver for the two title/description keys the i18n catalog does not define, and the
// pure top-level surface classifier the composable switches on so each lifecycle branch is testable.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ByteSizeConverter — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view + dashboard-widget surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.bytesizeconverter

import java.text.NumberFormat
import java.util.Locale
import kotlin.math.pow

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ByteSizeConverterRegistration {
    /** Stable surface id. */
    const val ID: String = "byte-size-converter"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ByteSizeConverter"
}

/**
 * The binary-unit ladder — verbatim web `BYTE_UNITS` (devtools `constants.ts`). The list order IS the
 * conversion math: index `i` represents `1024^i` bytes, so `MB` (index 2) is `1024^2` bytes.
 */
val BYTE_UNITS: List<String> = listOf("B", "KB", "MB", "GB", "TB")

/** Web `Input` example value "1024" (a numeral, not localized microcopy) shown in the empty field. */
const val VALUE_INPUT_EXAMPLE: String = "1024"

/** The `1024` step between adjacent [BYTE_UNITS] entries. */
private const val UNIT_STEP: Double = 1024.0

/** Fraction digits for the base `B` cell — web `fmtNumber(value, 0)`. */
const val BASE_UNIT_FRACTION_DIGITS: Int = 0

/** Fraction digits for every scaled cell (KB…TB) — web `fmtNumber(value, 4)`. */
const val SCALED_UNIT_FRACTION_DIGITS: Int = 4

/**
 * One fully projected, render-ready conversion cell — the native analogue of a single web `conversions[]`
 * entry. Pure data (no Compose types) so the projection is unit-tested without a UI host; [selected] marks
 * the cell whose [unit] equals the chosen unit (web `c.unit === unit`), which the composable highlights.
 */
data class ByteConversion(
    val unit: String,
    val value: String,
    val selected: Boolean,
)

/**
 * The three mutually-exclusive top-level surfaces the composable renders. The byte converter has no network
 * feed, so a host normally supplies [Ready]; [Loading] and [Error] are the lifecycle chrome the shared
 * feature-view contract (P1/S8) can still carry — reproduced for full state coverage, never faked from a
 * fetch the tool does not perform.
 */
enum class ByteSizeSurfaceState { Loading, Error, Ready }

/**
 * Classifies the host lifecycle flags into the top-level [ByteSizeSurfaceState] — the pure mirror of the
 * composable's `when` (loading first, then hard error, otherwise the ready calculator). Kept framework-free
 * so each branch is asserted off-device.
 */
fun byteSizeSurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
): ByteSizeSurfaceState =
    when {
        isLoading -> ByteSizeSurfaceState.Loading
        isError -> ByteSizeSurfaceState.Error
        else -> ByteSizeSurfaceState.Ready
    }

/**
 * Leading-number matcher reproducing JavaScript `parseFloat`: an optional sign, an integer/decimal/
 * fractional mantissa, and an optional exponent, anchored at the (left-trimmed) start. Trailing
 * non-numeric input is ignored just like `parseFloat("12abc") === 12`.
 */
private val LEADING_NUMBER = Regex("^[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?")

/**
 * The pure projection the composable renders — the native mirror of the web component's `useMemo` block.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object ByteSizeConverterProjection {
    /**
     * Parses the typed [raw] value the way web `parseFloat(value)` does: the leading numeric token is
     * returned (ignoring trailing junk), and a blank/non-numeric input yields `null` — the web `isNaN`
     * guard that hides the conversions grid.
     */
    fun parseValue(raw: String): Double? {
        val match = LEADING_NUMBER.find(raw.trimStart()) ?: return null
        return runCatching { java.lang.Double.parseDouble(match.value) }.getOrNull()
    }

    /** `1024^index` — the web `Math.pow(1024, i)` factor for a unit at [index] in [BYTE_UNITS]. */
    fun stepFactor(index: Int): Double = UNIT_STEP.pow(index)

    /**
     * Projects the typed [rawValue] + [selectedUnit] into the five render-ready cells, reproducing the web
     * `useMemo` exactly: parse the value (a `null`/invalid value or an unknown [selectedUnit] yields `null`
     * so the composable shows the empty hint), compute the byte base from the selected unit's `1024^idx`
     * factor, then rescale to every unit and format with [formatNumber] at 0 fraction digits for `B` and 4
     * for the scaled units. Injecting [formatNumber] keeps this locale-deterministic for tests.
     */
    fun project(
        rawValue: String,
        selectedUnit: String,
        formatNumber: (value: Double, fractionDigits: Int) -> String,
    ): List<ByteConversion>? {
        val number = parseValue(rawValue)
        val unitIndex = BYTE_UNITS.indexOf(selectedUnit)
        if (number == null || unitIndex < 0) return null
        val bytes = number * stepFactor(unitIndex)
        return BYTE_UNITS.mapIndexed { index, unit ->
            val digits = if (index == 0) BASE_UNIT_FRACTION_DIGITS else SCALED_UNIT_FRACTION_DIGITS
            ByteConversion(
                unit = unit,
                value = formatNumber(bytes / stepFactor(index), digits),
                selected = unit == selectedUnit,
            )
        }
    }

    /**
     * Folds a [conversion] into a single TalkBack content description ("<unit>, <value>") so each cell reads
     * as one node; the composable additionally marks the chosen cell with Compose `selected` semantics.
     */
    fun conversionCellDescription(conversion: ByteConversion): String = "${conversion.unit}, ${conversion.value}"
}

/**
 * Builds the locale-aware number formatter that mirrors web `fmtNumber` / `toLocaleString(locale,
 * { minimumFractionDigits, maximumFractionDigits })`: grouped thousands and a fixed fraction width. A
 * non-finite value is coerced to `0`, matching the web `safeNumber` guard. Pure (java.text only) so the
 * formatting is unit-tested deterministically with a fixed [locale].
 */
fun localizedNumberFormatter(locale: Locale): (Double, Int) -> String =
    { value, fractionDigits ->
        val safe = if (value.isFinite()) value else 0.0
        val format = NumberFormat.getNumberInstance(locale)
        format.isGroupingUsed = true
        format.minimumFractionDigits = fractionDigits
        format.maximumFractionDigits = fractionDigits
        format.format(safe)
    }

/**
 * The web `t(key, default)` fallback strings. The web calls `t('Byte Size')` / `t('Byte Size Desc')`, whose
 * keys exist in no i18n catalog (and must not be added to the generated, drift-checked catalog — ADR-014),
 * so i18next renders the key text itself; these defaults reproduce that exactly. [EMPTY_HINT] is the friendly
 * "no value yet" microcopy the always-visible empty state shows where the web hides the grid.
 */
object ByteSizeConverterDefaults {
    /** Web `t('Byte Size')` → "Byte Size" (no catalog entry, so i18next returns the key). */
    const val TITLE: String = "Byte Size"

    /** Web `t('Byte Size Desc')` → "Byte Size Desc" (no catalog entry, so i18next returns the key). */
    const val DESCRIPTION: String = "Byte Size Desc"

    /** Native-only empty hint (no value entered) — the always-visible counterpart to the web hidden grid. */
    const val EMPTY_HINT: String = "Enter a value to convert"
}

/** Resource name for the web `Byte Size` title key (by-name; absent ⇒ [ByteSizeConverterDefaults.TITLE]). */
const val KEY_TITLE: String = "translation_Byte_Size"

/** Resource name for the web `Byte Size Desc` key (by-name; absent ⇒ [ByteSizeConverterDefaults.DESCRIPTION]). */
const val KEY_DESCRIPTION: String = "translation_Byte_Size_Desc"

/** Resource name for the empty hint (by-name; absent ⇒ [ByteSizeConverterDefaults.EMPTY_HINT]). */
const val KEY_EMPTY_HINT: String = "translation_byteSize_enterValue"

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a
 * thin seam over the Android string catalog in production (an optional by-name resource read) and a map in
 * tests, so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * Localized microcopy folded into the surface — the web `t('Byte Size')`, `t('Byte Size Desc')`, `t('Value')`,
 * and `t('Unit')` strings plus the always-visible empty hint. The composable builds this from the i18n
 * facade; tests pass a deterministic instance.
 */
data class ByteSizeConverterStrings(
    val title: String,
    val description: String,
    val valueLabel: String,
    val unitLabel: String,
    val emptyHint: String,
)
