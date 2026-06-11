package io.teslasync.android.shortcuts

import android.content.Context
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Instrumented test for [ShortcutPublisher] (P3/A8): publishing produces ranked dynamic launcher
 * shortcuts within the platform's per-activity cap, including the dashboard. The deep-link routing
 * itself is covered by the JVM-gate [AppShortcutsTest]; this needs a real [ShortcutManagerCompat], so
 * it runs on a device/emulator (connectedDebugAndroidTest).
 */
@RunWith(AndroidJUnit4::class)
class ShortcutPublisherInstrumentedTest {
    @Test
    fun publishesRankedDynamicShortcutsWithinTheCap() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        ShortcutPublisher(context).publish()

        val shortcuts = ShortcutManagerCompat.getDynamicShortcuts(context)
        val max = ShortcutManagerCompat.getMaxShortcutCountPerActivity(context)

        assertTrue("expected at least one published shortcut", shortcuts.isNotEmpty())
        if (max > 0) {
            assertTrue("published ${shortcuts.size} shortcuts, exceeding cap $max", shortcuts.size <= max)
        }
        assertTrue("dashboard shortcut should be published", shortcuts.any { it.id == "shortcut_dashboard" })
    }
}
