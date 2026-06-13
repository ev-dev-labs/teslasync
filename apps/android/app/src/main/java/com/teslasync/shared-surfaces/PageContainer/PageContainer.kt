// The native Jetpack Compose + Material 3 PageContainer shared surface — a parity port of
// web/src/components/layout/PageContainer.tsx. The web surface is the page-chrome shell every parity page
// renders inside: a header (h1 title + optional subtitle + a trailing cluster of a data-freshness chip, a
// copy-link button, and host `actions`) over a body that switches loading → error → empty → content; its only
// side effect is pushing per-route breadcrumb label overrides up to the Layout. This port reproduces that
// composition, every state, the i18n, and the a11y in native primitives — no ported Tailwind classes; platform
// tokens from P1/S9.
//
// All branch logic flows through the pure [io.teslasync.android.sharedsurfaces.pagecontainer] model
// (PageContainerModel.kt, unit-tested off-device): [classifyPageBody] picks the body surface, [pickWorstFreshness]
// folds the page's `query` freshness to the single most-degraded chip, [pageHasTrailingCluster] /
// [pageEmptyMessage] / [pageErrorMessage] resolve the header + body copy, and [BreadcrumbOverridesStore] is the
// producer half of the web `BreadcrumbOverridesContext`. This composable is a thin render layer: it binds no
// cache-then-network feed of its own (web parity — the web component fetches nothing; `loading`/`error`/`empty`
// and the `query` freshness arrive as props), publishes the breadcrumb overrides through the shared P1/S8
// state-holder ([LocalBreadcrumbOverrides] + [SetBreadcrumbOverrides]), composes the sibling Spinner /
// DataFreshness surfaces + the shared component library (feedback EmptyState / ErrorDisplay / PageErrorBoundary,
// ui CopyButton / typography) over the per-theme tokens, resolves every string through the i18n catalog (P1/S10),
// and emits the one PII-safe `view.opened` diagnostic (P1/S11) on first composition.
//
// States reproduced (every one renders a non-blank surface): loading (centred brand spinner), error (the shared
// ErrorDisplay with the host message + an optional retry), empty (the shared EmptyState with a localized
// fallback), the stale + offline tiers (surfaced by the header freshness chip via the sibling DataFreshness
// projection), and content (the children wrapped in the page error boundary).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/PageContainer) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pagecontainer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorBoundaryState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.PageErrorBoundary
import io.teslasync.android.components.feedback.rememberErrorBoundaryState
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.sharedsurfaces.datafreshness.DataFreshnessChip
import io.teslasync.android.sharedsurfaces.datafreshness.DataFreshnessProjection
import io.teslasync.android.sharedsurfaces.datafreshness.FreshnessRender
import io.teslasync.android.sharedsurfaces.datafreshness.FreshnessSnapshot
import io.teslasync.android.sharedsurfaces.spinner.Spinner
import io.teslasync.android.sharedsurfaces.spinner.SpinnerSize
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay

/** Test tag identifying the page-chrome container — used by the instrumented per-state + a11y UI tests. */
const val PAGE_CONTAINER_TEST_TAG: String = "page-container"

/** Re-render cadence keeping the freshness chip's relative-time label accurate (web 30s `setInterval`). */
private const val RELATIVE_TICK_MS = 30_000L

/**
 * A no-op logger handed to the embedded loading [Spinner] so the brand mark renders as pure internal chrome:
 * PageContainer already owns the single surface-level `view.opened` diagnostic, so the nested atom must not
 * emit a second one (and must not reach for [LocalDataContainer], keeping the loading state previewable and
 * testable without a data-container provider).
 */
private val pageChromeNoopLogger =
    object : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

/** The process-wide default breadcrumb-overrides store used when no host provides one (previews / standalone). */
private val defaultBreadcrumbOverridesStore = BreadcrumbOverridesStore()

/**
 * The breadcrumb-overrides context (P1/S8) — the native analogue of the web `BreadcrumbOverridesContext`. A host
 * may provide its own [BreadcrumbOverridesStore] at the app root for a breadcrumb consumer to read; absent that,
 * reads resolve to a shared default so [PageContainer] always has a sink to publish into.
 */
val LocalBreadcrumbOverrides: ProvidableCompositionLocal<BreadcrumbOverridesStore> =
    staticCompositionLocalOf { defaultBreadcrumbOverridesStore }

/**
 * Publishes per-route breadcrumb [labels] into the active [BreadcrumbOverridesStore] for the lifetime of the
 * caller — the native port of the web `useSetBreadcrumbOverrides(breadcrumbLabels)`. Registers the labels under
 * a stable owner token on mount and unregisters on dispose, so the merged overrides always reflect the pages
 * currently on screen. A `null` map registers an empty contribution (a no-op owner), mirroring the web hook
 * being called unconditionally with a possibly-undefined value.
 */
@Composable
fun SetBreadcrumbOverrides(labels: Map<String, String>?) {
    val store = LocalBreadcrumbOverrides.current
    val owner = remember { Any() }
    DisposableEffect(store, owner, labels) {
        store.register(owner, labels ?: emptyMap())
        onDispose { store.unregister(owner) }
    }
}

/**
 * Stateful entry point — the faithful port of the web `PageContainer`. Records the one-shot `view.opened`
 * diagnostic (P1/S11) on first composition, publishes [breadcrumbLabels] up to the breadcrumb-overrides store
 * (web `useSetBreadcrumbOverrides`), folds [freshness] to the single most-degraded chip, classifies the body
 * surface, and hands a fully-resolved render to the stateless [PageContainerScaffold]. Binds no feed of its own
 * (web parity).
 *
 * @param title the page heading (web `title`, the `<h1>`).
 * @param subtitle an optional muted sub-heading (web `subtitle`).
 * @param loading whether the page's first load is in flight (web `loading` → the centred spinner).
 * @param error the page-owned failure, if any (web `error`) — its message drives the error surface.
 * @param empty whether the resolved data is empty (web `empty` → the empty surface).
 * @param emptyMessage the empty-surface copy (web `emptyMessage`); falls back to a localized "No data available".
 * @param breadcrumbLabels per-route label overrides pushed to the Layout breadcrumb (web `breadcrumbLabels`).
 * @param copyLink the deep link a copy-link button copies, or `null` for no button. The web boolean `copyLink`
 *   (which copies `window.location.href`) maps to this nullable string because Android has no ambient page URL.
 * @param freshness the page's `query` freshness as cache-then-network snapshots (single or several); the worst
 *   is surfaced by the header chip (web `query` → `pickWorstQuery` → `DataFreshnessAuto`).
 * @param onRetry an optional host retry wired into the error surface (the platform error-state contract).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param boundaryState the error-capture handle the content boundary uses; defaults to a remembered instance.
 * @param actions optional trailing header actions (web `actions`).
 * @param content the page body, rendered inside the page error boundary while healthy (web `children`).
 */
@Composable
fun PageContainer(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    loading: Boolean = false,
    error: Throwable? = null,
    empty: Boolean = false,
    emptyMessage: String? = null,
    breadcrumbLabels: Map<String, String>? = null,
    copyLink: String? = null,
    freshness: List<FreshnessSnapshot> = emptyList(),
    onRetry: (() -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
    boundaryState: ErrorBoundaryState = rememberErrorBoundaryState(),
    actions: (@Composable () -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    LaunchedEffect(Unit) { PageContainerDiagnostics.recordViewOpened(logger) }
    SetBreadcrumbOverrides(breadcrumbLabels)

    val worst = pickWorstFreshness(freshness)
    val reduceMotion = rememberReducedMotion()
    val nowMs by rememberPageNowTick(worst?.updatedAtMs)
    val freshnessRender =
        worst?.let { DataFreshnessProjection.render(it, nowMs, reduceMotion, refetchable = false) }

    PageContainerScaffold(
        title = title,
        bodyState = classifyPageBody(loading, error != null, empty),
        modifier = modifier,
        subtitle = subtitle,
        errorMessage = error?.message,
        emptyMessage = emptyMessage,
        freshnessRender = freshnessRender,
        copyLink = copyLink,
        onRetry = onRetry,
        boundaryState = boundaryState,
        actions = actions,
        content = content,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the page chrome from already-resolved
 * inputs: the header (title + subtitle + trailing cluster) over the [bodyState] body. Kept free of time / motion
 * reads (the stateful [PageContainer] pre-projects [freshnessRender]) so every state is previewable and testable.
 */
@Composable
fun PageContainerScaffold(
    title: String,
    bodyState: PageBodyState,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    errorMessage: String? = null,
    emptyMessage: String? = null,
    freshnessRender: FreshnessRender? = null,
    copyLink: String? = null,
    onRetry: (() -> Unit)? = null,
    boundaryState: ErrorBoundaryState = rememberErrorBoundaryState(),
    actions: (@Composable () -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = modifier.fillMaxWidth().testTag(PAGE_CONTAINER_TEST_TAG),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        PageHeader(
            title = title,
            subtitle = subtitle,
            freshnessRender = freshnessRender,
            copyLink = copyLink,
            actions = actions,
        )
        PageBody(
            bodyState = bodyState,
            errorMessage = errorMessage,
            emptyMessage = emptyMessage,
            onRetry = onRetry,
            boundaryState = boundaryState,
            content = content,
        )
    }
}

/** The header row: a title + optional subtitle column, and the trailing cluster when any trailing item exists. */
@Composable
private fun PageHeader(
    title: String,
    subtitle: String?,
    freshnessRender: FreshnessRender?,
    copyLink: String?,
    actions: (@Composable () -> Unit)?,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            PageTitle(title, modifier = Modifier.semantics { heading() })
            if (!subtitle.isNullOrBlank()) {
                HelperText(subtitle)
            }
        }
        if (pageHasTrailingCluster(actions != null, copyLink != null, freshnessRender != null)) {
            PageHeaderTrailing(freshnessRender = freshnessRender, copyLink = copyLink, actions = actions)
        }
    }
}

/** The trailing header cluster — the freshness chip, then the copy-link button, then the host actions. */
@Composable
private fun PageHeaderTrailing(
    freshnessRender: FreshnessRender?,
    copyLink: String?,
    actions: (@Composable () -> Unit)?,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (freshnessRender != null) {
            DataFreshnessChip(render = freshnessRender)
        }
        if (copyLink != null) {
            CopyButton(
                text = copyLink,
                copyLabel = stringResource(R.string.translation_common_copyLink_action),
                copiedLabel = stringResource(R.string.translation_common_copyLink_copied),
            )
        }
        actions?.invoke()
    }
}

/** The body surface, in the web precedence loading > error > empty > content. */
@Composable
private fun PageBody(
    bodyState: PageBodyState,
    errorMessage: String?,
    emptyMessage: String?,
    onRetry: (() -> Unit)?,
    boundaryState: ErrorBoundaryState,
    content: @Composable () -> Unit,
) {
    when (bodyState) {
        PageBodyState.Loading ->
            Box(
                modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xl3),
                contentAlignment = Alignment.Center,
            ) {
                Spinner(size = SpinnerSize.Lg, logger = pageChromeNoopLogger)
            }

        PageBodyState.Error ->
            ErrorDisplay(
                message = pageErrorMessage(errorMessage, stringResource(R.string.translation_error_serverError_message)),
                title = stringResource(R.string.translation_queryError_title),
                onRetry = onRetry,
                retryLabel = stringResource(R.string.translation_queryError_retry),
            )

        PageBodyState.Empty ->
            EmptyState(message = pageEmptyMessage(emptyMessage, stringResource(R.string.translation_common_noData)))

        PageBodyState.Content ->
            PageErrorBoundary(
                state = boundaryState,
                title = stringResource(R.string.translation_queryError_title),
                content = content,
            )
    }
}

/**
 * A wall-clock tick that re-renders the freshness chip's relative-time label on a 30s cadence (web 30s
 * `setInterval`). Re-seeded whenever the last-updated stamp changes so the label is accurate immediately.
 */
@Composable
private fun rememberPageNowTick(updatedAtMs: Long?): State<Long> =
    produceState(initialValue = System.currentTimeMillis(), updatedAtMs) {
        while (true) {
            value = System.currentTimeMillis()
            delay(RELATIVE_TICK_MS)
        }
    }

// ── Previews (tooling-only; the sample copy is never shipped UI) ──────────────────────────────────────────

private const val PREVIEW_TITLE = "Charging history"
private const val PREVIEW_SUBTITLE = "All sessions across your fleet"
private const val PREVIEW_ERROR = "Cannot reach the charging service"

private fun previewFreshness(
    stale: Boolean = false,
    offline: Boolean = false,
): FreshnessRender {
    val now = 1_000_000_000_000L
    return DataFreshnessProjection.render(
        snapshot =
            FreshnessSnapshot(
                updatedAtMs = now - 5 * 60_000L,
                fetching = false,
                stale = stale,
                hardError = false,
                offline = offline,
                hasData = true,
                empty = false,
            ),
        nowMs = now,
        reduceMotion = true,
        refetchable = false,
    )
}

@Preview(name = "PageContainer · content + freshness + actions", showBackground = true)
@Composable
private fun PageContainerContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PageContainerScaffold(
            title = PREVIEW_TITLE,
            bodyState = PageBodyState.Content,
            subtitle = PREVIEW_SUBTITLE,
            freshnessRender = previewFreshness(),
            copyLink = "io.teslasync.android://charging",
            actions = { Button(label = "Export", onClick = {}) },
        ) {
            HelperText("Session list renders here.")
        }
    }
}

@Preview(name = "PageContainer · loading", showBackground = true)
@Composable
private fun PageContainerLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PageContainerScaffold(title = PREVIEW_TITLE, bodyState = PageBodyState.Loading) {}
    }
}

@Preview(name = "PageContainer · error (retry)", showBackground = true)
@Composable
private fun PageContainerErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PageContainerScaffold(
            title = PREVIEW_TITLE,
            bodyState = PageBodyState.Error,
            errorMessage = PREVIEW_ERROR,
            onRetry = {},
        ) {}
    }
}

@Preview(name = "PageContainer · empty", showBackground = true)
@Composable
private fun PageContainerEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PageContainerScaffold(
            title = PREVIEW_TITLE,
            bodyState = PageBodyState.Empty,
            emptyMessage = "No charging sessions yet.",
        ) {}
    }
}

@Preview(name = "PageContainer · stale freshness chip", showBackground = true)
@Composable
private fun PageContainerStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PageContainerScaffold(
            title = PREVIEW_TITLE,
            bodyState = PageBodyState.Content,
            freshnessRender = previewFreshness(stale = true),
        ) {
            HelperText("Stale data still renders; the chip flags it amber.")
        }
    }
}
