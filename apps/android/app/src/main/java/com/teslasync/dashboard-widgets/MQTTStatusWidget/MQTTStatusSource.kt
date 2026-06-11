// The data port the MQTT Status widget binds to — the native analogue of the web `useMQTTStatus` hook
// (web/src/features/dashboard/widgets/MQTTStatusWidget.tsx + web/src/api/hooks/useTelemetry.ts). The view
// never performs HTTP; a concrete adapter over the shared Telemetry data layer (or a test fake) drives this
// seam. Cache-then-network freshness is preserved end to end (ADR-013): the view-model projects each
// emission's cached / stale / error flags onto the render surface, and the status arrives already
// normalized + SI from the shared layer (the web queryFn's `Record<vin, …>` flattening lives there).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/MQTTStatusWidget) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed: the mandated file name (MQTTStatusSource, upper-case MQTT to
// match the web surface) intentionally differs in casing from the idiomatic `MqttStatusSource` interface.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.dashboard.widgets.mqttstatus

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import kotlinx.coroutines.flow.Flow

/**
 * Streams the single cache-then-network feed the widget needs: the normalized Fleet-Telemetry MQTT
 * [TelemetryStatus] (`GET /telemetry`, web `useMQTTStatus`). A narrow seam so the view-model depends on an
 * abstraction (real adapter ↔ test fake), never on a concrete store/repository or the network. Each
 * (re)collection is a fresh cache-then-network [Resource] stream, so the view-model's refresh trigger
 * re-subscribing performs the web `refetch()`.
 */
fun interface MqttStatusSource {
    /** The cache-then-network normalized MQTT status feed (`GET /telemetry`, web `useMQTTStatus`). */
    fun stream(): Flow<Resource<TelemetryStatus>>
}

/**
 * Binds the widget to the shared **S7** [TelemetryRepository] — the cold cache-then-network `Flow` the S8
 * [TelemetryStore] also wraps. Re-collecting performs a genuine cache-then-network re-fetch, which is what
 * backs the widget's manual refresh / error-retry affordance. No HTTP touches the view.
 */
fun TelemetryRepository.asMqttStatusSource(): MqttStatusSource = MqttStatusSource { mqttStatus() }

/**
 * Binds the widget to the shared **S8** [TelemetryStore] — the memoized, multi-observer MQTT-status feed
 * every Telemetry surface shares (incl. its background refresh on the REALTIME cadence). Use this when a
 * host wants the widget to fold into the same shared collection as the rest of the app; the live values
 * flow through unchanged. No HTTP touches the view.
 */
fun TelemetryStore.asMqttStatusSource(): MqttStatusSource {
    val store = this
    return MqttStatusSource { store.mqttStatus() }
}
