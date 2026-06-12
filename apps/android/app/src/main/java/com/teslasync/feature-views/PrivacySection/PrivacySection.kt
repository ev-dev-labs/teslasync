// The native Jetpack Compose + Material 3 Privacy feature view — a parity port of
// web/src/features/settings/components/PrivacySection.tsx. It mirrors the web `GlassPanel` (inside a
// `FadeIn`) with a shield-iconed "Privacy" title + subtitle over two client-side privacy controls: a
// "recently viewed pages" card (a live entry count + a Clear button gated behind a warning confirm
// dialog) and an always-present cookie/GDPR consent card (the deployment policy sentence + the current
// tri-state label + Re-grant / Withdraw / Reset actions). Success toasts confirm each mutation.
//
// All data flows through the shared [PrivacySectionViewModel] (P1/S8); the view performs no HTTP and no
// storage access. Every string resolves through the i18n catalog (P1/S10) via `R.string` / `R.plurals`,
// and every interactive control carries a TalkBack label (the buttons via their own text, the freshness
// refresh via its content description). The one-shot `view.opened` diagnostic (P1/S11) fires on first
// composition.
//
// The web component is backed by synchronous client stores plus one non-blocking `useVersionInfo` query
// whose only effect is choosing the consent block's descriptive sentence; a missing/failed response
// simply falls back to `require_cookie_consent = false`. The native surface reproduces that exactly — the
// panel is never hidden behind a load/error gate — and additionally surfaces the version feed's
// cache-then-network freshness (stale / offline / error + retry) as a small chip over the consent card,
// the honest native-idiomatic treatment of a networked source (mirrors the sibling ClientUtilitiesSection).
// A brief loading skeleton precedes the first client-store read.
//
// The Lucide `ShieldCheck` + `Trash2` glyphs have no shared-set equivalent, so they are authored here as
// 24×24 stroked vectors (the same approach as the sibling RecentlyViewedWidget).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/PrivacySection) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.privacy

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.dismissToast
import io.teslasync.android.components.feedback.enqueueToast
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private const val MAX_TOASTS = 3
private const val LOADING_CARD_COUNT = 2
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE_WIDTH = 2f
private val LOADING_TITLE_HEIGHT = 14.dp
private val LOADING_BODY_HEIGHT = 12.dp
private val LOADING_BUTTON_HEIGHT = 40.dp
private const val LOADING_TITLE_FRACTION = 0.4f
private const val LOADING_BODY_FRACTION = 0.85f
private const val LOADING_BUTTON_FRACTION = 0.5f
private const val PREVIEW_NOW = 1_780_000_000_000L

/**
 * Stateful entry point. Resolves the client-side stores (recent pages + consent) over the on-device
 * SharedPreferences and the version policy over the shared [io.teslasync.shared.core.presentation.settings.SettingsStore]
 * (from [LocalDataContainer]), spins up the [PrivacySectionViewModel], records the one-shot `view.opened`
 * diagnostic, collects its state + one-shot toast events, and renders the surface. Each seam is an
 * optional override so tests/previews can inject fakes; production resolves the real bindings.
 *
 * @param recentPages override for the recent-pages seam; production defaults to the SharedPreferences store.
 * @param consentStore override for the consent seam; production defaults to the SharedPreferences store.
 * @param policy override for the version-policy seam; production binds the shared SettingsStore version feed.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun PrivacySection(
    modifier: Modifier = Modifier,
    recentPages: RecentPagesController? = null,
    consentStore: CookieConsentStore? = null,
    policy: ConsentPolicySource? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val context = LocalContext.current
    val container = LocalDataContainer.current
    val resolvedRecent = recentPages ?: remember(context) { SharedPreferencesRecentPagesController(context) }
    val resolvedConsent = consentStore ?: remember(context) { SharedPreferencesCookieConsentStore(context) }
    val resolvedPolicy = policy ?: remember(container) { settingsStoreConsentPolicy(container.settingsStore) }
    val viewModel: PrivacySectionViewModel =
        viewModel(
            key = PrivacyRegistration.SLUG,
            factory = PrivacySectionViewModel.factory(resolvedRecent, resolvedConsent, resolvedPolicy, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    var toasts by remember { mutableStateOf<List<ToastItem>>(emptyList()) }
    var nextToastId by remember { mutableStateOf(0L) }
    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            if (event !is UiEvent.Message) return@collect
            val resId = messageResIdOrNull(event.messageKey) ?: return@collect
            toasts = enqueueToast(toasts, ToastItem(nextToastId, context.getString(resId), toneFor(event.severity)), MAX_TOASTS)
            nextToastId += 1
        }
    }

    Box(modifier = modifier) {
        PrivacySectionContent(
            state = state,
            onClearConfirmed = viewModel::clearRecentPages,
            onAccept = viewModel::acceptConsent,
            onDecline = viewModel::declineConsent,
            onReset = viewModel::resetConsent,
            onRefreshVersion = viewModel::refreshVersion,
        )
        ToastHost(
            toasts = toasts,
            onDismiss = { id -> toasts = dismissToast(toasts, id) },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}

/**
 * Stateless renderer — the snapshot/UI-test entry point. The shield header is always present; below it a
 * [PrivacyUiState.Loading] skeleton or the resolved [PrivacyUiState.Content] body (recent-pages card +
 * consent card). A stale (non-error) version feed auto-refreshes once (web TanStack stale refetch).
 * Hoisted out of the ViewModel so each state is preview- and screenshot-testable with hand-built inputs.
 */
@Composable
fun PrivacySectionContent(
    state: PrivacyUiState,
    modifier: Modifier = Modifier,
    onClearConfirmed: () -> Unit = {},
    onAccept: () -> Unit = {},
    onDecline: () -> Unit = {},
    onReset: () -> Unit = {},
    onRefreshVersion: () -> Unit = {},
) {
    val version = (state as? PrivacyUiState.Content)?.version
    LaunchedEffect(version?.stale, version?.refreshing, version?.hasError) {
        version ?: return@LaunchedEffect
        if (version.stale && !version.refreshing && !version.hasError) onRefreshVersion()
    }
    FadeIn {
        GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
            PrivacyHeader()
            Spacer(Modifier.height(Spacing.lg))
            when (state) {
                PrivacyUiState.Loading -> PrivacyLoadingBody()
                is PrivacyUiState.Content ->
                    PrivacyContentBody(
                        snapshot = state.snapshot,
                        version = state.version,
                        onClearConfirmed = onClearConfirmed,
                        onAccept = onAccept,
                        onDecline = onDecline,
                        onReset = onReset,
                        onRefreshVersion = onRefreshVersion,
                    )
            }
        }
    }
}

/** The shield IconBox + "Privacy" title + subtitle — always rendered, even in the loading frame. */
@Composable
private fun PrivacyHeader() {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        IconBox(tone = IconBoxTone.Info) {
            Icon(imageVector = PrivacyGlyphs.ShieldCheck, contentDescription = null, size = IconSize.Lg)
        }
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            PanelTitle(
                text = stringResource(R.string.translation_privacy_title),
                modifier = Modifier.semantics { heading() },
            )
            Caption(stringResource(R.string.translation_privacy_subtitle))
        }
    }
}

/** The resolved body: the recent-pages card over the always-present consent card + the clear confirm dialog. */
@Composable
private fun PrivacyContentBody(
    snapshot: PrivacySnapshot,
    version: UiState<Boolean>,
    onClearConfirmed: () -> Unit,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    onReset: () -> Unit,
    onRefreshVersion: () -> Unit,
) {
    var confirmOpen by rememberSaveable { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        RecentPagesCard(recentCount = snapshot.recentCount, onClearRequested = { confirmOpen = true })
        ConsentCard(
            snapshot = snapshot,
            version = version,
            onAccept = onAccept,
            onDecline = onDecline,
            onReset = onReset,
            onRefreshVersion = onRefreshVersion,
        )
    }
    if (confirmOpen) {
        ConfirmDialog(
            title = stringResource(R.string.translation_recentPages_clearConfirmTitle),
            message = stringResource(R.string.translation_recentPages_clearConfirmBody),
            confirmLabel = stringResource(R.string.translation_recentPages_clearConfirmCta),
            cancelLabel = stringResource(R.string.translation_common_cancel),
            closeLabel = stringResource(R.string.translation_a11y_closeDialog),
            severity = ConfirmSeverity.Warning,
            onConfirm = {
                confirmOpen = false
                onClearConfirmed()
            },
            onCancel = { confirmOpen = false },
        )
    }
}

/** The "Recently viewed pages" card — title + body + live entry count + the Clear button (web first card). */
@Composable
private fun RecentPagesCard(
    recentCount: Int,
    onClearRequested: () -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Subhead(stringResource(R.string.translation_recentPages_clearTitle))
            Caption(stringResource(R.string.translation_recentPages_clearBody))
            MetricLabel(
                pluralStringResource(R.plurals.translation_recentPages_storedCount, recentCount, recentCount),
            )
            Button(
                label = stringResource(R.string.translation_recentPages_clearButton),
                onClick = onClearRequested,
                variant = ButtonVariant.Secondary,
                enabled = PrivacyProjection.clearEnabled(recentCount),
                leadingIcon = PrivacyGlyphs.Trash,
            )
        }
    }
}

/**
 * The "Cookies & analytics consent" card — always rendered (web parity: operators preview the flow even
 * when consent is not required). Shows the deployment policy sentence (selected by [PrivacySnapshot.requireConsent]),
 * the current tri-state label, the three consent actions, and — only when the version feed is degraded —
 * a stale/offline/error freshness chip with a retry.
 */
@Composable
private fun ConsentCard(
    snapshot: PrivacySnapshot,
    version: UiState<Boolean>,
    onAccept: () -> Unit,
    onDecline: () -> Unit,
    onReset: () -> Unit,
    onRefreshVersion: () -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            if (version.stale || version.hasError || version.refreshing) {
                ConsentFreshness(version = version, onRefresh = onRefreshVersion)
            }
            Subhead(stringResource(R.string.translation_consent_section_title))
            Caption(consentBody(snapshot.requireConsent))
            MetricLabel(consentStateLabel(snapshot.consent))
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Button(
                    label = stringResource(R.string.translation_consent_action_accept),
                    onClick = onAccept,
                    variant = ButtonVariant.Primary,
                    enabled = PrivacyProjection.acceptEnabled(snapshot.consent),
                )
                Button(
                    label = stringResource(R.string.translation_consent_action_decline),
                    onClick = onDecline,
                    variant = ButtonVariant.Secondary,
                    enabled = PrivacyProjection.declineEnabled(snapshot.consent),
                )
                Button(
                    label = stringResource(R.string.translation_consent_action_reset),
                    onClick = onReset,
                    variant = ButtonVariant.Ghost,
                    enabled = PrivacyProjection.resetEnabled(snapshot.consent),
                )
            }
        }
    }
}

/** The version feed's stale / offline / error chip + a retry control, shown only over a degraded feed. */
@Composable
private fun ConsentFreshness(
    version: UiState<Boolean>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DataFreshness(
            updatedAtMillis = version.fetchedAt?.takeIf { it > 0 },
            isFetching = version.refreshing,
            isStale = version.stale,
            isError = version.hasError,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !version.refreshing,
            size = IconSize.Sm,
        )
    }
}

/** Loading skeleton chrome — a couple of shimmering cards under the stable header (off-main-thread read). */
@Composable
private fun PrivacyLoadingBody() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(LOADING_CARD_COUNT) {
            GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
                Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
                Skeleton(widthFraction = LOADING_BODY_FRACTION, height = LOADING_BODY_HEIGHT)
                Skeleton(widthFraction = LOADING_BUTTON_FRACTION, height = LOADING_BUTTON_HEIGHT, rounded = true)
            }
        }
    }
}

/** Selects the deployment policy sentence (web `requireConsent ? bodyOn : bodyOff`). */
@Composable
private fun consentBody(requireConsent: Boolean): String =
    if (requireConsent) {
        stringResource(R.string.translation_consent_section_bodyOn)
    } else {
        stringResource(R.string.translation_consent_section_bodyOff)
    }

/** Maps the consent tri-state onto its localized label (web `consentLabel`). */
@Composable
private fun consentStateLabel(state: ConsentState): String =
    when (state) {
        ConsentState.Accepted -> stringResource(R.string.translation_consent_state_accepted)
        ConsentState.Declined -> stringResource(R.string.translation_consent_state_declined)
        ConsentState.Unknown -> stringResource(R.string.translation_consent_state_unknown)
    }

/** Resolves a [UiEvent.Message] key to its toast string resource, or null for an unrecognized key. */
private fun messageResIdOrNull(key: String): Int? =
    when (key) {
        PrivacySectionViewModel.MESSAGE_CLEARED -> R.string.translation_recentPages_cleared
        PrivacySectionViewModel.MESSAGE_ACCEPTED -> R.string.translation_consent_toast_accepted
        PrivacySectionViewModel.MESSAGE_DECLINED -> R.string.translation_consent_toast_declined
        PrivacySectionViewModel.MESSAGE_RESET -> R.string.translation_consent_toast_reset
        else -> null
    }

/** Maps a [UiEvent.Severity] onto the feedback [Tone] the toast renders with. */
private fun toneFor(severity: UiEvent.Severity): Tone =
    when (severity) {
        UiEvent.Severity.Success -> Tone.Success
        UiEvent.Severity.Warning -> Tone.Warning
        UiEvent.Severity.Error -> Tone.Danger
        UiEvent.Severity.Info -> Tone.Info
    }

/**
 * Self-contained line glyphs for the lucide icons the shared sets do not cover (`ShieldCheck`, `Trash2`),
 * authored as 24×24 stroked vectors — the same approach as the sibling RecentlyViewedWidget. Each is
 * monochrome and recoloured at render time by the enclosing [IconBox] content color / [Icon] tint.
 */
private object PrivacyGlyphs {
    /** lucide `shield-check` — the header glyph. */
    val ShieldCheck: ImageVector =
        glyph("PrivacyShieldCheck") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 11f)
            arcTo(11f, 11f, 0f, false, true, 12f, 21f)
            arcTo(11f, 11f, 0f, false, true, 5f, 11f)
            lineTo(5f, 6f)
            close()
            moveTo(9f, 12f)
            lineTo(11.5f, 14.5f)
            lineTo(15.5f, 9.5f)
        }

    /** lucide `trash-2` — the Clear-recent-pages button glyph. */
    val Trash: ImageVector =
        glyph("PrivacyTrash") {
            moveTo(4f, 6.5f)
            lineTo(20f, 6.5f)
            moveTo(9f, 6.5f)
            lineTo(9f, 4.5f)
            lineTo(15f, 4.5f)
            lineTo(15f, 6.5f)
            moveTo(6.5f, 6.5f)
            lineTo(7.5f, 20f)
            lineTo(16.5f, 20f)
            lineTo(17.5f, 6.5f)
            moveTo(10f, 10f)
            lineTo(10f, 16.5f)
            moveTo(14f, 10f)
            lineTo(14f, 16.5f)
        }
}

private fun glyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_VIEWPORT.dp,
            defaultHeight = GLYPH_VIEWPORT.dp,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

// ── Previews — one per rendered state (content / accepted / empty / loading / offline) ───────────────────

private fun previewVersion(requireConsent: Boolean): UiState<Boolean> =
    UiState(phase = UiPhase.Content, data = requireConsent, fetchedAt = PREVIEW_NOW)

@Preview(name = "Privacy · content (consent required, undecided)", showBackground = true)
@Composable
private fun PrivacyContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PrivacySectionContent(
            state =
                PrivacyUiState.Content(
                    snapshot = PrivacySnapshot(recentCount = 7, consent = ConsentState.Unknown, requireConsent = true),
                    version = previewVersion(requireConsent = true),
                ),
        )
    }
}

@Preview(name = "Privacy · consent accepted", showBackground = true)
@Composable
private fun PrivacyAcceptedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PrivacySectionContent(
            state =
                PrivacyUiState.Content(
                    snapshot = PrivacySnapshot(recentCount = 3, consent = ConsentState.Accepted, requireConsent = true),
                    version = previewVersion(requireConsent = true),
                ),
        )
    }
}

@Preview(name = "Privacy · empty (no recent pages)", showBackground = true)
@Composable
private fun PrivacyEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PrivacySectionContent(
            state =
                PrivacyUiState.Content(
                    snapshot = PrivacySnapshot(recentCount = 0, consent = ConsentState.Declined, requireConsent = false),
                    version = previewVersion(requireConsent = false),
                ),
        )
    }
}

@Preview(name = "Privacy · loading", showBackground = true)
@Composable
private fun PrivacyLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PrivacySectionContent(state = PrivacyUiState.Loading)
    }
}

@Preview(name = "Privacy · version offline (last known)", showBackground = true)
@Composable
private fun PrivacyOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PrivacySectionContent(
            state =
                PrivacyUiState.Content(
                    snapshot = PrivacySnapshot(recentCount = 5, consent = ConsentState.Unknown, requireConsent = false),
                    version =
                        UiState(
                            phase = UiPhase.Content,
                            data = false,
                            fetchedAt = PREVIEW_NOW,
                            stale = true,
                            errorKind = ErrorKind.Network,
                        ),
                ),
        )
    }
}
