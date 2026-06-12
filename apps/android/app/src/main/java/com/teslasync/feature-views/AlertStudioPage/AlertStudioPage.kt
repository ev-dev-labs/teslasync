// The native Jetpack Compose + Material 3 AlertStudioPage feature view — a parity port of
// web/src/features/notifications/pages/AlertStudioPage.tsx, the typed alert-rule editor. It reproduces the
// web composition end to end: the page header (title + subtitle + Templates / New Rule actions), the
// collapsible template gallery (search + category chips + cards), the two-pane body (the saved-rules list
// with bulk actions on the left, the rich rule editor on the right), the test-delivery panel, and the snooze
// / delete / discard dialogs. Every read feed (rules / channels / metrics / vehicles) is bound through the
// shared P1/S8 state-holder layer as a [UiState], so the surface renders every lifecycle state the layer can
// carry — loading, hard error with retry, empty, content, and stale/offline ("last known") — without ever
// performing HTTP itself.
//
// Composition: [AlertStudioPage] is the stateful entry (collects the feeds + interaction snapshot, records
// the one-shot `view.opened` diagnostic, and resolves strings); [AlertStudioPageContent] is the stateless
// renderer that is the unit/UI-test entry point. All editor + validation + projection logic lives in the
// framework-free model (AlertStudioPageModel.kt); this file is a thin render layer. Every chrome string
// resolves through the i18n facade (the [StringResolver] seam) and every interactive control carries an
// accessible name.
//
// AI panels (web `AINLAlertBuilder` / `AIAlertTuningSuggestions` / `AICrossRuleConflictDetection`) are
// `@/components/ai/*` ATOMIC shared components — out of scope here (the P3 component-library bundle) and
// gated OFF in the canonical baseline (`ai_mode === 'off'`, where the web `withAiFeature` HOC renders
// nothing). This port reproduces that canonical baseline — the manual editor the web itself calls "the
// canonical baseline in off mode" — and exposes the selected-vehicle id the AI slots would consume once the
// shared AI components ship.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AlertStudioPage) cannot form a valid Kotlin package identifier.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "TooManyFunctions", "LargeClass")

package io.teslasync.android.featureviews.alertstudiopage

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.forms.SearchInput
import io.teslasync.android.components.forms.VehicleMultiSelect
import io.teslasync.android.components.forms.VehicleOption
import io.teslasync.android.components.forms.VehicleSelection
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelpIcon
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.ComputedMetricSummary
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

// ── i18n facade (web `t(key, fallback)`) ─────────────────────────────────────────────────────────────────

/**
 * By-name resolver against the generated catalog, falling back to the web English when a key is absent
 * (web `t(key, default)`). Remembered against the context so a locale change re-resolves the surface.
 */
@Composable
private fun rememberStringResolver(): StringResolver {
    val context = LocalContext.current
    return remember(context) {
        { key: String, fallback: String -> context.optionalString(foldCatalogKey(key)) ?: fallback }
    }
}

@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id).takeIf { it.isNotBlank() } else null
}

// ── Localized label helpers (web `getTemplateName`, `signalTypeLabels`, …) ───────────────────────────────

private fun templateName(
    template: RuleTemplate,
    resolve: StringResolver,
): String = resolve("notifications.alertStudio.templates.${templateKey(template.name)}.name", template.name)

private fun templateMessage(
    template: RuleTemplate,
    resolve: StringResolver,
): String = resolve("notifications.alertStudio.templates.${templateKey(template.name)}.message", template.message)

private fun templateCategoryLabel(
    category: String,
    resolve: StringResolver,
): String = resolve("notifications.alertStudio.templateCategories.${templateKey(category)}", category)

private fun signalCategoryLabel(
    category: String,
    resolve: StringResolver,
): String =
    if (category == CUSTOM_SIGNAL_CATEGORY) {
        resolve("notifications.alertStudio.signalCategories.custom", "Custom")
    } else {
        templateCategoryLabel(category, resolve)
    }

private fun signalTypeLabel(
    type: SignalValueType,
    resolve: StringResolver,
): String =
    when (type) {
        SignalValueType.NUMERIC -> resolve("notifications.alertStudio.signalTypes.numeric", "Numeric")
        SignalValueType.TEXT -> resolve("notifications.alertStudio.signalTypes.text", "Text")
        SignalValueType.BOOL -> resolve("notifications.alertStudio.signalTypes.bool", "Boolean")
    }

private fun severityLabel(
    severity: String,
    resolve: StringResolver,
): String =
    when (severity) {
        Severities.INFO -> resolve("notifications.alertStudio.severity.info", "Info")
        Severities.CRITICAL -> resolve("notifications.alertStudio.severity.critical", "Critical")
        else -> resolve("notifications.alertStudio.severity.warn", "Warning")
    }

private fun operatorLabel(
    op: String,
    resolve: StringResolver,
): String = resolve("notifications.alertStudio.operators.$op", op)

@Composable
private fun severityColor(severity: String): Color =
    when (severity) {
        Severities.CRITICAL -> TeslaTokens.status.danger
        Severities.INFO -> TeslaTokens.status.info
        else -> TeslaTokens.status.warning
    }

private fun formatTimestamp(iso: String): String =
    runCatching {
        val instant = Instant.ofEpochMilli(parseIsoMillis(iso) ?: error("unparseable"))
        DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withZone(ZoneId.systemDefault())
            .format(instant)
    }.getOrDefault(iso)

// ── Callback bundle (the web component's many handlers, threaded into the stateless content) ──────────────

/** The interaction callbacks the stateless content invokes — wired from the ViewModel by the stateful entry. */
@Suppress("LongParameterList")
class AlertStudioActions(
    val onToggleTemplates: () -> Unit,
    val onTemplateSearch: (String) -> Unit,
    val onTemplateCategory: (String?) -> Unit,
    val onCloneTemplate: (RuleTemplate) -> Unit,
    val onRuleSearch: (String) -> Unit,
    val onSelectRule: (AlertRule) -> Unit,
    val onNewRule: () -> Unit,
    val onToggleEnabled: (AlertRule) -> Unit,
    val onRequestDelete: (Long) -> Unit,
    val onSetSnoozeTarget: (Long?) -> Unit,
    val onToggleBulk: (Long, Boolean) -> Unit,
    val onClearBulk: () -> Unit,
    val onBulkEnable: (List<Long>) -> Unit,
    val onBulkDisable: (List<Long>) -> Unit,
    val onReconcileBulk: (Set<Long>) -> Unit,
    val onRetry: () -> Unit,
    val editor: EditorActions,
    val onSave: () -> Unit,
    val onDeleteEditor: (Long) -> Unit,
    val onTest: () -> Unit,
    val onConfirmDelete: (Long) -> Unit,
    val onCancelDelete: () -> Unit,
    val onConfirmDiscard: () -> Unit,
    val onCancelDiscard: () -> Unit,
    val onSnooze: (Long, Int) -> Unit,
    val onToggleChannel: (Long, List<Long>) -> Unit,
)

/** The editor-field callbacks (web `setEditor(...)` handlers). */
@Suppress("LongParameterList")
class EditorActions(
    val onName: (String) -> Unit,
    val onEnabled: (Boolean) -> Unit,
    val onVehicleSelection: (EditorVehicleSelection) -> Unit,
    val onSignalChange: (String) -> Unit,
    val onOperatorChange: (String) -> Unit,
    val onSeverity: (String) -> Unit,
    val onValueNum: (String) -> Unit,
    val onValueText: (String) -> Unit,
    val onValueBool: (Boolean) -> Unit,
    val onValueMin: (String) -> Unit,
    val onValueMax: (String) -> Unit,
    val onCooldown: (Int) -> Unit,
    val onTriggerMode: (String) -> Unit,
    val onMaxFires: (String) -> Unit,
    val onEscalationToggle: (Boolean) -> Unit,
    val onEscalationAfter: (String) -> Unit,
    val onEscalationSeverity: (String) -> Unit,
    val onMsgTemplate: (String) -> Unit,
    val onIncludeTitle: (Boolean) -> Unit,
    val onKind: (String) -> Unit,
    val onMetricId: (String) -> Unit,
    val onMetricWindow: (String) -> Unit,
    val onMetricOp: (String) -> Unit,
    val onMetricThreshold: (String) -> Unit,
)

// ── Stateful entry points ─────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [AlertStudioPageViewModel] over the supplied [source] (the host wires the
 * shared stores via [alertStudioSource]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun AlertStudioPage(
    source: AlertStudioSource,
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

    val rulesState by viewModel.rules.collectAsStateWithLifecycle()
    val channelsState by viewModel.channels.collectAsStateWithLifecycle()
    val metricsState by viewModel.metrics.collectAsStateWithLifecycle()
    val vehiclesState by viewModel.vehicles.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()

    val resolve = rememberStringResolver()
    val metricsData = metricsState.data ?: emptyList()
    val allChannelIds = (channelsState.data ?: emptyList()).map { it.id }
    val defaultTestMessage =
        resolve("notifications.alertStudio.test.defaultMessage", "Test notification from Alert Studio")

    val actions =
        remember(viewModel, resolve, metricsData, allChannelIds, defaultTestMessage) {
            buildActions(viewModel, resolve, metricsData, allChannelIds, defaultTestMessage)
        }

    AlertStudioPageContent(
        rulesState = rulesState,
        channelsState = channelsState,
        metricsState = metricsState,
        vehiclesState = vehiclesState,
        interaction = interaction,
        actions = actions,
        resolve = resolve,
        nowMillis = System.currentTimeMillis(),
        modifier = modifier,
    )
}

private fun buildActions(
    vm: AlertStudioPageViewModel,
    resolve: StringResolver,
    metrics: List<ComputedMetricSummary>,
    allChannelIds: List<Long>,
    defaultTestMessage: String,
): AlertStudioActions =
    AlertStudioActions(
        onToggleTemplates = vm::toggleTemplates,
        onTemplateSearch = vm::setTemplateSearch,
        onTemplateCategory = vm::setTemplateCategory,
        onCloneTemplate = { tpl -> vm.cloneTemplate(tpl, templateName(tpl, resolve), templateMessage(tpl, resolve)) },
        onRuleSearch = vm::setRuleSearch,
        onSelectRule = vm::selectRule,
        onNewRule = vm::newRule,
        onToggleEnabled = { rule -> vm.toggleEnabled(rule.id, rule.enabled) },
        onRequestDelete = vm::requestDelete,
        onSetSnoozeTarget = vm::setSnoozeTarget,
        onToggleBulk = vm::toggleBulkSelected,
        onClearBulk = vm::clearBulk,
        onBulkEnable = vm::bulkEnable,
        onBulkDisable = vm::bulkDisable,
        onReconcileBulk = vm::reconcileBulkSelection,
        onRetry = vm::retry,
        editor = buildEditorActions(vm),
        onSave = { vm.save(metrics) },
        onDeleteEditor = vm::delete,
        onTest = { vm.test(defaultTestMessage, allChannelIds) },
        onConfirmDelete = vm::delete,
        onCancelDelete = vm::cancelDelete,
        onConfirmDiscard = vm::confirmDiscard,
        onCancelDiscard = vm::cancelDiscard,
        onSnooze = vm::snooze,
        onToggleChannel = vm::toggleTestChannel,
    )

private fun buildEditorActions(vm: AlertStudioPageViewModel): EditorActions =
    EditorActions(
        onName = vm::setName,
        onEnabled = vm::setEnabled,
        onVehicleSelection = vm::setVehicleSelection,
        onSignalChange = vm::onSignalChange,
        onOperatorChange = vm::onOperatorChange,
        onSeverity = vm::onSeverityChange,
        onValueNum = vm::setValueNum,
        onValueText = vm::setValueText,
        onValueBool = vm::setValueBool,
        onValueMin = vm::setValueMin,
        onValueMax = vm::setValueMax,
        onCooldown = vm::setCooldown,
        onTriggerMode = vm::onTriggerModeChange,
        onMaxFires = vm::setMaxFires,
        onEscalationToggle = vm::onEscalationToggle,
        onEscalationAfter = vm::setEscalationAfter,
        onEscalationSeverity = vm::setEscalationSeverity,
        onMsgTemplate = vm::setMsgTemplate,
        onIncludeTitle = vm::setIncludeTitle,
        onKind = vm::setKind,
        onMetricId = vm::setMetricId,
        onMetricWindow = vm::setMetricWindow,
        onMetricOp = vm::setMetricOp,
        onMetricThreshold = vm::setMetricThreshold,
    )

// ── Stateless content ─────────────────────────────────────────────────────────────────────────────────────

/** The stateless renderer (unit/UI-test entry point). Reproduces every web section + state branch. */
@Composable
fun AlertStudioPageContent(
    rulesState: UiState<List<AlertRule>>,
    channelsState: UiState<List<NotificationChannel>>,
    metricsState: UiState<List<ComputedMetricSummary>>,
    vehiclesState: UiState<List<VehicleRef>>,
    interaction: AlertStudioInteraction,
    actions: AlertStudioActions,
    resolve: StringResolver,
    nowMillis: Long,
    modifier: Modifier = Modifier,
) {
    val rules = rulesState.data ?: emptyList()
    val projection =
        projectRulesList(
            rules = rules,
            search = interaction.ruleSearch,
            isLoading = rulesState.isLoading,
            isError = rulesState.isError,
            stale = rulesState.stale,
            offline = rulesState.isOffline,
            refreshing = rulesState.refreshing,
        )
    LaunchedEffect(projection.rules) {
        actions.onReconcileBulk(projection.rules.map { it.id }.toSet())
    }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        AlertStudioHeader(resolve = resolve, onToggleTemplates = actions.onToggleTemplates, onNewRule = actions.onNewRule)

        if (interaction.showTemplates) {
            FadeIn {
                TemplatesPanel(interaction = interaction, resolve = resolve, actions = actions)
            }
        }

        RulesPanel(
            projection = projection,
            interaction = interaction,
            resolve = resolve,
            nowMillis = nowMillis,
            actions = actions,
        )

        EditorPanel(
            interaction = interaction,
            metricsState = metricsState,
            channelsState = channelsState,
            vehiclesState = vehiclesState,
            resolve = resolve,
            actions = actions,
        )
    }

    SnoozeDialog(interaction = interaction, rules = rules, resolve = resolve, nowMillis = nowMillis, actions = actions)
    DeleteDialog(interaction = interaction, rules = rules, resolve = resolve, actions = actions)
    DiscardDialog(interaction = interaction, resolve = resolve, actions = actions)
}

// ── Header ────────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun AlertStudioHeader(
    resolve: StringResolver,
    onToggleTemplates: () -> Unit,
    onNewRule: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        PageTitle(text = resolve("notifications.alertStudio.title", "Alert Studio"))
        Caption(
            text =
                resolve(
                    "notifications.alertStudio.subtitle",
                    "Create custom rules from Fleet Telemetry signals",
                ),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Button(
                label = resolve("notifications.alertStudio.actions.templates", "Templates"),
                onClick = onToggleTemplates,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = AlertStudioGlyphs.Sparkles,
            )
            Button(
                label = resolve("notifications.alertStudio.actions.newRule", "New Rule"),
                onClick = onNewRule,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                leadingIcon = TeslaGlyphs.Plus,
            )
        }
    }
}

// ── Templates gallery ─────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun TemplatesPanel(
    interaction: AlertStudioInteraction,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    val filtered =
        filterTemplates(
            templates = ruleTemplates,
            category = interaction.templateCategory,
            search = interaction.templateSearch,
            label = { templateName(it, resolve) },
            message = { templateMessage(it, resolve) },
            categoryLabel = { templateCategoryLabel(it, resolve) },
        )
    GlassPanel(padding = PanelPadding.Lg) {
        PanelTitle(
            text =
                resolve.format(
                    "notifications.alertStudio.templates.header",
                    "Rule Templates - %1\$s pre-built rules",
                    ruleTemplates.size,
                ),
        )
        Spacer(Modifier.height(Spacing.sm))
        SearchInput(
            value = interaction.templateSearch,
            onValueChange = actions.onTemplateSearch,
            hint = resolve("notifications.alertStudio.templates.searchPlaceholder", "Search templates..."), // parity:allow i18n key
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(Spacing.sm))
        TemplateCategoryChips(interaction = interaction, resolve = resolve, onTemplateCategory = actions.onTemplateCategory)
        Spacer(Modifier.height(Spacing.md))
        if (filtered.isEmpty()) {
            EmptyState(
                icon = AlertStudioGlyphs.Sparkles,
                title = resolve("notifications.alertStudio.templates.noMatchesTitle", "No templates found"),
                message = resolve("notifications.alertStudio.templates.noMatches", "No templates match your search"),
            )
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                filtered.forEach { template ->
                    TemplateCard(template = template, resolve = resolve, onClick = { actions.onCloneTemplate(template) })
                }
            }
        }
    }
}

@Composable
private fun TemplateCategoryChips(
    interaction: AlertStudioInteraction,
    resolve: StringResolver,
    onTemplateCategory: (String?) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        val allLabel = resolve("notifications.alertStudio.templates.allCategory", "All")
        Button(
            label = "$allLabel (${ruleTemplates.size})",
            onClick = { onTemplateCategory(null) },
            variant = if (interaction.templateCategory == null) ButtonVariant.Secondary else ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
        templateCategories.forEach { category ->
            val count = ruleTemplates.count { it.category == category }
            val selected = interaction.templateCategory == category
            Button(
                label = "${templateCategoryLabel(category, resolve)} ($count)",
                onClick = { onTemplateCategory(if (selected) null else category) },
                variant = if (selected) ButtonVariant.Secondary else ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

@Composable
private fun TemplateCard(
    template: RuleTemplate,
    resolve: StringResolver,
    onClick: () -> Unit,
) {
    GlassPanel(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Spacing.sm))
                .clickable(onClick = onClick),
        padding = PanelPadding.Md,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(
                imageVector = template.glyph.imageVector(),
                contentDescription = null,
                size = IconSize.Sm,
                tint = severityColor(template.severity),
            )
            Subhead(text = templateName(template, resolve), modifier = Modifier.weight(1f))
            Badge(
                text = severityLabel(template.severity, resolve),
                variant = severityBadgeVariant(template.severity),
            )
        }
        Spacer(Modifier.height(Spacing.xs))
        HelperText(text = templateMessage(template, resolve))
        Spacer(Modifier.height(Spacing.xs))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Icon(imageVector = TeslaGlyphs.Copy, contentDescription = null, size = IconSize.Xs)
            Caption(text = resolve("notifications.alertStudio.templates.use", "Use"))
        }
    }
}

private fun severityBadgeVariant(severity: String): BadgeVariant =
    when (severity) {
        Severities.CRITICAL -> BadgeVariant.Danger
        Severities.INFO -> BadgeVariant.Info
        else -> BadgeVariant.Warning
    }

// ── Rules list panel ──────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun RulesPanel(
    projection: RulesListProjection,
    interaction: AlertStudioInteraction,
    resolve: StringResolver,
    nowMillis: Long,
    actions: AlertStudioActions,
) {
    GlassPanel(padding = PanelPadding.Md) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Subhead(text = resolve("notifications.alertStudio.rules.title", "Rules"), modifier = Modifier.weight(1f))
            RulesFreshnessChip(projection = projection, resolve = resolve)
            Caption(text = rulesCountLabel(projection.totalCount, resolve))
        }
        if (projection.showSearch) {
            Spacer(Modifier.height(Spacing.sm))
            SearchInput(
                value = interaction.ruleSearch,
                onValueChange = actions.onRuleSearch,
                hint = resolve("notifications.alertStudio.rules.searchPlaceholder", "Search rules..."), // parity:allow i18n key
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Spacer(Modifier.height(Spacing.sm))
        when (projection.phase) {
            RulesListPhase.LOADING -> RulesSkeleton()
            RulesListPhase.ERROR ->
                ErrorDisplay(
                    message = resolve("common.error", "Something went wrong"),
                    onRetry = actions.onRetry,
                    retryLabel = resolve("common.retry", "Retry"),
                )

            RulesListPhase.EMPTY ->
                EmptyState(
                    icon = AlertStudioGlyphs.Bell,
                    title = resolve("notifications.alertStudio.rules.emptyTitle", "No alert rules yet"),
                    message =
                        resolve(
                            "notifications.alertStudio.rules.emptyDescription",
                            "Create your first rule or pick a template above.",
                        ),
                )

            RulesListPhase.NO_MATCHES ->
                EmptyState(
                    icon = AlertStudioGlyphs.Search,
                    title = resolve("notifications.alertStudio.rules.noMatchesTitle", "No matching rules"),
                    message =
                        resolve.format(
                            "notifications.alertStudio.rules.noMatches",
                            "No rules match \"%1\$s\"",
                            interaction.ruleSearch,
                        ),
                )

            RulesListPhase.CONTENT ->
                RulesContent(
                    projection = projection,
                    interaction = interaction,
                    resolve = resolve,
                    nowMillis = nowMillis,
                    actions = actions,
                )
        }
    }
}

@Composable
private fun RulesFreshnessChip(
    projection: RulesListProjection,
    resolve: StringResolver,
) {
    when {
        projection.offline -> Badge(text = resolve("common.offline", "Offline"), variant = BadgeVariant.Warning, dot = true)
        projection.stale -> Badge(text = resolve("common.stale", "Stale"), variant = BadgeVariant.Neutral, dot = true)
        projection.refreshing ->
            Badge(text = resolve("common.loading", "Loading…"), variant = BadgeVariant.Info, dot = true)
    }
}

@Composable
private fun RulesSkeleton() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        repeat(SKELETON_ROWS) {
            Skeleton(modifier = Modifier.fillMaxWidth(), height = SKELETON_ROW_HEIGHT, rounded = true)
        }
    }
}

private const val SKELETON_ROWS = 3
private val SKELETON_ROW_HEIGHT = 56.dp
private val SKELETON_CHIP_HEIGHT = 32.dp

@Composable
private fun RulesContent(
    projection: RulesListProjection,
    interaction: AlertStudioInteraction,
    resolve: StringResolver,
    nowMillis: Long,
    actions: AlertStudioActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (interaction.bulkSelected.isNotEmpty()) {
            BulkBar(interaction = interaction, resolve = resolve, actions = actions)
        }
        projection.rules.forEach { rule ->
            RuleRow(
                rule = rule,
                selected = interaction.selectedId == rule.id,
                checked = interaction.bulkSelected.contains(rule.id),
                nowMillis = nowMillis,
                resolve = resolve,
                actions = actions,
            )
        }
    }
}

@Composable
private fun BulkBar(
    interaction: AlertStudioInteraction,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    val ids = interaction.bulkSelected.toList()
    GlassPanel(padding = PanelPadding.Sm) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Caption(
                text = resolve.format("bulk.selected", "%1\$s selected", ids.size),
                modifier = Modifier.weight(1f),
            )
            Button(
                label = resolve("bulk.actions.enable", "Enable"),
                onClick = { actions.onBulkEnable(ids) },
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
            )
            Button(
                label = resolve("bulk.actions.disable", "Disable"),
                onClick = { actions.onBulkDisable(ids) },
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
            )
            Button(
                label = resolve("bulk.clear", "Clear"),
                onClick = actions.onClearBulk,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

@Composable
private fun RuleRow(
    rule: AlertRule,
    selected: Boolean,
    checked: Boolean,
    nowMillis: Long,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    val untitled = resolve("notifications.alertStudio.rules.untitled", "Untitled")
    val displayName = rule.name.ifBlank { untitled }
    val snoozed = isSnoozeActive(rule.snoozedUntil, nowMillis)
    val selectRowLabel =
        resolve.format("notifications.alertStudio.rules.selectRow", "Select rule %1\$s", displayName)
    GlassPanel(padding = PanelPadding.Md) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Toggle(
                checked = checked,
                onCheckedChange = { actions.onToggleBulk(rule.id, it) },
                modifier = Modifier.semantics { contentDescription = selectRowLabel },
            )
            Column(
                modifier =
                    Modifier
                        .weight(1f)
                        .clickable { actions.onSelectRule(rule) },
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                RuleRowTitle(rule = rule, displayName = displayName, snoozed = snoozed, resolve = resolve)
                Caption(text = "${rule.signalName} ${rule.op}".trim())
                if (rule.updatedAt.isNotBlank()) {
                    Caption(text = formatTimestamp(rule.updatedAt))
                }
            }
            RuleRowControls(rule = rule, snoozed = snoozed, selected = selected, resolve = resolve, actions = actions)
        }
    }
}

@Composable
private fun RuleRowTitle(
    rule: AlertRule,
    displayName: String,
    snoozed: Boolean,
    resolve: StringResolver,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Icon(
            imageVector = severityGlyphFor(normalizeSeverity(rule.severity)),
            contentDescription = null,
            size = IconSize.Sm,
            tint = severityColor(normalizeSeverity(rule.severity)),
        )
        Subhead(text = displayName, modifier = Modifier.weight(1f, fill = false))
        if (normalizeTriggerMode(rule.triggerMode) == TriggerModes.ONCE) {
            Badge(text = resolve("notifications.alertStudio.rules.onceMode", "Once"), variant = BadgeVariant.Info)
        }
        if (snoozed && rule.snoozedUntil != null) {
            Badge(
                text =
                    resolve.format(
                        "notifications.alertStudio.snooze.badge",
                        "Snoozed until %1\$s",
                        formatTimestamp(rule.snoozedUntil!!),
                    ),
                variant = BadgeVariant.Warning,
            )
        }
    }
}

private fun severityGlyphFor(severity: String) =
    when (severity) {
        Severities.CRITICAL -> TeslaGlyphs.Octagon
        Severities.INFO -> TeslaGlyphs.Info
        else -> TeslaGlyphs.Warning
    }

@Composable
private fun RuleRowControls(
    rule: AlertRule,
    snoozed: Boolean,
    selected: Boolean,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    val neutralTint = LocalContentColor.current
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        val snoozeLabel =
            if (snoozed) {
                resolve("notifications.alertStudio.snooze.manage", "Manage snooze")
            } else {
                resolve("notifications.alertStudio.snooze.button", "Snooze")
            }
        IconButton(
            imageVector = AlertStudioGlyphs.MoonStar,
            contentDescription = snoozeLabel,
            onClick = { actions.onSetSnoozeTarget(rule.id) },
            variant = IconButtonVariant.Standard,
            size = IconSize.Sm,
            tint = if (snoozed) TeslaTokens.status.warning else neutralTint,
        )
        val enabledLabel =
            if (rule.enabled) {
                resolve("notifications.alertStudio.rules.disableRule", "Disable rule")
            } else {
                resolve("notifications.alertStudio.rules.enableRule", "Enable rule")
            }
        IconButton(
            imageVector = if (rule.enabled) AlertStudioGlyphs.Bell else AlertStudioGlyphs.BellOff,
            contentDescription = enabledLabel,
            onClick = { actions.onToggleEnabled(rule) },
            variant = IconButtonVariant.Standard,
            size = IconSize.Sm,
            tint = if (rule.enabled) TeslaTokens.status.success else neutralTint,
        )
        IconButton(
            imageVector = AlertStudioGlyphs.Trash,
            contentDescription = resolve("notifications.alertStudio.rules.deleteRule", "Delete rule"),
            onClick = { actions.onRequestDelete(rule.id) },
            variant = IconButtonVariant.Standard,
            size = IconSize.Sm,
            tint = if (selected) TeslaTokens.status.danger else neutralTint,
        )
    }
}

private fun rulesCountLabel(
    count: Int,
    resolve: StringResolver,
): String =
    if (count == 1) {
        resolve("notifications.alertStudio.rules.countOne", "1 rule")
    } else {
        resolve.format("notifications.alertStudio.rules.countMany", "%1\$s rules", count)
    }

// ── Editor panel ──────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun EditorPanel(
    interaction: AlertStudioInteraction,
    metricsState: UiState<List<ComputedMetricSummary>>,
    channelsState: UiState<List<NotificationChannel>>,
    vehiclesState: UiState<List<VehicleRef>>,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    val editor = interaction.editor
    val metrics = metricsState.data ?: emptyList()
    val saveable = canSave(editor, metrics, interaction.isNewRule)
    GlassPanel(padding = PanelPadding.Md) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(imageVector = TeslaGlyphs.Edit, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.info)
            Subhead(
                text =
                    if (interaction.isEditing) {
                        resolve("notifications.alertStudio.editor.editTitle", "Edit Rule")
                    } else {
                        resolve("notifications.alertStudio.editor.newTitle", "New Rule")
                    },
            )
        }
        Spacer(Modifier.height(Spacing.md))

        if (interaction.validationError) {
            AlertBanner(
                message =
                    resolve(
                        "forms.validationFailed",
                        "Please fix the highlighted fields and try again.",
                    ),
                tone = Tone.Danger,
            )
            Spacer(Modifier.height(Spacing.md))
        }

        EditorIdentitySection(editor = editor, resolve = resolve, actions = actions)
        Spacer(Modifier.height(Spacing.md))
        EditorTargetingSection(
            editor = editor,
            vehiclesState = vehiclesState,
            resolve = resolve,
            actions = actions,
        )
        Spacer(Modifier.height(Spacing.md))

        if (editor.kind == RuleKinds.COMPUTED_METRIC) {
            ComputedMetricEditor(editor = editor, metricsState = metricsState, resolve = resolve, actions = actions)
        } else {
            SignalOperatorSection(editor = editor, resolve = resolve, actions = actions)
        }
        Spacer(Modifier.height(Spacing.md))

        SeveritySection(editor = editor, resolve = resolve, actions = actions)
        if (editor.kind != RuleKinds.COMPUTED_METRIC) {
            Spacer(Modifier.height(Spacing.md))
            TypedValueSection(editor = editor, resolve = resolve, actions = actions)
        }
        Spacer(Modifier.height(Spacing.md))

        BehaviorSection(editor = editor, isNewRule = interaction.isNewRule, resolve = resolve, actions = actions)
        Spacer(Modifier.height(Spacing.md))

        MessageSection(editor = editor, resolve = resolve, actions = actions)
        Spacer(Modifier.height(Spacing.md))

        TestDeliverySection(
            interaction = interaction,
            channelsState = channelsState,
            resolve = resolve,
            actions = actions,
        )
        Spacer(Modifier.height(Spacing.md))

        EditorActionsBar(interaction = interaction, saveable = saveable, resolve = resolve, actions = actions)
    }
}

@Composable
private fun EditorIdentitySection(
    editor: EditorState,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Input(
            value = editor.name,
            onValueChange = actions.editor.onName,
            label = resolve("notifications.alertStudio.editor.nameLabel", "Name"),
            hint = resolve("notifications.alertStudio.editor.namePlaceholder", "My alert rule"), // parity:allow i18n key
            modifier = Modifier.fillMaxWidth(),
        )
        Select(
            options =
                listOf(
                    SelectOption("true", resolve("notifications.alertStudio.editor.enabled", "Enabled")),
                    SelectOption("false", resolve("notifications.alertStudio.editor.disabled", "Disabled")),
                ),
            selectedValue = editor.enabled.toString(),
            onSelect = { actions.editor.onEnabled(it == "true") },
            label = resolve("notifications.alertStudio.editor.enabledLabel", "Status"),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun EditorTargetingSection(
    editor: EditorState,
    vehiclesState: UiState<List<VehicleRef>>,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    val vehicles = vehiclesState.data ?: emptyList()
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            FieldLabel(
                text = resolve("notifications.alertStudio.editor.vehiclesLabel", "Vehicles"),
                helpText =
                    resolve(
                        "help.fields.alertStudio.vehicles",
                        "Choose 'All vehicles' to apply this rule to your entire fleet, including any cars you add later.",
                    ),
            )
            VehicleMultiSelect(
                vehicles = vehicles.map { VehicleOption(it.id, it.displayName) },
                selection = editor.vehicleSelection.toComponentSelection(),
                onSelectionChange = { actions.editor.onVehicleSelection(it.toEditorSelection()) },
                label = null,
                allLabel = resolve("notifications.alertStudio.editor.vehiclesAllOption", "All vehicles"),
                modifier = Modifier.fillMaxWidth(),
            )
            if (editor.vehicleSelection is EditorVehicleSelection.Specific &&
                editor.vehicleSelection.vehicleIds.isEmpty()
            ) {
                ErrorText(
                    text =
                        resolve(
                            "notifications.alertStudio.editor.vehiclesEmptyError",
                            "Select at least one vehicle.",
                        ),
                )
            }
        }
        KindToggle(editor = editor, resolve = resolve, onKind = actions.editor.onKind)
    }
}

@Composable
private fun KindToggle(
    editor: EditorState,
    resolve: StringResolver,
    onKind: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        FieldLabel(
            text = resolve("notifications.alertStudio.editor.kindLabel", "Rule type"),
            helpText =
                resolve(
                    "help.fields.alertStudio.kind",
                    "Choose 'Signal threshold' to trigger on a raw signal, or 'Computed metric' for a derived analytic.",
                ),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Button(
                label = resolve("notifications.alertStudio.kind.signal", "Signal threshold"),
                onClick = { onKind(RuleKinds.SIGNAL) },
                variant = if (editor.kind == RuleKinds.SIGNAL) ButtonVariant.Secondary else ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
            Button(
                label = resolve("notifications.alertStudio.kind.computedMetric", "Computed metric"),
                onClick = { onKind(RuleKinds.COMPUTED_METRIC) },
                variant = if (editor.kind == RuleKinds.COMPUTED_METRIC) ButtonVariant.Secondary else ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
        HelperText(
            text =
                if (editor.kind == RuleKinds.COMPUTED_METRIC) {
                    resolve(
                        "notifications.alertStudio.kind.computedMetricHint",
                        "Aggregate metric (cost, kWh, distance) over a time window.",
                    )
                } else {
                    resolve(
                        "notifications.alertStudio.kind.signalHint",
                        "Fires when a raw telemetry signal crosses a threshold.",
                    )
                },
        )
    }
}

@Composable
private fun SignalOperatorSection(
    editor: EditorState,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    val signalType =
        if (editor.signalName.isBlank()) {
            SignalValueType.NUMERIC
        } else {
            signalTypeForName(editor.signalName, editor.valueKind)
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Select(
                options = buildSignalOptions(editor, resolve),
                selectedValue = editor.signalName.ifBlank { null },
                onSelect = actions.editor.onSignalChange,
                label = resolve("notifications.alertStudio.editor.signalNameLabel", "Signal"),
                emptyLabel =
                    resolve(
                        "notifications.alertStudio.editor.signalNamePlaceholder", // parity:allow i18n key
                        "Select a telemetry signal",
                    ),
                modifier = Modifier.fillMaxWidth(),
            )
            if (editor.signalName.isNotBlank()) {
                HelperText(
                    text =
                        resolve.format(
                            "notifications.alertStudio.editor.signalTypeHint",
                            "%1\$s signal from %2\$s",
                            signalTypeLabel(signalType, resolve),
                            signalCategoryLabel(
                                signalCatalogByName[editor.signalName]?.category ?: CUSTOM_SIGNAL_CATEGORY,
                                resolve,
                            ),
                        ),
                )
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            FieldLabel(
                text = resolve("notifications.alertStudio.editor.operatorLabel", "Operator"),
                helpText =
                    resolve(
                        "help.fields.alertStudio.operator",
                        "The comparison applied between the live signal value and your typed value.",
                    ),
            )
            Select(
                options = allowedOpsForSignalType(signalType).map { SelectOption(it, operatorLabel(it, resolve)) },
                selectedValue = editor.op,
                onSelect = actions.editor.onOperatorChange,
                enabled = editor.signalName.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

private fun buildSignalOptions(
    editor: EditorState,
    resolve: StringResolver,
): List<SelectOption> {
    val base =
        signalCatalog.map { sig ->
            SelectOption(
                value = sig.name,
                label =
                    resolve.format(
                        "notifications.alertStudio.signals.optionLabel",
                        "%1\$s - %2\$s - %3\$s",
                        sig.name,
                        signalTypeLabel(sig.valueType, resolve),
                        signalCategoryLabel(sig.category, resolve),
                    ),
            )
        }
    val name = editor.signalName.trim()
    if (name.isEmpty() || signalCatalogByName.containsKey(name)) return base
    val customType = signalTypeForName(name, editor.valueKind)
    val custom =
        SelectOption(
            value = name,
            label =
                resolve.format(
                    "notifications.alertStudio.signals.customOptionLabel",
                    "%1\$s - %2\$s - Custom",
                    name,
                    signalTypeLabel(customType, resolve),
                ),
        )
    return listOf(custom) + base
}

@Composable
private fun SeveritySection(
    editor: EditorState,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    val signalType =
        if (editor.signalName.isBlank()) {
            SignalValueType.NUMERIC
        } else {
            signalTypeForName(editor.signalName, editor.valueKind)
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            FieldLabel(
                text = resolve("notifications.alertStudio.editor.severityLabel", "Severity"),
                helpText =
                    resolve(
                        "help.fields.alertStudio.severity",
                        "Determines how the alert is presented and prioritised.",
                    ),
            )
            Select(
                options = Severities.ALL.map { SelectOption(it, severityLabel(it, resolve)) },
                selectedValue = editor.severity,
                onSelect = actions.editor.onSeverity,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (editor.kind != RuleKinds.COMPUTED_METRIC) {
            GlassPanel(padding = PanelPadding.Sm) {
                Caption(
                    text =
                        resolve(
                            "notifications.alertStudio.editor.allowedOperatorsLabel",
                            "Allowed Operators",
                        ),
                )
                Subhead(
                    text =
                        if (editor.signalName.isNotBlank()) {
                            allowedOpsForSignalType(signalType).joinToString("  ") { operatorLabel(it, resolve) }
                        } else {
                            resolve(
                                "notifications.alertStudio.editor.allowedOperatorsPlaceholder", // parity:allow i18n key
                                "Select a signal to see its operators",
                            )
                        },
                )
            }
        }
    }
}

@Composable
private fun TypedValueSection(
    editor: EditorState,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        FieldLabel(text = resolve("notifications.alertStudio.editor.typedValueLabel", "Typed Value"))
        when {
            editor.signalName.isBlank() ->
                EmptyState(
                    icon = TeslaGlyphs.Info,
                    title = resolve("notifications.alertStudio.editor.noSignalTitle", "Choose a signal"),
                    message =
                        resolve(
                            "notifications.alertStudio.editor.noSignalDescription",
                            "Select a telemetry signal before entering a comparison value.",
                        ),
                )

            else -> TypedValueEditor(editor = editor, resolve = resolve, actions = actions)
        }
    }
}

@Composable
private fun TypedValueEditor(
    editor: EditorState,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    when (valueKindForState(editor)) {
        ValueKind.RANGE ->
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Input(
                    value = editor.valueMin,
                    onValueChange = actions.editor.onValueMin,
                    label = resolve("notifications.alertStudio.editor.minValueLabel", "Minimum Value"),
                    keyboardType = KeyboardType.Number,
                    modifier = Modifier.fillMaxWidth(),
                )
                Input(
                    value = editor.valueMax,
                    onValueChange = actions.editor.onValueMax,
                    label = resolve("notifications.alertStudio.editor.maxValueLabel", "Maximum Value"),
                    keyboardType = KeyboardType.Number,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

        ValueKind.TEXT ->
            Input(
                value = editor.valueText,
                onValueChange = actions.editor.onValueText,
                label = resolve("notifications.alertStudio.editor.textValueLabel", "Text Value"),
                hint = resolve("notifications.alertStudio.editor.textValuePlaceholder", "Value to compare"), // parity:allow i18n key
                modifier = Modifier.fillMaxWidth(),
            )

        ValueKind.BOOL ->
            Select(
                options =
                    listOf(
                        SelectOption("true", resolve("notifications.alertStudio.boolean.true", "True")),
                        SelectOption("false", resolve("notifications.alertStudio.boolean.false", "False")),
                    ),
                selectedValue = editor.valueBool.toString(),
                onSelect = { actions.editor.onValueBool(it == "true") },
                label = resolve("notifications.alertStudio.editor.booleanValueLabel", "Boolean Value"),
                modifier = Modifier.fillMaxWidth(),
            )

        ValueKind.NONE ->
            GlassPanel(padding = PanelPadding.Sm) {
                HelperText(
                    text =
                        resolve(
                            "notifications.alertStudio.editor.anyChangeDescription",
                            "This rule fires whenever the selected signal changes.",
                        ),
                )
            }

        ValueKind.NUMBER ->
            Input(
                value = editor.valueNum,
                onValueChange = actions.editor.onValueNum,
                label = resolve("notifications.alertStudio.editor.numericValueLabel", "Numeric Value"),
                keyboardType = KeyboardType.Number,
                modifier = Modifier.fillMaxWidth(),
            )
    }
}

@Composable
private fun BehaviorSection(
    editor: EditorState,
    isNewRule: Boolean,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Input(
            value = editor.cooldownMin.toString(),
            onValueChange = { actions.editor.onCooldown(it.toIntOrNull() ?: 0) },
            label = resolve("notifications.alertStudio.editor.cooldownLabel", "Cooldown (minutes)"),
            keyboardType = KeyboardType.Number,
            modifier = Modifier.fillMaxWidth(),
        )
        TriggerModeField(editor = editor, isNewRule = isNewRule, resolve = resolve, actions = actions)
        if (editor.triggerMode == TriggerModes.REPEAT) {
            MaxFiresField(editor = editor, resolve = resolve, actions = actions)
            EscalationSection(editor = editor, resolve = resolve, actions = actions)
        }
    }
}

@Composable
private fun TriggerModeField(
    editor: EditorState,
    isNewRule: Boolean,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    val blocked = isNewRule && editor.triggerMode == TriggerModes.UNSET
    val showRecommend = blocked && editor.kind == RuleKinds.SIGNAL && editor.signalName.isNotBlank()
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        FieldLabel(
            text = resolve("notifications.alertStudio.editor.alertBehaviorLabel", "Alert Behavior"),
            helpText =
                resolve(
                    "help.fields.alertStudio.alertBehavior",
                    "Pick 'Notify on event' for one-time confirmations, or 'Re-alert until resolved' for ongoing concerns.",
                ),
        )
        if (showRecommend) {
            val recommended = recommendedTriggerMode(editor.op)
            AlertBanner(
                message =
                    resolve.format(
                        "notifications.alertStudio.editor.alertBehavior.recommendBanner",
                        "Recommended for \"%1\$s\" comparisons: %2\$s.",
                        editor.op,
                        behaviorLabel(recommended, resolve),
                    ) + " " +
                        resolve.format(
                            "notifications.alertStudio.editor.alertBehavior.recommendBannerAlt",
                            "%1\$s is also valid - pick whatever fits.",
                            behaviorLabel(otherMode(recommended), resolve),
                        ),
                tone = Tone.Info,
            )
        }
        Select(
            options =
                listOf(
                    SelectOption(
                        TriggerModes.REPEAT,
                        resolve("notifications.alertStudio.editor.alertBehavior.repeatLabel", "Re-alert until resolved"),
                    ),
                    SelectOption(
                        TriggerModes.ONCE,
                        resolve("notifications.alertStudio.editor.alertBehavior.onceLabel", "Notify on event"),
                    ),
                ),
            selectedValue = editor.triggerMode.takeIf { it != TriggerModes.UNSET },
            onSelect = actions.editor.onTriggerMode,
            emptyLabel = resolve("notifications.alertStudio.editor.alertBehaviorPlaceholder", "- Choose one -"), // parity:allow i18n key
            modifier = Modifier.fillMaxWidth(),
        )
        when {
            blocked ->
                ErrorText(
                    text =
                        resolve(
                            "notifications.alertStudio.editor.alertBehavior.forceChoose",
                            "Pick how this alert should behave.",
                        ),
                )

            editor.triggerMode == TriggerModes.ONCE ->
                HelperText(
                    text =
                        resolve(
                            "notifications.alertStudio.editor.alertBehavior.onceDesc",
                            "Fires when the condition is first met. Stays quiet until it resets.",
                        ),
                )

            editor.triggerMode == TriggerModes.REPEAT ->
                HelperText(
                    text =
                        resolve.format(
                            "notifications.alertStudio.editor.alertBehavior.repeatDesc",
                            "Keeps firing every %1\$s minutes while the condition stays true.",
                            editor.cooldownMin,
                        ),
                )
        }
    }
}

private fun behaviorLabel(
    mode: String,
    resolve: StringResolver,
): String =
    if (mode == TriggerModes.ONCE) {
        resolve("notifications.alertStudio.editor.alertBehavior.onceLabel", "Notify on event")
    } else {
        resolve("notifications.alertStudio.editor.alertBehavior.repeatLabel", "Re-alert until resolved")
    }

private fun otherMode(mode: String): String = if (mode == TriggerModes.ONCE) TriggerModes.REPEAT else TriggerModes.ONCE

@Composable
private fun MaxFiresField(
    editor: EditorState,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        FieldLabel(
            text =
                resolve(
                    "notifications.alertStudio.editor.maxFiresLabel",
                    "Max alerts before condition resolves",
                ),
            helpText =
                resolve(
                    "help.fields.alertStudio.maxFires",
                    "Cap how many times this rule can re-fire while the condition holds. Leave blank for unlimited.",
                ),
        )
        Input(
            value = editor.maxFiresPerResolution,
            onValueChange = actions.editor.onMaxFires,
            hint = resolve("notifications.alertStudio.editor.maxFiresPlaceholder", "Leave blank for unlimited"), // parity:allow i18n key
            keyboardType = KeyboardType.Number,
            modifier = Modifier.fillMaxWidth(),
        )
        HelperText(
            text =
                resolve(
                    "notifications.alertStudio.editor.maxFiresHint",
                    "Only applies to repeat-mode rules. Once-mode already caps at 1 per resolution.",
                ),
        )
    }
}

@Composable
private fun EscalationSection(
    editor: EditorState,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Toggle(
                checked = editor.escalationEnabled,
                onCheckedChange = actions.editor.onEscalationToggle,
                label =
                    resolve(
                        "notifications.alertStudio.editor.escalationCheckboxLabel",
                        "Escalate to a higher severity if the condition stays unresolved",
                    ),
            )
        }
        if (editor.escalationEnabled) {
            Input(
                value = editor.escalationAfterMin,
                onValueChange = actions.editor.onEscalationAfter,
                label = resolve("notifications.alertStudio.editor.escalationAfterLabel", "Escalate after (minutes)"),
                hint = resolve("notifications.alertStudio.editor.escalationAfterPlaceholder", "e.g. 30"), // parity:allow i18n key
                keyboardType = KeyboardType.Number,
                modifier = Modifier.fillMaxWidth(),
            )
            Select(
                options =
                    Severities.ALL
                        .filter { severityRank(it) > severityRank(editor.severity) }
                        .map { SelectOption(it, severityLabel(it, resolve)) },
                selectedValue = editor.escalationSeverity.ifBlank { null },
                onSelect = actions.editor.onEscalationSeverity,
                label = resolve("notifications.alertStudio.editor.escalationSeverityLabel", "Escalated severity"),
                emptyLabel =
                    resolve(
                        "notifications.alertStudio.editor.escalationSeverityPlaceholder", // parity:allow i18n key
                        "Select severity.",
                    ),
                modifier = Modifier.fillMaxWidth(),
            )
            HelperText(
                text =
                    resolve(
                        "notifications.alertStudio.editor.escalationHint",
                        "Only repeat-mode rules can escalate. The escalated severity must be higher than the base.",
                    ),
            )
        }
    }
}

@Composable
private fun ComputedMetricEditor(
    editor: EditorState,
    metricsState: UiState<List<ComputedMetricSummary>>,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    val metrics = metricsState.data ?: emptyList()
    val selected = metrics.firstOrNull { it.id == editor.metricId }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        if (metricsState.isLoading && metrics.isEmpty()) {
            HelperText(text = resolve("notifications.alertStudio.computedMetric.loading", "Loading metrics."))
        }
        Select(
            options = metrics.map { SelectOption(it.id, it.label) },
            selectedValue = editor.metricId.ifBlank { null },
            onSelect = actions.editor.onMetricId,
            label = resolve("notifications.alertStudio.computedMetric.metric", "Metric"),
            emptyLabel = resolve("notifications.alertStudio.computedMetric.metricPlaceholder", "Select a metric"), // parity:allow i18n key
            modifier = Modifier.fillMaxWidth(),
        )
        Select(
            options = (selected?.windows ?: emptyList()).map { SelectOption(it, it) },
            selectedValue = editor.metricWindow.ifBlank { null },
            onSelect = actions.editor.onMetricWindow,
            label = resolve("notifications.alertStudio.computedMetric.window", "Window"),
            emptyLabel = resolve("notifications.alertStudio.computedMetric.windowPlaceholder", "Select a window"), // parity:allow i18n key
            enabled = selected != null,
            modifier = Modifier.fillMaxWidth(),
        )
        Select(
            options = (selected?.ops ?: emptyList()).map { SelectOption(it, operatorLabel(it, resolve)) },
            selectedValue = editor.metricOp.ifBlank { null },
            onSelect = actions.editor.onMetricOp,
            label = resolve("notifications.alertStudio.computedMetric.op", "Operator"),
            enabled = selected != null,
            modifier = Modifier.fillMaxWidth(),
        )
        Input(
            value = editor.metricThreshold,
            onValueChange = actions.editor.onMetricThreshold,
            label = resolve("notifications.alertStudio.computedMetric.threshold", "Threshold"),
            hint = resolve("notifications.alertStudio.computedMetric.thresholdPlaceholder", "Value"), // parity:allow i18n key
            keyboardType = KeyboardType.Number,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun MessageSection(
    editor: EditorState,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Textarea(
            value = editor.msgTemplate,
            onValueChange = actions.editor.onMsgTemplate,
            label = resolve("notifications.alertStudio.editor.testMessageLabel", "Notification message"),
            hint =
                resolve(
                    "notifications.alertStudio.editor.testMessagePlaceholder", // parity:allow i18n key
                    "Custom message (leave blank for the default).",
                ),
            modifier = Modifier.fillMaxWidth(),
        )
        Toggle(
            checked = editor.includeTitle,
            onCheckedChange = actions.editor.onIncludeTitle,
            label = resolve("notifications.alertStudio.editor.includeTitleLabel", "Include title in notification"),
        )
    }
}

@Composable
private fun TestDeliverySection(
    interaction: AlertStudioInteraction,
    channelsState: UiState<List<NotificationChannel>>,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        FieldLabel(text = resolve("notifications.alertStudio.channels.testTargetLabel", "Test Delivery Target"))
        TestTargetRow(
            text =
                resolve(
                    "notifications.alertStudio.channels.browserToast",
                    "Browser toast notification (real-time via SSE)",
                ),
        )
        TestTargetRow(
            text =
                resolve(
                    "notifications.alertStudio.channels.alertHistory",
                    "Alert history (saved to database)",
                ),
        )
        GlassPanel(padding = PanelPadding.Sm) {
            ChannelsContent(
                interaction = interaction,
                channelsState = channelsState,
                resolve = resolve,
                actions = actions,
            )
        }
    }
}

@Composable
private fun TestTargetRow(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Box(
            modifier =
                Modifier
                    .size(Spacing.sm)
                    .clip(RoundedCornerShape(Spacing.sm))
                    .background(TeslaTokens.status.success),
        )
        HelperText(text = text)
    }
}

@Composable
private fun ChannelsContent(
    interaction: AlertStudioInteraction,
    channelsState: UiState<List<NotificationChannel>>,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    val channels = channelsState.data ?: emptyList()
    val allIds = channels.map { it.id }
    when {
        channelsState.isLoading && channels.isEmpty() ->
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                repeat(SKELETON_ROWS) { Skeleton(modifier = Modifier.fillMaxWidth(), height = SKELETON_CHIP_HEIGHT) }
            }

        channelsState.isError && channels.isEmpty() ->
            ErrorDisplay(
                message = resolve("common.error", "Something went wrong"),
                onRetry = actions.onRetry,
                retryLabel = resolve("common.retry", "Retry"),
            )

        channels.isEmpty() ->
            EmptyState(
                icon = AlertStudioGlyphs.BellOff,
                title = resolve("notifications.alertStudio.channels.emptyTitle", "No external channels configured"),
                message =
                    resolve(
                        "notifications.alertStudio.channels.emptyDescription",
                        "Browser toasts and alert history are always enabled.",
                    ),
            )

        else -> {
            HelperText(
                text =
                    resolve(
                        "notifications.alertStudio.channels.externalChannels",
                        "External channels for test notifications:",
                    ),
            )
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                channels.forEach { channel ->
                    val selected = interaction.testChannelIds == null || interaction.testChannelIds.contains(channel.id)
                    ChannelChip(
                        channel = channel,
                        selected = selected,
                        resolve = resolve,
                        onClick = { actions.onToggleChannel(channel.id, allIds) },
                    )
                }
            }
        }
    }
}

@Composable
private fun ChannelChip(
    channel: NotificationChannel,
    selected: Boolean,
    resolve: StringResolver,
    onClick: () -> Unit,
) {
    val kindLabel = resolve("notifications.alertStudio.channels.kind.${channel.kindToken()}", channel.kindToken())
    Button(
        label = "${channel.name} ($kindLabel)",
        onClick = onClick,
        variant = if (selected) ButtonVariant.Secondary else ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        leadingIcon = AlertStudioGlyphs.Bell,
    )
}

private fun NotificationChannel.kindToken(): String =
    when (this) {
        is NotificationChannel.Discord -> "discord"
        is NotificationChannel.Slack -> "slack"
        is NotificationChannel.Telegram -> "telegram"
        is NotificationChannel.Email -> "email"
        is NotificationChannel.Webhook -> "webhook"
        is NotificationChannel.Ntfy -> "ntfy"
        is NotificationChannel.Pushover -> "pushover"
    }

@Composable
private fun EditorActionsBar(
    interaction: AlertStudioInteraction,
    saveable: Boolean,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    val editor = interaction.editor
    val editorId = editor.id
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Button(
            label =
                when {
                    interaction.saving -> resolve("notifications.alertStudio.actions.saving", "Saving...")
                    interaction.isEditing -> resolve("notifications.alertStudio.actions.updateRule", "Update Rule")
                    else -> resolve("notifications.alertStudio.actions.createRule", "Create Rule")
                },
            onClick = actions.onSave,
            variant = ButtonVariant.Primary,
            size = ButtonSize.Sm,
            enabled = saveable,
            loading = interaction.saving,
            leadingIcon = AlertStudioGlyphs.Save,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            if (interaction.isEditing && editorId != null) {
                Button(
                    label = resolve("notifications.alertStudio.actions.delete", "Delete"),
                    onClick = { actions.onDeleteEditor(editorId) },
                    variant = ButtonVariant.Danger,
                    size = ButtonSize.Sm,
                    leadingIcon = AlertStudioGlyphs.Trash,
                )
            }
            Button(
                label = resolve("notifications.alertStudio.actions.test", "Test"),
                onClick = actions.onTest,
                variant = ButtonVariant.Secondary,
                size = ButtonSize.Sm,
                enabled = editor.name.isNotBlank(),
                loading = interaction.testing,
                leadingIcon = AlertStudioGlyphs.Bell,
            )
            Button(
                label = resolve("notifications.alertStudio.actions.reset", "Reset"),
                onClick = actions.onNewRule,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

// ── Field-label helper ────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun FieldLabel(
    text: String,
    helpText: String? = null,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        FieldLabelText(text = text)
        if (helpText != null) {
            HelpIcon(text = helpText, contentDescription = text, size = IconSize.Sm)
        }
    }
}

// ── Vehicle-selection mappers (editor union ↔ component multi-select) ─────────────────────────────────────

private fun EditorVehicleSelection.toComponentSelection(): VehicleSelection =
    when (this) {
        EditorVehicleSelection.AllSticky -> VehicleSelection(ids = emptySet(), allSelected = true)
        is EditorVehicleSelection.Specific -> VehicleSelection(ids = vehicleIds.toSet(), allSelected = false)
    }

private fun VehicleSelection.toEditorSelection(): EditorVehicleSelection =
    if (allSelected) EditorVehicleSelection.AllSticky else EditorVehicleSelection.Specific(ids.sorted())

// ── Dialogs ───────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun SnoozeDialog(
    interaction: AlertStudioInteraction,
    rules: List<AlertRule>,
    resolve: StringResolver,
    nowMillis: Long,
    actions: AlertStudioActions,
) {
    val target = interaction.snoozeTargetId?.let { id -> rules.firstOrNull { it.id == id } } ?: return
    val untitled = resolve("notifications.alertStudio.rules.untitled", "Untitled")
    val active = isSnoozeActive(target.snoozedUntil, nowMillis)
    Modal(
        onDismissRequest = { actions.onSetSnoozeTarget(null) },
        title =
            resolve.format(
                "notifications.alertStudio.snooze.title",
                "Snooze %1\$s",
                target.name.ifBlank { untitled },
            ),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            if (active && target.snoozedUntil != null) {
                AlertBanner(
                    message =
                        resolve.format(
                            "notifications.alertStudio.snooze.currentlySnoozed",
                            "Currently snoozed until %1\$s",
                            formatTimestamp(target.snoozedUntil!!),
                        ),
                    tone = Tone.Warning,
                )
            }
            Button(
                label = resolve("notifications.alertStudio.snooze.1h", "Snooze 1 hour"),
                onClick = { actions.onSnooze(target.id, SNOOZE_1H) },
                variant = ButtonVariant.Secondary,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                label = resolve("notifications.alertStudio.snooze.4h", "Snooze 4 hours"),
                onClick = { actions.onSnooze(target.id, SNOOZE_4H) },
                variant = ButtonVariant.Secondary,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                label = resolve("notifications.alertStudio.snooze.24h", "Snooze 24 hours"),
                onClick = { actions.onSnooze(target.id, SNOOZE_24H) },
                variant = ButtonVariant.Secondary,
                modifier = Modifier.fillMaxWidth(),
            )
            if (active) {
                Button(
                    label = resolve("notifications.alertStudio.snooze.cancel", "Cancel snooze"),
                    onClick = { actions.onSnooze(target.id, 0) },
                    variant = ButtonVariant.Ghost,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

private const val SNOOZE_1H = 60
private const val SNOOZE_4H = 240
private const val SNOOZE_24H = 1440

@Composable
private fun DeleteDialog(
    interaction: AlertStudioInteraction,
    rules: List<AlertRule>,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    val id = interaction.deleteTargetId ?: return
    val untitled = resolve("notifications.alertStudio.rules.untitled", "Untitled")
    val name = rules.firstOrNull { it.id == id }?.name?.ifBlank { untitled } ?: untitled
    ConfirmDialog(
        title = resolve("notifications.alertStudio.rules.confirmDeleteTitle", "Delete rule?"),
        message = resolve.format("notifications.alertStudio.rules.confirmDelete", "Delete %1\$s?", name),
        confirmLabel = resolve("common.delete", "Delete"),
        cancelLabel = resolve("common.cancel", "Cancel"),
        onConfirm = { actions.onConfirmDelete(id) },
        onCancel = actions.onCancelDelete,
        severity = ConfirmSeverity.Danger,
    )
}

@Composable
private fun DiscardDialog(
    interaction: AlertStudioInteraction,
    resolve: StringResolver,
    actions: AlertStudioActions,
) {
    if (interaction.pendingSwitch == null) return
    ConfirmDialog(
        title = resolve("forms.unsavedTitle", "Unsaved changes"),
        message = resolve("forms.unsavedWarning", "You have unsaved changes. Discard them?"),
        confirmLabel = resolve("forms.discard", "Discard"),
        cancelLabel = resolve("forms.keepEditing", "Keep editing"),
        onConfirm = actions.onConfirmDiscard,
        onCancel = actions.onCancelDiscard,
        severity = ConfirmSeverity.Warning,
    )
}

// ── Design-time previews ──────────────────────────────────────────────────────────────────────────────────

private fun previewResolver(): StringResolver = { _, fallback -> fallback }

private val PREVIEW_RULES =
    listOf(
        AlertRule(
            id = 1,
            name = "Battery Critical",
            enabled = true,
            signalName = "BatteryLevel",
            op = "<",
            valueNum = 10.0,
            severity = "critical",
            cooldownMin = 15,
            triggerMode = "repeat",
            updatedAt = "2024-05-01T09:30:00Z",
        ),
        AlertRule(
            id = 2,
            name = "Vehicle Unlocked",
            enabled = false,
            signalName = "Locked",
            op = "=",
            valueBool = false,
            severity = "warn",
            cooldownMin = 30,
            triggerMode = "once",
            updatedAt = "2024-05-02T18:05:00Z",
        ),
    )

@Composable
private fun PreviewScaffold(rulesState: UiState<List<AlertRule>>) {
    TeslaSyncTheme {
        AlertStudioPageContent(
            rulesState = rulesState,
            channelsState = UiState(UiPhase.Empty, emptyList()),
            metricsState = UiState(UiPhase.Empty, emptyList()),
            vehiclesState = UiState(UiPhase.Empty, emptyList()),
            interaction = AlertStudioInteraction(),
            actions = previewActions(),
            resolve = previewResolver(),
            nowMillis = 0L,
        )
    }
}

@Preview(name = "AlertStudio — content", showBackground = true)
@Composable
private fun AlertStudioContentPreview() {
    PreviewScaffold(rulesState = UiState(UiPhase.Content, PREVIEW_RULES))
}

@Preview(name = "AlertStudio — loading", showBackground = true)
@Composable
private fun AlertStudioLoadingPreview() {
    PreviewScaffold(rulesState = UiState(UiPhase.Loading))
}

@Preview(name = "AlertStudio — empty", showBackground = true)
@Composable
private fun AlertStudioEmptyPreview() {
    PreviewScaffold(rulesState = UiState(UiPhase.Empty, emptyList()))
}

@Preview(name = "AlertStudio — offline", showBackground = true)
@Composable
private fun AlertStudioOfflinePreview() {
    PreviewScaffold(
        rulesState = UiState(UiPhase.Content, PREVIEW_RULES, stale = true),
    )
}

@Suppress("LongMethod")
private fun previewActions(): AlertStudioActions =
    AlertStudioActions(
        onToggleTemplates = {},
        onTemplateSearch = {},
        onTemplateCategory = {},
        onCloneTemplate = {},
        onRuleSearch = {},
        onSelectRule = {},
        onNewRule = {},
        onToggleEnabled = {},
        onRequestDelete = {},
        onSetSnoozeTarget = {},
        onToggleBulk = { _, _ -> },
        onClearBulk = {},
        onBulkEnable = {},
        onBulkDisable = {},
        onReconcileBulk = {},
        onRetry = {},
        editor = previewEditorActions(),
        onSave = {},
        onDeleteEditor = {},
        onTest = {},
        onConfirmDelete = {},
        onCancelDelete = {},
        onConfirmDiscard = {},
        onCancelDiscard = {},
        onSnooze = { _, _ -> },
        onToggleChannel = { _, _ -> },
    )

@Suppress("LongMethod")
private fun previewEditorActions(): EditorActions =
    EditorActions(
        onName = {},
        onEnabled = {},
        onVehicleSelection = {},
        onSignalChange = {},
        onOperatorChange = {},
        onSeverity = {},
        onValueNum = {},
        onValueText = {},
        onValueBool = {},
        onValueMin = {},
        onValueMax = {},
        onCooldown = {},
        onTriggerMode = {},
        onMaxFires = {},
        onEscalationToggle = {},
        onEscalationAfter = {},
        onEscalationSeverity = {},
        onMsgTemplate = {},
        onIncludeTitle = {},
        onKind = {},
        onMetricId = {},
        onMetricWindow = {},
        onMetricOp = {},
        onMetricThreshold = {},
    )
