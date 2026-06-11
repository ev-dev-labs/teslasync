// The native Jetpack Compose + Material 3 RedisDiagnosticEmptyState feature view — a parity port of
// web/src/features/admin/components/RedisDiagnosticEmptyState.tsx. The web component replaces the legacy
// generic "no signals cached" empty state on the Redis Signal Viewer page with a structured, actionable
// banner that branches on the new `meta` block (and on the upstream request outcome) so an engineer sees
// a specific root cause + next step instead of a black box. Upstream request failures always win over the
// meta-driven branches so a backend outage is never disguised as an empty cache.
//
// This port keeps that contract: the pure [RedisDiagnosticProjection] selects the branch and the tone /
// glyph it maps to; this layer only resolves the i18n strings (P1/S10), formats the last-seen instants at
// the display boundary (the native analogue of the web `useDateFormat` hook), and renders. It performs no
// HTTP — the `meta`, the upstream error, and the "other vehicles" key list are supplied by the host page's
// shared state holders (P1/S8), exactly as the web parent passes `meta` / `serverError` / `networkError`
// down and the native TelemetryErrorsPanel receives its data as props. The one-shot `view.opened`
// diagnostic (P1/S11) is recorded on first composition.
//
// Glyphs: AlertTriangle reuses the shared `TeslaGlyphs.Warning`, Zap reuses `FeedbackGlyphs.Bolt`; the
// ServerCrash / Database / Radio vectors are authored in the co-located RedisDiagnosticEmptyStateGlyphs.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/RedisDiagnosticEmptyState) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.redisdiagnosticemptystate

import androidx.annotation.StringRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.BuildConfig
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** Test tag on the structured banner root — the native analogue of web `data-testid`. */
const val REDIS_DIAGNOSTIC_BANNER_TEST_TAG: String = "redis-diagnostic-banner"

/** Test tag on the "other vehicles" section root (web `redis-diagnostic-other-vehicles`). */
const val REDIS_DIAGNOSTIC_OTHER_VEHICLES_TEST_TAG: String = "redis-diagnostic-other-vehicles"

private const val EM_DASH = "\u2014"
private const val MIDDLE_DOT = "\u00B7"
private const val MUTED_ALPHA = 0.7f
private val CHIP_BORDER_WIDTH = 1.dp

/** Per-chip test tag for the "other vehicles" buttons (web `redis-diagnostic-other-{id}`). */
fun redisDiagnosticOtherVehicleTestTag(vehicleId: Int): String = "redis-diagnostic-other-$vehicleId"

/**
 * Stateful entry point — the faithful 1:1 port of the web `RedisDiagnosticEmptyState({...})` props.
 * Records the one-shot `view.opened` diagnostic on first composition (P1/S11), projects the inputs onto
 * a [RedisDiagnosticState] via the pure [RedisDiagnosticProjection], and renders.
 *
 * The host page binds the shared state holders (P1/S8): it supplies the `meta` block, the upstream
 * [error] outcome, and the "other vehicles" [otherVehicleKeys] list (the web `useQuery` keys result),
 * so this view performs no HTTP itself. [onSelectVehicle] mirrors the web prop; [onOpenDocs] and
 * [formatDateTime] default to the platform URI handler and a locale-aware date formatter (the native
 * analogues of the web `<a target="_blank">` and `useDateFormat`).
 *
 * @param vehicleId the active vehicle id (its own key is dropped from the "other vehicles" chips).
 * @param meta the diagnostic meta block, or null when the backend does not expose it yet.
 * @param onSelectVehicle invoked with another vehicle's id when its chip is tapped.
 * @param error the upstream request outcome; defaults to [DiagnosticError.None].
 * @param otherVehicleKeys the raw `/keys` list from the host state holder; defaults to empty.
 * @param keysUnavailable true when the keys query errored or has not resolved (hides the chips).
 * @param onOpenDocs opens a docs URL; defaults to the Compose `LocalUriHandler`.
 * @param formatDateTime formats an ISO-8601 instant for display; defaults to a localized formatter.
 */
@Composable
fun RedisDiagnosticEmptyState(
    vehicleId: Int,
    meta: RedisSignalsMeta?,
    onSelectVehicle: (Int) -> Unit,
    modifier: Modifier = Modifier,
    error: DiagnosticError = DiagnosticError.None,
    otherVehicleKeys: List<RedisSignalKeyEntry> = emptyList(),
    keysUnavailable: Boolean = false,
    onOpenDocs: (String) -> Unit = rememberDocsOpener(),
    formatDateTime: (String) -> String = rememberRedisDateTimeFormatter(),
) {
    val logger = LocalDataContainer.current.logger
    LaunchedEffect(Unit) { recordRedisDiagnosticEmptyStateOpened(logger) }
    val state =
        remember(vehicleId, meta, error, otherVehicleKeys, keysUnavailable) {
            RedisDiagnosticProjection.project(
                vehicleId = vehicleId,
                meta = meta,
                error = error,
                otherVehicleKeys = otherVehicleKeys,
                keysUnavailable = keysUnavailable,
                nowMs = System.currentTimeMillis(),
            )
        }
    RedisDiagnosticEmptyStateContent(
        state = state,
        modifier = modifier,
        onSelectVehicle = onSelectVehicle,
        onOpenDocs = onOpenDocs,
        formatDateTime = formatDateTime,
    )
}

/**
 * Stateless renderer for every branch — the unit/UI-test and preview entry point. The pre-meta fallback
 * renders the legacy [EmptyState]; every other branch renders the structured [DiagnosticBanner]. No
 * branch is ever a hidden surface.
 */
@Composable
fun RedisDiagnosticEmptyStateContent(
    state: RedisDiagnosticState,
    modifier: Modifier = Modifier,
    onSelectVehicle: (Int) -> Unit = {},
    onOpenDocs: (String) -> Unit = {},
    formatDateTime: (String) -> String = { it },
) {
    when (state) {
        RedisDiagnosticState.LegacyEmpty -> LegacyEmptyBranch(modifier)
        is RedisDiagnosticState.Banner ->
            DiagnosticBanner(
                banner = state,
                onSelectVehicle = onSelectVehicle,
                onOpenDocs = onOpenDocs,
                formatDateTime = formatDateTime,
                modifier = modifier,
            )
    }
}

/**
 * The pre-meta fallback — web `<EmptyState icon={<Database />} message={t('redis.noSignals')} />`. Shown
 * only when the backend does not yet expose the `meta` block, so the page degrades to the legacy generic
 * message rather than a blank box.
 */
@Composable
private fun LegacyEmptyBranch(modifier: Modifier = Modifier) {
    EmptyState(
        message = stringResource(R.string.translation_redis_noSignals),
        modifier = modifier.fillMaxWidth(),
        icon = RedisDiagnosticEmptyStateGlyphs.Database,
    )
}

/**
 * The structured diagnostic banner — web `DiagnosticBanner`. A tone-accented [GlassPanel] holding the
 * leading glyph beside the title (a heading for TalkBack), the body, the always-present meta list (when
 * meta is non-null), an optional docs CTA, and the optional "other vehicles" chips.
 */
@Composable
private fun DiagnosticBanner(
    banner: RedisDiagnosticState.Banner,
    onSelectVehicle: (Int) -> Unit,
    onOpenDocs: (String) -> Unit,
    formatDateTime: (String) -> String,
    modifier: Modifier = Modifier,
) {
    val tone = RedisDiagnosticProjection.toneFor(banner.kind)
    val glyph = RedisDiagnosticProjection.glyphFor(banner.kind)
    val cta = ctaFor(banner.kind)
    GlassPanel(
        modifier = modifier.fillMaxWidth().testTag(REDIS_DIAGNOSTIC_BANNER_TEST_TAG),
        padding = PanelPadding.Md,
        accent = panelAccentFor(tone),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                imageVector = glyphVector(glyph),
                contentDescription = null,
                size = IconSize.Xl,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Heading(
                    text = bannerTitle(banner.kind),
                    level = HeadingLevel.Section,
                    modifier = Modifier.semantics { heading() },
                )
                BodyText(
                    text = bannerBody(banner, formatDateTime),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                banner.meta?.let { DiagnosticMetaList(it, formatDateTime) }
                if (cta != null) {
                    Button(
                        label = stringResource(cta.labelRes),
                        onClick = { onOpenDocs(cta.href) },
                        variant = ButtonVariant.Secondary,
                        size = ButtonSize.Sm,
                    )
                }
                if (banner.otherKeys.isNotEmpty()) {
                    OtherVehiclesSection(banner.otherKeys, onSelectVehicle)
                }
            }
        }
    }
}

/**
 * The diagnostic meta list — web `DiagnosticMetaList`. A labeled key/value list of the live-store mode
 * (a success/danger badge), the Redis key, the L1/L2 counts, the L1/L2 last-seen instants (formatted at
 * this display boundary), and the VIN when present.
 */
@Composable
private fun DiagnosticMetaList(
    meta: RedisSignalsMeta,
    formatDateTime: (String) -> String,
) {
    val modeVariant =
        if (RedisDiagnosticProjection.isHybridMode(meta.liveSignalStoreMode)) BadgeVariant.Success else BadgeVariant.Danger
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetaRow(stringResource(R.string.translation_redis_diagnostic_meta_mode)) {
            Badge(text = meta.liveSignalStoreMode, variant = modeVariant)
        }
        MetaRow(stringResource(R.string.translation_redis_diagnostic_meta_key)) {
            CodeText(meta.redisKey)
        }
        MetaRow(stringResource(R.string.translation_redis_diagnostic_meta_l1Count)) {
            HelperText(meta.l1SignalCount.toString())
        }
        MetaRow(stringResource(R.string.translation_redis_diagnostic_meta_l2Count)) {
            HelperText(meta.redisFieldCount.toString())
        }
        MetaRow(stringResource(R.string.translation_redis_diagnostic_meta_l1LastSeen)) {
            HelperText(meta.l1LastSeenAt?.let(formatDateTime) ?: EM_DASH)
        }
        MetaRow(stringResource(R.string.translation_redis_diagnostic_meta_l2LastSeen)) {
            HelperText(meta.l2LastSeenAt?.let(formatDateTime) ?: EM_DASH)
        }
        if (meta.vehicleVin.isNotBlank()) {
            MetaRow(stringResource(R.string.translation_redis_diagnostic_meta_vin)) {
                CodeText(meta.vehicleVin)
            }
        }
    }
}

@Composable
private fun MetaRow(
    label: String,
    value: @Composable () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(label, modifier = Modifier.weight(1f))
        value()
    }
}

/**
 * The "other vehicles with cached signals" section — web `redis-diagnostic-other-vehicles`. A labeled,
 * wrapping row of tappable chips (capped at [MAX_OTHER_VEHICLE_CHIPS]); rendered only when the filtered
 * list is non-empty, so the section is never an empty box.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun OtherVehiclesSection(
    keys: List<RedisSignalKeyEntry>,
    onSelectVehicle: (Int) -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(top = Spacing.xs)
                .testTag(REDIS_DIAGNOSTIC_OTHER_VEHICLES_TEST_TAG),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Caption(stringResource(R.string.translation_redis_diagnostic_otherVehicles))
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            keys.take(MAX_OTHER_VEHICLE_CHIPS).forEach { entry ->
                OtherVehicleChip(entry, onSelectVehicle)
            }
        }
    }
}

/**
 * One "other vehicle" chip — web per-key `<button>`. The whole pill is a single Button-role tap target
 * (its [onClickLabel] is the resolved vehicle label) that invokes [onSelectVehicle]; it shows the
 * display name (or VIN, or the localized "Vehicle {id}" fallback) and the muted cached-field count.
 */
@Composable
private fun OtherVehicleChip(
    entry: RedisSignalKeyEntry,
    onSelectVehicle: (Int) -> Unit,
) {
    val fallback = stringResource(R.string.translation_automations_builder_vehicleFallback, entry.vehicleId.toString())
    val label =
        entry.displayName?.takeIf { it.isNotBlank() }
            ?: entry.vehicleVin?.takeIf { it.isNotBlank() }
            ?: fallback
    val shape = RoundedCornerShape(Radius.pill)
    Surface(
        modifier =
            Modifier
                .testTag(redisDiagnosticOtherVehicleTestTag(entry.vehicleId))
                .clip(shape)
                .clickable(role = Role.Button, onClickLabel = label) { onSelectVehicle(entry.vehicleId) },
        shape = shape,
        color = MaterialTheme.colorScheme.surfaceVariant,
        border = BorderStroke(CHIP_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.md, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = "$MIDDLE_DOT ${entry.fieldCount}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = MUTED_ALPHA),
            )
        }
    }
}

private fun glyphVector(glyph: DiagnosticGlyph): ImageVector =
    when (glyph) {
        DiagnosticGlyph.ServerCrash -> RedisDiagnosticEmptyStateGlyphs.ServerCrash
        DiagnosticGlyph.AlertTriangle -> TeslaGlyphs.Warning
        DiagnosticGlyph.Database -> RedisDiagnosticEmptyStateGlyphs.Database
        DiagnosticGlyph.Zap -> FeedbackGlyphs.Bolt
        DiagnosticGlyph.Radio -> RedisDiagnosticEmptyStateGlyphs.Radio
    }

private fun panelAccentFor(tone: DiagnosticTone): PanelAccent =
    when (tone) {
        DiagnosticTone.Danger -> PanelAccent.Danger
        DiagnosticTone.Warning -> PanelAccent.Warning
        DiagnosticTone.Info -> PanelAccent.Info
        DiagnosticTone.Neutral -> PanelAccent.None
    }

@Composable
private fun bannerTitle(kind: DiagnosticKind): String =
    stringResource(
        when (kind) {
            DiagnosticKind.CacheNotWired -> R.string.translation_redis_diagnostic_cacheNotWired_title
            DiagnosticKind.Unreachable -> R.string.translation_redis_diagnostic_unreachable_title
            DiagnosticKind.RequestFailed -> R.string.translation_redis_diagnostic_requestFailed_title
            DiagnosticKind.NetworkError -> R.string.translation_redis_diagnostic_networkError_title
            DiagnosticKind.ModeLocal -> R.string.translation_redis_diagnostic_modeLocal_title
            DiagnosticKind.MirrorBroken -> R.string.translation_redis_diagnostic_mirrorBroken_title
            DiagnosticKind.NoTelemetry -> R.string.translation_redis_diagnostic_noTelemetry_title
            DiagnosticKind.Empty -> R.string.translation_redis_diagnostic_empty_title
        },
    )

@Composable
private fun bannerBody(
    banner: RedisDiagnosticState.Banner,
    formatDateTime: (String) -> String,
): String =
    when (banner.kind) {
        DiagnosticKind.CacheNotWired -> stringResource(R.string.translation_redis_diagnostic_cacheNotWired_body)
        DiagnosticKind.Unreachable -> stringResource(R.string.translation_redis_diagnostic_unreachable_body)
        DiagnosticKind.RequestFailed ->
            stringResource(
                R.string.translation_redis_diagnostic_requestFailed_body,
                (banner.requestStatus ?: 0).toString(),
                banner.requestMessage.orEmpty(),
            )
        DiagnosticKind.NetworkError -> stringResource(R.string.translation_redis_diagnostic_networkError_body)
        DiagnosticKind.ModeLocal -> stringResource(R.string.translation_redis_diagnostic_modeLocal_body)
        DiagnosticKind.MirrorBroken ->
            stringResource(
                R.string.translation_redis_diagnostic_mirrorBroken_body,
                (banner.meta?.l1SignalCount ?: 0).toString(),
            )
        DiagnosticKind.NoTelemetry -> noTelemetryBody(banner.meta?.l1LastSeenAt, formatDateTime)
        DiagnosticKind.Empty -> stringResource(R.string.translation_redis_diagnostic_empty_body)
    }

@Composable
private fun noTelemetryBody(
    l1LastSeenAt: String?,
    formatDateTime: (String) -> String,
): String =
    if (l1LastSeenAt != null) {
        stringResource(R.string.translation_redis_diagnostic_noTelemetry_bodyStale, formatDateTime(l1LastSeenAt))
    } else {
        stringResource(R.string.translation_redis_diagnostic_noTelemetry_bodyAbsent)
    }

/** The optional docs CTA for a branch — web `cta` + `ctaHref` (cache-not-wired and mode-local only). */
private data class DocsCta(
    @StringRes val labelRes: Int,
    val href: String,
)

private fun ctaFor(kind: DiagnosticKind): DocsCta? =
    when (kind) {
        DiagnosticKind.CacheNotWired ->
            DocsCta(R.string.translation_redis_diagnostic_cacheNotWired_cta, "/docs/caching#configuration")
        DiagnosticKind.ModeLocal ->
            DocsCta(R.string.translation_redis_diagnostic_modeLocal_cta, "/docs/caching")
        else -> null
    }

/**
 * Resolves the web's origin-relative docs href (e.g. `/docs/caching`) to an absolute URL against the
 * app's base origin, so the native CTA opens the same documentation the web `<a>` links to.
 */
private fun absoluteDocsUrl(hrefOrUrl: String): String =
    if (hrefOrUrl.startsWith("http")) {
        hrefOrUrl
    } else {
        BuildConfig.API_BASE_URL.trimEnd('/') + hrefOrUrl
    }

@Composable
private fun rememberDocsOpener(): (String) -> Unit {
    val uriHandler = LocalUriHandler.current
    return remember(uriHandler) { { href -> uriHandler.openUri(absoluteDocsUrl(href)) } }
}

@Composable
private fun rememberRedisDateTimeFormatter(): (String) -> String {
    val locale = LocalConfiguration.current.locales[0]
    return remember(locale) {
        val formatter =
            DateTimeFormatter
                .ofLocalizedDateTime(FormatStyle.MEDIUM)
                .withLocale(locale)
                .withZone(ZoneId.systemDefault())
        formatIso(formatter)
    }
}

private fun formatIso(formatter: DateTimeFormatter): (String) -> String =
    { iso -> runCatching { formatter.format(OffsetDateTime.parse(iso)) }.getOrDefault(iso) }

// ── Previews (tooling-only; @Preview entry points exercise representative render branches) ──────────

private val PREVIEW_META =
    RedisSignalsMeta(
        liveSignalStoreMode = "hybrid",
        redisKey = "vehicle:7:signals",
        redisFieldCount = 0,
        l1SignalCount = 0,
        l1LastSeenAt = null,
        l2LastSeenAt = null,
        vehicleVin = "5YJ3E1EA1KF000001",
    )

private val PREVIEW_OTHER_KEYS =
    listOf(
        RedisSignalKeyEntry(vehicleId = 1, fieldCount = 230, vehicleVin = "VIN1", displayName = "Falcon"),
        RedisSignalKeyEntry(vehicleId = 12, fieldCount = 142, vehicleVin = "VIN12", displayName = "Phoenix"),
    )

@Preview(name = "Legacy empty", showBackground = true)
@Composable
private fun RedisDiagnosticLegacyEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RedisDiagnosticEmptyStateContent(RedisDiagnosticState.LegacyEmpty)
    }
}

@Preview(name = "Cache not wired", showBackground = true)
@Composable
private fun RedisDiagnosticCacheNotWiredPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RedisDiagnosticEmptyStateContent(
            RedisDiagnosticState.Banner(DiagnosticKind.CacheNotWired, PREVIEW_META),
        )
    }
}

@Preview(name = "Mirror broken", showBackground = true)
@Composable
private fun RedisDiagnosticMirrorBrokenPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RedisDiagnosticEmptyStateContent(
            RedisDiagnosticState.Banner(
                kind = DiagnosticKind.MirrorBroken,
                meta = PREVIEW_META.copy(l1SignalCount = 42),
                otherKeys = PREVIEW_OTHER_KEYS,
            ),
        )
    }
}

@Preview(name = "No telemetry", showBackground = true)
@Composable
private fun RedisDiagnosticNoTelemetryPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RedisDiagnosticEmptyStateContent(
            RedisDiagnosticState.Banner(
                kind = DiagnosticKind.NoTelemetry,
                meta = PREVIEW_META,
                otherKeys = PREVIEW_OTHER_KEYS,
            ),
        )
    }
}

@Preview(name = "Network error", showBackground = true)
@Composable
private fun RedisDiagnosticNetworkErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RedisDiagnosticEmptyStateContent(
            RedisDiagnosticState.Banner(DiagnosticKind.NetworkError, meta = null),
        )
    }
}

@Preview(name = "Empty fall-through", showBackground = true)
@Composable
private fun RedisDiagnosticEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RedisDiagnosticEmptyStateContent(
            RedisDiagnosticState.Banner(DiagnosticKind.Empty, PREVIEW_META, PREVIEW_OTHER_KEYS),
        )
    }
}
