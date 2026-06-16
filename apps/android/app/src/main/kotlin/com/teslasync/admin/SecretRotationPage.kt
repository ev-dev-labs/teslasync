// The native Jetpack Compose + Material 3 SecretRotationPage admin surface — a parity port of
// web/src/features/admin/pages/SecretRotationPage.tsx, the per-(kind, target) credential-rotation tracker. It
// reproduces the page's panels (the four severity stat tiles + the rotation-status table), every data state
// (loading / empty / error / content, plus the HTTP-503 "subsystem not configured" branch), and every visible
// string (resolved from the generated res/values catalog, ADR-014).
//
// Composition: [SecretRotationPage] is the stateful entry (constructs the view-model over the host-wired
// source, records the one-shot `view.opened` diagnostic, collects the feed); [SecretRotationPageContent] is
// the stateless render layer driven entirely by [UiState]. All derivation lives in the framework-free model
// (SecretRotationPageModel.kt); this file only resolves i18n + formats at the display boundary + draws.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.admin.secretrotation

import android.text.format.DateUtils
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
import io.teslasync.shared.core.presentation.operatorconfidence.SecretRotationResponse
import io.teslasync.shared.core.presentation.operatorconfidence.SecretRotationStatus
import java.text.NumberFormat
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

private const val FADE_STEP_MS = 60

// ── Stateful entry points ─────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [SecretRotationPageViewModel] over the supplied [source] (the host wires the
 * shared [io.teslasync.shared.core.presentation.operatorconfidence.OperatorConfidenceStore] via
 * [asSecretRotationSource]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun SecretRotationPage(
    source: SecretRotationSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val vm: SecretRotationPageViewModel =
        viewModel(
            key = SecretRotationPageRegistration.SLUG,
            factory = viewModelFactory { initializer { SecretRotationPageViewModel(source, logger) } },
        )
    SecretRotationPage(viewModel = vm, modifier = modifier)
}

/** Stateful entry: binds the [viewModel] feed to the stateless content. */
@Composable
fun SecretRotationPage(
    viewModel: SecretRotationPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val state by viewModel.state.collectAsStateWithLifecycle()
    val actions = remember(viewModel) { SecretRotationActions(onRetry = viewModel::retry) }

    SecretRotationPageContent(state = state, actions = actions, modifier = modifier)
}

// ── Stateless content ─────────────────────────────────────────────────────────────────────────────────────

/** The stateless page body: the header, the optional subsystem/overdue banners, the stats, and the table. */
@Composable
fun SecretRotationPageContent(
    state: UiState<SecretRotationResponse>,
    actions: SecretRotationActions,
    modifier: Modifier = Modifier,
) {
    val view = SecretRotationView.from(state.data)
    val subsystemMissing = isSubsystemMissing(state.httpStatus)
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
    val formats = remember(locale) { SecretRotationFormats(locale) }

    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        SecretRotationHeader()

        if (subsystemMissing) {
            AlertBanner(
                tone = Tone.Warning,
                title = stringResource(R.string.translation_admin_subsystem_unavailableTitle),
                message = stringResource(R.string.translation_admin_secretRotation_notConfigured),
            )
        }

        if (view.counts.critical > 0) {
            AlertBanner(
                tone = Tone.Danger,
                title = stringResource(R.string.translation_admin_secretRotation_criticalTitle),
                message =
                    stringResource(
                        R.string.translation_admin_secretRotation_criticalMessage,
                        formats.int(view.counts.critical),
                    ),
            )
        }

        if (view.items.isNotEmpty()) {
            FadeIn { SecretRotationStatsGrid(counts = view.counts, formats = formats) }
        }

        FadeIn(delayMs = FADE_STEP_MS) {
            SecretRotationTablePanel(
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
private fun SecretRotationHeader() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(stringResource(R.string.translation_admin_secretRotation_pageTitle))
        BodyText(
            stringResource(R.string.translation_admin_secretRotation_subtitle),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ── Stat tiles (Tracked-secrets / OK / Warn / Critical) ─────────────────────────────────────────────────────

@Composable
private fun SecretRotationStatsGrid(
    counts: RotationCounts,
    formats: SecretRotationFormats,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_admin_secretRotation_totalLabel),
                value = formats.int(counts.total),
                modifier = Modifier.weight(1f),
                icon = SecretRotationGlyphs.ShieldCheck,
            )
            StatCard(
                label = stringResource(R.string.translation_admin_secretRotation_okLabel),
                value = formats.int(counts.ok),
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            StatCard(
                label = stringResource(R.string.translation_admin_secretRotation_warnLabel),
                value = formats.int(counts.warn),
                modifier = Modifier.weight(1f),
            )
            StatCard(
                label = stringResource(R.string.translation_admin_secretRotation_criticalLabel),
                value = formats.int(counts.critical),
                modifier = Modifier.weight(1f),
                icon = if (counts.critical > 0) SecretRotationGlyphs.AlertTriangle else null,
            )
        }
    }
}

// ── Table panel (GlassPanel5) + the loading / empty / error / content state matrix ──────────────────────────

@Composable
private fun SecretRotationTablePanel(
    state: UiState<SecretRotationResponse>,
    view: SecretRotationView,
    subsystemMissing: Boolean,
    formats: SecretRotationFormats,
    actions: SecretRotationActions,
) {
    val tableTitle = stringResource(R.string.translation_admin_secretRotation_tableTitle)
    GlassPanel(
        padding = PanelPadding.None,
        modifier = Modifier.semantics { contentDescription = tableTitle },
    ) {
        PanelTitle(tableTitle, modifier = Modifier.padding(Spacing.md))
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        when {
            state.isLoading -> SecretRotationLoadingState()
            subsystemMissing -> SecretRotationCompactEmpty()
            state.isError -> SecretRotationErrorState(onRetry = actions.onRetry)
            view.isEmpty -> SecretRotationBigEmptyState()
            else ->
                Column(modifier = Modifier.fillMaxWidth()) {
                    view.items.forEachIndexed { index, status ->
                        if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        SecretRotationRow(status = status, formats = formats)
                    }
                }
        }
    }
}

@Composable
private fun SecretRotationLoadingState() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Spinner(size = SpinnerSize.Md, label = stringResource(R.string.translation_common_loading))
    }
}

@Composable
private fun SecretRotationErrorState(onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            SecretRotationGlyphs.AlertCircle,
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

/** The big empty state shown when the tracker returned zero observations (web `EmptyState`). */
@Composable
private fun SecretRotationBigEmptyState() {
    EmptyState(
        icon = SecretRotationGlyphs.ShieldCheck,
        title = stringResource(R.string.translation_admin_secretRotation_emptyTitle),
        message = stringResource(R.string.translation_admin_secretRotation_emptyMessage),
    )
}

/** The compact table-empty line shown when the subsystem is unconfigured (web DataTable `emptyMessage`). */
@Composable
private fun SecretRotationCompactEmpty() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        HelperText(stringResource(R.string.translation_admin_secretRotation_emptyTable))
    }
}

// ── One tracked-secret row (all six web columns) ────────────────────────────────────────────────────────────

@Composable
private fun SecretRotationRow(
    status: SecretRotationStatus,
    formats: SecretRotationFormats,
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
                Caption(stringResource(R.string.translation_admin_secretRotation_colKind))
                Subhead(kindLabel(status.kind))
                val target = status.targetId
                if (!target.isNullOrBlank()) {
                    Caption(target)
                }
            }
            SeverityCell(status = status)
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            LabeledField(
                label = stringResource(R.string.translation_admin_secretRotation_colRotated),
                value = formats.dateTime(status.lastRotated),
                detail = formats.relative(status.lastRotated),
                modifier = Modifier.weight(1f),
            )
            LabeledField(
                label = stringResource(R.string.translation_admin_secretRotation_colAge),
                value = formats.number(status.ageDays),
                modifier = Modifier.weight(1f),
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            ExpiryField(status = status, formats = formats, modifier = Modifier.weight(1f))
            LabeledField(
                label = stringResource(R.string.translation_admin_secretRotation_colThresholds),
                value = "${formats.int(status.warnDays)}d / ${formats.int(status.criticalDays)}d",
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun SeverityCell(status: SecretRotationStatus) {
    val tone = SecretSeverityTone.from(status.severity)
    Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(stringResource(R.string.translation_admin_secretRotation_colSeverity))
        Badge(text = severityLabel(tone, status.severity), variant = tone.badgeVariant())
    }
}

@Composable
private fun ExpiryField(
    status: SecretRotationStatus,
    formats: SecretRotationFormats,
    modifier: Modifier = Modifier,
) {
    val expiresAt = status.expiresAt
    val days = status.daysToExpiry
    LabeledField(
        label = stringResource(R.string.translation_admin_secretRotation_colExpiry),
        value = if (expiresAt.isNullOrBlank()) EM_DASH else formats.dateTime(expiresAt),
        detail =
            if (!expiresAt.isNullOrBlank() && days != null) {
                stringResource(R.string.translation_admin_secretRotation_daysToExpiry, formats.int(days.toLong()))
            } else {
                null
            },
        modifier = modifier,
    )
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

// ── i18n label resolution (web SEVERITY_LABEL + KIND_LABELS) ─────────────────────────────────────────────────

/**
 * The badge label for a [tone] — the native mirror of the web `SEVERITY_LABEL` map (ok ⇒ "OK",
 * warn ⇒ "Rotate soon", critical ⇒ "Overdue"). [unknown] severities fall back to the em-dash no-value
 * marker (web `SEVERITY_LABEL.unknown = '—'`), matching the universal no-value marker used app-wide.
 */
@Composable
private fun severityLabel(
    tone: SecretSeverityTone,
    raw: String,
): String =
    when (tone) {
        SecretSeverityTone.Ok -> stringResource(R.string.translation_admin_secretRotation_severityOk)
        SecretSeverityTone.Warn -> stringResource(R.string.translation_admin_secretRotation_severityWarn)
        SecretSeverityTone.Critical -> stringResource(R.string.translation_admin_secretRotation_severityCritical)
        SecretSeverityTone.Unknown -> raw.ifBlank { EM_DASH }
    }

/**
 * The friendly display label for a secret [kind] — the native mirror of the web `KIND_LABELS` map. Falls back
 * to the raw enum value so a newly-added kind still renders before this map is updated (web `formatKind`).
 */
@Composable
private fun kindLabel(kind: String): String {
    val res =
        when (kind) {
            "tesla_refresh_token" -> R.string.translation_admin_secretRotation_kind_teslaRefreshToken
            "mqtt_mtls_cert" -> R.string.translation_admin_secretRotation_kind_mqttMtlsCert
            "database_password" -> R.string.translation_admin_secretRotation_kind_databasePassword
            "session_jwk" -> R.string.translation_admin_secretRotation_kind_sessionJwk
            "app_signing_key" -> R.string.translation_admin_secretRotation_kind_appSigningKey
            "authentik_secret" -> R.string.translation_admin_secretRotation_kind_authentikSecret
            else -> null
        }
    return if (res != null) stringResource(res) else kind
}

// ── Display-boundary formatting (locale numbers + dates) ────────────────────────────────────────────────────

/** Locale-bound number + date formatters; applied only at the render boundary (web `fmtNumber`/`formatDateTime`). */
private class SecretRotationFormats(locale: Locale) {
    private val integer: NumberFormat = NumberFormat.getIntegerInstance(locale)
    private val decimal: NumberFormat =
        NumberFormat.getInstance(locale).apply { maximumFractionDigits = MAX_AGE_FRACTION_DIGITS }
    private val dateTime: DateTimeFormatter =
        DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(ZoneId.systemDefault())

    /** Group-formatted integer (web `fmtNumber` over a whole number). */
    fun int(value: Long): String = integer.format(value)

    /** Group-formatted integer (web `fmtNumber` over a whole number). */
    fun int(value: Int): String = integer.format(value.toLong())

    /** Group-formatted decimal with at most one fraction digit (web `fmtNumber` over the age in days). */
    fun number(value: Double): String = decimal.format(value)

    /** Localized absolute date-time for an ISO stamp, falling back to the raw string (web `formatDateTime`). */
    fun dateTime(iso: String): String = parseInstant(iso)?.let(dateTime::format) ?: iso

    /** Localized relative phrase for an ISO stamp ("3 days ago"), or `null` when unparseable (web `formatRelative`). */
    fun relative(iso: String): String? =
        parseInstant(iso)?.let {
            DateUtils
                .getRelativeTimeSpanString(it.toEpochMilli(), System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS)
                .toString()
        }

    private companion object {
        const val MAX_AGE_FRACTION_DIGITS = 1
    }
}

private fun parseInstant(iso: String): Instant? =
    try {
        OffsetDateTime.parse(iso).toInstant()
    } catch (_: DateTimeParseException) {
        null
    }
