// The native Jetpack Compose + Material 3 AutomationCard feature view — a parity port of
// web/src/features/automations/pages/AutomationCard.tsx. The web component is purely presentational: inside a
// `<GlassPanel>` (ringed cyan while firing, red-bordered while auto-disabled) it renders a header row (the
// automation name, a status `<Badge>`, and a pulsing "Firing" indicator), a pin button + a `<Toggle>` + a
// kebab actions menu, a vehicle row, a wrapping stats row (last/never run · runs · fails · next fire), an
// auto-disabled reason banner, and a list of conflict banners — plus a delete `<ConfirmDialog>`.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog). The host supplies the automation through the
// shared P1/S8 state-holder layer as a [UiState], so this feature view renders every lifecycle state that
// layer can carry — loading skeleton, hard error with retry, empty, content, and stale/offline ("last known")
// — without ever fetching. A web-parity overload taking the raw automation is also provided for hosts that
// already hold it. All data derivations live in [AutomationCardProjection] (pure, unit-tested off-device); the
// status/severity token colors are resolved here at the Compose boundary (never a raw hex in the model).
//
// The status badge variant mirrors the web exactly (active → success, disabled → neutral, auto-disabled →
// danger); the firing accent + indicator use the info/cyan token; the auto-disabled banner + the critical
// conflict use the danger/warning tokens; the info conflict uses the info token. The "Last run" relative age
// is formatted from the shared `translation_freshness_*` catalog (the web `timeAgo` strings), and the "Next
// fire" absolute timestamp from the projection's localized formatter (the web `formatDateTime`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AutomationCard — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.automationcard

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.ContextMenu
import io.teslasync.android.components.ui.ContextMenuItem
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PinButton
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.util.Locale

/** The web `<FadeIn>` entrance delay, in milliseconds. */
private const val FADE_DELAY_MS: Int = 0

/** First-load skeleton bar heights so the panel is never a blank box. */
private val SKELETON_TITLE_HEIGHT: Dp = 18.dp
private val SKELETON_LINE_HEIGHT: Dp = 12.dp

/** Low-alpha wash behind the inline notice banners (auto-disabled reason + conflicts). */
private const val NOTICE_WASH_ALPHA: Float = 0.12f

/** Firing-indicator pulse bounds + period (the web `animate-pulse`); honored only when motion is enabled. */
private const val PULSE_MIN_ALPHA: Float = 0.45f
private const val PULSE_MAX_ALPHA: Float = 1f
private const val PULSE_PERIOD_MS: Int = 900

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10). The web component
 * renders the `automations.status.*` labels via i18next default-value fallback (the keys are absent upstream),
 * which resolves to the same strings the catalog ships under `automations.stats.*` — so the three status
 * labels bind there. The remaining keys map one-to-one to the web `t(...)` calls.
 */
data class AutomationCardStrings(
    val statusActive: String,
    val statusDisabled: String,
    val statusAutoDisabled: String,
    val firing: String,
    val toggleLabel: String,
    val menu: String,
    val testRun: String,
    val reEnable: String,
    val duplicate: String,
    val export: String,
    val delete: String,
    val deleteConfirm: String,
    val allVehicles: String,
    val lastRun: String,
    val neverRun: String,
    val runs: String,
    val fails: String,
    val nextFire: String,
    val conflictWith: String,
    val deleteTitle: String,
    val cancel: String,
    val close: String,
    val noData: String,
    val pin: String,
    val pinned: String,
)

/**
 * Stateful entry point for the AutomationCard surface. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared automations feed can carry. The host owns the feed
 * (P1/S8) and supplies the action callbacks + [onRetry]; this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the single automation this card renders.
 * @param onToggle invoked with `(id, enabled)` when the switch is changed for a non-auto-disabled automation.
 * @param onReEnable invoked with `id` when an auto-disabled automation is toggled back on or re-enabled.
 * @param onDelete invoked with `id` after the delete confirmation is accepted.
 * @param onTestRun invoked with `id` from the actions menu.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param pinned host-owned pin state; [onTogglePin] flips it (the native PinButton is controlled by design).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AutomationCard(
    state: UiState<AutomationView>,
    onToggle: (Long, Boolean) -> Unit,
    onReEnable: (Long) -> Unit,
    onDelete: (Long) -> Unit,
    onTestRun: (Long) -> Unit,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
    isFiring: Boolean = false,
    vehicleName: String? = null,
    pinned: Boolean = false,
    onTogglePin: () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordAutomationCardOpened(logger) }
    AutomationCardContent(
        state = state,
        onToggle = onToggle,
        onReEnable = onReEnable,
        onDelete = onDelete,
        onTestRun = onTestRun,
        onRetry = onRetry,
        modifier = modifier,
        isFiring = isFiring,
        vehicleName = vehicleName,
        pinned = pinned,
        onTogglePin = onTogglePin,
    )
}

/**
 * Web-parity overload mirroring the web component's props (`automation`, `isFiring`, `vehicleName`, and the
 * four action callbacks), for hosts that already hold the loaded automation. Wraps it in a content [UiState]
 * and owns the pin state locally — the same self-contained pin affordance the web `<PinButton>` provides.
 * Records `view.opened` like the stateful entry; there is no fetch behind it, so it offers no retry.
 */
@Composable
fun AutomationCard(
    automation: AutomationView,
    isFiring: Boolean,
    onToggle: (Long, Boolean) -> Unit,
    onReEnable: (Long) -> Unit,
    onDelete: (Long) -> Unit,
    onTestRun: (Long) -> Unit,
    modifier: Modifier = Modifier,
    vehicleName: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    var pinned by remember { mutableStateOf(false) }
    val state = remember(automation) { UiState(phase = UiPhase.Content, data = automation) }
    AutomationCard(
        state = state,
        onToggle = onToggle,
        onReEnable = onReEnable,
        onDelete = onDelete,
        onTestRun = onTestRun,
        modifier = modifier,
        isFiring = isFiring,
        vehicleName = vehicleName,
        pinned = pinned,
        onTogglePin = { pinned = !pinned },
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * card body and adds the lifecycle chrome the host's feed implies: a loading skeleton, a hard-error retry
 * surface, a friendly empty state when no automation resolves, and a freshness chip that reflects
 * refreshing / stale / offline. Stale (non-error) data auto-refreshes, mirroring the sibling surfaces'
 * freshness contract. [zone] / [locale] format the next-fire timestamp + relative age.
 */
@Composable
fun AutomationCardContent(
    state: UiState<AutomationView>,
    onToggle: (Long, Boolean) -> Unit,
    onReEnable: (Long) -> Unit,
    onDelete: (Long) -> Unit,
    onTestRun: (Long) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    isFiring: Boolean = false,
    vehicleName: String? = null,
    pinned: Boolean = false,
    onTogglePin: () -> Unit = {},
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
    strings: AutomationCardStrings = rememberAutomationCardStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val view = state.data
    val accent =
        when {
            state.isLoading || state.isError || view == null -> PanelAccent.None
            AutomationUiStatus.from(view) == AutomationUiStatus.AutoDisabled -> PanelAccent.Danger
            isFiring -> PanelAccent.Info
            else -> PanelAccent.None
        }

    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Md, accent = accent) {
            when {
                state.isLoading -> AutomationCardLoading(label = stringResource(R.string.translation_common_loading))
                state.isError -> AutomationCardError(onRetry = onRetry)
                view == null || state.isEmpty -> AutomationCardEmpty(message = strings.noData)
                else -> {
                    if (state.stale || state.refreshing || state.hasError) {
                        AutomationFreshnessRow(state)
                    }
                    AutomationCardBody(
                        view = view,
                        isFiring = isFiring,
                        vehicleName = vehicleName,
                        onToggle = onToggle,
                        onReEnable = onReEnable,
                        onDelete = onDelete,
                        onTestRun = onTestRun,
                        pinned = pinned,
                        onTogglePin = onTogglePin,
                        zone = zone,
                        locale = locale,
                        strings = strings,
                    )
                }
            }
        }
    }
}

/** The populated card — the faithful reproduction of the web component's loaded layout. */
@Composable
private fun AutomationCardBody(
    view: AutomationView,
    isFiring: Boolean,
    vehicleName: String?,
    onToggle: (Long, Boolean) -> Unit,
    onReEnable: (Long) -> Unit,
    onDelete: (Long) -> Unit,
    onTestRun: (Long) -> Unit,
    pinned: Boolean,
    onTogglePin: () -> Unit,
    zone: ZoneId,
    locale: Locale,
    strings: AutomationCardStrings,
) {
    val result =
        remember(view, zone, locale) {
            AutomationCardProjection.project(view, System.currentTimeMillis(), zone, locale)
        }
    var confirmDelete by remember(view.id) { mutableStateOf(false) }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        AutomationHeader(
            view = view,
            result = result,
            isFiring = isFiring,
            onToggle = onToggle,
            onReEnable = onReEnable,
            onTestRun = onTestRun,
            onDeleteRequest = { confirmDelete = true },
            pinned = pinned,
            onTogglePin = onTogglePin,
            strings = strings,
        )
        AutomationVehicleRow(vehicleName = vehicleName, allVehicles = strings.allVehicles)
        AutomationStatsRow(result = result, strings = strings)
        if (result.showAutoDisabledWarning && result.autoDisabledReason != null) {
            InlineNotice(
                icon = AlertTriangleGlyph,
                text = result.autoDisabledReason,
                container = TeslaTokens.status.danger.copy(alpha = NOTICE_WASH_ALPHA),
                content = TeslaTokens.status.danger,
            )
        }
        result.conflicts.forEach { conflict ->
            val color = conflictColor(conflict.severity)
            InlineNotice(
                icon = AlertTriangleGlyph,
                text = "${strings.conflictWith} \"${conflict.automationName}\" \u2014 ${conflict.reason}",
                container = color.copy(alpha = NOTICE_WASH_ALPHA),
                content = color,
            )
        }
    }

    if (confirmDelete) {
        ConfirmDialog(
            title = strings.deleteTitle,
            message = stringResource(R.string.translation_automations_deleteMessage, view.name),
            confirmLabel = strings.deleteConfirm,
            cancelLabel = strings.cancel,
            onConfirm = {
                onDelete(view.id)
                confirmDelete = false
            },
            onCancel = { confirmDelete = false },
            severity = ConfirmSeverity.Danger,
            closeLabel = strings.close,
        )
    }
}

/** Header row: name + status badge + firing indicator on the left; pin + toggle + actions menu on the right. */
@Composable
private fun AutomationHeader(
    view: AutomationView,
    result: AutomationCardProjectionResult,
    isFiring: Boolean,
    onToggle: (Long, Boolean) -> Unit,
    onReEnable: (Long) -> Unit,
    onTestRun: (Long) -> Unit,
    onDeleteRequest: () -> Unit,
    pinned: Boolean,
    onTogglePin: () -> Unit,
    strings: AutomationCardStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Heading(
                    view.name,
                    modifier = Modifier.weight(1f, fill = false),
                    level = HeadingLevel.Panel,
                    maxLines = 1,
                )
                Badge(statusLabel(result.status, strings), variant = statusVariant(result.status))
                if (isFiring) {
                    FiringIndicator(label = strings.firing)
                }
            }
            if (!view.description.isNullOrBlank()) {
                BodyText(
                    view.description,
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                )
            }
        }
        Spacer(Modifier.width(Spacing.sm))
        AutomationControls(
            view = view,
            result = result,
            onToggle = onToggle,
            onReEnable = onReEnable,
            onTestRun = onTestRun,
            onDeleteRequest = onDeleteRequest,
            pinned = pinned,
            onTogglePin = onTogglePin,
            strings = strings,
        )
    }
}

/** The right-hand control cluster: pin toggle, enable switch, and the kebab actions menu. */
@Composable
private fun AutomationControls(
    view: AutomationView,
    result: AutomationCardProjectionResult,
    onToggle: (Long, Boolean) -> Unit,
    onReEnable: (Long) -> Unit,
    onTestRun: (Long) -> Unit,
    onDeleteRequest: () -> Unit,
    pinned: Boolean,
    onTogglePin: () -> Unit,
    strings: AutomationCardStrings,
) {
    var menuOpen by remember(view.id) { mutableStateOf(false) }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        PinButton(
            pinned = pinned,
            onToggle = onTogglePin,
            pinLabel = strings.pin,
            pinnedLabel = strings.pinned,
            size = IconSize.Sm,
        )
        Toggle(
            checked = result.toggleChecked,
            onCheckedChange = { checked ->
                when (val action = AutomationCardProjection.toggleAction(view, checked)) {
                    AutomationToggleAction.ReEnable -> onReEnable(view.id)
                    is AutomationToggleAction.SetEnabled -> onToggle(view.id, action.enabled)
                }
            },
            modifier = Modifier.semantics { contentDescription = strings.toggleLabel },
        )
        Box {
            IconButton(
                imageVector = MoreVerticalGlyph,
                contentDescription = strings.menu,
                onClick = { menuOpen = true },
                size = IconSize.Md,
            )
            ContextMenu(
                expanded = menuOpen,
                onDismissRequest = { menuOpen = false },
                items = automationMenuItems(view, onTestRun, onReEnable, onDeleteRequest, strings),
            )
        }
    }
}

/** The actions-menu items — the web kebab list. Duplicate/Export mirror the web entries, which dismiss the
 * menu without a card-level action (the web handlers only close the menu); Delete opens the confirmation. */
private fun automationMenuItems(
    view: AutomationView,
    onTestRun: (Long) -> Unit,
    onReEnable: (Long) -> Unit,
    onDeleteRequest: () -> Unit,
    strings: AutomationCardStrings,
): List<ContextMenuItem> =
    buildList {
        add(ContextMenuItem(label = strings.testRun, onClick = { onTestRun(view.id) }, leadingIcon = PlayGlyph))
        if (view.autoDisabled) {
            add(ContextMenuItem(label = strings.reEnable, onClick = { onReEnable(view.id) }, leadingIcon = RotateCcwGlyph))
        }
        add(ContextMenuItem(label = strings.duplicate, onClick = {}, leadingIcon = TeslaGlyphs.Copy))
        add(ContextMenuItem(label = strings.export, onClick = {}, leadingIcon = DownloadGlyph))
        add(
            ContextMenuItem(
                label = strings.delete,
                onClick = onDeleteRequest,
                destructive = true,
                leadingIcon = Trash2Glyph,
            ),
        )
    }

/** The vehicle row — the assigned vehicle name, or "All vehicles" when the automation is fleet-wide. */
@Composable
private fun AutomationVehicleRow(
    vehicleName: String?,
    allVehicles: String,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (!vehicleName.isNullOrBlank()) {
            Icon(CarGlyph, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Caption(vehicleName)
        } else {
            Caption(allVehicles)
        }
    }
}

/** The wrapping stats row — last/never run, lifetime runs, failures (when any), and the next fire time. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AutomationStatsRow(
    result: AutomationCardProjectionResult,
    strings: AutomationCardStrings,
) {
    val secondary = MaterialTheme.colorScheme.onSurfaceVariant
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (result.hasLastRun) {
            StatItem(
                icon = CheckCircleGlyph,
                iconTint = TeslaTokens.status.success,
                text = "${strings.lastRun}: ${formatFreshness(result.lastRunAge)}",
                textColor = secondary,
            )
        } else {
            StatItem(icon = SkipForwardGlyph, iconTint = secondary, text = strings.neverRun, textColor = secondary)
        }
        StatItem(icon = null, iconTint = secondary, text = "${strings.runs}: ${result.runsCount}", textColor = secondary)
        if (result.showFails) {
            StatItem(
                icon = XCircleGlyph,
                iconTint = TeslaTokens.status.danger,
                text = "${strings.fails}: ${result.failsCount}",
                textColor = TeslaTokens.status.danger,
            )
        }
        if (result.hasNextFire) {
            StatItem(
                icon = null,
                iconTint = secondary,
                text = "${strings.nextFire}: ${result.nextFireLabel}",
                textColor = TeslaTokens.status.info,
            )
        }
    }
}

/** One stat chip — an optional tinted glyph followed by its label. */
@Composable
private fun StatItem(
    icon: ImageVector?,
    iconTint: Color,
    text: String,
    textColor: Color,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, size = IconSize.Xs, tint = iconTint)
        }
        Text(text, style = MaterialTheme.typography.labelMedium, color = textColor)
    }
}

/** The pulsing "Firing" indicator — a cyan/info Zap glyph + label, honoring the reduce-motion preference. */
@Composable
private fun FiringIndicator(label: String) {
    val pulseAlpha = firingPulseAlpha()
    Row(
        modifier = Modifier.alpha(pulseAlpha).semantics { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(ZapGlyph, contentDescription = null, size = IconSize.Xs, tint = TeslaTokens.status.info)
        Text(label, style = MaterialTheme.typography.labelSmall, color = TeslaTokens.status.info)
    }
}

/** A small inline notice banner (auto-disabled reason / conflict) — a low-alpha wash behind tinted content. */
@Composable
private fun InlineNotice(
    icon: ImageVector,
    text: String,
    container: Color,
    content: Color,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = container,
        contentColor = content,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(icon, contentDescription = null, size = IconSize.Sm, tint = content)
            Text(text, style = MaterialTheme.typography.labelMedium, color = content)
        }
    }
}

/** First-load skeleton — a title bar plus two lines so the panel is never a blank box while loading. */
@Composable
private fun AutomationCardLoading(label: String) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
        Skeleton(widthFraction = SKELETON_BODY_FRACTION, height = SKELETON_LINE_HEIGHT)
        Skeleton(widthFraction = SKELETON_STAT_FRACTION, height = SKELETON_LINE_HEIGHT)
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun AutomationCardError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Empty surface — shown when no automation resolves, so the panel is never a blank box. */
@Composable
private fun AutomationCardEmpty(message: String) {
    EmptyState(
        message = message,
        icon = SkipForwardGlyph,
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * The freshness chip rendered above the body when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance shared with the sibling surfaces.
 */
@Composable
private fun AutomationFreshnessRow(state: UiState<*>) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
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
            formatAge = rememberAutomationFreshnessFormatter(),
        )
    }
}

// ── Render-only helpers ────────────────────────────────────────────────────────────────────────────────────

/** The web status-badge variant: active → success, disabled → neutral, auto-disabled → danger. */
private fun statusVariant(status: AutomationUiStatus): BadgeVariant =
    when (status) {
        AutomationUiStatus.Active -> BadgeVariant.Success
        AutomationUiStatus.Disabled -> BadgeVariant.Neutral
        AutomationUiStatus.AutoDisabled -> BadgeVariant.Danger
    }

/** The localized status label for the badge. */
private fun statusLabel(
    status: AutomationUiStatus,
    strings: AutomationCardStrings,
): String =
    when (status) {
        AutomationUiStatus.Active -> strings.statusActive
        AutomationUiStatus.Disabled -> strings.statusDisabled
        AutomationUiStatus.AutoDisabled -> strings.statusAutoDisabled
    }

/** The web conflict color: warning → amber/warning token, info → blue/info token. */
@Composable
private fun conflictColor(severity: ConflictSeverity): Color =
    when (severity) {
        ConflictSeverity.Warning -> TeslaTokens.status.warning
        ConflictSeverity.Info -> TeslaTokens.status.info
    }

/** The firing-indicator pulse alpha — a static full alpha under reduced motion, else a slow reverse pulse. */
@Composable
private fun firingPulseAlpha(): Float {
    if (rememberReducedMotion()) return PULSE_MAX_ALPHA
    val transition = rememberInfiniteTransition(label = "firing")
    val alpha by transition.animateFloat(
        initialValue = PULSE_MIN_ALPHA,
        targetValue = PULSE_MAX_ALPHA,
        animationSpec = infiniteRepeatable(animation = tween(PULSE_PERIOD_MS), repeatMode = RepeatMode.Reverse),
        label = "firing-alpha",
    )
    return alpha
}

/** A small caption-styled label in the secondary content color (the muted stat/vehicle text). */
@Composable
private fun Caption(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** English fallback for the relative age (the web `timeAgo` strings) — overridden by the localized catalog. */
private fun formatFreshness(age: FreshnessAge): String =
    when (age) {
        FreshnessAge.Unknown -> EM_DASH
        FreshnessAge.JustNow -> "just now"
        is FreshnessAge.Seconds -> "${age.value}s ago"
        is FreshnessAge.Minutes -> "${age.value}m ago"
        is FreshnessAge.Hours -> "${age.value}h ago"
        is FreshnessAge.Days -> "${age.value}d ago"
        is FreshnessAge.Weeks -> "${age.value}w ago"
    }

/**
 * Builds the localized [AutomationCardStrings] from the i18n catalog (P1/S10): the `automations.*`,
 * `automations.stats.*` (status labels), `common.*`, and `pin.*` keys the web component reads. Remembered
 * against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberAutomationCardStrings(): AutomationCardStrings {
    val statusActive = stringResource(R.string.translation_automations_stats_active)
    val statusDisabled = stringResource(R.string.translation_automations_stats_disabled)
    val statusAutoDisabled = stringResource(R.string.translation_automations_stats_autoDisabled)
    val firing = stringResource(R.string.translation_automations_firing)
    val toggleLabel = stringResource(R.string.translation_automations_toggleLabel)
    val menu = stringResource(R.string.translation_automations_menu)
    val testRun = stringResource(R.string.translation_automations_testRun)
    val reEnable = stringResource(R.string.translation_automations_reEnable)
    val duplicate = stringResource(R.string.translation_automations_duplicate)
    val export = stringResource(R.string.translation_automations_export)
    val delete = stringResource(R.string.translation_automations_delete)
    val deleteConfirm = stringResource(R.string.translation_automations_deleteConfirm)
    val allVehicles = stringResource(R.string.translation_automations_allVehicles)
    val lastRun = stringResource(R.string.translation_automations_lastRun)
    val neverRun = stringResource(R.string.translation_automations_neverRun)
    val runs = stringResource(R.string.translation_automations_runs)
    val fails = stringResource(R.string.translation_automations_fails)
    val nextFire = stringResource(R.string.translation_automations_nextFire)
    val conflictWith = stringResource(R.string.translation_automations_conflictWith)
    val deleteTitle = stringResource(R.string.translation_automations_deleteTitle)
    val cancel = stringResource(R.string.translation_common_cancel)
    val close = stringResource(R.string.translation_common_close)
    val noData = stringResource(R.string.translation_common_noData)
    val pin = stringResource(R.string.translation_pin_pin)
    val pinned = stringResource(R.string.translation_pin_pinned)
    return remember(statusActive, firing, menu, delete, runs, conflictWith, noData, pin) {
        AutomationCardStrings(
            statusActive = statusActive,
            statusDisabled = statusDisabled,
            statusAutoDisabled = statusAutoDisabled,
            firing = firing,
            toggleLabel = toggleLabel,
            menu = menu,
            testRun = testRun,
            reEnable = reEnable,
            duplicate = duplicate,
            export = export,
            delete = delete,
            deleteConfirm = deleteConfirm,
            allVehicles = allVehicles,
            lastRun = lastRun,
            neverRun = neverRun,
            runs = runs,
            fails = fails,
            nextFire = nextFire,
            conflictWith = conflictWith,
            deleteTitle = deleteTitle,
            cancel = cancel,
            close = close,
            noData = noData,
            pin = pin,
            pinned = pinned,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberAutomationFreshnessFormatter(): (FreshnessAge) -> String {
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

private const val SKELETON_TITLE_FRACTION: Float = 0.6f
private const val SKELETON_BODY_FRACTION: Float = 0.9f
private const val SKELETON_STAT_FRACTION: Float = 0.5f

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    AutomationCardStrings(
        statusActive = "Active",
        statusDisabled = "Disabled",
        statusAutoDisabled = "Auto-Disabled",
        firing = "Firing",
        toggleLabel = "Toggle automation",
        menu = "Actions menu",
        testRun = "Test Run",
        reEnable = "Re-enable",
        duplicate = "Duplicate",
        export = "Export",
        delete = "Delete",
        deleteConfirm = "Delete",
        allVehicles = "All vehicles",
        lastRun = "Last",
        neverRun = "Never run",
        runs = "Runs",
        fails = "Fails",
        nextFire = "Next",
        conflictWith = "Conflict with",
        deleteTitle = "Delete Automation",
        cancel = "Cancel",
        close = "Close",
        noData = "No data available",
        pin = "Pin",
        pinned = "Pinned",
    )

private val PREVIEW_ACTIVE =
    AutomationView(
        id = 1,
        name = "Precondition before commute",
        description = "Warm the cabin to 21°C on weekday mornings",
        enabled = true,
        vehicleId = 7,
        lastTriggeredAt = "2026-06-11T12:00:00Z",
        executionCount = 142,
        failureCount = 0,
        autoDisabled = false,
        autoDisabledReason = null,
        nextFireTime = "2026-06-12T14:30:00Z",
        conflicts = emptyList(),
    )

private val PREVIEW_AUTO_DISABLED =
    AutomationView(
        id = 2,
        name = "Charge to 80% overnight",
        description = "Stop charging at 80% between 23:00 and 06:00",
        enabled = false,
        vehicleId = null,
        lastTriggeredAt = null,
        executionCount = 9,
        failureCount = 3,
        autoDisabled = true,
        autoDisabledReason = "Disabled after 3 consecutive command failures",
        nextFireTime = null,
        conflicts =
            listOf(
                AutomationConflictView(3, "Charge to 90% on trips", "Overlapping charge limit", "warning"),
                AutomationConflictView(4, "Departure preconditioning", "Shared schedule window", "info"),
            ),
    )

@Preview(name = "Active", showBackground = true)
@Composable
private fun AutomationCardActivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AutomationCardContent(
            state = UiState(UiPhase.Content, data = PREVIEW_ACTIVE),
            onToggle = { _, _ -> },
            onReEnable = {},
            onDelete = {},
            onTestRun = {},
            onRetry = {},
            isFiring = true,
            vehicleName = "Model 3",
            zone = ZoneId.of("UTC"),
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Auto-disabled + conflicts", showBackground = true)
@Composable
private fun AutomationCardAutoDisabledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AutomationCardContent(
            state = UiState(UiPhase.Content, data = PREVIEW_AUTO_DISABLED),
            onToggle = { _, _ -> },
            onReEnable = {},
            onDelete = {},
            onTestRun = {},
            onRetry = {},
            zone = ZoneId.of("UTC"),
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun AutomationCardLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AutomationCardContent(
            state = UiState(UiPhase.Loading),
            onToggle = { _, _ -> },
            onReEnable = {},
            onDelete = {},
            onTestRun = {},
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun AutomationCardEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AutomationCardContent(
            state = UiState(UiPhase.Empty, data = null),
            onToggle = { _, _ -> },
            onReEnable = {},
            onDelete = {},
            onTestRun = {},
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}
