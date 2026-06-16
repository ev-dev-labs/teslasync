// Page-host wiring for the MQTTInspectorPage telemetry surface (A7) — the seam that attaches real screen content to
// the `mqttInspector` ⁄ `/mqtt-inspector` navigation destination (Destinations.kt `page("mqttInspector",
// "/mqtt-inspector", NavGroup.Telemetry)`). It mirrors the sibling [io.teslasync.android.charging.powershare.
// PowersharePageHost] precedent: [register] is called once at process start by
// [io.teslasync.android.TeslaSyncApplication]; until then the route falls through to the shared not-found screen.
// [MqttInspectorRoute] reads the app DI graph from [LocalDataContainer] and constructs a page-local telemetry
// repository (over the shared resilient client + offline cache the container already exposes, since the Android DI
// graph wires no TelemetryStore yet) via [mqttInspectorPageSourceOf], and performs no HTTP itself.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located route composable.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.telemetry.mqttinspector

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.PageHosts
import io.teslasync.shared.core.data.repo.HttpTelemetryRepository

/**
 * The stateful route entry registered for the `mqttInspector` destination. Resolves the app data graph from the
 * CompositionLocal, builds the source over a page-local [HttpTelemetryRepository] (constructed from the shared
 * client + offline cache the container exposes), and binds the page to the app's redacting logger.
 */
@Composable
fun MqttInspectorRoute() {
    val container = LocalDataContainer.current
    val source =
        remember(container) {
            mqttInspectorPageSourceOf(
                telemetryRepository = HttpTelemetryRepository(container.api, container.cacheStore),
            )
        }
    MQTTInspectorPage(source = source, logger = container.logger)
}

/**
 * Registers the [MqttInspectorRoute] host for the `mqttInspector` route. Called once at process start; idempotent so
 * a repeat call (e.g. after a per-app language change re-localizes the surface) is a no-op.
 */
object MQTTInspectorPageHost {
    private val id: String = MqttInspectorPageRegistration.ROUTE_ID
    private var registered = false

    fun register() {
        if (registered) return
        registered = true
        PageHosts.register(id) { MqttInspectorRoute() }
    }
}
