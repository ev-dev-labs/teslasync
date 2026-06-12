// The native Jetpack Compose + Material 3 AccordionSection feature view — a parity port of
// web/src/features/system/components/status/AccordionSection.tsx. The web component is a presentational
// disclosure primitive: a GlassPanel wrapping a clickable header (a cyan icon, a title + description, an
// optional badges slot, and a chevron that rotates 180° when open) over a body that mounts — faded in via
// the shared FadeIn — only while open, separated by a hairline top divider.
//
// This surface keeps that contract exactly. It is PURELY presentational: the web component binds no data
// hook (its collaborators are GlassPanel, FadeIn, the cn() helper, and a chevron glyph), so there is no
// fetch and therefore no loading / error / stale / offline lifecycle to render — modelling one would be
// invented state the web source never has (a "No silent drift" covenant violation), exactly as the sibling
// CodeBlock surface documents. The genuine, reachable states are the three the pure [AccordionSectionModel]
// reduces to: Collapsed (header only), ExpandedContent (header + divider + the caller's body), and
// ExpandedEmpty (header + divider + a friendly EmptyState, never a blank box, when a caller hands no body).
//
// The web `icon` / `badges` / `children` are arbitrary `ReactNode`s, mapped here to Compose content slots so
// callers compose them with native primitives; the cyan icon wrapper (web `text-cyan-400`) is reproduced by
// providing the info accent as the icon slot's content color. Built from native primitives + design tokens
// (P1/S9), never ported Tailwind classes. The accordion's `title` / `description` arrive already localized
// from the parent (the web source owns no i18n keys for this surface); the native-only accessibility
// affordance labels + empty hint resolve through the i18n facade by-name with English fallbacks (P1/S10).
// `view.opened` is emitted once through the sanctioned redacting logger (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AccordionSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.accordionsection

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberMotionDurationMs
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point for the AccordionSection surface. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11), owns the open/closed toggle (the web `useState(defaultOpen)`), resolves the localized
 * affordance strings, and delegates to the stateless [AccordionSectionContent]. Performs no HTTP (ADR-002).
 *
 * @param title the already-localized section title (web `title`).
 * @param description the already-localized section subtitle (web `description`).
 * @param icon optional leading glyph slot, tinted with the info accent (web `text-cyan-400` wrapper). An
 *   [Icon] placed here inherits the accent automatically.
 * @param badges optional trailing chip slot shown between the text and the chevron (web `badges`).
 * @param defaultOpen whether the section starts expanded (web `defaultOpen`, default `false`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param content the body slot revealed while open (web `children`); a `null` body renders a friendly
 *   empty state instead of a blank region.
 */
@Composable
fun AccordionSection(
    title: String,
    description: String,
    modifier: Modifier = Modifier,
    icon: (@Composable () -> Unit)? = null,
    badges: (@Composable RowScope.() -> Unit)? = null,
    defaultOpen: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    LaunchedEffect(Unit) {
        logger.info("view.opened", mapOf("surface" to AccordionSectionRegistration.SLUG))
    }
    var open by rememberSaveable { mutableStateOf(defaultOpen) }
    val strings = rememberAccordionSectionStrings()
    AccordionSectionContent(
        title = title,
        description = description,
        open = open,
        onToggle = { open = AccordionSectionModel.toggle(open) },
        strings = strings,
        modifier = modifier,
        icon = icon,
        badges = badges,
        content = content,
    )
}

/**
 * Stateless renderer — the UI-test and preview entry point. Draws the web card chrome (a [GlassPanel] with
 * no built-in padding so the header click target and the divider span full width) with an always-present
 * [AccordionSectionHeader] over the [AccordionSectionBody], which mounts only while [open]. The render state
 * is classified by the pure [AccordionSectionModel] so every branch is exercised off-device.
 */
@Composable
fun AccordionSectionContent(
    title: String,
    description: String,
    open: Boolean,
    onToggle: () -> Unit,
    strings: AccordionSectionStrings,
    modifier: Modifier = Modifier,
    icon: (@Composable () -> Unit)? = null,
    badges: (@Composable RowScope.() -> Unit)? = null,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val render = AccordionSectionModel.render(open = open, hasContent = content != null)
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.None) {
        AccordionSectionHeader(
            title = title,
            description = description,
            open = open,
            onToggle = onToggle,
            strings = strings,
            icon = icon,
            badges = badges,
        )
        if (AccordionSectionModel.shouldRenderBody(open)) {
            AccordionSectionBody(render = render, emptyHint = strings.emptyHint, content = content)
        }
    }
}

/**
 * The clickable header — the web `role="button" tabIndex={0}` row. A single merged button node so TalkBack
 * announces the title, description and badges together; [stateDescription] carries the web `aria-expanded`
 * and the click label carries the expand/collapse action. The leading [icon] slot inherits the info accent
 * (web `text-cyan-400`) and the trailing chevron rotates with [open] (web `open && 'rotate-180'`), honoring
 * reduced motion via [rememberMotionDurationMs].
 */
@Composable
private fun AccordionSectionHeader(
    title: String,
    description: String,
    open: Boolean,
    onToggle: () -> Unit,
    strings: AccordionSectionStrings,
    icon: (@Composable () -> Unit)?,
    badges: (@Composable RowScope.() -> Unit)?,
) {
    val durationMs = rememberMotionDurationMs(MotionDurations.normal)
    val rotation by animateFloatAsState(
        targetValue = AccordionSectionModel.chevronRotation(open),
        animationSpec = tween(durationMs),
        label = "accordionSectionChevron",
    )
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClickLabel = strings.actionLabel(open), onClick = onToggle)
                .padding(horizontal = Spacing.xl, vertical = Spacing.lg)
                .semantics(mergeDescendants = true) { stateDescription = strings.stateLabel(open) },
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            CompositionLocalProvider(LocalContentColor provides TeslaTokens.status.info) {
                icon()
            }
        }
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(title)
            Caption(description)
        }
        if (badges != null) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
                content = badges,
            )
        }
        Icon(
            imageVector = TeslaGlyphs.ChevronDown,
            contentDescription = null,
            size = IconSize.Md,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.rotate(rotation),
        )
    }
}

/**
 * The revealed body — the web `{open && (<FadeIn><div className="border-t ... space-y-4">…)`. A hairline top
 * divider precedes the caller's [content] (laid out in a spaced [ColumnScope]); when no body was supplied
 * (web `children` absent) a friendly [EmptyState] renders instead so the region is never a blank box. Only
 * called while expanded, so [render] is always one of the two expanded variants.
 */
@Composable
private fun AccordionSectionBody(
    render: AccordionRender,
    emptyHint: String,
    content: (@Composable ColumnScope.() -> Unit)?,
) {
    FadeIn(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.fillMaxWidth()) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = Spacing.xl, vertical = Spacing.lg),
                verticalArrangement = Arrangement.spacedBy(Spacing.lg),
            ) {
                if (render == AccordionRender.ExpandedContent && content != null) {
                    content()
                } else {
                    EmptyState(message = emptyHint, modifier = Modifier.fillMaxWidth())
                }
            }
        }
    }
}

/**
 * Resolves the localized strings once at the render boundary. The web source owns no i18n keys for this
 * surface, so all five affordance strings resolve by-name with the web `t(key, default)` fallback (the keys
 * exist in no catalog ⇒ the English defaults are used). Remembered against the resolved values so a locale
 * change rebuilds the bundle.
 */
@Composable
private fun rememberAccordionSectionStrings(): AccordionSectionStrings {
    val context = LocalContext.current
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    val expand = resolveOptional(lookup, KEY_EXPAND_ACTION, AccordionSectionDefaults.EXPAND_ACTION)
    val collapse = resolveOptional(lookup, KEY_COLLAPSE_ACTION, AccordionSectionDefaults.COLLAPSE_ACTION)
    val expanded = resolveOptional(lookup, KEY_EXPANDED_STATE, AccordionSectionDefaults.EXPANDED_STATE)
    val collapsed = resolveOptional(lookup, KEY_COLLAPSED_STATE, AccordionSectionDefaults.COLLAPSED_STATE)
    val emptyHint = resolveOptional(lookup, KEY_EMPTY_HINT, AccordionSectionDefaults.EMPTY_HINT)
    return remember(expand, collapse, expanded, collapsed, emptyHint) {
        AccordionSectionStrings(
            expandAction = expand,
            collapseAction = collapse,
            expandedState = expanded,
            collapsedState = collapsed,
            emptyHint = emptyHint,
        )
    }
}

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is
 * suppressed. Release builds keep resource names (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ── Previews — one per genuinely reachable render state (collapsed / expanded content / expanded empty) ──

private fun previewStrings(): AccordionSectionStrings =
    AccordionSectionStrings(
        expandAction = AccordionSectionDefaults.EXPAND_ACTION,
        collapseAction = AccordionSectionDefaults.COLLAPSE_ACTION,
        expandedState = AccordionSectionDefaults.EXPANDED_STATE,
        collapsedState = AccordionSectionDefaults.COLLAPSED_STATE,
        emptyHint = AccordionSectionDefaults.EMPTY_HINT,
    )

@Composable
private fun PreviewIcon() = Icon(TeslaGlyphs.Info, contentDescription = null, size = IconSize.Lg)

@Preview(name = "AccordionSection · collapsed", showBackground = true)
@Composable
private fun AccordionSectionCollapsedPreview() {
    TeslaSyncTheme {
        AccordionSectionContent(
            title = "Diagnostics",
            description = "Pipeline health and live signal counters",
            open = false,
            onToggle = {},
            strings = previewStrings(),
            icon = { PreviewIcon() },
        ) {
            BodyText("Streaming 42 signals across 3 vehicles.")
        }
    }
}

@Preview(name = "AccordionSection · expanded", showBackground = true)
@Composable
private fun AccordionSectionExpandedPreview() {
    TeslaSyncTheme {
        AccordionSectionContent(
            title = "Diagnostics",
            description = "Pipeline health and live signal counters",
            open = true,
            onToggle = {},
            strings = previewStrings(),
            icon = { PreviewIcon() },
        ) {
            BodyText("Streaming 42 signals across 3 vehicles.")
        }
    }
}

@Preview(name = "AccordionSection · expanded empty", showBackground = true)
@Composable
private fun AccordionSectionExpandedEmptyPreview() {
    TeslaSyncTheme {
        AccordionSectionContent(
            title = "Diagnostics",
            description = "Pipeline health and live signal counters",
            open = true,
            onToggle = {},
            strings = previewStrings(),
            icon = { PreviewIcon() },
            content = null,
        )
    }
}
