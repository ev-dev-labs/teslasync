package io.teslasync.android.push

import android.content.Context
import io.teslasync.android.BuildConfig
import java.util.Locale
import java.util.UUID

/**
 * The production [PushEnvironment] derived from the running package and the system (P3/A6, ADR-009).
 * The app version comes from [BuildConfig], the locale from the system default, and the stable device
 * id from a random per-install UUID persisted in private `SharedPreferences` — deliberately opaque and
 * non-PII (never ANDROID_ID, a serial number, a VIN or a username).
 */
class AndroidPushEnvironment(
    context: Context,
) : PushEnvironment {
    private val appContext = context.applicationContext

    override val platform: String = PushCapabilities.ANDROID_PLATFORM
    override val pushProvider: String = PushCapabilities.FCM_PROVIDER
    override val appVersion: String = BuildConfig.VERSION_NAME
    override val locale: String = Locale.getDefault().toLanguageTag()
    override val capabilities: List<String> = PushCapabilities.ANDROID_DEFAULT
    override val stableDeviceId: String by lazy { loadOrCreateDeviceId() }

    private fun loadOrCreateDeviceId(): String {
        val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString(KEY_DEVICE_ID, null)?.let { return it }
        val generated = UUID.randomUUID().toString()
        prefs.edit().putString(KEY_DEVICE_ID, generated).apply()
        return generated
    }

    private companion object {
        const val PREFS = "teslasync.push.identity"
        const val KEY_DEVICE_ID = "device_id"
    }
}
