// UI-thread-free state holder backing the InstallPrompt surface — the native port of the local state the web
// component owns (web/src/components/feedback/InstallPrompt.tsx: the `useState(visible)` mount-time gate, the
// `handleInstall` → `deferredPrompt.prompt()` action, and the `handleDismiss` → sticky-localStorage write). It binds
// the synchronous [InstallPromptSource] (P1/S8) once at construction — the install path + already-installed + sticky
// flag cannot change inside a session, exactly like the web mount-time probe — exposes the resolved
// [InstallPromptSurface] as a lifecycle-aware flow the composable renders, owns the [install] and [dismiss] actions,
// and emits the one-shot PII-safe `view.opened` diagnostic (P1/S11). The view never performs HTTP — it only collects
// [surface] and calls [install] / [dismiss].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/InstallPrompt) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.installprompt

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * State holder backing the Compose `InstallPrompt` — the native port of the web component's local state.
 *
 * It binds the injected [source] (the P1/S8 boundary) once: the install path, the already-installed probe and the
 * sticky-dismissal timestamp are synchronous and cannot change inside a session (mirroring the web mount-time gate),
 * so the surface is classified at construction and the only things that mutate afterwards are the user's [install] and
 * [dismiss] actions. The resolved [InstallPromptSurface] is exposed as a lifecycle-aware [surface] flow so the
 * composable reflects it without owning any state itself, and [recordViewOpened] emits the P1/S11 `view.opened` event
 * exactly once per surface open.
 *
 * @param source the install-path + sticky-dismissal seam (a `ShortcutManagerCompat`/`SharedPreferences` adapter in
 *   production, a fake in tests). The view-model owns no platform I/O — it only projects the probes + persists the
 *   dismissal.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event.
 * @param clock the wall-clock source (epoch millis), injected so the dismissal window is deterministic off-device.
 */
class InstallPromptViewModel(
    private val source: InstallPromptSource,
    private val logger: Logger,
    private val clock: () -> Long = System::currentTimeMillis,
) : ViewModel() {
    private val state =
        MutableStateFlow(
            classifyInstallPrompt(
                installSupported = source.isInstallSupported(),
                alreadyInstalled = source.isAlreadyInstalled(),
                dismissedRecently = wasDismissedRecently(source.dismissedAtMs(), clock()),
            ),
        )
    private var viewOpenedRecorded = false

    /**
     * The resolved prompt surface as a lifecycle-aware flow: [InstallPromptSurface.Hidden] when the app is already
     * installed OR the prompt was dismissed within the window OR no install path exists, else
     * [InstallPromptSurface.Active]. Seeded synchronously at construction (the web mount-time render), so the first
     * frame is never an artificial blank.
     */
    val surface: StateFlow<InstallPromptSurface> = state.asStateFlow()

    /**
     * Requests the pin-shortcut install (web `handleInstall` → `deferredPrompt.prompt()`). When the launcher accepts
     * the request the prompt has served its purpose and collapses to [InstallPromptSurface.Hidden] — the web "hide on
     * accepted" — leaving no sticky dismissal so a later genuine need can re-offer it. If the launcher rejects the
     * request the surface stays as-is.
     */
    fun install() {
        if (source.requestInstall()) {
            state.value = InstallPromptSurface.Hidden
        }
    }

    /**
     * Persists the sticky dismissal at the current instant (web `handleDismiss` → localStorage write) and collapses
     * the surface to [InstallPromptSurface.Hidden]. Because the choice is persisted by [source], a later re-open (a new
     * holder over the same store) re-reads it and stays hidden for the window — the web "stays hidden" contract.
     */
    fun dismiss() {
        source.markDismissed(clock())
        state.value = InstallPromptSurface.Hidden
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no install-path state nor device model, so a diagnostics line can never leak a device's capabilities. Call from
     * the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        InstallPromptDiagnostics.recordViewOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: InstallPromptSource,
            logger: Logger,
            clock: () -> Long = System::currentTimeMillis,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { InstallPromptViewModel(source, logger, clock) }
            }
    }
}
