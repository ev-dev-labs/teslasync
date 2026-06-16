// The native Jetpack Compose + Material 3 AlertStudioPage notifications surface — a parity port of
// web/src/features/notifications/pages/AlertStudioPage.tsx, the typed alert-rule editor. It reproduces the
// page's eight panels (the templates panel + per-template card, the rule-list panel + per-rule row, the rule
// editor, its allowed-operators + any-change sub-panels, and the test-channels panel), every data state
// (loading skeleton / empty / error-retry / content for the rule list, plus the channels panel's own state
// matrix), and every visible string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [AlertStudioPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the four feeds + the interaction snapshot);
// [AlertStudioPageContent] is the stateless render layer. The rule editor lives in the sibling
// AlertStudioEditorPanel.kt (same package) to keep each file focused.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications)
// diverges from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7
// pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.notifications.alertstudio

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.ChipSize
import io.teslasync.android.components.datadisplay.SeverityBadge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.forms.SearchInput
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.ComputedMetricSummary
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade). */
private const val FADE_STEP_MS = 60

/** The minimum rule count before the rule-list search field appears (web `rulesList.length > 3`). */
private const val SEARCH_THRESHOLD = 3

/** The page's interaction callbacks, wired to the [AlertStudioPageViewModel] (web event handlers). */
@Suppress("LongParameterList")
data class AlertStudioActions(
    val onUpdateEditor: ((AlertStudioEditor) -> AlertStudioEditor) -> Unit,
    val onSelectRule: (AlertRule) -> Unit,
    val onNewRule: () -> Unit,
    val onCloneTemplate: (RuleTemplate) -> Unit,
    val onToggleTemplates: () -> Unit,
    val onRuleSearch: (String) -> Unit,
    val onTemplateSearch: (String) -> Unit,
    val onTemplateCategory: (String?) -> Unit,
    val onToggleBulk: (Long, Boolean) -> Unit,
    val onClearBulk: () -> Unit,
    val onBulkEnable: () -> Unit,
    val onBulkDisable: () -> Unit,
    val onSetSnoozeTarget: (Long?) -> Unit,
    val onToggleTestChannel: (Long, List<Long>) -> Unit,
    val onSave: () -> Unit,
    val onDelete: (Long) -> Unit,
    val onToggleEnabled: (Long, Boolean) -> Unit,
    val onTest: (String) -> Unit,
    val onSnooze: (Long, Int) -> Unit,
    val onCancelSnooze: (Long) -> Unit,
    val onRetryRules: () -> Unit,
    val onRetryChannels: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [AlertStudioPageViewModel] over the supplied [source] (the host wires the
 * shared Notifications + Vehicles repositories via [alertStudioPageSourceOf]). [logger] defaults to the app's
 * redacting logger.
 */
@Composable
fun AlertStudioPage(
    source: AlertStudioPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: AlertStudioPageViewModel =
        viewModel(
            key = AlertStudioPageRegistration.SLUG,
            factory = viewModelFactory { initializer { AlertStudioPageViewModel(source, logger) } },
        )
    AlertStudioPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feeds + interaction snapshot to the stateless content. */
@Composable
fun AlertStudioPage(
    viewModel: AlertStudioPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val rulesState by viewModel.rulesState.collectAsStateWithLifecycle()
    val metricsState by viewModel.metricsState.collectAsStateWithLifecycle()
    val channelsState by viewModel.channelsState.collectAsStateWithLifecycle()
    val vehiclesState by viewModel.vehiclesState.collectAsStateWithLifecycle()
    val saving by viewModel.isSaving.collectAsStateWithLifecycle()

    val actions =
        remember(viewModel) {
            AlertStudioActions(
                onUpdateEditor = viewModel::updateEditor,
                onSelectRule = viewModel::selectRule,
                onNewRule = viewModel::newRule,
                onCloneTemplate = viewModel::cloneTemplate,
                onToggleTemplates = viewModel::toggleTemplates,
                onRuleSearch = viewModel::setRuleSearch,
                onTemplateSearch = viewModel::setTemplateSearch,
                onTemplateCategory = viewModel::setTemplateCategory,
                onToggleBulk = viewModel::toggleBulkSelected,
                onClearBulk = viewModel::clearBulk,
                onBulkEnable = viewModel::bulkEnable,
                onBulkDisable = viewModel::bulkDisable,
                onSetSnoozeTarget = viewModel::setSnoozeTarget,
                onToggleTestChannel = viewModel::toggleTestChannel,
                onSave = viewModel::save,
                onDelete = viewModel::delete,
                onToggleEnabled = viewModel::toggleEnabled,
                onTest = viewModel::test,
                onSnooze = viewModel::snooze,
                onCancelSnooze = viewModel::cancelSnooze,
                onRetryRules = viewModel::retryRules,
                onRetryChannels = viewModel::retryChannels,
            )
        }

    AlertStudioPageContent(
        interaction = interaction,
        rulesState = rulesState,
        metricsState = metricsState,
        channelsState = channelsState,
        vehiclesState = vehiclesState,
        saving = saving,
        actions = actions,
        modifier = modifier,
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body. A still-loading rule feed (with nothing cached) renders the full-page skeleton (web
 * `loading`); otherwise the header + actions are drawn, then the optional templates panel, the rule-list panel
 * (with its own empty / error / content matrix) and the rule editor, plus the snooze dialog overlay.
 */
@Composable
fun AlertStudioPageContent(
    interaction: AlertStudioInteraction,
    rulesState: UiState<List<AlertRule>>,
    metricsState: UiState<List<ComputedMetricSummary>>,
    channelsState: UiState<List<NotificationChannel>>,
    vehiclesState: UiState<List<Vehicle>>,
    saving: Boolean,
    actions: AlertStudioActions,
    modifier: Modifier = Modifier,
) {
    if (rulesState.isLoading) {
        AlertStudioLoading(modifier)
        return
    }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        AlertStudioHeader(
            showTemplates = interaction.showTemplates,
            onToggleTemplates = actions.onToggleTemplates,
            onNewRule = actions.onNewRule,
        )

        if (interaction.showTemplates) {
            FadeIn {
                TemplatesPanel(interaction = interaction, actions = actions)
            }
        }

        FadeIn(delayMs = FADE_STEP_MS) {
            RulesListPanel(interaction = interaction, rulesState = rulesState, actions = actions)
        }

        FadeIn(delayMs = FADE_STEP_MS * 2) {
            RuleEditorPanel(
                interaction = interaction,
                metricsState = metricsState,
                channelsState = channelsState,
                vehiclesState = vehiclesState,
                saving = saving,
                actions = actions,
            )
        }
    }

    val snoozeTarget = rulesState.data.orEmpty().firstOrNull { it.id == interaction.snoozeTargetId }
    if (snoozeTarget != null) {
        SnoozeDialog(rule = snoozeTarget, actions = actions)
    }
}

/** The page header — the title + muted subtitle + the Templates / New Rule actions (web `PageContainer`). */
@Composable
private fun AlertStudioHeader(
    showTemplates: Boolean,
    onToggleTemplates: () -> Unit,
    onNewRule: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_notifications_alertStudio_title))
        BodyText(
            stringResource(R.string.translation_notifications_alertStudio_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Button(
                label = stringResource(R.string.translation_notifications_alertStudio_actions_templates),
                onClick = onToggleTemplates,
                variant = if (showTemplates) ButtonVariant.Secondary else ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
            Button(
                label = stringResource(R.string.translation_notifications_alertStudio_actions_newRule),
                onClick = onNewRule,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
            )
        }
    }
}

// ── GlassPanel 1 + 2: templates ───────────────────────────────────────────────────────────────────────────

/**
 * GlassPanel 1 — the rule-templates panel (web `showTemplates` block): the header with the template count, the
 * search field, the category chips and the template grid (each card is GlassPanel 2), with a no-matches empty
 * state when the search excludes everything.
 */
@Composable
private fun TemplatesPanel(
    interaction: AlertStudioInteraction,
    actions: AlertStudioActions,
) {
    val filtered =
        remember(interaction.templateSearch, interaction.templateCategory) {
            filterTemplates(ruleTemplates, interaction.templateSearch, interaction.templateCategory)
        }
    GlassPanel(padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PanelTitle(
                stringResource(
                    R.string.translation_notifications_alertStudio_templates_header,
                    ruleTemplates.size.toString(),
                ),
            )
            SearchInput(
                value = interaction.templateSearch,
                onValueChange = actions.onTemplateSearch,
                hint = stringResource(R.string.translation_notifications_alertStudio_templates_searchPlaceholder), // parity:allow web i18n key name, not a stub marker
                modifier = Modifier.fillMaxWidth(),
            )
            TemplateCategoryChips(selected = interaction.templateCategory, onSelect = actions.onTemplateCategory)
            if (filtered.isEmpty()) {
                EmptyState(
                    title = stringResource(R.string.translation_notifications_alertStudio_templates_noMatchesTitle),
                    message = stringResource(R.string.translation_notifications_alertStudio_templates_noMatches),
                )
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    filtered.forEach { tpl -> TemplateCard(template = tpl, onUse = { actions.onCloneTemplate(tpl) }) }
                }
            }
        }
    }
}

/** The "All" chip + one chip per template category (web category filter row). */
@Composable
private fun TemplateCategoryChips(
    selected: String?,
    onSelect: (String?) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Button(
            label = stringResource(R.string.translation_notifications_alertStudio_templates_allCategory),
            onClick = { onSelect(null) },
            variant = if (selected == null) ButtonVariant.Secondary else ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
        templateCategories.forEach { category ->
            Button(
                label = category,
                onClick = { onSelect(if (category == selected) null else category) },
                variant = if (category == selected) ButtonVariant.Secondary else ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

/** GlassPanel 2 — one clickable template card (web template tile): name, message, severity badge + Use hint. */
@Composable
private fun TemplateCard(
    template: RuleTemplate,
    onUse: () -> Unit,
) {
    GlassPanel(padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            BodyText(template.name)
            HelperText(template.message)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SeverityBadge(
                    severity = template.severity,
                    showIcon = false,
                    size = ChipSize.Sm,
                    label = severityLabel(template.severity),
                )
                Button(
                    label = stringResource(R.string.translation_notifications_alertStudio_templates_use),
                    onClick = onUse,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                )
            }
        }
    }
}

// ── GlassPanel 3 + 4: the rule list ───────────────────────────────────────────────────────────────────────

/**
 * GlassPanel 3 — the rule-list panel (web left column): the title + count, the search field (once there are
 * more than three rules), the empty / no-matches / error / content states, the bulk-actions toolbar and the
 * per-rule rows (each is GlassPanel 4).
 */
@Composable
private fun RulesListPanel(
    interaction: AlertStudioInteraction,
    rulesState: UiState<List<AlertRule>>,
    actions: AlertStudioActions,
) {
    val rules = rulesState.data.orEmpty()
    val filtered = remember(rules, interaction.ruleSearch) { filterRules(rules, interaction.ruleSearch) }
    GlassPanel(padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PanelTitle(stringResource(R.string.translation_notifications_alertStudio_rules_title))
                Caption(rulesCountLabel(filtered.size))
            }

            if (rules.size > SEARCH_THRESHOLD) {
                SearchInput(
                    value = interaction.ruleSearch,
                    onValueChange = actions.onRuleSearch,
                    hint = stringResource(R.string.translation_notifications_alertStudio_rules_searchPlaceholder), // parity:allow web i18n key name, not a stub marker
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            BulkActionsRow(interaction = interaction, actions = actions)

            when {
                rulesState.isError ->
                    ErrorDisplay(
                        message = stringResource(R.string.translation_error_serverError_message),
                        title = stringResource(R.string.translation_error_serverError_title),
                        onRetry = actions.onRetryRules,
                        retryLabel = stringResource(R.string.translation_common_retry),
                    )

                rules.isEmpty() ->
                    EmptyState(
                        title = stringResource(R.string.translation_notifications_alertStudio_rules_emptyTitle),
                        message = stringResource(R.string.translation_notifications_alertStudio_rules_emptyDescription),
                    )

                filtered.isEmpty() ->
                    EmptyState(
                        title = stringResource(R.string.translation_notifications_alertStudio_rules_noMatchesTitle),
                        message =
                            stringResource(
                                R.string.translation_notifications_alertStudio_rules_noMatches,
                                interaction.ruleSearch,
                            ),
                    )

                else ->
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        filtered.forEach { rule ->
                            RuleRow(
                                rule = rule,
                                selected = rule.id == interaction.selectedRuleId,
                                checked = rule.id in interaction.bulkSelected,
                                actions = actions,
                            )
                        }
                    }
            }
        }
    }
}

/** The bulk-actions toolbar shown while one or more rules are selected (web `BulkActionsToolbar`). */
@Composable
private fun BulkActionsRow(
    interaction: AlertStudioInteraction,
    actions: AlertStudioActions,
) {
    if (interaction.bulkSelected.isEmpty()) return
    val count = interaction.bulkSelected.size
    val noun =
        if (count == 1) {
            stringResource(R.string.translation_bulk_noun_rule_one)
        } else {
            stringResource(R.string.translation_bulk_noun_rule_other)
        }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption("$count $noun")
        Button(
            label = stringResource(R.string.translation_bulk_actions_enable),
            onClick = actions.onBulkEnable,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
        )
        Button(
            label = stringResource(R.string.translation_bulk_actions_disable),
            onClick = actions.onBulkDisable,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
        )
        Button(
            label = stringResource(R.string.translation_common_cancel),
            onClick = actions.onClearBulk,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
    }
}

/**
 * GlassPanel 4 — one alert-rule row (web rule list item): the bulk checkbox, the name + once/snooze badges, the
 * signal/operator caption, and the snooze / enable-disable / delete actions (the delete behind a confirm).
 */
@Composable
private fun RuleRow(
    rule: AlertRule,
    selected: Boolean,
    checked: Boolean,
    actions: AlertStudioActions,
) {
    val formatInstant = rememberInstantFormatter()
    val untitled = stringResource(R.string.translation_notifications_alertStudio_rules_untitled)
    val displayName = rule.name.ifBlank { untitled }
    val snoozed = isSnoozeActive(rule.snoozedUntil, System.currentTimeMillis())
    val once = normalizeTriggerMode(rule.triggerMode) == TriggerMode.Once
    val accent = if (selected) PanelAccent.Primary else PanelAccent.None
    GlassPanel(padding = PanelPadding.Md, accent = accent) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                val selectRowLabel = stringResource(R.string.translation_notifications_alertStudio_rules_selectRow, displayName)
                Checkbox(
                    checked = checked,
                    onCheckedChange = { actions.onToggleBulk(rule.id, it) },
                    modifier = Modifier.semantics { contentDescription = selectRowLabel },
                )
                BodyText(displayName, modifier = Modifier.weight(1f), maxLines = 1)
                if (once) {
                    val onceHint = stringResource(R.string.translation_notifications_alertStudio_rules_onceModeHint)
                    Badge(
                        text = stringResource(R.string.translation_notifications_alertStudio_rules_onceMode),
                        variant = BadgeVariant.Info,
                        modifier = Modifier.semantics { contentDescription = onceHint },
                    )
                }
                if (snoozed && rule.snoozedUntil != null) {
                    Badge(
                        text =
                            stringResource(
                                R.string.translation_notifications_alertStudio_snooze_badge,
                                formatInstant(rule.snoozedUntil ?: ""),
                            ),
                        variant = BadgeVariant.Warning,
                    )
                }
            }
            Caption("${rule.signalName} ${rule.op}".trim())
            RuleRowActions(rule = rule, snoozed = snoozed, displayName = displayName, actions = actions)
        }
    }
}

/** The snooze / enable-disable / delete action row for a single rule (web row action buttons). */
@Composable
private fun RuleRowActions(
    rule: AlertRule,
    snoozed: Boolean,
    displayName: String,
    actions: AlertStudioActions,
) {
    var confirmingDelete by remember { mutableStateOf(false) }
    val snoozeLabel =
        if (snoozed) {
            stringResource(R.string.translation_notifications_alertStudio_snooze_manage)
        } else {
            stringResource(R.string.translation_notifications_alertStudio_snooze_button)
        }
    val toggleLabel =
        if (rule.enabled) {
            stringResource(R.string.translation_notifications_alertStudio_rules_disable)
        } else {
            stringResource(R.string.translation_notifications_alertStudio_rules_enable)
        }
    val toggleDesc =
        if (rule.enabled) {
            stringResource(R.string.translation_notifications_alertStudio_rules_disableRule)
        } else {
            stringResource(R.string.translation_notifications_alertStudio_rules_enableRule)
        }
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Button(label = snoozeLabel, onClick = { actions.onSetSnoozeTarget(rule.id) }, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
        Button(
            label = toggleLabel,
            onClick = { actions.onToggleEnabled(rule.id, !rule.enabled) },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            modifier = Modifier.semantics { contentDescription = toggleDesc },
        )
        Button(
            label = stringResource(R.string.translation_notifications_alertStudio_rules_deleteRule),
            onClick = { confirmingDelete = true },
            variant = ButtonVariant.Danger,
            size = ButtonSize.Sm,
        )
    }
    if (confirmingDelete) {
        ConfirmDialog(
            title = stringResource(R.string.translation_notifications_alertStudio_rules_confirmDeleteTitle),
            message = stringResource(R.string.translation_notifications_alertStudio_rules_confirmDelete, displayName),
            confirmLabel = stringResource(R.string.translation_common_delete),
            cancelLabel = stringResource(R.string.translation_common_cancel),
            onConfirm = {
                confirmingDelete = false
                actions.onDelete(rule.id)
            },
            onCancel = { confirmingDelete = false },
        )
    }
}

// ── Snooze dialog ─────────────────────────────────────────────────────────────────────────────────────────

/** The snooze dialog (web `Modal`): a description, the current-snooze banner, the duration buttons + cancel. */
@Composable
private fun SnoozeDialog(
    rule: AlertRule,
    actions: AlertStudioActions,
) {
    val formatInstant = rememberInstantFormatter()
    val untitled = stringResource(R.string.translation_notifications_alertStudio_rules_untitled)
    val active = isSnoozeActive(rule.snoozedUntil, System.currentTimeMillis())
    Modal(
        onDismissRequest = { actions.onSetSnoozeTarget(null) },
        title = stringResource(R.string.translation_notifications_alertStudio_snooze_title, rule.name.ifBlank { untitled }),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            BodyText(stringResource(R.string.translation_notifications_alertStudio_snooze_description))
            if (active && rule.snoozedUntil != null) {
                HelperText(
                    stringResource(
                        R.string.translation_notifications_alertStudio_snooze_currentlySnoozed,
                        formatInstant(rule.snoozedUntil ?: ""),
                    ),
                )
            }
            Button(
                label = stringResource(R.string.translation_notifications_alertStudio_snooze_1h),
                onClick = { actions.onSnooze(rule.id, SNOOZE_1H) },
                variant = ButtonVariant.Secondary,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                label = stringResource(R.string.translation_notifications_alertStudio_snooze_4h),
                onClick = { actions.onSnooze(rule.id, SNOOZE_4H) },
                variant = ButtonVariant.Secondary,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                label = stringResource(R.string.translation_notifications_alertStudio_snooze_24h),
                onClick = { actions.onSnooze(rule.id, SNOOZE_24H) },
                variant = ButtonVariant.Secondary,
                modifier = Modifier.fillMaxWidth(),
            )
            if (active) {
                Button(
                    label = stringResource(R.string.translation_notifications_alertStudio_snooze_cancel),
                    onClick = { actions.onCancelSnooze(rule.id) },
                    variant = ButtonVariant.Ghost,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

// ── Loading skeleton ──────────────────────────────────────────────────────────────────────────────────────

/** The full-page loading skeleton (web `loading`): the header + the two stacked panel blocks. */
@Composable
private fun AlertStudioLoading(modifier: Modifier = Modifier) {
    FadeIn {
        Column(
            modifier =
                modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            Skeleton(widthFraction = 0.6f, height = 28.dp)
            Skeleton(widthFraction = 0.9f, height = 14.dp)
            Skeleton(height = 200.dp, rounded = true)
            Skeleton(height = 320.dp, rounded = true)
        }
    }
}

// ── Shared display helpers ────────────────────────────────────────────────────────────────────────────────

/** The localized rule-count label (web `rulesCountLabel`): the singular for one, the templated plural else. */
@Composable
internal fun rulesCountLabel(count: Int): String =
    if (count == 1) {
        stringResource(R.string.translation_notifications_alertStudio_rules_countOne)
    } else {
        stringResource(R.string.translation_notifications_alertStudio_rules_countMany, count.toString())
    }

/** The localized severity label for a severity id (web `notifications.alertStudio.severity.*`). */
@Composable
internal fun severityLabel(severity: String): String =
    when (normalizeSeverity(severity)) {
        "info" -> stringResource(R.string.translation_notifications_alertStudio_severity_info)
        "critical" -> stringResource(R.string.translation_notifications_alertStudio_severity_critical)
        else -> stringResource(R.string.translation_notifications_alertStudio_severity_warn)
    }

/** The localized signal value-type label (web `signalTypeLabels`). */
@Composable
internal fun signalTypeLabel(type: SignalValueType): String =
    when (type) {
        SignalValueType.Numeric -> stringResource(R.string.translation_notifications_alertStudio_signalTypes_numeric)
        SignalValueType.Text -> stringResource(R.string.translation_notifications_alertStudio_signalTypes_text)
        SignalValueType.Bool -> stringResource(R.string.translation_notifications_alertStudio_signalTypes_bool)
    }

/**
 * Builds a device-locale instant formatter that renders an ISO-8601 timestamp as a localized date-time,
 * falling back to the raw string when it cannot be parsed — the native analogue of the web `formatDateTime`.
 */
@Composable
internal fun rememberInstantFormatter(): (String) -> String {
    val locale: Locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
    val zone: ZoneId = ZoneId.systemDefault()
    return remember(locale, zone) {
        val formatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale).withZone(zone)
        val format: (String) -> String = { iso ->
            runCatching { formatter.format(Instant.parse(iso)) }.getOrDefault(iso)
        }
        format
    }
}

/** Snooze durations in minutes (web `handleSnooze(id, 60 | 240 | 1440)`). */
private const val SNOOZE_1H = 60
private const val SNOOZE_4H = 240
private const val SNOOZE_24H = 1440
