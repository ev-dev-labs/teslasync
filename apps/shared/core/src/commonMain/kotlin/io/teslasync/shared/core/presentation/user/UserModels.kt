package io.teslasync.shared.core.presentation.user

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/*
 * The cross-platform port of the web User hook-domain types
 * (web/src/api/hooks/useUser.ts + web/src/types/user.ts + the `UserActivityEntry` shape in
 * web/src/types/admin.ts). Every native Account / Profile screen (Android/Apple via KMP, Windows
 * via the C# port) binds to these shapes through the S7
 * io.teslasync.shared.core.data.repo.UserRepository and the S8 UserStore.
 *
 * Keys are matched verbatim via the property name / SerialName so a cached payload round-trips
 * unchanged. The current-user document is the one camelCase contract in the API surface: the web
 * `User` interface and the `PUT /users/me` body (`{ displayName }`) are both camelCase, so the port
 * matches them verbatim — this is the faithful reproduction of the web hook, NOT a convention slip.
 * The Tesla account feeds are snake_case (their SerialNames map the wire keys). No field here is
 * telemetry-unit-bearing (account identity, order metadata, region URLs, ISO stamps), so there is
 * no SI conversion at this layer — display formatting is the render boundary's job (S5). Every
 * optional server field defaults so a partial payload still decodes (the web `ignoreUnknownKeys`).
 */

/**
 * `GET /users/me` response and `PUT /users/me` echo — the port of the web `User` interface
 * (web/src/types/user.ts). The one camelCase shape in the API: property names match the wire keys
 * verbatim (no snake_case mapping), exactly as the web type and `useUpdateUser` body declare.
 */
@Serializable
public data class User(
    val id: String = "",
    val email: String = "",
    val displayName: String = "",
    val avatarUrl: String? = null,
    val createdAt: String = "",
    val updatedAt: String = "",
)

/**
 * One row of `GET /users/me/activity` — the port of the web `UserActivityEntry` interface
 * (web/src/types/admin.ts). snake_case is canonical on the wire; nullable audit columns default to
 * `null` so a sparse row decodes.
 */
@Serializable
public data class UserActivityEntry(
    val id: Long = 0,
    val ts: String = "",
    val action: String = "",
    @SerialName("entity_type") val entityType: String? = null,
    @SerialName("entity_id") val entityId: String? = null,
    val detail: String? = null,
    val ip: String? = null,
    @SerialName("user_agent") val userAgent: String? = null,
)

/**
 * The `GET /users/me/activity` query parameters — the port of the web `MyActivityParams` interface
 * (web/src/api/hooks/useUser.ts). [start]/[end] are optional ISO `YYYY-MM-DD` date strings (the
 * backend defaults the window); [limit]/[offset] page the result. All optional, mirroring the web
 * hook's `MyActivityParams = {}` default.
 */
public data class MyActivityParams(
    val start: String? = null,
    val end: String? = null,
    val limit: Int? = null,
    val offset: Int? = null,
)

/**
 * The generic Tesla account-config envelope — the port of the web `TeslaConfigEnvelope<T>`
 * (web/src/api/hooks/useUser.ts). Wraps a typed [data] payload with the server's `fetched_at`
 * freshness stamp (null when never fetched). Used for both `GET /tesla/user/feature-config`
 * (data = raw [JsonElement], the web `Record<string, unknown>`) and `GET /tesla/user/region`
 * (data = [TeslaRegionData]).
 */
@Serializable
public data class TeslaConfigEnvelope<T>(
    val data: T,
    @SerialName("fetched_at") val fetchedAt: String? = null,
)

/**
 * `GET /tesla/user/region` `data` payload — the port of the web `TeslaRegionData` interface. The
 * Fleet-API region code and the regional base URL the platform routes account calls through.
 */
@Serializable
public data class TeslaRegionData(
    val region: String = "",
    @SerialName("fleet_api_base_url") val fleetApiBaseUrl: String = "",
)

/**
 * One row of `GET /tesla/user/orders` `orders` — the port of the web `TeslaOrder` interface
 * (web/src/api/hooks/useUser.ts). [referralCode] is optional (absent on most orders); the date /
 * vin columns are nullable until delivery is scheduled.
 */
@Serializable
public data class TeslaOrder(
    val id: Long = 0,
    @SerialName("order_id") val orderId: String = "",
    val model: String = "",
    val status: String = "",
    @SerialName("delivery_date") val deliveryDate: String? = null,
    val vin: String? = null,
    @SerialName("referral_code") val referralCode: String? = null,
    @SerialName("is_upgradable") val isUpgradable: Boolean = false,
    @SerialName("fetched_at") val fetchedAt: String = "",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
)

/**
 * `GET /tesla/user/orders` response — the port of the web `TeslaOrdersEnvelope`. The order list plus
 * the server `fetched_at` stamp (null when never fetched).
 */
@Serializable
public data class TeslaOrdersEnvelope(
    val orders: List<TeslaOrder> = emptyList(),
    @SerialName("fetched_at") val fetchedAt: String? = null,
)

/**
 * `GET /tesla/user/profile` `profile` payload — the port of the web `TeslaUserProfile` interface
 * (web/src/api/hooks/useUser.ts). The Tesla-account identity used to seed the Account header.
 */
@Serializable
public data class TeslaUserProfile(
    val id: Long = 0,
    val email: String = "",
    @SerialName("full_name") val fullName: String = "",
    @SerialName("profile_image_url") val profileImageUrl: String? = null,
    @SerialName("fetched_at") val fetchedAt: String = "",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("updated_at") val updatedAt: String = "",
)

/**
 * `GET /tesla/user/profile` response — the port of the web `TeslaProfileEnvelope`. The profile is
 * nullable (null until the account has been linked / fetched) and carries the server `fetched_at`.
 */
@Serializable
public data class TeslaProfileEnvelope(
    val profile: TeslaUserProfile? = null,
    @SerialName("fetched_at") val fetchedAt: String? = null,
)

/** Convenience alias: the `GET /tesla/user/feature-config` envelope carries a raw JSON `data` blob. */
public typealias TeslaFeatureConfigEnvelope = TeslaConfigEnvelope<JsonElement>

/** Convenience alias: the `GET /tesla/user/region` envelope carries a typed [TeslaRegionData]. */
public typealias TeslaRegionEnvelope = TeslaConfigEnvelope<TeslaRegionData>
