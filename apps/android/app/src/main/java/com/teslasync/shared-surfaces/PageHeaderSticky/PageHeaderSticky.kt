// The native Jetpack Compose + Material 3 PageHeaderSticky shared surface — a parity port of
// web/src/components/layout/PageHeaderSticky.tsx. The web file is presentational layout chrome: an
// IntersectionObserver-driven bar that appears once the page "hero" (overview card) scrolls fully above the
// viewport, renders a compressed summary, and — when `scrollToTop` (default true) — turns the whole bar into a
// click-to-scroll-top button with a small up glyph. It renders nothing until the hero scrolls past
// (`if (!visible) return null`) and hides again when the hero re-enters view.
//
// This surface is the native equivalent. It performs NO HTTP and binds NO state holder (the web component fetches
// nothing; see PageHeaderStickyModel.kt for the honesty rationale and why the generic loading/error/stale/offline
// states do not apply to scroll-driven layout chrome). The stateful [PageHeaderSticky] derives visibility from a
// [LazyListState] — the platform IntersectionObserver equivalent — through the pure [snapshotFromHero] +
// [stickyHeaderVisible], records the one-shot PII-safe `view.opened` diagnostic (P1/S11) on first composition, and
// scrolls the list to the top when the bar is activated. The stateless [PageHeaderStickyContent] is the
// unit/UI-test + preview entry point and renders every visible state; when hidden it contributes zero layout
// rather than a blank box, faithful to the web `return null`. The bar is composed from the shared ui atoms
// (BodyText / Caption / Icon) + Material 3 surface/divider so the chrome stays correct across light / dark /
// high-contrast themes; the only string it renders beyond its props (the empty-body fallback) resolves through
// the i18n catalog (P1/S10). The scroll-to-top affordance is announced idiomatically as a Button on the
// [ariaLabel]-labelled bar (Material HIG), and the entrance honours reduced motion via the shared [FadeIn].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/PageHeaderSticky) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pageheadersticky

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.launch

/** Test tag identifying the sticky-bar region — the native mirror of the web `data-testid`. */
const val PAGE_HEADER_STICKY_TEST_TAG: String = "page-header-sticky"

/**
 * Stateful entry point — the faithful port of the web `PageHeaderSticky`. Derives visibility from [listState] (the
 * native IntersectionObserver: the bar appears once the hero item at [heroItemIndex] has scrolled fully above the
 * trigger line and hides when it re-enters), records the one-shot `view.opened` diagnostic (P1/S11) on first
 * composition, and — when activated — animates the list back to the top. Performs no HTTP and binds no state
 * holder; the page content is owned by the parent.
 *
 * @param listState the scroll state of the page's [androidx.compose.foundation.lazy.LazyColumn] (the scroll source).
 * @param ariaLabel the localized accessible name for the bar (web `ariaLabel`); supplied already-translated.
 * @param heroItemIndex the list index of the hero/overview item the bar tracks (web `targetId`); default 0.
 * @param topOffset the trigger-line inset from the top (web `topOffset`); default 0.
 * @param scrollToTop whether the bar is a scroll-to-top button with an up glyph (web `scrollToTop`); default true.
 * @param summary the compressed summary text shown in the bar (the common web `children`); blank ⇒ empty fallback.
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 * @param onScrollToTop overrides the default "animate the list to the top" action when the bar is activated.
 * @param content an arbitrary body slot (the faithful port of the web `children`); overrides [summary] when set.
 */
@Composable
fun PageHeaderSticky(
    listState: LazyListState,
    ariaLabel: String,
    modifier: Modifier = Modifier,
    heroItemIndex: Int = 0,
    topOffset: Dp = 0.dp,
    scrollToTop: Boolean = true,
    summary: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
    onScrollToTop: (() -> Unit)? = null,
    content: (@Composable RowScope.() -> Unit)? = null,
) {
    LaunchedEffect(Unit) { PageHeaderStickyDiagnostics.recordViewOpened(logger) }
    val scope = rememberCoroutineScope()
    val topOffsetPx = with(LocalDensity.current) { topOffset.roundToPx() }
    val visible by remember(listState, heroItemIndex, topOffsetPx) {
        derivedStateOf {
            val hero = listState.layoutInfo.visibleItemsInfo.firstOrNull { it.index == heroItemIndex }
            stickyHeaderVisible(
                snapshotFromHero(
                    heroItemIndex = heroItemIndex,
                    firstVisibleItemIndex = listState.firstVisibleItemIndex,
                    heroVisibleOffsetPx = hero?.offset,
                    topOffsetPx = topOffsetPx,
                ),
            )
        }
    }

    PageHeaderStickyContent(
        visible = visible,
        ariaLabel = ariaLabel,
        modifier = modifier,
        scrollToTop = scrollToTop,
        summary = summary,
        onScrollToTop = {
            val handler = onScrollToTop
            if (handler != null) handler() else scope.launch { listState.animateScrollToItem(0) }
        },
        content = content,
    )
}

/**
 * Stateless surface — the unit/UI-test and preview entry point. Renders the sticky bar whenever [visible] and
 * nothing at all when hidden — the faithful port of the web `if (!visible) return null`, contributing zero layout
 * rather than a blank box. The bar shows the [content] slot, else the flat [summary], else a localized empty
 * caption so it never paints a blank bar; the trailing up glyph and the whole-bar Button affordance appear only
 * when [scrollToTop]. The bar is a single merged accessibility node named by [ariaLabel] (plus the spoken body),
 * exposed as a Button when actionable.
 */
@Composable
fun PageHeaderStickyContent(
    visible: Boolean,
    ariaLabel: String,
    modifier: Modifier = Modifier,
    scrollToTop: Boolean = true,
    summary: String? = null,
    onScrollToTop: () -> Unit = {},
    content: (@Composable RowScope.() -> Unit)? = null,
) {
    if (!visible) return

    val render =
        classify(
            PageHeaderStickyInput(
                visible = visible,
                scrollToTop = scrollToTop,
                hasSummary = !summary.isNullOrBlank(),
                hasSlotContent = content != null,
            ),
        )
    val emptyFallback = stringResource(R.string.translation_common_noData)
    val spokenBody =
        when {
            render.showSummary -> summary
            render.showEmptyFallback -> emptyFallback
            else -> null
        }
    val spokenLabel = pageHeaderStickyLabel(ariaLabel, spokenBody)
    val clickModifier =
        if (render.clickable) {
            Modifier.clickable(role = Role.Button, onClick = onScrollToTop)
        } else {
            Modifier
        }
    val barModifier =
        Modifier
            .testTag(PAGE_HEADER_STICKY_TEST_TAG)
            .fillMaxWidth()
            .then(clickModifier)
            .semantics(mergeDescendants = true) { contentDescription = spokenLabel }

    FadeIn(modifier = modifier) {
        Surface(
            modifier = barModifier,
            color = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.onSurface,
            tonalElevation = Elevation.overlay,
        ) {
            Column {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.lg, vertical = Spacing.sm),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(
                        modifier = Modifier.weight(1f),
                        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        StickyBody(render = render, summary = summary, emptyFallback = emptyFallback, content = content)
                    }
                    if (render.showScrollToTop) {
                        Icon(
                            TeslaGlyphs.ChevronUp,
                            contentDescription = null,
                            size = IconSize.Sm,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}

/**
 * The bar's body region: the arbitrary [content] slot when supplied (web `children`), else the flat [summary]
 * truncated to one line (web `truncate`), else a localized [emptyFallback] caption so an empty body never renders
 * as a blank bar.
 */
@Composable
private fun RowScope.StickyBody(
    render: PageHeaderStickyRender,
    summary: String?,
    emptyFallback: String,
    content: (@Composable RowScope.() -> Unit)?,
) {
    when {
        content != null -> content()
        render.showSummary && summary != null ->
            BodyText(summary, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        else -> Caption(emptyFallback)
    }
}

// ── Previews — one per visible state (scroll-to-top default / no affordance / empty fallback). The hidden state
// renders nothing (faithful to the web `if (!visible) return null`), so it has no preview. The empty fallback
// resolves through the P1/S10 catalog; reduced motion keeps the entry animation from holding the preview clock. ──

private const val PREVIEW_SUMMARY = "Model Y · Last 30 days · All · 4 drives · avg B"

@Composable
private fun PreviewSurface(
    scrollToTop: Boolean = true,
    summary: String? = PREVIEW_SUMMARY,
) {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            PageHeaderStickyContent(
                visible = true,
                ariaLabel = "Drive history summary",
                scrollToTop = scrollToTop,
                summary = summary,
            )
        }
    }
}

@Preview(name = "PageHeaderSticky · scroll-to-top (default)", showBackground = true)
@Composable
private fun PageHeaderStickyScrollToTopPreview() {
    PreviewSurface(scrollToTop = true)
}

@Preview(name = "PageHeaderSticky · no affordance", showBackground = true)
@Composable
private fun PageHeaderStickyPlainPreview() {
    PreviewSurface(scrollToTop = false)
}

@Preview(name = "PageHeaderSticky · empty fallback", showBackground = true)
@Composable
private fun PageHeaderStickyEmptyPreview() {
    PreviewSurface(summary = null)
}
