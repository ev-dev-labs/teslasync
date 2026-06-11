// The data ports the Fleet API devtools surface binds to (P1/S8 state-holder seam) — the native
// analogue of the web hook composition: `useQuery`/`useMutation` over `apiFetch('/dev-tools/{endpoint}')`
// and `useVehicleOptions` over `/vehicles` (web/src/features/admin/components/devtools/helpers.ts).
// The view never performs HTTP itself; a shared-data-layer adapter (production) or a test fake drives
// these. There is intentionally no shared dev-tools repository in the KMP core, so this surface owns
// the abstraction (hexagonal port) and a host supplies the adapter — keeping "no direct HTTP from the
// view" intact end to end.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/FleetApiSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fleetapi

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The four read-only / four mutating Fleet API dev-tools operations the surface invokes — the native
 * seam over the web `apiFetch('/dev-tools/{endpoint}', method, body)` calls. Every method is
 * non-throwing (mirroring `apiFetch`'s catch → `{ error }`): a transport/HTTP failure is returned as a
 * [FleetApiResponse] whose `error` is set, so the result panels render the failure branch rather than
 * crashing the view. A single focused interface so the view-model depends on an abstraction
 * (real adapter ↔ test fake), never on the network.
 */
interface FleetApiDevToolsPort {
    /** GET `fleet-api-info` — base URL, client id, auth status, regions, hostname (web Config tool). */
    suspend fun fleetApiInfo(): FleetApiResponse

    /** GET `public-key-status` — configured flag, fingerprint, well-known URL (web Public Key tool). */
    suspend fun publicKeyStatus(): FleetApiResponse

    /** POST `register-partner` with the partner [domain] (web Partner Registration tool). */
    suspend fun registerPartner(domain: String): FleetApiResponse

    /** GET `partner-public-key?domain=` — remote key verification + PEM (web Partner Public Key tool). */
    suspend fun partnerPublicKey(domain: String): FleetApiResponse

    /** POST `generate-keypair` — generate a new EC keypair (web Public Key tool). */
    suspend fun generateKeypair(): FleetApiResponse

    /** POST `upload-public-key` with a [pem] body (web Public Key tool). */
    suspend fun uploadPublicKey(pem: String): FleetApiResponse

    /** DELETE `public-key` — remove the configured keypair (web Public Key tool). */
    suspend fun deletePublicKey(): FleetApiResponse

    /** POST `fleet-telemetry-subscribe` with the [request] (web Telemetry Subscribe tool). */
    suspend fun subscribeTelemetry(request: TelemetrySubscribeRequest): FleetApiResponse

    /** GET `fleet-telemetry-config?vin=` (web Telemetry Config tool). */
    suspend fun telemetryConfig(vin: String): FleetApiResponse

    /** GET `fleet-telemetry-errors?vin=` (web Telemetry Config tool errors panel). */
    suspend fun telemetryErrors(vin: String): FleetApiResponse

    /** DELETE `fleet-telemetry-config?vin=` (web Telemetry Config tool). */
    suspend fun deleteTelemetryConfig(vin: String): FleetApiResponse

    /** POST `fleet-status` with the fleet [vins] (web Fleet Status tool). */
    suspend fun fleetStatus(vins: List<String>): FleetApiResponse

    /** GET one of the per-vehicle data endpoints for [vin] (web Vehicle Data tools). */
    suspend fun vehicleData(
        kind: VehicleDataKind,
        vin: String,
    ): FleetApiResponse
}

/** The four per-vehicle data endpoints the Vehicle Data tool fetches (web mutation `mutationFn`s). */
enum class VehicleDataKind(
    val endpoint: String,
) {
    NearbyCharging("nearby-charging"),
    ReleaseNotes("release-notes"),
    RecentAlerts("recent-alerts"),
    ServiceData("service-data"),
}

/**
 * The Fleet Telemetry subscription request body (web `fleet-telemetry-subscribe` POST payload). Mirrors
 * the web shape: a single-element `vins` array, connection params, the selected signal `fields`, the
 * base `interval_seconds`, and per-field `field_intervals` for signals overriding the base interval.
 */
data class TelemetrySubscribeRequest(
    val vin: String,
    val hostname: String,
    val port: Int,
    val caCert: String?,
    val fields: List<String>,
    val intervalSeconds: Int,
    val fieldIntervals: Map<String, Int>,
)

/**
 * The vehicle-options port (web `useVehicleOptions` over `/vehicles`). Unlike the dev-tools port this
 * one is a genuine query that can fail, so it returns a [Result] the view-model maps onto a loading /
 * content / error surface. Implemented by a shared-vehicles-store adapter in production, a fake in tests.
 */
fun interface VehicleOptionsPort {
    /** Fetch the selectable vehicle options (web `vehicles.map(v => ({ value: v.vin, label }))`). */
    suspend fun vehicleOptions(): Result<List<VehicleOption>>
}

/**
 * The persisted onboarding-completion store (web `localStorage 'devtools-onboarding'`). Keyed by the
 * stable [OnboardingStepId.slug]; a host wires a DataStore-backed implementation, tests + previews use
 * [InMemoryFleetApiOnboardingStore]. Kept off the view so persistence is testable and swappable.
 */
interface FleetApiOnboardingStore {
    /** The live completion map (slug → done); emits the persisted value then any subsequent writes. */
    val completed: StateFlow<Map<OnboardingStepId, Boolean>>

    /** Persist the merged completion [map] (web `setCompleted` + the `localStorage` effect). */
    suspend fun save(map: Map<OnboardingStepId, Boolean>)
}

/**
 * An in-memory [FleetApiOnboardingStore] — the default for previews/tests and a safe production
 * fallback when no persistent store is wired. Holds the completion map for the process lifetime.
 */
class InMemoryFleetApiOnboardingStore(
    initial: Map<OnboardingStepId, Boolean> = emptyMap(),
) : FleetApiOnboardingStore {
    private val state = MutableStateFlow(initial)

    override val completed: StateFlow<Map<OnboardingStepId, Boolean>> = state.asStateFlow()

    override suspend fun save(map: Map<OnboardingStepId, Boolean>) {
        state.value = map
    }
}
