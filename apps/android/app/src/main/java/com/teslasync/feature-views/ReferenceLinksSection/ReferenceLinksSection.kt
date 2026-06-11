// The native Jetpack Compose + Material 3 Reference Links feature view — a parity port of
// web/src/features/admin/components/devtools/ReferenceLinksSection.tsx, which maps the static
// REFERENCE_LINKS constant into a responsive grid of `GlassPanel` cards, each an external `<a>` wrapping a
// tinted-cyan icon box + a title + the muted, truncated URL. The web grid is `grid gap-4 sm:grid-cols-2
// lg:grid-cols-4` and binds no data feed (only `useTranslation`), so the native surface has a single
// rendered state — there is no skeleton / error / stale / offline branch in the source to reproduce. The
// grid is list-shaped, so the (never-empty) bundled list is still guarded by a friendly empty state rather
// than a blank box.
//
// Tap behaviour mirrors the web `target="_blank"` anchor: the whole card is one TalkBack node and one tap
// target that opens the external URL. The open is hoisted via [onOpenUrl] (default: the Compose
// `LocalUriHandler`, i.e. a Custom Tab / browser) so the view performs no side effect itself and stays
// unit/UI-testable; the host may inject its own opener. The holder records the one-shot `view.opened`
// diagnostic. Every title resolves through the i18n facade (see [rememberReferenceLinkStrings]).
//
// Glyphs: the web lucide icons are BookOpen / Globe / ExternalLink / Radio. `ExternalLink` already exists in
// the shared `DataDisplayGlyphs`, so it is reused; the other three are absent from every shared catalog and
// the surface's allowed-files scope forbids editing those shared files, so they are authored locally below
// as 24×24 stroked vectors (the same approach the shared glyph sets and the NotificationStats widget take).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ReferenceLinksSection) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.referencelinks

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// Footprint of the tinted icon box — the web `h-9 w-9 rounded-lg` wrapper around an `h-4 w-4` glyph; the
// shared IconBox `Md` (40 dp) is the standard size closest to the web 36 px box.
private val ICON_BOX_SIZE = IconBoxSize.Md

private const val TITLE_MAX_LINES = 1
private const val URL_MAX_LINES = 1

/**
 * Stateful entry point. Spins up the [ReferenceLinksSectionViewModel] (carrying only the `view.opened`
 * diagnostic — this surface binds no feed), records that diagnostic once, resolves the localized strings,
 * and renders the responsive reference-link grid. A host supplies the current [width] bucket (mapped from
 * its Material 3 `WindowWidthSizeClass`), an optional [onOpenUrl] opener, and a unique [instanceKey].
 *
 * @param width the responsive width bucket driving the column count (web `sm:` / `lg:` breakpoints).
 * @param onOpenUrl invoked with the tapped link's URL; defaults to the Compose `LocalUriHandler` opener.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ReferenceLinksSection(
    modifier: Modifier = Modifier,
    width: ReferenceLinksWidth = ReferenceLinksWidth.Compact,
    onOpenUrl: ((String) -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = ReferenceLinksRegistration.SLUG,
) {
    val viewModel: ReferenceLinksSectionViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { ReferenceLinksSectionViewModel(logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val uriHandler = LocalUriHandler.current
    val openUrl = onOpenUrl ?: { url -> uriHandler.openUri(url) }

    ReferenceLinksSectionContent(
        strings = rememberReferenceLinkStrings(),
        width = width,
        onOpenUrl = openUrl,
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/UI-test entry point. Projects [strings] into the reference cards and lays
 * them out per [ReferenceLinksProjection.columnCount] (web `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`). A
 * trailing partial row is padded with weighted spacers so every card keeps a uniform width. If the projected
 * list is ever empty the surface shows a friendly empty state instead of a blank box; the web source renders
 * the grid unconditionally and has no other state.
 */
@Composable
fun ReferenceLinksSectionContent(
    strings: ReferenceLinkStrings,
    width: ReferenceLinksWidth,
    onOpenUrl: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val items = remember(strings) { ReferenceLinksProjection.items(strings) }
    if (items.isEmpty()) {
        EmptyState(message = strings.emptyMessage, modifier = modifier.fillMaxWidth())
    } else {
        val columns = ReferenceLinksProjection.columnCount(width)
        Column(
            modifier = modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            items.chunked(columns).forEach { rowItems ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
                ) {
                    rowItems.forEach { item ->
                        ReferenceLinkCard(item = item, onOpenUrl = onOpenUrl, modifier = Modifier.weight(1f))
                    }
                    repeat(columns - rowItems.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * One reference card — the web per-link `GlassPanel` wrapping an external anchor. The whole card is a single
 * merged TalkBack node (its folded [ReferenceLinkItem.contentDescription]) and one tap target with the
 * Button role; activating it opens the link's URL. A tinted-cyan [IconBox] (web `ICON_COLOR_MAP.cyan`) holds
 * the glyph, beside the title and the muted, single-line truncated URL.
 */
@Composable
private fun ReferenceLinkCard(
    item: ReferenceLinkItem,
    onOpenUrl: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    GlassPanel(
        modifier =
            modifier
                .semantics(mergeDescendants = true) { contentDescription = item.contentDescription }
                .clickable(role = Role.Button, onClickLabel = item.title) { onOpenUrl(item.url) },
        padding = PanelPadding.Lg,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            IconBox(tone = IconBoxTone.Primary, size = ICON_BOX_SIZE) {
                Icon(imageVector = glyphFor(item.glyph), contentDescription = null, size = IconSize.Md)
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Heading(text = item.title, level = HeadingLevel.Sub, maxLines = TITLE_MAX_LINES)
                BodyText(
                    text = item.url,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = URL_MAX_LINES,
                )
            }
        }
    }
}

/**
 * Maps a [ReferenceLinkGlyph] onto its glyph — the native analogues of the web lucide icons. `ExternalLink`
 * reuses the shared [DataDisplayGlyphs]; the other three are the locally authored [ReferenceLinkGlyphs].
 */
private fun glyphFor(glyph: ReferenceLinkGlyph): ImageVector =
    when (glyph) {
        ReferenceLinkGlyph.BookOpen -> ReferenceLinkGlyphs.BookOpen
        ReferenceLinkGlyph.Globe -> ReferenceLinkGlyphs.Globe
        ReferenceLinkGlyph.ExternalLink -> DataDisplayGlyphs.ExternalLink
        ReferenceLinkGlyph.Radio -> ReferenceLinkGlyphs.Radio
    }

/**
 * Builds the localized [ReferenceLinkStrings] from the i18n facade (P1/S10). Each title resolves through the
 * canonical generated-catalog key by name (web `t('devtools.ref.…')`) via [resolveOptional] over an optional
 * by-name lookup, falling back to the documented [ReferenceLinkDefaults] for the keys the catalog does not
 * (yet) define — see the model header for why those keys are currently absent. The empty-state message uses
 * the existing `common.noData` catalog key. Remembered against the resolved strings so a locale change
 * re-projects the surface.
 */
@Composable
private fun rememberReferenceLinkStrings(): ReferenceLinkStrings {
    val context = LocalContext.current
    val emptyMessage = stringResource(R.string.translation_common_noData)
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    val fleetOverview =
        resolveOptional(
            lookup,
            ReferenceLinkTarget.FLEET_OVERVIEW.androidResourceName,
            ReferenceLinkDefaults.FLEET_OVERVIEW_TITLE,
        )
    val partnerEndpoints =
        resolveOptional(
            lookup,
            ReferenceLinkTarget.PARTNER_ENDPOINTS.androidResourceName,
            ReferenceLinkDefaults.PARTNER_ENDPOINTS_TITLE,
        )
    val devPortal =
        resolveOptional(
            lookup,
            ReferenceLinkTarget.DEV_PORTAL.androidResourceName,
            ReferenceLinkDefaults.DEV_PORTAL_TITLE,
        )
    val telemetryGuide =
        resolveOptional(
            lookup,
            ReferenceLinkTarget.TELEMETRY_GUIDE.androidResourceName,
            ReferenceLinkDefaults.TELEMETRY_GUIDE_TITLE,
        )
    return remember(fleetOverview, partnerEndpoints, devPortal, telemetryGuide, emptyMessage) {
        ReferenceLinkStrings(
            fleetOverviewTitle = fleetOverview,
            partnerEndpointsTitle = partnerEndpoints,
            devPortalTitle = devPortal,
            telemetryGuideTitle = telemetryGuide,
            emptyMessage = emptyMessage,
        )
    }
}

/**
 * Optional by-name read from the Android string catalog — the production seam [resolveOptional] uses to
 * reproduce web `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a
 * compile-time `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi`
 * is suppressed. Release builds keep resource names (resource shrinking is off — see app/build.gradle.kts),
 * so the by-name lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

/**
 * Locally authored line-style glyphs for the three web lucide icons absent from the shared catalogs
 * (BookOpen, Globe, Radio), drawn as 24×24 stroked [ImageVector]s and recolored at render time by the [Icon]
 * tint. `ExternalLink` is reused from the shared [DataDisplayGlyphs] rather than redrawn.
 */
private object ReferenceLinkGlyphs {
    /** Open-book glyph (lucide `book-open`) — the Fleet API overview card. */
    val BookOpen: ImageVector =
        referenceLinkStroked("ReferenceLinksBookOpen") {
            moveTo(12f, 7f)
            lineTo(12f, 20f)
            moveTo(12f, 7f)
            curveTo(12f, 5.3f, 9f, 4.5f, 4f, 4.5f)
            lineTo(4f, 17f)
            curveTo(8.5f, 17f, 11f, 17.8f, 12f, 19f)
            moveTo(12f, 7f)
            curveTo(12f, 5.3f, 15f, 4.5f, 20f, 4.5f)
            lineTo(20f, 17f)
            curveTo(15.5f, 17f, 13f, 17.8f, 12f, 19f)
        }

    /** Globe glyph (lucide `globe`) — the partner-endpoints card. */
    val Globe: ImageVector =
        referenceLinkStroked("ReferenceLinksGlobe") {
            referenceLinkCircle(12f, 12f, 9f)
            moveTo(3f, 12f)
            lineTo(21f, 12f)
            moveTo(12f, 3f)
            curveTo(7.5f, 7f, 7.5f, 17f, 12f, 21f)
            moveTo(12f, 3f)
            curveTo(16.5f, 7f, 16.5f, 17f, 12f, 21f)
        }

    /** Broadcast glyph (lucide `radio`) — the Fleet Telemetry card. */
    val Radio: ImageVector =
        referenceLinkStroked("ReferenceLinksRadio") {
            moveTo(4.9f, 19.1f)
            curveTo(1f, 15.2f, 1f, 8.8f, 4.9f, 4.9f)
            moveTo(7.8f, 16.2f)
            curveToRelative(-2.3f, -2.3f, -2.3f, -6.1f, 0f, -8.5f)
            moveTo(14f, 12f)
            arcToRelative(2f, 2f, 0f, true, true, -4f, 0f)
            arcToRelative(2f, 2f, 0f, true, true, 4f, 0f)
            close()
            moveTo(16.2f, 7.8f)
            curveToRelative(2.3f, 2.3f, 2.3f, 6.1f, 0f, 8.5f)
            moveTo(19.1f, 4.9f)
            curveTo(23f, 8.8f, 23f, 15.1f, 19.1f, 19f)
        }
}

private fun referenceLinkStroked(
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

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.referenceLinkCircle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}
