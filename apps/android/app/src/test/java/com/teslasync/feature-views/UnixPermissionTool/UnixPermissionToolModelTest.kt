// Off-device unit coverage for the Unix Permission tool feature view's pure model (P3 acceptance: adapter +
// per-state + a11y label tests). Exercises the octal→symbolic projection (the web `useMemo` analogue), the
// preset-label ladder, the top-level lifecycle classifier the composable switches on (per-state coverage), the
// accessibility content-description fold (a11y label coverage), and the `t(key, default)` resolver. No Compose
// / Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.unixpermissiontool

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UnixPermissionToolModelTest {
    @Test
    fun permsMatchWebMap() {
        assertEquals("rwx", PERMS["7"])
        assertEquals("rw-", PERMS["6"])
        assertEquals("r-x", PERMS["5"])
        assertEquals("r--", PERMS["4"])
        assertEquals("-wx", PERMS["3"])
        assertEquals("-w-", PERMS["2"])
        assertEquals("--x", PERMS["1"])
        assertEquals("---", PERMS["0"])
        assertEquals(8, PERMS.size)
    }

    @Test
    fun defaultOctalMatchesWebInitialState() {
        assertEquals("755", DEFAULT_OCTAL)
    }

    @Test
    fun symbolicForConvertsDefaultWithTriadSlices() {
        val symbolic = UnixPermissionToolProjection.symbolicFor("755")!!
        assertEquals("rwxr-xr-x", symbolic.full)
        assertEquals("rwx", symbolic.owner)
        assertEquals("r-x", symbolic.group)
        assertEquals("r-x", symbolic.other)
    }

    @Test
    fun symbolicForConvertsRepresentativeModes() {
        assertEquals("rw-r--r--", UnixPermissionToolProjection.symbolicFor("644")!!.full)
        assertEquals("rwx------", UnixPermissionToolProjection.symbolicFor("700")!!.full)
        assertEquals("rw-------", UnixPermissionToolProjection.symbolicFor("600")!!.full)
        assertEquals("rwxrwxrwx", UnixPermissionToolProjection.symbolicFor("777")!!.full)
        assertEquals("r--r--r--", UnixPermissionToolProjection.symbolicFor("444")!!.full)
        assertEquals("---------", UnixPermissionToolProjection.symbolicFor("000")!!.full)
    }

    @Test
    fun symbolicForRejectsWrongLength() {
        assertNull(UnixPermissionToolProjection.symbolicFor(""))
        assertNull(UnixPermissionToolProjection.symbolicFor("7"))
        assertNull(UnixPermissionToolProjection.symbolicFor("75"))
        assertNull(UnixPermissionToolProjection.symbolicFor("7555"))
    }

    @Test
    fun symbolicForRejectsNonOctalDigits() {
        assertNull(UnixPermissionToolProjection.symbolicFor("789"))
        assertNull(UnixPermissionToolProjection.symbolicFor("8"))
        assertNull(UnixPermissionToolProjection.symbolicFor("abc"))
        assertNull(UnixPermissionToolProjection.symbolicFor("75x"))
        assertNull(UnixPermissionToolProjection.symbolicFor("7 5"))
    }

    @Test
    fun presetLabelMatchesWebFormat() {
        assertEquals("755 (rwxr-xr-x)", UnixPermissionToolProjection.presetLabel("755"))
        assertEquals("644 (rw-r--r--)", UnixPermissionToolProjection.presetLabel("644"))
        assertEquals("777 (rwxrwxrwx)", UnixPermissionToolProjection.presetLabel("777"))
    }

    @Test
    fun presetLabelFallsBackToBareValueWhenInvalid() {
        assertEquals("999", UnixPermissionToolProjection.presetLabel("999"))
    }

    @Test
    fun presetOptionsCoverWebLadderInOrder() {
        val options = UnixPermissionToolProjection.presetOptions()
        assertEquals(listOf("755", "644", "700", "600", "777", "444"), options.map { it.value })
        assertEquals(
            listOf(
                "755 (rwxr-xr-x)",
                "644 (rw-r--r--)",
                "700 (rwx------)",
                "600 (rw-------)",
                "777 (rwxrwxrwx)",
                "444 (r--r--r--)",
            ),
            options.map { it.label },
        )
    }

    @Test
    fun unixPermSurfaceForMapsLifecycleFlags() {
        assertEquals(UnixPermSurfaceState.Loading, unixPermSurfaceFor(isLoading = true, isError = false))
        assertEquals(UnixPermSurfaceState.Error, unixPermSurfaceFor(isLoading = false, isError = true))
        assertEquals(UnixPermSurfaceState.Loading, unixPermSurfaceFor(isLoading = true, isError = true))
        assertEquals(UnixPermSurfaceState.Ready, unixPermSurfaceFor(isLoading = false, isError = false))
    }

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(UnixPermSurfaceState.Loading, surfaceFor(UiState.loading<Unit>()))
        val error = UiState<Unit>(UiPhase.Error, errorKind = ErrorKind.Network)
        assertEquals(UnixPermSurfaceState.Error, surfaceFor(error))
        assertEquals(UnixPermSurfaceState.Ready, surfaceFor(UiState<Unit>(UiPhase.Content, data = Unit)))
        assertEquals(UnixPermSurfaceState.Ready, surfaceFor(UiState<Unit>(UiPhase.Empty, data = Unit)))
        val offline = UiState<Unit>(UiPhase.Content, data = Unit, stale = true, errorKind = ErrorKind.Network)
        assertEquals(UnixPermSurfaceState.Ready, surfaceFor(offline))
        assertTrue(offline.isOffline)
    }

    @Test
    fun classCellDescriptionFoldsLabelAndValue() {
        assertEquals("Owner, rwx", UnixPermissionToolProjection.classCellDescription("Owner", "rwx"))
        assertEquals("Group, r-x", UnixPermissionToolProjection.classCellDescription("Group", "r-x"))
        assertEquals("Other, r-x", UnixPermissionToolProjection.classCellDescription("Other", "r-x"))
    }

    @Test
    fun resolveOptionalReturnsLookupWhenPresent() {
        val lookup: (String) -> String? = mapOf(KEY_TITLE to "Permissions")::get
        assertEquals("Permissions", resolveOptional(lookup, KEY_TITLE, UnixPermissionToolDefaults.TITLE))
    }

    @Test
    fun resolveOptionalFallsBackWhenAbsentOrBlank() {
        assertEquals(
            UnixPermissionToolDefaults.TITLE,
            resolveOptional({ null }, KEY_TITLE, UnixPermissionToolDefaults.TITLE),
        )
        assertEquals(
            UnixPermissionToolDefaults.OCTAL_LABEL,
            resolveOptional({ "" }, KEY_OCTAL_LABEL, UnixPermissionToolDefaults.OCTAL_LABEL),
        )
    }

    @Test
    fun defaultsAndKeysMirrorWebSource() {
        assertEquals("Unix Perm", UnixPermissionToolDefaults.TITLE)
        assertEquals("Unix Perm Desc", UnixPermissionToolDefaults.DESCRIPTION)
        assertEquals("Octal Perm", UnixPermissionToolDefaults.OCTAL_LABEL)
        assertEquals("translation_Unix_Perm", KEY_TITLE)
        assertEquals("translation_Unix_Perm_Desc", KEY_DESCRIPTION)
        assertEquals("translation_Octal_Perm", KEY_OCTAL_LABEL)
        assertEquals("UnixPermissionTool", UnixPermissionToolRegistration.SLUG)
        assertFalse(UnixPermissionToolDefaults.EMPTY_HINT.isBlank())
    }

    /** Bridges a [UiState] to the composable's classifier the same way `UnixPermissionToolContent` does. */
    private fun surfaceFor(state: UiState<*>): UnixPermSurfaceState =
        unixPermSurfaceFor(isLoading = state.isLoading, isError = state.isError)
}
