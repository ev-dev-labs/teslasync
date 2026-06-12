// The native Jetpack Compose + Material 3 NoVehicleSelected feature view — a parity port of
// web/src/features/onboarding/components/NoVehicleSelected.tsx. The web component is a defensive empty
// state: given a localized `pageTitle` (and optional `title` / `description` overrides) it renders a
// PageContainer → GlassPanel → EmptyState with a Car icon, the localized "No vehicle selected" title +
// description, and a "Set up TeslaSync" CTA that `navigate('/onboarding')`. This port reproduces that
// composition, data, and i18n exactly, in native primitives (no ported Tailwind classes — platform
// tokens from P1/S9).
//
// Like the sibling LegacyAlertRulesRedirect port, the surface never touches the NavController: it emits
// the onboarding intent through [onSetUp] and the host navigates. Its genuine web hooks are
// `useTranslation` (→ `stringResource` over the P1/S10 catalog) and `useNavigate` (→ [onSetUp] +
// [NoVehicleSelectedNavigation]); `useSelectedVehicle` is the contextual host guard, modeled as the pure
// [shouldRender] projection in the model rather than re-read here (web parity — the component never
// reads it itself).
//
// The pure render branching, i18n keys, the surface-state classifier, the accessibility fold, and the
// `view.opened` diagnostic all live in NoVehicleSelectedModel.kt and are unit-tested off-device, so this
// file stays a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/feature-views/NoVehicleSelected — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package, so the package intentionally diverges from the path, as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.novehicleselected

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point for the NoVehicleSelected surface. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders the defensive empty state. The surface never touches the NavController
 * — it emits the onboarding intent through [onSetUp] (web `navigate('/onboarding')`) and the host
 * navigates to [NoVehicleSelectedNavigation.ONBOARDING_DESTINATION_ID].
 *
 * @param pageTitle localized page title, rendered above the panel (web `PageContainer title=`).
 * @param onSetUp invoked when the "Set up TeslaSync" CTA is tapped; the host performs the navigation.
 * @param title optional empty-state title override (web `title ?? t(...)`).
 * @param description optional empty-state description override (web `description ?? t(...)`).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun NoVehicleSelected(
    pageTitle: String,
    onSetUp: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    description: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordNoVehicleSelectedOpened(logger) }
    NoVehicleSelectedContent(
        pageTitle = pageTitle,
        onSetUp = onSetUp,
        modifier = modifier,
        title = title,
        description = description,
    )
}

/**
 * Stateless renderer — the preview / UI-test entry point. Renders [pageTitle] above the surface body and
 * switches on [surfaceState]: [NoVehicleSelectedSurfaceState.Empty] (the default, web parity) draws the
 * empty state with its CTA; [NoVehicleSelectedSurfaceState.Loading] and [NoVehicleSelectedSurfaceState.Error]
 * draw the shared lifecycle chrome a host may supply (never faked from a fetch this surface does not
 * perform). The loading affordance honors [reduceMotion] (P1 a11y): an animated [Spinner] normally, a
 * static labeled row when motion is reduced.
 */
@Composable
fun NoVehicleSelectedContent(
    pageTitle: String,
    onSetUp: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    description: String? = null,
    surfaceState: NoVehicleSelectedSurfaceState = NoVehicleSelectedSurfaceState.Empty,
    onRetry: () -> Unit = {},
    reduceMotion: Boolean = rememberReducedMotion(),
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageTitle(pageTitle)
        when (surfaceState) {
            NoVehicleSelectedSurfaceState.Loading -> NoVehicleSelectedLoading(reduceMotion)
            NoVehicleSelectedSurfaceState.Error -> NoVehicleSelectedError(onRetry)
            NoVehicleSelectedSurfaceState.Empty -> NoVehicleSelectedEmpty(title, description, onSetUp)
        }
    }
}

/**
 * The empty presentation — the faithful native render of the web `EmptyState`: a Car glyph, the
 * localized (or overridden) title + message, and the "Set up TeslaSync" CTA. The shared [EmptyState]
 * exposes the title as the region's TalkBack name and labels the CTA with [actionLabel].
 */
@Composable
private fun NoVehicleSelectedEmpty(
    title: String?,
    description: String?,
    onSetUp: () -> Unit,
) {
    val resolvedTitle =
        resolveOverride(title, stringResource(R.string.translation_common_noVehicleSelected_title))
    val resolvedMessage =
        resolveOverride(description, stringResource(R.string.translation_common_noVehicleSelected_desc))
    val actionLabel = stringResource(R.string.translation_common_noVehicleSelected_action)
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        EmptyState(
            message = resolvedMessage,
            modifier = Modifier.fillMaxWidth(),
            icon = NavGlyphs.Car,
            title = resolvedTitle,
            action = EmptyStateAction(label = actionLabel, onClick = onSetUp),
        )
    }
}

/**
 * The loading chrome the shared P1/S8 lifecycle can carry. Honors reduced motion: an animated [Spinner]
 * normally, a static labeled row (a Car glyph + the localized "Loading…" label) when motion is reduced.
 * Both branches expose the same single localized accessible name so TalkBack announces it either way.
 */
@Composable
private fun NoVehicleSelectedLoading(reduceMotion: Boolean) {
    val label = stringResource(R.string.translation_common_loading)
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Box(
            modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
            contentAlignment = Alignment.Center,
        ) {
            if (reduceMotion) {
                Row(
                    modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = label },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    Icon(NavGlyphs.Car, contentDescription = null, size = IconSize.Md)
                    BodyText(label)
                }
            } else {
                Spinner(size = SpinnerSize.Md, label = label)
            }
        }
    }
}

/**
 * The hard-error chrome the shared P1/S8 lifecycle can carry — the shared [ErrorDisplay] with a localized
 * title + message and a retry affordance that calls [onRetry].
 */
@Composable
private fun NoVehicleSelectedError(onRetry: () -> Unit) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        ErrorDisplay(
            message = stringResource(R.string.translation_error_serverError_message),
            modifier = Modifier.fillMaxWidth(),
            title = stringResource(R.string.translation_error_serverError_title),
            onRetry = onRetry,
            retryLabel = stringResource(R.string.translation_common_retry),
        )
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

@Preview(name = "Empty (default)", showBackground = true)
@Composable
private fun NoVehicleSelectedEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        NoVehicleSelectedContent(pageTitle = "Battery Health", onSetUp = {})
    }
}

@Preview(name = "Title + description override", showBackground = true)
@Composable
private fun NoVehicleSelectedOverridePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        NoVehicleSelectedContent(
            pageTitle = "Charging",
            onSetUp = {},
            title = "Pick a vehicle first",
            description = "Charging insights appear once a vehicle is enrolled.",
        )
    }
}

@Preview(name = "Loading chrome", showBackground = true)
@Composable
private fun NoVehicleSelectedLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        NoVehicleSelectedContent(
            pageTitle = "Battery Health",
            onSetUp = {},
            surfaceState = NoVehicleSelectedSurfaceState.Loading,
            reduceMotion = false,
        )
    }
}

@Preview(name = "Error chrome", showBackground = true)
@Composable
private fun NoVehicleSelectedErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        NoVehicleSelectedContent(
            pageTitle = "Battery Health",
            onSetUp = {},
            surfaceState = NoVehicleSelectedSurfaceState.Error,
        )
    }
}
