// The native Jetpack Compose + Material 3 SchemaDriftPage admin surface — a parity port of
// web/src/features/admin/pages/SchemaDriftPage.tsx, the schema-drift observability surface. It reproduces the
// page's panels (the "Drift status" summary panel with its drifted/clean badge and three Δ stat cards, the
// "Fingerprints" details panel with the Current + Expected fingerprint cards each carrying the
// Tables/Columns/Indexes count triple, and the no-fingerprint empty panel), the subsystem-unavailable banner
// (web 503 `SUBSYSTEM_NOT_CONFIGURED`), every data state (loading / empty / error / success), and every visible
// string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [SchemaDriftPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the single feed); [SchemaDriftPageContent] is the
// stateless render layer that draws the header, the optional subsystem banner, and the loading / error / empty /
// success surface for the one `useSchemaDrift` feed. All derivation lives in the framework-free model
// (SchemaDriftPageModel.kt); this file only resolves i18n + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.schemadrift

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.SectionErrorBoundary
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.rememberErrorBoundaryState
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.CardPadding
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.operatorconfidence.SchemaDriftResponse
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade). */
private const val FADE_STEP_MS = 40

/** At/above this width the stat/fingerprint cards lay out as a weighted row; below it they stack. */
private val GRID_BREAKPOINT: Dp = 600.dp

/** The page's interaction callbacks, wired to the [SchemaDriftPageViewModel] (web event handlers). */
data class SchemaDriftActions(
    val onRetry: () -> Unit,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SchemaDriftPageViewModel] over the supplied [source] (the host wires the
 * shared Operator-Confidence holder via [asSchemaDriftSource]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun SchemaDriftPage(
    source: SchemaDriftSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: SchemaDriftPageViewModel =
        viewModel(
            key = SchemaDriftPageRegistration.SLUG,
            factory = viewModelFactory { initializer { SchemaDriftPageViewModel(source, logger) } },
        )
    SchemaDriftPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: records the one-shot `view.opened` diagnostic and binds the feed to the stateless content. */
@Composable
fun SchemaDriftPage(
    viewModel: SchemaDriftPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val actions = remember(viewModel) { SchemaDriftActions(onRetry = viewModel::retry) }

    SchemaDriftPageContent(state = state, actions = actions, modifier = modifier)
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the title/subtitle header, the optional subsystem-unavailable banner (web 503), then
 * the single feed's loading / error / empty / success surface. On success it draws the "Drift status" summary
 * panel and the "Fingerprints" details panel; with no computed fingerprint it draws the empty panel; a hard
 * (non-503) failure draws a retryable error.
 */
@Composable
fun SchemaDriftPageContent(
    state: UiState<SchemaDriftResponse>,
    actions: SchemaDriftActions,
    modifier: Modifier = Modifier,
) {
    val subsystemMissing = state.httpStatus == HTTP_SUBSYSTEM_UNAVAILABLE
    val data = state.data
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        SchemaDriftHeader()

        if (subsystemMissing) {
            FadeIn { SubsystemUnavailableBanner() }
        }

        when {
            state.isLoading -> FadeIn { GlassPanel(padding = PanelPadding.Md) { LoadingState() } }

            !subsystemMissing && state.isError ->
                FadeIn { GlassPanel(padding = PanelPadding.Md) { ErrorState(onRetry = actions.onRetry) } }

            data != null && !data.isEmptyDrift -> {
                // GlassPanel1 — the drift-status summary (badge + three Δ stat cards).
                FadeIn { DriftSummary(data = data, locale = locale) }

                // GlassPanel2 — the current-vs-expected fingerprints, guarded by a section error boundary.
                FadeIn(delayMs = FADE_STEP_MS) {
                    val boundary = rememberErrorBoundaryState()
                    SectionErrorBoundary(state = boundary) { DriftDetails(data = data, locale = locale) }
                }
            }

            !subsystemMissing ->
                // GlassPanel6 — the no-fingerprint empty state.
                FadeIn { GlassPanel(padding = PanelPadding.Md) { SchemaDriftEmptyState() } }

            else -> Unit
        }
    }
}

/** The page header — the title + muted subtitle (web `PageContainer` title/subtitle). */
@Composable
private fun SchemaDriftHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_admin_schemaDrift_pageTitle))
        BodyText(
            stringResource(R.string.translation_admin_schemaDrift_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The 503 subsystem-not-configured banner (web `<AlertBanner variant="warning">`). */
@Composable
private fun SubsystemUnavailableBanner() {
    AlertBanner(
        message = stringResource(R.string.translation_admin_schemaDrift_notConfigured),
        tone = Tone.Warning,
        title = stringResource(R.string.translation_admin_subsystem_unavailableTitle),
    )
}

// ── Data states ─────────────────────────────────────────────────────────────────────────────────────────────

/** First-load surface — a centered spinner so the panel region is never blank (web freshness indicator). */
@Composable
private fun LoadingState() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spinner(size = SpinnerSize.Md)
    }
}

/** Hard-error surface with a retry affordance (web page-tier error). */
@Composable
private fun ErrorState(onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            TeslaGlyphs.Octagon,
            contentDescription = null,
            size = IconSize.Xl,
            tint = MaterialTheme.colorScheme.error,
        )
        ErrorText(stringResource(R.string.translation_error_loadFailed))
        Button(
            label = stringResource(R.string.translation_error_retry),
            onClick = onRetry,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
        )
    }
}

/** No-fingerprint empty state (web `<EmptyState icon={Fingerprint} ...>`). */
@Composable
private fun SchemaDriftEmptyState() {
    EmptyState(
        message = stringResource(R.string.translation_admin_schemaDrift_emptyMessage),
        icon = SchemaDriftGlyphs.Fingerprint,
        title = stringResource(R.string.translation_admin_schemaDrift_emptyTitle),
    )
}

// ── GlassPanel1 — drift-status summary ────────────────────────────────────────────────────────────────────────

/** The "Drift status" panel: the status badge and the three table/column/index Δ stat cards (web `DriftSummary`). */
@Composable
private fun DriftSummary(
    data: SchemaDriftResponse,
    locale: Locale,
) {
    val drift = data.drift
    GlassPanel(padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PanelTitle(stringResource(R.string.translation_admin_schemaDrift_statusTitle))
                StatusChip(drifted = data.isDrifted)
            }
            ResponsiveCells(count = 3) { index, cellModifier ->
                when (index) {
                    0 ->
                        StatCard(
                            label = stringResource(R.string.translation_admin_schemaDrift_tableDelta),
                            value = formatDelta(drift.tableCountDelta, locale),
                            sublabel =
                                stringResource(
                                    R.string.translation_admin_schemaDrift_tableSub,
                                    formatCount(drift.current.tableCount, locale),
                                    formatCount(drift.expected.tableCount, locale),
                                ),
                            modifier = cellModifier,
                        )

                    1 ->
                        StatCard(
                            label = stringResource(R.string.translation_admin_schemaDrift_columnDelta),
                            value = formatDelta(drift.columnCountDelta, locale),
                            sublabel =
                                stringResource(
                                    R.string.translation_admin_schemaDrift_columnSub,
                                    formatCount(drift.current.columnCount, locale),
                                    formatCount(drift.expected.columnCount, locale),
                                ),
                            modifier = cellModifier,
                        )

                    else ->
                        StatCard(
                            label = stringResource(R.string.translation_admin_schemaDrift_indexDelta),
                            value = formatDelta(drift.indexCountDelta, locale),
                            sublabel =
                                stringResource(
                                    R.string.translation_admin_schemaDrift_indexSub,
                                    formatCount(drift.current.indexCount, locale),
                                    formatCount(drift.expected.indexCount, locale),
                                ),
                            modifier = cellModifier,
                        )
                }
            }
        }
    }
}

/** The drifted/clean status chip — the web `<Badge>` with its leading AlertTriangle / CheckCircle2 glyph. */
@Composable
private fun StatusChip(drifted: Boolean) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = if (drifted) SchemaDriftGlyphs.AlertTriangle else SchemaDriftGlyphs.CheckCircle2,
            contentDescription = null,
            size = IconSize.Sm,
            tint = if (drifted) TeslaTokens.status.warning else TeslaTokens.status.success,
        )
        Badge(
            text =
                if (drifted) {
                    stringResource(R.string.translation_admin_schemaDrift_statusDrifted)
                } else {
                    stringResource(R.string.translation_admin_schemaDrift_statusClean)
                },
            variant = if (drifted) BadgeVariant.Warning else BadgeVariant.Success,
        )
    }
}

// ── GlassPanel2 — fingerprints ────────────────────────────────────────────────────────────────────────────────

/** The "Fingerprints" panel: the Current + Expected fingerprint cards (web `DriftDetails`). */
@Composable
private fun DriftDetails(
    data: SchemaDriftResponse,
    locale: Locale,
) {
    val drift = data.drift
    GlassPanel(padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            PanelTitle(stringResource(R.string.translation_admin_schemaDrift_fingerprintTitle))
            ResponsiveCells(count = 2) { index, cellModifier ->
                if (index == 0) {
                    FingerprintCard(
                        title = stringResource(R.string.translation_admin_schemaDrift_fingerprintCurrent),
                        sha256 = drift.current.sha256,
                        tableCount = drift.current.tableCount,
                        columnCount = drift.current.columnCount,
                        indexCount = drift.current.indexCount,
                        generatedAt = null,
                        locale = locale,
                        modifier = cellModifier,
                    )
                } else {
                    FingerprintCard(
                        title = stringResource(R.string.translation_admin_schemaDrift_fingerprintExpected),
                        sha256 = drift.expected.sha256,
                        tableCount = drift.expected.tableCount,
                        columnCount = drift.expected.columnCount,
                        indexCount = drift.expected.indexCount,
                        generatedAt = drift.expectedGeneratedAt,
                        locale = locale,
                        modifier = cellModifier,
                    )
                }
            }
        }
    }
}

/** One fingerprint card: the title, the SHA, the Tables/Columns/Indexes count triple, and the optional stamp. */
@Composable
private fun FingerprintCard(
    title: String,
    sha256: String,
    tableCount: Long,
    columnCount: Long,
    indexCount: Long,
    generatedAt: String?,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    Card(modifier = modifier, padding = CardPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Subhead(title)
            CodeText(sha256.ifBlank { EM_DASH }, modifier = Modifier.fillMaxWidth())
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                FingerprintStat(
                    label = stringResource(R.string.translation_admin_schemaDrift_tables),
                    value = tableCount,
                    locale = locale,
                    modifier = Modifier.weight(1f),
                )
                FingerprintStat(
                    label = stringResource(R.string.translation_admin_schemaDrift_columns),
                    value = columnCount,
                    locale = locale,
                    modifier = Modifier.weight(1f),
                )
                FingerprintStat(
                    label = stringResource(R.string.translation_admin_schemaDrift_indexes),
                    value = indexCount,
                    locale = locale,
                    modifier = Modifier.weight(1f),
                )
            }
            if (!generatedAt.isNullOrBlank()) {
                Caption(
                    stringResource(
                        R.string.translation_admin_schemaDrift_generatedAt,
                        formatTimestamp(generatedAt),
                    ),
                )
            }
        }
    }
}

/** One centered count cell inside a fingerprint card — the web `FingerprintStat` (value over label). */
@Composable
private fun FingerprintStat(
    label: String,
    value: Long,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        PanelTitle(formatCount(value, locale))
        Caption(label)
    }
}

// ── Responsive layout ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Lays out [count] cells responsively: a weighted [Row] at/above [GRID_BREAKPOINT] (web `md:grid-cols-N`), a
 * stacked [Column] below it (web `grid-cols-1`). [cell] receives each child's scope-correct width modifier so
 * the breakpoint logic lives in one place.
 */
@Composable
private fun ResponsiveCells(
    count: Int,
    modifier: Modifier = Modifier,
    cell: @Composable (index: Int, cellModifier: Modifier) -> Unit,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        if (maxWidth >= GRID_BREAKPOINT) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                repeat(count) { index -> cell(index, Modifier.weight(1f)) }
            }
        } else {
            Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                repeat(count) { index -> cell(index, Modifier.fillMaxWidth()) }
            }
        }
    }
}

private val TS_FORMATTER: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss 'UTC'")

/** Formats an ISO-8601 stamp as a readable UTC time (web `formatDateTime`); returns the raw value on a parse miss. */
private fun formatTimestamp(ts: String): String =
    runCatching { OffsetDateTime.parse(ts).atZoneSameInstant(ZoneOffset.UTC).format(TS_FORMATTER) }
        .getOrDefault(ts)
