package io.teslasync.android.push

/**
 * The ambient device facts a registration carries to the backend (P3/A6, ADR-009): the platform and
 * push transport, the app version, the user locale, an opaque per-install device identifier, and the
 * notification-capability flags. The app supplies these from the package version, the system locale
 * and a persisted random install id; the headless core/tests use a [StaticPushEnvironment].
 *
 * [stableDeviceId] is deliberately an opaque, non-reversible token (not a serial number, ANDROID_ID,
 * VIN or username) so the registration record carries no personal data.
 */
interface PushEnvironment {
    /** The platform identifier (e.g. [PushCapabilities.ANDROID_PLATFORM]). */
    val platform: String

    /** The push transport identifier (e.g. [PushCapabilities.FCM_PROVIDER]). */
    val pushProvider: String

    /** The running application version (e.g. `0.1.0`). */
    val appVersion: String

    /** The current BCP-47 user locale (e.g. `en-US`). */
    val locale: String

    /** An opaque, stable, non-PII per-install device identifier. */
    val stableDeviceId: String

    /** The notification-capability flags this client supports. */
    val capabilities: List<String>
}

/**
 * A fixed [PushEnvironment] for the headless core and the unit tests. The app registers a
 * package-derived implementation instead.
 */
class StaticPushEnvironment(
    override val appVersion: String,
    override val locale: String,
    override val stableDeviceId: String,
    override val platform: String = PushCapabilities.ANDROID_PLATFORM,
    override val pushProvider: String = PushCapabilities.FCM_PROVIDER,
    override val capabilities: List<String> = PushCapabilities.ANDROID_DEFAULT,
) : PushEnvironment
