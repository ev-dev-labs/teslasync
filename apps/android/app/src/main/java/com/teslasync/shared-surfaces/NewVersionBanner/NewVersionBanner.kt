// The native Jetpack Compose + Material 3 NewVersionBanner shared surface — a parity port of
// web/src/components/feedback/NewVersionBanner.tsx. The web file is the soft "a new version is available" banner
// shown bottom-right when `useVersionWatcher` detects the backend was redeployed under the running SPA: a
// sparkle-marked notice with a one-line message and "Later" / "Reload" actions. "Reload" hard-reloads the page
// (pulling fresh chunk hashes ahead of a ChunkLoadError); "Later" defers the banner for that specific version.
//
// This surface is the native equivalent. All data flows through the shared [NewVersionBannerViewModel] over the
// [NewVersionBannerSource] seam (P1/S8) — the view performs NO HTTP and touches no persistence directly. Every
// derivation flows through the pure [NewVersionBannerProjection]; the composable is a thin render layer that owns
// only the one-shot `view.opened` diagnostic (P1/S11) and the stale auto-refresh effect. Where the web hides
// itself with `return null` (loading / up to date / deferred), this surface renders every state as a non-blank
// region (the platform contract, exactly as the sibling CookieConsentBanner does):
//   • loading  → skeleton chrome while the deployment identity loads;
//   • error    → a retry affordance when the identity fetch hard-failed;
//   • prompt   → the active reload banner (the web's only rendered state);
//   • resolved → a friendly "up to date" / "deferred" panel (the native form of the web `return null`);
//   • stale/offline → the last-known identity with a "Stale" / "offline" chip + retry.
// Every visible string resolves through the i18n catalog (P1/S10); the prompt carries a merged TalkBack
// announcement (the web `role="status"` + `aria-live="polite"` region).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/NewVersionBanner) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless renderer + previews + glyph.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.newversionbanner

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the whole surface container — used by the instrumented per-state + a11y UI tests. */
const val NEW_VERSION_TEST_TAG: String = "new-version-banner"

/** Test tag identifying the "Reload" control (web `Reload` button). */
const val NEW_VERSION_RELOAD_TAG: String = "new-version-reload"

/** Test tag identifying the "Later" control (web `Later` button). */
const val NEW_VERSION_LATER_TAG: String = "new-version-later"

/** Test tag identifying the retry control shown on the error + offline surfaces. */
const val NEW_VERSION_RETRY_TAG: String = "new-version-retry"

/** The sparkle-icon box diameter — the native mirror of the web `rounded-lg p-2` icon container. */
private val ICON_BOX_SIZE = 36.dp

/** Skeleton bar heights for the loading chrome. */
private val SKELETON_TITLE_HEIGHT = 14.dp
private val SKELETON_BODY_HEIGHT = 10.dp

private const val ICON_WASH_ALPHA = 0.12f
private const val SKELETON_TITLE_FRACTION = 0.55f
private const val SKELETON_BODY_FRACTION = 0.7f

/**
 * The localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests pass a deterministic instance), keeping the projection a pure, locale-stable function. Every string
 * resolves through the P1/S10 catalog — no English literal lives in native code.
 */
data class NewVersionBannerStrings(
    val title: String,
    val message: String,
    val detail: String,
    val later: String,
    val reload: String,
    val upToDate: String,
    val loading: String,
    val stale: String,
    val offline: String,
    val retry: String,
    val errorTitle: String,
    val errorBody: String,
)

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberNewVersionBannerStrings(): NewVersionBannerStrings =
    NewVersionBannerStrings(
        title = stringResource(R.string.translation_pwa_newVersion),
        message = stringResource(R.string.translation_app_newVersion_message),
        detail = stringResource(R.string.translation_error_chunkLoad_body),
        later = stringResource(R.string.translation_app_newVersion_later),
        reload = stringResource(R.string.translation_app_newVersion_reload),
        upToDate = stringResource(R.string.translation_widget_upToDate),
        loading = stringResource(R.string.translation_a11y_loading),
        stale = stringResource(R.string.translation_mqtt_stale),
        offline = stringResource(R.string.translation_error_network_offlineTitle),
        retry = stringResource(R.string.translation_common_retry),
        errorTitle = stringResource(R.string.translation_error_network_title),
        errorBody = stringResource(R.string.translation_error_loadFailed),
    )

/**
 * Stateful entry point bound to the shared Settings version feed — the faithful port of the web `NewVersionBanner`.
 * Binds the [NewVersionBannerViewModel], records the one-shot `view.opened` diagnostic (P1/S11), collects the
 * deployment identity + watcher + deferral, projects everything into the render the stateless surface paints,
 * auto-refreshes a TTL-stale identity, and wires Reload/Later/Retry to the view-model.
 *
 * @param modifier optional layout modifier for the surface container.
 * @param source the deployment-identity seam; defaults to the shared Settings store
 *   ([rememberNewVersionBannerSource]).
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 * @param onReload optional host hook invoked after the view-model re-baselines onto the new deployment — a host
 *   may use it to fully recreate the surface (the native analogue of the web hard reload). Defaults to a no-op,
 *   because the view-model's re-baseline + re-fetch already clears the banner and refreshes the data.
 */
@Composable
fun NewVersionBanner(
    modifier: Modifier = Modifier,
    source: NewVersionBannerSource = rememberNewVersionBannerSource(),
    logger: Logger = LocalDataContainer.current.logger,
    onReload: () -> Unit = {},
) {
    val viewModel: NewVersionBannerViewModel =
        viewModel(
            key = NewVersionBannerRegistration.ID,
            factory = NewVersionBannerViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val watcher by viewModel.watcher.collectAsStateWithLifecycle()
    val dismissed by viewModel.dismissedVersion.collectAsStateWithLifecycle()
    val render =
        remember(state, watcher, dismissed) {
            NewVersionBannerProjection.render(state, watcher, dismissed)
        }

    // Web `useVersionWatcher` poll → a TTL-stale identity quietly re-fetches; the offline/error surfaces keep their
    // explicit retry so a failed refresh is never auto-looped.
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) viewModel.refresh()
    }

    FadeIn(modifier = modifier) {
        NewVersionBannerContent(
            render = render,
            strings = rememberNewVersionBannerStrings(),
            onReload = {
                viewModel.reload()
                onReload()
            },
            onLater = viewModel::later,
            onRetry = viewModel::refresh,
        )
    }
}

/**
 * Stateless surface — the unit/UI-test and preview entry point. Always renders a non-blank [GlassPanel] (never the
 * web `return null`), switching its body on the projected [NewVersionRender.phase]. Hoisted out of the ViewModel
 * so it is preview- and screenshot-testable for each state.
 */
@Composable
fun NewVersionBannerContent(
    render: NewVersionRender,
    strings: NewVersionBannerStrings,
    modifier: Modifier = Modifier,
    onReload: () -> Unit = {},
    onLater: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    GlassPanel(
        modifier = modifier.fillMaxWidth().testTag(NEW_VERSION_TEST_TAG),
        padding = PanelPadding.Md,
    ) {
        when {
            render.showLoading -> NewVersionLoading(strings)
            render.showError -> NewVersionError(strings, onRetry)
            render.showPrompt -> NewVersionPrompt(render, strings, onReload, onLater, onRetry)
            else -> NewVersionResolved(render, strings, onRetry)
        }
    }
}

/** The sparkle header — the rounded tinted icon box + the title, shared by the prompt and resolved surfaces. */
@Composable
private fun NewVersionHeader(
    title: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier =
                Modifier
                    .size(ICON_BOX_SIZE)
                    .clip(RoundedCornerShape(Radius.md))
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = ICON_WASH_ALPHA)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(SparklesGlyph, contentDescription = null, size = IconSize.Md, tint = MaterialTheme.colorScheme.primary)
        }
        PanelTitle(title, modifier = Modifier.weight(1f))
    }
}

/** The active reload banner — the web banner: header, message, the chunk-load detail, and the two actions. */
@Composable
private fun NewVersionPrompt(
    render: NewVersionRender,
    strings: NewVersionBannerStrings,
    onReload: () -> Unit,
    onLater: () -> Unit,
    onRetry: () -> Unit,
) {
    val announcement = "${strings.title}. ${strings.message}"
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = announcement },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        NewVersionHeader(strings.title)
        HelperText(strings.message)
        Caption(strings.detail)
        NewVersionFreshnessRow(render, strings, onRetry)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                label = strings.later,
                onClick = onLater,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                modifier = Modifier.testTag(NEW_VERSION_LATER_TAG),
            )
            Button(
                label = strings.reload,
                onClick = onReload,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                modifier = Modifier.testTag(NEW_VERSION_RELOAD_TAG),
            )
        }
    }
}

/** The resolved recorded-state panel — the native form of the web `return null` (up to date / deferred). */
@Composable
private fun NewVersionResolved(
    render: NewVersionRender,
    strings: NewVersionBannerStrings,
    onRetry: () -> Unit,
) {
    when (render.resolvedReason) {
        ResolvedReason.UpToDate -> NewVersionUpToDate(render, strings, onRetry)
        ResolvedReason.Deferred -> NewVersionDeferred(render, strings, onRetry)
    }
}

/** No new deployment is available — the friendly "up to date" panel (web `if (!newVersionAvailable) return null`). */
@Composable
private fun NewVersionUpToDate(
    render: NewVersionRender,
    strings: NewVersionBannerStrings,
    onRetry: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.upToDate },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        NewVersionHeader(strings.upToDate)
        NewVersionFreshnessRow(render, strings, onRetry)
    }
}

/** A new deployment IS available but the user chose "Later" — the deferred panel (web dismissed-for-version). */
@Composable
private fun NewVersionDeferred(
    render: NewVersionRender,
    strings: NewVersionBannerStrings,
    onRetry: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = "${strings.title}. ${strings.later}" },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        NewVersionHeader(strings.title)
        StatusPill(text = strings.later, tone = StatusTone.Info)
        BodyText(strings.message, color = MaterialTheme.colorScheme.onSurfaceVariant)
        NewVersionFreshnessRow(render, strings, onRetry)
    }
}

/** The "Stale" / "offline + retry" freshness row shown over the prompt + resolved surfaces. */
@Composable
private fun NewVersionFreshnessRow(
    render: NewVersionRender,
    strings: NewVersionBannerStrings,
    onRetry: () -> Unit,
) {
    if (!render.showStaleChip && !render.showOfflineChip) return
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (render.showStaleChip) {
            StatusPill(text = strings.stale, tone = StatusTone.Warning)
        }
        if (render.showOfflineChip) {
            StatusPill(text = strings.offline, tone = StatusTone.Danger)
            NewVersionRetryButton(strings, onRetry)
        }
    }
}

/** The hard-error surface — a header, the failure copy, and a retry affordance (web hides; the platform shows). */
@Composable
private fun NewVersionError(
    strings: NewVersionBannerStrings,
    onRetry: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = "${strings.errorTitle}. ${strings.errorBody}" },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        PanelTitle(strings.errorTitle)
        HelperText(strings.errorBody)
        NewVersionRetryButton(strings, onRetry)
    }
}

/** The shared retry control (the error + offline affordance), carrying the retry test tag. */
@Composable
private fun NewVersionRetryButton(
    strings: NewVersionBannerStrings,
    onRetry: () -> Unit,
) {
    Button(
        label = strings.retry,
        onClick = onRetry,
        variant = ButtonVariant.Outline,
        size = ButtonSize.Sm,
        modifier = Modifier.testTag(NEW_VERSION_RETRY_TAG),
    )
}

/** The cold-start skeleton chrome — a non-blank loading region announced to TalkBack as "Loading". */
@Composable
private fun NewVersionLoading(
    strings: NewVersionBannerStrings,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = strings.loading },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier =
                    Modifier
                        .size(ICON_BOX_SIZE)
                        .clip(RoundedCornerShape(Radius.md))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
            )
            Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
        }
        Skeleton(height = SKELETON_BODY_HEIGHT)
        Skeleton(widthFraction = SKELETON_BODY_FRACTION, height = SKELETON_BODY_HEIGHT)
    }
}

/**
 * Builds the production [NewVersionBannerSource] from the shared S8 Settings store (the deployment-identity feed).
 * Memoized on the store so the surface binds once; tests inject a fake source instead.
 */
@Composable
private fun rememberNewVersionBannerSource(): NewVersionBannerSource {
    val settingsStore = LocalDataContainer.current.settingsStore
    return remember(settingsStore) { settingsStore.asNewVersionBannerSource() }
}

// ── Diagonal projection of an inner valley: r / sqrt(2), so a valley sits at (cx ± d, cy ± d). ───────────────────
private const val DIAGONAL = 0.70710677f

/**
 * The sparkle twinkle — the native author of the web lucide `Sparkles`. Decorative (the enclosing regions carry
 * the merged content description), drawn as a 24×24 stroked vector recolored by [Icon]'s tint: one large
 * four-point twinkle plus two small plus sparkles in the opposite clear corners.
 */
private val SparklesGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "Sparkles",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            ) {
                fourPointStar(cx = 12f, cy = 12f, outer = 8.5f, inner = 3.0f)
                plus(cx = 18.5f, cy = 6f, arm = 1.5f)
                plus(cx = 5.5f, cy = 18f, arm = 1.5f)
            }
        }.build()

/**
 * Traces an eight-vertex four-point star ("twinkle"): outer points at the [outer] radius on the four axes and
 * inner valleys at the [inner] radius on the four diagonals, centered at ([cx], [cy]). Drawn clockwise from the
 * top point and closed.
 */
private fun PathBuilder.fourPointStar(
    cx: Float,
    cy: Float,
    outer: Float,
    inner: Float,
) {
    val d = inner * DIAGONAL
    moveTo(cx, cy - outer)
    lineTo(cx + d, cy - d)
    lineTo(cx + outer, cy)
    lineTo(cx + d, cy + d)
    lineTo(cx, cy + outer)
    lineTo(cx - d, cy + d)
    lineTo(cx - outer, cy)
    lineTo(cx - d, cy - d)
    close()
}

/** Draws a small plus mark ("+") centered at ([cx], [cy]) with arms of length [arm] on each side. */
private fun PathBuilder.plus(
    cx: Float,
    cy: Float,
    arm: Float,
) {
    moveTo(cx, cy - arm)
    lineTo(cx, cy + arm)
    moveTo(cx - arm, cy)
    lineTo(cx + arm, cy)
}

// ── Previews — one per state so each surface is visually verifiable in tooling (detekt ignores @Preview).
// Strings resolve through the same catalog-backed rememberNewVersionBannerStrings() the runtime uses (no English
// literals); only the non-user-facing render scaffold is sample data. ─────────────────────────────────────────

private val previewWatcher =
    VersionWatcherState(
        bootVersion = "1.0.0|go1.25|linux|amd64",
        latestVersion = "1.1.0|go1.25|linux|amd64",
        newVersionAvailable = true,
    )

private val previewUpToDateWatcher =
    VersionWatcherState(
        bootVersion = "1.1.0|go1.25|linux|amd64",
        latestVersion = "1.1.0|go1.25|linux|amd64",
        newVersionAvailable = false,
    )

private fun previewBase(phase: NewVersionPhase): NewVersionRender =
    NewVersionRender(
        phase = phase,
        watcher = previewWatcher,
        dismissedVersion = null,
        stale = false,
        offline = false,
        errorKind = null,
    )

@Composable
private fun NewVersionPreviewSurface(render: NewVersionRender) {
    TeslaSyncTheme(dynamicColor = false) {
        NewVersionBannerContent(render = render, strings = rememberNewVersionBannerStrings())
    }
}

@Preview(name = "NewVersionBanner · loading", showBackground = true)
@Composable
private fun PreviewNewVersionLoading() = NewVersionPreviewSurface(NewVersionBannerProjection.loading())

@Preview(name = "NewVersionBanner · prompt", showBackground = true)
@Composable
private fun PreviewNewVersionPrompt() = NewVersionPreviewSurface(previewBase(NewVersionPhase.Prompt))

@Preview(name = "NewVersionBanner · up to date", showBackground = true)
@Composable
private fun PreviewNewVersionUpToDate() =
    NewVersionPreviewSurface(previewBase(NewVersionPhase.Resolved).copy(watcher = previewUpToDateWatcher))

@Preview(name = "NewVersionBanner · deferred", showBackground = true)
@Composable
private fun PreviewNewVersionDeferred() =
    NewVersionPreviewSurface(previewBase(NewVersionPhase.Resolved).copy(dismissedVersion = previewWatcher.latestVersion))

@Preview(name = "NewVersionBanner · stale", showBackground = true)
@Composable
private fun PreviewNewVersionStale() = NewVersionPreviewSurface(previewBase(NewVersionPhase.Prompt).copy(stale = true))

@Preview(name = "NewVersionBanner · offline", showBackground = true)
@Composable
private fun PreviewNewVersionOffline() =
    NewVersionPreviewSurface(previewBase(NewVersionPhase.Prompt).copy(stale = true, offline = true, errorKind = ErrorKind.Network))

@Preview(name = "NewVersionBanner · error", showBackground = true)
@Composable
private fun PreviewNewVersionError() = NewVersionPreviewSurface(previewBase(NewVersionPhase.Error).copy(errorKind = ErrorKind.Network))
