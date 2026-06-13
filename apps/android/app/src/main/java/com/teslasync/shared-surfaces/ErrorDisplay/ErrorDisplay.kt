// The native Jetpack Compose + Material 3 ErrorDisplay shared surface — a parity port of
// web/src/components/feedback/ErrorDisplay.tsx (and its internal `_ErrorState` chrome). The web component is
// a status-aware error banner: an icon + title + message + optional CTA in a rose-tinted card, branching on
// `ApiError.status` (404 / 401·403 / 5xx / network·offline) with a `compact` variant for inline contexts.
//
// This surface is the native equivalent. All data flows through the shared [ErrorDisplayViewModel] over the
// [ErrorDisplaySource] seam (P1/S8) — the view performs NO HTTP and reads no store directly. Every
// derivation flows through the pure [ErrorDisplayProjection]; the composable is a thin render layer. The
// faithful mapping of the web behaviour:
//   • the `error` prop (web branches on `isApiError(error) ? error.status`) → the injected [source]'s feed
//     failure, folded by the ViewModel into the [ErrorDisplayViewModel.snapshot] flow (never HTTP from view).
//   • `useOnlineStatus()` → the [ErrorDisplaySource.online] flow, combined into the snapshot.
//   • the web branch precedence (404 → 401/403 → 5xx → offline → network) → [ErrorBranch], each driving the
//     icon, the localized title + message, and the CTA.
//   • the web `_ErrorState` rose card (`border-rose-500/20 bg-rose-500/5`, rose icon box, rose title +
//     70%-opacity message) → the native danger-tinted card below; the `compact` variant tightens padding.
//   • the web `role` / `aria-live` (offline → status/polite, otherwise alert/assertive) → a polite/assertive
//     live region on the merged title+message group.
//   • the web `action` button (`navigate(listHref)` / `/login` / `onRetry`) → the [Button], wired to the
//     host [onBackToList] / [onSignIn] callbacks and the ViewModel's self-contained [ErrorDisplayViewModel.retry].
//   • the web `if (!error) return null` → this surface renders nothing when there is no failure.
//
// States reproduced (every error state renders a non-blank, labelled banner): not-found (404), unauthorized
// (401/403), server error (5xx), offline (no connectivity / transport failure — disabled "Retry when
// online"), and network (reachable-but-failed). The one-shot `view.opened` diagnostic (P1/S11) is emitted on
// first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ErrorDisplay) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.errordisplay

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the banner container — used by the instrumented per-state + a11y UI tests. */
const val ERROR_DISPLAY_TEST_TAG: String = "error-display"

// Rose-card tints mapped off the single semantic danger token (web rose-500 at low opacity / rose-300).
private const val CARD_BG_ALPHA = 0.06f
private const val CARD_BORDER_ALPHA = 0.22f
private const val ICON_BOX_ALPHA = 0.12f
private const val MESSAGE_ALPHA = 0.75f
private val CARD_BORDER_WIDTH = 1.dp

/**
 * Stateful entry point bound to the shared failure feed — the faithful port of the web `ErrorDisplay`
 * branching on an `error` + `useOnlineStatus()`. Binds the [ErrorDisplayViewModel] for [vehicleId], records
 * the one-shot `view.opened` diagnostic (P1/S11), collects the live failure snapshot, projects it, and paints
 * the stateless banner — rendering nothing when there is no failure (web `return null`).
 *
 * @param vehicleId the vehicle whose feed failures are surfaced (web `useChargingHistory(id)`).
 * @param source the shared failure + connectivity seam (a `ChargingStore`/`ChargingRepository` adapter).
 * @param modifier optional layout modifier for the banner container.
 * @param compact tighter padding for inline mutation errors (web `compact`).
 * @param resourceName singular name of the resource for the 404 title (web `resourceName`); defaults to
 *   the localized "Resource".
 * @param retryable whether the 5xx / network / offline retry CTA is offered (web `onRetry` presence).
 * @param onBackToList host navigation to the list view; its presence renders the 404 CTA (web `listHref`).
 * @param onSignIn host navigation to sign-in (web 401/403 → `/login`).
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun ErrorDisplay(
    vehicleId: Long,
    source: ErrorDisplaySource,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    resourceName: String? = null,
    retryable: Boolean = true,
    onBackToList: (() -> Unit)? = null,
    onSignIn: (() -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: ErrorDisplayViewModel =
        viewModel(
            key = ErrorDisplayRegistration.ID + ":" + vehicleId,
            factory = ErrorDisplayViewModel.factory(source, logger, vehicleId),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val snapshot by viewModel.snapshot.collectAsStateWithLifecycle()

    val render =
        ErrorDisplayProjection.render(
            snapshot = snapshot,
            hasListHref = onBackToList != null,
            retryable = retryable,
        ) ?: return

    ErrorDisplayCard(
        render = render,
        modifier = modifier,
        compact = compact,
        resourceName = resourceName,
        onAction = { kind ->
            when (kind) {
                ErrorActionKind.BackToList -> onBackToList?.invoke()
                ErrorActionKind.SignIn -> onSignIn?.invoke()
                ErrorActionKind.Retry -> viewModel.retry()
                ErrorActionKind.RetryWhenOnline -> Unit
            }
        },
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the rose-tinted error card from a
 * fully resolved [render]: a danger-tinted icon box, the localized title + message (announced as one
 * polite/assertive live region, web `role`/`aria-live`), and the optional CTA [Button] (web `_ErrorState`
 * action). Never blank — an [ErrorRender] always describes a complete banner.
 */
@Composable
fun ErrorDisplayCard(
    render: ErrorRender,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    resourceName: String? = null,
    onAction: (ErrorActionKind) -> Unit = {},
) {
    val danger = TeslaTokens.status.danger
    val cardShape = RoundedCornerShape(Radius.md)
    val liveMode = if (render.assertive) LiveRegionMode.Assertive else LiveRegionMode.Polite

    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(cardShape)
                .background(danger.copy(alpha = CARD_BG_ALPHA))
                .border(CARD_BORDER_WIDTH, danger.copy(alpha = CARD_BORDER_ALPHA), cardShape)
                .padding(if (compact) Spacing.md else Spacing.lg)
                .testTag(ERROR_DISPLAY_TEST_TAG),
        horizontalArrangement = Arrangement.spacedBy(if (compact) Spacing.sm else Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            modifier =
                Modifier
                    .clip(RoundedCornerShape(Radius.sm))
                    .background(danger.copy(alpha = ICON_BOX_ALPHA))
                    .padding(if (compact) Spacing.xs else Spacing.sm),
        ) {
            Icon(
                imageVector = glyphVector(render.glyph),
                contentDescription = null,
                size = if (compact) IconSize.Sm else IconSize.Md,
                tint = danger,
            )
        }

        Column(
            modifier =
                Modifier
                    .weight(1f)
                    .semantics(mergeDescendants = true) { liveRegion = liveMode },
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Text(
                text = titleText(render.branch, resourceName),
                style = if (compact) MaterialTheme.typography.labelMedium else MaterialTheme.typography.labelLarge,
                color = danger,
            )
            Text(
                text = messageText(render.branch),
                style = if (compact) MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyMedium,
                color = danger.copy(alpha = MESSAGE_ALPHA),
            )
        }

        render.action?.let { action ->
            Button(
                label = actionLabel(action.kind),
                onClick = { onAction(action.kind) },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                enabled = action.enabled,
            )
        }
    }
}

/** Resolves a branch to its localized title (web per-branch title); 404 interpolates the resource name. */
@Composable
private fun titleText(
    branch: ErrorBranch,
    resourceName: String?,
): String =
    when (branch) {
        ErrorBranch.NotFound -> {
            val thing = resourceName ?: stringResource(R.string.translation_error_notFound_thingDefault)
            stringResource(R.string.translation_error_notFound_title, thing)
        }
        ErrorBranch.Unauthorized -> stringResource(R.string.translation_error_unauthorized_title)
        ErrorBranch.ServerError -> stringResource(R.string.translation_error_serverError_title)
        ErrorBranch.Offline -> stringResource(R.string.translation_error_network_offlineTitle)
        ErrorBranch.Network -> stringResource(R.string.translation_error_network_title)
    }

/** Resolves a branch to its localized message (web per-branch detail copy). */
@Composable
private fun messageText(branch: ErrorBranch): String =
    when (branch) {
        ErrorBranch.NotFound -> stringResource(R.string.translation_error_notFound_message)
        ErrorBranch.Unauthorized -> stringResource(R.string.translation_error_unauthorized_message)
        ErrorBranch.ServerError -> stringResource(R.string.translation_error_serverError_message)
        ErrorBranch.Offline -> stringResource(R.string.translation_error_network_offlineDetail)
        ErrorBranch.Network -> stringResource(R.string.translation_error_network_message)
    }

/** Resolves a CTA to its localized label (web per-branch button copy). */
@Composable
private fun actionLabel(kind: ErrorActionKind): String =
    when (kind) {
        ErrorActionKind.BackToList -> stringResource(R.string.translation_error_notFound_cta)
        ErrorActionKind.SignIn -> stringResource(R.string.translation_error_unauthorized_cta)
        ErrorActionKind.Retry -> stringResource(R.string.translation_error_retry)
        ErrorActionKind.RetryWhenOnline -> stringResource(R.string.translation_error_network_retryWhenOnline)
    }

/** Maps a model glyph to its concrete vector — reusing the feedback set where it ships the icon. */
private fun glyphVector(glyph: ErrorGlyph): ImageVector =
    when (glyph) {
        ErrorGlyph.FileQuestion -> FileQuestionGlyph
        ErrorGlyph.Lock -> FeedbackGlyphs.Lock
        ErrorGlyph.Server -> ServerGlyph
        ErrorGlyph.WifiOff -> FeedbackGlyphs.WifiOff
        ErrorGlyph.AlertCircle -> AlertCircleGlyph
    }

// ── Surface-local glyphs ───────────────────────────────────────────────────────────────────────────────
// The web library uses `lucide-react`; the FileQuestion / Server / AlertCircle glyphs the banner needs are
// not in `FeedbackGlyphs`, so they are authored here as 24×24 stroked vectors (the same pattern the sibling
// DataFreshness surface uses for its `WifiOn` glyph). Each is monochrome and recolored at render time by the
// `Icon` tint.

/** The web `AlertCircle` glyph — a ringed "!" for the reachable-but-failed network branch. */
private val AlertCircleGlyph: ImageVector =
    strokedGlyph("AlertCircle") {
        moveTo(2f, 12f)
        arcTo(10f, 10f, 0f, false, true, 22f, 12f)
        arcTo(10f, 10f, 0f, false, true, 2f, 12f)
        close()
        moveTo(12f, 7f)
        lineTo(12f, 13f)
        dot(12f, 16.5f)
    }

/** The web `Server` glyph — two stacked racks with a status light, for the 5xx branch. */
private val ServerGlyph: ImageVector =
    strokedGlyph("Server") {
        rect(3f, 4f, 21f, 10f)
        rect(3f, 14f, 21f, 20f)
        dot(7f, 7f)
        dot(7f, 17f)
    }

/** The web `FileQuestion` glyph — a document with a "?" for the 404 branch. */
private val FileQuestionGlyph: ImageVector =
    strokedGlyph("FileQuestion") {
        moveTo(6f, 3f)
        lineTo(13f, 3f)
        lineTo(18f, 8f)
        lineTo(18f, 21f)
        lineTo(6f, 21f)
        close()
        moveTo(13f, 3f)
        lineTo(13f, 8f)
        lineTo(18f, 8f)
        moveTo(9.6f, 11f)
        curveTo(9.6f, 9.4f, 11f, 8.6f, 12.2f, 9f)
        curveTo(13.5f, 9.4f, 13.6f, 11f, 12.4f, 11.7f)
        curveTo(11.9f, 12f, 11.8f, 12.4f, 11.8f, 13.1f)
        dot(11.8f, 16f)
    }

private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
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
                pathBuilder = build,
            )
        }.build()

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]). */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

/** Axis-aligned rectangle from ([left], [top]) to ([right], [bottom]). */
private fun PathBuilder.rect(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
) {
    moveTo(left, top)
    lineTo(right, top)
    lineTo(right, bottom)
    lineTo(left, bottom)
    close()
}

// ── Previews (tooling-only; the sample failures are never shipped UI) ─────────────────────────────────────

private fun previewRender(
    httpStatus: Int?,
    transportFailure: Boolean = false,
    online: Boolean = true,
    hasListHref: Boolean = false,
): ErrorRender =
    requireNotNull(
        ErrorDisplayProjection.render(
            snapshot =
                ErrorSnapshot(
                    present = true,
                    httpStatus = httpStatus,
                    transportFailure = transportFailure,
                    online = online,
                ),
            hasListHref = hasListHref,
            retryable = true,
        ),
    )

@Preview(name = "Not found — 404", showBackground = true)
@Composable
private fun ErrorDisplayNotFoundPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ErrorDisplayCard(render = previewRender(httpStatus = 404, hasListHref = true))
    }
}

@Preview(name = "Unauthorized — 401", showBackground = true)
@Composable
private fun ErrorDisplayUnauthorizedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ErrorDisplayCard(render = previewRender(httpStatus = 401))
    }
}

@Preview(name = "Server error — 5xx", showBackground = true)
@Composable
private fun ErrorDisplayServerErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ErrorDisplayCard(render = previewRender(httpStatus = 503))
    }
}

@Preview(name = "Offline — last known", showBackground = true)
@Composable
private fun ErrorDisplayOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ErrorDisplayCard(render = previewRender(httpStatus = null, transportFailure = true, online = false))
    }
}

@Preview(name = "Network — can't reach", showBackground = true)
@Composable
private fun ErrorDisplayNetworkPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ErrorDisplayCard(render = previewRender(httpStatus = null, online = true))
    }
}

@Preview(name = "Compact — inline", showBackground = true)
@Composable
private fun ErrorDisplayCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ErrorDisplayCard(render = previewRender(httpStatus = 503), compact = true)
    }
}
