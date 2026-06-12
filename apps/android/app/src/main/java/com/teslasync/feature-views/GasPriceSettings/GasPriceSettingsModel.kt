// Pure, framework-light model + projection backing the Compose [GasPriceSettings] feature view — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/settings/components/GasPriceSettings.tsx). Every declaration here is exercised off-device by
// the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component composes the gas-price domain hooks (useGasPriceStatus / usePollGasPrice /
// useToggleGasPrice / useUpdateGasPriceConfig) with the display preferences read implicitly by `useSettings`
// (gas_unit) and `useFormatting` (currency_symbol + decimal_precision). This file owns the parity-critical
// derivations that have nothing to do with Compose: the poll-interval catalogue (web `<Select>` options), the
// currency/unit preference read from the raw `/settings` document (web `useFormatting` + `gasUnitLabel`), the
// `formatCurrency` money formatter, the last-polled parse (web `last_poll_time !== '0001-01-01T00:00:00Z'`
// guard), the render-ready snapshot the panel draws, and the typed toast set. Glyphs lucide has no Android
// bundle for (`Fuel`, `Zap`, `Play`, `Pause`) are authored locally as stroked vectors recolored at render.
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed: the mandated surface directory
// (com/teslasync/feature-views/GasPriceSettings — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package and the file hosts several co-located declarations, exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "ktlint:standard:filename")

package io.teslasync.android.featureviews.gaspricesettings

import androidx.annotation.StringRes
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.GasPriceStatus
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import java.text.NumberFormat
import java.time.Instant
import java.util.Locale

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object GasPriceSettingsRegistration {
    /** Stable surface id. */
    const val ID: String = "gas-price-settings"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "GasPriceSettings"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [GasPriceSettingsRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from the first
 * composition. It carries no price, poll cadence, or timestamp, so a diagnostics line can never leak a user's
 * configuration or spend.
 */
fun recordGasPriceSettingsViewOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to GasPriceSettingsRegistration.SLUG))
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/**
 * The four EIA poll cadences — the type-safe port of the web `<Select>` options
 * (`daily` / `7d` / `15d` / `30d`). [wire] is the exact backend value the web sends; [labelRes] is the matching
 * P1/S10 catalog string. [from] classifies a raw wire value, falling back to [Weekly] for blank/unknown exactly
 * like the web default (`gasPriceStatus?.poll_interval || '7d'`). [ordered] preserves the web option order.
 */
enum class PollInterval(
    val wire: String,
    @param:StringRes val labelRes: Int,
) {
    Daily("daily", R.string.translation_gas_daily),
    Weekly("7d", R.string.translation_gas_weekly),
    BiWeekly("15d", R.string.translation_gas_biweekly),
    Monthly("30d", R.string.translation_gas_monthly),
    ;

    companion object {
        /** The web option order: Daily, Weekly, Bi-weekly, Monthly. */
        val ordered: List<PollInterval> = listOf(Daily, Weekly, BiWeekly, Monthly)

        /** Classifies a raw wire value; blank/unknown falls back to [Weekly] (web `|| '7d'`). */
        fun from(raw: String?): PollInterval = ordered.firstOrNull { it.wire == raw } ?: Weekly
    }
}

/**
 * The user's currency + fuel-unit display preferences read from the raw `/settings` document — the native port
 * of the web `useFormatting` currency read plus the component's `gasUnitLabel`. Prices are user-entered
 * preference values stored verbatim (not SI telemetry), so no conversion happens here; only display formatting.
 *
 * @property currencySymbol the money prefix (web `useFormatting().currencySymbol`; blank ⇒ "$").
 * @property decimalPrecision the fraction digits (web `decimal_precision`; floored at 0, default 2).
 * @property gasUnit the raw `gas_unit` preference; only `"liter"` changes the suffix (web `=== 'liter'`).
 */
data class GasDisplayPrefs(
    val currencySymbol: String = DEFAULT_SYMBOL,
    val decimalPrecision: Int = DEFAULT_PRECISION,
    val gasUnit: String = DEFAULT_UNIT,
) {
    /** The per-gallon / per-litre suffix (web `gas_unit === 'liter' ? 'L' : 'gal'`). */
    val gasUnitLabel: String get() = if (gasUnit == UNIT_LITER) LABEL_LITER else LABEL_GALLON

    /** The precision floored at zero (web `Math.max(0, …)`) so a stray negative never breaks formatting. */
    val resolvedPrecision: Int get() = if (decimalPrecision < 0) 0 else decimalPrecision

    companion object {
        /** Web blank-currency fallback. */
        const val DEFAULT_SYMBOL: String = "$"

        /** Web `fmtNumber` global default precision. */
        const val DEFAULT_PRECISION: Int = 2

        /** Web default when `gas_unit` is absent (anything but `liter` ⇒ gallons). */
        const val DEFAULT_UNIT: String = "gallon"

        private const val UNIT_LITER = "liter"
        private const val LABEL_LITER = "L"
        private const val LABEL_GALLON = "gal"
        private const val KEY_CURRENCY_SYMBOL = "currency_symbol"
        private const val KEY_DECIMAL_PRECISION = "decimal_precision"
        private const val KEY_GAS_UNIT = "gas_unit"

        /** All-default preferences for previews / cold start before the settings document loads. */
        val DEFAULT: GasDisplayPrefs = GasDisplayPrefs()

        /**
         * Derives the preferences from the raw `/settings` [JsonElement] — the Kotlin port of the web
         * `useFormatting` reads: a non-blank `currency_symbol` wins (else "$"), `decimal_precision` is floored
         * at 0 (else 2), and `gas_unit` is taken verbatim (else "gallon"). A missing/garbage document yields the
         * web defaults so the panel formats sensibly during loading.
         */
        fun from(settings: JsonElement?): GasDisplayPrefs {
            val obj = settings as? JsonObject ?: return DEFAULT
            val symbol = (obj[KEY_CURRENCY_SYMBOL] as? JsonPrimitive)?.contentOrNull
            val precision = (obj[KEY_DECIMAL_PRECISION] as? JsonPrimitive)?.intOrNull
            val unit = (obj[KEY_GAS_UNIT] as? JsonPrimitive)?.contentOrNull
            return GasDisplayPrefs(
                currencySymbol = if (!symbol.isNullOrBlank()) symbol else DEFAULT_SYMBOL,
                decimalPrecision = precision?.coerceAtLeast(0) ?: DEFAULT_PRECISION,
                gasUnit = if (!unit.isNullOrBlank()) unit else DEFAULT_UNIT,
            )
        }
    }
}

/**
 * Formats a money [amount] as `"${symbol}${grouped fixed-precision number}"` — the native port of the web
 * `formatCurrency` (`${currencySymbol}${fmtNumber(amount, decimals)}`). [locale] drives grouping + digit glyphs
 * (defaults to the device locale at the render boundary; tests pin [Locale.US] for determinism).
 */
fun formatCurrency(
    amount: Double,
    prefs: GasDisplayPrefs,
    locale: Locale = Locale.getDefault(),
): String = "${prefs.currencySymbol}${fmtNumber(amount, prefs.resolvedPrecision, locale)}"

/** Web `fmtNumber`: a locale-grouped number with exactly [decimals] fraction digits. */
private fun fmtNumber(
    value: Double,
    decimals: Int,
    locale: Locale,
): String {
    val format = NumberFormat.getNumberInstance(locale)
    format.minimumFractionDigits = decimals
    format.maximumFractionDigits = decimals
    return format.format(value)
}

/**
 * The last-poll timestamp classification — the native port of the web ternary
 * `last_poll_time && last_poll_time !== '0001-01-01T00:00:00Z' ? formatDateTime(...) : 'Never'`, with the extra
 * [Invalid] branch covering `formatDateTime`'s own "—" fallback for an unparseable non-sentinel value.
 */
sealed interface LastPolled {
    /** No poll has run (blank or the Go zero-time sentinel) — web renders the "Never" label. */
    data object Never : LastPolled

    /** A non-sentinel value that did not parse — web `formatDateTime` would render "—". */
    data object Invalid : LastPolled

    /** A valid instant, as epoch milliseconds, formatted at the render boundary in device locale/zone. */
    data class At(
        val epochMillis: Long,
    ) : LastPolled

    companion object {
        /** The Go `time.Time` zero value the backend emits when a feed has never polled. */
        const val ZERO_SENTINEL: String = "0001-01-01T00:00:00Z"

        /** Classifies a raw ISO-8601 [raw]; blank/sentinel ⇒ [Never], parse failure ⇒ [Invalid]. */
        fun parse(raw: String?): LastPolled {
            if (raw.isNullOrBlank() || raw == ZERO_SENTINEL) return Never
            return runCatching { Instant.parse(raw).toEpochMilli() }
                .fold(onSuccess = { At(it) }, onFailure = { Invalid })
        }
    }
}

/**
 * The render-ready projection of a [GasPriceStatus] + [GasDisplayPrefs] — the data adapter the composable draws
 * and the unit test drives directly (cached status → projection). Mirrors the web component's inline derivations:
 * the running flag (`enabled`), the selected interval (`poll_interval || '7d'`), the formatted current-price text
 * (`current_price ? ${formatCurrency}/${gasUnitLabel} : '—'` → [priceText] = `null` means render the "—"
 * fallback), and the parsed last-poll stamp.
 *
 * @property running whether auto-poll is on (web `gasPriceStatus?.enabled`).
 * @property interval the selected poll cadence (web `<Select value>`).
 * @property priceText the formatted "$x.xx/gal" string, or `null` when there is no price yet (render "—").
 * @property lastPolled the last-poll classification.
 */
data class GasPriceSettingsSnapshot(
    val running: Boolean,
    val interval: PollInterval,
    val priceText: String?,
    val lastPolled: LastPolled,
) {
    companion object {
        /** Projects a [status] + [prefs] onto the render-ready snapshot (web inline derivations). */
        fun from(
            status: GasPriceStatus,
            prefs: GasDisplayPrefs,
            locale: Locale = Locale.getDefault(),
        ): GasPriceSettingsSnapshot =
            GasPriceSettingsSnapshot(
                running = status.enabled,
                interval = PollInterval.from(status.pollInterval),
                priceText =
                    if (status.currentPrice > 0.0) {
                        "${formatCurrency(status.currentPrice, prefs, locale)}/${prefs.gasUnitLabel}"
                    } else {
                        null
                    },
                lastPolled = LastPolled.parse(status.lastPollTime),
            )
    }
}

/**
 * The typed, localized-at-the-boundary toasts the surface raises for its mutations — the native analogue of the
 * web component's `useToast` calls. The four successes mirror the component's `toast.info(...)` (gas.enabled /
 * gas.disabled / gas.intervalUpdated / gas.pollTriggered); the three failures surface the gas-price mutation
 * error copy already in the P1/S10 catalog so a failed write is never silent.
 */
sealed interface GasPriceToast {
    /** Auto-poll turned on — web `toast.info(t('gas.enabled'))`. */
    data object AutoPollEnabled : GasPriceToast

    /** Auto-poll turned off — web `toast.info(t('gas.disabled'))`. */
    data object AutoPollDisabled : GasPriceToast

    /** Poll interval saved — web `toast.info(t('gas.intervalUpdated'))`. */
    data object IntervalUpdated : GasPriceToast

    /** Manual poll triggered — web `toast.info(t('gas.pollTriggered'))`. */
    data object Polled : GasPriceToast

    /** Toggle failed — `toast.settings.gasPrice.toggle.error`. */
    data object ToggleFailed : GasPriceToast

    /** Interval save failed — `toast.settings.gasPrice.config.error`. */
    data object IntervalFailed : GasPriceToast

    /** Manual poll failed — `toast.settings.gasPrice.poll.error`. */
    data object PollFailed : GasPriceToast
}

/**
 * The locally-authored 24×24 stroked icons the surface needs — the Android stand-ins for the web `lucide-react`
 * glyphs (`Fuel`, `Zap`, `Play`, `Pause`). Android ships no lucide set, so these are monochrome [ImageVector]s
 * recolored at render time by `Icon`'s `tint`, exactly like the sibling surfaces' glyph sets. All are decorative
 * (the adjacent text carries the meaning), so each is drawn with a `null` content description at the call site.
 */
object GasPriceGlyphs {
    /** lucide `Fuel` — a pump body, fill-line, and the right-hand nozzle/filler hose. */
    val Fuel: ImageVector =
        glyph("Fuel") {
            moveTo(3f, 21f)
            lineTo(14f, 21f)
            moveTo(4f, 21f)
            lineTo(4f, 5f)
            lineTo(6f, 3f)
            lineTo(11f, 3f)
            lineTo(13f, 5f)
            lineTo(13f, 21f)
            moveTo(4f, 11f)
            lineTo(13f, 11f)
            moveTo(13f, 7f)
            lineTo(16f, 7f)
            lineTo(16f, 13f)
            lineTo(19f, 13f)
            lineTo(19f, 8f)
            lineTo(17f, 6f)
        }

    /** lucide `Zap` — the lightning bolt (manual "Poll Now"). */
    val Zap: ImageVector =
        glyph("Zap") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            lineTo(13f, 2f)
        }

    /** lucide `Play` — the right-pointing run triangle (auto-poll running). */
    val Play: ImageVector =
        glyph("Play") {
            moveTo(8f, 5f)
            lineTo(8f, 19f)
            lineTo(19f, 12f)
            lineTo(8f, 5f)
        }

    /** lucide `Pause` — the two-bar stop glyph (auto-poll stopped). */
    val Pause: ImageVector =
        glyph("Pause") {
            moveTo(9f, 5f)
            lineTo(9f, 19f)
            moveTo(15f, 5f)
            lineTo(15f, 19f)
        }
}

/** Builds a standard 24×24 round-capped stroked [ImageVector] from a single [PathBuilder] program. */
private fun glyph(
    name: String,
    pathBuilder: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = pathBuilder,
            )
        }.build()

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
