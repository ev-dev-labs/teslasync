// The data seam the MQTTInspectorPage surface binds to, plus its production binding over the shared-core telemetry
// repository. The view (composable) performs NO HTTP — it only collects state from the view-model, which drives
// this seam, reproducing the web page's single read (web/src/features/telemetry/pages/MQTTInspectorPage.tsx):
// `useMQTTStatus()` (`GET /telemetry`, normalized + refetched every 5s).
//
// The read is the shared-core cache-then-network `Resource` stream the S7 [TelemetryRepository] already exposes
// (`mqttStatus()` ▸ `GET /telemetry` ▸ [io.teslasync.shared.core.presentation.telemetry.TelemetryDerivations]
// `normalizeMqttStatus`). The Android DI graph ([io.teslasync.android.data.DataContainer]) wires no TelemetryStore
// yet (exactly as the sibling PowersharePage documents), so the host constructs the shared
// [io.teslasync.shared.core.data.repo.HttpTelemetryRepository] over the SAME resilient client + offline cache the
// other repositories use (so the ADR-013 freshness contract + SI-verbatim caching are identical) and hands it in
// here. A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete
// repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located production-binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.telemetry.mqttinspector

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [MQTTInspectorPageViewModel] depends on so it binds to an abstraction (the shared telemetry
 * repository in production, a fake in tests), never to a concrete repository or the network. The one capability is
 * the normalized MQTT-status read — the web `useMQTTStatus` query — as a cache-then-network `Resource` flow. No HTTP
 * touches the view.
 */
interface MQTTInspectorPageSource {
    /**
     * The cache-then-network normalized MQTT-status feed (web `useMQTTStatus`, `GET /telemetry`). Emits the cached
     * value first for an instant cold start, then the refreshed value; the render boundary applies the ADR-013
     * freshness contract (loading / content / empty / error / stale / offline).
     */
    fun mqttStatus(): Flow<Resource<TelemetryStatus>>
}

/**
 * Binds the surface to the shared **S7** [TelemetryRepository] — the memoized cache-then-network MQTT-status feed
 * every telemetry surface shares. The live status flows through unchanged so the view-model renders the full state
 * matrix (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun mqttInspectorPageSourceOf(telemetryRepository: TelemetryRepository): MQTTInspectorPageSource =
    object : MQTTInspectorPageSource {
        override fun mqttStatus(): Flow<Resource<TelemetryStatus>> = telemetryRepository.mqttStatus()
    }
