// UI-thread-free state holder backing the Avatar shared surface — the native port of the identity binding the
// web component reads from its props (web/src/components/data-display/Avatar.tsx). It binds the
// [AvatarSource] seam (P1/S8), folds each emission into the immutable [AvatarIdentity] the render boundary
// projects, and exposes the PII-safe one-shot `view.opened` diagnostic. The view never performs HTTP — it
// only collects [state] and calls [onViewOpened].
//
// The avatar is presentational: its identity is caller-supplied and, apart from a live presence dot, has no
// async cache-then-network lifecycle, so there is nothing to load / error / stale / offline beyond what the
// streamed identity already expresses (the documented VisuallyHidden / AIChatbotIndicator rationale). The
// holder therefore stays a thin reducer over the seam (ADR-002) and owns no networking.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Avatar) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.avatar

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Lifecycle-aware state holder backing the Compose [Avatar] surface — the Android port of the web Avatar's
 * identity binding.
 *
 * It subscribes to the injected [AvatarSource] seam (the P1/S8 boundary) for its whole lifetime and folds
 * each emission into [state], so the render boundary can project the avatar (image / initials / glyph) and
 * its live presence dot. The identity is caller-supplied, so there is no further lifecycle to model (the same
 * documented rationale as the accepted VisuallyHidden sibling); the view stays a thin renderer. It owns no
 * networking.
 *
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostic exactly once per surface open.
 *
 * @param source the avatar-identity seam (a shared-S8-layer adapter in production, a fake in tests). The
 *   view-model owns no networking — it only reduces this port's emissions.
 * @param logger the single sanctioned redacting logger (ADR-016); receives the `view.opened` event carrying
 *   only the non-PII surface slug.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class AvatarViewModel(
    private val source: AvatarSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(AvatarIdentity())
    private var viewOpenedRecorded = false

    /** The live avatar identity the render boundary projects; the anonymous zero value until the seam emits. */
    val state: StateFlow<AvatarIdentity> = mutableState.asStateFlow()

    init {
        // Bind the identity seam for the holder's lifetime so a presence transition re-renders the dot.
        launch { source.identity().collect { identity -> mutableState.value = identity } }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no user id, name, or image URL, so a diagnostics line can never leak who the avatar
     * represents. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAvatarOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AvatarSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AvatarViewModel(source, logger) }
            }
    }
}
