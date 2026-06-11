// Pure, framework-free models + projections for the Fleet API devtools feature view — the native
// analogue of everything the web component derives (the per-tool query/mutation result shaping, the
// onboarding wizard progress + auto-detection, the partner-key verification badges, the pairing-URL
// derivation, and the defensive fleet-telemetry error extraction) before returning JSX
// (web/src/features/admin/components/devtools/FleetApiSection.tsx + ./helpers.ts + ./constants.ts).
// No Compose, no Android, no HTTP: every type here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/FleetApiSection — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — the same approach as the sibling dashboard-widgets.
// `MatchingDeclarationName` is suppressed for the co-located supporting types and `TooManyFunctions`
// for the projection objects.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.featureviews.fleetapi

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/** The em-dash shown wherever a value is unknown (matches the shared formatter fallback + web `'—'`). */
internal const val FLEET_API_EM_DASH: String = "\u2014"

/** Default hostname used in the pairing URL before fleet-api-info resolves (web `'yourapp.example.com'`). */
internal const val FLEET_API_DEFAULT_HOSTNAME: String = "yourapp.example.com"

/** The two OpenSSL keypair commands the Partner Registration tool surfaces verbatim (web constants). */
internal const val OPENSSL_GEN_COMMAND: String = "openssl ecparam -name prime256v1 -genkey -noout -out private.pem"
internal const val OPENSSL_PUB_COMMAND: String = "openssl ec -in private.pem -pubout -out public.pem"

/**
 * Canonical surface metadata — the native mirror of the web devtools section. A host binds this
 * surface with the same [SLUG] for the `view.opened` diagnostic (P1/S11).
 */
object FleetApiSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "fleet-api-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "FleetApiSection"
}

// ───────────────────────── decoded API response envelope ─────────────────────────

/**
 * One decoded dev-tools API response — the native analogue of the web `apiFetch` return
 * (`Record<string, unknown>`, possibly carrying an `error` string). [payload] is the decoded JSON
 * object; [error] is the upstream/transport error string when the call failed (web `data.error`).
 * The port never throws: a failure surfaces as [ofError] so the view-model can render the result
 * panel's error branch exactly as the web does.
 */
data class FleetApiResponse(
    val payload: JsonObject,
    val error: String?,
) {
    /** True when this response represents a failure (web `typeof data.error === 'string'`). */
    val isError: Boolean get() = error != null

    /** The pretty-printed JSON body for the result panel disclosure (web `JSON.stringify(data, null, 2)`). */
    val prettyJson: String get() = FleetApiJson.pretty(payload)

    /** Read a top-level string field (web `data.x as string`), or `null` when absent/non-string. */
    fun string(key: String): String? = FleetApiJson.stringField(payload, key)

    /** Read a top-level boolean field as `=== true` (web `data.x === true`). */
    fun boolean(key: String): Boolean = FleetApiJson.booleanField(payload, key)

    /** Read a top-level string array (web `data.x as string[]`), or empty when absent. */
    fun stringList(key: String): List<String> = FleetApiJson.stringListField(payload, key)

    /** Read a nested object field, or an empty object when absent (web `data.x ?? {}`). */
    fun obj(key: String): JsonObject = FleetApiJson.objectField(payload, key)

    companion object {
        private val EMPTY_OBJECT = JsonObject(emptyMap())

        /** A resolved success carrying [payload]; [error] is taken from the payload's own `error` field. */
        fun of(payload: JsonObject): FleetApiResponse = FleetApiResponse(payload, FleetApiJson.stringField(payload, "error"))

        /** A transport/decode failure carrying only the [message] (web `apiFetch` catch → `{ error }`). */
        fun ofError(message: String): FleetApiResponse = FleetApiResponse(EMPTY_OBJECT, message)

        /** Parse a raw JSON body string into a response, or an error response when it is not an object. */
        fun parse(rawJson: String): FleetApiResponse =
            runCatching { Json.parseToJsonElement(rawJson) }
                .getOrNull()
                ?.let { it as? JsonObject }
                ?.let { of(it) }
                ?: ofError("Invalid response")
    }
}

/** Locale-stable JSON helpers shared by the response envelope and the projections (pure, JVM-tested). */
object FleetApiJson {
    private val PRETTY =
        Json {
            prettyPrint = true
            prettyPrintIndent = "  "
        }

    /** Pretty-print [element] with two-space indent (web `JSON.stringify(value, null, 2)`). */
    fun pretty(element: JsonElement): String = PRETTY.encodeToString(JsonElement.serializer(), element)

    /** A top-level string field, tolerant of numbers (web coerces), or `null` when absent. */
    fun stringField(
        obj: JsonObject,
        key: String,
    ): String? {
        val prim = obj[key] as? JsonPrimitive ?: return null
        return when {
            prim.isString -> prim.content
            else -> prim.booleanOrNull?.toString() ?: prim.content.takeIf { it != "null" }
        }
    }

    /** A top-level boolean field compared `=== true` (anything else is false). */
    fun booleanField(
        obj: JsonObject,
        key: String,
    ): Boolean = (obj[key] as? JsonPrimitive)?.booleanOrNull == true

    /** A top-level array of strings (non-string entries dropped), or empty when absent. */
    fun stringListField(
        obj: JsonObject,
        key: String,
    ): List<String> =
        (obj[key] as? JsonArray)
            ?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
            ?: emptyList()

    /** A nested object field, or an empty object when absent (web `?? {}`). */
    fun objectField(
        obj: JsonObject,
        key: String,
    ): JsonObject = (obj[key] as? JsonObject) ?: JsonObject(emptyMap())
}

// ───────────────────────── typed query projections ─────────────────────────

/**
 * The Fleet API configuration view (web `FleetApiConfigTool`): the four read-only fields the tool
 * renders. [authenticated] drives the success/danger auth badge; absent fields fall back to the
 * em-dash at the render boundary.
 */
data class FleetApiInfo(
    val baseUrl: String,
    val clientId: String,
    val authenticated: Boolean,
    val regions: List<String>,
    val hostname: String,
) {
    companion object {
        /** Project a `fleet-api-info` response (web destructuring with `?? ''` / `?? []` fallbacks). */
        fun from(response: FleetApiResponse): FleetApiInfo =
            FleetApiInfo(
                baseUrl = response.string("baseUrl").orEmpty(),
                clientId = response.string("clientId").orEmpty(),
                authenticated = response.boolean("authenticated"),
                regions = response.stringList("regions"),
                hostname = response.string("hostname")?.takeIf { it.isNotBlank() } ?: FLEET_API_DEFAULT_HOSTNAME,
            )
    }
}

/** The pairing URL the Vehicle Key Pairing tool renders (web ``https://tesla.com/_ak/${hostname}``). */
fun pairingUrlFor(hostname: String): String = "https://tesla.com/_ak/${hostname.ifBlank { FLEET_API_DEFAULT_HOSTNAME }}"

/**
 * The public-key configuration status (web `PublicKeySetupTool`): whether a keypair is configured,
 * its [fingerprint], and the [wellKnownUrl] where the public key is published.
 */
data class PublicKeyStatus(
    val configured: Boolean,
    val fingerprint: String,
    val wellKnownUrl: String,
) {
    companion object {
        /** Project a `public-key-status` response (web `status?.configured === true` etc.). */
        fun from(response: FleetApiResponse): PublicKeyStatus =
            PublicKeyStatus(
                configured = response.boolean("configured"),
                fingerprint = response.string("fingerprint").orEmpty(),
                wellKnownUrl = response.string("wellKnownUrl").orEmpty(),
            )
    }
}

/** The three verification badges + PEM the Partner Public Key tool renders (web `verification` object). */
data class PartnerKeyVerification(
    val remoteFound: Boolean,
    val matchesLocal: Boolean,
    val localConfigured: Boolean,
    val publicKey: String,
) {
    companion object {
        /** Project a `partner-public-key` response's nested `verification` + `response.public_key`. */
        fun from(response: FleetApiResponse): PartnerKeyVerification {
            val verification = response.obj("verification")
            val inner = response.obj("response")
            return PartnerKeyVerification(
                remoteFound = FleetApiJson.booleanField(verification, "remote_key_found"),
                matchesLocal = FleetApiJson.booleanField(verification, "matches_local"),
                localConfigured = FleetApiJson.booleanField(verification, "local_key_configured"),
                publicKey = FleetApiJson.stringField(inner, "public_key").orEmpty(),
            )
        }
    }
}

/** A selectable vehicle for the dropdowns (web `useVehicleOptions` → `{ value: vin, label }`). */
data class VehicleOption(
    val vin: String,
    val label: String,
)

// ───────────────────────── result panel projection ─────────────────────────

/**
 * The mutually-exclusive surface a result panel renders (web `ResultPanel`): an [Idle] hint before
 * any run, the pretty-printed [Data] body on success, or the [Failure] message on error.
 */
sealed interface ResultPanelState {
    data object Idle : ResultPanelState

    data class Data(
        val prettyJson: String,
    ) : ResultPanelState

    data class Failure(
        val message: String,
    ) : ResultPanelState

    companion object {
        /**
         * Project a tool's action state into a panel surface — the native port of the web
         * `data={x.error ? undefined : x}` / `error={typeof x.error === 'string' ? x.error : undefined}`
         * / `idle={!x}` logic. [hasRun] is the web `!!mutation.data`.
         */
        fun from(
            response: FleetApiResponse?,
            hasRun: Boolean,
        ): ResultPanelState =
            when {
                response == null || !hasRun -> Idle
                response.isError -> Failure(response.error.orEmpty())
                else -> Data(response.prettyJson)
            }
    }
}

// ───────────────────────── fleet-telemetry error extraction ─────────────────────────

/** One render-ready fleet-telemetry error row (web `TelemetryError`): timestamp / code / message. */
data class TelemetryErrorRow(
    val key: String,
    val timestamp: String,
    val code: String,
    val message: String,
)

/**
 * The outcome of the defensive extraction (web `extractTelemetryErrors`): the normalized [rows] and
 * whether the response was a successful array ([ok]) so the caller can distinguish "vehicle healthy"
 * (ok=true, empty) from "no request made / failed" (ok=false).
 */
data class TelemetryErrorsExtraction(
    val rows: List<TelemetryErrorRow>,
    val ok: Boolean,
) {
    companion object {
        val EMPTY: TelemetryErrorsExtraction = TelemetryErrorsExtraction(emptyList(), false)
    }
}

/**
 * Normalizes Tesla's per-vehicle fleet-telemetry errors response into UI-friendly rows — a 1:1 port of
 * the web `extractTelemetryErrors`. Handles every observed wire variant (envelope-wrapped,
 * envelope-less, array-only, snake/camel field names) without throwing on partial data, since the
 * alternative is the silent-empty-table bug. Returns `ok = true` with zero rows for a successful
 * response that simply has no errors.
 */
object TelemetryErrorsExtractor {
    private val TIMESTAMP_KEYS = listOf("reported_at", "timestamp", "created_at", "ts")
    private val CODE_KEYS = listOf("error_code", "code", "name", "topic")
    private val MESSAGE_KEYS = listOf("error_message", "message", "body", "description")

    /** Extract rows from a decoded [response] (web `extractTelemetryErrors(data)`). */
    @Suppress("ReturnCount")
    fun extract(response: FleetApiResponse?): TelemetryErrorsExtraction {
        val root = response?.payload ?: return TelemetryErrorsExtraction.EMPTY
        val candidates =
            listOf(
                root["errors"],
                (root["response"] as? JsonObject)?.get("errors"),
                root["response"],
                root,
            )
        val raw = candidates.firstNotNullOfOrNull { it as? JsonArray } ?: return TelemetryErrorsExtraction.EMPTY
        val rows =
            raw.mapIndexed { index, element ->
                val row = element as? JsonObject ?: JsonObject(emptyMap())
                val timestamp = pickString(row, TIMESTAMP_KEYS)
                val code = pickString(row, CODE_KEYS)
                val vin = pickString(row, listOf("vin"))
                TelemetryErrorRow(
                    key = "$timestamp|$code|$vin|$index",
                    timestamp = timestamp,
                    code = code,
                    message = pickString(row, MESSAGE_KEYS),
                )
            }
        return TelemetryErrorsExtraction(rows, ok = true)
    }

    /** The first non-empty string (or stringified number) among [keys] (web `pickString`). */
    fun pickString(
        row: JsonObject,
        keys: List<String>,
    ): String =
        keys.firstNotNullOfOrNull { key ->
            val prim = row[key] as? JsonPrimitive
            when {
                prim == null -> null
                prim.isString && prim.content.isNotEmpty() -> prim.content
                !prim.isString && prim.content != "null" -> prim.content
                else -> null
            }
        } ?: ""
}

/**
 * The four-state surface the telemetry-errors panel renders (web `TelemetryErrorsPanel`): before any
 * fetch ([Idle]), while fetching ([Loading]), on a hard upstream error ([Failure]), a successful but
 * empty result ([Empty]), or the populated [Rows] table. Mirrors the web component's explicit
 * loading / error / requested-empty / ok branches that previously all collapsed to "button did nothing".
 */
sealed interface TelemetryErrorsPanelState {
    data object Idle : TelemetryErrorsPanelState

    data object Loading : TelemetryErrorsPanelState

    data class Failure(
        val message: String,
    ) : TelemetryErrorsPanelState

    data class Empty(
        val ok: Boolean,
        val rawJson: String?,
    ) : TelemetryErrorsPanelState

    data class Rows(
        val rows: List<TelemetryErrorRow>,
    ) : TelemetryErrorsPanelState

    companion object {
        /**
         * Project the errors action into the panel surface (web: loading → spinner, apiError → error,
         * !requested → idle, rows → table, else empty with a `0`/`?` badge — the `?` + raw-response
         * disclosure surfacing when extraction did not recognize the wire shape).
         */
        @Suppress("ReturnCount")
        fun from(
            loading: Boolean,
            response: FleetApiResponse?,
            hasRun: Boolean,
        ): TelemetryErrorsPanelState {
            if (loading) return Loading
            val apiError = response?.error
            if (apiError != null) return Failure(apiError)
            if (!hasRun || response == null) return Idle
            val extraction = TelemetryErrorsExtractor.extract(response)
            return when {
                extraction.rows.isNotEmpty() -> Rows(extraction.rows)
                else -> Empty(ok = extraction.ok, rawJson = if (extraction.ok) null else response.prettyJson)
            }
        }
    }
}

// ───────────────────────── onboarding wizard projection ─────────────────────────

/**
 * The seven Fleet API onboarding steps in order (web `ONBOARDING_STEPS`). The label/description copy is
 * resolved at the Compose boundary from the P1/S10 catalog (per-step keys), so this stays pure; the
 * stable [slug] keys the persisted completion map (web `localStorage 'devtools-onboarding'`) and the
 * auto-detection.
 */
enum class OnboardingStepId(
    val slug: String,
) {
    Account("account"),
    Application("application"),
    Keypair("keypair"),
    Register("register"),
    Auth("auth"),
    Pair("pair"),
    Telemetry("telemetry"),
    ;

    companion object {
        /** Steps in canonical render order (web array order). */
        val ordered: List<OnboardingStepId> = entries.toList()
    }
}

/**
 * The persisted + live inputs the wizard projects from (web `completed` map + the auto-detected
 * `keyStatus.configured` / `fleetInfo.authenticated`). [currentIndex] is the focused step.
 */
data class WizardInputs(
    val completed: Map<OnboardingStepId, Boolean>,
    val currentIndex: Int,
)

/** A fully projected wizard view — render-ready progress + current step (web derivations). */
data class WizardDisplay(
    val steps: List<OnboardingStepId>,
    val completed: Map<OnboardingStepId, Boolean>,
    val currentIndex: Int,
    val currentStep: OnboardingStepId,
    val completedCount: Int,
    val totalCount: Int,
    val progressPercent: Int,
    val isCurrentComplete: Boolean,
    val canGoPrevious: Boolean,
    val canGoNext: Boolean,
)

/**
 * Pure projection of the onboarding wizard — the native port of the web `completedCount` /
 * `progressPct` / `step` derivations and the `markComplete` / step-navigation guards. Also folds the
 * auto-detection effect (web: `keyStatus.configured` ⇒ keypair done; `fleetInfo.authenticated` ⇒ auth
 * done) so a host can keep persistence + live state in one place.
 */
object WizardProjection {
    private const val PERCENT = 100

    /** Project [inputs] into a render-ready [WizardDisplay] (current step clamped into range). */
    fun project(inputs: WizardInputs): WizardDisplay {
        val steps = OnboardingStepId.ordered
        val index = inputs.currentIndex.coerceIn(0, steps.lastIndex)
        val current = steps[index]
        val completedCount = steps.count { inputs.completed[it] == true }
        return WizardDisplay(
            steps = steps,
            completed = inputs.completed,
            currentIndex = index,
            currentStep = current,
            completedCount = completedCount,
            totalCount = steps.size,
            progressPercent = (completedCount * PERCENT) / steps.size,
            isCurrentComplete = inputs.completed[current] == true,
            canGoPrevious = index > 0,
            canGoNext = index < steps.lastIndex,
        )
    }

    /**
     * Fold the auto-detected completion flags into [completed] (web effect): keypair is complete when a
     * public key is [configured]; auth is complete when fleet-api is [authenticated]. Returns the
     * merged map (existing manual completions preserved).
     */
    fun autoDetect(
        completed: Map<OnboardingStepId, Boolean>,
        configured: Boolean,
        authenticated: Boolean,
    ): Map<OnboardingStepId, Boolean> {
        val merged = completed.toMutableMap()
        if (configured) merged[OnboardingStepId.Keypair] = true
        if (authenticated) merged[OnboardingStepId.Auth] = true
        return merged
    }

    /**
     * The next focused index after marking the current step complete (web `markComplete`: advance
     * unless on the last step). Returns the post-mark map paired with the next index.
     */
    fun markComplete(
        completed: Map<OnboardingStepId, Boolean>,
        currentIndex: Int,
    ): Pair<Map<OnboardingStepId, Boolean>, Int> {
        val steps = OnboardingStepId.ordered
        val index = currentIndex.coerceIn(0, steps.lastIndex)
        val merged = completed.toMutableMap().apply { this[steps[index]] = true }
        val next = if (index < steps.lastIndex) index + 1 else index
        return merged to next
    }
}

// ───────────────────────── telemetry signal catalog ─────────────────────────

/** One category of selectable telemetry signal fields (web `TELEMETRY_FIELDS` entry). */
data class TelemetrySignalCategory(
    val category: String,
    val fields: List<String>,
)

/**
 * The telemetry signal field catalog the subscribe tool's signal picker offers — a verbatim port of
 * the web `TELEMETRY_FIELDS` constant so the native picker offers the identical field set.
 */
object TelemetrySignalCatalog {
    /** The default per-field sampling interval seconds (web `interval` default). */
    const val DEFAULT_INTERVAL_SECONDS: Int = 30

    val categories: List<TelemetrySignalCategory> =
        listOf(
            TelemetrySignalCategory(
                "Location",
                listOf(
                    "Location",
                    "GpsHeading",
                    "GpsState",
                    "DestinationLocation",
                    "DestinationName",
                    "MilesToArrival",
                    "MinutesToArrival",
                    "RouteLine",
                    "RouteLastUpdated",
                    "OriginLocation",
                    "LocatedAtHome",
                    "LocatedAtWork",
                    "LocatedAtFavorite",
                ),
            ),
            TelemetrySignalCategory(
                "Driving",
                listOf(
                    "VehicleSpeed",
                    "Gear",
                    "CruiseSetSpeed",
                    "BrakePedal",
                    "BrakePedalPos",
                    "PedalPosition",
                    "DriveRail",
                    "LateralAcceleration",
                    "LongitudinalAcceleration",
                    "RouteTrafficMinutesDelay",
                    "LifetimeEnergyGainedRegen",
                    "LifetimeEnergyUsedDrive",
                ),
            ),
            TelemetrySignalCategory(
                "Charging",
                listOf(
                    "BatteryLevel",
                    "Soc",
                    "ChargeState",
                    "DetailedChargeState",
                    "ChargeLimitSoc",
                    "ChargeAmps",
                    "ChargeCurrentRequest",
                    "ChargeCurrentRequestMax",
                    "ChargeEnableRequest",
                    "ChargerVoltage",
                    "ChargerPhases",
                    "ChargeRateMilePerHour",
                    "DCChargingPower",
                    "DCChargingEnergyIn",
                    "ACChargingPower",
                    "ACChargingEnergyIn",
                    "EnergyRemaining",
                    "EstBatteryRange",
                    "IdealBatteryRange",
                    "RatedRange",
                    "PackVoltage",
                    "PackCurrent",
                    "ChargePortDoorOpen",
                    "ChargePortLatch",
                    "ChargePortColdWeatherMode",
                    "ChargingCableType",
                    "FastChargerPresent",
                    "FastChargerType",
                    "TimeToFullCharge",
                    "EstimatedHoursToChargeTermination",
                    "ExpectedEnergyPercentAtTripArrival",
                    "SuperchargerSessionTripPlanner",
                    "ScheduledChargingMode",
                    "ScheduledChargingPending",
                    "ScheduledChargingStartTime",
                    "ScheduledDepartureTime",
                    "PreconditioningEnabled",
                    "BrickVoltageMax",
                    "BrickVoltageMin",
                    "NumBrickVoltageMax",
                    "NumBrickVoltageMin",
                    "ModuleTempMax",
                    "ModuleTempMin",
                    "NumModuleTempMax",
                    "NumModuleTempMin",
                    "BatteryHeaterOn",
                    "NotEnoughPowerToHeat",
                    "BMSState",
                    "BmsFullchargecomplete",
                    "DCDCEnable",
                    "IsolationResistance",
                    "LifetimeEnergyUsed",
                ),
            ),
            TelemetrySignalCategory(
                "Powershare",
                listOf(
                    "PowershareStatus",
                    "PowershareType",
                    "PowershareStopReason",
                    "PowershareHoursLeft",
                    "PowershareInstantaneousPowerKW",
                ),
            ),
            TelemetrySignalCategory(
                "Climate",
                listOf(
                    "InsideTemp",
                    "OutsideTemp",
                    "HvacFanSpeed",
                    "HvacFanStatus",
                    "HvacPower",
                    "HvacACEnabled",
                    "HvacAutoMode",
                    "HvacLeftTemperatureRequest",
                    "HvacRightTemperatureRequest",
                    "HvacSteeringWheelHeatAuto",
                    "HvacSteeringWheelHeatLevel",
                    "ClimateKeeperMode",
                    "DefrostMode",
                    "DefrostForPreconditioning",
                    "CabinOverheatProtectionMode",
                    "CabinOverheatProtectionTemperatureLimit",
                    "SeatHeaterLeft",
                    "SeatHeaterRight",
                    "SeatHeaterRearLeft",
                    "SeatHeaterRearCenter",
                    "SeatHeaterRearRight",
                    "SeatVentEnabled",
                    "ClimateSeatCoolingFrontLeft",
                    "ClimateSeatCoolingFrontRight",
                    "AutoSeatClimateLeft",
                    "AutoSeatClimateRight",
                    "RearDefrostEnabled",
                    "RearDisplayHvacEnabled",
                    "WiperHeatEnabled",
                ),
            ),
            TelemetrySignalCategory(
                "Vehicle State",
                listOf(
                    "Locked",
                    "SentryMode",
                    "DoorState",
                    "FdWindow",
                    "FpWindow",
                    "RdWindow",
                    "RpWindow",
                    "Odometer",
                    "HomelinkNearby",
                    "HomelinkDeviceCount",
                    "GuestModeEnabled",
                    "GuestModeMobileAccessState",
                    "DriverSeatOccupied",
                    "CenterDisplay",
                    "CurrentLimitMph",
                    "SpeedLimitMode",
                    "ValetModeEnabled",
                    "ServiceMode",
                    "PairedPhoneKeyAndKeyFobQty",
                    "LightsHazardsActive",
                    "LightsHighBeams",
                    "LightsTurnSignal",
                    "TonneauPosition",
                    "TonneauOpenPercent",
                    "TonneauTentMode",
                ),
            ),
            TelemetrySignalCategory(
                "Safety",
                listOf(
                    "DriverSeatBelt",
                    "PassengerSeatBelt",
                    "AutomaticEmergencyBrakingOff",
                    "AutomaticBlindSpotCamera",
                    "BlindSpotCollisionWarningChime",
                    "CruiseFollowDistance",
                    "EmergencyLaneDepartureAvoidance",
                    "ForwardCollisionWarning",
                    "LaneDepartureAvoidance",
                    "SpeedLimitWarning",
                    "PinToDriveEnabled",
                    "MilesSinceReset",
                    "SelfDrivingMilesSinceReset",
                ),
            ),
            TelemetrySignalCategory(
                "Powertrain",
                listOf(
                    "DiTorquemotor",
                    "DiTorqueActualR",
                    "DiTorqueActualF",
                    "DiTorqueActualREL",
                    "DiTorqueActualRER",
                    "DiSlaveTorqueCmd",
                    "DiAxleSpeedF",
                    "DiAxleSpeedR",
                    "DiAxleSpeedREL",
                    "DiAxleSpeedRER",
                    "DiStateR",
                    "DiStateF",
                    "DiStateREL",
                    "DiStateRER",
                    "DiStatorTempR",
                    "DiStatorTempF",
                    "DiStatorTempREL",
                    "DiStatorTempRER",
                    "DiHeatsinkTR",
                    "DiHeatsinkTF",
                    "DiHeatsinkTREL",
                    "DiHeatsinkTRER",
                    "DiInverterTR",
                    "DiInverterTF",
                    "DiInverterTREL",
                    "DiInverterTRER",
                    "DiMotorCurrentR",
                    "DiMotorCurrentF",
                    "DiMotorCurrentREL",
                    "DiMotorCurrentRER",
                    "DiVBatR",
                    "DiVBatF",
                    "DiVBatREL",
                    "DiVBatRER",
                    "Hvil",
                ),
            ),
            TelemetrySignalCategory(
                "Tires & Service",
                listOf(
                    "TpmsPressureFl",
                    "TpmsPressureFr",
                    "TpmsPressureRl",
                    "TpmsPressureRr",
                    "TpmsHardWarnings",
                    "TpmsSoftWarnings",
                    "TpmsLastSeenPressureTimeFl",
                    "TpmsLastSeenPressureTimeFr",
                    "TpmsLastSeenPressureTimeRl",
                    "TpmsLastSeenPressureTimeRr",
                ),
            ),
            TelemetrySignalCategory(
                "Media",
                listOf(
                    "MediaNowPlayingTitle",
                    "MediaNowPlayingArtist",
                    "MediaNowPlayingAlbum",
                    "MediaNowPlayingStation",
                    "MediaNowPlayingDuration",
                    "MediaNowPlayingElapsed",
                    "MediaPlaybackStatus",
                    "MediaPlaybackSource",
                    "MediaAudioVolume",
                    "MediaAudioVolumeIncrement",
                    "MediaAudioVolumeMax",
                ),
            ),
            TelemetrySignalCategory(
                "User Preference",
                listOf(
                    "Setting24HourTime",
                    "SettingChargeUnit",
                    "SettingDistanceUnit",
                    "SettingTemperatureUnit",
                    "SettingTirePressureUnit",
                ),
            ),
            TelemetrySignalCategory(
                "Vehicle Config",
                listOf(
                    "CarType",
                    "Trim",
                    "ExteriorColor",
                    "RoofColor",
                    "WheelType",
                    "VehicleName",
                    "Version",
                    "RearSeatHeaters",
                    "SunroofInstalled",
                    "EfficiencyPackage",
                    "EuropeVehicle",
                    "RightHandDrive",
                    "RemoteStartEnabled",
                    "ChargePort",
                    "OffroadLightbarPresent",
                    "SoftwareUpdateVersion",
                    "SoftwareUpdateDownloadPercentComplete",
                    "SoftwareUpdateInstallationPercentComplete",
                    "SoftwareUpdateExpectedDurationMinutes",
                    "SoftwareUpdateScheduledStartTime",
                ),
            ),
        )

    /** Every field name across all categories, flattened in catalog order. */
    val allFields: List<String> get() = categories.flatMap { it.fields }
}
