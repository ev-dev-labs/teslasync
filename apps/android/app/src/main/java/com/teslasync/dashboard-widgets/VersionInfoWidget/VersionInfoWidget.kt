// The native Jetpack Compose + Material 3 Version Info dashboard surface — a parity port of
// web/src/features/dashboard/widgets/VersionInfoWidget.tsx. It mirrors the web `WidgetShell` (skeleton while
// loading, a retry surface on hard error, otherwise a freshness header) wrapping the three web layouts: the
// compact 1×2 (centered bold version + neutral SHA badge), and the standard / wide layout (a `KVList`
// definition list — Version, Build Date, Git SHA, Go Version, Uptime — plus a `WidgetStatGrid`, with the
// wide footprint adding the OS/Arch line and two extra stat tiles). When no version payload resolves it
// shows the friendly "No version data available" empty state. All data flows through the shared
// [VersionInfoWidgetViewModel]; the view never performs HTTP. Every string resolves through the i18n catalog
// (P1/S10) and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/VersionInfoWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.versioninfo

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

private const val BULLET = "\u2022"

/** Minimum row / compact-block height so every pair is a comfortable TalkBack + touch target. */
private val ROW_MIN_HEIGHT = 44.dp

/** Skeleton chrome dimensions while the first load is in flight. */
private val LOADING_TITLE_HEIGHT = 14.dp
private val LOADING_ROW_HEIGHT = 28.dp
private const val LOADING_TITLE_FRACTION = 0.4f

/** Stat tiles fold to two columns on the narrow widget footprint (web `@container` 4-up ⇒ 2-up collapse). */
private const val STAT_COLUMNS = 2

/**
 * Stateful entry point. Binds the shared Settings feeds via [source] into a [VersionInfoWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard
 * host supplies [source] (an adapter over the shared S7/S8 Settings data layer) and a unique [instanceKey]
 * per placement.
 *
 * @param source the cache-then-network seam (a `SettingsStore`/`SettingsRepository` adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun VersionInfoWidget(
    source: VersionInfoSource,
    modifier: Modifier = Modifier,
    size: VersionInfoSize = VersionInfoRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = VersionInfoRegistration.ID,
) {
    val viewModel: VersionInfoWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { VersionInfoWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    VersionInfoWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web `WidgetShell`
 * short-circuits (loading → skeleton, hard error → retry) and otherwise a freshness header (title + icon only
 * when not compact, web `isCompact ? undefined : …`) over the compact / standard / wide body or, when no
 * version payload resolves, the empty state. Stale (non-error) data auto-refreshes, mirroring the web
 * freshness contract. [locale] drives the number grouping (tests pin a deterministic locale).
 */
@Composable
fun VersionInfoWidgetContent(
    state: UiState<VersionInfoState>,
    size: VersionInfoSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberVersionInfoStrings()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> VersionInfoLoading(label = stringResource(R.string.translation_common_loading))
            state.isError -> VersionInfoError(onRetry = onRefresh)
            else -> {
                VersionInfoHeader(showTitle = !size.isCompact, title = strings.title, state = state, onRefresh = onRefresh)
                val version = state.data?.version
                if (version == null) {
                    VersionInfoEmpty(message = strings.noData)
                } else {
                    val capture = state.data.capture
                    val display =
                        remember(version, capture, strings, size, locale) {
                            VersionInfoProjection.project(version, capture, strings, size, locale)
                        }
                    if (size.isCompact) VersionInfoCompact(display) else VersionInfoStandard(display, size)
                }
            }
        }
    }
}

@Composable
private fun VersionInfoHeader(
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
                VersionInfoGlyphs.Info,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.success,
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

/** Web compact 1×2: a centered bold version with the truncated commit in a neutral badge below it. */
@Composable
private fun VersionInfoCompact(display: VersionInfoDisplay) {
    Column(
        modifier = Modifier.fillMaxWidth().heightIn(min = ROW_MIN_HEIGHT),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.CenterVertically),
    ) {
        Text(
            display.compactVersion,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Badge(text = display.compactSha, variant = BadgeVariant.Neutral)
    }
}

/** Web standard / wide: the definition list, the wide-only OS/Arch line, then the stat grid. */
@Composable
private fun VersionInfoStandard(
    display: VersionInfoDisplay,
    size: VersionInfoSize,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        VersionDefinitionList(items = display.kvItems)
        val osText = display.osText
        val archText = display.archText
        if (size.isWide && osText != null && archText != null) {
            OsArchLine(osText = osText, archText = archText)
        }
        VersionStatGrid(stats = display.statItems)
    }
}

@Composable
private fun VersionDefinitionList(items: List<VersionKvRow>) {
    Column(modifier = Modifier.fillMaxWidth()) {
        items.forEachIndexed { index, item ->
            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            VersionKvRowItem(item)
        }
    }
}

@Composable
private fun VersionKvRowItem(item: VersionKvRow) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = ROW_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = "${item.label}, ${item.value}" }
                .padding(vertical = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(item.label, modifier = Modifier.weight(1f))
        when (item.emphasis) {
            ValueEmphasis.Mono -> CodeText(item.value)
            ValueEmphasis.Bold ->
                Text(
                    item.value,
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            ValueEmphasis.Normal -> BodyText(item.value, maxLines = 1)
        }
    }
}

@Composable
private fun OsArchLine(
    osText: String,
    archText: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(osText)
        Caption(BULLET)
        Caption(archText)
    }
}

@Composable
private fun VersionStatGrid(stats: List<VersionStat>) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        stats.chunked(STAT_COLUMNS).forEach { row ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                row.forEach { stat ->
                    StatCard(label = stat.label, value = stat.value, modifier = Modifier.weight(1f))
                }
                repeat(STAT_COLUMNS - row.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun VersionInfoEmpty(message: String) {
    EmptyState(
        message = message,
        icon = VersionInfoGlyphs.Info,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun VersionInfoLoading(label: String) {
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
private fun VersionInfoError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [VersionInfoStrings] from the i18n catalog (P1/S10) — the thirteen
 * `widget.versionInfo.*` keys the web component reads via `t('widget.versionInfo.…')`. Remembered against the
 * resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberVersionInfoStrings(): VersionInfoStrings {
    val title = stringResource(R.string.translation_widget_versionInfo_title)
    val version = stringResource(R.string.translation_widget_versionInfo_version)
    val buildDate = stringResource(R.string.translation_widget_versionInfo_buildDate)
    val gitSha = stringResource(R.string.translation_widget_versionInfo_gitSha)
    val goVersion = stringResource(R.string.translation_widget_versionInfo_goVersion)
    val uptime = stringResource(R.string.translation_widget_versionInfo_uptime)
    val signalsPerSec = stringResource(R.string.translation_widget_versionInfo_signalsPerSec)
    val messagesToday = stringResource(R.string.translation_widget_versionInfo_messagesToday)
    val bytesProcessed = stringResource(R.string.translation_widget_versionInfo_bytesProcessed)
    val avgLatency = stringResource(R.string.translation_widget_versionInfo_avgLatency)
    val os = stringResource(R.string.translation_widget_versionInfo_os)
    val arch = stringResource(R.string.translation_widget_versionInfo_arch)
    val noData = stringResource(R.string.translation_widget_versionInfo_noData)
    return remember(
        title,
        version,
        buildDate,
        gitSha,
        goVersion,
        uptime,
        signalsPerSec,
        messagesToday,
        bytesProcessed,
        avgLatency,
        os,
        arch,
        noData,
    ) {
        VersionInfoStrings(
            title = title,
            version = version,
            buildDate = buildDate,
            gitSha = gitSha,
            goVersion = goVersion,
            uptime = uptime,
            signalsPerSec = signalsPerSec,
            messagesToday = messagesToday,
            bytesProcessed = bytesProcessed,
            avgLatency = avgLatency,
            os = os,
            arch = arch,
            noData = noData,
        )
    }
}

/**
 * Self-contained line glyph for the surface, authored as a 24×24 stroked vector (the web library leans on
 * lucide-react's `Info`, which has no bundled Android equivalent). Monochrome and recolored at render time by
 * the [Icon] tint.
 */
private object VersionInfoGlyphs {
    /** Info circle — header + empty-state icon (web `Info`). */
    val Info: ImageVector =
        versionInfoVector("VersionInfoCircle") {
            moveTo(3f, 12f)
            arcTo(9f, 9f, 0f, true, true, 21f, 12f)
            arcTo(9f, 9f, 0f, true, true, 3f, 12f)
            close()
            moveTo(12f, 11f)
            lineTo(12f, 16f)
            moveTo(12f, 8f)
            lineTo(12f, 8.01f)
        }
}

private fun versionInfoVector(
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
