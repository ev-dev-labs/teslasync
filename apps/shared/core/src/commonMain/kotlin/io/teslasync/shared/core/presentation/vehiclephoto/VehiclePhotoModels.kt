package io.teslasync.shared.core.presentation.vehiclephoto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The three rendered photo sizes the backend exposes under `GET /vehicles/{id}/photo/{size}` — the
 * cross-platform port of the web `VehiclePhotoSize` union (web/src/api/types.ts:
 * `'thumb' | 'medium' | 'full'`). [wire] is the exact path segment the URL builder
 * ([io.teslasync.shared.core.data.repo.vehiclePhotoUrl]) appends, kept verbatim so the KMP core and
 * the Windows C# port emit byte-identical URLs (ADR-004).
 */
public enum class VehiclePhotoSize(
    public val wire: String,
) {
    THUMB("thumb"),
    MEDIUM("medium"),
    FULL("full"),
}

/**
 * The optional `sizes` sub-object of the photo metadata — the cross-platform port of the web
 * `VehiclePhotoSizes` interface (web/src/api/types.ts). Each field is the rendered-image path the
 * backend reports for that size; the server omits the whole object when the vehicle has no photo, so
 * every field defaults to `null`. The values are plain path strings (not display-unit-bearing), so
 * they round-trip verbatim with no SI conversion.
 */
@Serializable
public data class VehiclePhotoSizes(
    @SerialName("thumb") val thumb: String? = null,
    @SerialName("medium") val medium: String? = null,
    @SerialName("full") val full: String? = null,
)

/**
 * The photo metadata envelope returned by `GET /vehicles/{id}/photo` — the cross-platform port of
 * the web `VehiclePhotoMeta` interface (web/src/api/types.ts). The backend always answers `200`
 * (never `404`): [hasPhoto] `false` is the "no photo" signal, so a consumer renders a simple
 * present/absent branch rather than a three-way loading/error/data tree.
 *
 * [uploadedAt] is carried as the verbatim ISO-8601 wire string (NOT a parsed instant) so the URL
 * builder ([io.teslasync.shared.core.data.repo.vehiclePhotoUrl]) can re-derive the `?v=`
 * cache-buster exactly as the web does via `Date.parse`. Keys arrive snake_case and are matched
 * verbatim via [SerialName]; every nullable field defaults so the absent-photo payload
 * (`{ "has_photo": false }`) decodes cleanly. No field is unit-bearing, so there is no SI
 * conversion at this layer.
 *
 * @property hasPhoto whether the vehicle has an uploaded photo; `false` is the absent signal.
 * @property uploadedAt the ISO-8601 upload stamp, used only as the cache-buster seed; `null` when
 *   absent.
 * @property sizes the rendered-image paths, present only when [hasPhoto] is `true`.
 */
@Serializable
public data class VehiclePhotoMeta(
    @SerialName("has_photo") val hasPhoto: Boolean = false,
    @SerialName("uploaded_at") val uploadedAt: String? = null,
    @SerialName("sizes") val sizes: VehiclePhotoSizes? = null,
)
