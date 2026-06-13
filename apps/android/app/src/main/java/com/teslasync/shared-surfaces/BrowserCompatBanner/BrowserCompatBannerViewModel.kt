// UI-thread-free state holder backing the BrowserCompatBanner surface — the native port of the local state the
// web component owns (web/src/components/feedback/BrowserCompatBanner.tsx: the `useState(detectMissingFeatures)`
// + `useState(isCompatWarningDismissed)` reads, and the `handleDismiss` → `dismissCompatWarning` write). It binds
// the synchronous [BrowserCompatSource] (P1/S8) once at construction — detection cannot change inside a session,
// exactly like the web mount-time probe — exposes the resolved [BrowserCompatSurface] as a lifecycle-aware flow
// the composable renders, owns the [dismiss] action that persists the sticky flag and collapses the surface to
// Hidden, and emits the one-shot PII-safe `view.opened` diagnostic (P1/S11). The view never performs HTTP — it
// only collects [surface] and calls [dismiss].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/BrowserCompatBanner) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.browsercompatbanner

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * State holder backing the Compose `BrowserCompatBanner` — the native port of the web component's local state.
 *
 * It binds the injected [source] (the P1/S8 boundary) once: [BrowserCompatSource.detectMissing] is a synchronous,
 * side-effect-free platform probe whose result cannot change inside a session (mirroring the web mount-time
 * detection), so the missing set is captured at construction and the only thing that mutates afterwards is the
 * dismissal — owned by [dismiss]. The resolved [BrowserCompatSurface] is exposed as a lifecycle-aware [surface]
 * flow so the composable reflects it without owning any state itself, and [recordViewOpened] emits the P1/S11
 * `view.opened` event exactly once per surface open.
 *
 * @param source the detection + sticky-dismissal seam (a `PackageManager`/`SharedPreferences` adapter in
 *   production, a fake in tests). The view-model owns no platform I/O — it only projects the probe + persists the
 *   dismissal.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event.
 */
class BrowserCompatBannerViewModel(
    private val source: BrowserCompatSource,
    private val logger: Logger,
) : ViewModel() {
    private val missing: List<RequiredCapability> = source.detectMissing()
    private val state = MutableStateFlow(classify(missing, source.isDismissed()))
    private var viewOpenedRecorded = false

    /**
     * The resolved banner surface as a lifecycle-aware flow: [BrowserCompatSurface.Hidden] when the host is
     * supported OR the warning was dismissed, else [BrowserCompatSurface.Active] carrying the missing
     * capabilities. Seeded synchronously at construction (the web mount-time render), so the first frame is never
     * an artificial blank.
     */
    val surface: StateFlow<BrowserCompatSurface> = state.asStateFlow()

    /**
     * Persists the sticky dismissal (web `handleDismiss` → `dismissCompatWarning`) and collapses the surface to
     * [BrowserCompatSurface.Hidden]. Because the choice is persisted by [source], a later re-open (a new holder
     * over the same store) re-reads it and stays hidden — the web "stays hidden across remounts" contract.
     */
    fun dismiss() {
        source.setDismissed()
        state.value = classify(missing, dismissed = true)
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no capability list nor device model, so a diagnostics line can never leak a device's gaps. Call
     * from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        BrowserCompatBannerDiagnostics.recordViewOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: BrowserCompatSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { BrowserCompatBannerViewModel(source, logger) }
            }
    }
}
