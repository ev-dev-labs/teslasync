// The native Jetpack Compose + Material 3 Accordion shared surface — a parity port of
// web/src/components/ui/Accordion.tsx. The web surface is a collapsible content section: a rounded,
// hairline-bordered container whose header is one `<button aria-expanded>` carrying an optional leading icon,
// the title, an optional badge, an optional headerExtra slot, and a trailing chevron that rotates 180° while
// open; below it an `AnimatePresence` reveals the body (a top divider + padded `children`) when open. The
// component is PURE presentational — the parent owns every region (title / icon / badge / headerExtra / body)
// and may either let the surface own the open/closed boolean (uncontrolled) or drive it through `open` +
// `onOpenChange` (controlled).
//
// This native surface keeps that contract end to end and renders every branch the web source draws — the
// open/closed toggle crossed with the icon / badge / headerExtra slot branches and the real-vs-empty body —
// without ever hiding a region. It performs NO HTTP and binds NO state holder (the web component fetches
// nothing; see AccordionModel.kt for the honesty rationale and why the generic loading/error/stale/offline
// states belong to the owning page, not a controlled container). The chrome is composed from the shared ui
// atoms (PanelTitle / Icon / Caption / TeslaGlyphs) on platform tokens (P1/S9 — Radius / Spacing / Motion), so
// it stays correct across light / dark / high-contrast themes; the only string it renders beyond its
// caller-supplied props (the empty-body fallback) resolves through the i18n catalog (P1/S10), and the
// native-only header a11y affordances resolve by-name with English fallbacks (web relies on the DOM
// `aria-expanded`). The whole header is one `Role.Button` whose merged TalkBack name is the title, whose state
// description tracks open/closed (web `aria-expanded`), and whose click label is Expand / Collapse; the chevron
// is decorative. The chevron rotation + body reveal honor the reduced-motion preference (P1/S9). A one-shot
// PII-safe `view.opened` diagnostic (P1/S11) fires on first composition. All branch selection flows through the
// pure [classifyAccordion] / [resolveAccordionOpen] in AccordionModel.kt.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Accordion) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.accordion

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web `rotate-180` on the chevron while open. */
private const val CHEVRON_EXPANDED_ROTATION = 180f

/** Animation labels (tooling only) for the chevron + body transitions. */
private const val CHEVRON_LABEL = "accordion-chevron"

/** Web `ring-1` / `border` on the container — a 1 px hairline. */
private val CONTAINER_BORDER_WIDTH: Dp = 1.dp

// ── Test tags (stable hooks for AccordionUiTest; inert at runtime) ──────────────────────────────────
const val ACCORDION_HEADER_TAG: String = "accordion-header"
const val ACCORDION_CHEVRON_TAG: String = "accordion-chevron"
const val ACCORDION_BODY_TAG: String = "accordion-body"
const val ACCORDION_EMPTY_TAG: String = "accordion-empty"

/**
 * Stateful entry point — the faithful port of the web `Accordion`. Records the one-shot `view.opened`
 * diagnostic (P1/S11) on first composition, owns (or, when controlled, defers) the open/closed boolean, and
 * renders the collapsible. Performs no HTTP and binds no state holder (the web component is controlled; its
 * content is owned by the parent). [logger] defaults to the process logger.
 *
 * Controlled mode mirrors the web exactly: when BOTH [open] and [onOpenChange] are supplied the parent owns
 * the source of truth ([open] wins, toggles route to [onOpenChange]); otherwise the surface manages its own
 * [defaultOpen]-seeded state. The body is the [content] slot (the faithful port of the web `children`); when
 * it is `null` a localized empty caption is shown so the revealed region is never a blank box.
 *
 * @param title the header title (web `title`); already localized by the caller.
 * @param defaultOpen the initial open state in uncontrolled mode (web `defaultOpen`).
 * @param open the controlled open state (web `open`); pair with [onOpenChange] to enter controlled mode.
 * @param onOpenChange invoked with the next state on toggle in controlled mode (web `onOpenChange`).
 * @param icon the optional leading glyph slot (web `icon`); `null` ⇒ no icon, matching the web `{icon && …}`.
 * @param badge the optional badge slot rendered after the title (web `badge`).
 * @param headerExtra the optional slot rendered after the badge (web `headerExtra`).
 * @param headerPadding the header content padding (web default `px-4 py-3`).
 * @param bodyPadding the body content padding (web default `px-4 py-3`).
 * @param content the body slot (the faithful port of the web `children`); `null` ⇒ the empty fallback.
 */
@Composable
fun Accordion(
    title: String,
    modifier: Modifier = Modifier,
    defaultOpen: Boolean = false,
    open: Boolean? = null,
    onOpenChange: ((Boolean) -> Unit)? = null,
    icon: (@Composable () -> Unit)? = null,
    badge: (@Composable () -> Unit)? = null,
    headerExtra: (@Composable () -> Unit)? = null,
    headerPadding: PaddingValues = PaddingValues(horizontal = Spacing.lg, vertical = Spacing.md),
    bodyPadding: PaddingValues = PaddingValues(horizontal = Spacing.lg, vertical = Spacing.md),
    logger: Logger = LocalDataContainer.current.logger,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    LaunchedEffect(Unit) { AccordionDiagnostics.recordViewOpened(logger) }
    var internalOpen by rememberSaveable { mutableStateOf(defaultOpen) }
    val controlled = accordionIsControlled(open, onOpenChange != null)
    val expanded = resolveAccordionOpen(open, onOpenChange != null, internalOpen)
    val onToggle: () -> Unit = {
        val next = !expanded
        if (controlled) onOpenChange?.invoke(next) else internalOpen = next
    }
    AccordionContent(
        title = title,
        expanded = expanded,
        onToggle = onToggle,
        modifier = modifier,
        icon = icon,
        badge = badge,
        headerExtra = headerExtra,
        headerPadding = headerPadding,
        bodyPadding = bodyPadding,
        content = content,
    )
}

/**
 * Stateless renderer for every surface state — the UI-test + preview entry point. Classifies the props into an
 * [AccordionRender] and draws the rounded, bordered container: the header (the optional leading icon, the
 * title, the optional badge + headerExtra, and the rotating chevron) and the animated body reveal (a top
 * divider + the [content] slot, or the localized empty fallback). The header is one merged `Role.Button` whose
 * accessible name is the title, whose state description tracks open/closed, and whose click label is Expand /
 * Collapse; the chevron is decorative.
 */
@Composable
fun AccordionContent(
    title: String,
    expanded: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    icon: (@Composable () -> Unit)? = null,
    badge: (@Composable () -> Unit)? = null,
    headerExtra: (@Composable () -> Unit)? = null,
    headerPadding: PaddingValues = PaddingValues(horizontal = Spacing.lg, vertical = Spacing.md),
    bodyPadding: PaddingValues = PaddingValues(horizontal = Spacing.lg, vertical = Spacing.md),
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val render =
        classifyAccordion(
            AccordionInput(
                expanded = expanded,
                hasIcon = icon != null,
                hasBadge = badge != null,
                hasHeaderExtra = headerExtra != null,
                hasBody = content != null,
            ),
        )
    val affordances = rememberAccordionAffordances()
    val emptyMessage = stringResource(R.string.translation_common_noData)
    val reducedMotion = rememberReducedMotion()
    val rotation by animateFloatAsState(
        targetValue = if (render.expanded) CHEVRON_EXPANDED_ROTATION else 0f,
        animationSpec = if (reducedMotion) snap() else tween(MotionDurations.normal),
        label = CHEVRON_LABEL,
    )

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(CONTAINER_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            AccordionHeader(
                title = title,
                render = render,
                affordances = affordances,
                rotation = rotation,
                headerPadding = headerPadding,
                onToggle = onToggle,
                icon = icon,
                badge = badge,
                headerExtra = headerExtra,
            )
            AccordionBody(
                render = render,
                bodyPadding = bodyPadding,
                emptyMessage = emptyMessage,
                reducedMotion = reducedMotion,
                content = content,
            )
        }
    }
}

/**
 * The clickable header row — web `<button aria-expanded>`. The whole row is one [Role.Button] tap target whose
 * merged TalkBack name is the title (folded from the descendant [PanelTitle] + any badge text), whose
 * [stateDescription] tracks open/closed (web `aria-expanded`), and whose click label is the Expand / Collapse
 * affordance. The leading icon inherits the muted foreground (web `text-[var(--text-muted)]`); the chevron is
 * decorative ([contentDescription] `null`) and rotates with [rotation].
 */
@Composable
private fun AccordionHeader(
    title: String,
    render: AccordionRender,
    affordances: AccordionAffordances,
    rotation: Float,
    headerPadding: PaddingValues,
    onToggle: () -> Unit,
    icon: (@Composable () -> Unit)?,
    badge: (@Composable () -> Unit)?,
    headerExtra: (@Composable () -> Unit)?,
) {
    val actionLabel = affordances.actionLabel(render.expanded)
    val stateLabel = affordances.stateLabel(render.expanded)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(ACCORDION_HEADER_TAG)
                .clickable(role = Role.Button, onClickLabel = actionLabel, onClick = onToggle)
                .semantics(mergeDescendants = true) { stateDescription = stateLabel }
                .padding(headerPadding),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (render.showIcon && icon != null) {
            CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.onSurfaceVariant) {
                icon()
            }
        }
        PanelTitle(title, modifier = Modifier.weight(1f))
        if (render.showBadge && badge != null) badge()
        if (render.showHeaderExtra && headerExtra != null) headerExtra()
        Icon(
            imageVector = TeslaGlyphs.ChevronDown,
            contentDescription = null,
            modifier = Modifier.testTag(ACCORDION_CHEVRON_TAG).rotate(rotation),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * The animated body reveal — web `AnimatePresence` `{ height, opacity }`. Visible only while [expanded]; the
 * expand/fade transition is replaced by an instant cut when the reduced-motion preference is set. Inside, a top
 * divider (web `border-t`) precedes the padded [content] slot, or — when no body was supplied — a localized
 * empty caption so the revealed region is never a blank box (the prompt's empty-state contract).
 */
@Composable
private fun AccordionBody(
    render: AccordionRender,
    bodyPadding: PaddingValues,
    emptyMessage: String,
    reducedMotion: Boolean,
    content: (@Composable ColumnScope.() -> Unit)?,
) {
    AnimatedVisibility(
        visible = render.expanded,
        enter = if (reducedMotion) EnterTransition.None else expandVertically() + fadeIn(),
        exit = if (reducedMotion) ExitTransition.None else shrinkVertically() + fadeOut(),
    ) {
        Column(modifier = Modifier.fillMaxWidth().testTag(ACCORDION_BODY_TAG)) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Column(modifier = Modifier.fillMaxWidth().padding(bodyPadding)) {
                if (content != null) {
                    content()
                } else {
                    Caption(emptyMessage, modifier = Modifier.testTag(ACCORDION_EMPTY_TAG))
                }
            }
        }
    }
}

/**
 * Resolves the native-only accessibility affordance strings for the collapsible header. The web source owns no
 * text keys for these (it relies on the DOM `aria-expanded`), so each resolves by-name through the i18n facade
 * with the English [AccordionDefaults] fallback — the native mirror of i18next `t(key, default)`.
 */
@Composable
private fun rememberAccordionAffordances(): AccordionAffordances {
    val context = LocalContext.current
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    val expand = resolveOptional(lookup, KEY_ACCORDION_EXPAND_ACTION, AccordionDefaults.EXPAND_ACTION)
    val collapse = resolveOptional(lookup, KEY_ACCORDION_COLLAPSE_ACTION, AccordionDefaults.COLLAPSE_ACTION)
    val expanded = resolveOptional(lookup, KEY_ACCORDION_EXPANDED_STATE, AccordionDefaults.EXPANDED_STATE)
    val collapsed = resolveOptional(lookup, KEY_ACCORDION_COLLAPSED_STATE, AccordionDefaults.COLLAPSED_STATE)
    return remember(expand, collapse, expanded, collapsed) {
        AccordionAffordances(expand, collapse, expanded, collapsed)
    }
}

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)` for the native-only a11y affordances. `getIdentifier` is the only way to attempt a key that
 * may be absent, so `DiscouragedApi` is suppressed; release builds keep resource names so the lookup stays
 * stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ── Previews — one per render branch (collapsed / expanded with every slot / headerExtra / empty body). ──

private const val PREVIEW_TITLE = "Battery health"

@Preview(name = "Accordion · collapsed", showBackground = true)
@Composable
private fun AccordionCollapsedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AccordionContent(
            title = PREVIEW_TITLE,
            expanded = false,
            onToggle = {},
            icon = { Icon(TeslaGlyphs.Info, contentDescription = null) },
            badge = { Caption("Beta") },
            content = { Text("Degradation 4.2% over 28k mi") },
        )
    }
}

@Preview(name = "Accordion · expanded (icon + badge + body)", showBackground = true)
@Composable
private fun AccordionExpandedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AccordionContent(
            title = PREVIEW_TITLE,
            expanded = true,
            onToggle = {},
            icon = { Icon(TeslaGlyphs.Info, contentDescription = null) },
            badge = { Caption("Beta") },
            content = {
                Text("Degradation 4.2% over 28k mi")
                Text("Estimated full-pack range 291 mi")
            },
        )
    }
}

@Preview(name = "Accordion · expanded (header extra)", showBackground = true)
@Composable
private fun AccordionHeaderExtraPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AccordionContent(
            title = "Signals",
            expanded = true,
            onToggle = {},
            headerExtra = { Icon(TeslaGlyphs.Help, contentDescription = null) },
            content = { Text("18 signals available") },
        )
    }
}

@Preview(name = "Accordion · expanded (empty body)", showBackground = true)
@Composable
private fun AccordionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AccordionContent(title = "Notes", expanded = true, onToggle = {})
    }
}
