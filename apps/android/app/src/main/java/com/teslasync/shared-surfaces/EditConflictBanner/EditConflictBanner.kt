// The native Jetpack Compose + Material 3 EditConflictBanner shared surface — a parity port of
// web/src/components/feedback/EditConflictBanner.tsx and the `@/components/feedback/AlertBanner` it wraps. The
// web surface is the in-place "another browser tab is editing this" warning: it binds
// `useEditLease(resourceKey)` and renders a warning `AlertBanner` ONLY when this view does not own the edit
// lease AND a peer has been observed claiming it. The banner shows the title, a body whose copy depends on
// whether a `resourceLabel` was supplied, a ghost "Take over editing" action (calls `claim()`), and an
// informational "switch to your other tab" hint. When this view owns the lease or no peer has been observed,
// the web returns `null` (renders nothing) — this surface reproduces that exactly via [EditConflictDisplay].
//
// There is no native AlertBanner content-slot (the shared AlertBanner takes a flat message + fixed action
// slots and cannot host the web's separate informational hint line beneath the action), so the alert chrome is
// composed here from the shared atoms (the feedback Tone palette + glyph, Button, BodyText/Caption) — the same
// approach the sibling AiLimitBanner takes for the web alert it has no 1:1 native atom for. Every visible
// string resolves through the i18n catalog (P1/S10); the banner carries a merged TalkBack announcement and is
// marked a polite live region (the web `role="status"` / `aria-live="polite"`).
//
// Data binds through the shared in-process edit-lease registry (P1/S8) via [EditLeaseSource] + the
// [EditConflictBannerViewModel]; this composable only owns the projection-to-render and the one-shot
// `view.opened` diagnostic (P1/S11). It performs NO HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/EditConflictBanner) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.editconflictbanner

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.toneColors
import io.teslasync.android.components.feedback.toneGlyph
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag on the banner container — the parity analogue of the web `data-testid="edit-conflict-banner"`. */
const val EDIT_CONFLICT_BANNER_TEST_TAG: String = "edit-conflict-banner"

/** Test tag on the take-over action — the parity analogue of `data-testid="edit-conflict-take-over"`. */
const val EDIT_CONFLICT_TAKE_OVER_TEST_TAG: String = "edit-conflict-take-over"

/** Test tag on the switch hint — the parity analogue of `data-testid="edit-conflict-switch-hint"`. */
const val EDIT_CONFLICT_SWITCH_HINT_TEST_TAG: String = "edit-conflict-switch-hint"

/** Web `border` on the alert — a 1 px hairline tinted to the warning severity. */
private val ALERT_BORDER_WIDTH = 1.dp

/**
 * The localized strings the banner folds into its output — built from `stringResource` at the render boundary
 * (tests pass a deterministic instance), keeping the projection a pure, locale-stable function. Every string
 * resolves through the P1/S10 catalog (the `editConflict.banner.*` keys).
 *
 * @property body the resolved body copy: the `resourceLabel`-aware variant when a label was supplied (web
 *   `bodyWithLabel`), else the generic copy (web `body`).
 */
data class EditConflictStrings(
    val title: String,
    val body: String,
    val takeOver: String,
    val switchHint: String,
)

/**
 * Stateful entry point — the faithful port of the web `EditConflictBanner({ resourceKey, resourceLabel })`.
 * Binds one edit-lease holder for [resourceKey] via [source] into an [EditConflictBannerViewModel], records
 * the one-shot `view.opened` diagnostic (P1/S11) on first composition, collects this holder's
 * [EditLeaseSnapshot], projects it, and renders the warning banner only while a peer holds the lease (web's
 * non-null render path). Renders nothing otherwise (web `return null`). Performs no HTTP; [source] defaults to
 * the shared process-wide registry and [logger] to the app's redacting logger.
 *
 * @param resourceKey stable identifier of the resource being edited (web `resourceKey`); distinct keys race
 *   independently. Convention is `<feature>/<scope>/<id>`.
 * @param resourceLabel optional human-readable noun used in the banner copy (web `resourceLabel`); when set the
 *   `resourceLabel`-aware body is shown.
 * @param source the edit-lease seam; defaults to the shared in-process [EditLeaseRegistry].
 * @param logger the redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun EditConflictBanner(
    resourceKey: String,
    modifier: Modifier = Modifier,
    resourceLabel: String? = null,
    source: EditLeaseSource = EditLeaseRegistry.process,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: EditConflictBannerViewModel =
        viewModel(
            key = "${EditConflictBannerRegistration.SLUG}:$resourceKey",
            factory = EditConflictBannerViewModel.factory(source, resourceKey, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val snapshot by viewModel.snapshot.collectAsStateWithLifecycle()
    val display = remember(snapshot) { EditConflictProjection.project(snapshot) }

    EditConflictBannerContent(
        display = display,
        strings = rememberEditConflictStrings(resourceLabel),
        modifier = modifier,
        onTakeOver = viewModel::claim,
    )
}

/**
 * Stateless renderer — the preview + UI-test entry point. Renders the warning banner when [display] is in
 * conflict, or nothing when it is Hidden (web `isOwner || otherTab === null` → `null`). Hoisted out of the
 * ViewModel so every branch is preview- and screenshot-testable.
 */
@Composable
fun EditConflictBannerContent(
    display: EditConflictDisplay,
    strings: EditConflictStrings,
    modifier: Modifier = Modifier,
    onTakeOver: () -> Unit = {},
) {
    if (!display.visible) return
    EditConflictAlert(strings = strings, modifier = modifier, onTakeOver = onTakeOver)
}

/**
 * The web AlertBanner chrome for the conflict: a warning-tinted, bordered surface with the alert-triangle
 * glyph, the title, the body, a ghost "Take over editing" action, and the informational switch hint. Marked a
 * polite live region with a merged title+body announcement (web `role="status"` / `aria-live="polite"`).
 */
@Composable
private fun EditConflictAlert(
    strings: EditConflictStrings,
    modifier: Modifier = Modifier,
    onTakeOver: () -> Unit,
) {
    val tone = Tone.Warning
    val colors = toneColors(tone)
    val announcement = "${strings.title}. ${strings.body}"

    Surface(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(EDIT_CONFLICT_BANNER_TEST_TAG)
                .semantics {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = announcement
                },
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
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Text(strings.title, style = MaterialTheme.typography.titleSmall, color = colors.foreground)
                BodyText(strings.body, color = MaterialTheme.colorScheme.onSurface)
                EditConflictActions(strings = strings, onTakeOver = onTakeOver)
            }
        }
    }
}

/**
 * The action group beneath the body — the web `mt-2 flex flex-wrap` row: the ghost "Take over editing" button
 * and the muted switch hint. Stacked so the full-sentence hint never collides with the action on a phone, the
 * faithful mobile rendering of the web flex-wrap.
 */
@Composable
private fun EditConflictActions(
    strings: EditConflictStrings,
    onTakeOver: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Button(
            label = strings.takeOver,
            onClick = onTakeOver,
            modifier = Modifier.testTag(EDIT_CONFLICT_TAKE_OVER_TEST_TAG),
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
        Caption(strings.switchHint, modifier = Modifier.testTag(EDIT_CONFLICT_SWITCH_HINT_TEST_TAG))
    }
}

/**
 * Builds the localized banner strings from the P1/S10 catalog. The body resolves to the `resourceLabel`-aware
 * copy (the `%1$s` format argument) when [resourceLabel] is supplied, else the generic copy — the web
 * `resourceLabel ? bodyWithLabel : body` decision. Tests pass a deterministic instance instead.
 */
@Composable
private fun rememberEditConflictStrings(resourceLabel: String?): EditConflictStrings {
    val body =
        if (resourceLabel != null) {
            stringResource(R.string.translation_editConflict_banner_bodyWithLabel, resourceLabel)
        } else {
            stringResource(R.string.translation_editConflict_banner_body)
        }
    return EditConflictStrings(
        title = stringResource(R.string.translation_editConflict_banner_title),
        body = body,
        takeOver = stringResource(R.string.translation_editConflict_banner_takeOver),
        switchHint = stringResource(R.string.translation_editConflict_banner_switchHint),
    )
}

// ── Previews — the visible conflict surface with the generic and the resource-labeled body. The Hidden surface
// renders nothing (web `null`), so it has no preview. ───────────────────────────────────────────────────────

private fun previewStrings(body: String): EditConflictStrings =
    EditConflictStrings(
        title = "Another browser tab is editing this",
        body = body,
        takeOver = "Take over editing",
        switchHint = "Or switch to your other tab to keep editing there.",
    )

private const val PREVIEW_BODY =
    "This resource is open in another tab of this browser. Saving here will overwrite changes made there."

private const val PREVIEW_BODY_LABELED =
    "Your settings is open in another tab of this browser. Saving here will overwrite changes made there."

@Preview(name = "EditConflictBanner · conflict (generic)", showBackground = true)
@Composable
private fun EditConflictBannerGenericPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EditConflictBannerContent(
            display = EditConflictDisplay(phase = EditConflictPhase.Conflict, otherTabId = "peer-tab-aaa"),
            strings = previewStrings(PREVIEW_BODY),
        )
    }
}

@Preview(name = "EditConflictBanner · conflict (labeled)", showBackground = true)
@Composable
private fun EditConflictBannerLabeledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EditConflictBannerContent(
            display = EditConflictDisplay(phase = EditConflictPhase.Conflict, otherTabId = "peer-tab-bbb"),
            strings = previewStrings(PREVIEW_BODY_LABELED),
        )
    }
}
