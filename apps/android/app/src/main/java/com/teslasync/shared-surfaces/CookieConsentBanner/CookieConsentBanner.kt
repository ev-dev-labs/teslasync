// The native Jetpack Compose + Material 3 CookieConsentBanner shared surface — a parity port of
// web/src/components/feedback/CookieConsentBanner.tsx. The web file is the GDPR/ePrivacy consent banner shown the
// first time a user lands when the deployment opts into consent collection (`require_cookie_consent === true`) and
// the user has not yet decided (`getConsent() === 'unknown'`): a shield-marked notice with a title + body, a
// "Manage preferences" disclosure listing the two cookie categories (Strictly necessary / Performance & error
// reporting), and "Accept all" / "Decline non-essential" actions that persist the decision and unmount the banner.
//
// This surface is the native equivalent. All data flows through the shared [CookieConsentBannerViewModel] over the
// [CookieConsentBannerSource] seam (P1/S8) — the view performs NO HTTP and touches no persistence directly. Every
// derivation flows through the pure [CookieConsentBannerProjection]; the composable is a thin render layer that
// owns only the "Manage preferences" disclosure toggle (the web `showDetails` `useState`) and the one-shot
// `view.opened` diagnostic (P1/S11). Where the web hides itself with `return null` (loading / consent not needed /
// already decided), this surface renders every state as a non-blank region (the platform contract, exactly as the
// sibling ServiceStatus surface does):
//   • loading  → skeleton chrome while the deployment gate loads;
//   • error    → a retry affordance when the gate fetch hard-failed;
//   • prompt   → the active consent banner (the web's only rendered state);
//   • resolved → a friendly "consent recorded / not required" panel (the native form of the web `return null`);
//   • stale/offline → the last-known gate with a "Stale" / "offline" chip + retry.
// Every visible string resolves through the i18n catalog (P1/S10); the prompt carries a merged TalkBack
// announcement (the web `role="dialog"` + `aria-labelledby`/`aria-describedby`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/CookieConsentBanner) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless renderer + previews + glyph.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.cookieconsentbanner

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.CardPadding
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the whole surface container — used by the instrumented per-state + a11y UI tests. */
const val COOKIE_CONSENT_TEST_TAG: String = "cookie-consent-banner"

/** Test tag identifying the "Accept all" control (web `data-testid="cookie-consent-accept"`). */
const val COOKIE_CONSENT_ACCEPT_TAG: String = "cookie-consent-accept"

/** Test tag identifying the "Decline non-essential" control (web `data-testid="cookie-consent-decline"`). */
const val COOKIE_CONSENT_DECLINE_TAG: String = "cookie-consent-decline"

/** Test tag identifying the "Manage preferences" disclosure toggle (web `cookie-consent-toggle-details`). */
const val COOKIE_CONSENT_TOGGLE_TAG: String = "cookie-consent-toggle-details"

/** Test tag identifying the expanded two-category details block (web `cookie-consent-details`). */
const val COOKIE_CONSENT_DETAILS_TAG: String = "cookie-consent-details"

/** Test tag identifying the retry control shown on the error + offline surfaces. */
const val COOKIE_CONSENT_RETRY_TAG: String = "cookie-consent-retry"

/** The shield-icon box diameter — the native mirror of the web `h-9 w-9` rounded icon container. */
private val ICON_BOX_SIZE = 36.dp

/** Skeleton bar heights for the loading chrome. */
private val SKELETON_TITLE_HEIGHT = 14.dp
private val SKELETON_BODY_HEIGHT = 10.dp

/**
 * The localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests pass a deterministic instance), keeping the projection a pure, locale-stable function. Every string
 * resolves through the P1/S10 catalog — no English literal lives in native code.
 */
data class CookieConsentStrings(
    val title: String,
    val body: String,
    val manage: String,
    val hideDetails: String,
    val accept: String,
    val decline: String,
    val essentialTitle: String,
    val essentialBody: String,
    val alwaysOn: String,
    val analyticsTitle: String,
    val analyticsBody: String,
    val resolvedAccepted: String,
    val resolvedDeclined: String,
    val resolvedNotRequired: String,
    val loading: String,
    val stale: String,
    val offline: String,
    val retry: String,
    val errorTitle: String,
    val errorBody: String,
)

/**
 * Stateful entry point bound to the shared Settings feed + the local consent store — the faithful port of the web
 * `CookieConsentBanner`. Binds the [CookieConsentBannerViewModel], records the one-shot `view.opened` diagnostic
 * (P1/S11), collects the deployment gate + the per-user decision, owns the "Manage preferences" disclosure toggle
 * (web `showDetails`), projects everything into the render the stateless surface paints, auto-refreshes a TTL-stale
 * gate, and wires Accept/Decline/Retry to the view-model.
 *
 * @param modifier optional layout modifier for the surface container.
 * @param source the requirement + consent seam; defaults to the shared Settings store + the app's consent
 *   SharedPreferences ([rememberCookieConsentBannerSource]).
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun CookieConsentBanner(
    modifier: Modifier = Modifier,
    source: CookieConsentBannerSource = rememberCookieConsentBannerSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: CookieConsentBannerViewModel =
        viewModel(
            key = CookieConsentBannerRegistration.ID,
            factory = CookieConsentBannerViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val requirement by viewModel.requirement.collectAsStateWithLifecycle()
    val consent by viewModel.consent.collectAsStateWithLifecycle()
    var showDetails by rememberSaveable { mutableStateOf(false) }
    val render =
        remember(requirement, consent, showDetails) {
            CookieConsentBannerProjection.render(requirement, consent, showDetails)
        }

    // Web `useVersionInfo` poll → a TTL-stale gate quietly re-fetches; the offline/error surfaces keep their
    // explicit retry so a failed refresh is never auto-looped.
    LaunchedEffect(requirement.stale, requirement.refreshing, requirement.hasError) {
        if (requirement.stale && !requirement.refreshing && !requirement.hasError) viewModel.refresh()
    }

    FadeIn(modifier = modifier) {
        CookieConsentBannerContent(
            render = render,
            strings = rememberCookieConsentStrings(),
            onAccept = viewModel::accept,
            onDecline = viewModel::decline,
            onToggleDetails = { showDetails = !showDetails },
            onRetry = viewModel::refresh,
        )
    }
}

/**
 * Stateless surface — the unit/UI-test and preview entry point. Always renders a non-blank [GlassPanel] (never the
 * web `return null`), switching its body on the projected [CookieConsentRender.phase]. Hoisted out of the
 * ViewModel so it is preview- and screenshot-testable for each state.
 */
@Composable
fun CookieConsentBannerContent(
    render: CookieConsentRender,
    strings: CookieConsentStrings,
    modifier: Modifier = Modifier,
    onAccept: () -> Unit = {},
    onDecline: () -> Unit = {},
    onToggleDetails: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    GlassPanel(
        modifier = modifier.fillMaxWidth().testTag(COOKIE_CONSENT_TEST_TAG),
        padding = PanelPadding.Md,
    ) {
        when {
            render.showLoading -> ConsentLoading(strings)
            render.showError -> ConsentError(strings, onRetry)
            render.showPrompt -> ConsentPrompt(render, strings, onAccept, onDecline, onToggleDetails, onRetry)
            else -> ConsentResolved(render, strings, onRetry)
        }
    }
}

/** The shield header — the rounded tinted icon box + the title, shared by the prompt and resolved surfaces. */
@Composable
private fun ConsentHeader(
    title: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier =
                Modifier
                    .size(ICON_BOX_SIZE)
                    .clip(RoundedCornerShape(Radius.md))
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = ICON_WASH_ALPHA)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(ShieldCheckGlyph, contentDescription = null, size = IconSize.Md, tint = MaterialTheme.colorScheme.primary)
        }
        PanelTitle(title, modifier = Modifier.weight(1f))
    }
}

/** The active consent prompt — the web banner: header, body, the details disclosure, and the two actions. */
@Composable
private fun ConsentPrompt(
    render: CookieConsentRender,
    strings: CookieConsentStrings,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    onToggleDetails: () -> Unit,
    onRetry: () -> Unit,
) {
    val announcement = "${strings.title}. ${strings.body}"
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = announcement },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        ConsentHeader(strings.title)
        HelperText(strings.body)
        ConsentFreshnessRow(render, strings, onRetry)
        Button(
            label = if (render.showDetails) strings.hideDetails else strings.manage,
            onClick = onToggleDetails,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            modifier = Modifier.testTag(COOKIE_CONSENT_TOGGLE_TAG),
        )
        if (render.showDetailsBlock) {
            ConsentDetails(strings)
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                label = strings.accept,
                onClick = onAccept,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                modifier = Modifier.testTag(COOKIE_CONSENT_ACCEPT_TAG),
            )
            Button(
                label = strings.decline,
                onClick = onDecline,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                modifier = Modifier.testTag(COOKIE_CONSENT_DECLINE_TAG),
            )
        }
    }
}

/** The inline two-category disclosure (web `cookie-consent-details`): Strictly necessary + Performance reporting. */
@Composable
private fun ConsentDetails(
    strings: CookieConsentStrings,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().testTag(COOKIE_CONSENT_DETAILS_TAG),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        ConsentCategoryCard(
            title = strings.essentialTitle,
            body = strings.essentialBody,
            badge = strings.alwaysOn,
        )
        ConsentCategoryCard(
            title = strings.analyticsTitle,
            body = strings.analyticsBody,
            badge = null,
        )
    }
}

/** One category card — a bordered [Card] with the category title, an optional "Always on" badge, and the body. */
@Composable
private fun ConsentCategoryCard(
    title: String,
    body: String,
    badge: String?,
    modifier: Modifier = Modifier,
) {
    Card(modifier = modifier.fillMaxWidth(), padding = CardPadding.Sm) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Subhead(title, modifier = Modifier.weight(1f))
            if (badge != null) {
                Badge(badge, variant = BadgeVariant.Success)
            }
        }
        Caption(body, modifier = Modifier.padding(top = Spacing.xs))
    }
}

/** The resolved recorded-state panel — the native form of the web `return null` (consent off / already decided). */
@Composable
private fun ConsentResolved(
    render: CookieConsentRender,
    strings: CookieConsentStrings,
    onRetry: () -> Unit,
) {
    val message =
        when (render.resolvedReason) {
            ResolvedReason.Accepted -> strings.resolvedAccepted
            ResolvedReason.Declined -> strings.resolvedDeclined
            ResolvedReason.NotRequired -> strings.resolvedNotRequired
        }
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = "${strings.title}. $message" },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        ConsentHeader(strings.title)
        BodyText(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
        ConsentFreshnessRow(render, strings, onRetry)
    }
}

/** The "Stale" / "offline + retry" freshness row shown over the prompt + resolved surfaces. */
@Composable
private fun ConsentFreshnessRow(
    render: CookieConsentRender,
    strings: CookieConsentStrings,
    onRetry: () -> Unit,
) {
    if (!render.showStaleChip && !render.showOfflineChip) return
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (render.showStaleChip) {
            StatusPill(text = strings.stale, tone = StatusTone.Warning)
        }
        if (render.showOfflineChip) {
            StatusPill(text = strings.offline, tone = StatusTone.Danger)
            ConsentRetryButton(strings, onRetry)
        }
    }
}

/** The hard-error surface — a header, the failure copy, and a retry affordance (web hides; the platform shows). */
@Composable
private fun ConsentError(
    strings: CookieConsentStrings,
    onRetry: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = "${strings.errorTitle}. ${strings.errorBody}" },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        PanelTitle(strings.errorTitle)
        HelperText(strings.errorBody)
        ConsentRetryButton(strings, onRetry)
    }
}

/** The shared retry control (the error + offline affordance), carrying the retry test tag. */
@Composable
private fun ConsentRetryButton(
    strings: CookieConsentStrings,
    onRetry: () -> Unit,
) {
    Button(
        label = strings.retry,
        onClick = onRetry,
        variant = ButtonVariant.Outline,
        size = ButtonSize.Sm,
        modifier = Modifier.testTag(COOKIE_CONSENT_RETRY_TAG),
    )
}

/** The cold-start skeleton chrome — a non-blank loading region announced to TalkBack as "Loading". */
@Composable
private fun ConsentLoading(
    strings: CookieConsentStrings,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = strings.loading },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier =
                    Modifier
                        .size(ICON_BOX_SIZE)
                        .clip(RoundedCornerShape(Radius.md))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
            )
            Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
        }
        Skeleton(height = SKELETON_BODY_HEIGHT)
        Skeleton(widthFraction = SKELETON_BODY_FRACTION, height = SKELETON_BODY_HEIGHT)
    }
}

/**
 * Builds the production [CookieConsentBannerSource] from the shared S8 Settings store (the deployment gate) + the
 * app's consent SharedPreferences (the web localStorage analogue). Memoized on the context/store so the surface
 * binds once; tests inject a fake source instead.
 */
@Composable
private fun rememberCookieConsentBannerSource(): CookieConsentBannerSource {
    val context = LocalContext.current
    val settingsStore = LocalDataContainer.current.settingsStore
    return remember(context, settingsStore) {
        settingsStore.asCookieConsentBannerSource(
            bindCookieConsentStore(context.getSharedPreferences(COOKIE_CONSENT_PREFS_NAME, Context.MODE_PRIVATE)),
        )
    }
}

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberCookieConsentStrings(): CookieConsentStrings =
    CookieConsentStrings(
        title = stringResource(R.string.translation_consent_banner_title),
        body = stringResource(R.string.translation_consent_banner_body),
        manage = stringResource(R.string.translation_consent_banner_manage),
        hideDetails = stringResource(R.string.translation_consent_banner_hideDetails),
        accept = stringResource(R.string.translation_consent_banner_accept),
        decline = stringResource(R.string.translation_consent_banner_decline),
        essentialTitle = stringResource(R.string.translation_consent_category_essential_title),
        essentialBody = stringResource(R.string.translation_consent_category_essential_body),
        alwaysOn = stringResource(R.string.translation_consent_category_alwaysOn),
        analyticsTitle = stringResource(R.string.translation_consent_category_analytics_title),
        analyticsBody = stringResource(R.string.translation_consent_category_analytics_body),
        resolvedAccepted = stringResource(R.string.translation_consent_state_accepted),
        resolvedDeclined = stringResource(R.string.translation_consent_state_declined),
        resolvedNotRequired = stringResource(R.string.translation_consent_section_bodyOff),
        loading = stringResource(R.string.translation_a11y_loading),
        stale = stringResource(R.string.translation_mqtt_stale),
        offline = stringResource(R.string.translation_error_network_offlineTitle),
        retry = stringResource(R.string.translation_common_retry),
        errorTitle = stringResource(R.string.translation_error_network_title),
        errorBody = stringResource(R.string.translation_error_loadFailed),
    )

private const val ICON_WASH_ALPHA = 0.12f
private const val SKELETON_TITLE_FRACTION = 0.55f
private const val SKELETON_BODY_FRACTION = 0.7f

/**
 * The shield-with-check mark — the native author of the web lucide `ShieldCheck`. Decorative (the enclosing
 * regions carry the merged content description), drawn as a 24×24 stroked vector recolored by [Icon]'s tint.
 */
private val ShieldCheckGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "ShieldCheck",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            ) {
                moveTo(12f, 3f)
                lineTo(19f, 6f)
                lineTo(19f, 11f)
                curveTo(19f, 15.5f, 16f, 18.8f, 12f, 21f)
                curveTo(8f, 18.8f, 5f, 15.5f, 5f, 11f)
                lineTo(5f, 6f)
                close()
                moveTo(9f, 12f)
                lineTo(11f, 14f)
                lineTo(15f, 9.5f)
            }
        }.build()

// ── Previews — one per rendered state (loading / prompt / prompt+details / resolved / stale / offline / error).
// The strings resolve through the P1/S10 catalog (no hardcoded English), and reduced motion keeps the FadeIn from
// holding the preview clock busy. ───────────────────────────────────────────────────────────────────────────────

private fun previewBase(phase: CookieConsentPhase): CookieConsentRender =
    CookieConsentRender(
        phase = phase,
        consent = ConsentDecision.Unknown,
        requireConsent = true,
        showDetails = false,
        stale = false,
        offline = false,
        errorKind = null,
    )

@Composable
private fun PreviewSurface(render: CookieConsentRender) {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            CookieConsentBannerContent(render = render, strings = rememberCookieConsentStrings())
        }
    }
}

@Preview(name = "CookieConsentBanner · loading", showBackground = true)
@Composable
private fun CookieConsentLoadingPreview() {
    PreviewSurface(previewBase(CookieConsentPhase.Loading))
}

@Preview(name = "CookieConsentBanner · prompt", showBackground = true)
@Composable
private fun CookieConsentPromptPreview() {
    PreviewSurface(previewBase(CookieConsentPhase.Prompt))
}

@Preview(name = "CookieConsentBanner · prompt + details", showBackground = true)
@Composable
private fun CookieConsentPromptDetailsPreview() {
    PreviewSurface(previewBase(CookieConsentPhase.Prompt).copy(showDetails = true))
}

@Preview(name = "CookieConsentBanner · resolved (declined)", showBackground = true)
@Composable
private fun CookieConsentResolvedPreview() {
    PreviewSurface(previewBase(CookieConsentPhase.Resolved).copy(consent = ConsentDecision.Declined))
}

@Preview(name = "CookieConsentBanner · stale", showBackground = true)
@Composable
private fun CookieConsentStalePreview() {
    PreviewSurface(previewBase(CookieConsentPhase.Prompt).copy(stale = true))
}

@Preview(name = "CookieConsentBanner · offline", showBackground = true)
@Composable
private fun CookieConsentOfflinePreview() {
    PreviewSurface(previewBase(CookieConsentPhase.Prompt).copy(offline = true, errorKind = ErrorKind.Network))
}

@Preview(name = "CookieConsentBanner · error", showBackground = true)
@Composable
private fun CookieConsentErrorPreview() {
    PreviewSurface(previewBase(CookieConsentPhase.Error).copy(requireConsent = false))
}
