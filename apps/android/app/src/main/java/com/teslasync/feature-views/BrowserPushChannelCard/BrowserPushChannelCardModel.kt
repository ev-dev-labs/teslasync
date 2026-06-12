// Pure, framework-free model + projection for the BrowserPushChannelCard feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/notifications/components/BrowserPushChannelCard.tsx + its useWebPush / usePush hooks and the
// PushSubscriptionRow API type). No Compose, no Android, no HTTP: every declaration here is unit-tested
// off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component is presentational over a few hooks. The only logic it owns is reproduced here: the
// "disabled reason" cascade (web `disabledReason` IIFE — notifications-unsupported → server-not-configured →
// push-API-unsupported → permission-denied, else null), the derived `isPushSupported`
// (`isPushAPISupported && !!publicKey`), the status badge selection (subscribed / not-subscribed / unsupported),
// the enable-vs-disable action choice, and the per-device row projection (web `rows.map`: this-device marker,
// the user-agent / "Unknown browser" fallback, and the `last_used_at` → "Last used {when}" / "Not yet used"
// relative-time line). Browser web-push maps to the native FCM device-push pipeline, so the this-device
// subscription is projected from the shared `PushRegistrationState` (P1/S8) — `Registered` ⇒ subscribed with the
// backend registration id as the device endpoint.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/BrowserPushChannelCard — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.browserpushchannelcard

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.push.PushRegistrationState
import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeParseException
import io.teslasync.android.components.datadisplay.relativeAge as freshnessBucket

/** Em dash shown for a present-but-unparseable timestamp at the render boundary. */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object BrowserPushChannelCardRegistration {
    /** Stable surface id. */
    const val ID: String = "browser-push-channel-card"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "BrowserPushChannelCard"
}

// ── i18n key mirrors (P1/S10) ──
// The web `t('webpush.*')` keys, flattened to the generated Android catalog names. Referencing them in one
// place keeps the composable and the off-device test in lockstep with the catalog and documents the
// web → native key contract.

/** Panel heading — web `t('webpush.title', 'Browser push')`. */
const val KEY_TITLE: String = "translation_webpush_title"

/** Panel subtitle — web `t('webpush.subtitle', 'Get OS-level notifications even when TeslaSync is closed.')`. */
const val KEY_SUBTITLE: String = "translation_webpush_subtitle"

/** Subscribed badge — web `t('webpush.status.subscribed', 'Active on this device')`. */
const val KEY_STATUS_SUBSCRIBED: String = "translation_webpush_status_subscribed"

/** Not-subscribed badge — web `t('webpush.status.notSubscribed', 'Not subscribed')`. */
const val KEY_STATUS_NOT_SUBSCRIBED: String = "translation_webpush_status_notSubscribed"

/** Unavailable badge — web `t('webpush.status.unsupported', 'Unavailable')`. */
const val KEY_STATUS_UNSUPPORTED: String = "translation_webpush_status_unsupported"

/** Enable action — web `t('webpush.enable', 'Enable on this device')`. */
const val KEY_ENABLE: String = "translation_webpush_enable"

/** Disable action — web `t('webpush.disable', 'Disable on this device')`. */
const val KEY_DISABLE: String = "translation_webpush_disable"

/** iOS note — web `t('webpush.iosNote', …)`. */
const val KEY_IOS_NOTE: String = "translation_webpush_iosNote"

/** Disabled reason: notifications unsupported — web `t('webpush.unsupported.notification', …)`. */
const val KEY_UNSUPPORTED_NOTIFICATION: String = "translation_webpush_unsupported_notification"

/** Disabled reason: server not configured — web `t('webpush.unsupported.serverDisabled', …)`. */
const val KEY_UNSUPPORTED_SERVER_DISABLED: String = "translation_webpush_unsupported_serverDisabled"

/** Disabled reason: push API unsupported — web `t('webpush.unsupported.pushApi', …)`. */
const val KEY_UNSUPPORTED_PUSH_API: String = "translation_webpush_unsupported_pushApi"

/** Disabled reason: permission denied — web `t('webpush.unsupported.permissionDenied', …)`. */
const val KEY_UNSUPPORTED_PERMISSION_DENIED: String = "translation_webpush_unsupported_permissionDenied"

/** Devices section heading — web `t('webpush.devices.title', 'Registered devices')`. */
const val KEY_DEVICES_TITLE: String = "translation_webpush_devices_title"

/** Device last-used line — web `t('webpush.devices.lastUsed', 'Last used {{when}}')` (catalog `%1$s`). */
const val KEY_DEVICES_LAST_USED: String = "translation_webpush_devices_lastUsed"

/** Device never-used line — web `t('webpush.devices.neverUsed', 'Not yet used')`. */
const val KEY_DEVICES_NEVER_USED: String = "translation_webpush_devices_neverUsed"

/** Remove-device action — web `t('webpush.devices.remove', 'Remove this device')`. */
const val KEY_DEVICES_REMOVE: String = "translation_webpush_devices_remove"

/** This-device marker — web `t('webpush.devices.thisDevice', '(this device)')`. */
const val KEY_DEVICES_THIS_DEVICE: String = "translation_webpush_devices_thisDevice"

/** Unknown-agent fallback — web `t('webpush.devices.unknownAgent', 'Unknown browser')`. */
const val KEY_DEVICES_UNKNOWN_AGENT: String = "translation_webpush_devices_unknownAgent"

/** Empty-state copy for the registered-devices list — the shared `common.noData` key. */
const val KEY_NO_DEVICES: String = "translation_common_noData"

// ── Domain enums (web string unions / derived states) ──

/**
 * The runtime notification permission — the native analogue of the web `NotificationPermission`
 * (`'default' | 'granted' | 'denied'`). [Denied] is the only value the web `disabledReason` cascade treats
 * specially; the host derives it from `POST_NOTIFICATIONS` on API 33+ (granted at install below 33).
 */
enum class BrowserPushPermission { Default, Granted, Denied }

/** The status chip the header shows on the right — the web `Badge` branch. */
enum class BrowserPushBadge { Subscribed, NotSubscribed, Unsupported }

/**
 * The mutually-exclusive reason browser push is unavailable, each carrying the i18n [key] of its message —
 * the web `disabledReason` cascade. `null` (no value) means push is available and the action row renders.
 */
enum class BrowserPushDisabledReason(
    val key: String,
) {
    NotificationUnsupported(KEY_UNSUPPORTED_NOTIFICATION),
    ServerDisabled(KEY_UNSUPPORTED_SERVER_DISABLED),
    PushApiUnsupported(KEY_UNSUPPORTED_PUSH_API),
    PermissionDenied(KEY_UNSUPPORTED_PERMISSION_DENIED),
}

/** The single action the supported card offers — web Enable (primary) vs Disable (secondary). */
enum class BrowserPushAction { Enable, Disable }

/**
 * One row of the registered-devices list as it arrives from the server — the web `PushSubscriptionRow`
 * (only the fields the card reads). [userAgent] / [lastUsedAt] are nullable exactly as on the wire.
 */
data class PushSubscriptionRow(
    val id: Long,
    val endpoint: String,
    val userAgent: String? = null,
    val lastUsedAt: String? = null,
)

/**
 * The combined this-device push capability + subscription state the header branch reads — the native
 * projection of the web `useWebPush()` return plus `usePushPublicKey()`. [serverConfigured] mirrors the web
 * VAPID `publicKey`: `null` while it is loading/unknown, `false` when the server has no push configured (web
 * `publicKey === null`), `true` when configured. [currentEndpoint] is this device's backend registration id
 * (the native analogue of the browser push endpoint) when [isSubscribed].
 */
data class BrowserPushChannelStatus(
    val notifSupported: Boolean,
    val pushApiSupported: Boolean,
    val serverConfigured: Boolean?,
    val keyLoading: Boolean,
    val permission: BrowserPushPermission,
    val isSubscribed: Boolean,
    val currentEndpoint: String?,
)

/**
 * A render-ready registered-device row — the projection of a [PushSubscriptionRow]. [userAgent] is blanked to
 * `null` so the composable can substitute the localized "Unknown browser"; [lastUsedAge] is `null` when the
 * device has never been used (web `Not yet used`) and otherwise the relative-age bucket for "Last used {when}".
 */
data class BrowserPushDeviceRow(
    val id: Long,
    val endpoint: String,
    val userAgent: String?,
    val isThisDevice: Boolean,
    val lastUsedAge: FreshnessAge?,
)

/**
 * The pure projections the composable and the off-device test share. Each mirrors a slice of the web
 * component's render logic; none touches Compose, Android, or the network.
 */
object BrowserPushChannelCardProjection {
    /** Web `isPushSupported = isPushAPISupported && !!publicKey`. */
    fun isPushSupported(status: BrowserPushChannelStatus): Boolean = status.pushApiSupported && status.serverConfigured == true

    /**
     * The web `disabledReason` cascade, in order: notifications unsupported, then server-not-configured (push
     * unsupported AND the key has finished loading AND it is absent), then push-API unsupported, then
     * permission denied; otherwise `null` (available).
     */
    fun disabledReason(status: BrowserPushChannelStatus): BrowserPushDisabledReason? =
        when {
            !status.notifSupported -> BrowserPushDisabledReason.NotificationUnsupported
            !isPushSupported(status) && !status.keyLoading && status.serverConfigured == false ->
                BrowserPushDisabledReason.ServerDisabled
            !isPushSupported(status) -> BrowserPushDisabledReason.PushApiUnsupported
            status.permission == BrowserPushPermission.Denied -> BrowserPushDisabledReason.PermissionDenied
            else -> null
        }

    /** True when a [disabledReason] applies — the web `isUnsupported = disabledReason !== null`. */
    fun isUnsupported(status: BrowserPushChannelStatus): Boolean = disabledReason(status) != null

    /** The header status chip — web warning "Unavailable" when unsupported, else subscribed/not-subscribed. */
    fun badge(status: BrowserPushChannelStatus): BrowserPushBadge =
        when {
            isUnsupported(status) -> BrowserPushBadge.Unsupported
            status.isSubscribed -> BrowserPushBadge.Subscribed
            else -> BrowserPushBadge.NotSubscribed
        }

    /** The action the supported card offers — Disable when subscribed, Enable otherwise; `null` when unsupported. */
    fun action(status: BrowserPushChannelStatus): BrowserPushAction? =
        when {
            isUnsupported(status) -> null
            status.isSubscribed -> BrowserPushAction.Disable
            else -> BrowserPushAction.Enable
        }

    /** True while a usable backend registration exists — `PushRegistrationState.Registered` (web `isSubscribed`). */
    fun isSubscribed(registration: PushRegistrationState): Boolean = registration is PushRegistrationState.Registered

    /**
     * This device's endpoint — the backend registration id when [registration] is
     * [PushRegistrationState.Registered], else `null` (the native analogue of the web `currentEndpoint`).
     */
    fun currentEndpoint(registration: PushRegistrationState): String? = (registration as? PushRegistrationState.Registered)?.registrationId

    /**
     * Projects server [rows] into render-ready device rows, preserving order — the web `rows.map`. [ageOf]
     * resolves a `last_used_at` ISO stamp to a relative-age bucket; injecting it keeps this deterministic for
     * tests (the composable supplies the real clock-backed formatter). A blank user-agent is blanked to `null`
     * (composable shows "Unknown browser"); an absent `last_used_at` yields a `null` age ("Not yet used").
     */
    fun projectDevices(
        rows: List<PushSubscriptionRow>,
        currentEndpoint: String?,
        ageOf: (timestamp: String) -> FreshnessAge,
    ): List<BrowserPushDeviceRow> =
        rows.map { row ->
            BrowserPushDeviceRow(
                id = row.id,
                endpoint = row.endpoint,
                userAgent = row.userAgent?.takeIf { it.isNotBlank() },
                isThisDevice = currentEndpoint != null && currentEndpoint == row.endpoint,
                lastUsedAge = row.lastUsedAt?.takeIf { it.isNotBlank() }?.let(ageOf),
            )
        }
}

// ── Lifecycle classifier (per-state coverage for the registered-devices feed) ──

/**
 * The mutually-exclusive registered-devices surface the composable switches on — the native lifecycle chrome
 * the host's cache-then-network device feed implies. [Ready] then renders the device rows or the empty state;
 * [Loading]/[Error] render the first-load skeleton and the retry surface.
 */
enum class BrowserPushDevicesSurface { Loading, Error, Ready }

/**
 * Classifies the lifecycle flags of the device-list `UiState` into the surface to render. A first load with
 * nothing cached shows [Loading]; a hard error with no cached fallback shows [Error]; everything else (content,
 * empty, and stale/offline "last known") is [Ready]. Loading takes precedence over error so a
 * refresh-with-skeleton never flashes the error surface.
 */
fun browserPushDevicesSurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
): BrowserPushDevicesSurface =
    when {
        isLoading -> BrowserPushDevicesSurface.Loading
        isError -> BrowserPushDevicesSurface.Error
        else -> BrowserPushDevicesSurface.Ready
    }

// ── Relative-time formatting (web `formatRelative` for `last_used_at`) ──

/**
 * Tolerant ISO-8601 → relative-age bucketing for a device's `last_used_at` — the native analogue of the web
 * `formatRelative`. Pure (java.time only) so it is unit-tested deterministically with a fixed clock; the
 * composable resolves the [FreshnessAge] bucket to a localized string via the shared `translation_freshness_*`
 * keys. Reuses the shared day/week-fall-through bucketer so it matches the rest of the app.
 */
object BrowserPushTimeFormatting {
    /**
     * Whole seconds between [timestamp] and [nowMillis] (may be negative for a future stamp); `null` when the
     * timestamp is blank or unparseable.
     */
    fun ageSeconds(
        timestamp: String,
        nowMillis: Long,
    ): Long? {
        val instant = parseInstant(timestamp) ?: return null
        return (nowMillis - instant.toEpochMilli()) / MILLIS_PER_SECOND
    }

    /**
     * Buckets [timestamp] into a [FreshnessAge] relative to [nowMillis] (blank/unparseable → [FreshnessAge.Unknown]
     * → em-dash at the render boundary). A future stamp clamps to "just now" via the shared bucketer's floor.
     */
    fun relativeAge(
        timestamp: String,
        nowMillis: Long,
    ): FreshnessAge = freshnessBucket(ageSeconds(timestamp, nowMillis))

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields null.
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
 * Emits the one PII-safe `view.opened` diagnostic with the surface [BrowserPushChannelCardRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from
 * its first-composition effect. Carries no token, endpoint, or user-agent — only the static surface slug.
 */
fun recordBrowserPushChannelCardOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to BrowserPushChannelCardRegistration.SLUG))
}

private const val MILLIS_PER_SECOND: Long = 1000L
