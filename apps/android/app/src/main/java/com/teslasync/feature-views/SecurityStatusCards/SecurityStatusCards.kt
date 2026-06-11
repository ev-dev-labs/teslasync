// The native Jetpack Compose + Material 3 SecurityStatusCards feature view — a parity port of
// web/src/features/admin/components/security-access/SecurityStatusCards.tsx. The web component is a
// presentational child the SecurityAccessPage drives with the polled `useSecurityLatest` snapshot: a
// responsive 1/2/3-column grid of six GlassPanel cards (Lock / Sentry / Doors / Windows / HomeLink / Guest),
// each an icon + title + bold value + muted description, and a six-tile skeleton grid while the first load is
// in flight. This native port keeps that composition and additionally surfaces the cache-then-network states
// the P3 contract mandates (loading / empty / error / stale / offline) by binding the shared vehicles +
// latest-security feeds (P1/S8) through a [SecurityStatusCardsViewModel]: a freshness chip + auto-refresh
// covers stale/offline, a `QueryError` covers a hard failure with no cache, and an absent snapshot still
// renders the six cards with the web's undefined-defaults (never a blank box). The view performs no HTTP.
// Every visible string resolves through the i18n catalog (P1/S10) and every card carries a merged TalkBack
// label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SecurityStatusCards) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.securitystatuscards

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** The fixed six-card footprint (web `Array.from({ length: 6 })` skeleton + the six GlassPanels). */
private const val CARD_COUNT = 6

/** The web `<Skeleton height={120} />` loading-tile height. */
private val CARD_SKELETON_HEIGHT = 120.dp

/** Minimum card height so the grid rows align regardless of value/description length. */
private val CARD_MIN_HEIGHT = 112.dp

/** The web `<FadeIn delay={0.1}>` entry stagger (100 ms). */
private const val FADE_DELAY_MS = 100

/** Responsive column breakpoints — the native analogue of web `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`. */
private val MEDIUM_BREAKPOINT = 600.dp
private val EXPANDED_BREAKPOINT = 840.dp

private const val HTTP_NOT_FOUND = 404
private const val HTTP_UNAUTHORIZED = 401
private const val HTTP_FORBIDDEN = 403
private const val HTTP_SERVER_ERROR_MIN = 500
private const val HTTP_SERVER_ERROR_MAX = 599

/**
 * Stateful entry point. Binds the shared vehicles + latest-security feeds via [source] into a
 * [SecurityStatusCardsViewModel], resolves the localized [SecurityStatusCardsStrings] from the catalog
 * (P1/S10), records the one-shot `view.opened` diagnostic, and renders the surface. A host supplies [source]
 * (an adapter over the shared S8 vehicles data layer) and a unique [instanceKey] per placement; an explicit
 * [vehicleId] pins the cards to one vehicle (web `useSelectedVehicle`), otherwise the first enrolled vehicle
 * is used.
 */
@Composable
fun SecurityStatusCards(
    source: SecurityStatusCardsSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SECURITY_STATUS_CARDS_SLUG,
) {
    val viewModel: SecurityStatusCardsViewModel =
        viewModel(key = instanceKey, factory = SecurityStatusCardsViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val strings = rememberSecurityStatusCardsStrings()

    SecurityStatusCardsContent(
        state = state,
        strings = strings,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web `isLoading`
 * skeleton grid and otherwise the six-card grid, extended with the mandated states: a hard failure with no
 * cached snapshot shows `QueryError` with retry; a stale/offline cached snapshot keeps the cards visible with
 * a freshness chip flagged and auto-refreshes (web's 5s poll); an absent snapshot still renders the cards
 * with the web's undefined-defaults.
 */
@Composable
fun SecurityStatusCardsContent(
    state: UiState<JsonElement>,
    strings: SecurityStatusCardsStrings,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.isError) {
        if (state.stale && !state.refreshing && !state.isError) onRefresh()
    }
    when {
        state.isLoading -> SecurityStatusCardsLoading(modifier)
        state.isError && !state.hasData ->
            FadeIn(modifier = modifier) {
                QueryError(
                    kind = queryErrorKindOf(state),
                    resourceName = strings.snapshotLabel,
                    onRetry = onRefresh,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

        else -> SecurityStatusCardsLoaded(state = state, strings = strings, modifier = modifier)
    }
}

@Composable
private fun SecurityStatusCardsLoaded(
    state: UiState<JsonElement>,
    strings: SecurityStatusCardsStrings,
    modifier: Modifier,
) {
    val display = remember(state.data, strings) { SecurityStatusCardsProjection.project(state.data, strings) }
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (state.fetchedAt != null || state.refreshing || state.hasError) {
            FreshnessRow(state)
        }
        FadeIn(delayMs = FADE_DELAY_MS) {
            SecurityCardsGrid(display)
        }
    }
}

@Composable
private fun FreshnessRow(state: UiState<JsonElement>) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberRelativeAgeFormatter(),
        )
    }
}

/**
 * The responsive card grid — the native analogue of the web `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`. The
 * column count is chosen from the available width (compact → 1, medium → 2, expanded → 3); cards are laid out
 * in fixed rows with a defensive spacer keeping the final row aligned.
 */
@Composable
private fun SecurityCardsGrid(
    display: SecurityStatusCardsDisplay,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = columnsFor(maxWidth)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            display.cards.chunked(columns).forEach { rowCards ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    rowCards.forEach { card -> SecurityStatusCard(card = card, modifier = Modifier.weight(1f)) }
                    repeat(columns - rowCards.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun SecurityStatusCard(
    card: SecurityCard,
    modifier: Modifier = Modifier,
) {
    val tone = cardToneColor(card.tone)
    GlassPanel(
        modifier =
            modifier
                .fillMaxWidth()
                .heightIn(min = CARD_MIN_HEIGHT)
                .semantics(mergeDescendants = true) { contentDescription = card.accessibilityLabel() },
        padding = PanelPadding.Md,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(imageVector = cardIcon(card), contentDescription = null, size = IconSize.Lg, tint = tone)
            PanelTitle(card.title, modifier = Modifier.weight(1f))
        }
        Heading(
            text = card.value,
            modifier = Modifier.padding(top = Spacing.xs),
            level = HeadingLevel.Page,
            color = tone,
            maxLines = 1,
        )
        Caption(card.description, modifier = Modifier.padding(top = Spacing.xs))
    }
}

@Composable
private fun SecurityStatusCardsLoading(modifier: Modifier) {
    val label = stringResource(R.string.translation_a11y_loading)
    BoxWithConstraints(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { contentDescription = label },
    ) {
        val columns = columnsFor(maxWidth)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            List(CARD_COUNT) { it }.chunked(columns).forEach { rowCells ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    rowCells.forEach { _ ->
                        Skeleton(modifier = Modifier.weight(1f), height = CARD_SKELETON_HEIGHT, rounded = true)
                    }
                    repeat(columns - rowCells.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** Web `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`: compact width → 1 column, medium → 2, expanded → 3. */
private fun columnsFor(width: Dp): Int =
    when {
        width < MEDIUM_BREAKPOINT -> 1
        width < EXPANDED_BREAKPOINT -> 2
        else -> 3
    }

/** Per-tone foreground color — the native mapping of the web per-card Tailwind text colors onto theme tokens. */
@Composable
private fun cardToneColor(tone: CardTone): Color =
    when (tone) {
        CardTone.Positive -> TeslaTokens.status.success
        CardTone.Danger -> TeslaTokens.status.danger
        CardTone.Info -> TeslaTokens.status.info
        CardTone.Warning -> TeslaTokens.status.warning
        CardTone.Highlight -> TeslaTokens.chart.power
        CardTone.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * The per-card glyph — the native mirror of the web per-card icon choice: lock toggles Lock/Unlock with the
 * lock state, sentry toggles ShieldCheck/ShieldAlert with sentry mode, doors toggle DoorClosed/DoorOpen, and
 * windows/HomeLink/Guest use fixed glyphs tinted by their tone.
 */
private fun cardIcon(card: SecurityCard): ImageVector =
    when (card.kind) {
        CardKind.Lock -> if (card.tone == CardTone.Positive) DataDisplayGlyphs.Lock else SecurityStatusCardsGlyphs.Unlock
        CardKind.Sentry -> if (card.tone == CardTone.Info) SecurityStatusCardsGlyphs.ShieldCheck else SecurityStatusCardsGlyphs.ShieldAlert
        CardKind.Doors -> if (card.tone == CardTone.Positive) SecurityStatusCardsGlyphs.DoorClosed else SecurityStatusCardsGlyphs.DoorOpen
        CardKind.Windows -> SecurityStatusCardsGlyphs.DoorClosed
        CardKind.HomeLink -> SecurityStatusCardsGlyphs.Home
        CardKind.Guest -> SecurityStatusCardsGlyphs.UserCheck
    }

/** Classify a [UiState] failure into the recovery copy the `QueryError` branch shows. */
private fun queryErrorKindOf(state: UiState<*>): QueryErrorKind =
    when (state.errorKind) {
        ErrorKind.Http ->
            when (state.httpStatus) {
                HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                in HTTP_SERVER_ERROR_MIN..HTTP_SERVER_ERROR_MAX -> QueryErrorKind.ServerError
                else -> QueryErrorKind.Network
            }
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Decode -> QueryErrorKind.ServerError
        else -> QueryErrorKind.Network
    }

/**
 * Resolves the localized [SecurityStatusCardsStrings] from the i18n catalog (P1/S10) — the `admin.security.*`
 * keys the web component reads via `t(...)`, plus the existing `widget.allClosed` key for the all-closed
 * windows label. Remembered against the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberSecurityStatusCardsStrings(): SecurityStatusCardsStrings {
    val lockStatus = stringResource(R.string.translation_admin_security_card_lockStatus)
    val lockDesc = stringResource(R.string.translation_admin_security_card_lockDesc)
    val locked = stringResource(R.string.translation_admin_security_locked)
    val unlocked = stringResource(R.string.translation_admin_security_unlocked)
    val sentryMode = stringResource(R.string.translation_admin_security_card_sentryMode)
    val sentryDesc = stringResource(R.string.translation_admin_security_card_sentryDesc)
    val active = stringResource(R.string.translation_admin_security_active)
    val inactive = stringResource(R.string.translation_admin_security_inactive)
    val doors = stringResource(R.string.translation_admin_security_card_doors)
    val doorsDesc = stringResource(R.string.translation_admin_security_card_doorsDesc)
    val closed = stringResource(R.string.translation_admin_security_closed)
    val open = stringResource(R.string.translation_admin_security_open)
    val windows = stringResource(R.string.translation_admin_security_card_windows)
    val windowsDesc = stringResource(R.string.translation_admin_security_card_windowsDesc)
    val windowsAllClosed = stringResource(R.string.translation_widget_allClosed)
    val homelink = stringResource(R.string.translation_admin_security_card_homelink)
    val homelinkDesc = stringResource(R.string.translation_admin_security_card_homelinkDesc)
    val nearby = stringResource(R.string.translation_admin_security_nearby)
    val away = stringResource(R.string.translation_admin_security_away)
    val guestMode = stringResource(R.string.translation_admin_security_card_guestMode)
    val guestDesc = stringResource(R.string.translation_admin_security_card_guestDesc)
    val enabled = stringResource(R.string.translation_admin_security_enabled)
    val disabled = stringResource(R.string.translation_admin_security_disabled)
    val snapshotLabel = stringResource(R.string.translation_admin_security_title)
    return remember(
        lockStatus,
        lockDesc,
        locked,
        unlocked,
        sentryMode,
        sentryDesc,
        active,
        inactive,
        doors,
        doorsDesc,
        closed,
        open,
        windows,
        windowsDesc,
        windowsAllClosed,
        homelink,
        homelinkDesc,
        nearby,
        away,
        guestMode,
        guestDesc,
        enabled,
        disabled,
        snapshotLabel,
    ) {
        SecurityStatusCardsStrings(
            lockStatus = lockStatus,
            lockDesc = lockDesc,
            locked = locked,
            unlocked = unlocked,
            sentryMode = sentryMode,
            sentryDesc = sentryDesc,
            active = active,
            inactive = inactive,
            doors = doors,
            doorsDesc = doorsDesc,
            closed = closed,
            open = open,
            windows = windows,
            windowsDesc = windowsDesc,
            windowsAllClosed = windowsAllClosed,
            homelink = homelink,
            homelinkDesc = homelinkDesc,
            nearby = nearby,
            away = away,
            guestMode = guestMode,
            guestDesc = guestDesc,
            enabled = enabled,
            disabled = disabled,
            snapshotLabel = snapshotLabel,
        )
    }
}

/**
 * Builds the localized relative-age formatter the freshness chip folds [FreshnessAge] buckets through
 * (P1/S10 `translation_freshness_*`), so the pure freshness logic carries no English microcopy.
 */
@Composable
private fun rememberRelativeAgeFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_STRINGS =
    SecurityStatusCardsStrings(
        lockStatus = "Lock Status",
        lockDesc = "Vehicle lock state",
        locked = "Locked",
        unlocked = "Unlocked",
        sentryMode = "Sentry Mode",
        sentryDesc = "Camera surveillance system",
        active = "Active",
        inactive = "Inactive",
        doors = "Doors",
        doorsDesc = "All vehicle doors",
        closed = "Closed",
        open = "Open",
        windows = "Windows",
        windowsDesc = "Window positions",
        windowsAllClosed = "All Closed",
        homelink = "HomeLink",
        homelinkDesc = "Garage door opener",
        nearby = "Nearby",
        away = "Away",
        guestMode = "Guest Mode",
        guestDesc = "Temporary access mode",
        enabled = "Enabled",
        disabled = "Disabled",
        snapshotLabel = "Security & Access",
    )

private fun previewSnapshot(): JsonElement =
    buildJsonObject {
        put("locked", true)
        put("sentry_mode", true)
        put("door_state", "df_closed")
        put("fd_window", "open")
        put("fp_window", "closed")
        put("rd_window", "closed")
        put("rp_window", "closed")
        put("homelink_nearby", true)
        put("guest_mode", false)
    }

@Preview(name = "Loading", showBackground = true, widthDp = 420)
@Composable
private fun SecurityStatusCardsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecurityStatusCardsContent(UiState.loading(), PREVIEW_STRINGS)
    }
}

@Preview(name = "Content", showBackground = true, widthDp = 420)
@Composable
private fun SecurityStatusCardsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecurityStatusCardsContent(
            UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = 1L),
            PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty (defaults)", showBackground = true, widthDp = 420)
@Composable
private fun SecurityStatusCardsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecurityStatusCardsContent(
            UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = 1L),
            PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true, widthDp = 420)
@Composable
private fun SecurityStatusCardsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecurityStatusCardsContent(
            UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true, widthDp = 420)
@Composable
private fun SecurityStatusCardsOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SecurityStatusCardsContent(
            UiState(
                phase = UiPhase.Content,
                data = previewSnapshot(),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
            PREVIEW_STRINGS,
        )
    }
}
