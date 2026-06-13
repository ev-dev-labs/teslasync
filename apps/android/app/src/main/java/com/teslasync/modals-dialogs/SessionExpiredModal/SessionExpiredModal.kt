// The native Jetpack Compose + Material 3 SessionExpiredModal modal/dialog — a parity port of the web
// `SessionExpiredModal` (web/src/components/feedback/SessionExpiredModal.tsx). The web component hard-blocks the
// UI once the upstream ForwardAuth session has fully expired: a centred rose lock badge, a "Session expired"
// heading, a one-line security explanation, and a single full-width "Sign in again" action that hands off to the
// identity provider. It is non-dismissible — Esc, the backdrop, and (here) the system back are absorbed; the
// only exit is the explicit re-auth handoff. This port reproduces every one of those branches with native
// primitives.
//
// Every render decision flows through the pure [SessionExpiredProjection] + [sessionMonitorFrom]
// (SessionExpiredModel.kt); the composable is a thin layer that binds the shared state holder, gates
// composition, and renders. The only strings are resolved from the i18n catalog (P1/S10)
// `session.expired.*` keys — there is no English literal in this file. The one-shot `view.opened` diagnostic
// (P1/S11) is emitted each time the hard block opens.
//
// Data binding (P1/S8): the native counterpart of the web `useSessionMonitor` session holder is the OIDC auth
// state machine exposed by [AuthController.uiState] (ADR-008), read via `LocalAuthController`. The view performs
// NO direct HTTP — it observes the auth surface, maps it with [sessionMonitorFrom], and projects. The web
// `navigateToReauth()` recovery (stash the return URL, navigate the top window to the IdP) maps to
// [AuthController.signIn], which launches the interactive OIDC PKCE sign-in through Chrome Custom Tabs — the
// platform-idiomatic IdP handoff.
//
// Web `open` prop -> host-gated composition: the web Modal render-gates on `open`; the Compose idiom prescribed
// by the shared `components/ui/Modal` KDoc is `if (open) Modal(...)`, so the stateful [SessionExpiredModal]
// returns before composing the dialog whenever the projection is not open (or is suppressed in open mode).
//
// Token mapping (P1/S9 tokens, no ported Tailwind): the web `ariaLabel`-only Modal (no visible header) maps to
// the native [Modal] with `title = null` + `accessibleName`, which renders no header row and no close affordance
// — faithful to the non-dismissible hard block. The web `rounded-full bg-rose-300/15` lock badge maps to
// [IconBox] (`Danger` tone, `Lg` 48 dp) hosting a 24 dp [Icon]; the `h2 text-base font-semibold text-primary`
// heading maps to [SectionTitle] (onSurface) with a `heading()` semantic; the `text-sm text-secondary` body
// maps to [BodyText] tinted `onSurfaceVariant`; the `Button variant="primary" w-full` maps to a full-width
// primary [Button]. Web `space-y-*` / `mt-*` insets map to `Spacing` tokens; the web `text-center` column maps
// to a centre-aligned [Column], mirroring the sibling auth-expiry surface (AuthScaffold).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/SessionExpiredModal) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.sessionexpiredmodal

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.auth.AuthController
import io.teslasync.android.auth.LocalAuthController
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.iconColorFor
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tags for the nodes the UI test selects (the web `data-testid` attributes). */
object SessionExpiredTestTags {
    const val ROOT: String = "session-expired-modal"
    const val BODY: String = "session-expired-body"
    const val SIGN_IN: String = "session-expired-signin"
}

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10). Bundled into one carrier
 * so the stateless [SessionExpiredContent] takes plain strings and stays trivially previewable + UI-testable.
 *
 * @property title the heading (web `session.expired.title`), also the dialog's accessible name.
 * @property body the one-line security explanation (web `session.expired.body`).
 * @property signIn the full-width re-auth action label (web `session.expired.signIn`).
 */
data class SessionExpiredStrings(
    val title: String,
    val body: String,
    val signIn: String,
)

/** Resolves every [SessionExpiredStrings] entry from the surface-owned i18n catalog keys (P1/S10). */
@Composable
fun rememberSessionExpiredStrings(): SessionExpiredStrings =
    SessionExpiredStrings(
        title = stringResource(R.string.translation_session_expired_title),
        body = stringResource(R.string.translation_session_expired_body),
        signIn = stringResource(R.string.translation_session_expired_signIn),
    )

/**
 * Stateful entry point — the faithful 1:1 port of the web `SessionExpiredModal()`. Binds the shared OIDC auth
 * state holder (P1/S8) via `LocalAuthController`, maps it onto the monitor snapshot, projects the render
 * decision, and — only when the projection is open — composes the non-dismissible hard block, recording the
 * one-shot PII-safe `view.opened` diagnostic (P1/S11) as it opens. Whenever the projection is suppressed (no
 * auth provider) or closed (the session is live), it composes nothing, mirroring the web `return null`.
 *
 * @param controller the shared auth state holder; defaults to the ambient `LocalAuthController` (web
 *   `useSessionMonitor`). Its `signIn()` is the native `navigateToReauth()` — the interactive IdP handoff.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SessionExpiredModal(
    modifier: Modifier = Modifier,
    controller: AuthController = LocalAuthController.current,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val authState by controller.uiState.collectAsStateWithLifecycle()
    // Web `const { mode, hasExpired } = useSessionMonitor()` then `mode === 'open' ? null : hasExpired || event`.
    // The native auth machine reflects a failed 401 refresh as ReauthRequired, so eventTriggered is always false.
    val display = SessionExpiredProjection.project(sessionMonitorFrom(authState), eventTriggered = false)
    if (!display.open) return

    val strings = rememberSessionExpiredStrings()
    LaunchedEffect(Unit) { recordSessionExpiredOpened(logger) }

    Modal(
        // Web `onClose={() => {}}` — a hard block: Esc, the backdrop, and system back are absorbed so the user
        // MUST take the explicit "Sign in again" action. Composition is gated by the auth state, never by a
        // local open flag a back-press could flip, so the dialog persists until the session is restored.
        onDismissRequest = {},
        modifier = modifier,
        // No visible header / close button (web passes `ariaLabel` only, not `title`); the heading lives in the
        // body and the title is exposed to assistive tech as the dialog's accessible pane name.
        title = null,
        accessibleName = strings.title,
        dismissOnBackdrop = false,
    ) {
        SessionExpiredContent(strings = strings, onSignIn = controller::signIn)
    }
}

/**
 * Stateless renderer — the preview + UI-test entry point. Lays out the web `space-y-4 text-center` column: the
 * centred rose lock badge, the heading + security explanation, and the full-width primary "Sign in again"
 * action that triggers [onSignIn].
 */
@Composable
fun SessionExpiredContent(
    strings: SessionExpiredStrings,
    onSignIn: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(SessionExpiredTestTags.ROOT),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        // Web `mx-auto h-12 w-12 rounded-full bg-rose-300/15` badge hosting a `h-6 w-6 text-rose-300` lock.
        IconBox(tone = IconBoxTone.Danger, size = IconBoxSize.Lg) {
            Icon(
                imageVector = FeedbackGlyphs.Lock,
                contentDescription = null,
                size = IconSize.Xl,
                tint = iconColorFor(IconBoxTone.Danger),
            )
        }

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            SectionTitle(strings.title, modifier = Modifier.semantics { heading() })
            BodyText(
                text = strings.body,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.testTag(SessionExpiredTestTags.BODY),
            )
        }

        Button(
            label = strings.signIn,
            onClick = onSignIn,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .testTag(SessionExpiredTestTags.SIGN_IN),
            variant = ButtonVariant.Primary,
        )
    }
}

// ── Preview (tooling-only; the @Preview entry point exercises the single hard-block render branch) ──────────

private val previewStrings =
    SessionExpiredStrings(
        title = "Session expired",
        body = "For your security, your session has timed out. Sign in again to pick up where you left off.",
        signIn = "Sign in again",
    )

@Preview(name = "Session expired hard block", showBackground = true, widthDp = 360)
@Composable
private fun SessionExpiredContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SessionExpiredContent(strings = previewStrings, onSignIn = {})
    }
}
