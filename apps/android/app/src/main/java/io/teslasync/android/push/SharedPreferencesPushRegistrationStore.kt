package io.teslasync.android.push

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The production [PushRegistrationStore] backed by private `SharedPreferences` (P3/A6). It stores only
 * the non-secret [PushRegistrationRecord] fields — never a token — so a stolen backup can never reveal
 * a push credential. Reads/writes hop to [Dispatchers.IO] since `SharedPreferences` commit touches disk.
 */
class SharedPreferencesPushRegistrationStore(
    context: Context,
) : PushRegistrationStore {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    override suspend fun load(): PushRegistrationRecord? =
        withContext(Dispatchers.IO) {
            val id = prefs.getString(KEY_ID, null) ?: return@withContext null
            PushRegistrationRecord(
                registrationId = id,
                platform = prefs.getString(KEY_PLATFORM, "").orEmpty(),
                appVersion = prefs.getString(KEY_APP_VERSION, "").orEmpty(),
                channelFingerprint = prefs.getString(KEY_FINGERPRINT, "").orEmpty(),
                registeredAtMillis = prefs.getLong(KEY_REGISTERED_AT, 0L),
            )
        }

    override suspend fun save(record: PushRegistrationRecord) {
        withContext(Dispatchers.IO) {
            prefs
                .edit()
                .putString(KEY_ID, record.registrationId)
                .putString(KEY_PLATFORM, record.platform)
                .putString(KEY_APP_VERSION, record.appVersion)
                .putString(KEY_FINGERPRINT, record.channelFingerprint)
                .putLong(KEY_REGISTERED_AT, record.registeredAtMillis)
                .apply()
        }
    }

    override suspend fun clear() {
        withContext(Dispatchers.IO) {
            prefs.edit().clear().apply()
        }
    }

    private companion object {
        const val PREFS = "teslasync.push.registration"
        const val KEY_ID = "registration_id"
        const val KEY_PLATFORM = "platform"
        const val KEY_APP_VERSION = "app_version"
        const val KEY_FINGERPRINT = "channel_fingerprint"
        const val KEY_REGISTERED_AT = "registered_at_millis"
    }
}
