// The data seam the Service Health section binds to. Named after the surface bundle
// (ServiceHealthSection*) rather than the single interface it declares. The view (composable) performs NO
// HTTP — it only collects state from the ViewModel, which drives this seam, satisfying the "no direct HTTP
// from the view" contract while reproducing the web component's single
// `useQuery(getTelemetryStatus, refetchInterval: 2s)` polling feed.
//
// The web `ServiceHealthSection` reads exactly one endpoint — `getTelemetryStatus` → `GET /telemetry` — so
// this seam declares exactly one feed, [telemetryStatus], mirroring the web hook 1:1. It streams the RAW
// cache-then-network `/telemetry` [Resource] rather than the shared `TelemetryStore.mqttStatus()` typed
// model: that store normalizes `/telemetry` to the LOSSY `useMQTTStatus` shape (connected / broker / uptime
// / vehicles / topics), which DROPS the `enabled`, `mode`, and `aggregate_stats` fields this surface shows.
// Binding to it would silently narrow parity, so — like the sibling FleetApiSection owns its dev-tools seam,
// and like HealthProbesSection projects the raw `/system/health` JSON — this surface owns the raw-JSON
// abstraction (a hexagonal port) and a host supplies the adapter (over the shared resilient `ApiHttpClient`
// cache-then-network feed in production, a fake in tests). The ViewModel then projects the raw payload onto
// the full [ServiceHealthData] via [ServiceHealthProjection.build].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ServiceHealthSection) cannot form a valid Kotlin package.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.servicehealth

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [ServiceHealthSectionViewModel] depends on so it binds to an abstraction (real adapter
 * ↔ test fake), never to a concrete client — the Android analogue of the web component's
 * `useQuery(getTelemetryStatus)` (P1/S8 state-holder boundary). [telemetryStatus] streams the raw
 * cache-then-network `/telemetry` payload (web `getTelemetryStatus`); each call returns a fresh [Resource]
 * flow so the ViewModel's refresh / retry restart a real upstream collection. No HTTP touches the view.
 */
interface ServiceHealthSectionSource {
    /** Stream the raw cache-then-network `/telemetry` payload (web `getTelemetryStatus`). */
    fun telemetryStatus(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to a host-supplied raw `/telemetry` [feed]. Production wires the shared resilient
 * `ApiHttpClient` cache-then-network read (`api.request<JsonElement>("/telemetry")`), the same upstream the
 * shared `HttpTelemetryRepository` collects before its lossy `mqttStatus` normalization; tests pass a fake.
 * Each [ServiceHealthSectionSource.telemetryStatus] call invokes [feed], so the ViewModel's refresh / retry
 * trigger a real re-collection (mirroring the web hook's `refetch`).
 */
fun serviceHealthSource(feed: () -> Flow<Resource<JsonElement>>): ServiceHealthSectionSource =
    object : ServiceHealthSectionSource {
        override fun telemetryStatus(): Flow<Resource<JsonElement>> = feed()
    }
