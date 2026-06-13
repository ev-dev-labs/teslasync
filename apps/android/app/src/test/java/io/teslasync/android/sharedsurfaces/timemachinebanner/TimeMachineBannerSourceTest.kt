// Off-device verification of the TimeMachineBanner data adapter — the [AsOfDateHolder] behind the app-global
// [AsOfDateStore] and the [TimeMachineBannerSource] seam. This is the native analogue of the web `useAsOfDate`
// holder (web/src/components/feedback/TimeMachineBanner.tsx → useAsOfDate): a well-formed RFC 3339 value is stored
// and projected onto the PII-free snapshot, a blank/null value returns to live, and a malformed value is refused
// (the wire never receives a non-RFC-3339 string) — exactly the web hook's write rules. Runs in the
// :android:testReleaseUnitTest gate.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.timemachinebanner

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TimeMachineBannerSourceTest {
    private val sampleIso = "2024-11-12T14:30:00Z"

    @Test
    fun setStoresAndProjectsAWellFormedInstant() =
        runTest {
            val holder = AsOfDateHolder()
            holder.set(sampleIso)
            assertEquals(sampleIso, holder.snapshots().first().asOf)
        }

    @Test
    fun setNullOrBlankReturnsToLive() =
        runTest {
            val holder = AsOfDateHolder()
            holder.set(sampleIso)
            holder.set(null)
            assertNull("a null write returns to live", holder.snapshots().first().asOf)

            holder.set(sampleIso)
            holder.set("")
            assertNull("a blank write returns to live", holder.snapshots().first().asOf)
        }

    @Test
    fun setRefusesAMalformedValue() =
        runTest {
            val holder = AsOfDateHolder()
            holder.set(sampleIso)
            holder.set("not-a-real-instant")
            assertEquals("a malformed write is refused; the prior anchor stands", sampleIso, holder.snapshots().first().asOf)
        }

    @Test
    fun clearReturnsToLive() =
        runTest {
            val holder = AsOfDateHolder()
            holder.set(sampleIso)
            holder.clear()
            assertNull(holder.snapshots().first().asOf)
        }

    @Test
    fun sourceAdapterForwardsToTheHolder() =
        runTest {
            val holder = AsOfDateHolder()
            val source = holder.source()
            source.setAsOf(sampleIso)
            assertEquals(sampleIso, source.asOf().first().asOf)
            source.clear()
            assertNull(source.asOf().first().asOf)
        }

    @Test
    fun fakeSourceForwardsWritesToItsCallbacks() {
        var written: String? = "unset"
        var cleared = false
        val source =
            timeMachineBannerSource(
                onSetAsOf = { written = it },
                onClear = { cleared = true },
            ) { flowOf(TimeMachineBannerSnapshot.live()) }

        source.setAsOf(sampleIso)
        source.clear()

        assertEquals(sampleIso, written)
        assertTrue(cleared)
    }
}
