// The native Jetpack Compose + Material 3 SessionExpiringModal modal/dialog — a parity port of the web
// `SessionExpiringModal` (web/src/components/feedback/SessionExpiringModal.tsx). The web component pops up ~60s
// before the upstream session cookie expires with a live countdown and two affordances — "Stay signed in"
// (renew) and "Sign out now" (hand off to the identity provider) — and, when the user has unsaved form drafts,
// lists them so nothing is silently lost. This port reproduces every one of those branches with native
// primitives.
//
// Every derivation flows through the pure [SessionExpiringProjection] + [SessionExpiringDisplay]
// (SessionExpiringModalModel.kt); the composable is a thin render layer. The only strings are resolved from the
// generated i18n catalog (P1/S10) `translation_session_expiring_*` keys — there is no English literal in this
// file outside the tooling-only @Preview fixtures. The one-shot `view.opened` diagnostic (P1/S11) is emitted on
// first composition of the open modal.
//
// Data binding (P1/S8): the web reads `useSessionMonitor()`. On native there is no ForwardAuth cookie — the
// session is the OIDC access token, and `AuthController` (the app-global auth state holder reached via
// `LocalAuthController`) exposes the renew/sign-out actions but not the token's remaining-seconds. So — exactly
// like the sibling ConfirmDialog / IncidentForm dialogs — the surface is host-bound: the app shell that owns the
// monitor + the 1 Hz countdown clock derives the [SessionExpiryState] (via [SessionExpiringProjection.
// deriveSessionExpiry]) and the renew/sign-out callbacks, and feeds them in. The view itself performs no HTTP.
// Web `open` -> the modal composes its content only when [SessionExpiringDisplay.open] is true; the Compose
// idiom prescribed by the shared `components/ui/Modal` KDoc.
//
// Token mapping (P1/S9 tokens, no ported Tailwind): the web header `rounded-lg bg-amber-300/15 p-2` Clock box
// maps to a Warning-toned [IconBox]; the `h-5 w-5 text-amber-300` Clock maps to [Icon] at [IconSize.Lg] (the
// box paints the amber content color, the icon inherits it). The `text-base font-semibold` title maps to
// [SectionTitle]; the `text-sm text-[var(--text-secondary)]` countdown maps to [HelperText]. The drafts panel
// (`rounded-lg border-amber-300/20 bg-amber-300/[0.04] p-3`) maps to a rounded [Column] with a Warning-tinted
// `outline` border + faint Warning fill + [Spacing.md] padding; its `AlertTriangle` maps to [TeslaGlyphs.Warning],
// its uppercase label to [Caption] (the CSS `uppercase` is presentation-only and intentionally not applied so
// the label keeps its localized casing for TalkBack), its body to [HelperText], each `• {label}` row to a
// single-line [BodyText], and the `+N more` row to [HelperText]. The `ghost` / `primary` actions map to
// [ButtonVariant.Ghost] / [ButtonVariant.Primary]; web `gap-*` insets map to [Spacing] tokens.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/SessionExpiringModal) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.sessionexpiringmodal

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.iconColorFor
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tags for the nodes the UI test selects (the web `data-testid` attributes). */
object SessionExpiringTestTags {
    const val ROOT: String = "session-expiring-modal"
    const val COUNTDOWN: String = "session-expiring-countdown"
    const val DRAFTS: String = "session-expiring-drafts"
    const val SIGN_OUT: String = "session-expiring-signout"
    const val STAY: String = "session-expiring-stay"
}

/**
 * The already-localized dialog microcopy the composable reads from the generated i18n catalog (P1/S10). Bundled
 * into one carrier so the stateless [SessionExpiringContent] takes plain strings and stays trivially previewable
 * + UI-testable. [bodyTemplate] and [moreTemplate] still carry the catalog's `%1$s` positional token; the render
 * layer substitutes the countdown / overflow count via [SessionExpiringProjection.applyArg].
 */
data class SessionExpiringStrings(
    val title: String,
    val bodyTemplate: String,
    val unsavedTitle: String,
    val unsavedBody: String,
    val moreTemplate: String,
    val signOut: String,
    val stay: String,
    val staying: String,
)

/** Resolves every [SessionExpiringStrings] entry from the generated catalog keys (P1/S10). */
@Composable
fun rememberSessionExpiringStrings(): SessionExpiringStrings =
    SessionExpiringStrings(
        title = stringResource(R.string.translation_session_expiring_title),
        bodyTemplate = stringResource(R.string.translation_session_expiring_body),
        unsavedTitle = stringResource(R.string.translation_session_expiring_unsavedTitle),
        unsavedBody = stringResource(R.string.translation_session_expiring_unsavedBody),
        moreTemplate = stringResource(R.string.translation_session_expiring_moreDrafts),
        signOut = stringResource(R.string.translation_session_expiring_signOut),
        stay = stringResource(R.string.translation_session_expiring_stay),
        staying = stringResource(R.string.translation_session_expiring_staying),
    )

/**
 * Stateful entry point — the faithful port of the web `SessionExpiringModal`. Projects the host-derived
 * [state] + [drafts] + [refreshing] via the pure [SessionExpiringProjection], and renders the modal only while
 * [SessionExpiringDisplay.open] (web `open = mode === 'session' && isExpiringSoon && !hasExpired`); when closed
 * it emits nothing, exactly like the web component's null render. On first composition of the open modal it
 * records the one-shot PII-safe `view.opened` diagnostic (P1/S11). The shared [Modal] maps its Esc / back /
 * backdrop dismissal to [onStay] — mirroring the web, where dismissing the soft-blocking dialog implicitly
 * performs the renewal poll rather than hostilely swallowing the warning.
 *
 * @param state the derived monitor state the host computes each second from the session monitor (web
 *   `useSessionMonitor` output).
 * @param onStay "Stay signed in" handler; the host renews the session (web `refresh()`), keeping the modal open
 *   while [refreshing] is true.
 * @param onSignOut "Sign out now" handler; the host hands off to the identity provider (web `navigateToReauth`).
 * @param drafts the user's unsaved form drafts to surface; empty by default (the no-drafts branch).
 * @param refreshing whether the renewal is in flight — disables both actions and relabels "Stay signed in".
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SessionExpiringModal(
    state: SessionExpiryState,
    onStay: () -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
    drafts: List<DraftSummary> = emptyList(),
    refreshing: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val display =
        remember(state, drafts, refreshing) {
            SessionExpiringProjection.display(state, drafts, refreshing)
        }

    if (display.open) {
        val strings = rememberSessionExpiringStrings()
        LaunchedEffect(Unit) { recordSessionExpiringOpened(logger) }

        Modal(
            onDismissRequest = onStay,
            modifier = modifier,
            accessibleName = strings.title,
            dismissOnBackdrop = true,
        ) {
            SessionExpiringContent(
                display = display,
                strings = strings,
                onStay = onStay,
                onSignOut = onSignOut,
            )
        }
    }
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Lays out the amber Clock header (icon box +
 * title + live countdown), the optional unsaved-drafts panel, and the end-aligned "Sign out now" / "Stay signed
 * in" actions. The primary action disables and shows a spinner while [SessionExpiringDisplay.refreshing].
 */
@Composable
fun SessionExpiringContent(
    display: SessionExpiringDisplay,
    strings: SessionExpiringStrings,
    onStay: () -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(SessionExpiringTestTags.ROOT),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            IconBox(tone = IconBoxTone.Warning, size = IconBoxSize.Md) {
                Icon(imageVector = SessionClockGlyph, contentDescription = null, size = IconSize.Lg)
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                SectionTitle(text = strings.title)
                HelperText(
                    text = SessionExpiringProjection.applyArg(strings.bodyTemplate, display.countdownText),
                    modifier = Modifier.testTag(SessionExpiringTestTags.COUNTDOWN),
                )
            }
        }

        if (display.drafts.visible.isNotEmpty()) {
            DraftsPanel(drafts = display.drafts, strings = strings)
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, alignment = Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                label = strings.signOut,
                onClick = onSignOut,
                modifier = Modifier.testTag(SessionExpiringTestTags.SIGN_OUT),
                variant = ButtonVariant.Ghost,
            )
            Button(
                label = if (display.refreshing) strings.staying else strings.stay,
                onClick = onStay,
                modifier = Modifier.testTag(SessionExpiringTestTags.STAY),
                variant = ButtonVariant.Primary,
                enabled = !display.refreshing,
                loading = display.refreshing,
            )
        }
    }
}

/**
 * The unsaved-drafts panel — the web amber callout listing the form drafts that survive (but cannot be finished
 * after) a forced sign-out. A rounded, Warning-tinted, faintly-filled column hosting the AlertTriangle + label,
 * the explanatory body, the capped list of `• {label}` rows, and the `+N more` overflow row.
 */
@Composable
private fun DraftsPanel(
    drafts: DraftProjection,
    strings: SessionExpiringStrings,
    modifier: Modifier = Modifier,
) {
    val warning = iconColorFor(IconBoxTone.Warning)
    val shape = RoundedCornerShape(Radius.lg)
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(shape)
                .border(BorderStroke(1.dp, warning.copy(alpha = DRAFTS_BORDER_ALPHA)), shape)
                .background(warning.copy(alpha = DRAFTS_FILL_ALPHA))
                .padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(imageVector = TeslaGlyphs.Warning, contentDescription = null, size = IconSize.Sm, tint = warning)
            Caption(text = strings.unsavedTitle)
        }
        HelperText(text = strings.unsavedBody)
        Column(
            modifier = Modifier.testTag(SessionExpiringTestTags.DRAFTS),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            drafts.visible.forEach { draft ->
                BodyText(text = "$DRAFT_BULLET ${draft.label}", maxLines = 1)
            }
            if (drafts.overflowCount > 0) {
                HelperText(
                    text = SessionExpiringProjection.applyArg(strings.moreTemplate, drafts.overflowCount.toString()),
                )
            }
        }
    }
}

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

// The web Clock glyph (lucide `Clock`). Authored here as a 24×24 stroked vector — the shared TeslaGlyphs set has
// no clock and is outside this surface's allowed files — and recolored at render time by [Icon]'s tint, so it
// inherits the IconBox's amber content color (and every theme/state color) automatically.
private val SessionClockGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "SessionExpiringClock",
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = {
                    // Dial: a circle of radius 8 centered at (12,12), drawn as two semicircular arcs.
                    moveTo(4f, 12f)
                    arcTo(8f, 8f, 0f, false, true, 20f, 12f)
                    arcTo(8f, 8f, 0f, false, true, 4f, 12f)
                    close()
                    // Hands: hour straight up, minute toward the lower right.
                    moveTo(12f, 12f)
                    lineTo(12f, 7.5f)
                    moveTo(12f, 12f)
                    lineTo(15.5f, 13.5f)
                },
            )
        }.build()

private const val DRAFTS_BORDER_ALPHA = 0.2f
private const val DRAFTS_FILL_ALPHA = 0.04f
private const val DRAFT_BULLET = "•"

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val previewStrings =
    SessionExpiringStrings(
        title = "Your session is about to expire",
        bodyTemplate = "You will be signed out in %1\$s.",
        unsavedTitle = "Unsaved drafts",
        unsavedBody = "Sign out will keep these drafts in your browser, but you must sign in again to finish them.",
        moreTemplate = "+%1\$s more",
        signOut = "Sign out now",
        stay = "Stay signed in",
        staying = "Refreshing…",
    )

private fun previewDisplay(
    countdownText: String = "0:45",
    drafts: DraftProjection = DraftProjection(emptyList(), 0),
    refreshing: Boolean = false,
) = SessionExpiringDisplay(
    open = true,
    countdownText = countdownText,
    drafts = drafts,
    refreshing = refreshing,
)

@Preview(name = "Expiring, no drafts", showBackground = true, widthDp = 360)
@Composable
private fun SessionExpiringNoDraftsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionExpiringContent(
            display = previewDisplay(),
            strings = previewStrings,
            onStay = {},
            onSignOut = {},
        )
    }
}

@Preview(name = "Expiring, with drafts", showBackground = true, widthDp = 360)
@Composable
private fun SessionExpiringWithDraftsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionExpiringContent(
            display =
                previewDisplay(
                    countdownText = "0:30",
                    drafts =
                        DraftProjection(
                            visible =
                                listOf(
                                    DraftSummary("automation:new", 2L),
                                    DraftSummary("alertstudio:rule:42", 1L),
                                ),
                            overflowCount = 0,
                        ),
                ),
            strings = previewStrings,
            onStay = {},
            onSignOut = {},
        )
    }
}

@Preview(name = "Expiring, drafts over the limit", showBackground = true, widthDp = 360)
@Composable
private fun SessionExpiringOverflowDraftsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionExpiringContent(
            display =
                previewDisplay(
                    countdownText = "0:12",
                    drafts =
                        DraftProjection(
                            visible =
                                listOf(
                                    DraftSummary("draft:a"),
                                    DraftSummary("draft:b"),
                                    DraftSummary("draft:c"),
                                    DraftSummary("draft:d"),
                                    DraftSummary("draft:e"),
                                ),
                            overflowCount = 3,
                        ),
                ),
            strings = previewStrings,
            onStay = {},
            onSignOut = {},
        )
    }
}

@Preview(name = "Refreshing (renewal in flight)", showBackground = true, widthDp = 360)
@Composable
private fun SessionExpiringRefreshingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionExpiringContent(
            display = previewDisplay(countdownText = "0:08", refreshing = true),
            strings = previewStrings,
            onStay = {},
            onSignOut = {},
        )
    }
}
