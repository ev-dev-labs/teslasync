// The native Jetpack Compose + Material 3 ToolCard feature view — a parity port of
// web/src/features/admin/components/devtools/ToolCard.tsx. The web component is a purely
// presentational CONTAINER: its parent (the dev-tools sections, e.g. FleetApiSection) passes an
// `icon`, a `color`, an already-translated `title` + `description`, and `children`, and it renders a
// GlassPanel with a colored icon box and a title/description header above the children. It binds NO
// data hook and reads NO i18n catalog of its own (the strings arrive pre-translated as props), so
// the only logic it owns is the icon-color lookup `ICON_COLOR_MAP[color] ?? ICON_COLOR_MAP.cyan`.
//
// Because the surface has zero data sources, there is no loading / error / stale / offline lifecycle
// to render here — modelling those would invent behaviour the spec does not have (drift). What this
// container genuinely varies is its content slot: the normal "has content" path (web `{children}`)
// and a defensive "no content" path that shows a friendly empty state so the panel is never a blank
// box. The unknown-color branch (folding to cyan) is reproduced exactly. Hosts that need the audit
// trail call the stateful [ToolCard]; tests and previews drive the stateless [ToolCardContent].
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ToolCard — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path — exactly as the sibling
// AlertDetailTimeline surface does. `MatchingDeclarationName` is suppressed for the co-located
// supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.toolcard

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// Icon-box geometry/alpha, matching the web `h-10 w-10 rounded-lg bg-{c}/10 ring-1 ring-{c}/20`.
private val ICON_BOX_SIZE: Dp = 40.dp
private val ICON_RING_WIDTH: Dp = 1.dp
private const val ICON_BG_ALPHA = 0.10f
private const val ICON_RING_ALPHA = 0.20f

/**
 * Stateful entry point for the ToolCard container. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders the presentational card. The surface binds no data of its own; the
 * caller supplies the already-translated [title]/[description] (web parity — the strings are
 * translated at the call site) and the [content] slot (web `children`).
 *
 * @param icon the leading glyph shown in the accent-tinted icon box (web `icon`).
 * @param color the accent key (`cyan`/`green`/`purple`/`amber`/`red`); unknown folds to cyan.
 * @param title the bold card title (web `title`, already localized by the host).
 * @param description the secondary one-line description (web `description`, already localized).
 * @param content the card body (web `children`); when `null` a friendly empty state is shown.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ToolCard(
    icon: ImageVector,
    color: String,
    title: String,
    description: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    LaunchedEffect(Unit) {
        logger.info("view.opened", mapOf("surface" to ToolCardRegistration.SLUG))
    }
    ToolCardContent(
        icon = icon,
        color = color,
        title = title,
        description = description,
        modifier = modifier,
        content = content,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web component's
 * layout exactly: a [GlassPanel] (web `p-5`) containing a header row (the accent icon box +
 * title/description, web `mb-4 flex items-start gap-3`) above the [content]. The accent is resolved
 * from [color] via [ToolCardAccent.fromRaw] (unknown → cyan, web `?? ICON_COLOR_MAP.cyan`). A `null`
 * [content] renders an [EmptyState] so the panel is never a blank box.
 */
@Composable
fun ToolCardContent(
    icon: ImageVector,
    color: String,
    title: String,
    description: String,
    modifier: Modifier = Modifier,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val accent = ToolCardAccent.fromRaw(color)
    GlassPanel(modifier = modifier, padding = PanelPadding.None) {
        Column(modifier = Modifier.fillMaxWidth().padding(Spacing.xl)) {
            ToolCardHeader(icon = icon, accent = accent, title = title, description = description)
            Spacer(Modifier.height(Spacing.lg))
            if (content != null) {
                Column(modifier = Modifier.fillMaxWidth(), content = content)
            } else {
                EmptyState(
                    message = stringResource(R.string.translation_common_noData),
                    icon = TeslaGlyphs.Info,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

/** Header row: the accent icon box (web `h-10 w-10` box) beside the title/description column. */
@Composable
private fun ToolCardHeader(
    icon: ImageVector,
    accent: ToolCardAccent,
    title: String,
    description: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        ToolCardIconBox(icon = icon, accent = accent)
        Column(modifier = Modifier.weight(1f)) {
            PanelTitle(title)
            HelperText(description)
        }
    }
}

/**
 * The colored icon container — the native analogue of the web `bg-{c}/10 ring-1 ring-{c}/20`
 * affordance: a rounded [Surface] washed with the accent at [ICON_BG_ALPHA], outlined at
 * [ICON_RING_ALPHA], with the glyph tinted full-strength. The glyph is decorative (the title +
 * description carry the meaning), so it exposes no content description to accessibility services.
 */
@Composable
private fun ToolCardIconBox(
    icon: ImageVector,
    accent: ToolCardAccent,
) {
    val accentColor = accentColorFor(accent)
    Surface(
        modifier = Modifier.size(ICON_BOX_SIZE),
        shape = RoundedCornerShape(Radius.sm),
        color = accentColor.copy(alpha = ICON_BG_ALPHA),
        contentColor = accentColor,
        border = BorderStroke(ICON_RING_WIDTH, accentColor.copy(alpha = ICON_RING_ALPHA)),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(imageVector = icon, contentDescription = null, size = IconSize.Lg, tint = accentColor)
        }
    }
}

/**
 * Resolves an accent to its design-token [Color]. The dark-theme tokens equal the web neon hexes
 * exactly: cyan → status.info (#00F0FF), green → status.success (#10B981), amber → status.warning
 * (#F59E0B), red → status.danger (#EF4444), purple → chart.power (#A855F7).
 */
@Composable
private fun accentColorFor(accent: ToolCardAccent): Color =
    when (accent) {
        ToolCardAccent.Cyan -> TeslaTokens.status.info
        ToolCardAccent.Green -> TeslaTokens.status.success
        ToolCardAccent.Purple -> TeslaTokens.chart.power
        ToolCardAccent.Amber -> TeslaTokens.status.warning
        ToolCardAccent.Red -> TeslaTokens.status.danger
    }
