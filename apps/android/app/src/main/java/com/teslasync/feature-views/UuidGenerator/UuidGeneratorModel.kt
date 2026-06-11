// Pure, framework-free model + projection for the UUID Generator feature view — the native analogue of
// everything the web tool derives before returning JSX
// (web/src/features/admin/components/devtools/tools/UuidGenerator.tsx) plus the `safeRandomUUID` helper it
// imports from `@/lib/safeUUID`. No Compose, no Android, no HTTP: every type here is unit-tested off-device in
// the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web tool is purely client-side — it holds a `string[]` in `useState([])` and, on each Generate press,
// prepends a fresh v4 UUID and keeps the most recent ten (`[uuid, ...prev].slice(0, 10)`). This file owns
// exactly that derivation: the RFC 4122 §4.4 v4 byte→string formatting (the web `safeRandomUUID`
// constructed-UUID branch — the one that runs in the non-secure-context LAN/HTTP deployments TeslaSync
// targets, where `crypto.randomUUID` is undefined) and the prepend-and-cap list update. The randomness itself
// is a seam (UuidGeneratorSource) so this projection stays deterministic and fully testable; the composable
// adds only the button, the rows, the copy affordances, and the lifecycle chrome the host implies.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/UuidGenerator — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ColorConverter / HashCalculator surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.uuidgenerator

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object UuidGeneratorRegistration {
    /** Stable surface id. */
    const val ID: String = "uuid-generator"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "UuidGenerator"
}

/**
 * The accumulated list of generated UUIDs the surface renders — the native analogue of the web tool's
 * `useState<string[]>([])`. Newest first (web prepends), capped at [UuidGeneratorProjection.MAX_RETAINED]
 * (web `.slice(0, 10)`). An empty [ids] is the "nothing generated yet" sentinel that maps to the surface's
 * empty state (the web `uuids.length > 0 &&` guard that hides the list until the first Generate press).
 *
 * @property ids the retained UUID strings, newest first.
 */
data class UuidBatch(
    val ids: List<String>,
) {
    /** No UUID has been generated yet (web `uuids.length === 0`) → the surface renders its empty state. */
    val isBlank: Boolean get() = ids.isEmpty()

    /** The number of retained UUIDs (web `uuids.length`). */
    val size: Int get() = ids.size

    companion object {
        /** The "nothing generated yet" sentinel for the empty preview / initial state. */
        val EMPTY = UuidBatch(emptyList())
    }
}

/**
 * Pure, side-effect-free UUID projection — the native port of the web tool's `safeRandomUUID` construction
 * and its `[uuid, ...prev].slice(0, 10)` list update. Routed through this one object so the v4 format and the
 * cap rule have a single, test-pinned definition the engine and view-model reuse.
 */
object UuidGeneratorProjection {
    /** The most recent UUIDs the tool keeps (web `.slice(0, 10)`). */
    const val MAX_RETAINED: Int = 10

    /** Bytes in a UUID (RFC 4122) — the seam fills this many random bytes before [formatV4]. */
    const val UUID_BYTE_COUNT: Int = 16

    private const val VERSION_BYTE_INDEX = 6
    private const val VARIANT_BYTE_INDEX = 8
    private const val LOW_NIBBLE_MASK = 0x0f
    private const val VERSION_4_BITS = 0x40
    private const val VARIANT_CLEAR_MASK = 0x3f
    private const val VARIANT_SET_BITS = 0x80
    private const val BYTE_MASK = 0xff
    private const val HEX_RADIX = 16
    private const val HEX_PAD = 2

    // Canonical 8-4-4-4-12 hyphen offsets in the 32-char hex string (web template-literal grouping).
    private const val GROUP_1_END = 8
    private const val GROUP_2_END = 12
    private const val GROUP_3_END = 16
    private const val GROUP_4_END = 20
    private const val GROUP_5_END = 32

    private val CANONICAL_V4 = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")

    /**
     * Formats 16 random [bytes] into a canonical lowercase v4 UUID string — a faithful port of the web
     * `safeRandomUUID` constructed-UUID branch: it sets the version field to `0100` in byte 6 and the variant
     * field to `10` in byte 8 (RFC 4122 §4.4), then renders the bytes as zero-padded lowercase hex grouped
     * 8-4-4-4-12. The input array is not mutated. Requires exactly [UUID_BYTE_COUNT] bytes.
     */
    fun formatV4(bytes: ByteArray): String {
        require(bytes.size == UUID_BYTE_COUNT) { "v4 UUID requires $UUID_BYTE_COUNT bytes, got ${bytes.size}" }
        val b = bytes.copyOf()
        b[VERSION_BYTE_INDEX] = ((b[VERSION_BYTE_INDEX].toInt() and LOW_NIBBLE_MASK) or VERSION_4_BITS).toByte()
        b[VARIANT_BYTE_INDEX] = ((b[VARIANT_BYTE_INDEX].toInt() and VARIANT_CLEAR_MASK) or VARIANT_SET_BITS).toByte()
        val hex =
            buildString(UUID_BYTE_COUNT * HEX_PAD) {
                for (byte in b) append((byte.toInt() and BYTE_MASK).toString(HEX_RADIX).padStart(HEX_PAD, '0'))
            }
        return buildString {
            append(hex, 0, GROUP_1_END)
            append('-')
            append(hex, GROUP_1_END, GROUP_2_END)
            append('-')
            append(hex, GROUP_2_END, GROUP_3_END)
            append('-')
            append(hex, GROUP_3_END, GROUP_4_END)
            append('-')
            append(hex, GROUP_4_END, GROUP_5_END)
        }
    }

    /**
     * Prepends [id] to [batch] and keeps the newest [MAX_RETAINED] — the native analogue of the web
     * `setUuids(prev => [uuid, ...prev].slice(0, 10))`.
     */
    fun prepend(
        batch: UuidBatch,
        id: String,
    ): UuidBatch = UuidBatch((listOf(id) + batch.ids).take(MAX_RETAINED))

    /** True when [value] is a canonical lowercase RFC 4122 v4 UUID — pins the format for the off-device test. */
    fun isCanonicalV4(value: String): Boolean = CANONICAL_V4.matches(value)
}
