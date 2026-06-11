package io.teslasync.android.dashboardwidgets

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.admin.AdminStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import java.util.concurrent.atomic.AtomicInteger

/**
 * Canonical registry metadata for the Backup Monitor surface — the native mirror of the web registry
 * entry in web/src/features/dashboard/widgets/registry/system.ts. A dashboard host registers this
 * surface with the same [ID] and honours the same size constraints in the grid system.
 */
object BackupMonitorRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "backup-monitor"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "system"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "BackupMonitorWidget"

    /** Default footprint: 2 columns × 2 rows. */
    val defaultSize = BackupMonitorSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize = BackupMonitorSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize = BackupMonitorSize(cols = 4, rows = 40)

    /** True when [size] falls within the min/max footprint constraints. */
    fun isWithinBounds(size: BackupMonitorSize): Boolean =
        size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: BackupMonitorSize): BackupMonitorSize =
        BackupMonitorSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * Stable Compose test tags the [BackupMonitorWidget] stamps on each surface so the instrumented
 * per-state UI/accessibility tests assert the rendered branch unambiguously (independent of localized
 * copy), mirroring the navigation-shell `PageStateTags` convention.
 */
object BackupMonitorTags {
    const val ROOT = "backup-monitor"
    const val LOADING = "backup-monitor-loading"
    const val ERROR = "backup-monitor-error"
    const val EMPTY = "backup-monitor-empty"
    const val CONTENT = "backup-monitor-content"
    const val COMPACT = "backup-monitor-compact"
    const val STAT_GRID = "backup-monitor-stat-grid"
    const val RECENT_RUNS = "backup-monitor-recent-runs"
    const val FRESHNESS = "backup-monitor-freshness"
    const val REFRESH = "backup-monitor-refresh"
}

/**
 * PII-safe diagnostics for the Backup Monitor surface (P1/S11 diagnostics contract). Records only the
 * operational `view.opened` event with the surface slug — never a backup file name, size or timestamp
 * — so a diagnostics line can never leak an operator's backup schedule or storage footprint. The
 * shared product-analytics [io.teslasync.shared.core.diagnostics.Telemetry] taxonomy is closed, so this
 * surface-local collector emits to an optional [sink] (mirroring the Windows `BackupMonitorDiagnostics`).
 */
class BackupMonitorDiagnostics(
    private val sink: ((String) -> Unit)? = null,
) {
    private val opened = AtomicInteger(0)

    /** Number of times the surface has been opened. */
    val viewsOpened: Int get() = opened.get()

    /** Record that the surface was opened, emitting `view.opened slug=BackupMonitorWidget`. */
    fun recordViewOpened() {
        opened.incrementAndGet()
        sink?.invoke("view.opened slug=${BackupMonitorRegistration.SLUG}")
    }
}

/**
 * The data port the widget binds to — the surface-local "state-holder seam" (P1/S8). It streams the
 * cache-then-network sequence of parsed [BackupMonitorSnapshot] values, the native analogue of the web
 * component's `useBackupRuns` hook. The view never performs HTTP itself; a concrete source (or a test
 * fake) drives this.
 */
interface BackupRunsSource {
    /** Stream the cache-then-network backup-runs snapshots (cached value first, then the refresh). */
    fun stream(): Flow<Resource<BackupMonitorSnapshot>>
}

/**
 * The production [BackupRunsSource] — binds the shared S8 [AdminStore] `backupRuns()` feed (the KMP
 * port of `useBackupRuns`) and parses each raw `GET /backup/runs` [JsonElement] emission into a typed
 * [BackupMonitorSnapshot]. No HTTP touches the view; the store owns the cache-then-network read and
 * the shared live cache, so every Admin surface folds onto one upstream collection.
 */
class AdminStoreBackupRunsSource(
    private val store: AdminStore,
) : BackupRunsSource {
    override fun stream(): Flow<Resource<BackupMonitorSnapshot>> = store.backupRuns().map { it.toSnapshotResource() }
}

/**
 * The immutable, render-ready state the [BackupMonitorStateHolder] exposes — the lifecycle-aware
 * projection of the shared cache-then-network [Resource] onto the widget's surfaces. [phase] selects
 * the body (loading / content / empty / error); the freshness flags ([updatedAtMillis], [refreshing],
 * [stale], [errorKind]) drive the header chip exactly like the web `WidgetShell` `shellProps`.
 */
data class BackupMonitorUiState(
    val phase: UiPhase,
    val display: BackupMonitorDisplay,
    val updatedAtMillis: Long?,
    val refreshing: Boolean,
    val stale: Boolean,
    val errorKind: ErrorKind?,
    val errorStatus: Int?,
) {
    /** True when the last load failed even though cached content is still shown (offline / last known). */
    val hasError: Boolean get() = errorKind != null

    /** Connectivity hint for `classifyQueryError`: a network/timeout failure means offline. */
    val online: Boolean get() = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout

    /** Transient back-pressure (circuit open) maps to the web `QueryError` "waiting" surface. */
    val transientWaiting: Boolean get() = errorKind == ErrorKind.CircuitOpen

    companion object {
        /** The initial pre-collection state: a first load with nothing cached. */
        val LOADING: BackupMonitorUiState =
            BackupMonitorUiState(
                phase = UiPhase.Loading,
                display = BackupMonitorDisplay.EMPTY,
                updatedAtMillis = null,
                refreshing = false,
                stale = false,
                errorKind = null,
                errorStatus = null,
            )
    }
}

/**
 * UI-thread-free state holder backing the Compose [BackupMonitorWidget] — the native port of the web
 * component's `useBackupRuns` composition. It collects the cache-then-network [BackupRunsSource],
 * projects each snapshot through [BackupMonitorProjection], and exposes the single hot
 * [state]. It owns no networking — the source (and the shared store behind it) do. [retry] re-subscribes
 * to the live feed.
 *
 * @param source the surface-local data port (S8-backed in production, a fake in tests).
 * @param scope the coroutine scope the projected feed is shared in (cancelling it stops it).
 * @param nowMillis wall-clock seam for the relative-time tiers; injectable for deterministic tests.
 * @param formatTimestamp absolute row-time formatter (locale-aware at the Compose boundary).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BackupMonitorStateHolder(
    private val source: BackupRunsSource,
    private val scope: CoroutineScope,
    private val nowMillis: () -> Long = { System.currentTimeMillis() },
    private val formatTimestamp: (Long) -> String = ::formatTimestampDefault,
) {
    private val restart = MutableStateFlow(0)

    /** The single hot, render-ready widget state, shared while the UI observes it. */
    val state: StateFlow<BackupMonitorUiState> =
        restart
            .flatMapLatest { source.stream() }
            .map(::buildState)
            .stateIn(
                scope = scope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = BackupMonitorUiState.LOADING,
            )

    /** Re-attempt the load after a failure (or refresh on demand) — re-subscribes the live feed. */
    fun retry() {
        restart.update { it + 1 }
    }

    private fun buildState(resource: Resource<BackupMonitorSnapshot>): BackupMonitorUiState {
        val ui = resource.toUiState { !it.hasRuns }
        val snapshot = ui.data ?: BackupMonitorSnapshot.EMPTY
        val display =
            if (ui.phase == UiPhase.Loading) {
                BackupMonitorDisplay.EMPTY
            } else {
                BackupMonitorProjection.project(snapshot, nowMillis(), formatTimestamp)
            }
        return BackupMonitorUiState(
            phase = ui.phase,
            display = display,
            updatedAtMillis = ui.fetchedAt,
            refreshing = ui.refreshing,
            stale = ui.stale,
            errorKind = ui.errorKind,
            errorStatus = ui.httpStatus,
        )
    }

    private companion object {
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}

/** Map a raw-JSON cache-then-network [Resource] onto a typed [BackupMonitorSnapshot] one. */
private fun Resource<JsonElement>.toSnapshotResource(): Resource<BackupMonitorSnapshot> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.let(BackupMonitorSnapshot::fromJson),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = BackupMonitorSnapshot.fromJson(data),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = cached?.let(BackupMonitorSnapshot::fromJson),
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }
