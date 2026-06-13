// The native Jetpack Compose FormatterPrefsBridge shared surface — a parity port of
// web/src/components/FormatterPrefsBridge.tsx. Like the web component it is a HEADLESS, side-effect-only mount
// that draws NOTHING (the web `return null`): mounted once near the app root (inside the [LocalDataContainer]
// provider) it obtains its [FormatterPrefsBridgeViewModel] — which holds a permanent `/settings` subscriber,
// applies the resolved locale + decimal precision app-wide, and reacts to an out-of-band settings-changed
// signal — and records the one-shot `view.opened` diagnostic (P1/S11) on first composition. It binds NO HTTP
// itself (ADR-002).
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the web source has ZERO render branches — it
// never draws a spinner, error, empty, stale, or offline surface; it only runs effects and returns null. A
// headless coordinator that drew any chrome at the app root would be a parity violation (the sibling
// AchievementUnlockListener documents the same rule for its dormant branches). So every settings-document
// lifecycle state (loading / resolved / stale / offline / error) is carried as the freshness metadata on
// [FormatterPrefsBridgeViewModel.formatterPrefs] — observable by any consumer of the resolved prefs — while this
// mount itself emits no UI and therefore exposes no interactive elements to label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/FormatterPrefsBridge) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.formatterprefsbridge

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Mounts the headless formatter-preferences bridge. Place it once near the React-tree root equivalent (the app
 * shell), inside the [LocalDataContainer] provider, so it stays composed for the app's lifetime.
 *
 * It obtains its [FormatterPrefsBridgeViewModel] (keyed by the surface slug so a single bridge exists), fires the
 * one-shot `view.opened` diagnostic on first composition, and emits no UI — parity with the web component's
 * `return null`. Every formatter-prefs effect (the permanent settings subscriber, the guarded apply, the
 * settings-changed refetch) lives in the ViewModel; consumers read the resolved prefs from
 * [FormatterPrefsBridgeViewModel.formatterPrefs].
 *
 * @param source the `/settings` seam — the shared S8 SettingsStore adapter by default, or a fake in tests.
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 * @param instanceKey the ViewModel key; the surface slug by default (one bridge per app root).
 */
@Composable
fun FormatterPrefsBridge(
    source: FormatterPrefsBridgeSource = LocalDataContainer.current.settingsStore.asFormatterPrefsBridgeSource(),
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = FormatterPrefsBridgeRegistration.SLUG,
) {
    val viewModel: FormatterPrefsBridgeViewModel =
        viewModel(key = instanceKey, factory = FormatterPrefsBridgeViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    // No UI is emitted — parity with the web component's `return null`. The ViewModel owns every effect.
}
