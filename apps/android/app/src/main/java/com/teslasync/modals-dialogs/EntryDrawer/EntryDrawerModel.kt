// Pure, framework-free model + projection for the EntryDrawer modal/dialog — the native analogue of
// everything the web component derives before it returns JSX
// (web/src/features/admin/components/dlq-inspector/EntryDrawer.tsx). No Compose, no Android, no HTTP: every
// declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable stays a
// thin render layer over these pure functions.
//
// The web component is the DLQ Inspector's entry drawer: a slide-in side panel that surfaces a single
// dead-letter row's summary (id, arrival, topics, reason, VIN, redeliveries, parse error) plus the two payload
// blobs (inner + raw envelope) decoded base64 -> UTF-8 for inspection, behind a Replay CTA that re-publishes
// the entry to its source topic. It binds NO data hook — its only S8/S10 dependency is `useTranslation` — so,
// exactly like the sibling WidgetPicker / ConfirmDialog surfaces, the cache-then-network lifecycle
// (error / stale / offline) lives on the OWNING surface (the DLQ Inspector page, a separate prompt, which runs
// the list + full-entry queries and passes `full` / `loading` down as props), not here; modelling those phases
// would invent behaviour the web spec does not have (a "No silent drift" covenant violation). The render
// states the web source actually defines are the complete set this surface reproduces, and each is projected
// here:
//   1. the loading state — `loading && !full` renders a centered Spinner (carried by the composable; the model
//      exposes [EntryDrawerProjection.showSpinner]),
//   2. the content state — `head = full ?? summary` is present: the summary KVList + the inner/raw payload tabs
//      with their CopyButton and a base64-or-text body,
//   3. the empty state — `head` is null (no summary AND no full): the web renders `null`; the native surface
//      renders a friendly empty state instead of a blank box, per the "never a blank box" rule.
// The footer (Close + Replay) renders in every one of those states, exactly as the web `Drawer` footer prop is
// always present.
//
// base64 decode parity: [decodeBase64Utf8] reproduces the web `decodeBase64Utf8` helper — decode standard
// base64, then decode the bytes as UTF-8 with a FATAL decoder so a binary protobuf body cleanly fails to ""
// (the web `TextDecoder('utf-8', { fatal: true })` + try/catch), letting the render fall back to the localized
// "(non-UTF-8 binary, N bytes)" marker rather than crashing on opaque bytes.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/EntryDrawer — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling modal surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.entrydrawer

import io.teslasync.shared.core.diagnostics.Logger
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.text.NumberFormat
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.util.Base64
import java.util.Locale

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object EntryDrawerRegistration {
    /** Stable surface id. */
    const val ID: String = "dlq-entry-drawer"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "EntryDrawer"
}

/**
 * The fields shared by the summary row and the full row — the native analogue of the structural typing the web
 * `head: DLQEntryFull | DLQEntrySummary` relies on (`full ?? summary`). Every value the drawer's summary panel,
 * title, and Replay-gate read comes from here, so the composable can render from either shape uniformly.
 */
interface DlqEntryHead {
    /** Numeric DLQ row id (web `id`). */
    val id: Long

    /** RFC3339 arrival timestamp (web `arrived_at`); formatted at the render boundary. */
    val arrivedAt: String

    /** The dead-letter topic the row landed on (web `dlq_topic`). */
    val dlqTopic: String

    /** The parsed drop reason (web `parsed_reason`). */
    val parsedReason: String

    /** The parsed VIN, or null when unparseable (web `parsed_vin`). */
    val parsedVin: String?

    /** The parsed original source topic, or null (web `parsed_source_topic`). */
    val parsedSourceTopic: String?

    /** The parsed redelivery count, or null (web `parsed_redeliveries`). */
    val parsedRedeliveries: Long?

    /** A parser error string, or null when the row parsed cleanly (web `parse_error`). */
    val parseError: String?

    /** Whether the row can be replayed — gates the Replay CTA (web `replayable`). */
    val replayable: Boolean

    /** Size in bytes of the raw envelope blob (web `raw_payload_size`). */
    val rawPayloadSize: Long

    /** Size in bytes of the inner payload blob (web `inner_payload_size`). */
    val innerPayloadSize: Long
}

/**
 * Summary row in the DLQ list view — the native mirror of the web `DLQEntrySummary`. The heavy payload blobs
 * are intentionally absent (the list endpoint omits them); they arrive only with [DlqEntryFull].
 * [parsedVehicleId] and [parsedTimestamp] round out the web type but are not rendered by this surface.
 */
data class DlqEntrySummary(
    override val id: Long,
    override val arrivedAt: String,
    override val dlqTopic: String,
    override val parsedReason: String,
    override val parsedVin: String?,
    override val parsedSourceTopic: String?,
    override val parsedRedeliveries: Long?,
    override val parseError: String?,
    override val replayable: Boolean,
    override val rawPayloadSize: Long,
    override val innerPayloadSize: Long,
    val parsedVehicleId: Long? = null,
    val parsedTimestamp: String? = null,
) : DlqEntryHead

/**
 * Full DLQ row — the native mirror of the web `DLQEntryFull extends DLQEntrySummary`: the [summary] plus the
 * two payload blobs as base64 strings. Delegates the [DlqEntryHead] surface to [summary] so `full` reads the
 * same head fields, exactly as the web subtype inherits them.
 */
data class DlqEntryFull(
    val summary: DlqEntrySummary,
    val rawPayloadB64: String,
    val innerPayloadB64: String,
) : DlqEntryHead by summary

/** The two payload viewer tabs — the web `activeTab` union (`'inner' | 'raw'`). */
enum class EntryDrawerTab(
    val key: String,
) {
    Inner("inner"),
    Raw("raw"),
    ;

    companion object {
        /** Resolves a tab from its stable [key], defaulting to [Inner] (the web initial tab). */
        fun fromKey(key: String): EntryDrawerTab = entries.firstOrNull { it.key == key } ?: Inner
    }
}

/**
 * The fully projected, render-ready view — the native analogue of every value the web component computes before
 * returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host. The dash
 * fallbacks ("—") and the decoded payload text are baked in here so the composable just places strings.
 *
 * @property id the row id rendered verbatim (web `head.id`).
 * @property arrivedAtRaw the raw RFC3339 arrival string; formatted at the render boundary (web `arrived_at`).
 * @property dlqTopic the DLQ topic, or "—" when empty (web `head.dlq_topic || '—'`).
 * @property reason the parsed reason, or "—" when empty (web `head.parsed_reason || '—'`).
 * @property vin the parsed VIN, or "—" when null (web `head.parsed_vin ?? '—'`).
 * @property sourceTopic the parsed source topic, or "—" when null (web `head.parsed_source_topic ?? '—'`).
 * @property redeliveries the grouped redelivery count, or "—" when null (web `fmtInt(...) : '—'`).
 * @property parseError the parser error, or "—" when null/empty (web `head.parse_error || '—'`).
 * @property innerText the inner payload decoded base64 -> UTF-8, or "" for a binary body (web `innerText`).
 * @property rawText the raw envelope decoded base64 -> UTF-8, or "" for a binary body (web `rawText`).
 * @property innerPayloadB64 the inner payload base64, or "" when the full row has not loaded yet.
 * @property rawPayloadB64 the raw envelope base64, or "" when the full row has not loaded yet.
 * @property innerPayloadSize byte count for the binary-body fallback (web `head.inner_payload_size`).
 * @property rawPayloadSize byte count for the binary-body fallback (web `head.raw_payload_size`).
 * @property replayable whether the row gates the Replay CTA (web `head?.replayable`).
 */
data class EntryDrawerDisplay(
    val id: String,
    val arrivedAtRaw: String,
    val dlqTopic: String,
    val reason: String,
    val vin: String,
    val sourceTopic: String,
    val redeliveries: String,
    val parseError: String,
    val innerText: String,
    val rawText: String,
    val innerPayloadB64: String,
    val rawPayloadB64: String,
    val innerPayloadSize: Long,
    val rawPayloadSize: Long,
    val replayable: Boolean,
)

/**
 * Pure projection from the surface's props to its render-ready [EntryDrawerDisplay] — a 1:1 port of the
 * derivations the web component performs: the `head = full ?? summary` selection, the `||` / `??` dash
 * fallbacks, the `fmtInt` redelivery formatting, the base64 -> UTF-8 payload decode, the per-tab copy/body text
 * selection, and the Replay-disabled predicate. No Compose, no resource lookups.
 */
object EntryDrawerProjection {
    /** Em-dash sentinel for an absent field — the web `'—'`. */
    const val DASH: String = "\u2014"

    /** The head row the drawer reads — the web `full ?? summary`. Null only when both are absent. */
    fun head(
        summary: DlqEntrySummary?,
        full: DlqEntryFull?,
    ): DlqEntryHead? = full ?: summary

    /**
     * Projects [summary] + [full] into the render-ready [EntryDrawerDisplay], or null when there is no head
     * (web `head ? (...) : null`). When [full] is absent the payload text/base64 collapse to "" so the body
     * shows the localized binary marker and the copy button copies nothing — matching the web's
     * `innerText || full?.inner_payload_b64 || ''` chain.
     */
    fun project(
        summary: DlqEntrySummary?,
        full: DlqEntryFull?,
    ): EntryDrawerDisplay? {
        val head = head(summary, full) ?: return null
        return EntryDrawerDisplay(
            id = head.id.toString(),
            arrivedAtRaw = head.arrivedAt,
            dlqTopic = head.dlqTopic.ifEmpty { DASH },
            reason = head.parsedReason.ifEmpty { DASH },
            vin = head.parsedVin ?: DASH,
            sourceTopic = head.parsedSourceTopic ?: DASH,
            redeliveries = head.parsedRedeliveries?.let { fmtInt(it) } ?: DASH,
            parseError = head.parseError?.ifEmpty { DASH } ?: DASH,
            innerText = full?.let { decodeBase64Utf8(it.innerPayloadB64) } ?: "",
            rawText = full?.let { decodeBase64Utf8(it.rawPayloadB64) } ?: "",
            innerPayloadB64 = full?.innerPayloadB64 ?: "",
            rawPayloadB64 = full?.rawPayloadB64 ?: "",
            innerPayloadSize = head.innerPayloadSize,
            rawPayloadSize = head.rawPayloadSize,
            replayable = head.replayable,
        )
    }

    /**
     * The text the CopyButton writes for [tab] — the web `activeTab === 'inner' ? innerText ||
     * full?.inner_payload_b64 || '' : rawText || full?.raw_payload_b64 || ''`: the decoded UTF-8 text when
     * present, else the base64 blob, else "".
     */
    fun copyText(
        tab: EntryDrawerTab,
        display: EntryDrawerDisplay,
    ): String =
        when (tab) {
            EntryDrawerTab.Inner -> display.innerText.ifEmpty { display.innerPayloadB64 }
            EntryDrawerTab.Raw -> display.rawText.ifEmpty { display.rawPayloadB64 }
        }

    /**
     * The text the payload `<pre>` shows for [tab] — the decoded UTF-8 text when present, else the localized
     * [binaryFallback] marker (web `innerText || t('binaryPayload', ...)` / `rawText || t('binaryEnvelope',
     * ...)`). The caller resolves [binaryFallback] with the matching [payloadSize].
     */
    fun payloadText(
        tab: EntryDrawerTab,
        display: EntryDrawerDisplay,
        binaryFallback: String,
    ): String =
        when (tab) {
            EntryDrawerTab.Inner -> display.innerText.ifEmpty { binaryFallback }
            EntryDrawerTab.Raw -> display.rawText.ifEmpty { binaryFallback }
        }

    /** The byte count interpolated into the binary-body marker for [tab] (web `head.{inner,raw}_payload_size`). */
    fun payloadSize(
        tab: EntryDrawerTab,
        display: EntryDrawerDisplay,
    ): Long =
        when (tab) {
            EntryDrawerTab.Inner -> display.innerPayloadSize
            EntryDrawerTab.Raw -> display.rawPayloadSize
        }

    /**
     * Whether the Replay CTA is disabled — the web `!replayEnabled || !head?.replayable || replayInFlight ||
     * loading`. [replayable] is the head's flag (false when there is no head, matching `!undefined`).
     */
    fun replayDisabled(
        replayEnabled: Boolean,
        replayable: Boolean,
        replayInFlight: Boolean,
        loading: Boolean,
    ): Boolean = !replayEnabled || !replayable || replayInFlight || loading

    /** Whether to show the loading Spinner instead of the body — the web `loading && !full`. */
    fun showSpinner(
        loading: Boolean,
        hasFull: Boolean,
    ): Boolean = loading && !hasFull

    /**
     * Integer-format with grouping separators — the web `fmtInt`, whose default locale is en-US
     * (`12345 -> "12,345"`). A redelivery count is small, but parity keeps the grouped formatting.
     */
    fun fmtInt(value: Long): String = NumberFormat.getIntegerInstance(Locale.US).format(value)

    /**
     * Formats the RFC3339 [raw] arrival string with [formatter] — the web `<TimeStamp format="absolute" />`.
     * An unparseable value falls back to the raw string rather than throwing, so a malformed timestamp never
     * blanks the row. The formatter (and therefore the locale/zone) is injected so this stays deterministically
     * testable off-device.
     */
    fun formatArrivedAt(
        raw: String,
        formatter: DateTimeFormatter,
    ): String =
        parseInstant(raw)?.let { instant ->
            runCatching { formatter.format(instant) }.getOrNull()
        } ?: raw

    /** Parses an RFC3339/ISO instant, tolerating an explicit offset or a trailing `Z`; null when unparseable. */
    private fun parseInstant(raw: String): Instant? =
        runCatching { OffsetDateTime.parse(raw).toInstant() }
            .recoverCatching { Instant.parse(raw) }
            .getOrNull()
}

/**
 * Decodes standard base64 [b64] to a UTF-8 string when possible — the web `decodeBase64Utf8`. Returns "" for an
 * empty input, for invalid base64, and for a successfully-decoded byte run that is NOT valid UTF-8 (the FATAL
 * decoder reports malformed input, matching `new TextDecoder('utf-8', { fatal: true })`), so a binary protobuf
 * body cleanly yields "" and the caller shows the localized binary marker instead of crashing.
 */
fun decodeBase64Utf8(b64: String): String {
    if (b64.isEmpty()) return ""
    return runCatching {
        val bytes = Base64.getDecoder().decode(b64)
        val decoder =
            StandardCharsets.UTF_8
                .newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
        decoder.decode(ByteBuffer.wrap(bytes)).toString()
    }.getOrElse { error ->
        if (error is IllegalArgumentException || error is CharacterCodingException) "" else throw error
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [EntryDrawerRegistration.SLUG] (P1/S11).
 * Carries only the slug — never the entry id, VIN, topic, reason, or payload — so a diagnostics line can never
 * leak dead-letter contents. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * composable calls it from its first-composition effect.
 */
fun recordEntryDrawerOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to EntryDrawerRegistration.SLUG))
}
