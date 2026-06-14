// The native Jetpack Compose + Material 3 ActionItem shared surface — a parity port of
// web/src/components/status/ActionItem.tsx. The web surface is a single operator task row used inside an
// ActionItemsPanel: a severity-tinted, ring-bordered, rounded panel with a leading severity glyph, a primary
// `title`, an optional `description` sub-line, and an optional right-aligned `cta` that renders as a label +
// chevron. It is a PURE presentational component — the parent owns the content and the action.
//
// This native surface keeps that contract end to end and renders every branch the web source draws — the three
// severity variants crossed with the title / description / CTA prop branches and the CTA's external-link /
// internal-link / button element forms — without ever hiding a region. It performs NO HTTP and binds NO state
// holder (the web component fetches nothing; see ActionItemModel.kt for the honesty rationale and why the generic
// loading / error / stale / offline states do not apply to a controlled row). The chrome is composed from the
// shared feedback Tone palette + the ui atoms (Icon / Caption / typography), so the severity tint stays correct
// across light / dark / high-contrast themes; the only string it renders beyond its props (the empty-title
// fallback) resolves through the i18n catalog (P1/S10). The title + description are merged into one polite
// TalkBack announcement; the leading glyph is decorative (the web icon is `aria-hidden`); the CTA is a separate
// focusable button carrying its label as the click affordance; and a one-shot PII-safe `view.opened` diagnostic
// (P1/S11) fires on first composition. All branch selection flows through the pure [classify] in
// ActionItemModel.kt.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ActionItem) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.actionitem

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.toneColors
import io.teslasync.android.components.feedback.toneGlyph
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web `ring-1` on the row — a 1 px hairline tinted to the severity. */
private val ACTION_ITEM_BORDER_WIDTH: Dp = 1.dp

/** Web `mt-0.5` — a 2 px nudge so the leading glyph aligns with the title's cap height under top alignment. */
private val ICON_TOP_NUDGE: Dp = 2.dp

/** Web `space-y-0.5` — a 2 px gap between the title and its description sub-line. */
private val TITLE_DESCRIPTION_GAP: Dp = 2.dp

/** Web `py-1.5` — the CTA's vertical inset. */
private val CTA_VERTICAL_PADDING: Dp = 6.dp

/**
 * The CTA's minimum tap height. The web uses `min-h-[36px]`; the native row honours the Material accessibility
 * minimum (48 dp) so the affordance is comfortably tappable and respects large font scales.
 */
private val CTA_MIN_TOUCH_TARGET: Dp = 48.dp

/**
 * Stateful entry point — the faithful port of the web `ActionItem`. Records the one-shot `view.opened` diagnostic
 * (P1/S11) on first composition and renders the row. Performs no HTTP and binds no state holder (the web component
 * is controlled; its content is owned by the parent). [logger] defaults to the process logger.
 *
 * @param severity the severity treatment (web `severity`).
 * @param title the primary task line (web `title`); blank ⇒ a localized empty fallback so the row is never blank.
 * @param description the optional sub-line beneath the title (web `description`); blank/`null` ⇒ no sub-line.
 * @param cta the optional right-aligned affordance (web `cta`); `null`, or a CTA with no activation, ⇒ no CTA.
 */
@Composable
fun ActionItem(
    severity: ActionSeverity,
    title: String?,
    modifier: Modifier = Modifier,
    description: String? = null,
    cta: ActionItemCta? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ActionItemDiagnostics.recordViewOpened(logger) }
    ActionItemContent(
        severity = severity,
        modifier = modifier,
        title = title,
        description = description,
        cta = cta,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Classifies the props into
 * an [ActionItemRender] and draws the severity-tinted row: the leading severity glyph, the primary title (or the
 * localized empty fallback), the optional description sub-line, and the optional trailing CTA (a severity-tinted
 * label + chevron). The title + description are exposed to TalkBack as one merged announcement; the CTA is a
 * separate focusable button.
 */
@Composable
fun ActionItemContent(
    severity: ActionSeverity,
    modifier: Modifier = Modifier,
    title: String? = null,
    description: String? = null,
    cta: ActionItemCta? = null,
) {
    val render =
        classify(
            ActionItemInput(
                severity = severity,
                title = title,
                hasDescription = !description.isNullOrBlank(),
                ctaLabel = cta?.label,
                ctaKind = cta?.kind,
                ctaHasActivation = cta?.onActivate != null,
            ),
        )
    val colors = toneColors(toneFor(render.severity))
    val icon = toneGlyph(toneFor(render.severity))
    val emptyFallback = stringResource(R.string.translation_common_noData)
    val spokenLabel = actionItemAccessibilityLabel(title = title, description = description, emptyFallback = emptyFallback)
    val activeCta = cta?.takeIf { render.cta != null }

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.lg),
        color = colors.background,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(ACTION_ITEM_BORDER_WIDTH, colors.border),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                modifier = Modifier.padding(top = ICON_TOP_NUDGE),
                size = IconSize.Lg,
                tint = colors.foreground,
            )
            Column(
                modifier =
                    Modifier
                        .weight(1f)
                        .semantics(mergeDescendants = true) { contentDescription = spokenLabel },
                verticalArrangement = Arrangement.spacedBy(TITLE_DESCRIPTION_GAP),
            ) {
                ActionItemTitle(render = render, title = title, emptyFallback = emptyFallback)
                if (render.showDescription && description != null) {
                    Caption(description)
                }
            }
            if (activeCta != null) {
                ActionItemCtaRow(label = activeCta.label, tint = colors.foreground, onActivate = activeCta.onActivate)
            }
        }
    }
}

/**
 * The primary line: the [title] in primary-emphasis medium text (web `text-sm font-medium text-[--text-primary]`)
 * when present, or a localized [emptyFallback] caption when the title is blank so the row never paints a blank
 * primary line.
 */
@Composable
private fun ActionItemTitle(
    render: ActionItemRender,
    title: String?,
    emptyFallback: String,
) {
    if (render.showTitle && title != null) {
        Text(
            text = title,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
            color = MaterialTheme.colorScheme.onSurface,
        )
    } else {
        Caption(emptyFallback)
    }
}

/**
 * The trailing CTA — the action [label] in the severity [tint] (web `text-xs font-medium severityText`) followed
 * by a chevron (web `<ChevronRight>`), inside a clickable container that meets the Material tap-target minimum.
 * Exposed to TalkBack as one [Role.Button] node carrying the label as its click affordance; the chevron is
 * decorative. The external / internal / button kinds all paint identically, exactly as the web does — the element
 * difference lives in the caller's [ActionItemCta.onActivate] (browser intent vs in-app navigation vs action).
 */
@Composable
private fun ActionItemCtaRow(
    label: String,
    tint: Color,
    onActivate: (() -> Unit)?,
) {
    Row(
        modifier =
            Modifier
                .clip(RoundedCornerShape(Radius.md))
                .clickable(role = Role.Button, onClickLabel = label) { onActivate?.invoke() }
                .defaultMinSize(minHeight = CTA_MIN_TOUCH_TARGET)
                .padding(horizontal = Spacing.md, vertical = CTA_VERTICAL_PADDING),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
            color = tint,
            maxLines = 1,
        )
        Icon(TeslaGlyphs.ChevronRight, contentDescription = null, size = IconSize.Sm, tint = tint)
    }
}

/** Map the model [ActionSeverity] to the shared feedback [Tone] palette (web `severity` → row tint + glyph). */
private fun toneFor(severity: ActionSeverity): Tone =
    when (severity) {
        ActionSeverity.Info -> Tone.Info
        ActionSeverity.Warn -> Tone.Warning
        ActionSeverity.Error -> Tone.Danger
    }

// ── Previews — one per severity variant plus the description / CTA / empty-title branches. ──────────────────────
// The web's three lucide glyphs map onto the design-system tone glyphs (Info → Info, AlertTriangle → Warning,
// AlertCircle → the canonical danger glyph) so each severity row stays consistent with every other danger /
// warning / info surface in the native app.

private const val PREVIEW_INSTALL_TITLE = "Software update available"
private const val PREVIEW_INSTALL_DESC = "v1.2.0 → v1.3.0"
private const val PREVIEW_INSTALL_CTA = "Install"

@Preview(name = "ActionItem · info (title + description + button)", showBackground = true)
@Composable
private fun ActionItemInfoPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActionItemContent(
            severity = ActionSeverity.Info,
            title = PREVIEW_INSTALL_TITLE,
            description = PREVIEW_INSTALL_DESC,
            cta = ActionItemCta(label = PREVIEW_INSTALL_CTA, kind = ActionCtaKind.Button, onActivate = {}),
        )
    }
}

@Preview(name = "ActionItem · warn (title + internal link)", showBackground = true)
@Composable
private fun ActionItemWarnPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActionItemContent(
            severity = ActionSeverity.Warn,
            title = "Vehicle authorization expires soon",
            cta = ActionItemCta(label = "Review", kind = ActionCtaKind.InternalLink, onActivate = {}),
        )
    }
}

@Preview(name = "ActionItem · error (title + description + external link)", showBackground = true)
@Composable
private fun ActionItemErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActionItemContent(
            severity = ActionSeverity.Error,
            title = "Re-authentication required",
            description = "Your Tesla token was revoked",
            cta = ActionItemCta(label = "Sign in", kind = ActionCtaKind.ExternalLink, onActivate = {}),
        )
    }
}

@Preview(name = "ActionItem · info (no CTA)", showBackground = true)
@Composable
private fun ActionItemNoCtaPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActionItemContent(
            severity = ActionSeverity.Info,
            title = "Backup completed successfully",
            description = "Last run 2 hours ago",
        )
    }
}

@Preview(name = "ActionItem · empty title fallback", showBackground = true)
@Composable
private fun ActionItemEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActionItemContent(severity = ActionSeverity.Info, title = "")
    }
}
