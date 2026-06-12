// The native Jetpack Compose + Material 3 FSMSubFSMPanel feature view — a parity port of
// web/src/features/system/components/FSMSubFSMPanel.tsx. The web component is a small, purely presentational
// panel on the FSM shadow-mode debugger: a "Active Sub-FSMs" heading above a 1/2-column grid of the
// vehicle's active drive / charge sub-FSMs (each row an icon chip, a "Drive Session" / "Charge Session"
// label, a live pulse dot, a state badge, and the start-time), or a friendly empty state when there are
// none — and it renders nothing at all when the debugger is filtered to a non-vehicle FSM.
//
// The native surface keeps that contract. It performs NO HTTP and binds no data hook of its own (the web
// `useTranslation` is the only hook; the rows arrive as props). The host owns the shared `FsmStore.stats`
// feed (P1/S8) and passes the decoded sub-FSMs down as a [UiState] (or the raw [Resource], or the web-shaped
// props), so this view renders every lifecycle state that layer can carry — loading, hard error, empty,
// content, and stale/offline ("last known") — while preserving the web `fsmType` visibility gate. The state
// badge is rendered inline with the shared `components/ui/Badge` (the web `StateBadge` is a sibling surface
// with its own prompt), and the drive/charge glyphs are the locally authored [FSMSubFSMPanelGlyphs].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/FSMSubFSMPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fsmsubfsmpanel

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement

private const val CARD_BG_ALPHA = 0.4f
private const val CHIP_ACTIVE_BG_ALPHA = 0.1f
private const val DANGER_BG_ALPHA = 0.08f
private const val CARD_WEIGHT = 1f
private const val PULSE_MIN_ALPHA = 0.35f
private const val PULSE_MS = 1_200
private val PULSE_DOT_SIZE = Spacing.xs
private val ICON_CHIP_PADDING = Spacing.sm

/**
 * Stable test/semantics tag for a sub-FSM card, keyed by [kind] — the native analogue of the web row's
 * `key={sub.type}`. Exposed so the companion UI test can address the drive / charge card deterministically.
 */
internal fun fsmSubFsmCardTestTag(kind: SubFsmKind): String = "fsm-sub-fsm-card-${kind.name.lowercase()}"

/**
 * The already-localized fixed strings the panel renders. The web component resolves every label through
 * `useTranslation`, so these arrive through the P1/S10 i18n facade at the Compose boundary (via
 * [rememberFsmSubFsmStrings]) and are passed down, keeping the panel free of any English literal.
 */
data class FsmSubFsmStrings(
    val title: String,
    val empty: String,
    val driveLabel: String,
    val chargeLabel: String,
    val loading: String,
    val error: String,
    val retry: String,
    val activeLabel: String,
    val offline: String,
)

/**
 * Stateful entry point. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and renders every
 * lifecycle [state] the shared `FsmStore.stats` feed can carry. The host owns the feed (P1/S8) and supplies
 * [onRefresh] (wired to `FsmStore.refreshStats` — the error-state retry and the stale auto-refresh); this
 * view never performs HTTP.
 *
 * @param state the cache-then-network projection of the vehicle's active sub-FSMs.
 * @param fsmType the active debugger filter; the panel is absent unless it is `vehicle` or `all` (web parity).
 * @param onRefresh re-runs the host's load — the error retry button and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun FSMSubFSMPanel(
    state: UiState<List<ActiveSubFsm>>,
    fsmType: String,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordFsmSubFsmPanelOpened(logger) }
    FSMSubFSMPanelContent(state = state, fsmType = fsmType, onRefresh = onRefresh, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's props (`activeSubs`, `fsmType`) plus the parent page's
 * query flags, for hosts that already hold the decoded list. Projects the fields onto a [UiState] via
 * [FSMSubFSMPanelProjection.projectUiState], then renders. Records `view.opened` like the stateful entry.
 */
@Composable
fun FSMSubFSMPanel(
    activeSubs: List<ActiveSubFsm>,
    fsmType: String,
    modifier: Modifier = Modifier,
    isLoading: Boolean = false,
    isFetching: Boolean = false,
    error: Boolean = false,
    onRefresh: () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(activeSubs, isLoading, isFetching, error) {
            FSMSubFSMPanelProjection.projectUiState(activeSubs, isLoading, isFetching, error)
        }
    FSMSubFSMPanel(state = state, fsmType = fsmType, modifier = modifier, onRefresh = onRefresh, logger = logger)
}

/**
 * Raw-feed overload for hosts that bind the shared `FsmStore.stats` [Resource] directly: decodes
 * `active_subs` and folds the cache-then-network resource onto a [UiState] via
 * [FSMSubFSMPanelProjection.projectFromResource], then renders. Records `view.opened` like the stateful entry.
 */
@Composable
fun FSMSubFSMPanel(
    stats: Resource<JsonElement>,
    fsmType: String,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(stats) { FSMSubFSMPanelProjection.projectFromResource(stats) }
    FSMSubFSMPanel(state = state, fsmType = fsmType, modifier = modifier, onRefresh = onRefresh, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * `fsmType === 'vehicle' || 'all'` early `return null` (the panel is absent for any other filter), then draws
 * the always-present "Active Sub-FSMs" heading above the body: a spinner during a first load, a danger alert
 * with a retry on a hard error, the friendly empty state when there are no sub-FSMs, and the sub-FSM cards
 * otherwise. Stale/offline (cached) content adds a freshness chip and auto-refreshes (ADR-013).
 */
@Composable
fun FSMSubFSMPanelContent(
    state: UiState<List<ActiveSubFsm>>,
    fsmType: String,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    strings: FsmSubFsmStrings = rememberFsmSubFsmStrings(),
) {
    if (!FSMSubFSMPanelProjection.isVehicleView(fsmType)) return

    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val now = remember(state) { System.currentTimeMillis() }
    val formatAge = rememberFsmFreshnessFormatter()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Heading(strings.title, modifier = Modifier.padding(bottom = Spacing.sm), level = HeadingLevel.Panel)
        when {
            state.isLoading -> LoadingBranch(strings)
            state.isError -> ErrorBranch(strings, onRefresh)
            state.isEmpty -> EmptyBranch(strings)
            else ->
                ContentBranch(
                    subs = state.data ?: emptyList(),
                    state = state,
                    strings = strings,
                    now = now,
                    formatAge = formatAge,
                )
        }
    }
}

@Composable
private fun LoadingBranch(strings: FsmSubFsmStrings) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.md),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Spinner(size = SpinnerSize.Sm, accessibleLabel = strings.loading)
        BodyText(strings.loading, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ErrorBranch(
    strings: FsmSubFsmStrings,
    onRefresh: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = TeslaTokens.status.danger.copy(alpha = DANGER_BG_ALPHA),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.Top) {
                Icon(TeslaGlyphs.Warning, contentDescription = null, size = IconSize.Md, tint = TeslaTokens.status.danger)
                BodyText(strings.error, color = TeslaTokens.status.danger)
            }
            Button(label = strings.retry, onClick = onRefresh, variant = ButtonVariant.Secondary, size = ButtonSize.Sm)
        }
    }
}

@Composable
private fun EmptyBranch(strings: FsmSubFsmStrings) {
    EmptyState(message = strings.empty)
}

@Composable
private fun ContentBranch(
    subs: List<ActiveSubFsm>,
    state: UiState<List<ActiveSubFsm>>,
    strings: FsmSubFsmStrings,
    now: Long,
    formatAge: (FreshnessAge) -> String,
) {
    if (state.stale || state.refreshing || state.hasError) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
            horizontalArrangement = Arrangement.End,
        ) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = strings.loading,
                errorLabel = strings.offline,
                formatAge = formatAge,
            )
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        subs.forEach { sub -> SubFsmCard(sub = sub, strings = strings, now = now, formatAge = formatAge) }
    }
}

/**
 * One sub-FSM row — the native mirror of the web grid card. The whole row is merged into a single TalkBack
 * focus stop announcing the session label, its live state, and how long it has been running. Inside: the
 * type icon chip (green when live, muted when terminal), the "Drive/Charge Session" label, the live pulse
 * dot when active, the [Badge] state chip, and the relative start-time.
 */
@Composable
private fun SubFsmCard(
    sub: ActiveSubFsm,
    strings: FsmSubFsmStrings,
    now: Long,
    formatAge: (FreshnessAge) -> String,
) {
    val active = remember(sub) { FSMSubFSMPanelProjection.isActive(sub) }
    val tone = remember(sub) { FSMSubFSMPanelProjection.stateTone(sub.kind, sub.state) }
    val icon = if (sub.kind == SubFsmKind.Drive) FSMSubFSMPanelGlyphs.Car else FSMSubFSMPanelGlyphs.Zap
    val label = if (sub.kind == SubFsmKind.Drive) strings.driveLabel else strings.chargeLabel
    val relative =
        formatAge(relativeAge(computeAgeSeconds(FSMSubFSMPanelProjection.parseIsoMillis(sub.startTime), now)))

    Surface(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.md))
                .testTag(fsmSubFsmCardTestTag(sub.kind))
                .semantics(mergeDescendants = true) {},
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = CARD_BG_ALPHA),
    ) {
        Row(
            modifier = Modifier.padding(Spacing.sm),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconChip(icon = icon, active = active)
            Column(modifier = Modifier.weight(CARD_WEIGHT), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = label,
                        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    if (active) ActivePulseDot(strings.activeLabel)
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Badge(text = sub.state, variant = toneVariant(tone), dot = true)
                    Text(
                        text = relative,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/** The type icon chip — the web `<div className={isActive ? 'bg-green-500/10' : …}>`. */
@Composable
private fun IconChip(
    icon: ImageVector,
    active: Boolean,
) {
    val background =
        if (active) {
            TeslaTokens.status.success.copy(alpha = CHIP_ACTIVE_BG_ALPHA)
        } else {
            MaterialTheme.colorScheme.surfaceVariant
        }
    val tint = if (active) TeslaTokens.status.success else MaterialTheme.colorScheme.onSurfaceVariant
    Box(modifier = Modifier.clip(RoundedCornerShape(Radius.md)).background(background).padding(ICON_CHIP_PADDING)) {
        Icon(icon, contentDescription = null, size = IconSize.Md, tint = tint)
    }
}

/**
 * The live pulse dot — the web `<span … bg-green-400 animate-pulse>`. The pulse runs only when the device is
 * not in reduce-motion mode; otherwise the dot is solid. The [label] exposes its meaning ("Active") to
 * TalkBack so the otherwise-decorative dot conveys liveness.
 */
@Composable
private fun ActivePulseDot(label: String) {
    val reduceMotion = rememberReducedMotion()
    val transition = rememberInfiniteTransition(label = "fsm-sub-pulse")
    val pulse by transition.animateFloat(
        initialValue = 1f,
        targetValue = PULSE_MIN_ALPHA,
        animationSpec = infiniteRepeatable(animation = tween(PULSE_MS), repeatMode = RepeatMode.Reverse),
        label = "fsm-sub-pulse-alpha",
    )
    Box(
        modifier =
            Modifier
                .size(PULSE_DOT_SIZE)
                .alpha(if (reduceMotion) 1f else pulse)
                .clip(CircleShape)
                .background(TeslaTokens.status.success)
                .semantics { contentDescription = label },
    )
}

/** Maps the pure [SubFsmStateTone] to a `components/ui` [BadgeVariant] at the render boundary. */
private fun toneVariant(tone: SubFsmStateTone): BadgeVariant =
    when (tone) {
        SubFsmStateTone.Success -> BadgeVariant.Success
        SubFsmStateTone.Warning -> BadgeVariant.Warning
        SubFsmStateTone.Info -> BadgeVariant.Info
        SubFsmStateTone.Neutral -> BadgeVariant.Neutral
    }

/**
 * Builds the localized [FsmSubFsmStrings] from the i18n catalog (P1/S10): the `fsm.*` keys the web component
 * reads through `useTranslation`, plus the shared `common.*` / `error.*` lifecycle microcopy the native
 * loading / error / offline surfaces add. Resolved once at the Compose boundary so the rest of the surface
 * stays free of any English literal.
 */
@Composable
private fun rememberFsmSubFsmStrings(): FsmSubFsmStrings {
    val title = stringResource(R.string.translation_fsm_subFSMs)
    val empty = stringResource(R.string.translation_fsm_noSubFSMs)
    val driveLabel = stringResource(R.string.translation_fsm_activeDrive)
    val chargeLabel = stringResource(R.string.translation_fsm_activeCharge)
    val loading = stringResource(R.string.translation_common_loading)
    val error = stringResource(R.string.translation_error_loadFailed)
    val retry = stringResource(R.string.translation_common_retry)
    val activeLabel = stringResource(R.string.translation_common_active)
    val offline = stringResource(R.string.translation_common_offline)
    return remember(title, empty, driveLabel, chargeLabel, loading, error, retry, activeLabel, offline) {
        FsmSubFsmStrings(
            title = title,
            empty = empty,
            driveLabel = driveLabel,
            chargeLabel = chargeLabel,
            loading = loading,
            error = error,
            retry = retry,
            activeLabel = activeLabel,
            offline = offline,
        )
    }
}

/**
 * Localized relative-age formatter for the start-time / freshness-chip labels (`translation_freshness_*`) —
 * the same render-only concern the sibling surfaces resolve, kept out of the pure projection so the catalog
 * stays the single source of microcopy (P1/S10).
 */
@Composable
private fun rememberFsmFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Em dash shown for an unparseable start-time — the web `TimeStamp` null/invalid fallback. */
private const val EM_DASH = "\u2014"

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    FsmSubFsmStrings(
        title = "Active Sub-FSMs",
        empty = "No active drive or charge sessions",
        driveLabel = "Drive Session",
        chargeLabel = "Charge Session",
        loading = "Loading\u2026",
        error = "Failed to load data",
        retry = "Retry",
        activeLabel = "Active",
        offline = "Offline",
    )

private val PREVIEW_SUBS =
    listOf(
        ActiveSubFsm(kind = SubFsmKind.Drive, state = "active", startTime = "2026-06-11T11:30:00Z", driveId = 42),
        ActiveSubFsm(kind = SubFsmKind.Charge, state = "completing", startTime = "2026-06-11T11:55:00Z", sessionId = 7),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun FSMSubFSMPanelContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FSMSubFSMPanelContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_SUBS),
            fsmType = "vehicle",
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun FSMSubFSMPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FSMSubFSMPanelContent(state = UiState.loading(), fsmType = "all", strings = PREVIEW_STRINGS)
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun FSMSubFSMPanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FSMSubFSMPanelContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Unknown),
            fsmType = "vehicle",
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun FSMSubFSMPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FSMSubFSMPanelContent(
            state = UiState(phase = UiPhase.Empty, data = emptyList()),
            fsmType = "vehicle",
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline", showBackground = true)
@Composable
private fun FSMSubFSMPanelOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FSMSubFSMPanelContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SUBS,
                    fetchedAt = FSMSubFSMPanelProjection.parseIsoMillis("2026-06-11T11:30:00Z"),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            fsmType = "vehicle",
            strings = PREVIEW_STRINGS,
        )
    }
}
