// The data seams the NotificationSettings surface binds to (P1/S8 state-holder layer) — the native
// analogues of the four web data sources the component composes
// (web/src/features/settings/components/NotificationSettings.tsx): the server `/settings` document
// (useSettings / useSaveSettings), the device-local web-push event preferences
// (useNotificationListener), the device-local notification-sound preferences (useNotificationSoundPrefs /
// setNotificationSoundPrefs) and the audio cue player (playNotificationSound). The view never touches
// storage, the network, or the audio device directly — it depends on these narrow ports so production
// adapters (SettingsStore, SharedPreferences, ToneGenerator) and test fakes are interchangeable and the
// surface renders the full state matrix uniformly with every other feature view.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/NotificationSettings) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed: the mandated `NotificationSettings*` filename cannot match the
// surface's `NotificationSettingsSource` seam name.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.featureviews.notificationsettings

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlin.math.roundToInt

// ── Web-push event preference store (web useNotificationListener localStorage) ──────────────────────────

/**
 * The device-local web-push event-preference seam — the native port of the web
 * `useNotificationListener` localStorage helpers (`loadPrefs` / `savePrefs`, key
 * `teslasync-web-push-prefs`). A narrow load/save port so the view-model depends on an abstraction
 * (real `SharedPreferences` adapter ↔ test fake), never on storage directly. The data is purely
 * device-local, so it works identically offline.
 */
interface WebPushPrefsStore {
    /** Loads the persisted event preferences, or [WebPushPrefs.DEFAULT] when none exist. */
    suspend fun load(): WebPushPrefs

    /** Persists [prefs]. */
    suspend fun save(prefs: WebPushPrefs)
}

/**
 * The device-local notification-sound preference seam — the native port of the web
 * `useNotificationSoundPrefs` localStorage helpers (`readPrefs` / `setNotificationSoundPrefs`, key
 * `teslasync:notification-sound-prefs:v1`). Load returns a fully-normalised value so the surface never
 * has to special-case a partial blob.
 */
interface NotificationSoundPrefsStore {
    /** Loads the persisted, normalised sound preferences, or [NotificationSoundPrefs.DEFAULT] when none exist. */
    suspend fun load(): NotificationSoundPrefs

    /** Persists [prefs]. */
    suspend fun save(prefs: NotificationSoundPrefs)
}

/**
 * The outcome of a play attempt through the [NotificationSoundPlayer] — the native port of the web
 * `PlayResult`. [Played] is the success; [MasterOff] / [CategoryOff] / [VolumeZero] are the
 * preference-gated silent no-ops; [Unavailable] is the no-audio-device case (web `no_audio_context`);
 * [Failed] is a runtime playback failure (web `play_failed`).
 */
enum class SoundPlayResult { Played, MasterOff, CategoryOff, VolumeZero, Unavailable, Failed }

/**
 * The notification-cue audio seam — the native port of the web `playNotificationSound`. Implementations
 * apply the pure [decideSoundPlay] gate and, when it permits, emit a short per-channel cue. Returns a
 * structured [SoundPlayResult] and never throws (the surface uses it to re-show the playback hint).
 */
interface NotificationSoundPlayer {
    /** Plays the cue for [category] under [prefs], returning why it did or did not sound. */
    fun play(
        prefs: NotificationSoundPrefs,
        category: NotificationSoundCategory,
    ): SoundPlayResult
}

// ── Production adapters ─────────────────────────────────────────────────────────────────────────────────

/**
 * The production [WebPushPrefsStore] backed by private `SharedPreferences` — the device-local analogue of
 * the web hook's `localStorage`. Both flags default to on (web `DEFAULT_PREFS`); reads/writes hop to
 * [Dispatchers.IO] since the commit touches disk.
 */
class SharedPreferencesWebPushPrefsStore(
    context: Context,
) : WebPushPrefsStore {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    override suspend fun load(): WebPushPrefs =
        withContext(Dispatchers.IO) {
            WebPushPrefs(
                alerts = prefs.getBoolean(KEY_ALERTS, WebPushPrefs.DEFAULT.alerts),
                exportStatus = prefs.getBoolean(KEY_EXPORT_STATUS, WebPushPrefs.DEFAULT.exportStatus),
            )
        }

    override suspend fun save(prefs: WebPushPrefs) {
        withContext(Dispatchers.IO) {
            this@SharedPreferencesWebPushPrefsStore
                .prefs
                .edit()
                .putBoolean(KEY_ALERTS, prefs.alerts)
                .putBoolean(KEY_EXPORT_STATUS, prefs.exportStatus)
                .apply()
        }
    }

    private companion object {
        const val PREFS = "teslasync.web.push.prefs.v1"
        const val KEY_ALERTS = "alerts"
        const val KEY_EXPORT_STATUS = "export_status"
    }
}

/**
 * The production [NotificationSoundPrefsStore] backed by private `SharedPreferences` — the device-local
 * analogue of the web hook's `localStorage`. The master flag, the seven per-channel gates (keyed by the
 * stable [NotificationSoundCategory.wire] token) and the `[0, 1]` volume are stored as native primitives;
 * a partial entry is filled out by [NotificationSoundPrefs.normalize] on read.
 */
class SharedPreferencesNotificationSoundPrefsStore(
    context: Context,
) : NotificationSoundPrefsStore {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    override suspend fun load(): NotificationSoundPrefs =
        withContext(Dispatchers.IO) {
            val perCategory =
                NotificationSoundCategory.entries.associateWith { category ->
                    prefs.getBoolean(categoryKey(category), NotificationSoundPrefs.DEFAULT.perCategory.getValue(category))
                }
            NotificationSoundPrefs.normalize(
                master = prefs.getBoolean(KEY_MASTER, NotificationSoundPrefs.DEFAULT.master),
                perCategory = perCategory,
                volume = prefs.getFloat(KEY_VOLUME, NotificationSoundPrefs.DEFAULT.volume),
            )
        }

    override suspend fun save(prefs: NotificationSoundPrefs) {
        withContext(Dispatchers.IO) {
            val editor = this@SharedPreferencesNotificationSoundPrefsStore.prefs.edit()
            editor.putBoolean(KEY_MASTER, prefs.master)
            editor.putFloat(KEY_VOLUME, clampVolume(prefs.volume))
            NotificationSoundCategory.entries.forEach { category ->
                editor.putBoolean(categoryKey(category), prefs.isCategoryEnabled(category))
            }
            editor.apply()
        }
    }

    private fun categoryKey(category: NotificationSoundCategory): String = "$KEY_CATEGORY_PREFIX${category.wire}"

    private companion object {
        const val PREFS = "teslasync.notification.sound.prefs.v1"
        const val KEY_MASTER = "master"
        const val KEY_VOLUME = "volume"
        const val KEY_CATEGORY_PREFIX = "category_"
    }
}

/**
 * The production [NotificationSoundPlayer] backed by the platform [ToneGenerator] on the notification
 * stream — the Android-native equivalent of the web WebAudio synthesiser. It applies the pure
 * [decideSoundPlay] gate, maps the `[0, 1]` volume onto the generator's `0..100` scale, and emits a short,
 * per-channel-distinct tone so each cue is recognisable (the web "distinct tone profile per category"
 * intent). The generator is released shortly after the tone so no audio resource leaks. Construction can
 * fail when the device has no free tone resources; that is reported as [SoundPlayResult.Failed] rather
 * than thrown.
 */
class ToneGeneratorNotificationSoundPlayer(
    private val releaseHandler: Handler = Handler(Looper.getMainLooper()),
) : NotificationSoundPlayer {
    override fun play(
        prefs: NotificationSoundPrefs,
        category: NotificationSoundCategory,
    ): SoundPlayResult =
        when (decideSoundPlay(prefs, category)) {
            SoundPlayDecision.MasterOff -> SoundPlayResult.MasterOff
            SoundPlayDecision.CategoryOff -> SoundPlayResult.CategoryOff
            SoundPlayDecision.VolumeZero -> SoundPlayResult.VolumeZero
            SoundPlayDecision.Play -> emit(prefs, category)
        }

    private fun emit(
        prefs: NotificationSoundPrefs,
        category: NotificationSoundCategory,
    ): SoundPlayResult {
        val level = (clampVolume(prefs.volume) * MAX_TONE_VOLUME).roundToInt().coerceIn(MIN_TONE_VOLUME, MAX_TONE_VOLUME)
        // runCatching (not a generic catch clause) so a ToneGenerator resource failure is reported, never thrown.
        val played =
            runCatching {
                val generator = ToneGenerator(AudioManager.STREAM_NOTIFICATION, level)
                generator.startTone(toneFor(category), TONE_DURATION_MS)
                releaseHandler.postDelayed({ generator.release() }, RELEASE_DELAY_MS)
            }.isSuccess
        return if (played) SoundPlayResult.Played else SoundPlayResult.Failed
    }

    private fun toneFor(category: NotificationSoundCategory): Int =
        when (category) {
            NotificationSoundCategory.CriticalAlert -> ToneGenerator.TONE_CDMA_ABBR_ALERT
            NotificationSoundCategory.WarningAlert -> ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD
            NotificationSoundCategory.InfoAlert -> ToneGenerator.TONE_PROP_BEEP
            NotificationSoundCategory.ChargeComplete -> ToneGenerator.TONE_CDMA_CONFIRM
            NotificationSoundCategory.DriveComplete -> ToneGenerator.TONE_PROP_BEEP2
            NotificationSoundCategory.AutomationRun -> ToneGenerator.TONE_PROP_ACK
            NotificationSoundCategory.Achievement -> ToneGenerator.TONE_CDMA_PIP
        }

    private companion object {
        const val MIN_TONE_VOLUME = 1
        const val MAX_TONE_VOLUME = 100
        const val TONE_DURATION_MS = 300
        const val RELEASE_DELAY_MS = 600L
    }
}

// ── In-memory fakes (previews, host fallback, tests) ────────────────────────────────────────────────────

/** An in-memory [WebPushPrefsStore] for previews and tests. Mutations are reflected on the next [load]. */
class InMemoryWebPushPrefsStore(
    initial: WebPushPrefs = WebPushPrefs.DEFAULT,
) : WebPushPrefsStore {
    private var current = initial

    override suspend fun load(): WebPushPrefs = current

    override suspend fun save(prefs: WebPushPrefs) {
        current = prefs
    }
}

/** An in-memory [NotificationSoundPrefsStore] for previews and tests. */
class InMemoryNotificationSoundPrefsStore(
    initial: NotificationSoundPrefs = NotificationSoundPrefs.DEFAULT,
) : NotificationSoundPrefsStore {
    private var current = initial

    override suspend fun load(): NotificationSoundPrefs = current

    override suspend fun save(prefs: NotificationSoundPrefs) {
        current = prefs
    }
}

/**
 * A [NotificationSoundPlayer] that performs no audio — it only applies the pure [decideSoundPlay] gate and
 * reports the result. Used by previews and JVM tests (where no audio device exists) and as the host's
 * fallback; the gated cue would be inaudible there anyway.
 */
class SilentNotificationSoundPlayer : NotificationSoundPlayer {
    override fun play(
        prefs: NotificationSoundPrefs,
        category: NotificationSoundCategory,
    ): SoundPlayResult =
        when (decideSoundPlay(prefs, category)) {
            SoundPlayDecision.MasterOff -> SoundPlayResult.MasterOff
            SoundPlayDecision.CategoryOff -> SoundPlayResult.CategoryOff
            SoundPlayDecision.VolumeZero -> SoundPlayResult.VolumeZero
            SoundPlayDecision.Play -> SoundPlayResult.Played
        }
}

// ── The bundled surface seam the view-model binds ───────────────────────────────────────────────────────

/**
 * The single port the [NotificationSettingsViewModel] depends on — bundling the four web data sources so
 * the view-model has one injection point and tests one fake. [settingsDocument] is the cache-then-network
 * `/settings` document feed (the only network-backed source, driving the loading / content / stale /
 * offline / error matrix); [saveSettingsDocument] persists the full merged document. The remaining members
 * are device-local: the web-push event prefs, the sound prefs, and the cue player.
 */
interface NotificationSettingsSource {
    /** The raw `/settings` document as a cache-then-network feed (web `useSettings`). Fresh per collection. */
    fun settingsDocument(): Flow<Resource<JsonElement>>

    /** Persists the full `/settings` [document] (web `useSaveSettings` full-replace), refreshing the feed. */
    suspend fun saveSettingsDocument(document: JsonElement): Result<Unit>

    /** Loads the device-local web-push event prefs (web `useNotificationListener`). */
    suspend fun loadWebPushPrefs(): WebPushPrefs

    /** Persists the device-local web-push event prefs (web `setPrefs`). */
    suspend fun saveWebPushPrefs(prefs: WebPushPrefs)

    /** Loads the device-local sound prefs (web `useNotificationSoundPrefs`). */
    suspend fun loadSoundPrefs(): NotificationSoundPrefs

    /** Persists the device-local sound prefs (web `setNotificationSoundPrefs`). */
    suspend fun saveSoundPrefs(prefs: NotificationSoundPrefs)

    /** Plays a notification cue for [category] under [prefs] (web `playNotificationSound`). */
    fun playSound(
        prefs: NotificationSoundPrefs,
        category: NotificationSoundCategory,
    ): SoundPlayResult
}

/**
 * The production [NotificationSettingsSource]. The document feed and save delegate to the shared
 * [SettingsRepository] (S7) — the refetch-on-retry binding: each [settingsDocument] collection is a fresh
 * cache-then-network fetch, so the view-model's retry simply re-collects it (the same binding
 * NotificationChannelsView uses for its retry affordance). The device-local prefs and the cue player are
 * delegated to their respective seams.
 */
class DefaultNotificationSettingsSource(
    private val settingsRepository: SettingsRepository,
    private val webPushPrefsStore: WebPushPrefsStore,
    private val soundPrefsStore: NotificationSoundPrefsStore,
    private val player: NotificationSoundPlayer,
) : NotificationSettingsSource {
    override fun settingsDocument(): Flow<Resource<JsonElement>> = settingsRepository.settings()

    override suspend fun saveSettingsDocument(document: JsonElement): Result<Unit> = settingsRepository.saveSettings(document).map { }

    override suspend fun loadWebPushPrefs(): WebPushPrefs = webPushPrefsStore.load()

    override suspend fun saveWebPushPrefs(prefs: WebPushPrefs) = webPushPrefsStore.save(prefs)

    override suspend fun loadSoundPrefs(): NotificationSoundPrefs = soundPrefsStore.load()

    override suspend fun saveSoundPrefs(prefs: NotificationSoundPrefs) = soundPrefsStore.save(prefs)

    override fun playSound(
        prefs: NotificationSoundPrefs,
        category: NotificationSoundCategory,
    ): SoundPlayResult = player.play(prefs, category)
}

/**
 * Wires the production [NotificationSettingsSource] from the shared [SettingsRepository] (S7, the
 * refetch-on-retry binding) plus the device-local stores and the cue player — the single composition
 * point a host uses.
 */
fun notificationSettingsSource(
    settingsRepository: SettingsRepository,
    webPushPrefsStore: WebPushPrefsStore,
    soundPrefsStore: NotificationSoundPrefsStore,
    player: NotificationSoundPlayer,
): NotificationSettingsSource = DefaultNotificationSettingsSource(settingsRepository, webPushPrefsStore, soundPrefsStore, player)

/**
 * Maps a `/settings` document [Resource] onto a [TabSignals] resource — reading the two default-ON flags
 * out of each carried value. A cached document maps to its flags; a `null` cached value (first load, hard
 * error) stays `null` so the section shows its skeleton / error surface.
 */
internal fun Resource<JsonElement>.toTabSignals(): Resource<TabSignals> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(TabSignals::read), fetchedAt, stale)
        is Resource.Success -> Resource.Success(TabSignals.read(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(TabSignals::read), fetchedAt, stale, error)
    }
