package io.teslasync.android.sharedsurfaces.installprompt

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests [InstallPromptViewModel] against the install-path + sticky-dismissal seam — covering the contract the view
 * depends on, the native mirror of the web component's local-state behaviour
 * (web/src/components/feedback/InstallPrompt.tsx): the surface resolves to Active only when an install path exists AND
 * the app is not already installed AND the prompt was not dismissed within the window; [InstallPromptViewModel.install]
 * hides on the launcher accepting the pin (web "hide on accepted") and stays put when it rejects;
 * [InstallPromptViewModel.dismiss] persists the timestamp and collapses the surface (and a re-open stays hidden); and
 * the one-shot `view.opened` fires exactly once with the surface slug. Runs in :app:testReleaseUnitTest.
 */
class InstallPromptViewModelTest {
    private companion object {
        const val NOW: Long = 1_700_000_000_000L
        const val DAY_MS: Long = 86_400_000L
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private fun model(
        source: InstallPromptSource,
        logger: Logger = RecordingLogger(),
    ): InstallPromptViewModel = InstallPromptViewModel(source, logger, clock = { NOW })

    @Test
    fun surfaceIsActiveWhenSupportedNotInstalledAndNotDismissed() {
        val vm = model(installPromptSource())
        assertEquals(InstallPromptSurface.Active, vm.surface.value)
    }

    @Test
    fun surfaceIsHiddenWhenInstallIsNotSupported() {
        val vm = model(installPromptSource(installSupported = false))
        assertEquals(InstallPromptSurface.Hidden, vm.surface.value)
    }

    @Test
    fun surfaceIsHiddenWhenAlreadyInstalled() {
        // Web `isStandaloneMode()` → the prompt never appears.
        val vm = model(installPromptSource(alreadyInstalled = true))
        assertEquals(InstallPromptSurface.Hidden, vm.surface.value)
    }

    @Test
    fun surfaceIsHiddenWhenDismissedWithinTheWindow() {
        // Web "stays hidden for DISMISS_DAYS after a dismissal".
        val vm = model(installPromptSource(dismissedAtMs = NOW - DAY_MS))
        assertEquals(InstallPromptSurface.Hidden, vm.surface.value)
    }

    @Test
    fun promptReappearsOnceTheDismissalWindowExpires() {
        // Web "reappears after the sticky window lapses".
        val vm = model(installPromptSource(dismissedAtMs = NOW - 15L * DAY_MS))
        assertEquals(InstallPromptSurface.Active, vm.surface.value)
    }

    @Test
    fun installHidesThePromptWhenTheLauncherAcceptsTheRequest() {
        // Web `handleInstall` hides on `outcome === 'accepted'`.
        val vm = model(installPromptSource(installLaunches = true))
        assertEquals(InstallPromptSurface.Active, vm.surface.value)

        vm.install()

        assertEquals(InstallPromptSurface.Hidden, vm.surface.value)
    }

    @Test
    fun installLeavesThePromptWhenTheLauncherRejectsTheRequest() {
        // Web keeps the prompt mounted when the install flow does not complete.
        val vm = model(installPromptSource(installLaunches = false))

        vm.install()

        assertEquals(InstallPromptSurface.Active, vm.surface.value)
    }

    @Test
    fun dismissPersistsTheTimestampAndHidesThePrompt() {
        // Web "surfaces a dismiss control that hides the prompt and persists the choice".
        val source = installPromptSource()
        val vm = model(source)
        assertEquals(InstallPromptSurface.Active, vm.surface.value)
        assertNull(source.dismissedAtMs())

        vm.dismiss()

        assertEquals(InstallPromptSurface.Hidden, vm.surface.value)
        assertNotNull("the dismissal is persisted to the store", source.dismissedAtMs())
        assertEquals(NOW, source.dismissedAtMs())

        // A fresh holder over the same (now-dismissed) store stays hidden within the window.
        val remounted = model(source)
        assertEquals(InstallPromptSurface.Hidden, remounted.surface.value)
    }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() {
        val logger = RecordingLogger()
        val vm = model(installPromptSource(), logger)

        vm.recordViewOpened()
        vm.recordViewOpened()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals("InstallPrompt", opened.first().fields["surface"])
        assertTrue("diagnostics carry only the surface slug", opened.first().fields.keys == setOf("surface"))
    }
}
