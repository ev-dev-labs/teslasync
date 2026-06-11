// Pure, framework-free model + projection for the SecurityStatusCards feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/admin/components/security-access/SecurityStatusCards.tsx + its co-located
// ./helpers.ts). No Compose, no Android framework, no HTTP: every declaration here is unit-tested off-device
// in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer. The web component is
// a presentational child the SecurityAccessPage drives with the polled `useSecurityLatest` snapshot
// (`/security/latest`); on Android the shared S7/S8 layer serves that snapshot as a raw SI `JsonElement`
// (snake_case, Phase-42), so the readers below narrow each field exactly as the web `SecurityEvent` type +
// `asNonEmptyString` guard + helpers.ts (`doorClosed` / `parseWindowState` / `allWindowsClosed` /
// `windowSummary`) do, including the web's raw-truthiness reads of `locked` / `sentryMode` / `homelinkNearby`
// / `guestMode`.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SecurityStatusCards — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling LiveSignalsTable / TelemetryErrorsPanel do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.securitystatuscards

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, lock state, or any
 * security payload, so a diagnostics line can never leak the vehicle's state.
 */
const val SECURITY_STATUS_CARDS_SLUG: String = "SecurityStatusCards"

/** Em dash shown for the windows value when there is no snapshot — the web `windowSummary(undefined)` `'—'`. */
internal const val EM_DASH: String = "\u2014"

// Security-event fields the web reads off `/security/latest`. `locked` is a typed bool; `sentry_mode`,
// `door_state` and the four window corners arrive as either a string enum or a native boolean depending on
// the protomodel emission (web `string | boolean | null`), so the readers below narrow both kinds.
private const val FIELD_LOCKED = "locked"
private const val FIELD_SENTRY_MODE = "sentry_mode"
private const val FIELD_DOOR_STATE = "door_state"
private const val FIELD_HOMELINK_NEARBY = "homelink_nearby"
private const val FIELD_GUEST_MODE = "guest_mode"
private val WINDOW_FIELDS: List<String> = listOf("fd_window", "fp_window", "rd_window", "rp_window")

// Web `doorClosed` tokens: a trimmed, lower-cased door string counts as closed when it is empty or one of
// these. The JSON-object door shape (`{...}`) is detected by this prefix and folded the same way the web
// `Object.values(state).every(v => v === false || v == null)` check does.
private val CLOSED_DOOR_TOKENS: Set<String> = setOf("", "closed", "closedall", "0", "false")
private const val JSON_OBJECT_PREFIX = "{"

// Web `parseWindowState` tokens: a window is Closed when its lower-cased string is `closed`/`0`, Venting when
// it contains `vent`, otherwise Open (any other non-empty string), and Unknown when there is no string.
private const val WINDOW_CLOSED = "closed"
private const val WINDOW_ZERO = "0"
private const val WINDOW_VENT = "vent"
private const val WINDOW_OPEN = "open"

private val MODEL_JSON: Json = Json

/** Which of the six readings a [SecurityCard] represents; the render layer resolves its glyph from this. */
enum class CardKind {
    /** Lock state (web `Lock`/`Unlock`). */
    Lock,

    /** Sentry-mode state (web `ShieldCheck`/`ShieldAlert`). */
    Sentry,

    /** Door open/closed (web `DoorClosed`/`DoorOpen`). */
    Doors,

    /** Window open/closed summary (web `DoorClosed`, tinted by `allWindowsClosed`). */
    Windows,

    /** HomeLink proximity (web `Home`). */
    HomeLink,

    /** Guest-mode state (web `UserCheck`). */
    Guest,
}

/**
 * The semantic tone of a card's icon + value — the native analogue of the per-card Tailwind text color the
 * web component picks. The render layer maps each onto a theme token so light/dark/high-contrast all work.
 */
enum class CardTone {
    /** Web `text-green-400` (locked / doors closed / all windows closed). */
    Positive,

    /** Web `text-red-400` (unlocked). */
    Danger,

    /** Web `text-blue-400` (sentry active). */
    Info,

    /** Web `text-amber-400` (a door / window open, guest mode enabled). */
    Warning,

    /** Web `text-purple-400` (HomeLink nearby). */
    Highlight,

    /** Web `text-[var(--text-muted)]` (sentry off / HomeLink away / guest disabled). */
    Muted,
}

/** A single parsed window-corner state — the native mirror of the web `WindowState` union. */
enum class WindowState { Closed, Venting, Open, Unknown }

/**
 * The doors-card value variant — the native analogue of the web ternary
 * `doorClosed(...) ? t('closed') : (asNonEmptyString(doorState) ?? t('open'))`. [OpenRaw] carries the raw
 * door-state string the backend serves (data, rendered verbatim like the web), while [OpenFallback] is the
 * localized "Open" fallback used when the open door state is not a non-empty string.
 */
sealed interface DoorsValue {
    /** All doors closed — render the localized "Closed" label. */
    data object Closed : DoorsValue

    /** A non-empty raw door-state string the web renders verbatim (e.g. a comma-separated open-corner list). */
    data class OpenRaw(
        val text: String,
    ) : DoorsValue

    /** Doors open but no descriptive string — render the localized "Open" fallback. */
    data object OpenFallback : DoorsValue
}

/**
 * The windows-card value variant — the native analogue of the web `windowSummary` helper. The web labels the
 * open case `"{n} Open/Venting"`; this surface renders `"{n} {open}"` sourcing the open label from the
 * existing P1/S10 catalog key `admin.security.open` (the prompt's extracted Windows-open label), because the
 * catalog has no "Open/Venting" string and this surface's allowed files cannot extend the catalog. The
 * open / non-closed COUNT semantics are identical to the web helper; only the secondary "/Venting" descriptor
 * is dropped in favour of the catalogued label.
 */
sealed interface WindowsSummary {
    /** No snapshot at all (web `windowSummary(undefined)` → em dash). */
    data object NoData : WindowsSummary

    /** Every corner parsed Closed (web `'All Closed'`). */
    data object AllClosed : WindowsSummary

    /** [count] corners are non-closed (web `${openCount} Open/Venting`). */
    data class OpenOrVenting(
        val count: Int,
    ) : WindowsSummary
}

/**
 * One render-ready status card — the native analogue of one web `GlassPanel` (icon + title + value + desc).
 * Pure data (no Compose types) so every branch is unit-tested directly.
 */
data class SecurityCard(
    val kind: CardKind,
    val tone: CardTone,
    val title: String,
    val value: String,
    val description: String,
) {
    /** The merged TalkBack phrase for the card (title, value, description) — one focusable node per card. */
    fun accessibilityLabel(): String = "$title, $value, $description"
}

/**
 * The fully projected, render-ready six-card grid — the native analogue of the JSX the web component returns.
 * Pure data (no Compose types) so every branch is unit-tested directly.
 */
data class SecurityStatusCardsDisplay(
    val cards: List<SecurityCard>,
)

/**
 * The localized strings the cards render — the native mirror of every `t('admin.security.…')` call the web
 * component makes, resolved once at the Compose boundary (P1/S10) and passed in so the projection stays
 * framework-free yet fully localized (the sibling LiveSignalsTable does the same). [windowsAllClosed] resolves
 * the existing `widget.allClosed` catalog key; [snapshotLabel] personalizes the error surface's retry copy.
 */
data class SecurityStatusCardsStrings(
    val lockStatus: String,
    val lockDesc: String,
    val locked: String,
    val unlocked: String,
    val sentryMode: String,
    val sentryDesc: String,
    val active: String,
    val inactive: String,
    val doors: String,
    val doorsDesc: String,
    val closed: String,
    val open: String,
    val windows: String,
    val windowsDesc: String,
    val windowsAllClosed: String,
    val homelink: String,
    val homelinkDesc: String,
    val nearby: String,
    val away: String,
    val guestMode: String,
    val guestDesc: String,
    val enabled: String,
    val disabled: String,
    val snapshotLabel: String,
)

/**
 * The pure decoded security state — the "data adapter" output the web component derives off `latest` before
 * it builds the cards. No strings, no Compose: just the booleans + parsed sub-states the card tones/values
 * are computed from, so the parsing rules (reproduced verbatim from the web source + helpers.ts) are
 * unit-tested in isolation. A `null`/`JsonNull`/non-object snapshot reads exactly as the web `latest`
 * undefined branch (unlocked, sentry off, doors closed, all windows closed, HomeLink away, guest disabled).
 *
 * @property hasSnapshot whether a security object was decoded (web `latest` truthy).
 * @property locked web raw truthiness of `latest.locked`.
 * @property sentryActive web raw truthiness of `latest.sentryMode` (a non-empty string is truthy — the web
 *   card branches on raw truthiness, NOT on `isSentryActive`, so this faithfully reproduces that read).
 * @property doorsClosed web `doorClosed(latest.doorState)`.
 * @property doorsValue the doors-card value variant (closed / raw-open / open-fallback).
 * @property allWindowsClosed web `allWindowsClosed(latest)`.
 * @property windows the windows-card summary variant.
 * @property homelinkNearby web raw truthiness of `latest.homelinkNearby`.
 * @property guestMode web raw truthiness of `latest.guestMode`.
 */
data class SecurityCardsReadout(
    val hasSnapshot: Boolean,
    val locked: Boolean,
    val sentryActive: Boolean,
    val doorsClosed: Boolean,
    val doorsValue: DoorsValue,
    val allWindowsClosed: Boolean,
    val windows: WindowsSummary,
    val homelinkNearby: Boolean,
    val guestMode: Boolean,
) {
    companion object {
        /**
         * Decode [snapshot] into the pure readout — the native port of the field reads + helpers.ts calls in
         * `SecurityStatusCards.tsx`. A `null`/`JsonNull`/non-object snapshot yields the web `latest`-undefined
         * defaults via the `obj?.get(...)` reads below.
         */
        fun from(snapshot: JsonElement?): SecurityCardsReadout {
            val obj = snapshot as? JsonObject
            val doorEl = obj?.get(FIELD_DOOR_STATE)
            val doorsClosed = doorClosed(doorEl)
            return SecurityCardsReadout(
                hasSnapshot = obj != null,
                locked = jsTruthy(obj?.get(FIELD_LOCKED)),
                sentryActive = jsTruthy(obj?.get(FIELD_SENTRY_MODE)),
                doorsClosed = doorsClosed,
                doorsValue = doorsValueOf(doorsClosed, doorEl),
                allWindowsClosed = allWindowsClosed(obj),
                windows = windowsSummary(obj),
                homelinkNearby = jsTruthy(obj?.get(FIELD_HOMELINK_NEARBY)),
                guestMode = jsTruthy(obj?.get(FIELD_GUEST_MODE)),
            )
        }
    }
}

/**
 * Pure projection from a decoded security snapshot to the render-ready [SecurityStatusCardsDisplay] — the
 * native port of the six `GlassPanel` cards `SecurityStatusCards.tsx` returns. Reproduces each card's exact
 * tone (icon + value color) and localized value against the typed contract.
 */
object SecurityStatusCardsProjection {
    /**
     * True when [snapshot] carries no security object (web `latest` undefined). The cards still render with
     * the web's undefined-defaults in that case (never a blank box), so this only drives the [UiState] phase
     * classification, not a separate empty surface.
     */
    fun isEmptySnapshot(snapshot: JsonElement?): Boolean = snapshot !is JsonObject

    /** Project [snapshot] into the six render cards using the localized [strings]. */
    fun project(
        snapshot: JsonElement?,
        strings: SecurityStatusCardsStrings,
    ): SecurityStatusCardsDisplay {
        val r = SecurityCardsReadout.from(snapshot)
        val cards =
            listOf(
                SecurityCard(
                    kind = CardKind.Lock,
                    tone = if (r.locked) CardTone.Positive else CardTone.Danger,
                    title = strings.lockStatus,
                    value = if (r.locked) strings.locked else strings.unlocked,
                    description = strings.lockDesc,
                ),
                SecurityCard(
                    kind = CardKind.Sentry,
                    tone = if (r.sentryActive) CardTone.Info else CardTone.Muted,
                    title = strings.sentryMode,
                    value = if (r.sentryActive) strings.active else strings.inactive,
                    description = strings.sentryDesc,
                ),
                SecurityCard(
                    kind = CardKind.Doors,
                    tone = if (r.doorsClosed) CardTone.Positive else CardTone.Warning,
                    title = strings.doors,
                    value = doorsValueText(r.doorsValue, strings),
                    description = strings.doorsDesc,
                ),
                SecurityCard(
                    kind = CardKind.Windows,
                    tone = if (r.allWindowsClosed) CardTone.Positive else CardTone.Warning,
                    title = strings.windows,
                    value = windowsText(r.windows, strings),
                    description = strings.windowsDesc,
                ),
                SecurityCard(
                    kind = CardKind.HomeLink,
                    tone = if (r.homelinkNearby) CardTone.Highlight else CardTone.Muted,
                    title = strings.homelink,
                    value = if (r.homelinkNearby) strings.nearby else strings.away,
                    description = strings.homelinkDesc,
                ),
                SecurityCard(
                    kind = CardKind.Guest,
                    tone = if (r.guestMode) CardTone.Warning else CardTone.Muted,
                    title = strings.guestMode,
                    value = if (r.guestMode) strings.enabled else strings.disabled,
                    description = strings.guestDesc,
                ),
            )
        return SecurityStatusCardsDisplay(cards)
    }

    /** Resolve the doors-card value text from its variant + localized strings (web doors ternary). */
    internal fun doorsValueText(
        value: DoorsValue,
        strings: SecurityStatusCardsStrings,
    ): String =
        when (value) {
            DoorsValue.Closed -> strings.closed
            is DoorsValue.OpenRaw -> value.text
            DoorsValue.OpenFallback -> strings.open
        }

    /** Resolve the windows-card value text from its variant + localized strings (web `windowSummary`). */
    internal fun windowsText(
        windows: WindowsSummary,
        strings: SecurityStatusCardsStrings,
    ): String =
        when (windows) {
            WindowsSummary.NoData -> EM_DASH
            WindowsSummary.AllClosed -> strings.windowsAllClosed
            is WindowsSummary.OpenOrVenting -> "${windows.count} ${strings.open}"
        }
}

/**
 * The doors-card value variant — web `doorClosed(...) ? closed : (asNonEmptyString(doorState) ?? open)`. When
 * the doors are open and the door state is a non-empty string, the raw string is rendered verbatim
 * ([DoorsValue.OpenRaw]); otherwise the localized "Open" fallback is used ([DoorsValue.OpenFallback]).
 */
internal fun doorsValueOf(
    doorsClosed: Boolean,
    doorState: JsonElement?,
): DoorsValue {
    if (doorsClosed) return DoorsValue.Closed
    val raw = asNonEmptyString(doorState)
    return if (raw != null) DoorsValue.OpenRaw(raw) else DoorsValue.OpenFallback
}

/**
 * JavaScript truthiness of a JSON value — the native analogue of the web `latest?.field ? … : …` reads for
 * `locked` / `sentryMode` / `homelinkNearby` / `guestMode`. `null`/absent/`JsonNull` → false; a boolean → its
 * value; a number → non-zero; a string → non-empty (so `"Off"`/`"false"`/`"0"` are all truthy, exactly as in
 * JS — the web card branches on raw truthiness here); an object/array → true.
 */
internal fun jsTruthy(element: JsonElement?): Boolean =
    when (element) {
        null, is JsonNull -> false
        is JsonObject, is JsonArray -> true
        is JsonPrimitive ->
            when {
                element.isString -> element.content.isNotEmpty()
                element.booleanOrNull != null -> element.booleanOrNull == true
                element.doubleOrNull != null -> element.doubleOrNull != 0.0
                else -> element.content.isNotEmpty()
            }
    }

/** Returns the value only when it is a non-empty JSON string — the native port of web `asNonEmptyString`. */
internal fun asNonEmptyString(element: JsonElement?): String? {
    val primitive = element as? JsonPrimitive ?: return null
    return if (primitive.isString && primitive.content.isNotEmpty()) primitive.content else null
}

/**
 * The native port of web `helpers.ts::doorClosed`. The backend may emit `DoorState` as a bool, number,
 * string enum, or compound object: `null` → closed; boolean → `!value`; number → `== 0`; object → every value
 * false/null; array → closed (web `asNonEmptyString` rejects it); string → closed when the trimmed lower-cased
 * value is empty/`closed`/`closedall`/`0`/`false`, or (for a `{…}` JSON string) every parsed value false/null;
 * otherwise open.
 */
@Suppress("ReturnCount") // Faithful guard-clause port of the web helper; flattening would obscure the parity mapping.
internal fun doorClosed(state: JsonElement?): Boolean {
    if (state == null || state is JsonNull) return true
    if (state is JsonObject) return state.values.all { isFalseOrNull(it) }
    if (state is JsonArray) return true
    val primitive = state as JsonPrimitive
    if (!primitive.isString) {
        primitive.booleanOrNull?.let { return !it }
        primitive.doubleOrNull?.let { return it == 0.0 }
        return true
    }
    val raw = primitive.content
    if (raw.isEmpty()) return true
    val lower = raw.trim().lowercase()
    if (lower in CLOSED_DOOR_TOKENS) return true
    if (lower.startsWith(JSON_OBJECT_PREFIX)) {
        val parsed = runCatching { MODEL_JSON.parseToJsonElement(raw) as? JsonObject }.getOrNull()
        if (parsed != null) return parsed.values.all { isFalseOrNull(it) }
    }
    return false
}

/** Whether a JSON object value counts as "closed" — web `v === false || v == null` (boolean false / null). */
private fun isFalseOrNull(element: JsonElement): Boolean =
    element is JsonNull || (element is JsonPrimitive && !element.isString && element.booleanOrNull == false)

/**
 * The native port of web `helpers.ts::parseWindowState`. Only a non-empty string is classified (the web
 * `asNonEmptyString` guard rejects booleans/numbers → Unknown): `closed`/`0` → Closed; contains `vent` →
 * Venting; any other non-empty string → Open.
 */
@Suppress("ReturnCount") // Faithful guard-clause port of the web helper; flattening would obscure the parity mapping.
internal fun parseWindowState(value: JsonElement?): WindowState {
    val raw = asNonEmptyString(value) ?: return WindowState.Unknown
    val lower = raw.lowercase()
    if (lower == WINDOW_CLOSED || lower == WINDOW_ZERO) return WindowState.Closed
    if (lower.contains(WINDOW_VENT)) return WindowState.Venting
    if (lower.contains(WINDOW_OPEN) || lower != WINDOW_ZERO) return WindowState.Open
    return WindowState.Unknown
}

/** The native port of web `helpers.ts::allWindowsClosed`: no snapshot → true, else every corner Closed. */
internal fun allWindowsClosed(snapshot: JsonObject?): Boolean {
    if (snapshot == null) return true
    return WINDOW_FIELDS.all { parseWindowState(snapshot[it]) == WindowState.Closed }
}

/**
 * The native port of web `helpers.ts::windowSummary`: no snapshot → [WindowsSummary.NoData] (em dash); every
 * corner Closed → [WindowsSummary.AllClosed]; otherwise [WindowsSummary.OpenOrVenting] carrying the count of
 * non-closed corners.
 */
@Suppress("ReturnCount") // Faithful guard-clause port of the web helper; flattening would obscure the parity mapping.
internal fun windowsSummary(snapshot: JsonObject?): WindowsSummary {
    if (snapshot == null) return WindowsSummary.NoData
    val states = WINDOW_FIELDS.map { parseWindowState(snapshot[it]) }
    if (states.all { it == WindowState.Closed }) return WindowsSummary.AllClosed
    return WindowsSummary.OpenOrVenting(states.count { it != WindowState.Closed })
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SECURITY_STATUS_CARDS_SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from the
 * composable's first-composition effect.
 */
fun recordSecurityStatusCardsOpened(logger: Logger) {
    logger.info("view.opened", mapOf("slug" to SECURITY_STATUS_CARDS_SLUG))
}
