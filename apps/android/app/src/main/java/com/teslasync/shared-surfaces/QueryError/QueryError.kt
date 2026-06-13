// The native Jetpack Compose + Material 3 QueryError shared surface — a parity port of
// web/src/components/feedback/QueryError.tsx (built on _ErrorState.tsx). The web component is an inline error
// banner for a failed API query: a rose-tinted "icon + title + message + recovery CTA" card that branches by
// failure mode (waiting / 404 / 401-403 / 5xx / network online / network offline) so the user gets actionable
// copy instead of a generic "something went wrong".
//
// This surface is the native equivalent. All connectivity flows through the shared [QueryErrorViewModel] over
// the [QueryErrorSource] seam (P1/S8) — the view performs NO I/O and reads no platform service directly. Every
// branch derivation flows through the pure [projectQueryError]; the composable is a thin render layer. The
// faithful mapping of the web behaviour:
//   • the web `error` prop → the injected [QueryErrorFailure] (httpStatus + transient-waiting), classified by
//     the shared [classifyQueryError] together with live connectivity into a [QueryErrorRender].
//   • the web `_ErrorState` card (rose border + tint, icon chip, title, message, optional action) → a Row of
//     an accent icon chip, a title/message column, and an optional shared [Button] CTA.
//   • the web `useOnlineStatus` network-branch swap ("Can't reach server" ↔ "You're offline") + disabled
//     "Retry when online" → the [QueryErrorViewModel.online]-driven branch + [QueryErrorRender.retryEnabled].
//   • the web offline auto-retry effect (re-invoke onRetry once the connection returns, status === undefined
//     only) → [QueryErrorViewModel.reconnect] collected here and forwarded to [onRetry].
//   • the web `role` / `aria-live` (status+polite for waiting/offline, alert+assertive otherwise) → the card's
//     live-region semantics.
//   • the web `navigate(listHref)` / `/login` navigation → the host [onBackToList] / [onSignIn] callbacks.
//   • the web `if (!error) return null` → a `null` failure renders nothing (the one non-error, non-hidden case).
//
// States reproduced (every error branch renders a non-blank card): waiting, not-found, unauthorized,
// server-error, network (online), and offline (last-known connectivity). The one-shot `view.opened` diagnostic
// (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/QueryError) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, glyphs, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.queryerror

import android.net.ConnectivityManager
import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.flowOf

/** Test tag identifying the card container — used by the instrumented per-state + a11y UI tests. */
const val QUERY_ERROR_TEST_TAG: String = "query-error"

private val CARD_SHAPE = RoundedCornerShape(12.dp)
private val ICON_SHAPE = RoundedCornerShape(8.dp)
private val BORDER_WIDTH = 1.dp

private const val SURFACE_ALPHA = 0.05f
private const val BORDER_ALPHA = 0.20f
private const val ICON_BG_ALPHA = 0.10f
private const val MESSAGE_ALPHA = 0.70f

/**
 * Stateful entry point — the faithful port of the web `QueryError` deriving its branch from the `error` prop
 * and live `useOnlineStatus`. Binds the [QueryErrorViewModel] for [failure], records the one-shot
 * `view.opened` diagnostic (P1/S11), forwards each offline→online recovery to [onRetry] (the web auto-retry
 * effect), collects the live render, and paints it. A `null` [failure] renders nothing (web `if (!error)`).
 *
 * @param failure the classified failed query to render, or `null` for the no-error case.
 * @param modifier optional layout modifier for the card container.
 * @param resourceName singular name of the missing resource, surfaced in the 404 title (web `resourceName`).
 * @param onRetry host retry for the 5xx / network branches (web `onRetry`); also auto-invoked on reconnect.
 * @param onSignIn host navigation for the 401/403 branch (web `/login`).
 * @param onBackToList host navigation for the 404 branch (web `navigate(listHref)`); the CTA shows only when set.
 * @param source the connectivity seam (defaults to the platform `ConnectivityManager`; tests/hosts override).
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun QueryError(
    failure: QueryErrorFailure?,
    modifier: Modifier = Modifier,
    resourceName: String? = null,
    onRetry: (() -> Unit)? = null,
    onSignIn: (() -> Unit)? = null,
    onBackToList: (() -> Unit)? = null,
    source: QueryErrorSource = rememberConnectivityQueryErrorSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: QueryErrorViewModel =
        viewModel(
            key = QueryErrorRegistration.ID + ":" + failureKey(failure),
            factory = QueryErrorViewModel.factory(source, failure, logger),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    LaunchedEffect(viewModel, onRetry) {
        viewModel.reconnect.collect { onRetry?.invoke() }
    }
    val render by viewModel.render.collectAsStateWithLifecycle()
    val current = render ?: return
    QueryErrorCard(
        render = current,
        modifier = modifier,
        resourceName = resourceName,
        onRetry = onRetry,
        onSignIn = onSignIn,
        onBackToList = onBackToList,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the rose `_ErrorState` card from a
 * fully resolved [render]: an accent icon chip, the branch title + message, and an optional recovery CTA.
 * The whole card announces as a polite or assertive live region (web `aria-live`); the CTA is the only
 * interactive element and carries its own label. Never blank — every branch renders icon + title + message.
 */
@Composable
fun QueryErrorCard(
    render: QueryErrorRender,
    modifier: Modifier = Modifier,
    resourceName: String? = null,
    onRetry: (() -> Unit)? = null,
    onSignIn: (() -> Unit)? = null,
    onBackToList: (() -> Unit)? = null,
) {
    val accent = TeslaTokens.status.danger
    val title = branchTitle(render.branch, resourceName)
    val message = branchMessage(render.branch)
    val cta = branchCta(render, onRetry, onSignIn, onBackToList)

    Row(
        modifier =
            modifier
                .testTag(QUERY_ERROR_TEST_TAG)
                .clip(CARD_SHAPE)
                .background(accent.copy(alpha = SURFACE_ALPHA))
                .border(BORDER_WIDTH, accent.copy(alpha = BORDER_ALPHA), CARD_SHAPE)
                .padding(Spacing.md)
                .semantics {
                    liveRegion = if (render.polite) LiveRegionMode.Polite else LiveRegionMode.Assertive
                },
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            modifier =
                Modifier
                    .clip(ICON_SHAPE)
                    .background(accent.copy(alpha = ICON_BG_ALPHA))
                    .padding(Spacing.sm),
        ) {
            Icon(imageVector = branchIcon(render.branch), contentDescription = null, size = IconSize.Sm, tint = accent)
        }
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Heading(text = title, level = HeadingLevel.Panel, color = accent)
            BodyText(text = message, color = accent.copy(alpha = MESSAGE_ALPHA))
        }
        if (cta != null) {
            Button(
                label = cta.label,
                onClick = cta.onClick,
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
                enabled = cta.enabled,
            )
        }
    }
}

/**
 * Builds the production [QueryErrorSource] from the platform [ConnectivityManager] (web `useOnlineStatus`
 * source). Falls back to an always-online stream on the rare device that exposes no connectivity service, so
 * the surface still renders its branch rather than crashing. Remembered per-context so the network callback
 * is registered once.
 */
@Composable
fun rememberConnectivityQueryErrorSource(): QueryErrorSource {
    val context = LocalContext.current
    return remember(context) {
        context.getSystemService(ConnectivityManager::class.java)?.asQueryErrorSource()
            ?: queryErrorSource { flowOf(true) }
    }
}

private data class QueryErrorCta(
    val label: String,
    val onClick: () -> Unit,
    val enabled: Boolean,
)

/** Resolves the localized title for a [branch] (web per-branch title); the 404 title interpolates [resourceName]. */
@Composable
private fun branchTitle(
    branch: QueryErrorKind,
    resourceName: String?,
): String =
    when (branch) {
        QueryErrorKind.Waiting -> stringResource(R.string.translation_error_waiting_title)
        QueryErrorKind.NotFound -> {
            val thing = resourceName ?: stringResource(R.string.translation_error_notFound_thingDefault)
            stringResource(R.string.translation_error_notFound_title, thing)
        }
        QueryErrorKind.Unauthorized -> stringResource(R.string.translation_error_unauthorized_title)
        QueryErrorKind.ServerError -> stringResource(R.string.translation_error_serverError_title)
        QueryErrorKind.Offline -> stringResource(R.string.translation_error_network_offlineTitle)
        QueryErrorKind.Network -> stringResource(R.string.translation_error_network_title)
    }

/** Resolves the localized message for a [branch] (web per-branch message). */
@Composable
private fun branchMessage(branch: QueryErrorKind): String =
    when (branch) {
        QueryErrorKind.Waiting -> stringResource(R.string.translation_error_waiting_message)
        QueryErrorKind.NotFound -> stringResource(R.string.translation_error_notFound_message)
        QueryErrorKind.Unauthorized -> stringResource(R.string.translation_error_unauthorized_message)
        QueryErrorKind.ServerError -> stringResource(R.string.translation_error_serverError_message)
        QueryErrorKind.Offline -> stringResource(R.string.translation_error_network_offlineDetail)
        QueryErrorKind.Network -> stringResource(R.string.translation_error_network_message)
    }

/** The branch icon — Clock / Lock / WifiOff from the shared feedback set, with locally-authored lucide glyphs. */
private fun branchIcon(branch: QueryErrorKind): ImageVector =
    when (branch) {
        QueryErrorKind.Waiting -> FeedbackGlyphs.Clock
        QueryErrorKind.NotFound -> FileQuestionGlyph
        QueryErrorKind.Unauthorized -> FeedbackGlyphs.Lock
        QueryErrorKind.ServerError -> ServerGlyph
        QueryErrorKind.Offline -> FeedbackGlyphs.WifiOff
        QueryErrorKind.Network -> AlertCircleGlyph
    }

/**
 * Resolves the recovery CTA for the current [render] (web per-branch action): waiting has none; not-found maps
 * to [onBackToList]; unauthorized to [onSignIn]; server-error / network to [onRetry] (offline keeps the
 * "Retry when online" label disabled). Returns `null` when the branch has no CTA or the host wired no callback
 * (web 404 shows Back-to-list only when `listHref` is set).
 */
@Composable
private fun branchCta(
    render: QueryErrorRender,
    onRetry: (() -> Unit)?,
    onSignIn: (() -> Unit)?,
    onBackToList: (() -> Unit)?,
): QueryErrorCta? =
    when (render.branch) {
        QueryErrorKind.Waiting -> null
        QueryErrorKind.NotFound -> cta(onBackToList, R.string.translation_error_notFound_cta, enabled = true)
        QueryErrorKind.Unauthorized -> cta(onSignIn, R.string.translation_error_unauthorized_cta, enabled = true)
        QueryErrorKind.ServerError -> cta(onRetry, R.string.translation_error_retry, enabled = true)
        QueryErrorKind.Offline -> cta(onRetry, R.string.translation_error_network_retryWhenOnline, render.retryEnabled)
        QueryErrorKind.Network -> cta(onRetry, R.string.translation_error_retry, render.retryEnabled)
    }

@Composable
private fun cta(
    onClick: (() -> Unit)?,
    @StringRes labelRes: Int,
    enabled: Boolean,
): QueryErrorCta? {
    if (onClick == null) return null
    return QueryErrorCta(label = stringResource(labelRes), onClick = onClick, enabled = enabled)
}

/** A stable [QueryErrorViewModel] key per distinct failure so a changed failure rebinds a fresh holder. */
private fun failureKey(failure: QueryErrorFailure?): String =
    if (failure == null) "none" else "${failure.httpStatus ?: "x"}:${failure.transientWaiting}"

// ── Locally-authored lucide glyphs (the web Server / FileQuestion / AlertCircle icons) ─────────────────────
// Drawn as 24×24 monochrome stroked vectors — the feedback set ships Clock / Lock / WifiOff but not these
// three; authored here exactly as DataFreshness authors its WifiOn glyph, recolored at render time by [Icon].

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

private val AlertCircleGlyph: ImageVector =
    strokedGlyph("AlertCircle") {
        moveTo(21f, 12f)
        arcTo(9f, 9f, 0f, isMoreThanHalf = true, isPositiveArc = true, 3f, 12f)
        arcTo(9f, 9f, 0f, isMoreThanHalf = true, isPositiveArc = true, 21f, 12f)
        moveTo(12f, 8f)
        lineTo(12f, 13f)
        dotAt(12f, 16.4f)
    }

private val FileQuestionGlyph: ImageVector =
    strokedGlyph("FileQuestion") {
        moveTo(13f, 3f)
        lineTo(6f, 3f)
        lineTo(6f, 21f)
        lineTo(18f, 21f)
        lineTo(18f, 8f)
        close()
        moveTo(13f, 3f)
        lineTo(13f, 8f)
        lineTo(18f, 8f)
        moveTo(9.7f, 11.2f)
        curveTo(9.7f, 10f, 10.7f, 9.2f, 12f, 9.2f)
        curveTo(13.3f, 9.2f, 14.3f, 10f, 14.3f, 11.1f)
        curveTo(14.3f, 12.6f, 12.6f, 12.7f, 12.1f, 14f)
        dotAt(12f, 16.6f)
    }

private val ServerGlyph: ImageVector =
    strokedGlyph("Server") {
        moveTo(4f, 5f)
        lineTo(20f, 5f)
        lineTo(20f, 10f)
        lineTo(4f, 10f)
        close()
        moveTo(4f, 14f)
        lineTo(20f, 14f)
        lineTo(20f, 19f)
        lineTo(4f, 19f)
        close()
        dotAt(7f, 7.5f)
        dotAt(7f, 16.5f)
    }

private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]). */
private fun PathBuilder.dotAt(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

// ── Previews (tooling-only) ────────────────────────────────────────────────────────────────────────────

private fun previewRender(branch: QueryErrorKind): QueryErrorRender =
    QueryErrorRender(
        branch = branch,
        retryEnabled = branch != QueryErrorKind.Offline,
        polite = branch == QueryErrorKind.Waiting || branch == QueryErrorKind.Offline,
    )

@Preview(name = "Waiting — upstream", showBackground = true)
@Composable
private fun QueryErrorWaitingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QueryErrorCard(render = previewRender(QueryErrorKind.Waiting))
    }
}

@Preview(name = "Not found — 404", showBackground = true)
@Composable
private fun QueryErrorNotFoundPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QueryErrorCard(render = previewRender(QueryErrorKind.NotFound), resourceName = "Drive", onBackToList = {})
    }
}

@Preview(name = "Unauthorized — 401/403", showBackground = true)
@Composable
private fun QueryErrorUnauthorizedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QueryErrorCard(render = previewRender(QueryErrorKind.Unauthorized), onSignIn = {})
    }
}

@Preview(name = "Server error — 5xx", showBackground = true)
@Composable
private fun QueryErrorServerErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QueryErrorCard(render = previewRender(QueryErrorKind.ServerError), onRetry = {})
    }
}

@Preview(name = "Network — can't reach", showBackground = true)
@Composable
private fun QueryErrorNetworkPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QueryErrorCard(render = previewRender(QueryErrorKind.Network), onRetry = {})
    }
}

@Preview(name = "Offline — last known", showBackground = true)
@Composable
private fun QueryErrorOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QueryErrorCard(render = previewRender(QueryErrorKind.Offline), onRetry = {})
    }
}
