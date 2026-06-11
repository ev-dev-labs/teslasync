// The native Jetpack Compose + Material 3 Subscriptions dashboard surface — a parity port of
// web/src/features/dashboard/widgets/SubscriptionsWidget.tsx. It mirrors the web `WidgetShell` (skeleton
// while loading, a retry surface on hard error, otherwise a freshness header) wrapping two layouts: the
// compact (1-column) active-count hero (CreditCard glyph + active count + the "active" label + the soonest
// expiry chip, web `isCompact`) and the standard subscription list — the web `WidgetDetailCard` rows
// (subscription name, formatted expiry / renewal value, an Active/Expired badge) or a friendly empty state.
// All data flows through the shared [SubscriptionsWidgetViewModel]; the raw SI JSON envelope is parsed +
// projected at this render boundary via the pure [SubscriptionsProjection]. The view never performs HTTP.
// Every chrome string resolves through the i18n catalog (P1/S10) — the six known-type labels through the
// same key+fallback contract as the web `t(labelKey, fallback)` — and every interactive element carries a
// TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SubscriptionsWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.subscriptions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement

/** Minimum height so the compact hero + each detail row is a comfortable TalkBack + touch target (web `min-h-[44px]`). */
private val MIN_TARGET_HEIGHT = 44.dp

/** Skeleton chrome dimensions while the first load is in flight. */
private val LOADING_TITLE_HEIGHT = 14.dp
private val LOADING_ROW_HEIGHT = 28.dp
private const val LOADING_TITLE_FRACTION = 0.4f

/**
 * Stateful entry point. Binds the shared vehicles + subscriptions feeds via [source] into a
 * [SubscriptionsWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the surface for
 * the given [size]. A dashboard host supplies [source] (an adapter over the shared S7/S8 vehicles data
 * layer), an optional bound [vehicleId] (web `WidgetProps.vehicleId`; `null` ⇒ first enrolled vehicle), and a
 * unique [instanceKey] per placement.
 *
 * @param source the cache-then-network seam (a `VehiclesStore`/`VehiclesRepository` adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SubscriptionsWidget(
    source: SubscriptionsSource,
    modifier: Modifier = Modifier,
    size: SubscriptionsSize = SubscriptionsRegistration.defaultSize,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SubscriptionsRegistration.ID,
) {
    val viewModel: SubscriptionsWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { SubscriptionsWidgetViewModel(source, logger, vehicleId = vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    SubscriptionsWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web `WidgetShell`
 * short-circuits (loading → skeleton, hard error → retry) and otherwise a freshness header (title + icon only
 * when not compact, web `isCompact ? undefined : …`) over the compact hero / standard list / empty state.
 * Stale (non-error) data auto-refreshes, mirroring the web freshness contract. [nowMillis] anchors the
 * `daysUntil` expiry math (tests pin a deterministic value).
 */
@Composable
fun SubscriptionsWidgetContent(
    state: UiState<JsonElement>,
    size: SubscriptionsSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = System.currentTimeMillis(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberSubscriptionsStrings()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> SubscriptionsLoading(label = stringResource(R.string.translation_common_loading))
            state.isError -> SubscriptionsError(onRetry = onRefresh)
            else -> {
                val display =
                    remember(state.data, strings) {
                        SubscriptionsProjection.projectEnvelope(state.data, strings, nowMillis)
                    }
                SubscriptionsHeader(showTitle = !size.isCompact, title = strings.title, state = state, onRefresh = onRefresh)
                if (size.isCompact) {
                    SubscriptionsCompact(display = display, strings = strings)
                } else {
                    SubscriptionsStandard(display = display, strings = strings)
                }
            }
        }
    }
}

@Composable
private fun SubscriptionsHeader(
    showTitle: Boolean,
    title: String,
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (showTitle) {
            Icon(
                SubscriptionsGlyphs.CreditCard,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.info,
            )
            PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = !showTitle,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

/**
 * Compact (1-column) hero — the web `isCompact` branch: a CreditCard glyph, the active subscription count, the
 * "active" label, and the soonest upcoming expiry chip. When no subscription resolves it shows the friendly
 * empty state (web `parsed.length > 0 ? … : <EmptyState/>`). The populated hero folds into one TalkBack phrase.
 */
@Composable
private fun SubscriptionsCompact(
    display: SubscriptionsDisplay,
    strings: SubscriptionsStrings,
) {
    if (!display.hasSubscriptions) {
        SubscriptionsEmpty(message = strings.noData)
        return
    }
    val description =
        buildString {
            append(display.activeCount)
            append(' ')
            append(strings.activeCount)
            display.nextExpiryLabel?.let {
                append(", ")
                append(it)
            }
        }
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TARGET_HEIGHT)
                .clearAndSetSemantics { contentDescription = description },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        Icon(
            SubscriptionsGlyphs.CreditCard,
            contentDescription = null,
            size = IconSize.Md,
            tint = TeslaTokens.status.info,
        )
        MetricValue(display.activeCount.toString())
        MetricLabel(strings.activeCount)
        display.nextExpiryLabel?.let { label ->
            Badge(text = label, variant = BadgeVariant.Neutral)
        }
    }
}

/**
 * Standard (≥2-column) layout — the web `WidgetDetailCard` list: one divider-separated row per subscription
 * (name, formatted expiry/renewal value, an Active/Expired badge), or the friendly empty state when no
 * subscription resolves (web `WidgetDetailCard` empty branch).
 */
@Composable
private fun SubscriptionsStandard(
    display: SubscriptionsDisplay,
    strings: SubscriptionsStrings,
) {
    if (!display.hasSubscriptions) {
        SubscriptionsEmpty(message = display.emptyMessage)
        return
    }
    Column(modifier = Modifier.fillMaxWidth()) {
        display.entries.forEachIndexed { index, entry ->
            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            SubscriptionRow(entry = entry, strings = strings)
        }
    }
}

@Composable
private fun SubscriptionRow(
    entry: SubscriptionEntry,
    strings: SubscriptionsStrings,
) {
    val badgeText = if (entry.active) strings.active else strings.expired
    val badgeVariant = if (entry.active) BadgeVariant.Success else BadgeVariant.Danger
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TARGET_HEIGHT)
                .clearAndSetSemantics { contentDescription = "${entry.label}, ${entry.value}, $badgeText" }
                .padding(vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(entry.label, modifier = Modifier.weight(1f))
        BodyText(entry.value, maxLines = 1)
        Badge(text = badgeText, variant = badgeVariant)
    }
}

@Composable
private fun SubscriptionsEmpty(message: String) {
    EmptyState(
        message = message,
        icon = SubscriptionsGlyphs.CreditCard,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun SubscriptionsLoading(label: String) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
        Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
        Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
        Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
    }
}

@Composable
private fun SubscriptionsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [SubscriptionsStrings] from the i18n catalog (P1/S10). The six chrome keys
 * (`widget.subscriptions.{title,active,expired,activeCount,noData,unknown}`) resolve through `stringResource`;
 * the six known-type labels resolve through [stringResourceOrFallback], reproducing the web `t(labelKey,
 * fallback)` contract (those label keys ship only as fallbacks, so a missing catalog key uses the literal —
 * and a translation is picked up automatically if the key is ever added). Remembered against the resolved
 * values so a locale change re-projects the surface.
 */
@Composable
private fun rememberSubscriptionsStrings(): SubscriptionsStrings {
    val title = stringResource(R.string.translation_widget_subscriptions_title)
    val active = stringResource(R.string.translation_widget_subscriptions_active)
    val expired = stringResource(R.string.translation_widget_subscriptions_expired)
    val activeCount = stringResource(R.string.translation_widget_subscriptions_activeCount)
    val noData = stringResource(R.string.translation_widget_subscriptions_noData)
    val unknown = stringResource(R.string.translation_widget_subscriptions_unknown)
    val typeLabels =
        SUBSCRIPTION_TYPES.associate { spec -> spec.dataKey to stringResourceOrFallback(spec.resourceKey, spec.fallback) }
    return remember(title, active, expired, activeCount, noData, unknown, typeLabels) {
        SubscriptionsStrings(
            title = title,
            active = active,
            expired = expired,
            activeCount = activeCount,
            noData = noData,
            unknown = unknown,
            typeLabels = typeLabels,
        )
    }
}

/**
 * Resolves the string resource named [resourceKey], falling back to [fallback] when the catalog has no such
 * key — the native analogue of the web `t(key, fallback)`. Keeps the surface i18n-correct (a translation is
 * used the moment the key is added to the catalog) without hard-coding English in the layout.
 */
@Composable
private fun stringResourceOrFallback(
    resourceKey: String,
    fallback: String,
): String {
    val context = LocalContext.current
    val id = remember(resourceKey) { context.resources.getIdentifier(resourceKey, "string", context.packageName) }
    return if (id != 0) stringResource(id) else fallback
}

/**
 * Self-contained line glyph for the surface, authored as a 24×24 stroked vector (the web library leans on
 * lucide-react's `CreditCard`, which has no bundled Android equivalent). Monochrome and recolored at render
 * time by the [Icon] tint.
 */
private object SubscriptionsGlyphs {
    /** Credit-card outline with a magnetic-stripe line — header + hero + empty-state icon (web `CreditCard`). */
    val CreditCard: ImageVector =
        subscriptionsVector("SubscriptionsCreditCard") {
            moveTo(2f, 6f)
            lineTo(22f, 6f)
            lineTo(22f, 18f)
            lineTo(2f, 18f)
            close()
            moveTo(2f, 10f)
            lineTo(22f, 10f)
        }
}

private fun subscriptionsVector(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
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
                pathBuilder = build,
            )
        }.build()
