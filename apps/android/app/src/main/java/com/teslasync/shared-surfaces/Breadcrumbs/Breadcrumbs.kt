// The native Jetpack Compose + Material 3 Breadcrumbs shared surface — a parity port of
// web/src/components/layout/Breadcrumbs.tsx. The web surface is layout chrome: a horizontal, horizontally
// scrollable trail of navigation segments — a leading Home icon link, then each entry separated by a chevron,
// rendered as a tappable link (non-last entries with an href) or the emphasized current-page label (the last
// entry, or any entry with no href). Interior entries collapse to a "…" indicator on a narrow viewport.
//
// This native surface keeps that contract end to end and renders every branch the web source draws (see
// BreadcrumbsModel.kt for the exhaustive branch list + the honesty rationale for why the generic
// loading/error/stale/offline states do not apply to controlled, prop-driven chrome). It performs NO HTTP and
// binds NO state holder; navigation is delegated to the parent through the [onNavigate] callback (the native
// analogue of the web `<PrefetchLink to=…>`), exactly as the sibling GuardedLink surface delegates `onNavigate`
// rather than touching a NavHostController — keeping the surface unit-testable. The only strings it renders
// beyond its caller-supplied trail (the nav landmark label, the Home link label, and the blank-label fallback)
// resolve through the i18n catalog (P1/S10); chrome is composed from the shared ui atoms (Icon) and the theme
// tokens (P1/S9) so the muted/secondary tints stay correct across light / dark / high-contrast. The container
// carries the localized "Breadcrumb" landmark label, the Home link and every link crumb carry their own
// accessible name + button role, and a one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first
// composition. All derivation flows through the pure [classify] in BreadcrumbsModel.kt.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Breadcrumbs) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.breadcrumbs

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Default destination of the leading Home link (web `homeHref = '/'`). */
const val BREADCRUMBS_DEFAULT_HOME_HREF: String = "/"

/**
 * Below this available width the trail is treated as compact and interior crumbs collapse to a "…" indicator —
 * the platform-idiomatic analogue of the web `sm` (640 px) media query, pinned to the Material 3 compact
 * window-width boundary (< 600 dp) so the behaviour follows the native size class rather than a ported pixel.
 */
private val COMPACT_BREAKPOINT: Dp = 600.dp

/** Per-crumb max width before the label truncates with an ellipsis (web `truncate max-w-[200px]`). */
private val CRUMB_MAX_WIDTH: Dp = 200.dp

/** The collapsed-middle indicator glyph (web aria-hidden `…`); decorative, hidden from assistive tech. */
private const val COLLAPSED_INDICATOR: String = "\u2026"

/**
 * Stateful entry point — the faithful port of the web `Breadcrumbs`. Records the one-shot `view.opened`
 * diagnostic (P1/S11) on first composition and renders the trail. Performs no HTTP and binds no state holder;
 * the trail is owned by the parent, and navigation is delegated to [onNavigate]. When [items] has fewer than
 * [MIN_VISIBLE_CRUMBS] entries the surface renders nothing, reproducing the web `if (items.length <= 1) return
 * null` contract.
 *
 * @param items the breadcrumb trail, root-first (web `items`).
 * @param onNavigate invoked with a crumb's (or the Home link's) href when the user taps it — the parent performs
 *   the actual navigation (web `<PrefetchLink to=href>`).
 * @param homeHref destination of the leading Home link (web `homeHref`); defaults to [BREADCRUMBS_DEFAULT_HOME_HREF].
 * @param homeAriaLabel accessibility label for the Home link (web `homeAriaLabel`); blank ⇒ the localized
 *   `a11y.breadcrumbHome` ("Dashboard").
 * @param logger the sanctioned redacting logger the `view.opened` diagnostic is emitted through; defaults to the
 *   app's [LocalDataContainer].
 */
@Composable
fun Breadcrumbs(
    items: List<BreadcrumbItem>,
    onNavigate: (String) -> Unit,
    modifier: Modifier = Modifier,
    homeHref: String = BREADCRUMBS_DEFAULT_HOME_HREF,
    homeAriaLabel: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { BreadcrumbsDiagnostics.recordViewOpened(logger) }
    BreadcrumbsContent(
        items = items,
        onNavigate = onNavigate,
        modifier = modifier,
        homeHref = homeHref,
        homeAriaLabel = homeAriaLabel,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Classifies [items] via [classify] for the
 * current viewport width and, when the trail is visible, draws the leading Home link followed by each crumb
 * (separator + link / current label / collapsed indicator). Renders nothing when the trail is degenerate
 * (web `return null`). The Row scrolls horizontally for long trails (web `overflow-x-auto`).
 */
@Composable
fun BreadcrumbsContent(
    items: List<BreadcrumbItem>,
    onNavigate: (String) -> Unit,
    modifier: Modifier = Modifier,
    homeHref: String = BREADCRUMBS_DEFAULT_HOME_HREF,
    homeAriaLabel: String? = null,
) {
    val navLabel = stringResource(R.string.translation_a11y_breadcrumb)
    val homeLabel = resolveHomeAriaLabel(homeAriaLabel, stringResource(R.string.translation_a11y_breadcrumbHome))
    val blankFallback = stringResource(R.string.translation_common_noData)

    BoxWithConstraints(modifier = modifier) {
        val render = classify(items, compact = maxWidth < COMPACT_BREAKPOINT, blankLabelFallback = blankFallback)
        if (!render.visible) return@BoxWithConstraints

        Row(
            modifier =
                Modifier
                    .horizontalScroll(rememberScrollState())
                    .semantics { contentDescription = navLabel },
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HomeCrumb(homeLabel = homeLabel, onClick = { onNavigate(homeHref) })
            render.crumbs.forEach { crumb ->
                CrumbSeparator()
                Crumb(crumb = crumb, onNavigate = onNavigate)
            }
        }
    }
}

/**
 * One trail entry: the collapsed indicator when the entry is hidden on a narrow viewport, otherwise its label
 * — tappable (web `<PrefetchLink>`) only for a [CrumbRole.Link] with an href. The href is captured into a local
 * so it smart-casts inside the navigation lambda.
 */
@Composable
private fun Crumb(
    crumb: BreadcrumbCrumb,
    onNavigate: (String) -> Unit,
) {
    if (crumb.showEllipsis) {
        CollapsedIndicator()
        return
    }
    val href = crumb.href
    val onClick: (() -> Unit)? =
        if (crumb.role == CrumbRole.Link && href != null) {
            { onNavigate(href) }
        } else {
            null
        }
    CrumbLabel(crumb = crumb, onClick = onClick)
}

/** The leading Home icon link (web `<PrefetchLink to={homeHref}><Home/></PrefetchLink>`). */
@Composable
private fun HomeCrumb(
    homeLabel: String,
    onClick: () -> Unit,
) {
    Icon(
        imageVector = HomeGlyph,
        contentDescription = homeLabel,
        modifier = Modifier.clickable(role = Role.Button, onClick = onClick),
        size = IconSize.Sm,
        tint = MaterialTheme.colorScheme.outlineVariant,
    )
}

/** The chevron drawn before every crumb (web `<ChevronRight/>`); decorative. */
@Composable
private fun CrumbSeparator() {
    Icon(
        imageVector = TeslaGlyphs.ChevronRight,
        contentDescription = null,
        size = IconSize.Xs,
        tint = MaterialTheme.colorScheme.outlineVariant,
    )
}

/**
 * One trail label: a tappable link when [onClick] is supplied (web `<PrefetchLink>`), else the current-page
 * label (web `<span>`). The last entry is emphasized (secondary tint + medium weight); other entries use the
 * muted tint. Labels truncate at [CRUMB_MAX_WIDTH] (web `truncate max-w-[200px]`).
 */
@Composable
private fun CrumbLabel(
    crumb: BreadcrumbCrumb,
    onClick: (() -> Unit)?,
) {
    val isEmphasized = crumb.role == CrumbRole.Current && crumb.isLast
    val color =
        if (isEmphasized) {
            MaterialTheme.colorScheme.onSurfaceVariant
        } else {
            MaterialTheme.colorScheme.outlineVariant
        }
    val style =
        MaterialTheme.typography.bodyMedium.let {
            if (isEmphasized) it.copy(fontWeight = FontWeight.Medium) else it
        }
    val clickModifier =
        if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier
    Text(
        text = crumb.label,
        modifier = clickModifier.widthIn(max = CRUMB_MAX_WIDTH),
        color = color,
        style = style,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** The collapsed-middle "…" indicator shown on a narrow viewport (web `sm:hidden …`); hidden from assistive tech. */
@Composable
private fun CollapsedIndicator() {
    Text(
        text = COLLAPSED_INDICATOR,
        modifier = Modifier.clearAndSetSemantics { },
        color = MaterialTheme.colorScheme.outlineVariant,
        style = MaterialTheme.typography.bodyMedium,
    )
}

/**
 * Self-contained "home" glyph in the same 24×24 stroked style as [TeslaGlyphs] (lucide-parity), authored here
 * because the shared glyph set does not ship a Home icon and the surface's allowed files do not include it.
 * Monochrome; recolored at render time by [Icon]'s `tint`.
 */
private val HomeGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "Home",
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
                moveTo(3f, 10.5f)
                lineTo(12f, 3.5f)
                lineTo(21f, 10.5f)
                moveTo(5f, 9f)
                lineTo(5f, 20f)
                lineTo(19f, 20f)
                lineTo(19f, 9f)
                moveTo(9.5f, 20f)
                lineTo(9.5f, 14f)
                lineTo(14.5f, 14f)
                lineTo(14.5f, 20f)
            }
        }.build()

// ── Previews — the full trail, the link + current branches, the compact collapse, and the minimal trail. ──────

private val SAMPLE_TRAIL =
    listOf(
        BreadcrumbItem(label = "Vehicles", href = "/vehicles"),
        BreadcrumbItem(label = "Model 3", href = "/vehicles/1"),
        BreadcrumbItem(label = "Battery"),
    )

@Preview(name = "Breadcrumbs · full trail (wide)", showBackground = true, widthDp = 720)
@Composable
private fun BreadcrumbsFullPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BreadcrumbsContent(items = SAMPLE_TRAIL, onNavigate = {})
    }
}

@Preview(name = "Breadcrumbs · link + current", showBackground = true, widthDp = 360)
@Composable
private fun BreadcrumbsTwoPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BreadcrumbsContent(
            items =
                listOf(
                    BreadcrumbItem(label = "Charging", href = "/charging"),
                    BreadcrumbItem(label = "Session 42"),
                ),
            onNavigate = {},
        )
    }
}

@Preview(name = "Breadcrumbs · compact (collapsed middle)", showBackground = true, widthDp = 320)
@Composable
private fun BreadcrumbsCompactPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        BreadcrumbsContent(items = SAMPLE_TRAIL, onNavigate = {})
    }
}
