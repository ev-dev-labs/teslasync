// The native Jetpack Compose + Material 3 Active-sessions / device-management feature view — a parity port of
// web/src/features/settings/components/ActiveSessionsSection.tsx. The web component renders one GlassPanel
// under the Settings "security" section with three branches: a loading spinner inside the panel chrome, an
// "open mode" advisory when the backend reports AUTH_MODE_OPEN, and the forward-auth list — a DataTable of
// sessions (device / IP / signed-in / last-seen) plus a per-row "Sign out" and a footer "Sign out all other
// devices". Both destructive actions go through a ConfirmDialog with no silence option (security primitives
// must always confirm).
//
// This port keeps that contract end to end and binds NO data hook of its own. The host supplies the
// active-sessions query through the shared P1/S8 state-holder layer as a [UiState] (the cache-then-network
// projection of `useSessions`) plus the two revoke callbacks (web `useRevokeSession` /
// `useRevokeAllOtherSessions`) and their in-flight flags, so this feature view renders every lifecycle state
// that layer can carry — loading, hard error with retry, the open-mode advisory, content, empty, and
// stale/offline ("last known") — without ever fetching. The native [GlassPanel] / [DataTable] /
// [ConfirmDialog] / [EmptyState] (the DataTable's empty branch) / [Badge] / [DataFreshness] / [FadeIn] are the
// faithful counterparts of the web shared components, and every string resolves through the i18n catalog
// (P1/S10, the `translation_settingsSessions_*` keys); no English literal lives in render code.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ActiveSessionsSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.activesessionssection

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** The web `<FadeIn delay={0.05}>` entrance delay, in milliseconds. */
private const val FADE_DELAY_MS: Int = 50

/** DataTable column weights — the device column is widest, the meta columns equal, the action column narrow. */
private const val DEVICE_WEIGHT: Float = 2.4f
private const val META_WEIGHT: Float = 1.3f
private const val ACTION_WEIGHT: Float = 1.4f

/**
 * Stateful entry point for the Active-sessions section. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared active-sessions feed can carry. The host owns the
 * feed (P1/S8) and supplies the revoke callbacks; this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the list query (web `useSessions`).
 * @param onRevoke runs the host's single-session revoke (web `useRevokeSession.mutate(id)`).
 * @param onRevokeAllOthers runs the host's revoke-all-others mutation (web `useRevokeAllOtherSessions`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param revokingId the id of the session currently being revoked, so its row action shows the in-flight state.
 * @param revokingAll whether the revoke-all-others mutation is in flight (footer button busy label).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ActiveSessionsSection(
    state: UiState<ActiveSessionsData>,
    onRevoke: (String) -> Unit,
    onRevokeAllOthers: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    revokingId: String? = null,
    revokingAll: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordActiveSessionsSectionOpened(logger) }
    ActiveSessionsSectionContent(
        state = state,
        onRevoke = onRevoke,
        onRevokeAllOthers = onRevokeAllOthers,
        onRetry = onRetry,
        modifier = modifier,
        revokingId = revokingId,
        revokingAll = revokingAll,
    )
}

/**
 * Web-parity overload mirroring the web component's `useSessions().data` input, for hosts that already hold the
 * resolved query value. A `null` payload or an open-mode value renders the advisory branch; a session-mode
 * value with no rows renders the empty branch, otherwise the list renders. Records `view.opened` like the
 * stateful entry. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun ActiveSessionsSection(
    data: ActiveSessionsData?,
    onRevoke: (String) -> Unit,
    onRevokeAllOthers: () -> Unit,
    modifier: Modifier = Modifier,
    revokingId: String? = null,
    revokingAll: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(data) {
            val empty = data != null && data.mode == SessionMode.Session && data.sessions.isEmpty()
            UiState(phase = if (empty) UiPhase.Empty else UiPhase.Content, data = data)
        }
    ActiveSessionsSection(
        state = state,
        onRevoke = onRevoke,
        onRevokeAllOthers = onRevokeAllOthers,
        onRetry = {},
        modifier = modifier,
        revokingId = revokingId,
        revokingAll = revokingAll,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * three branches (loading / open-mode advisory / forward-auth list) and adds the lifecycle chrome the host's
 * feed implies: a hard-error retry surface and a freshness chip that reflects refreshing / stale / offline,
 * with stale-but-reachable data auto-refreshing (the freshness contract the sibling surfaces use). [locale]
 * and [formatTimestamp] localize the row timestamps.
 */
@Composable
fun ActiveSessionsSectionContent(
    state: UiState<ActiveSessionsData>,
    onRevoke: (String) -> Unit,
    onRevokeAllOthers: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    revokingId: String? = null,
    revokingAll: Boolean = false,
    locale: Locale = Locale.getDefault(),
    formatTimestamp: (String) -> String = rememberTimestampFormatter(locale),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val result =
        remember(state.data, formatTimestamp) {
            ActiveSessionsProjection.project(state.data, formatTimestamp)
        }

    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        when {
            state.isLoading -> LoadingPanel()
            state.isError -> ErrorPanel(onRetry = onRetry)
            result.isOpenMode -> OpenModePanel()
            else ->
                ForwardAuthPanel(
                    state = state,
                    result = result,
                    onRevoke = onRevoke,
                    onRevokeAllOthers = onRevokeAllOthers,
                    revokingId = revokingId,
                    revokingAll = revokingAll,
                )
        }
    }
}

/**
 * First-load branch — the panel chrome with a spinner and "Loading sessions…", rendered inside the panel
 * (never hidden) so the layout does not reflow when data arrives (web loading branch).
 */
@Composable
private fun LoadingPanel() {
    val loading = stringResource(R.string.translation_settingsSessions_loading)
    GlassPanel(padding = PanelPadding.Md) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Spinner(size = SpinnerSize.Sm, accessibleLabel = loading)
            BodyText(loading)
        }
    }
}

/**
 * Open-mode advisory branch — the amber `AlertTriangle` IconBox + title + helper text shown when the backend
 * reports AUTH_MODE_OPEN (web `mode === 'open'`), explaining that session tracking needs forward-auth.
 */
@Composable
private fun OpenModePanel() {
    GlassPanel(padding = PanelPadding.Md) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconBox(tone = IconBoxTone.Warning) {
                Icon(AlertTriangleGlyph, contentDescription = null, size = IconSize.Lg)
            }
            Heading(
                stringResource(R.string.translation_settingsSessions_openMode_title),
                level = HeadingLevel.Panel,
            )
        }
        Spacer(Modifier.height(Spacing.sm))
        HelperText(stringResource(R.string.translation_settingsSessions_openMode_message))
    }
}

/**
 * Hard-error branch — a retry affordance shown when the first load failed with nothing cached (web `QueryError`
 * equivalent). Uses the session-specific load-error message with the shared "Server error" title + Retry.
 */
@Composable
private fun ErrorPanel(onRetry: () -> Unit) {
    GlassPanel(padding = PanelPadding.Md) {
        ErrorDisplay(
            message = stringResource(R.string.translation_settingsSessions_errors_load),
            title = stringResource(R.string.translation_error_serverError_title),
            onRetry = onRetry,
            retryLabel = stringResource(R.string.translation_common_retry),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * Forward-auth branch — the always-visible header (Laptop IconBox + title + subtitle and, when other devices
 * exist, the "Sign out all other devices" button), an optional freshness chip + inline load error for the
 * stale/offline case, and the sessions [DataTable]. The two destructive [ConfirmDialog]s are hosted here and
 * gate the revoke callbacks.
 */
@Composable
private fun ForwardAuthPanel(
    state: UiState<ActiveSessionsData>,
    result: ActiveSessionsProjectionResult,
    onRevoke: (String) -> Unit,
    onRevokeAllOthers: () -> Unit,
    revokingId: String?,
    revokingAll: Boolean,
) {
    var revokeTarget by remember { mutableStateOf<SessionRowProjection?>(null) }
    var showAllOthers by remember { mutableStateOf(false) }

    GlassPanel(padding = PanelPadding.Md) {
        ActiveSessionsHeader(
            hasOtherDevices = result.hasOtherDevices,
            revokingAll = revokingAll,
            onRevokeAllOthers = { showAllOthers = true },
        )
        if (state.stale || state.refreshing || state.hasError) {
            Spacer(Modifier.height(Spacing.sm))
            ActiveSessionsFreshnessRow(state)
        }
        if (state.hasError) {
            Spacer(Modifier.height(Spacing.sm))
            ErrorText(stringResource(R.string.translation_settingsSessions_errors_load))
        }
        Spacer(Modifier.height(Spacing.md))
        SessionsTable(
            rows = result.rows,
            revokingId = revokingId,
            onRevokeRequest = { revokeTarget = it },
        )
    }

    RevokeConfirmDialogs(
        revokeTarget = revokeTarget,
        showAllOthers = showAllOthers,
        revokingId = revokingId,
        revokingAll = revokingAll,
        onRevoke = onRevoke,
        onRevokeAllOthers = onRevokeAllOthers,
        onDismissRevoke = { revokeTarget = null },
        onDismissAllOthers = { showAllOthers = false },
    )
}

/** The forward-auth header: cyan Laptop IconBox + title + subtitle, with the footer revoke button at the end. */
@Composable
private fun ActiveSessionsHeader(
    hasOtherDevices: Boolean,
    revokingAll: Boolean,
    onRevokeAllOthers: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Row(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconBox(tone = IconBoxTone.Info) {
                Icon(LaptopGlyph, contentDescription = null, size = IconSize.Lg)
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Heading(
                    stringResource(R.string.translation_settingsSessions_title),
                    level = HeadingLevel.Panel,
                )
                HelperText(stringResource(R.string.translation_settingsSessions_subtitle))
            }
        }
        if (hasOtherDevices) {
            RevokeAllOthersButton(revokingAll = revokingAll, onClick = onRevokeAllOthers)
        }
    }
}

/** The "Sign out all other devices" footer button — busy label while the all-others mutation is in flight. */
@Composable
private fun RevokeAllOthersButton(
    revokingAll: Boolean,
    onClick: () -> Unit,
) {
    val label =
        if (revokingAll) {
            stringResource(R.string.translation_settingsSessions_revokeAllOthersBusy)
        } else {
            stringResource(R.string.translation_settingsSessions_revokeAllOthers)
        }
    Button(
        label = label,
        onClick = onClick,
        variant = ButtonVariant.Secondary,
        leadingIcon = ShieldAlertGlyph,
        enabled = !revokingAll,
    )
}

/** The sessions [DataTable]: device / IP / signed-in / last-seen columns plus a per-row "Sign out" action. */
@Composable
private fun SessionsTable(
    rows: List<SessionRowProjection>,
    revokingId: String?,
    onRevokeRequest: (SessionRowProjection) -> Unit,
) {
    val columnDevice = stringResource(R.string.translation_settingsSessions_columns_device)
    val columnIp = stringResource(R.string.translation_settingsSessions_columns_ip)
    val columnCreatedAt = stringResource(R.string.translation_settingsSessions_columns_createdAt)
    val columnLastSeen = stringResource(R.string.translation_settingsSessions_columns_lastSeenAt)
    val emptyText = stringResource(R.string.translation_settingsSessions_empty)
    val columns =
        listOf(
            TableColumn<SessionRowProjection>(
                key = "device",
                header = columnDevice,
                weight = DEVICE_WEIGHT,
                cell = { row -> DeviceCell(row) },
            ),
            TableColumn(
                key = "ip",
                header = columnIp,
                weight = META_WEIGHT,
                cell = { row -> BodyText(row.ipLabel) },
            ),
            TableColumn(
                key = "createdAt",
                header = columnCreatedAt,
                weight = META_WEIGHT,
                cell = { row -> BodyText(row.createdAtLabel) },
            ),
            TableColumn(
                key = "lastSeenAt",
                header = columnLastSeen,
                weight = META_WEIGHT,
                cell = { row -> BodyText(row.lastSeenAtLabel) },
            ),
            TableColumn(
                key = "actions",
                header = "",
                weight = ACTION_WEIGHT,
                alignEnd = true,
                cell = { row -> RevokeCell(row = row, revokingId = revokingId, onRevokeRequest = onRevokeRequest) },
            ),
        )
    DataTable(
        columns = columns,
        rows = rows,
        keyOf = { it.id },
        modifier = Modifier.fillMaxWidth(),
        emptyText = emptyText,
    )
}

/** The device cell — the heuristic device label plus a "This device" badge for the current session. */
@Composable
private fun DeviceCell(row: SessionRowProjection) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        BodyText(row.deviceLabel)
        if (row.isCurrent) {
            Badge(
                stringResource(R.string.translation_settingsSessions_current),
                variant = BadgeVariant.Success,
            )
        }
    }
}

/**
 * The action cell — a "Sign out" ghost button for non-current sessions, disabled while its own revoke is in
 * flight, and carrying the per-device aria-label (web `aria-label="Sign out {{device}}"`). Current sessions
 * render no action (web `row.current ? null : <Button/>`).
 */
@Composable
private fun RevokeCell(
    row: SessionRowProjection,
    revokingId: String?,
    onRevokeRequest: (SessionRowProjection) -> Unit,
) {
    if (!row.isCurrent) {
        val aria = stringResource(R.string.translation_settingsSessions_row_revokeAria, row.deviceLabel)
        Button(
            label = stringResource(R.string.translation_settingsSessions_row_revoke),
            onClick = { onRevokeRequest(row) },
            modifier = Modifier.semantics { contentDescription = aria },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = LogOutGlyph,
            enabled = revokingId != row.id,
        )
    }
}

/**
 * The two destructive confirmations — per-row revoke and revoke-all-others. Both use the danger severity and
 * have no silence option (security primitives must always confirm). On confirm the host callback fires and the
 * dialog dismisses; the in-flight state surfaces on the triggering control + the toast the host owns.
 */
@Composable
private fun RevokeConfirmDialogs(
    revokeTarget: SessionRowProjection?,
    showAllOthers: Boolean,
    revokingId: String?,
    revokingAll: Boolean,
    onRevoke: (String) -> Unit,
    onRevokeAllOthers: () -> Unit,
    onDismissRevoke: () -> Unit,
    onDismissAllOthers: () -> Unit,
) {
    if (revokeTarget != null) {
        ConfirmDialog(
            title = stringResource(R.string.translation_settingsSessions_confirm_revokeTitle),
            message =
                stringResource(
                    R.string.translation_settingsSessions_confirm_revokeMessage,
                    revokeTarget.deviceLabel,
                ),
            confirmLabel = stringResource(R.string.translation_settingsSessions_confirm_revokeConfirm),
            cancelLabel = stringResource(R.string.translation_settingsSessions_confirm_revokeCancel),
            onConfirm = {
                onRevoke(revokeTarget.id)
                onDismissRevoke()
            },
            onCancel = onDismissRevoke,
            severity = ConfirmSeverity.Danger,
            loading = revokingId == revokeTarget.id,
        )
    }
    if (showAllOthers) {
        ConfirmDialog(
            title = stringResource(R.string.translation_settingsSessions_confirm_allOthersTitle),
            message = stringResource(R.string.translation_settingsSessions_confirm_allOthersMessage),
            confirmLabel = stringResource(R.string.translation_settingsSessions_confirm_allOthersConfirm),
            cancelLabel = stringResource(R.string.translation_settingsSessions_confirm_allOthersCancel),
            onConfirm = {
                onRevokeAllOthers()
                onDismissAllOthers()
            },
            onCancel = onDismissAllOthers,
            severity = ConfirmSeverity.Danger,
            loading = revokingAll,
        )
    }
}

/**
 * The freshness chip rendered above the table when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline"
 * label; a stale-but-reachable value reads its relative age.
 */
@Composable
private fun ActiveSessionsFreshnessRow(state: UiState<*>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberFreshnessFormatter(),
        )
    }
}

/**
 * A locale-aware ISO-8601 → medium date-time formatter (web `useDateFormat().formatDateTime`). Empty stamps
 * render the em dash; unparseable stamps fall back to the raw value so the row is never blank.
 */
@Composable
private fun rememberTimestampFormatter(locale: Locale): (String) -> String {
    val zone = ZoneId.systemDefault()
    return remember(locale, zone) {
        val formatter =
            DateTimeFormatter
                .ofLocalizedDateTime(FormatStyle.MEDIUM)
                .withLocale(locale)
                .withZone(zone)
        val format: (String) -> String = { raw -> formatTimestampOrRaw(raw, formatter) }
        format
    }
}

/** Formats [raw] with [formatter], tolerating both `Z` instants and offset date-times, else returns [raw]. */
private fun formatTimestampOrRaw(
    raw: String,
    formatter: DateTimeFormatter,
): String {
    if (raw.isBlank()) return EM_DASH
    return runCatching { formatter.format(Instant.parse(raw)) }
        .recoverCatching { formatter.format(OffsetDateTime.parse(raw).toInstant()) }
        .getOrDefault(raw)
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_SESSIONS: List<ActiveSession> =
    listOf(
        ActiveSession(
            id = "sess-1",
            userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
            ip = "203.0.113.7",
            createdAt = "2026-04-04T18:30:00Z",
            lastSeenAt = "2026-04-05T09:12:00Z",
            current = true,
        ),
        ActiveSession(
            id = "sess-2",
            userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
            ip = "198.51.100.22",
            createdAt = "2026-04-01T08:00:00Z",
            lastSeenAt = "2026-04-03T22:45:00Z",
            current = false,
        ),
    )

private val PREVIEW_CONTENT: ActiveSessionsData =
    ActiveSessionsData(mode = SessionMode.Session, sessions = PREVIEW_SESSIONS)

private fun previewFormat(raw: String): String = raw

@Preview(name = "Loading", showBackground = true)
@Composable
private fun ActiveSessionsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActiveSessionsSectionContent(
            state = UiState(UiPhase.Loading),
            onRevoke = {},
            onRevokeAllOthers = {},
            onRetry = {},
            locale = Locale.US,
            formatTimestamp = ::previewFormat,
        )
    }
}

@Preview(name = "Open mode", showBackground = true)
@Composable
private fun ActiveSessionsOpenModePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActiveSessionsSectionContent(
            state = UiState(UiPhase.Content, data = ActiveSessionsData(mode = SessionMode.Open)),
            onRevoke = {},
            onRevokeAllOthers = {},
            onRetry = {},
            locale = Locale.US,
            formatTimestamp = ::previewFormat,
        )
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun ActiveSessionsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActiveSessionsSectionContent(
            state = UiState(UiPhase.Content, data = PREVIEW_CONTENT),
            onRevoke = {},
            onRevokeAllOthers = {},
            onRetry = {},
            locale = Locale.US,
            formatTimestamp = ::previewFormat,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun ActiveSessionsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActiveSessionsSectionContent(
            state = UiState(UiPhase.Empty, data = ActiveSessionsData(mode = SessionMode.Session)),
            onRevoke = {},
            onRevokeAllOthers = {},
            onRetry = {},
            locale = Locale.US,
            formatTimestamp = ::previewFormat,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun ActiveSessionsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ActiveSessionsSectionContent(
            state = UiState(UiPhase.Error),
            onRevoke = {},
            onRevokeAllOthers = {},
            onRetry = {},
            locale = Locale.US,
            formatTimestamp = ::previewFormat,
        )
    }
}
