// The native Jetpack Compose + Material 3 SectionErrorBoundary shared surface — a parity port of
// web/src/components/feedback/SectionErrorBoundary.tsx. The web surface is a STRUCTURAL guard: it wraps an
// arbitrary `children` subtree in `./ErrorBoundary` so a render failure inside one section does not bubble up
// and blank out the whole page. Its only own logic is choosing which fallback the wrapped boundary shows —
// the host's own `fallback` node, a `fallbackTitle` card, or (the default) the boundary's inline card with a
// working Retry — and while healthy it is transparent (it renders `children` and adds no chrome).
//
// This native surface keeps that contract end to end. Compose cannot intercept exceptions thrown during the
// composition phase the way a React error boundary can, so it composes the component-library
// `components/feedback/ErrorBoundary` atom (the native analogue of the web `./ErrorBoundary`, ADR-002): a
// child reports a failure into an [ErrorBoundaryState] and the boundary flips to its fallback. Over that
// primitive this surface reproduces every branch the web source draws — [SectionFallbackKind.Custom] /
// [SectionFallbackKind.Title] / [SectionFallbackKind.Inline] — selected by the pure [classifyFallback] in
// SectionErrorBoundaryModel.kt, and renders the healthy children unchanged when there is no error.
//
// It performs NO HTTP and binds NO data state holder (the web component fetches nothing; its only hook is
// `useTranslation` — the i18n catalog, P1/S10, resolved here at the render boundary). See
// SectionErrorBoundaryModel.kt for the honesty rationale and why the generic loading/empty/stale/offline
// states do not apply to a structural boundary. The chrome is composed from the shared component library (ui
// Button / Icon / TeslaGlyphs, feedback FeedbackGlyphs) over the per-theme TeslaTokens danger palette (P1/S9),
// so the tint stays correct across light / dark / high-contrast; every string resolves through the i18n
// catalog (P1/S10). The fallback's title + detail are exposed to TalkBack as one assertive announcement and
// the Retry button keeps its own label; a one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first
// composition and a PII-safe `caught` diagnostic (the web `componentDidCatch` log) fires when the boundary
// flips — carrying only the surface slug, the host `name` correlation id, and the error type, never the
// message or stack.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/SectionErrorBoundary) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.sectionerrorboundary

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.ErrorBoundary
import io.teslasync.android.components.feedback.ErrorBoundaryState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.rememberErrorBoundaryState
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying a fallback card container — used by the instrumented per-state + a11y UI tests. */
const val SECTION_ERROR_BOUNDARY_TEST_TAG: String = "section-error-boundary"

// Danger-card tints mapped off the single semantic danger token (web `border-tesla-red/20 bg-tesla-red/5`).
private const val CARD_BG_ALPHA = 0.05f
private const val CARD_BORDER_ALPHA = 0.20f
private val CARD_BORDER_WIDTH = 1.dp

// Web `truncate` clamps the inline error detail to a single line; a title card's subtitle may wrap to two.
private const val INLINE_DETAIL_MAX_LINES = 1
private const val TITLE_DETAIL_MAX_LINES = 2

/**
 * Stateful entry point — the faithful port of the web `SectionErrorBoundary`. Renders [content] while healthy
 * (the web `return children` path, adding no chrome) and flips to the resolved fallback once a child reports a
 * failure into [state] (the native error-capture idiom of the composed [ErrorBoundary] atom; web React error
 * boundaries auto-catch, Compose cannot). Records the one-shot `view.opened` diagnostic on first composition
 * and the PII-safe `caught` diagnostic when the boundary flips.
 *
 * @param name the host-chosen correlation id for log lines (web `name`, e.g. "BatteryDegradationChart").
 * @param state the error-capture handle a child reports failures into; defaults to a remembered instance.
 * @param fallbackTitle a custom inline title (web `fallbackTitle`); selects the title card when non-blank.
 * @param fallback the host's own fallback node (web `fallback`); when supplied it wins and shows no Retry.
 * @param logger the sanctioned redacting logger; defaults to the app's data container logger.
 * @param content the guarded subtree (web `children`), rendered unchanged while healthy.
 */
@Composable
fun SectionErrorBoundary(
    name: String,
    modifier: Modifier = Modifier,
    state: ErrorBoundaryState = rememberErrorBoundaryState(),
    fallbackTitle: String? = null,
    fallback: (@Composable () -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable () -> Unit,
) {
    LaunchedEffect(Unit) { SectionErrorBoundaryDiagnostics.recordViewOpened(logger) }

    val captured = state.error
    LaunchedEffect(captured, name) {
        if (captured != null) {
            SectionErrorBoundaryDiagnostics.recordCaught(logger, name, errorTypeOf(captured))
        }
    }

    ErrorBoundary(
        state = state,
        fallback = { throwable, reset ->
            SectionErrorFallback(
                kind = classifyFallback(hasCustomFallback = fallback != null, fallbackTitle = fallbackTitle),
                modifier = modifier,
                fallbackTitle = fallbackTitle,
                detailMessage = throwable.message,
                onRetry = reset,
                custom = fallback,
            )
        },
        content = content,
    )
}

/**
 * Stateless renderer for every fallback state — the unit/UI-test + preview entry point. Paints the resolved
 * [kind]: the host's [custom] node verbatim (web `fallback`), the [fallbackTitle] card (web `fallbackTitle`),
 * or the inline default card with a localized title, the captured [detailMessage], and a Retry wired to
 * [onRetry] (web `inline`). Never blank — a misused [SectionFallbackKind.Custom] with no [custom] node still
 * degrades to the inline card so the surface always shows something useful.
 */
@Composable
fun SectionErrorFallback(
    kind: SectionFallbackKind,
    modifier: Modifier = Modifier,
    fallbackTitle: String? = null,
    detailMessage: String? = null,
    onRetry: () -> Unit = {},
    custom: (@Composable () -> Unit)? = null,
) {
    val subtitle = stringResource(R.string.translation_errors_section_subtitle)
    val sectionTitle = stringResource(R.string.translation_errors_section_title)

    when (kind) {
        SectionFallbackKind.Custom ->
            if (custom != null) {
                custom()
            } else {
                SectionFallbackCard(
                    title = sectionTitle,
                    detail = inlineDetail(detailMessage, subtitle),
                    modifier = modifier,
                    onRetry = onRetry,
                    detailMaxLines = INLINE_DETAIL_MAX_LINES,
                )
            }

        SectionFallbackKind.Title ->
            SectionFallbackCard(
                title = fallbackTitle?.takeIf { it.isNotBlank() } ?: sectionTitle,
                detail = subtitle,
                modifier = modifier,
                detailMaxLines = TITLE_DETAIL_MAX_LINES,
            )

        SectionFallbackKind.Inline ->
            SectionFallbackCard(
                title = sectionTitle,
                detail = inlineDetail(detailMessage, subtitle),
                modifier = modifier,
                onRetry = onRetry,
                detailMaxLines = INLINE_DETAIL_MAX_LINES,
            )
    }
}

/**
 * The danger-tinted fallback card — the native mirror of the web boundary's rose-tinted inline `<div>`. A
 * leading alert glyph, a [title] + [detail] column announced to TalkBack as one assertive group (web
 * `role="alert"`), and — only when [onRetry] is supplied — the trailing Retry button (web `inline` branch).
 */
@Composable
private fun SectionFallbackCard(
    title: String,
    detail: String,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
    detailMaxLines: Int = TITLE_DETAIL_MAX_LINES,
) {
    val danger = TeslaTokens.status.danger
    val shape = RoundedCornerShape(Radius.md)
    val retryLabel = stringResource(R.string.translation_error_retry)
    val spoken = boundaryAccessibilityLabel(title = title, detail = detail, emptyFallback = detail)

    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(shape)
                .background(danger.copy(alpha = CARD_BG_ALPHA))
                .border(CARD_BORDER_WIDTH, danger.copy(alpha = CARD_BORDER_ALPHA), shape)
                .padding(Spacing.md)
                .testTag(SECTION_ERROR_BOUNDARY_TEST_TAG),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = TeslaGlyphs.Warning,
            contentDescription = null,
            size = IconSize.Lg,
            tint = danger,
        )

        Column(
            modifier =
                Modifier
                    .weight(1f)
                    .semantics(mergeDescendants = true) {
                        liveRegion = LiveRegionMode.Assertive
                        contentDescription = spoken
                    },
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = detail,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = detailMaxLines,
                overflow = TextOverflow.Ellipsis,
            )
        }

        if (onRetry != null) {
            Button(
                label = retryLabel,
                onClick = onRetry,
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                leadingIcon = FeedbackGlyphs.Refresh,
            )
        }
    }
}

// ── Previews (tooling-only; the sample titles / messages are never shipped UI) ────────────────────────────

private const val PREVIEW_TITLE = "Battery degradation chart failed"
private const val PREVIEW_MESSAGE = "Cannot read soc of undefined"
private const val PREVIEW_CUSTOM = "Host-supplied fallback node"

@Preview(name = "SectionErrorBoundary · inline default (retry)", showBackground = true)
@Composable
private fun SectionErrorBoundaryInlinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SectionErrorFallback(kind = SectionFallbackKind.Inline, detailMessage = PREVIEW_MESSAGE)
    }
}

@Preview(name = "SectionErrorBoundary · inline (no message → subtitle)", showBackground = true)
@Composable
private fun SectionErrorBoundaryInlineNoMessagePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SectionErrorFallback(kind = SectionFallbackKind.Inline, detailMessage = null)
    }
}

@Preview(name = "SectionErrorBoundary · title fallback (no retry)", showBackground = true)
@Composable
private fun SectionErrorBoundaryTitlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SectionErrorFallback(kind = SectionFallbackKind.Title, fallbackTitle = PREVIEW_TITLE)
    }
}

@Preview(name = "SectionErrorBoundary · custom fallback node", showBackground = true)
@Composable
private fun SectionErrorBoundaryCustomPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SectionErrorFallback(
            kind = SectionFallbackKind.Custom,
            custom = { Text(PREVIEW_CUSTOM) },
        )
    }
}
