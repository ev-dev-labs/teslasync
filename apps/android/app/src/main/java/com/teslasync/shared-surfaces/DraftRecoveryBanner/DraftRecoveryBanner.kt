// The native Jetpack Compose + Material 3 DraftRecoveryBanner shared surface — a parity port of
// web/src/components/feedback/DraftRecoveryBanner.tsx and the `@/components/feedback/AlertBanner` it renders.
// The web surface is the reassuring inline notice shown at the top of an editor that was hydrated from a stored
// draft: an info-tinted alert with an icon, a "your unsaved work was restored from {when}" message, a "Use
// draft" affordance (ghost; UX-only acknowledgement — the draft is already applied on hydration) and a "Discard
// draft" affordance (secondary; tells the parent to reset the editor + clear the stored draft). Both dismiss the
// banner. It renders nothing when no draft was restored or the user already acted on it.
//
// There is no native AlertBanner content-slot that fits: the shared AlertBanner (components/feedback/AlertBanner)
// takes a flat message + two FIXED action slots whose emphasis is hard-coded (the primary slot renders as an
// Outline button, the secondary as a Ghost button), which cannot reproduce the web's "Use draft" = ghost +
// "Discard draft" = secondary pairing. So the info-alert chrome is composed here from the shared atoms (the
// feedback Tone palette + glyph, BodyText, Button) — the same approach the sibling AiLimitBanner takes for the
// web alert it has no 1:1 native atom for. Every visible string resolves through the i18n catalog (P1/S10); the
// relative-age phrase reuses the byte-identical `palette.recent.*` keys the DateTime surface already ships.
//
// All derivation flows through the pure [classify] / [relativeDraftAge] reducers in DraftRecoveryBannerModel.kt;
// this composable only owns the internal `dismissed` flag (the web `useState`) and the one-shot `view.opened`
// diagnostic (P1/S11). It performs NO HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DraftRecoveryBanner) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.draftrecoverybanner

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.toneColors
import io.teslasync.android.components.feedback.toneGlyph
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant

/** Web `border` on the alert — a 1 px hairline tinted to the info tone. */
private val ALERT_BORDER_WIDTH: Dp = 1.dp

/**
 * Stateful entry point — the faithful port of the web `DraftRecoveryBanner`. Records the one-shot `view.opened`
 * diagnostic, owns the internal `dismissed` flag (the web `useState`), classifies the inputs into a render-ready
 * [DraftBannerSurface], and renders the alert — or nothing when there is no draft or the user already acted (web
 * returns `null`). Performs no HTTP; [logger] defaults to the process logger.
 *
 * @param hasDraft whether the editor was hydrated from a stored draft (web `hasDraft`); `false` → nothing renders.
 * @param draftSavedAt when the draft was last persisted (web `draftSavedAt`); `null` → the "a moment ago" copy.
 * @param onDiscard invoked when the user taps "Discard draft" — the parent resets the editor + clears the draft.
 * @param onRestore invoked when the user taps "Use draft"; optional (the draft is already applied on hydration,
 *   so most callers pass a no-op or leave it `null`). The banner dismisses itself either way.
 * @param itemNoun an already-localized noun for the copy (web `itemNoun`, e.g. the localized "Alert rule");
 *   `null`/blank selects the noun-free message.
 */
@Composable
fun DraftRecoveryBanner(
    hasDraft: Boolean,
    draftSavedAt: Instant?,
    onDiscard: () -> Unit,
    modifier: Modifier = Modifier,
    onRestore: (() -> Unit)? = null,
    itemNoun: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { DraftRecoveryBannerDiagnostics.recordViewOpened(logger) }

    var dismissed by remember { mutableStateOf(false) }
    val nowMillis = remember(draftSavedAt) { System.currentTimeMillis() }
    val surface =
        classify(
            hasDraft = hasDraft,
            dismissed = dismissed,
            savedAtMillis = draftSavedAt?.toEpochMilli(),
            nowMillis = nowMillis,
            itemNoun = itemNoun,
        )

    DraftRecoveryBannerContent(
        surface = surface,
        modifier = modifier,
        onUseDraft = {
            dismissed = true
            onRestore?.invoke()
        },
        onDiscard = {
            dismissed = true
            onDiscard()
        },
    )
}

/**
 * Stateless renderer — the per-state preview + UI-test entry point. Renders the alert for a
 * [DraftBannerSurface.Visible] and nothing for [DraftBannerSurface.Hidden] (web `null`). [onUseDraft] / [onDiscard]
 * are the already-wrapped handlers (the stateful entry folds the `dismissed` toggle into them).
 */
@Composable
fun DraftRecoveryBannerContent(
    surface: DraftBannerSurface,
    modifier: Modifier = Modifier,
    onUseDraft: () -> Unit = {},
    onDiscard: () -> Unit = {},
) {
    if (surface !is DraftBannerSurface.Visible) return
    DraftRecoveryAlert(
        message = draftMessage(surface),
        modifier = modifier,
        onUseDraft = onUseDraft,
        onDiscard = onDiscard,
    )
}

/** The web AlertBanner chrome: an info-tinted, bordered surface with the icon, the message, and the two actions. */
@Composable
private fun DraftRecoveryAlert(
    message: String,
    modifier: Modifier = Modifier,
    onUseDraft: () -> Unit,
    onDiscard: () -> Unit,
) {
    val tone = Tone.Info
    val colors = toneColors(tone)
    Surface(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { liveRegion = LiveRegionMode.Polite },
        shape = RoundedCornerShape(Radius.md),
        color = colors.background,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(ALERT_BORDER_WIDTH, colors.border),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(toneGlyph(tone), contentDescription = null, size = IconSize.Md, tint = colors.foreground)
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                BodyText(message, color = MaterialTheme.colorScheme.onSurface)
                DraftRecoveryActions(onUseDraft = onUseDraft, onDiscard = onDiscard)
            }
        }
    }
}

/**
 * The action row: "Use draft" (ghost) then "Discard draft" (secondary) — the verbatim web emphasis. Both dismiss
 * the banner via the wrapped handlers; "Use draft" is a UX-only acknowledgement (the draft is already applied).
 */
@Composable
private fun DraftRecoveryActions(
    onUseDraft: () -> Unit,
    onDiscard: () -> Unit,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = stringResource(R.string.translation_draft_useDraft),
            onClick = onUseDraft,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
        Button(
            label = stringResource(R.string.translation_draft_discardDraft),
            onClick = onDiscard,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
        )
    }
}

/**
 * Resolve the localized banner message — web `itemNoun ? t('draft.restoredItem', …) : t('draft.restored', …)`.
 * The `{when}` argument is the localized relative-age phrase from [draftWhenLabel].
 */
@Composable
private fun draftMessage(surface: DraftBannerSurface.Visible): String {
    val whenLabel = draftWhenLabel(surface.age)
    return if (surface.noun != null) {
        stringResource(R.string.translation_draft_restoredItem, surface.noun, whenLabel)
    } else {
        stringResource(R.string.translation_draft_restored, whenLabel)
    }
}

/** Resolve a [DraftAge] bucket to its localized phrase (web `formatRelativeTime` tokens via the catalog, P1/S10). */
@Composable
private fun draftWhenLabel(age: DraftAge): String =
    when (age) {
        DraftAge.Unknown -> stringResource(R.string.translation_draft_unknownTime)
        DraftAge.JustNow -> stringResource(R.string.translation_palette_recent_justNow)
        is DraftAge.Minutes ->
            pluralStringResource(R.plurals.translation_palette_recent_minutesAgo, age.count, age.count)
        is DraftAge.Hours ->
            pluralStringResource(R.plurals.translation_palette_recent_hoursAgo, age.count, age.count)
        is DraftAge.Absolute -> age.value
    }

// ── Previews (tooling-only) ─────────────────────────────────────────────────────────────────────────────
// Each renders a representative Visible surface: a named item restored minutes ago, the noun-free copy "just
// now", and the unknown-timestamp fallback. The Hidden surface renders nothing, so it has no preview.

@Preview(name = "Draft restored — named item, minutes ago", showBackground = true)
@Composable
private fun DraftRecoveryBannerItemPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DraftRecoveryBannerContent(
            surface = DraftBannerSurface.Visible(noun = "Alert rule", age = DraftAge.Minutes(5)),
            onUseDraft = {},
            onDiscard = {},
        )
    }
}

@Preview(name = "Draft restored — no noun, just now", showBackground = true)
@Composable
private fun DraftRecoveryBannerJustNowPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DraftRecoveryBannerContent(
            surface = DraftBannerSurface.Visible(noun = null, age = DraftAge.JustNow),
            onUseDraft = {},
            onDiscard = {},
        )
    }
}

@Preview(name = "Draft restored — unknown timestamp", showBackground = true)
@Composable
private fun DraftRecoveryBannerUnknownPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DraftRecoveryBannerContent(
            surface = DraftBannerSurface.Visible(noun = null, age = DraftAge.Unknown),
            onUseDraft = {},
            onDiscard = {},
        )
    }
}
