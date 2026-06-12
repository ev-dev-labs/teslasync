// The native Jetpack Compose + Material 3 QuietHoursPanel feature view — a parity port of
// web/src/features/settings/components/QuietHoursPanel.tsx. It reproduces that surface end to end: the
// Do-Not-Disturb header with the "Add window" affordance, the list of quiet-hours windows (enabled badge, the
// "start → end (timezone)" summary, the active-weekday pills, and the bypass-severity chips), the per-row edit /
// delete actions (web `useDeleteQuietHours`), and the inline create/edit form that builds a window from the
// start/end/timezone/weekday/severity fields (web `useSaveQuietHours`). Every lifecycle state the shared
// cache-then-network feed can carry is rendered — a loading spinner with its label, a friendly empty state, a
// hard-error retry surface, and stale/offline "last known" with a freshness chip + auto-refresh — so the panel is
// never a blank box. The view performs NO HTTP: it binds the [QuietHoursPanelViewModel] (P1/S8) and renders.
//
// Toasts (web `useToast`) are surfaced through the shared [ToastHost] from the view-model's typed
// [QuietHoursToast] stream, localized at this boundary (P1/S10).
//
// Declared parity divergence (no silent drift): the web exports `nextWindowChangeLabel`, which returns
// un-internationalized English prose ("ends at 07:00", "starts tomorrow at 23:00") with no `t()` key in the
// cross-platform catalog (generated from web/src/i18n). To honor the native "no English literals" rule without
// modifying the shared i18n pipeline, the boundary computation is ported verbatim + unit-tested
// ([nextWindowChange]) and surfaced as a compact Moon + boundary-time chip (the imminent change time is data; the
// chip is tinted by the change kind), conveying the same information i18n-cleanly.
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration`/`filename` are suppressed: the mandated surface directory
// (com/teslasync/feature-views/QuietHoursPanel) cannot form a valid Kotlin package and the file hosts several
// co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.featureviews.quiethourspanel

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.ToastHost
import io.teslasync.android.components.feedback.ToastItem
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindow
import io.teslasync.shared.core.presentation.notifications.QuietHoursWindowInput
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

private const val HEADER_FADE_DELAY_MS = 135
private const val MAX_TOASTS = 3
private const val TOAST_DURATION_MS = 4_000L
private const val CHIP_SELECTED_BG_ALPHA = 0.15f
private const val CHIP_SELECTED_RING_ALPHA = 0.40f
private const val CHIP_BORDER_ALPHA = 0.40f
private val CHIP_V_PADDING = 4.dp

/**
 * Stateful entry point for the QuietHours surface. Binds the [viewModel] (P1/S8), records the one-shot PII-safe
 * `view.opened` diagnostic, owns the inline create/edit form + toast queue, and renders every lifecycle state the
 * windows feed can carry. The host constructs the view-model via [QuietHoursPanelViewModel.create]; this view
 * never performs HTTP.
 *
 * [seedDraft] lets a sibling AI advisor surface seed the create form once per identity (web `QuietHoursPanelProps`
 * / `seedDraft`); [onSeedConsumed] fires after the seed is copied so the parent can clear its pending pointer. The
 * canonical Save button remains the sole write path.
 */
@Composable
fun QuietHoursPanel(
    viewModel: QuietHoursPanelViewModel,
    modifier: Modifier = Modifier,
    seedDraft: QuietHoursWindowInput? = null,
    onSeedConsumed: () -> Unit = {},
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val windowsState by viewModel.windows.collectAsStateWithLifecycle()
    val saving by viewModel.saving.collectAsStateWithLifecycle()
    val deletingIds by viewModel.deletingIds.collectAsStateWithLifecycle()

    val defaultTimezone = remember { resolveDefaultTimezone() }
    var draft by remember { mutableStateOf<DraftWindow?>(null) }
    var validationError by remember { mutableStateOf<QuietHoursValidationError?>(null) }
    val scope = rememberCoroutineScope()
    val toastQueue = remember { mutableStateListOf<ToastItem>() }
    QuietHoursToastPresenter(viewModel, toastQueue)

    LaunchedEffect(seedDraft) {
        val seed = seedDraft ?: return@LaunchedEffect
        draft = draftFromSeed(seed, defaultTimezone)
        validationError = null
        onSeedConsumed()
    }

    Box(modifier = modifier.fillMaxWidth()) {
        QuietHoursPanelContent(
            windowsState = windowsState,
            draft = draft,
            validationError = validationError,
            saving = saving,
            deletingIds = deletingIds,
            onAddClick = {
                validationError = null
                draft = makeDraft(defaultTimezone = defaultTimezone)
            },
            onEdit = { window ->
                validationError = null
                draft = makeDraft(window)
            },
            onDelete = viewModel::delete,
            onDraftChange = { draft = it },
            onCancel = {
                draft = null
                validationError = null
            },
            onSubmit = {
                val current = draft
                if (current != null) {
                    val error = validateDraft(current)
                    validationError = error
                    if (error == null) {
                        scope.launch {
                            if (viewModel.save(current.toInput(), current.id).isSuccess) {
                                draft = null
                            }
                        }
                    }
                }
            },
            onRetry = viewModel::retry,
        )

        ToastHost(
            toasts = toastQueue,
            onDismiss = { id -> toastQueue.removeAll { it.id == id } },
            modifier = Modifier.align(Alignment.BottomCenter),
        )
    }
}

/**
 * Stateless renderer of the surface — the unit/UI-test entry point. Reproduces the web layout (header → state
 * branch → inline form) and every lifecycle branch: a loading spinner, a hard-error retry surface, the no-windows
 * empty state (suppressed while the form is open, web `windows.length === 0 && !draft`), and the populated rows
 * with their freshness chip. Stale (non-error) data auto-refreshes, mirroring the sibling surfaces' freshness
 * contract.
 */
@Composable
fun QuietHoursPanelContent(
    windowsState: UiState<List<QuietHoursWindow>>,
    draft: DraftWindow?,
    validationError: QuietHoursValidationError?,
    saving: Boolean,
    deletingIds: Set<Long>,
    onAddClick: () -> Unit,
    onEdit: (QuietHoursWindow) -> Unit,
    onDelete: (QuietHoursWindow) -> Unit,
    onDraftChange: (DraftWindow) -> Unit,
    onCancel: () -> Unit,
    onSubmit: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(windowsState.stale, windowsState.refreshing, windowsState.hasError) {
        if (windowsState.stale && !windowsState.refreshing && !windowsState.hasError) onRetry()
    }

    val nowMinutes = remember { LocalTime.now().let { it.hour * 60 + it.minute } }
    val todayDow = remember { LocalDate.now().dayOfWeek.value % 7 }

    FadeIn(modifier = modifier.fillMaxWidth(), delayMs = HEADER_FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                QuietHoursHeader(showAdd = draft == null, onAddClick = onAddClick)
                WindowsSection(
                    windowsState = windowsState,
                    deletingIds = deletingIds,
                    formOpen = draft != null,
                    nowMinutes = nowMinutes,
                    todayDow = todayDow,
                    onEdit = onEdit,
                    onDelete = onDelete,
                    onRetry = onRetry,
                )
                if (draft != null) {
                    QuietHoursForm(
                        draft = draft,
                        validationError = validationError,
                        saving = saving,
                        onDraftChange = onDraftChange,
                        onCancel = onCancel,
                        onSubmit = onSubmit,
                    )
                }
            }
        }
    }
}

// ── Header ───────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun QuietHoursHeader(
    showAdd: Boolean,
    onAddClick: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Row(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconBox(tone = IconBoxTone.Info) {
                Icon(QuietHoursGlyphs.Moon, contentDescription = null, size = IconSize.Md)
            }
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                SectionTitle(stringResource(R.string.translation_quietHours_title))
                HelperText(stringResource(R.string.translation_quietHours_subtitle))
            }
        }
        if (showAdd) {
            Button(
                label = stringResource(R.string.translation_quietHours_addWindow),
                onClick = onAddClick,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                leadingIcon = TeslaGlyphs.Plus,
            )
        }
    }
}

// ── Windows section (loading / error / empty / list) ─────────────────────────────────────────────────────

@Composable
private fun WindowsSection(
    windowsState: UiState<List<QuietHoursWindow>>,
    deletingIds: Set<Long>,
    formOpen: Boolean,
    nowMinutes: Int,
    todayDow: Int,
    onEdit: (QuietHoursWindow) -> Unit,
    onDelete: (QuietHoursWindow) -> Unit,
    onRetry: () -> Unit,
) {
    when {
        windowsState.isLoading -> LoadingState()
        windowsState.isError -> ErrorState(onRetry)
        windowsState.isEmpty && !formOpen -> EmptyWindows()
        else ->
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                if (windowsState.stale || windowsState.refreshing || windowsState.hasError) {
                    FreshnessChip(windowsState)
                }
                (windowsState.data ?: emptyList()).forEach { window ->
                    WindowRow(
                        window = window,
                        deleting = window.id in deletingIds,
                        nextChange = nextWindowChange(window, nowMinutes, todayDow),
                        onEdit = onEdit,
                        onDelete = onDelete,
                    )
                }
            }
    }
}

@Composable
private fun LoadingState() {
    Spinner(
        modifier = Modifier.fillMaxWidth(),
        size = SpinnerSize.Sm,
        label = stringResource(R.string.translation_quietHours_loading),
    )
}

@Composable
private fun ErrorState(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun EmptyWindows() {
    EmptyState(
        message = stringResource(R.string.translation_quietHours_empty),
        icon = QuietHoursGlyphs.Moon,
        modifier = Modifier.fillMaxWidth(),
    )
}

// ── Window row ───────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun WindowRow(
    window: QuietHoursWindow,
    deleting: Boolean,
    nextChange: NextWindowChange?,
    onEdit: (QuietHoursWindow) -> Unit,
    onDelete: (QuietHoursWindow) -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    modifier = Modifier.weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    EnabledBadge(window.enabled)
                    BodyText(summarizeWindow(window))
                    if (nextChange != null) NextChangeChip(nextChange, summarizeWindow(window))
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Button(
                        label = stringResource(R.string.translation_quietHours_edit),
                        onClick = { onEdit(window) },
                        variant = ButtonVariant.Secondary,
                        size = ButtonSize.Sm,
                        leadingIcon = TeslaGlyphs.Edit,
                    )
                    Button(
                        label = stringResource(R.string.translation_quietHours_delete),
                        onClick = { onDelete(window) },
                        variant = ButtonVariant.Danger,
                        size = ButtonSize.Sm,
                        enabled = !deleting,
                        leadingIcon = QuietHoursGlyphs.Trash,
                    )
                }
            }
            WeekdayPills(window.weekdays)
            if (window.bypassSeverities.isNotEmpty()) BypassRow(window.bypassSeverities)
        }
    }
}

@Composable
private fun EnabledBadge(enabled: Boolean) {
    if (enabled) {
        Badge(stringResource(R.string.translation_quietHours_enabled), variant = BadgeVariant.Success)
    } else {
        Badge(stringResource(R.string.translation_quietHours_disabled), variant = BadgeVariant.Neutral)
    }
}

@Composable
private fun NextChangeChip(
    change: NextWindowChange,
    accessibleSummary: String,
) {
    val starts = change.kind == NextWindowChangeKind.StartsToday || change.kind == NextWindowChangeKind.StartsTomorrow
    val tint = if (starts) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier = Modifier.semantics { contentDescription = accessibleSummary },
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(QuietHoursGlyphs.Moon, contentDescription = null, size = IconSize.Xs, tint = tint)
        Caption(change.time)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WeekdayPills(weekdays: Int) {
    val labels = weekdayLabelResIds()
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        WEEKDAY_BITS.forEachIndexed { index, bit ->
            DayPill(label = stringResource(labels[index]), on = windowDayActive(weekdays, bit))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun BypassRow(severities: List<String>) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(stringResource(R.string.translation_quietHours_bypassLabel))
        severities.forEach { value ->
            Badge(severityLabel(value), variant = BadgeVariant.Warning)
        }
    }
}

// ── Inline create / edit form ────────────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun QuietHoursForm(
    draft: DraftWindow,
    validationError: QuietHoursValidationError?,
    saving: Boolean,
    onDraftChange: (DraftWindow) -> Unit,
    onCancel: () -> Unit,
    onSubmit: () -> Unit,
) {
    val isEdit = draft.id != null
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PanelTitle(
                    stringResource(
                        if (isEdit) {
                            R.string.translation_quietHours_form_editTitle
                        } else {
                            R.string.translation_quietHours_form_addTitle
                        },
                    ),
                )
                Toggle(
                    checked = draft.enabled,
                    onCheckedChange = { onDraftChange(draft.copy(enabled = it)) },
                    label = stringResource(R.string.translation_quietHours_form_enabled),
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                Input(
                    value = draft.startLocal,
                    onValueChange = { onDraftChange(draft.copy(startLocal = it)) },
                    label = stringResource(R.string.translation_quietHours_form_start),
                    modifier = Modifier.weight(1f),
                )
                Input(
                    value = draft.endLocal,
                    onValueChange = { onDraftChange(draft.copy(endLocal = it)) },
                    label = stringResource(R.string.translation_quietHours_form_end),
                    modifier = Modifier.weight(1f),
                )
            }

            val tzOptions = remember(draft.timezone) { quietHoursTimezones(draft.timezone).map { SelectOption(it, it) } }
            Select(
                options = tzOptions,
                selectedValue = draft.timezone,
                onSelect = { onDraftChange(draft.copy(timezone = it)) },
                label = stringResource(R.string.translation_quietHours_form_timezone),
                modifier = Modifier.fillMaxWidth(),
            )

            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                FieldLabelText(stringResource(R.string.translation_quietHours_form_weekdays))
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    val labels = weekdayLabelResIds()
                    WEEKDAY_BITS.forEachIndexed { index, bit ->
                        SelectableChip(
                            label = stringResource(labels[index]),
                            selected = windowDayActive(draft.weekdays, bit),
                            accent = MaterialTheme.colorScheme.primary,
                            onToggle = { onDraftChange(draft.toggleWeekday(bit)) },
                        )
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                FieldLabelText(stringResource(R.string.translation_quietHours_form_bypass))
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    SEVERITY_CHOICES.forEach { severity ->
                        SelectableChip(
                            label = stringResource(severityLabelRes(severity)),
                            selected = severity.value in draft.bypassSeverities,
                            accent = TeslaTokens.status.warning,
                            onToggle = { onDraftChange(draft.toggleSeverity(severity.value)) },
                        )
                    }
                }
            }

            if (validationError != null) {
                ErrorText(stringResource(validationMessageRes(validationError)))
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Spacer(Modifier.weight(1f))
                Button(
                    label = stringResource(R.string.translation_quietHours_form_cancel),
                    onClick = onCancel,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                )
                Button(
                    label =
                        stringResource(
                            if (isEdit) {
                                R.string.translation_quietHours_form_update
                            } else {
                                R.string.translation_quietHours_form_create
                            },
                        ),
                    onClick = onSubmit,
                    variant = ButtonVariant.Primary,
                    size = ButtonSize.Sm,
                    loading = saving,
                    leadingIcon = TeslaGlyphs.Check,
                )
            }
        }
    }
}

// ── Chips ────────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun SelectableChip(
    label: String,
    selected: Boolean,
    accent: Color,
    onToggle: () -> Unit,
) {
    Surface(
        modifier =
            Modifier
                .clip(RoundedCornerShape(Radius.md))
                .toggleable(value = selected, role = Role.Checkbox, onValueChange = { onToggle() }),
        color = chipBackground(selected, accent),
        contentColor = chipForeground(selected, accent),
        shape = RoundedCornerShape(Radius.md),
        border = BorderStroke(1.dp, chipBorder(selected, accent)),
    ) {
        ChipLabel(label, chipForeground(selected, accent))
    }
}

@Composable
private fun DayPill(
    label: String,
    on: Boolean,
) {
    val accent = MaterialTheme.colorScheme.primary
    Surface(
        color = chipBackground(on, accent),
        contentColor = chipForeground(on, accent),
        shape = RoundedCornerShape(Radius.md),
        border = BorderStroke(1.dp, chipBorder(on, accent)),
    ) {
        ChipLabel(label, chipForeground(on, accent))
    }
}

@Composable
private fun ChipLabel(
    label: String,
    color: Color,
) {
    Text(
        text = label,
        modifier = Modifier.padding(horizontal = Spacing.sm, vertical = CHIP_V_PADDING),
        style = MaterialTheme.typography.labelMedium,
        color = color,
    )
}

@Composable
private fun chipBackground(
    selected: Boolean,
    accent: Color,
): Color = if (selected) accent.copy(alpha = CHIP_SELECTED_BG_ALPHA) else MaterialTheme.colorScheme.surfaceVariant

@Composable
private fun chipForeground(
    selected: Boolean,
    accent: Color,
): Color = if (selected) accent else MaterialTheme.colorScheme.onSurfaceVariant

@Composable
private fun chipBorder(
    selected: Boolean,
    accent: Color,
): Color =
    if (selected) {
        accent.copy(alpha = CHIP_SELECTED_RING_ALPHA)
    } else {
        MaterialTheme.colorScheme.outline.copy(alpha = CHIP_BORDER_ALPHA)
    }

// ── Freshness chip ───────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun FreshnessChip(state: UiState<*>) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
        )
    }
}

// ── Toast presentation ───────────────────────────────────────────────────────────────────────────────────

/** Localized strings the toast presenter folds a [QuietHoursToast] into a [ToastItem] with. */
private data class QuietHoursToastStrings(
    val created: String,
    val updated: String,
    val saveFailed: String,
    val deleted: String,
    val deleteFailed: String,
) {
    fun toItem(
        toast: QuietHoursToast,
        id: Long,
    ): ToastItem =
        when (toast) {
            QuietHoursToast.Created -> ToastItem(id, created, Tone.Success)
            QuietHoursToast.Updated -> ToastItem(id, updated, Tone.Success)
            QuietHoursToast.SaveFailed -> ToastItem(id, saveFailed, Tone.Danger)
            QuietHoursToast.Deleted -> ToastItem(id, deleted, Tone.Success)
            QuietHoursToast.DeleteFailed -> ToastItem(id, deleteFailed, Tone.Danger)
        }
}

@Composable
private fun rememberQuietHoursToastStrings(): QuietHoursToastStrings =
    QuietHoursToastStrings(
        created = stringResource(R.string.translation_toast_quietHours_created),
        updated = stringResource(R.string.translation_toast_quietHours_updated),
        saveFailed = stringResource(R.string.translation_toast_quietHours_saveError),
        deleted = stringResource(R.string.translation_toast_quietHours_deleted),
        deleteFailed = stringResource(R.string.translation_toast_quietHours_deleteError),
    )

/** Collects the view-model's [QuietHoursToast] stream into the bottom [ToastHost] queue, auto-dismissing each. */
@Composable
private fun QuietHoursToastPresenter(
    viewModel: QuietHoursPanelViewModel,
    queue: SnapshotStateList<ToastItem>,
) {
    val strings = rememberQuietHoursToastStrings()
    val scope = rememberCoroutineScope()
    var nextId by remember { mutableLongStateOf(0L) }
    LaunchedEffect(viewModel, strings) {
        viewModel.toasts.collect { toast ->
            val item = strings.toItem(toast, nextId++)
            if (queue.size >= MAX_TOASTS) queue.removeAt(0)
            queue.add(item)
            scope.launch {
                delay(TOAST_DURATION_MS)
                queue.removeAll { it.id == item.id }
            }
        }
    }
}

// ── Pure render helpers ──────────────────────────────────────────────────────────────────────────────────

private fun windowDayActive(
    weekdays: Int,
    bit: Int,
): Boolean = weekdays and bit != 0

private fun resolveDefaultTimezone(): String = runCatching { ZoneId.systemDefault().id }.getOrDefault("UTC")

private fun weekdayLabelResIds(): List<Int> =
    listOf(
        R.string.translation_quietHours_weekday_sun,
        R.string.translation_quietHours_weekday_mon,
        R.string.translation_quietHours_weekday_tue,
        R.string.translation_quietHours_weekday_wed,
        R.string.translation_quietHours_weekday_thu,
        R.string.translation_quietHours_weekday_fri,
        R.string.translation_quietHours_weekday_sat,
    )

private fun severityLabelRes(severity: BypassSeverity): Int =
    when (severity) {
        BypassSeverity.Critical -> R.string.translation_quietHours_severity_critical
        BypassSeverity.Warn -> R.string.translation_quietHours_severity_warn
        BypassSeverity.Info -> R.string.translation_quietHours_severity_info
    }

private fun validationMessageRes(error: QuietHoursValidationError): Int =
    when (error) {
        QuietHoursValidationError.StartInvalid -> R.string.translation_quietHours_error_startInvalid
        QuietHoursValidationError.EndInvalid -> R.string.translation_quietHours_error_endInvalid
        QuietHoursValidationError.EndEqual -> R.string.translation_quietHours_error_endEqual
        QuietHoursValidationError.TimezoneRequired -> R.string.translation_quietHours_error_timezoneRequired
        QuietHoursValidationError.WeekdaysRequired -> R.string.translation_quietHours_error_weekdaysRequired
    }

@Composable
private fun severityLabel(value: String): String =
    when (value) {
        BypassSeverity.Critical.value -> stringResource(R.string.translation_quietHours_severity_critical)
        BypassSeverity.Warn.value -> stringResource(R.string.translation_quietHours_severity_warn)
        BypassSeverity.Info.value -> stringResource(R.string.translation_quietHours_severity_info)
        else -> value
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ───────────────────────────

private fun previewWindows(): List<QuietHoursWindow> =
    listOf(
        QuietHoursWindow(
            id = 1,
            enabled = true,
            startLocal = "23:00",
            endLocal = "07:00",
            timezone = "Europe/London",
            weekdays = ALL_WEEKDAYS,
            bypassSeverities = listOf("critical"),
        ),
        QuietHoursWindow(
            id = 2,
            enabled = false,
            startLocal = "12:00",
            endLocal = "13:00",
            timezone = "America/New_York",
            weekdays = 62,
            bypassSeverities = emptyList(),
        ),
    )

@Preview(showBackground = true)
@Composable
private fun QuietHoursPanelContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QuietHoursPanelContent(
            windowsState = UiState(UiPhase.Content, previewWindows()),
            draft = null,
            validationError = null,
            saving = false,
            deletingIds = emptySet(),
            onAddClick = {},
            onEdit = {},
            onDelete = {},
            onDraftChange = {},
            onCancel = {},
            onSubmit = {},
            onRetry = {},
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun QuietHoursPanelFormPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QuietHoursPanelContent(
            windowsState = UiState(UiPhase.Empty, emptyList()),
            draft = makeDraft(defaultTimezone = "Europe/London"),
            validationError = QuietHoursValidationError.EndEqual,
            saving = false,
            deletingIds = emptySet(),
            onAddClick = {},
            onEdit = {},
            onDelete = {},
            onDraftChange = {},
            onCancel = {},
            onSubmit = {},
            onRetry = {},
        )
    }
}
