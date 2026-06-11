// Off-device unit coverage for the Byte Size Converter feature view's pure model (P3 acceptance: adapter +
// per-state + a11y label tests). Exercises the conversion projection (the web `useMemo` analogue), the
// locale-aware number formatter (`fmtNumber`), the top-level lifecycle classifier the composable switches on
// (per-state coverage), the accessibility content-description fold (a11y label coverage), and the
// `t(key, default)` resolver. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.bytesizeconverter

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class ByteSizeConverterModelTest {
    /** Deterministic, locale-fixed fixed-decimal formatter standing in for the live `fmtNumber`. */
    private val fixed: (Double, Int) -> String = { value, digits -> "%.${digits}f".format(Locale.US, value) }

    @Test
    fun byteUnitsMatchWebLadder() {
        assertEquals(listOf("B", "KB", "MB", "GB", "TB"), BYTE_UNITS)
    }

    @Test
    fun parseValueExtractsLeadingNumberLikeParseFloat() {
        assertEquals(1024.0, ByteSizeConverterProjection.parseValue("1024")!!, 0.0)
        assertEquals(12.0, ByteSizeConverterProjection.parseValue("12abc")!!, 0.0)
        assertEquals(3.5, ByteSizeConverterProjection.parseValue("  3.5 ")!!, 0.0)
        assertEquals(1000.0, ByteSizeConverterProjection.parseValue("1e3")!!, 0.0)
        assertEquals(0.5, ByteSizeConverterProjection.parseValue(".5")!!, 0.0)
    }

    @Test
    fun parseValueRejectsBlankAndNonNumeric() {
        assertNull(ByteSizeConverterProjection.parseValue(""))
        assertNull(ByteSizeConverterProjection.parseValue("   "))
        assertNull(ByteSizeConverterProjection.parseValue("abc"))
    }

    @Test
    fun projectReturnsNullForInvalidValue() {
        assertNull(ByteSizeConverterProjection.project("abc", "B", fixed))
    }

    @Test
    fun projectReturnsNullForUnknownUnit() {
        assertNull(ByteSizeConverterProjection.project("10", "PB", fixed))
    }

    @Test
    fun projectConvertsAcrossAllUnitsWithWebPrecision() {
        val result = ByteSizeConverterProjection.project("1024", "B", fixed)!!
        assertEquals(5, result.size)
        assertEquals(ByteConversion("B", "1024", selected = true), result[0])
        assertEquals(ByteConversion("KB", "1.0000", selected = false), result[1])
        assertEquals(ByteConversion("MB", "0.0010", selected = false), result[2])
        assertEquals("0.0000", result[3].value)
        assertEquals("0.0000", result[4].value)
    }

    @Test
    fun projectMarksOnlyTheSelectedUnit() {
        val result = ByteSizeConverterProjection.project("5", "MB", fixed)!!
        assertEquals("5242880", result[0].value)
        assertEquals("5120.0000", result[1].value)
        assertEquals(ByteConversion("MB", "5.0000", selected = true), result[2])
        assertEquals(1, result.count { it.selected })
        assertEquals("MB", result.single { it.selected }.unit)
    }

    @Test
    fun localizedNumberFormatterGroupsAndFixesFractionDigits() {
        val format = localizedNumberFormatter(Locale.US)
        assertEquals("1,048,576", format(1_048_576.0, BASE_UNIT_FRACTION_DIGITS))
        assertEquals("1.5000", format(1.5, SCALED_UNIT_FRACTION_DIGITS))
    }

    @Test
    fun localizedNumberFormatterCoercesNonFiniteToZero() {
        val format = localizedNumberFormatter(Locale.US)
        assertEquals("0", format(Double.POSITIVE_INFINITY, BASE_UNIT_FRACTION_DIGITS))
        assertEquals("0.00", format(Double.NaN, 2))
    }

    @Test
    fun byteSizeSurfaceForMapsLifecycleFlags() {
        assertEquals(ByteSizeSurfaceState.Loading, byteSizeSurfaceFor(isLoading = true, isError = false))
        assertEquals(ByteSizeSurfaceState.Error, byteSizeSurfaceFor(isLoading = false, isError = true))
        assertEquals(ByteSizeSurfaceState.Loading, byteSizeSurfaceFor(isLoading = true, isError = true))
        assertEquals(ByteSizeSurfaceState.Ready, byteSizeSurfaceFor(isLoading = false, isError = false))
    }

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(ByteSizeSurfaceState.Loading, surfaceFor(UiState.loading<Unit>()))
        assertEquals(ByteSizeSurfaceState.Error, surfaceFor(UiState<Unit>(UiPhase.Error, errorKind = ErrorKind.Network)))
        assertEquals(ByteSizeSurfaceState.Ready, surfaceFor(UiState<Unit>(UiPhase.Content, data = Unit)))
        assertEquals(ByteSizeSurfaceState.Ready, surfaceFor(UiState<Unit>(UiPhase.Empty, data = Unit)))
        val offline = UiState<Unit>(UiPhase.Content, data = Unit, stale = true, errorKind = ErrorKind.Network)
        assertEquals(ByteSizeSurfaceState.Ready, surfaceFor(offline))
        assertTrue(offline.isOffline)
    }

    @Test
    fun conversionCellDescriptionFoldsUnitAndValue() {
        val description =
            ByteSizeConverterProjection.conversionCellDescription(
                ByteConversion("KB", "1.0000", selected = false),
            )
        assertEquals("KB, 1.0000", description)
    }

    @Test
    fun resolveOptionalReturnsLookupWhenPresent() {
        val lookup: (String) -> String? = mapOf(KEY_TITLE to "Octets")::get
        assertEquals("Octets", resolveOptional(lookup, KEY_TITLE, ByteSizeConverterDefaults.TITLE))
    }

    @Test
    fun resolveOptionalFallsBackWhenAbsentOrBlank() {
        assertEquals(ByteSizeConverterDefaults.TITLE, resolveOptional({ null }, KEY_TITLE, ByteSizeConverterDefaults.TITLE))
        assertEquals(ByteSizeConverterDefaults.DESCRIPTION, resolveOptional({ "" }, KEY_DESCRIPTION, ByteSizeConverterDefaults.DESCRIPTION))
    }

    @Test
    fun defaultsAndKeysMirrorWebSource() {
        assertEquals("Byte Size", ByteSizeConverterDefaults.TITLE)
        assertEquals("Byte Size Desc", ByteSizeConverterDefaults.DESCRIPTION)
        assertEquals("translation_Byte_Size", KEY_TITLE)
        assertEquals("translation_Byte_Size_Desc", KEY_DESCRIPTION)
        assertEquals("ByteSizeConverter", ByteSizeConverterRegistration.SLUG)
        assertFalse(ByteSizeConverterDefaults.EMPTY_HINT.isBlank())
    }

    /** Bridges a [UiState] to the composable's classifier the same way `ByteSizeConverterContent` does. */
    private fun surfaceFor(state: UiState<*>): ByteSizeSurfaceState =
        byteSizeSurfaceFor(isLoading = state.isLoading, isError = state.isError)
}
