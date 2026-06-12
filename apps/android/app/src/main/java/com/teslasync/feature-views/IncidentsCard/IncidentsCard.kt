// The native Jetpack Compose + Material 3 IncidentsCard feature view — a parity port of
// web/src/features/system/components/status/IncidentsCard.tsx. The web component is the active-incidents block on
// /system-status: a severity-tinted GlassPanel with an "Active incidents" header (warning glyph + count badge)
// and a "Log incident" CTA, over a list of compact incident rows. Each row shows a severity glyph, the title, a
// status badge, the severity word, an optional "Affects: …" line, and a "Started … · N updates" meta line, and
// links to the post-mortem timeline at /system-status/incidents/:id.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only web
// hook is `useIncidents`, which the host owns and projects into the cache-then-network [UiState] passed here);
// the host wires the row drill-through and the "Log incident" CTA through [IncidentsCardActions], exactly like
// the web `<Link>` + `setOpen(true)` (the IncidentForm dialog is a separate surface, out of scope). Because the
// surface acceptance gate requires every lifecycle state to render, the stateless entry draws each state the
// shared state-holder layer (P1/S8) can carry — loading skeleton, hard error with retry, empty, the loaded card,
// and stale/offline ("last known") with a freshness chip + auto-refresh — without ever fetching. Where the web
// collapses the card entirely on an empty feed (`return null`), the native surface renders an explicit, friendly
// empty state instead, per the P3 "every state must render — no hidden surfaces" mandate. A web-parity overload
// taking a raw incident list is provided for hosts that already hold one.
//
// Severity / status colors map to design tokens (never raw hex in render code); the severity / status LABELS are
// the raw wire values, exactly as the web renders them. The web Lucide glyphs the shared libraries already
// provide (AlertTriangle, AlertOctagon, ChevronRight, Plus) are reused; the one that is not — lucide AlertCircle
// for `minor` — is authored here as a 24×24 stroked vector in the shared monochrome style, since a feature view
// may not expand the shared icon library from a surface prompt — exactly as the sibling feature-view surfaces do.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/IncidentsCard — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.incidentscard

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.incidents.Incident
import io.teslasync.shared.core.presentation.incidents.IncidentListResponse
import io.teslasync.shared.core.presentation.incidents.IncidentUpdateEntry
import java.time.Instant

/** One line for the title — the web `truncate`. */
private const val TITLE_MAX_LINES: Int = 1

/** The web middot separating "Started …" from the updates count. */
private const val META_SEPARATOR: String = "\u2022"

/** Loading skeleton dimensions, sized so the card never first-paints as a blank box. */
private val SKELETON_CHIP: Dp = 24.dp
private val SKELETON_TITLE_HEIGHT: Dp = 14.dp
private val SKELETON_META_HEIGHT: Dp = 10.dp
private val SKELETON_META_WIDTH: Dp = 140.dp
private const val SKELETON_TITLE_FRACTION: Float = 0.6f

/**
 * The host-supplied actions for the card — the native analogue of the web component's `<Link>` navigation and
 * the "Log incident" `setOpen(true)` callback. Both default to no-ops so previews / the chrome states (which
 * render no row action) need not supply them.
 *
 * @property onOpenIncident open the post-mortem timeline for an incident — the web row `<Link to=…/{id}>`.
 * @property onLogIncident open the manual incident dialog — the web "Log incident" CTA (IncidentForm host).
 */
class IncidentsCardActions(
    val onOpenIncident: (id: Long) -> Unit = {},
    val onLogIncident: () -> Unit = {},
)

/**
 * Stateful entry point for the active-incidents card. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared incidents feed can carry. The host owns the feed
 * (P1/S8) and supplies [onRetry] (the feed's `refetch`) plus the [actions]; this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the active-incidents list (the host's `useIncidents`).
 * @param actions the row + CTA callbacks — wired by the host to navigation / the IncidentForm dialog.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun IncidentsCard(
    state: UiState<IncidentListResponse>,
    actions: IncidentsCardActions,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordIncidentsCardOpened(logger) }
    IncidentsCardContent(state = state, actions = actions, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `useIncidents` list, for hosts that already hold the loaded
 * incidents. Wraps them in a content [UiState] and renders the card — no fetch sits behind it, so it offers no
 * retry affordance. Records `view.opened` like the stateful entry.
 */
@Composable
fun IncidentsCard(
    incidents: List<Incident>,
    actions: IncidentsCardActions,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(incidents) {
            UiState(phase = UiPhase.Content, data = IncidentListResponse(incidents = incidents, count = incidents.size))
        }
    IncidentsCard(state = state, actions = actions, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's card
 * exactly for the loaded state and adds the lifecycle chrome the host's feed implies: a loading skeleton, a
 * hard-error retry surface, a friendly empty state (where the web collapses to `null`), and a freshness chip that
 * reflects refreshing / stale / offline. Stale (non-error) data auto-refreshes, mirroring the freshness contract
 * the sibling surfaces use. [now] fixes the relative-age clock for tests; production callers use the wall clock.
 */
@Composable
fun IncidentsCardContent(
    state: UiState<IncidentListResponse>,
    actions: IncidentsCardActions,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    now: Instant = Instant.now(),
    strings: IncidentsCardStrings = rememberIncidentsCardStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }

    val rows = remember(state.data, now) { IncidentsCardProjection.project(state.data, now) }
    val hasContent = !state.isLoading && !state.isError && rows.isNotEmpty()
    val accent = if (hasContent) PanelAccent.Warning else PanelAccent.None

    GlassPanel(modifier = modifier, padding = PanelPadding.Md, accent = accent) {
        when {
            state.isLoading -> IncidentsCardLoading()
            state.isError -> IncidentsCardError(onRetry = onRetry)
            rows.isEmpty() -> IncidentsCardEmpty(strings = strings)
            else -> {
                if (state.stale || state.refreshing || state.hasError) {
                    IncidentsCardFreshnessRow(state = state)
                }
                IncidentsCardHeader(count = rows.size, strings = strings, onLogIncident = actions.onLogIncident)
                IncidentsCardList(rows = rows, onOpenIncident = actions.onOpenIncident, strings = strings)
            }
        }
    }
}

/**
 * The header — the web `flex items-center justify-between` row: a warning triangle, the "Active incidents"
 * title, the count Badge, and the ghost "Log incident" CTA.
 */
@Composable
private fun IncidentsCardHeader(
    count: Int,
    strings: IncidentsCardStrings,
    onLogIncident: () -> Unit,
) {
    val warning = TeslaTokens.status.warning
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(DataDisplayGlyphs.AlertTriangle, contentDescription = null, size = IconSize.Sm, tint = warning)
            Heading(strings.title, level = HeadingLevel.Sub, color = warning)
            Badge(count.toString(), variant = BadgeVariant.Warning)
        }
        Button(
            label = strings.log,
            onClick = onLogIncident,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = TeslaGlyphs.Plus,
        )
    }
}

/** The incident list — the web `<ul className="space-y-1">`. */
@Composable
private fun IncidentsCardList(
    rows: List<IncidentRow>,
    onOpenIncident: (id: Long) -> Unit,
    strings: IncidentsCardStrings,
) {
    val relative = rememberIncidentRelativeFormatter()
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        rows.forEach { row ->
            IncidentRowItem(
                row = row,
                strings = strings,
                relativeText = relative(row.startedAge),
                onOpen = { onOpenIncident(row.id) },
            )
        }
    }
}

/**
 * One incident row — the web `<li><Link>…</Link></li>`. The whole row is one tap target opening the post-mortem
 * (a TalkBack click label keeps the title / status / meta readable). A severity glyph leads, the title + status
 * badge + severity word wrap in a flow row, then the optional "Affects: …" and the "Started … · N updates" meta,
 * with a trailing chevron — the web `<ChevronRight>`.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun IncidentRowItem(
    row: IncidentRow,
    strings: IncidentsCardStrings,
    relativeText: String,
    onOpen: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.sm))
                .clickable(role = Role.Button, onClickLabel = strings.open, onClick = onOpen)
                .semantics(mergeDescendants = true) {}
                .padding(horizontal = Spacing.sm, vertical = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            severityGlyph(row.severityTone),
            contentDescription = null,
            size = IconSize.Md,
            tint = severityColor(row.severityTone),
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                BodyText(row.title, maxLines = TITLE_MAX_LINES)
                Badge(row.status, variant = statusBadgeVariant(row.statusTone))
                SeverityToneLabel(text = row.severity, tone = row.severityTone)
            }
            row.affectedJoined?.let { joined ->
                Caption("${strings.affects}: $joined")
            }
            Caption(metaText(row = row, strings = strings, relativeText = relativeText))
        }
        Icon(
            TeslaGlyphs.ChevronRight,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/**
 * The severity word in its tone color — the web `<span className="text-xs {tone.cls}">{tone.label}</span>`. Uses
 * the Material `labelMedium` role (the same slot [Caption] binds) with a status token color, so it stays
 * theme-correct rather than hand-picking a size/hex.
 */
@Composable
private fun SeverityToneLabel(
    text: String,
    tone: IncidentSeverityTone,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        color = severityColor(tone),
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** Builds the "Started …[ · N updates]" meta line — the web `Started {relative}{updates>1 && …}`. */
private fun metaText(
    row: IncidentRow,
    strings: IncidentsCardStrings,
    relativeText: String,
): String {
    val started = if (relativeText.isEmpty()) strings.started else "${strings.started} $relativeText"
    return if (row.showUpdates) "$started $META_SEPARATOR ${row.updatesCount} ${strings.updates}" else started
}

/** First-load skeleton — a chip + title + meta bar so the card is never blank while loading. */
@Composable
private fun IncidentsCardLoading() {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    Row(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(modifier = Modifier.size(SKELETON_CHIP), rounded = true)
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
            Skeleton(modifier = Modifier.width(SKELETON_META_WIDTH), height = SKELETON_META_HEIGHT, rounded = true)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun IncidentsCardError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Empty surface — a friendly "no active incidents" state, shown where the web collapses the card to `null`. A
 * positive check glyph signals the all-clear; the section is never hidden, per the P3 state mandate.
 */
@Composable
private fun IncidentsCardEmpty(strings: IncidentsCardStrings) {
    EmptyState(
        message = strings.empty,
        icon = DataDisplayGlyphs.CheckCircle,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The stale / refreshing / offline freshness chip, right-aligned above the card body. */
@Composable
private fun IncidentsCardFreshnessRow(state: UiState<IncidentListResponse>) {
    val formatAge = rememberIncidentsFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
        )
    }
}

// Maps a severity tone to its token color: amber for minor/major, red for critical — the web amber/orange/red
// ramp collapsed onto the platform status palette (info/success/warning/danger). The distinct glyphs in
// severityGlyph carry the full three-way escalation, so the minor/major hue overlap loses no information.
@Composable
private fun severityColor(tone: IncidentSeverityTone): Color =
    when (tone) {
        IncidentSeverityTone.Minor -> TeslaTokens.status.warning
        IncidentSeverityTone.Major -> TeslaTokens.status.warning
        IncidentSeverityTone.Critical -> TeslaTokens.status.danger
    }

/** The concrete severity glyph — web `SEVERITY_TONE[*].Icon` (AlertCircle / AlertTriangle / AlertOctagon). */
private fun severityGlyph(tone: IncidentSeverityTone): ImageVector =
    when (tone) {
        IncidentSeverityTone.Minor -> AlertCircleGlyph
        IncidentSeverityTone.Major -> DataDisplayGlyphs.AlertTriangle
        IncidentSeverityTone.Critical -> DataDisplayGlyphs.AlertOctagon
    }

/** Maps a status tone to the shared [BadgeVariant] — web `STATUS_BADGE[inc.status]`. */
private fun statusBadgeVariant(tone: IncidentStatusTone): BadgeVariant =
    when (tone) {
        IncidentStatusTone.Danger -> BadgeVariant.Danger
        IncidentStatusTone.Warning -> BadgeVariant.Warning
        IncidentStatusTone.Info -> BadgeVariant.Info
        IncidentStatusTone.Success -> BadgeVariant.Success
        IncidentStatusTone.Neutral -> BadgeVariant.Neutral
    }

// ── i18n facade (P1/S10) ────────────────────────────────────────────────────────────────────────────────────

/**
 * Builds the localized [IncidentsCardStrings] from the i18n catalog (P1/S10). The web component hardcodes its
 * English chrome (no `useTranslation`), so no `translation.status.incidents.*` key exists and one must not be
 * added to the drift-checked catalog from a surface prompt (ADR-014); each label resolves by-name with the
 * `t(key, default)` fallback so the catalog overrides it the moment a key is added.
 */
@Composable
private fun rememberIncidentsCardStrings(): IncidentsCardStrings {
    val context = LocalContext.current
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    val title = resolveOptional(lookup, KEY_TITLE, IncidentsCardDefaults.TITLE)
    val log = resolveOptional(lookup, KEY_LOG, IncidentsCardDefaults.LOG)
    val affects = resolveOptional(lookup, KEY_AFFECTS, IncidentsCardDefaults.AFFECTS)
    val updates = resolveOptional(lookup, KEY_UPDATES, IncidentsCardDefaults.UPDATES)
    val started = resolveOptional(lookup, KEY_STARTED, IncidentsCardDefaults.STARTED)
    val empty = resolveOptional(lookup, KEY_EMPTY, IncidentsCardDefaults.EMPTY)
    val open = resolveOptional(lookup, KEY_OPEN, IncidentsCardDefaults.OPEN)
    return remember(title, log, affects, updates, started, empty, open) {
        IncidentsCardStrings(
            title = title,
            log = log,
            affects = affects,
            updates = updates,
            started = started,
            empty = empty,
            open = open,
        )
    }
}

/**
 * Localized formatter for the relative `started_at` age — the web `relativeFrom`. Reuses the
 * `translation_freshness_*` catalog strings (`just now` / `%1$sm/h/d ago`), so the rendered text matches the web
 * verbatim. A `null` age (unparseable timestamp) renders an empty string (the web `relativeFrom` empty return).
 */
@Composable
private fun rememberIncidentRelativeFormatter(): (IncidentAge?) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    return remember(justNow, minutes, hours, days) {
        { age ->
            when (age) {
                null -> ""
                IncidentAge.JustNow -> justNow
                is IncidentAge.Minutes -> minutes.format(age.value)
                is IncidentAge.Hours -> hours.format(age.value)
                is IncidentAge.Days -> days.format(age.value)
            }
        }
    }
}

/** Localized relative-age formatter for the freshness chip — the same render-only concern the siblings resolve. */
@Composable
private fun rememberIncidentsFreshnessFormatter(): (FreshnessAge) -> String {
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

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is suppressed.
 * Release builds keep resource names (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ── Local Lucide glyph ────────────────────────────────────────────────────────────────────────────────────
// The one web severity glyph the shared icon libraries do not provide (lucide `AlertCircle`, the `minor` tone),
// authored as a 24×24 round-capped stroked vector in the shared monochrome style and recolored at render time.

/** The em-dash shown by the freshness chip when no timestamp is available. */
private const val EM_DASH: String = "\u2014"

/** Web `AlertCircle` (lucide) — a ringed exclamation: a circle, a vertical stem, and a dot. */
private val AlertCircleGlyph: ImageVector =
    strokedGlyph("AlertCircle") {
        circle(12f, 12f, 9f)
        moveTo(12f, 8f)
        lineTo(12f, 12.5f)
        dot(12f, 16f)
    }

/** Builds a 24×24 round-capped stroked [ImageVector] in the shared monochrome icon style. */
private fun strokedGlyph(
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

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

/** A round-capped near-zero-length segment that renders as a filled dot at ([x], [y]). */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

// ── Previews ──────────────────────────────────────────────────────────────────────────────────────────────

private val previewActions = IncidentsCardActions()

private fun previewIncident(
    id: Long,
    title: String,
    severity: String,
    status: String,
    startedAt: String,
): Incident =
    Incident(
        id = id,
        title = title,
        description = "",
        severity = severity,
        status = status,
        source = "manual",
        updates = listOf(IncidentUpdateEntry(at = startedAt, status = status, message = "update")),
        startedAt = startedAt,
        createdAt = startedAt,
        updatedAt = startedAt,
    )

@Preview(showBackground = true)
@Composable
private fun IncidentsCardActivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        IncidentsCardContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data =
                        IncidentListResponse(
                            incidents =
                                listOf(
                                    previewIncident(
                                        id = 1,
                                        title = "Wall connector restart",
                                        severity = "major",
                                        status = "investigating",
                                        startedAt = "2026-04-04T14:30:00Z",
                                    ).copy(
                                        affectedComponents = listOf("tesla", "telemetry"),
                                        updates =
                                            List(3) {
                                                IncidentUpdateEntry(
                                                    at = "2026-04-04T14:30:00Z",
                                                    status = "investigating",
                                                    message = "update",
                                                )
                                            },
                                    ),
                                    previewIncident(
                                        id = 2,
                                        title = "Elevated MQTT latency",
                                        severity = "minor",
                                        status = "monitoring",
                                        startedAt = "2026-04-04T12:00:00Z",
                                    ),
                                ),
                            count = 2,
                        ),
                ),
            actions = previewActions,
            onRetry = {},
            now = Instant.parse("2026-04-04T15:00:00Z"),
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun IncidentsCardEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        IncidentsCardContent(
            state = UiState(phase = UiPhase.Empty, data = IncidentListResponse()),
            actions = previewActions,
            onRetry = {},
        )
    }
}
