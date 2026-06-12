// The native Jetpack Compose + Material 3 TeslaAuthCard feature view — a parity port of
// web/src/features/system/components/status/TeslaAuthCard.tsx. The web component is a single, purely presentational
// card that promotes Tesla auth from a Health row to a fuller card: a severity-tinted top bar, a shield status icon,
// the "Tesla account" title + a status Badge, a token-expiry detail line, and a primary CTA that links to the Tesla
// account screen ("Re-authenticate" when expired/disconnected, otherwise "Manage"). It is ALWAYS rendered
// (operator-grade visibility); the styling intensifies as the situation worsens (healthy -> amber within 7 days ->
// red when expired).
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only web
// dependency is the visible labels, mapped here to the i18n catalog); the host owns the auth status and supplies it
// as a [UiState], plus the CTA navigation callback. Because the surface acceptance gate requires every lifecycle
// state to render, the stateful entry takes the host's cache-then-network [UiState] and draws each state the shared
// state-holder layer (P1/S8) can carry — a loading skeleton, a hard error with retry, an empty state, the loaded
// card, and stale/offline ("last known") with a freshness chip + auto-refresh — without ever fetching. A web-parity
// overload taking the raw `authenticated` / `expiresAt` / `now` props is provided for hosts that already hold them.
//
// The GlassPanel, Badge, Button, Icon, and feedback states are the faithful counterparts of the web shared
// components. The severity bar + icon colors map to design tokens (never raw hex in render code). The three lucide
// shield glyphs the shared sets lack are authored in TeslaAuthCardGlyphs; ExternalLink is reused from the shared
// data-display set.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TeslaAuthCard — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.teslaauthcard

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant

/** Height of the severity-tinted top bar — the web `h-1` (4px) accent strip. */
private val SEVERITY_BAR_HEIGHT: Dp = 4.dp

/** Loading-skeleton dimensions, sized so the card never first-paints as a blank box. */
private val SKELETON_ICON: Dp = 28.dp
private val SKELETON_TITLE_HEIGHT: Dp = 14.dp
private val SKELETON_DETAIL_HEIGHT: Dp = 10.dp
private val SKELETON_CTA_WIDTH: Dp = 104.dp
private val SKELETON_CTA_HEIGHT: Dp = 32.dp
private const val SKELETON_TITLE_FRACTION: Float = 0.5f
private const val SKELETON_DETAIL_FRACTION: Float = 0.8f

/**
 * Stateful entry point for the Tesla auth card. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and
 * renders every lifecycle [state] the shared auth status holder can carry. The host owns the status (P1/S8) and
 * supplies [onManage] (navigate to the Tesla account screen — the web `<Link to="/tesla-account">`) plus [onRetry]
 * (the holder's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the auth status.
 * @param onManage opens the Tesla account screen — wired by the host to navigation.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TeslaAuthCard(
    state: UiState<TeslaAuthStatus>,
    onManage: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordTeslaAuthCardOpened(logger) }
    TeslaAuthCardContent(state = state, onManage = onManage, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `authenticated` / `expiresAt` / `now` props, for hosts that
 * already hold the resolved auth status. Wraps it in a content [UiState] and renders the card — no fetch sits behind
 * it, so it offers no retry affordance. Records `view.opened` like the stateful entry. [now] is the page tick
 * (epoch millis) the web component passes so the countdown re-renders.
 */
@Composable
fun TeslaAuthCard(
    authenticated: Boolean?,
    expiresAt: String?,
    onManage: () -> Unit,
    modifier: Modifier = Modifier,
    now: Long = System.currentTimeMillis(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(authenticated, expiresAt) {
            UiState(phase = UiPhase.Content, data = TeslaAuthStatus(authenticated, expiresAt))
        }
    LaunchedEffect(Unit) { recordTeslaAuthCardOpened(logger) }
    TeslaAuthCardContent(
        state = state,
        onManage = onManage,
        onRetry = {},
        modifier = modifier,
        now = Instant.ofEpochMilli(now),
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's card
 * exactly for the loaded state (severity bar + shield + title + Badge + detail + CTA across all five severities) and
 * adds the lifecycle chrome the host's holder implies: a loading skeleton, a hard-error retry surface, a friendly
 * empty state, and a freshness chip that reflects refreshing / stale / offline. Stale (non-error) data auto-refreshes,
 * mirroring the freshness contract the sibling surfaces use. [now] fixes the countdown clock for tests; the
 * production callers use the real wall clock. The panel is a polite live region — the web `aria-live="polite"`.
 */
@Composable
fun TeslaAuthCardContent(
    state: UiState<TeslaAuthStatus>,
    onManage: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    now: Instant = Instant.now(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val status = state.data
    val row =
        remember(status, now) {
            status?.let { TeslaAuthCardProjection.project(it, now) }
        }
    val accent = if (row != null) panelAccentFor(row.severity) else PanelAccent.None

    GlassPanel(
        modifier = modifier.semantics { liveRegion = LiveRegionMode.Polite },
        padding = PanelPadding.None,
        accent = accent,
    ) {
        when {
            state.isLoading -> TeslaAuthCardLoading()
            state.isError -> TeslaAuthCardError(onRetry = onRetry)
            row == null -> TeslaAuthCardEmpty()
            else -> {
                SeverityBar(color = severityColor(row.severity))
                Column(
                    modifier = Modifier.padding(Spacing.md),
                    verticalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    if (state.stale || state.refreshing || state.hasError) {
                        TeslaAuthCardFreshnessRow(state = state)
                    }
                    TeslaAuthCardBody(row = row, onManage = onManage)
                }
            }
        }
    }
}

/**
 * The loaded card — the faithful render of the web component. A severity-tinted shield, the "Tesla account" title +
 * a status Badge that wraps responsively, the token-expiry detail line, and the right-aligned CTA that opens the
 * Tesla account screen.
 */
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun TeslaAuthCardBody(
    row: TeslaAuthRow,
    onManage: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            imageVector = glyphFor(row.severity),
            contentDescription = stringResource(badgeLabelRes(row.severity)),
            size = IconSize.Xl,
            tint = severityColor(row.severity),
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                PanelTitle(stringResource(R.string.translation_tesla_title))
                Badge(text = stringResource(badgeLabelRes(row.severity)), variant = badgeVariantFor(row.severity))
            }
            BodyText(
                text = detailText(row.detail),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Button(
            label = stringResource(ctaLabelRes(row.reauthenticate)),
            onClick = onManage,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
            leadingIcon = DataDisplayGlyphs.ExternalLink,
        )
    }
}

/** The severity-tinted top accent strip — the web `<div className="h-1 w-full {bar}" aria-hidden />`. */
@Composable
private fun SeverityBar(color: Color) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(SEVERITY_BAR_HEIGHT)
                .background(color),
    )
}

/** First-load skeleton — a bar + shield + title/detail lines + a CTA bar so the card is never blank while loading. */
@Composable
private fun TeslaAuthCardLoading() {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    Column(modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel }) {
        Skeleton(height = SEVERITY_BAR_HEIGHT)
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Skeleton(modifier = Modifier.width(SKELETON_ICON), height = SKELETON_ICON, rounded = true)
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
                Skeleton(widthFraction = SKELETON_DETAIL_FRACTION, height = SKELETON_DETAIL_HEIGHT)
            }
            Skeleton(modifier = Modifier.width(SKELETON_CTA_WIDTH), height = SKELETON_CTA_HEIGHT, rounded = true)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun TeslaAuthCardError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth().padding(Spacing.md),
    )
}

/** Empty surface — a friendly state shown when the host resolved no status, never a blank box. */
@Composable
private fun TeslaAuthCardEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        icon = TeslaAuthCardGlyphs.ShieldAlert,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The stale / refreshing / offline freshness chip, right-aligned above the card body. */
@Composable
private fun TeslaAuthCardFreshnessRow(state: UiState<TeslaAuthStatus>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
        )
    }
}

// ── Severity -> presentation mapping (web TONE table) ───────────────────────────────────────────────────────────

/** The status-token color for the bar + shield — the web `TONE.bar` / `TONE.icon`. */
@Composable
private fun severityColor(severity: AuthSeverity): Color =
    when (severity) {
        AuthSeverity.Ok -> TeslaTokens.status.success
        AuthSeverity.Warn -> TeslaTokens.status.warning
        AuthSeverity.Expired -> TeslaTokens.status.danger
        AuthSeverity.Disconnected -> TeslaTokens.status.danger
        AuthSeverity.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** The GlassPanel border accent for the loaded card — the Android-idiomatic counterpart of the web glow. */
private fun panelAccentFor(severity: AuthSeverity): PanelAccent =
    when (severity) {
        AuthSeverity.Ok -> PanelAccent.Success
        AuthSeverity.Warn -> PanelAccent.Warning
        AuthSeverity.Expired -> PanelAccent.Danger
        AuthSeverity.Disconnected -> PanelAccent.Danger
        AuthSeverity.Unknown -> PanelAccent.None
    }

/** The Badge variant — the web `TONE.badge`. */
private fun badgeVariantFor(severity: AuthSeverity): BadgeVariant =
    when (severity) {
        AuthSeverity.Ok -> BadgeVariant.Success
        AuthSeverity.Warn -> BadgeVariant.Warning
        AuthSeverity.Expired -> BadgeVariant.Danger
        AuthSeverity.Disconnected -> BadgeVariant.Danger
        AuthSeverity.Unknown -> BadgeVariant.Neutral
    }

/** The shield glyph — the web `TONE.Icon` (ShieldCheck / ShieldAlert / ShieldX). */
private fun glyphFor(severity: AuthSeverity) =
    when (severity) {
        AuthSeverity.Ok -> TeslaAuthCardGlyphs.ShieldCheck
        AuthSeverity.Warn -> TeslaAuthCardGlyphs.ShieldAlert
        AuthSeverity.Expired -> TeslaAuthCardGlyphs.ShieldX
        AuthSeverity.Disconnected -> TeslaAuthCardGlyphs.ShieldX
        AuthSeverity.Unknown -> TeslaAuthCardGlyphs.ShieldAlert
    }

/** The i18n key for the status Badge label — the web `TONE.label`. */
private fun badgeLabelRes(severity: AuthSeverity): Int =
    when (severity) {
        AuthSeverity.Ok -> R.string.translation_tesla_connected
        AuthSeverity.Warn -> R.string.translation_tesla_tokenExpires
        AuthSeverity.Expired -> R.string.translation_Expired
        AuthSeverity.Disconnected -> R.string.translation_tesla_notConnected
        AuthSeverity.Unknown -> R.string.translation_common_unknown
    }

/** The i18n key for the CTA label — the web `'Re-authenticate' : 'Manage'` ternary. */
private fun ctaLabelRes(reauthenticate: Boolean): Int =
    if (reauthenticate) R.string.translation_tesla_reauthorize else R.string.translation_common_open

/** Resolves the localized detail line for a structured [AuthDetail] — the web `detail` memo output. */
@Composable
private fun detailText(detail: AuthDetail): String =
    when (detail) {
        AuthDetail.NotConnected -> stringResource(R.string.translation_tesla_subtitle)
        AuthDetail.Reconnect -> stringResource(R.string.translation_tesla_reauth_body)
        is AuthDetail.ExpiresInDays -> stringResource(R.string.translation_tesla_expiringSoon, detail.days)
    }

// ── Previews ────────────────────────────────────────────────────────────────────────────────────────────────────

@Preview(name = "Connected", showBackground = true)
@Composable
private fun TeslaAuthCardConnectedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaAuthCardContent(
            state = UiState(UiPhase.Content, data = TeslaAuthStatus(authenticated = true, expiresAt = "2999-01-01T00:00:00Z")),
            onManage = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Expired", showBackground = true)
@Composable
private fun TeslaAuthCardExpiredPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaAuthCardContent(
            state = UiState(UiPhase.Content, data = TeslaAuthStatus(authenticated = true, expiresAt = "2000-01-01T00:00:00Z")),
            onManage = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Disconnected", showBackground = true)
@Composable
private fun TeslaAuthCardDisconnectedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaAuthCardContent(
            state = UiState(UiPhase.Content, data = TeslaAuthStatus(authenticated = false, expiresAt = null)),
            onManage = {},
            onRetry = {},
        )
    }
}
