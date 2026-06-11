package io.teslasync.android.push

/**
 * The non-secret registration metadata persisted locally between runs (P3/A6, ADR-009). It records
 * just enough to renew, detect a token change, and unregister the exact backend session — and
 * deliberately stores **no** token. The token is represented only by its non-reversible
 * [channelFingerprint] (see [PushRedaction.fingerprint]).
 */
data class PushRegistrationRecord(
    val registrationId: String,
    val platform: String,
    val appVersion: String,
    val channelFingerprint: String,
    val registeredAtMillis: Long,
)

/**
 * Local persistence for the [PushRegistrationRecord] (P3/A6). The app stores it in private
 * `SharedPreferences` (non-secret); the headless core/tests use an in-memory store. Reads return
 * `null` when nothing is stored.
 */
interface PushRegistrationStore {
    /** Loads the persisted registration metadata, or `null` when absent. */
    suspend fun load(): PushRegistrationRecord?

    /** Persists (replaces) the registration metadata. */
    suspend fun save(record: PushRegistrationRecord)

    /** Removes the persisted registration metadata (idempotent). */
    suspend fun clear()
}

/**
 * An in-memory [PushRegistrationStore] for the headless core and the unit tests. The app overrides
 * this with a `SharedPreferences`-backed implementation.
 */
class InMemoryPushRegistrationStore : PushRegistrationStore {
    private var current: PushRegistrationRecord? = null

    override suspend fun load(): PushRegistrationRecord? = current

    override suspend fun save(record: PushRegistrationRecord) {
        current = record
    }

    override suspend fun clear() {
        current = null
    }
}
