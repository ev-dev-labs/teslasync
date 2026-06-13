// The native Jetpack Compose + Material 3 RequiresAuth shared surface — a parity port of
// web/src/components/feedback/RequiresAuth.tsx. The web component is an auth-gated section wrapper: it reads the
// deployment auth-mode contract (web `useAuthMode`) and either renders the wrapped children (forward-auth mode
// with the capability enabled) or an auth-gated empty-state notice (a Lock glyph, a "<feature> requires
// authentication mode" title, and a body explaining the FORWARD_AUTH_HEADER configuration, with the operator's
// provider hint interpolated verbatim when one is set). While the contract is still loading the web deliberately
// renders the notice rather than the children, so a half-resolved contract never flashes a fully-mounted section.
//
// The native surface keeps that contract and performs NO HTTP. The host owns the shared P1/S8 [AuthModeStore];
// the view collects the auth-mode feed as a cache-then-network [UiState] (web `useAuthMode`) from the
// [RequiresAuthViewModel] and renders the resolved [RequiresAuthSurface]. Because the contract carries the full
// cache-then-network lifecycle, the gate is resolved from the best-known cached value exactly as the web reads
// the query's `data`, so loading / success / error / stale / offline all fold faithfully onto the web's
// children-or-notice outcomes (see RequiresAuthModel.kt for the full mapping) — no lifecycle state renders a
// blank surface, and none fabricates chrome the web source lacks. The view additionally honours the ADR-013
// freshness contract behaviourally by auto-refreshing a stale contract.
//
// Every string resolves through the i18n catalog (P1/S10): the `translation_requiresAuth_*` keys the web reads
// via `t(...)`, plus the per-capability `translation_requiresAuth_featureName_*` keys that resolve the native
// idiom's feature label (the web consumer passes an already-translated `feature` string; native derives it from
// the capability, with an optional override for parity). The notice is a polite live region carrying a merged
// TalkBack announcement (the web `role="status"`) and a stable per-capability test tag (web
// `data-testid="requires-auth-empty-<capability>"`); the Lock glyph is decorative (the web `aria-hidden`). The
// one-shot `view.opened` diagnostic (P1/S11) and the stale auto-refresh are the only effects this composable owns.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/RequiresAuth) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless content + supporting types + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.requiresauth

import androidx.annotation.StringRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.AuthModeCapabilities

/** Web `bg-[var(--bg-elevated)]/40` — the notice sits on a faintly-elevated, 40 %-opacity surface tint. */
private const val NOTICE_BG_ALPHA = 0.40f

/** Web `border` on the notice — a 1 dp hairline in the default border tint. */
private val NOTICE_BORDER_WIDTH: Dp = 1.dp

/** Web `max-w-md` (28 rem) cap on the body line so the centred copy wraps to a readable measure. */
private val NOTICE_TEXT_MAX_WIDTH: Dp = 448.dp

/**
 * Stateful entry point — the faithful port of the web `RequiresAuth`. Collects the [RequiresAuthViewModel]'s
 * auth-mode contract feed, records the one-shot `view.opened` diagnostic on first composition (P1/S11),
 * auto-refreshes a stale contract (the ADR-013 freshness contract), and renders the resolved surface: the wrapped
 * [content] when the [capability] is available, otherwise the auth-gated notice. Performs no HTTP.
 *
 * A single [viewModel] can gate every wrapped section on a screen — the contract feed is capability-agnostic, and
 * each call applies its own [capability] at the render boundary.
 *
 * @param capability the capability the wrapped section needs in order to mount (web `capability` prop).
 * @param viewModel the state holder bound to the shared S8 [io.teslasync.shared.core.presentation.authmode.AuthModeStore] feed.
 * @param feature an already-localized feature label to interpolate into the notice; defaults to the capability's
 *   own catalog name (the native idiom — the web consumer always passes its own translated `feature`).
 * @param content the section rendered when the capability is available (web `children`).
 */
@Composable
fun RequiresAuth(
    capability: RequiresAuthCapability,
    viewModel: RequiresAuthViewModel,
    modifier: Modifier = Modifier,
    feature: String? = null,
    content: @Composable () -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }

    // ADR-013 freshness contract: a stale (non-error) contract auto-refreshes, keyed so it fires at most once per
    // distinct freshness transition, never in a loop.
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) viewModel.refresh()
    }

    RequiresAuthContent(
        state = state,
        capability = capability,
        modifier = modifier,
        feature = feature,
        content = content,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Projects [state] +
 * [capability] into a [RequiresAuthSurface] and renders the matching shape: the wrapped [content] when
 * [RequiresAuthSurface.Unlocked] (web `forward_auth && capabilities[capability]`), or the auth-gated notice when
 * [RequiresAuthSurface.Locked] (web `isLoading || !data`, open mode, or a disabled capability). Trusts its caller
 * for the bound [state]; the stateful [RequiresAuth] supplies it from the shared feed.
 */
@Composable
fun RequiresAuthContent(
    state: UiState<AuthModeView>,
    capability: RequiresAuthCapability,
    modifier: Modifier = Modifier,
    feature: String? = null,
    strings: RequiresAuthStrings = rememberRequiresAuthStrings(),
    content: @Composable () -> Unit,
) {
    when (val surface = RequiresAuthProjection.project(state, capability)) {
        RequiresAuthSurface.Unlocked -> content()
        is RequiresAuthSurface.Locked ->
            RequiresAuthLockedNotice(
                capability = capability,
                feature = feature,
                providerHint = surface.providerHint,
                strings = strings,
                modifier = modifier,
            )
    }
}

/**
 * The web gated notice: a rounded, hairline-bordered, faintly-elevated surface with a centred muted Lock glyph,
 * the "<feature> requires authentication mode" title (web `Heading level="panel"`), and the configuration body
 * (web `Text variant="bodySm"`), with the operator's [providerHint] interpolated when present. The whole notice
 * is a polite live region carrying a merged TalkBack announcement (web `role="status"`) and the stable
 * per-capability test tag (web `data-testid`).
 */
@Composable
private fun RequiresAuthLockedNotice(
    capability: RequiresAuthCapability,
    feature: String?,
    providerHint: String?,
    strings: RequiresAuthStrings,
    modifier: Modifier = Modifier,
) {
    val featureLabel = feature ?: strings.featureName(capability)
    val title = strings.title(featureLabel)
    val body =
        if (providerHint != null) {
            strings.bodyWithHint(featureLabel, providerHint)
        } else {
            strings.body(featureLabel)
        }
    val announcement = "$title. $body"

    Surface(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(requiresAuthEmptyTestId(capability))
                .semantics(mergeDescendants = true) {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = announcement
                },
        shape = RoundedCornerShape(Radius.lg),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = NOTICE_BG_ALPHA),
        border = BorderStroke(NOTICE_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Spacing.xl2, vertical = Spacing.xl4),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Icon(
                FeedbackGlyphs.Lock,
                contentDescription = null,
                size = IconSize.Xl,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Heading(title, level = HeadingLevel.Panel)
            BodyText(
                body,
                modifier = Modifier.widthIn(max = NOTICE_TEXT_MAX_WIDTH),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * The localized microcopy the notice renders — every string the web component reads via `t(...)` plus the native
 * idiom's per-capability feature name. The interpolated forms are lambdas so the composable fills the `%1$s` /
 * `%2$s` arguments through `Context.getString`; tests pass a deterministic instance. All keys already exist in
 * the P1/S10 catalog (`translation_requiresAuth_*`).
 *
 * @property featureName the localized feature label for a capability (web's already-translated `feature` prop).
 * @property title the "<feature> requires authentication mode" heading (web `requiresAuth.title`).
 * @property body the configuration body with no provider hint (web `requiresAuth.body`).
 * @property bodyWithHint the configuration body interpolating the operator's hint (web `requiresAuth.bodyWithHint`).
 */
data class RequiresAuthStrings(
    val featureName: (capability: RequiresAuthCapability) -> String,
    val title: (feature: String) -> String,
    val body: (feature: String) -> String,
    val bodyWithHint: (feature: String, provider: String) -> String,
)

/**
 * Builds the localized [RequiresAuthStrings] from the i18n catalog (P1/S10). The interpolated title / body
 * resolve through `Context.getString` so the positional arguments are filled by the catalog; the per-capability
 * feature name resolves through [featureNameRes].
 */
@Composable
private fun rememberRequiresAuthStrings(): RequiresAuthStrings {
    val context = LocalContext.current
    return remember(context) {
        RequiresAuthStrings(
            featureName = { capability -> context.getString(featureNameRes(capability)) },
            title = { feature -> context.getString(R.string.translation_requiresAuth_title, feature) },
            body = { feature -> context.getString(R.string.translation_requiresAuth_body, feature) },
            bodyWithHint = { feature, provider ->
                context.getString(R.string.translation_requiresAuth_bodyWithHint, feature, provider)
            },
        )
    }
}

/** Maps a [RequiresAuthCapability] to its catalog feature-name resource (the native idiom for the web `feature`). */
@StringRes
private fun featureNameRes(capability: RequiresAuthCapability): Int =
    when (capability) {
        RequiresAuthCapability.StepUpReauth -> R.string.translation_requiresAuth_featureName_stepUpReauth
        RequiresAuthCapability.TotpEnrollment -> R.string.translation_requiresAuth_featureName_totpEnrollment
        RequiresAuthCapability.SessionList -> R.string.translation_requiresAuth_featureName_sessionList
        RequiresAuthCapability.Impersonation -> R.string.translation_requiresAuth_featureName_impersonation
        RequiresAuthCapability.Rbac -> R.string.translation_requiresAuth_featureName_rbac
    }

// ── Previews (tooling-only; exercise both render shapes across the web outcomes) ─────────────────────────────

private fun contentState(
    isForwardAuth: Boolean,
    capabilities: AuthModeCapabilities,
    providerHint: String?,
): UiState<AuthModeView> =
    UiState(
        phase = UiPhase.Content,
        data = AuthModeView(isForwardAuth = isForwardAuth, capabilities = capabilities, providerHint = providerHint),
    )

@Preview(name = "Locked — open mode, no provider hint", showBackground = true)
@Composable
private fun RequiresAuthLockedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RequiresAuthContent(
            state = contentState(isForwardAuth = false, capabilities = AuthModeCapabilities(), providerHint = null),
            capability = RequiresAuthCapability.SessionList,
        ) {
            BodyText("Active sessions section")
        }
    }
}

@Preview(name = "Locked — open mode, with provider hint", showBackground = true)
@Composable
private fun RequiresAuthLockedWithHintPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RequiresAuthContent(
            state = contentState(isForwardAuth = false, capabilities = AuthModeCapabilities(), providerHint = "Authentik"),
            capability = RequiresAuthCapability.Impersonation,
        ) {
            BodyText("Impersonation controls")
        }
    }
}

@Preview(name = "Unlocked — forward-auth with capability (dark)", showBackground = true)
@Composable
private fun RequiresAuthUnlockedPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        RequiresAuthContent(
            state =
                contentState(
                    isForwardAuth = true,
                    capabilities = AuthModeCapabilities(sessionList = true),
                    providerHint = null,
                ),
            capability = RequiresAuthCapability.SessionList,
        ) {
            BodyText("Active sessions section (unlocked)")
        }
    }
}

@Preview(name = "Locked — contract loading (dark)", showBackground = true)
@Composable
private fun RequiresAuthLoadingPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        RequiresAuthContent(
            state = UiState.loading(),
            capability = RequiresAuthCapability.Rbac,
        ) {
            BodyText("RBAC matrix")
        }
    }
}
