package io.teslasync.android.featureviews.gaspricesettings

import io.teslasync.shared.core.presentation.settings.GasPriceStatus
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant
import java.util.Locale

/**
 * Off-device coverage of the [GasPriceSettings] data adapter (the prompt's "adapter unit test: cached →
 * projection") — the pure derivations the composable renders: the currency/fuel-unit preference read from the
 * raw `/settings` document (web `useFormatting` + `gasUnitLabel`), the money formatter (web `formatCurrency`),
 * the poll-interval classification (web `<Select>` value + `|| '7d'`), the last-poll parse (web zero-time
 * guard), and the render-ready [GasPriceSettingsSnapshot]. Locale is pinned to [Locale.US] for determinism.
 */
class GasPriceSettingsModelTest {
    // ── GasDisplayPrefs.from ──────────────────────────────────────────────────────

    @Test
    fun prefsDefaultWhenSettingsNull() {
        assertEquals(GasDisplayPrefs.DEFAULT, GasDisplayPrefs.from(null))
    }

    @Test
    fun prefsDefaultWhenNotAnObject() {
        assertEquals(GasDisplayPrefs.DEFAULT, GasDisplayPrefs.from(JsonPrimitive("nope")))
    }

    @Test
    fun prefsReadEverySupportedField() {
        val prefs =
            GasDisplayPrefs.from(
                buildJsonObject {
                    put("currency_symbol", "€")
                    put("decimal_precision", 3)
                    put("gas_unit", "liter")
                },
            )
        assertEquals("€", prefs.currencySymbol)
        assertEquals(3, prefs.resolvedPrecision)
        assertEquals("L", prefs.gasUnitLabel)
    }

    @Test
    fun prefsBlankCurrencyFallsBackToDollar() {
        val prefs = GasDisplayPrefs.from(buildJsonObject { put("currency_symbol", "  ") })
        assertEquals("$", prefs.currencySymbol)
    }

    @Test
    fun prefsNullCurrencyPrimitiveFallsBackToDollar() {
        val prefs = GasDisplayPrefs.from(buildJsonObject { put("currency_symbol", JsonNull) })
        assertEquals("$", prefs.currencySymbol)
    }

    @Test
    fun prefsNegativePrecisionFlooredAtZero() {
        val prefs = GasDisplayPrefs.from(buildJsonObject { put("decimal_precision", -4) })
        assertEquals(0, prefs.resolvedPrecision)
    }

    @Test
    fun prefsMissingPrecisionDefaultsToTwo() {
        val prefs = GasDisplayPrefs.from(buildJsonObject { put("currency_symbol", "$") })
        assertEquals(2, prefs.resolvedPrecision)
    }

    @Test
    fun prefsNonLiterUnitUsesGallonLabel() {
        val prefs = GasDisplayPrefs.from(buildJsonObject { put("gas_unit", "gallon") })
        assertEquals("gal", prefs.gasUnitLabel)
        assertEquals("gal", GasDisplayPrefs.DEFAULT.gasUnitLabel)
    }

    // ── formatCurrency ────────────────────────────────────────────────────────────

    @Test
    fun formatCurrencyPrefixesSymbolWithGroupedFixedPrecision() {
        val prefs = GasDisplayPrefs(currencySymbol = "$", decimalPrecision = 2)
        assertEquals("$1,234.50", formatCurrency(1234.5, prefs, Locale.US))
    }

    @Test
    fun formatCurrencyHonoursZeroAndCustomSymbol() {
        assertEquals("$3", formatCurrency(3.0, GasDisplayPrefs(currencySymbol = "$", decimalPrecision = 0), Locale.US))
        assertEquals("€3.000", formatCurrency(3.0, GasDisplayPrefs(currencySymbol = "€", decimalPrecision = 3), Locale.US))
    }

    // ── PollInterval ──────────────────────────────────────────────────────────────

    @Test
    fun pollIntervalClassifiesEveryWireValue() {
        assertEquals(PollInterval.Daily, PollInterval.from("daily"))
        assertEquals(PollInterval.Weekly, PollInterval.from("7d"))
        assertEquals(PollInterval.BiWeekly, PollInterval.from("15d"))
        assertEquals(PollInterval.Monthly, PollInterval.from("30d"))
    }

    @Test
    fun pollIntervalDefaultsToWeeklyForBlankOrUnknown() {
        assertEquals(PollInterval.Weekly, PollInterval.from(""))
        assertEquals(PollInterval.Weekly, PollInterval.from(null))
        assertEquals(PollInterval.Weekly, PollInterval.from("annual"))
    }

    @Test
    fun pollIntervalPreservesWebOptionOrder() {
        assertEquals(
            listOf(PollInterval.Daily, PollInterval.Weekly, PollInterval.BiWeekly, PollInterval.Monthly),
            PollInterval.ordered,
        )
    }

    // ── LastPolled.parse ──────────────────────────────────────────────────────────

    @Test
    fun lastPolledNeverForBlankOrSentinel() {
        assertEquals(LastPolled.Never, LastPolled.parse(null))
        assertEquals(LastPolled.Never, LastPolled.parse(""))
        assertEquals(LastPolled.Never, LastPolled.parse("   "))
        assertEquals(LastPolled.Never, LastPolled.parse(LastPolled.ZERO_SENTINEL))
    }

    @Test
    fun lastPolledAtForValidInstant() {
        val raw = "2026-04-04T02:30:00Z"
        val expected = Instant.parse(raw).toEpochMilli()
        assertEquals(LastPolled.At(expected), LastPolled.parse(raw))
    }

    @Test
    fun lastPolledInvalidForUnparseableNonSentinel() {
        assertEquals(LastPolled.Invalid, LastPolled.parse("not-a-date"))
    }

    // ── GasPriceSettingsSnapshot.from ─────────────────────────────────────────────

    @Test
    fun snapshotProjectsRunningStatusWithFormattedPrice() {
        val status =
            GasPriceStatus(
                enabled = true,
                pollInterval = "15d",
                lastPollTime = "2026-04-04T02:30:00Z",
                currentPrice = 3.49,
                currentPriceKwhEq = 0.0,
            )
        val snapshot = GasPriceSettingsSnapshot.from(status, GasDisplayPrefs(currencySymbol = "$", decimalPrecision = 2), Locale.US)
        assertEquals(true, snapshot.running)
        assertEquals(PollInterval.BiWeekly, snapshot.interval)
        assertEquals("$3.49/gal", snapshot.priceText)
        assertEquals(LastPolled.At(Instant.parse("2026-04-04T02:30:00Z").toEpochMilli()), snapshot.lastPolled)
    }

    @Test
    fun snapshotPriceTextNullWhenNoPriceYet() {
        val status =
            GasPriceStatus(
                enabled = false,
                pollInterval = "",
                lastPollTime = LastPolled.ZERO_SENTINEL,
                currentPrice = 0.0,
                currentPriceKwhEq = 0.0,
            )
        val snapshot = GasPriceSettingsSnapshot.from(status, GasDisplayPrefs.DEFAULT, Locale.US)
        assertEquals(false, snapshot.running)
        assertEquals(PollInterval.Weekly, snapshot.interval)
        assertNull(snapshot.priceText)
        assertEquals(LastPolled.Never, snapshot.lastPolled)
    }

    @Test
    fun snapshotPriceUsesLiterSuffixWhenConfigured() {
        val status =
            GasPriceStatus(
                enabled = true,
                pollInterval = "daily",
                lastPollTime = LastPolled.ZERO_SENTINEL,
                currentPrice = 1.8,
                currentPriceKwhEq = 0.0,
            )
        val snapshot = GasPriceSettingsSnapshot.from(status, GasDisplayPrefs(gasUnit = "liter"), Locale.US)
        assertEquals("$1.80/L", snapshot.priceText)
    }
}
