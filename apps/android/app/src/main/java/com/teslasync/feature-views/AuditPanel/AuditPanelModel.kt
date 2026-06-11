// Pure, framework-free model + projection for the AuditPanel feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/admin/components/dlq-inspector/AuditPanel.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the DLQ inspector page) loads the
// `DLQReplayAuditRecord[]` and passes it down with a `loading` flag. This file owns the parts the web
// component computes from those props: the lifecycle projection of (rows, loading) onto the shared
// cache-then-network [UiState] (so the surface renders every state the P1/S8 layer can carry), the
// `RESULT_VARIANT` → Badge mapping, the `value || '—'` cell fallback, the scoped/global empty-message
// selection, the absolute `replayed_at` timestamp formatting, and the PII-safe `view.opened` diagnostic.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AuditPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.auditpanel

import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no actor, DLQ id,
 * topic or trace id, so a diagnostics line can never leak an operator identity or a replay target.
 */
const val AUDIT_PANEL_SLUG: String = "AuditPanel"

/** Em dash shown for a blank cell value or an unparseable timestamp — the web `value || '—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * One render-ready replay-audit row — the native projection of the rendered fields of the web
 * `DLQReplayAuditRecord` (web/src/types/admin-diagnostics.ts). Only the columns the panel draws are
 * modelled; [result] keeps the raw wire value (`ok` / `publish_failed` / …) because the web renders it
 * verbatim inside the badge while classifying its color separately via [AuditPanelProjection.resultVariant].
 */
data class DLQReplayAuditRecord(
    val id: Long,
    val replayedAt: String,
    val actor: String,
    val dlqId: Long,
    val result: String,
    val dstTopic: String,
    val error: String,
    val traceId: String,
)

/**
 * Pure projection from the panel's inputs to its render state — a 1:1 port of the web component's
 * branch ladder and lookups. Stateless and side-effect-free so it is fully covered by the off-device
 * unit gate; the composable only resolves localized strings and draws what these functions return.
 */
object AuditPanelProjection {
    /**
     * Maps the panel's `(rows, loading)` props onto the shared cache-then-network [UiState] (P1/S8),
     * reproducing the web component's three visible outcomes:
     *  - rows present → [UiPhase.Content] (the web table; `loading` has no visible effect once rows exist);
     *  - no rows + loading → [UiPhase.Loading] (the web DataTable showing "Loading audit log…");
     *  - no rows + not loading → [UiPhase.Empty] (the web `EmptyState`).
     *
     * The host's stateful binding can additionally carry refreshing/stale/offline/error; the composable
     * renders those too. This parity adapter only produces the states the web `(rows, loading)` can express.
     */
    fun projectUiState(
        rows: List<DLQReplayAuditRecord>,
        loading: Boolean,
    ): UiState<List<DLQReplayAuditRecord>> =
        when {
            rows.isNotEmpty() -> UiState(phase = UiPhase.Content, data = rows)
            loading -> UiState.loading()
            else -> UiState(phase = UiPhase.Empty, data = rows)
        }

    /**
     * The badge color for a replay result — the native mirror of the web `RESULT_VARIANT` table with its
     * `?? 'neutral'` fallback. An unknown/forward-compatible result string folds to [BadgeVariant.Neutral]
     * while still being shown verbatim, exactly like the web.
     */
    fun resultVariant(result: String): BadgeVariant =
        when (result) {
            "ok" -> BadgeVariant.Success
            "publish_failed" -> BadgeVariant.Danger
            "rate_limited" -> BadgeVariant.Warning
            "disabled" -> BadgeVariant.Warning
            "not_found" -> BadgeVariant.Neutral
            "unparseable" -> BadgeVariant.Danger
            else -> BadgeVariant.Neutral
        }

    /** Cell text fallback — the web `row.value || '—'`: an empty string becomes the em dash, else verbatim. */
    fun valueOrDash(value: String): String = value.ifEmpty { EM_DASH }

    /**
     * Whether the empty state shows the scoped (single-entry) message rather than the global one — the web
     * `scopedDlqId ? scopedMessage : globalMessage`. Mirrors JS truthiness, so `null` and `0` both pick the
     * global message; any other id is scoped.
     */
    fun isScoped(scopedDlqId: Long?): Boolean = scopedDlqId != null && scopedDlqId != 0L
}

/**
 * Tolerant ISO-8601 → localized "medium date, short time" formatter — the native analogue of the web
 * `<TimeStamp format="absolute" />` (`formatDateTime`, `toLocaleString` with `{year, month:'short', day,
 * hour, minute}`). Pure (java.time only) so it is unit-tested deterministically with a fixed zone/locale.
 * A blank or unparseable input yields [EM_DASH], exactly like the web helper's invalid-date guard.
 */
object AuditPanelTimeFormatting {
    fun format(
        replayedAt: String,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val instant = parseInstant(replayedAt) ?: return EM_DASH
        return DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields the em-dash guard above.
    private val parsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    private fun parseInstant(raw: String): Instant? = if (raw.isBlank()) null else parsers.firstNotNullOfOrNull { it(raw) }

    private fun tryParse(block: () -> Instant): Instant? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AUDIT_PANEL_SLUG] (P1/S11). Kept free
 * of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordAuditPanelOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AUDIT_PANEL_SLUG))
}
