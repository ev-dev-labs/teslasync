// The native Jetpack Compose + Material 3 DiskForecastPage admin surface — a parity port of
// web/src/features/admin/pages/DiskForecastPage.tsx, the per-hypertable disk-usage forecast (compressed /
// uncompressed split, growth bytes/day, days-to-quota estimate, backend-computed severity). It reproduces the
// page's panels (the four fleet stat tiles + the per-hypertable table), every data state (loading / empty /
// error / content, plus the HTTP-503 "subsystem not configured" branch), and every visible string (resolved
// from the generated res/values catalog, ADR-014).
//
// Composition: [DiskForecastPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the feed); [DiskForecastPageContent] is the stateless
// render layer driven entirely by [UiState]. All derivation lives in the framework-free model
// (DiskForecastPageModel.kt); this file only resolves i18n + formats at the display boundary (web `formatBytes`
// / `fmtNumber`, binary-prefix + locale numbers) + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.admin.diskforecast

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.operatorconfidence.DiskForecastResponse
import io.teslasync.shared.core.presentation.operatorconfidence.HypertableSize
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.floor

private const val FADE_STEP_MS = 60

// ── Stateful entry points ─────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [DiskForecastPageViewModel] over the supplied [source] (the host wires the
 * shared [io.teslasync.shared.core.presentation.operatorconfidence.OperatorConfidenceStore] via
 * [asDiskForecastSource]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun DiskForecastPage(
    source: DiskForecastSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: DiskForecastPageViewModel =
        viewModel(
            key = DiskForecastPageRegistration.SLUG,
            factory = viewModelFactory { initializer { DiskForecastPageViewModel(source, logger) } },
        )
    DiskForecastPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feed to the stateless content. */
@Composable
fun DiskForecastPage(
    viewModel: DiskForecastPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val actions = remember(viewModel) { DiskForecastActions(onRetry = viewModel::retry) }

    DiskForecastPageContent(state = state, actions = actions, modifier = modifier)
}

// ── Stateless content ─────────────────────────────────────────────────────────────────────────────────────

/** The stateless page body: the header, the optional subsystem banner, the fleet stats, and the table. */
@Composable
fun DiskForecastPageContent(
    state: UiState<DiskForecastResponse>,
    actions: DiskForecastActions,
    modifier: Modifier = Modifier,
) {
    val view = DiskForecastView.from(state.data)
    val subsystemMissing = isSubsystemMissing(state.httpStatus)
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
    val formats = remember(locale) { DiskForecastFormats(locale) }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        DiskForecastHeader()

        if (subsystemMissing) {
            AlertBanner(
                tone = Tone.Warning,
                title = stringResource(R.string.translation_admin_subsystem_unavailableTitle),
                message = stringResource(R.string.translation_admin_diskForecast_notConfigured),
            )
        }

        if (view.hasRows) {
            FadeIn { DiskForecastStatsGrid(view = view, formats = formats) }
        }

        FadeIn(delayMs = FADE_STEP_MS) {
            DiskForecastTablePanel(
                state = state,
                view = view,
                subsystemMissing = subsystemMissing,
                formats = formats,
                actions = actions,
            )
        }
    }
}

@Composable
private fun DiskForecastHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_admin_diskForecast_pageTitle))
        BodyText(
            stringResource(R.string.translation_admin_diskForecast_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── Fleet stat tiles (Total-disk / Uncompressed / Compressed / Growth-per-day) ──────────────────────────────

@Composable
private fun DiskForecastStatsGrid(
    view: DiskForecastView,
    formats: DiskForecastFormats,
) {
    val totals = view.totals
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_admin_diskForecast_fleetTotal),
                value = formats.bytes(totals.totalBytes),
                modifier = Modifier.weight(1f),
                sublabel =
                    stringResource(
                        R.string.translation_admin_diskForecast_tableCount,
                        formats.int(view.rows.size),
                    ),
            )
            StatCard(
                label = stringResource(R.string.translation_admin_diskForecast_fleetUncompressed),
                value = formats.bytes(totals.uncompressedBytes),
                modifier = Modifier.weight(1f),
                sublabel = percentSublabel(totals.uncompressedPercent, formats),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_admin_diskForecast_fleetCompressed),
                value = formats.bytes(totals.compressedBytes),
                modifier = Modifier.weight(1f),
                sublabel = percentSublabel(totals.compressedPercent, formats),
            )
            StatCard(
                label = stringResource(R.string.translation_admin_diskForecast_fleetGrowth),
                value = formats.bytesPerDay(totals.growthBytesPerDay),
                modifier = Modifier.weight(1f),
                sublabel = stringResource(R.string.translation_admin_diskForecast_growthSub),
            )
        }
    }
}

/** The share-of-total sublabel, or the em-dash when the fleet has no bytes (web `total > 0 ? '{{pct}}%…' : '—'`). */
@Composable
private fun percentSublabel(
    percent: Double?,
    formats: DiskForecastFormats,
): String =
    if (percent == null) {
        EM_DASH
    } else {
        stringResource(R.string.translation_admin_diskForecast_percentSub, formats.percent(percent))
    }

// ── Table panel (GlassPanel5) + the loading / empty / error / content state matrix ──────────────────────────

@Composable
private fun DiskForecastTablePanel(
    state: UiState<DiskForecastResponse>,
    view: DiskForecastView,
    subsystemMissing: Boolean,
    formats: DiskForecastFormats,
    actions: DiskForecastActions,
) {
    val tableTitle = stringResource(R.string.translation_admin_diskForecast_tableTitle)
    GlassPanel(
        padding = PanelPadding.None,
        modifier = Modifier.semantics { contentDescription = tableTitle },
    ) {
        PanelTitle(tableTitle, modifier = Modifier.padding(Spacing.md))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        when {
            state.isLoading -> DiskForecastLoadingState()
            subsystemMissing -> DiskForecastCompactEmpty()
            state.isError -> DiskForecastErrorState(onRetry = actions.onRetry)
            view.isEmpty -> DiskForecastBigEmptyState()
            else ->
                Column(modifier = Modifier.fillMaxWidth()) {
                    view.rows.forEachIndexed { index, row ->
                        if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        DiskForecastRow(row = row, formats = formats)
                    }
                }
        }
    }
}

@Composable
private fun DiskForecastLoadingState() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Spinner(size = SpinnerSize.Md, label = stringResource(R.string.translation_common_loading))
    }
}

@Composable
private fun DiskForecastErrorState(onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            DiskForecastGlyphs.AlertCircle,
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

/** The big empty state shown when the database has no hypertables (web `EmptyState`). */
@Composable
private fun DiskForecastBigEmptyState() {
    EmptyState(
        icon = DiskForecastGlyphs.Database,
        title = stringResource(R.string.translation_admin_diskForecast_emptyTitle),
        message = stringResource(R.string.translation_admin_diskForecast_emptyMessage),
    )
}

/** The compact table-empty line shown when the subsystem is unconfigured (web DataTable `emptyMessage`). */
@Composable
private fun DiskForecastCompactEmpty() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        HelperText(stringResource(R.string.translation_admin_diskForecast_emptyTable))
    }
}

// ── One hypertable row (all six web columns) ────────────────────────────────────────────────────────────────

@Composable
private fun DiskForecastRow(
    row: HypertableSize,
    formats: DiskForecastFormats,
) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption(stringResource(R.string.translation_admin_diskForecast_colTable))
                Subhead(row.hypertableName.ifBlank { EM_DASH })
                Caption(
                    stringResource(
                        R.string.translation_admin_diskForecast_chunkCount,
                        formats.int(row.chunkCount),
                    ),
                )
            }
            DiskSeverityCell(row = row)
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            LabeledField(
                label = stringResource(R.string.translation_admin_diskForecast_colTotal),
                value = formats.bytes(row.totalBytes),
                modifier = Modifier.weight(1f),
            )
            LabeledField(
                label = stringResource(R.string.translation_admin_diskForecast_colSplit),
                value = formats.bytes(row.uncompressedBytes),
                detail =
                    "${formats.bytes(row.compressedBytes)} " +
                        stringResource(R.string.translation_admin_diskForecast_compressedSuffix),
                modifier = Modifier.weight(1f),
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            LabeledField(
                label = stringResource(R.string.translation_admin_diskForecast_colGrowth),
                value = formats.bytesPerDay(row.growthBytesPerDay),
                modifier = Modifier.weight(1f),
            )
            LabeledField(
                label = stringResource(R.string.translation_admin_diskForecast_colDays),
                value = formats.daysToQuota(row.estDaysToQuota),
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun DiskSeverityCell(row: HypertableSize) {
    val tone = DiskSeverityTone.from(row.severity)
    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(stringResource(R.string.translation_admin_diskForecast_colSeverity))
        Badge(text = severityLabel(tone, row.severity), variant = tone.badgeVariant())
    }
}

@Composable
private fun LabeledField(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    detail: String? = null,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(label)
        BodyText(value)
        if (!detail.isNullOrBlank()) {
            Caption(detail)
        }
    }
}

// ── i18n label resolution (web SEVERITY_LABEL) ──────────────────────────────────────────────────────────────

/**
 * The badge label for a [tone] — the native mirror of the web `SEVERITY_LABEL` map (ok ⇒ "OK", warn ⇒ "Warn",
 * critical ⇒ "Critical", unknown ⇒ "—"). For an [Unknown] tone the explicit `unknown` token and a blank value
 * fold to the em-dash (web `SEVERITY_LABEL.unknown = '—'`), while any other unrecognised token round-trips
 * verbatim (web `SEVERITY_LABEL[severity] ?? severity`).
 */
@Composable
private fun severityLabel(
    tone: DiskSeverityTone,
    raw: String,
): String =
    when (tone) {
        DiskSeverityTone.Ok -> stringResource(R.string.translation_admin_diskForecast_severityOk)
        DiskSeverityTone.Warn -> stringResource(R.string.translation_admin_diskForecast_severityWarn)
        DiskSeverityTone.Critical -> stringResource(R.string.translation_admin_diskForecast_severityCritical)
        DiskSeverityTone.Unknown ->
            if (raw.isBlank() || raw.equals("unknown", ignoreCase = true)) EM_DASH else raw
    }

// ── Display-boundary formatting (binary-prefix bytes + locale numbers) ──────────────────────────────────────

/**
 * Locale-bound number formatters applied only at the render boundary. Counts and the days-to-quota estimate use
 * the device locale (web `fmtNumber`, global precision 2); byte sizes and the share-of-total percentage use the
 * non-localized binary-prefix / fixed-decimal form the web `formatBytes` / `(…).toFixed(1)` helpers produce, so
 * "1.5 GB" / "62.4%" render identically to the web regardless of locale.
 */
private class DiskForecastFormats(locale: Locale) {
    private val integer: NumberFormat = NumberFormat.getIntegerInstance(locale)
    private val days: NumberFormat =
        NumberFormat.getInstance(locale).apply {
            minimumFractionDigits = DAYS_FRACTION_DIGITS
            maximumFractionDigits = DAYS_FRACTION_DIGITS
        }

    /** Group-formatted integer (web `fmtNumber` over a whole number / i18n `{{count}}`). */
    fun int(value: Long): String = integer.format(value)

    /** Group-formatted integer (web `fmtNumber` over a whole number / i18n `{{count}}`). */
    fun int(value: Int): String = integer.format(value.toLong())

    /** Binary-prefix byte size (web `formatBytes`); `+ 0.0` widens the whole byte count to Double. */
    fun bytes(value: Long): String = formatBytes(value + 0.0)

    /** Binary-prefix byte size (web `formatBytes` over a fractional byte figure). */
    fun bytes(value: Double): String = formatBytes(value)

    /** Binary-prefix byte rate with the per-day suffix (web `${formatBytes(x)}/d`). */
    fun bytesPerDay(value: Double): String = "${formatBytes(value)}$PER_DAY_SUFFIX"

    /** Days-to-quota estimate at the global precision, or the em-dash when absent (web `fmtNumber` / `'—'`). */
    fun daysToQuota(value: Double?): String = if (value == null) EM_DASH else days.format(value)

    /** Share-of-total percentage at one decimal, non-localized (web `(part / total * 100).toFixed(1)`). */
    fun percent(value: Double): String = String.format(Locale.ROOT, PERCENT_FORMAT, value)

    private companion object {
        const val DAYS_FRACTION_DIGITS = 2
        const val PER_DAY_SUFFIX = "/d"
        const val PERCENT_FORMAT = "%.1f"
    }
}

private const val BYTES_PER_KIB = 1024.0
private const val ONE_DECIMAL_FORMAT = "%.1f"

/**
 * The native port of the web `formatBytes` (web/src/lib/numberFormat.ts): a non-finite figure renders as the
 * em-dash, anything under 1 KiB renders as plain bytes, and the KB / MB / GB tiers use binary divisors at one
 * decimal — so the native byte labels match the web output byte-for-byte.
 */
private fun formatBytes(value: Double): String {
    if (!value.isFinite()) return EM_DASH
    return when {
        value < BYTES_PER_KIB -> "${plainBytes(value)} B"
        value < BYTES_PER_KIB * BYTES_PER_KIB -> "${oneDecimal(value / BYTES_PER_KIB)} KB"
        value < BYTES_PER_KIB * BYTES_PER_KIB * BYTES_PER_KIB ->
            "${oneDecimal(value / (BYTES_PER_KIB * BYTES_PER_KIB))} MB"
        else -> "${oneDecimal(value / (BYTES_PER_KIB * BYTES_PER_KIB * BYTES_PER_KIB))} GB"
    }
}

private fun oneDecimal(value: Double): String = String.format(Locale.ROOT, ONE_DECIMAL_FORMAT, value)

private fun plainBytes(value: Double): String =
    if (value == floor(value)) value.toLong().toString() else oneDecimal(value)
