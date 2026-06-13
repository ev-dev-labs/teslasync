// The native Jetpack Compose + Material 3 EmptyStateThreshold shared surface — a parity port of
// web/src/components/feedback/EmptyStateThreshold.tsx. The web surface is the non-error empty state for a
// section that only becomes useful at scale (e.g. a cost heatmap that needs ≥ 30 charging sessions): it shows
// a healthy green check (the section is fine, just waiting for more data), the caller's section label, a muted
// info hint, an optional description, a friendly "Need at least N {noun} … you have M so far" count message,
// and an optional call-to-action. Per the /charging redesign spec it NEVER silently hides the section, so this
// port always renders. It is pure presentational — the parent owns the counts + copy and the component's only
// hook is useTranslation.
//
// Every derivation flows through the pure model in EmptyStateThresholdModel.kt (projectEmptyStateThreshold →
// [EmptyStateThresholdProjection]); this composable is the thin render layer that resolves the localized noun
// + message from the shared P1/S10 catalog, paints the chrome with the shared component library (GlassPanel /
// Icon / typography), maps the check tint onto the per-theme TeslaTokens status palette (never a raw hex), and
// fires the one-shot PII-safe `view.opened` diagnostic (P1/S11). It performs NO HTTP. The web container's
// `role="status" aria-live="polite"` is reproduced with a polite live-region semantics modifier, so a
// screen-reader announces the section politely when it appears; the check + info glyphs are decorative (web
// `aria-hidden`), so the message text carries the meaning.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/EmptyStateThreshold) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, helpers, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.emptystatethreshold

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the rendered surface — used by the instrumented per-state + a11y UI test. */
const val EMPTY_STATE_THRESHOLD_TEST_TAG: String = "empty-state-threshold"

/**
 * Stateful entry point — the faithful port of `<EmptyStateThreshold … />`. Records the one-shot `view.opened`
 * diagnostic (P1/S11), projects the caller's parameters with the pure [projectEmptyStateThreshold], and paints
 * the result. Always renders (the web component never returns `null`). Performs no HTTP; [logger] defaults to
 * the process logger.
 *
 * @param currentCount how many items the user currently has (web `currentCount`).
 * @param threshold the minimum items the section needs to become useful (web `threshold`).
 * @param sectionLabel the gated section's title (web `sectionLabel`), already localized by the caller.
 * @param itemNoun optional short noun for the items (web `itemNoun`); `null` → the localized "items".
 * @param description optional one-line subtitle under the title (web `description`).
 * @param message optional override for the auto-composed message (web `message`).
 * @param action optional call-to-action rendered under the message (web `action`).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun EmptyStateThreshold(
    currentCount: Int,
    threshold: Int,
    sectionLabel: String,
    modifier: Modifier = Modifier,
    itemNoun: String? = null,
    description: String? = null,
    message: String? = null,
    action: (@Composable () -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { EmptyStateThresholdDiagnostics.recordViewOpened(logger) }
    val projection =
        remember(currentCount, threshold, sectionLabel, itemNoun, description, message) {
            projectEmptyStateThreshold(
                EmptyStateThresholdInput(
                    currentCount = currentCount,
                    threshold = threshold,
                    sectionLabel = sectionLabel,
                    itemNoun = itemNoun,
                    description = description,
                    message = message,
                ),
            )
        }
    EmptyStateThresholdContent(projection = projection, modifier = modifier, action = action)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Resolves the localized noun + message from the
 * [projection], then paints the green check, the section title + muted info hint, the optional description, the
 * message, and the optional [action]. The whole surface is a polite live region (web `role="status"
 * aria-live="polite"`); the decorative glyphs are skipped by accessibility services. Carries no diagnostics, so
 * a parent rendering many of these in a list never emits per-item events.
 */
@Composable
fun EmptyStateThresholdContent(
    projection: EmptyStateThresholdProjection,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
) {
    val noun = resolveNoun(projection.noun)
    val message = resolveMessage(projection.message, noun)
    GlassPanel(
        modifier =
            modifier
                .testTag(EMPTY_STATE_THRESHOLD_TEST_TAG)
                .semantics { liveRegion = LiveRegionMode.Polite },
        padding = PanelPadding.Md,
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                imageVector = TeslaGlyphs.Check,
                contentDescription = null,
                size = IconSize.Lg,
                tint = TeslaTokens.status.success,
            )
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PanelTitle(text = projection.sectionLabel, modifier = Modifier.weight(1f, fill = false))
                    Icon(
                        imageVector = TeslaGlyphs.Info,
                        contentDescription = null,
                        size = IconSize.Xs,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (projection.description != null) {
                    Caption(text = projection.description)
                }
                HelperText(text = message)
                if (action != null) {
                    Box(modifier = Modifier.padding(top = Spacing.xs)) { action() }
                }
            }
        }
    }
}

/**
 * Resolve the visible noun — the native mirror of the web `itemNoun ?? t('emptyState.threshold.defaultItem',
 * 'items')`. A caller-supplied noun wins; otherwise the localized default resolves through the P1/S10 catalog,
 * so no English literal lives in the view.
 */
@Composable
private fun resolveNoun(noun: EmptyStateThresholdNoun): String =
    when (noun) {
        is EmptyStateThresholdNoun.Custom -> noun.value
        EmptyStateThresholdNoun.Default -> stringResource(R.string.translation_emptyState_threshold_defaultItem)
    }

/**
 * Resolve the visible message — the native mirror of the web `message ?? defaultMessage`. A caller-supplied
 * override wins; otherwise the localized `emptyState.threshold.message` template is interpolated with the
 * threshold, the resolved [noun], and the current count (positional `%1$s %2$s %3$s`), exactly as the web
 * `t(key, '…', { threshold, noun, current })` call does.
 */
@Composable
private fun resolveMessage(
    message: EmptyStateThresholdMessage,
    noun: String,
): String =
    when (message) {
        is EmptyStateThresholdMessage.Custom -> message.value
        is EmptyStateThresholdMessage.Default ->
            stringResource(
                R.string.translation_emptyState_threshold_message,
                message.threshold,
                noun,
                message.current,
            )
    }

// ── Previews (tooling-only; sample counts + labels are never shipped UI) ──────────────────────────────────

@Preview(name = "Default — fallback noun, no description", showBackground = true)
@Composable
private fun EmptyStateThresholdDefaultPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EmptyStateThresholdContent(
            projection =
                projectEmptyStateThreshold(
                    EmptyStateThresholdInput(
                        currentCount = 1,
                        threshold = 10,
                        sectionLabel = "Optimizer recommendations",
                    ),
                ),
        )
    }
}

@Preview(name = "Noun + description + action", showBackground = true)
@Composable
private fun EmptyStateThresholdRichPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EmptyStateThresholdContent(
            projection =
                projectEmptyStateThreshold(
                    EmptyStateThresholdInput(
                        currentCount = 5,
                        threshold = 30,
                        sectionLabel = "Cost Heatmap",
                        itemNoun = "sessions",
                        description = "Charge more to unlock per-hour cost patterns.",
                    ),
                ),
            action = { Button(label = "Adjust filters", onClick = {}, variant = ButtonVariant.Outline, size = ButtonSize.Sm) },
        )
    }
}

@Preview(name = "Custom message override", showBackground = true)
@Composable
private fun EmptyStateThresholdCustomMessagePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EmptyStateThresholdContent(
            projection =
                projectEmptyStateThreshold(
                    EmptyStateThresholdInput(
                        currentCount = 2,
                        threshold = 12,
                        sectionLabel = "Sleep Efficiency",
                        message = "Park overnight a few more times to chart the drain curve.",
                    ),
                ),
        )
    }
}

@Preview(name = "Dark — section header", showBackground = true)
@Composable
private fun EmptyStateThresholdDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        EmptyStateThresholdContent(
            projection =
                projectEmptyStateThreshold(
                    EmptyStateThresholdInput(
                        currentCount = 12,
                        threshold = 30,
                        sectionLabel = "Cost Heatmap",
                        itemNoun = "sessions",
                    ),
                ),
        )
    }
}
