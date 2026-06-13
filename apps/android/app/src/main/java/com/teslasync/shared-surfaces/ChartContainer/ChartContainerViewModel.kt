// UI-thread-free state holder backing the ChartContainer shared surface — the native port of the annotation
// ownership the web component takes on when given an `annotations` config
// (web/src/components/charts/ChartContainer.tsx): the `useChartAnnotationsAsData` cache-then-network feed, the
// `useState(readHiddenPref)` hide toggle, the `useState` popover flag, the `useHiddenSeries` legend state, and
// the `useCreateAnnotation` / `useDeleteAnnotation` mutations. It binds the annotation feed (P1/S8) through
// [ChartContainerSource], projects it onto the shared [UiState] surface (loading / content / empty / stale /
// offline / error), and exposes the toggle / popover / add / remove / refresh actions plus the PII-safe
// `view.opened` diagnostic. The view never performs HTTP — it only collects state and calls these actions.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ChartContainer) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.chartcontainer

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.annotations.CreateAnnotationInput
import io.teslasync.shared.core.presentation.annotations.DataAnnotation
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network annotation feed + mutation seam (a shared-data-layer adapter in
 *   production over [io.teslasync.shared.core.presentation.annotations.AnnotationsStore], a fake in tests).
 *   The view-model owns no networking — it only projects this feed and forwards mutations.
 * @param config the annotation-integration config (web `annotations` prop): the vehicle/scope the feed is
 *   opened with and the chart id the hide toggle is persisted under.
 * @param hiddenStorageKey the resolved hide-toggle persistence key (web `chartId ?? title`), computed at the
 *   render boundary from the config + the chart title and threaded in so this holder stays title-free.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + action events
 *   carrying only the non-PII surface slug (never a vehicle id, annotation label, or chart payload).
 * @param prefs the hide-toggle persistence seam (web `localStorage`); defaults to in-memory.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class ChartContainerViewModel(
    private val source: ChartContainerSource,
    private val config: ChartAnnotationsConfig,
    private val hiddenStorageKey: String,
    logger: Logger,
    private val prefs: ChartHiddenPrefs = InMemoryChartHiddenPrefs(),
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableHidden = MutableStateFlow(prefs.isHidden(hiddenStorageKey))
    private val mutablePopoverOpen = MutableStateFlow(false)
    private val mutableHiddenSeries = MutableStateFlow(ChartHiddenSeries())
    private var viewOpenedRecorded = false

    /**
     * The durable chart-annotation rows as a lifecycle-aware [UiState]: loading / content / empty / stale /
     * offline / error, carrying the freshness stamp + error kind. The render boundary classifies this into an
     * [AnnotationFeed] so every state the data source can carry renders a non-blank affordance (P3).
     */
    val annotations: StateFlow<UiState<List<DataAnnotation>>> = source.annotations(config.listParams()).asUiState()

    /** Whether the annotation overlay is hidden (web `hidden` state, seeded from [ChartHiddenPrefs]). */
    val hidden: StateFlow<Boolean> = mutableHidden.asStateFlow()

    /** Whether the AddAnnotationPopover is open (web `popoverOpen` state). */
    val popoverOpen: StateFlow<Boolean> = mutablePopoverOpen.asStateFlow()

    /** The legend-toggle state threaded to the function-children (web `useHiddenSeries`). */
    val hiddenSeries: StateFlow<ChartHiddenSeries> = mutableHiddenSeries.asStateFlow()

    /** Flip the annotation overlay's visibility and persist it (web `toggleHidden` → `writeHiddenPref`). */
    fun toggleHidden() {
        val next = !mutableHidden.value
        prefs.setHidden(hiddenStorageKey, next)
        mutableHidden.value = next
    }

    /** Open the AddAnnotationPopover (web `setPopoverOpen(true)`). */
    fun openPopover() {
        mutablePopoverOpen.value = true
    }

    /** Dismiss the AddAnnotationPopover (web `setPopoverOpen(false)` / `onCancel`). */
    fun closePopover() {
        mutablePopoverOpen.value = false
    }

    /** Toggle a chart series' visibility for the function-children render-prop (web legend click). */
    fun toggleSeries(key: String) {
        mutableHiddenSeries.update { it.toggle(key) }
    }

    /**
     * Create an annotation from the popover's assembled fields, then close the popover — the web
     * `handleAddAnnotation`. The vehicle id + scope are taken from [config] (web `vehicleId` / `[scope]`). The
     * store refreshes the feed on success; a failure is logged (never crashes the chart) and the feed is left
     * intact. A blank [occurredAt] is a no-op (web `if (!occurredAt) return`).
     *
     * @param occurredAt the ISO-8601 instant of the annotated point (web `occurredAt`).
     * @param categoryWire the lowercase category token (web `category`).
     * @param title the annotation label (web `title: label`).
     * @param description the optional note (web `description`); `null`/blank when omitted.
     */
    fun addAnnotation(
        occurredAt: String,
        categoryWire: String,
        title: String,
        description: String?,
    ) {
        closePopover()
        if (occurredAt.isBlank()) return
        logger.info("chartContainer.addAnnotation")
        launch {
            source
                .createAnnotation(
                    CreateAnnotationInput(
                        occurredAt = occurredAt,
                        category = categoryWire,
                        title = title,
                        vehicleId = config.vehicleId,
                        description = description,
                        scope = listOf(config.scope),
                    ),
                ).onFailure { logger.warn("chartContainer.addAnnotation.failed") }
        }
    }

    /**
     * Remove an annotation by its stringified id — the web `handleRemoveAnnotation` (`Number(id)` guarded
     * `> 0`). A non-numeric or non-positive id is a no-op; the store refreshes the feed on success and a
     * failure is logged without crashing the chart.
     */
    fun removeAnnotation(id: String) {
        val numeric = id.toLongOrNull() ?: return
        if (numeric <= 0L) return
        logger.info("chartContainer.removeAnnotation")
        launch {
            source.deleteAnnotation(numeric).onFailure { logger.warn("chartContainer.removeAnnotation.failed") }
        }
    }

    /** Re-fetch the annotation feed — the surface's stale auto-refresh + the error/offline retry affordance. */
    fun refresh() {
        logger.info("chartContainer.refresh")
        source.refresh()
    }

    /** Retry after a failure — identical to [refresh]; backs the error/offline surfaces' retry affordance. */
    fun retry() = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id or annotation payload, so a diagnostics line can never leak fleet state. Call from
     * the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to CHART_CONTAINER_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: ChartContainerSource,
            config: ChartAnnotationsConfig,
            hiddenStorageKey: String,
            logger: Logger,
            prefs: ChartHiddenPrefs = InMemoryChartHiddenPrefs(),
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ChartContainerViewModel(source, config, hiddenStorageKey, logger, prefs) }
            }
    }
}
