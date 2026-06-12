// The native Jetpack Compose + Material 3 OnboardingGate feature view — a parity port of
// web/src/features/onboarding/components/OnboardingGate.tsx. The web component is a first-run redirect guard:
// it binds the onboarding gate read (`useOnboardingStatus`), the persisted skip flag (`useOnboardingSkip`),
// the current path (`useLocation`) and `useNavigate`, and in one effect bounces the user to `/onboarding`
// (replacing history) whenever the install is resolved-but-incomplete, not skipped, and not on an
// allow-listed path — otherwise it returns `null` and lets the app render normally.
//
// This port keeps that contract end to end. All decision LOGIC lives in the pure [OnboardingGateResolver]
// (OnboardingGateModel.kt, off-device tested); the gate read is bound through the shared **S8**
// [OnboardingGateSource] into an [OnboardingGateViewModel] (no HTTP touches the view). The web
// `navigate('/onboarding', { replace: true })` (which renders nothing) becomes a one-shot
// `onRedirect(OnboardingGateTarget)` emitted from an effect — the host wires it to its NavController and
// replaces the guarded entry. `useLocation` and `useOnboardingSkip` are hoisted as the [pathname] and
// [isSkipped] inputs the host supplies (the native analogue of the synchronous web reads), exactly as the
// sibling Legacy*Redirect surfaces hoist their location.
//
// State honesty (covenant: no silent drift): the guard binds a real cache-then-network read, so loading /
// error / stale / offline are genuine inputs — but in the web source they ALL resolve to the same behaviour
// (do nothing, render `null`), so each maps to a [OnboardingGateDecision.Pass] in the resolver. A Pass draws
// nothing here — the guard is transparent and the host renders the requested screen unobstructed (the
// faithful native form of `return null`), never a blank takeover surface. Only an in-flight Redirect shows a
// brief, accessible route-transition affordance (a centered brand spinner, or a static labeled row under
// reduced motion) so the redirect moment is never a blank box. Every string resolves through the i18n catalog
// (P1/S10); the affordance carries a single accessible "Loading" name for TalkBack. The one-shot `view.opened`
// diagnostic (P1/S11) fires on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/OnboardingGate) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.onboardinggate

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point for the first-run onboarding gate. Binds the shared S8 onboarding feed via [source]
 * into an [OnboardingGateViewModel], computes the redirect [OnboardingGateDecision] from the resolved status
 * plus the hoisted [isSkipped] flag and current [pathname] (the web effect's
 * `[data, isLoading, isError, isSkipped, location.pathname]` inputs), records the one-shot `view.opened`
 * diagnostic, emits the target through [onRedirect] when a redirect is due (web
 * `navigate('/onboarding', { replace: true })`), and renders the transient route-transition affordance while
 * the host swaps the route. The guard performs NO HTTP and never touches navigation directly.
 *
 * @param source an adapter over the shared S8 onboarding state holder (the host binds it via
 *   [bindOnboardingGateSource]); a fake stands in for tests.
 * @param pathname the current path in web-path form (web `useLocation().pathname`), supplied by the host so
 *   the allow-list matches the web source 1:1.
 * @param onRedirect invoked once with the resolved target when a redirect is due; the host navigates and
 *   replaces the guarded entry.
 * @param isSkipped the persisted "Skip for now" flag (web `useOnboardingSkip`), supplied by the host;
 *   defaults to not-skipped.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param instanceKey a unique key per placement so the hosted ViewModel is scoped correctly.
 */
@Composable
fun OnboardingGate(
    source: OnboardingGateSource,
    pathname: String,
    onRedirect: (OnboardingGateTarget) -> Unit,
    modifier: Modifier = Modifier,
    isSkipped: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = OnboardingGateDiagnostics.SLUG,
) {
    val viewModel: OnboardingGateViewModel =
        viewModel(key = instanceKey, factory = OnboardingGateViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val status by viewModel.status.collectAsStateWithLifecycle()
    val decision =
        remember(status, isSkipped, pathname) {
            OnboardingGateResolver.decide(status = status, isSkipped = isSkipped, pathname = pathname)
        }
    OnboardingGateContent(decision = decision, onRedirect = onRedirect, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Fires the redirect once for a
 * [OnboardingGateDecision.Redirect] (web `navigate(..., { replace: true })`) and shows the transient
 * route-transition affordance; for a [OnboardingGateDecision.Pass] it draws nothing so the host renders the
 * requested screen unobstructed (the faithful native form of the web component's `return null`).
 * [reduceMotion] defaults to the active platform/app preference and is overridable for tests.
 */
@Composable
fun OnboardingGateContent(
    decision: OnboardingGateDecision,
    onRedirect: (OnboardingGateTarget) -> Unit,
    modifier: Modifier = Modifier,
    reduceMotion: Boolean = rememberReducedMotion(),
) {
    when (decision) {
        is OnboardingGateDecision.Redirect -> {
            LaunchedEffect(decision.target) { onRedirect(decision.target) }
            RedirectingIndicator(reduceMotion = reduceMotion, modifier = modifier)
        }
        // Pass: the guard takes no action, so it draws nothing and the host renders the requested screen
        // unobstructed — the faithful native form of the web component's `return null`. A transparent guard,
        // never a blank takeover surface.
        is OnboardingGateDecision.Pass -> Unit
    }
}

/**
 * The transient redirect affordance — the honest native representation of the frame between emitting the
 * target and the host completing the navigation. (The web `navigate` redirects synchronously within the same
 * render pass and renders nothing; native navigation is event-driven, so this brief status is shown instead
 * of a blank box.) Honors reduced motion: an animated brand [Spinner] normally, a static labeled row when
 * motion is reduced. Both expose the same single localized accessible name so TalkBack announces it either way.
 */
@Composable
private fun RedirectingIndicator(
    reduceMotion: Boolean,
    modifier: Modifier = Modifier,
) {
    val label = stringResource(R.string.translation_common_loading)
    val accessibleLabel = stringResource(R.string.translation_a11y_loading)
    Box(
        modifier = modifier.fillMaxWidth().padding(Spacing.xl2),
        contentAlignment = Alignment.Center,
    ) {
        if (reduceMotion) {
            Row(
                modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = accessibleLabel },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Icon(imageVector = TeslaGlyphs.ChevronRight, contentDescription = null, size = IconSize.Md)
                BodyText(label)
            }
        } else {
            Spinner(size = SpinnerSize.Md, label = label, accessibleLabel = accessibleLabel)
        }
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each visible render branch) ──────────────────

@Preview(name = "Redirecting", showBackground = true)
@Composable
private fun OnboardingGateRedirectingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OnboardingGateContent(
            decision = OnboardingGateDecision.Redirect(OnboardingGateTarget()),
            onRedirect = {},
            reduceMotion = false,
        )
    }
}

@Preview(name = "Redirecting (reduced motion)", showBackground = true)
@Composable
private fun OnboardingGateRedirectingReducedMotionPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OnboardingGateContent(
            decision = OnboardingGateDecision.Redirect(OnboardingGateTarget()),
            onRedirect = {},
            reduceMotion = true,
        )
    }
}
