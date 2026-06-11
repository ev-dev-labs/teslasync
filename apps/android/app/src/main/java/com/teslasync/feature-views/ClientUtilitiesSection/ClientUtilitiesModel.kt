// Registry + pure projection backing the Compose [ClientUtilitiesSection] — the native port of the web
// component's `useToolList()` hook and search filter
// (web/src/features/admin/components/devtools/ClientUtilitiesSection.tsx). The tool registry is a fixed,
// client-side catalog (the web `useToolList` is a `useMemo` over a static array — no network), so it is
// modelled as a shared-layer feed that resolves immediately to content; the projection reproduces the web
// `filtered` memo (case-insensitive match on the resolved name OR description).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ClientUtilitiesSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.feature.views.clientutilities

import androidx.annotation.StringRes
import androidx.compose.ui.graphics.vector.ImageVector
import io.teslasync.android.R

/**
 * The semantic accent each tool icon chip carries — the web neon hue map
 * (`ICON_COLOR_MAP`: cyan / green / purple / amber / red). Resolved to a concrete per-theme [androidx
 * .compose.ui.graphics.Color] at the render boundary so light / dark / high-contrast all stay correct.
 */
enum class ClientUtilityAccent { Cyan, Green, Purple, Amber, Red }

/**
 * Stable identity of each client-side utility — the web `tool.id` verbatim, so a host can wire the
 * matching tool surface (the separate `*Tool` prompts) into the expandable card body without string
 * drift. [slug] is the exact web id.
 */
enum class ClientUtilityToolId(
    val slug: String,
) {
    Vin("vin"),
    Jwt("jwt"),
    Timestamp("timestamp"),
    Base64("base64"),
    Url("url"),
    Json("json"),
    Uuid("uuid"),
    Hash("hash"),
    Bytes("bytes"),
    Color("color"),
    Cron("cron"),
    Http("http"),
    TeslaApi("tesla-api"),
    Regex("regex"),
    UnixPerm("unix-perm"),
}

/**
 * One entry in the client-utilities registry — the native analogue of a web `ToolEntry`
 * (`{ id, name, desc, icon, color, Component }`). [nameKey]/[descKey] are the exact web i18n keys passed
 * to `t(...)`; [nameRes]/[descRes] are the matching shared-catalog (P1/S10) resource ids when one exists,
 * else `null` to reproduce i18next's key-as-fallback at the render boundary (the web keys for most tools
 * are not present in any locale file, so the web renders the key text itself). The interactive body is a
 * separate surface (the per-tool `*Tool` prompts), hosted via the section's content slot — not this entry.
 */
data class ClientUtilityTool(
    val id: ClientUtilityToolId,
    val nameKey: String,
    @param:StringRes val nameRes: Int?,
    val descKey: String,
    @param:StringRes val descRes: Int?,
    val icon: ImageVector,
    val accent: ClientUtilityAccent,
)

/**
 * The snapshot the state holder carries — the resolved-immediately registry (web `useToolList()`). An
 * empty [tools] maps to the surface's empty state; the static catalog is never empty in production, but
 * the field keeps the loading / empty / error envelope honest and testable.
 */
data class ClientUtilitiesSnapshot(
    val tools: List<ClientUtilityTool>,
) {
    /** No registry entries (web `tools.length === 0`) → the data-empty surface. */
    val isEmpty: Boolean get() = tools.isEmpty()

    companion object {
        /** The empty registry sentinel for the data-empty preview / test branch. */
        val EMPTY = ClientUtilitiesSnapshot(emptyList())
    }
}

/**
 * A registry entry with its display strings already resolved at the render boundary — the shape the
 * search filter and the card both consume (the web `tool.name` / `tool.desc` after `t(...)`).
 */
data class ResolvedClientUtility(
    val id: ClientUtilityToolId,
    val name: String,
    val description: String,
    val icon: ImageVector,
    val accent: ClientUtilityAccent,
)

/**
 * The filtered tool list the grid renders — the web `filtered` array. [hasResults] is `false` when the
 * search query matched nothing (web `filtered.length === 0` → "No tools match your search").
 */
data class ClientUtilitiesDisplay(
    val tools: List<ResolvedClientUtility>,
) {
    /** At least one tool matched the active query. */
    val hasResults: Boolean get() = tools.isNotEmpty()
}

/**
 * Pure, side-effect-free search projection — the native port of the web `filtered` memo. An empty / blank
 * query returns every tool (web `if (!search.trim()) return tools`); otherwise it keeps tools whose name
 * OR description contains the lower-cased query (web `tool.name.toLowerCase().includes(q) || ...`).
 */
object ClientUtilitiesProjection {
    fun filter(
        tools: List<ResolvedClientUtility>,
        query: String,
    ): ClientUtilitiesDisplay {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return ClientUtilitiesDisplay(tools)
        return ClientUtilitiesDisplay(
            tools.filter { tool ->
                tool.name.lowercase().contains(q) || tool.description.lowercase().contains(q)
            },
        )
    }
}

/**
 * The fixed client-utilities catalog — the native, order-preserving port of the web `useToolList()` array
 * (15 tools, each with its web id, i18n keys, lucide icon and neon accent). Only Base64 (name + desc) and
 * Timestamp (name) have shared-catalog (P1/S10) entries; every other tool's keys are absent from the
 * locale files upstream, so [ClientUtilityTool.nameRes] / [descRes] are `null` and the render boundary
 * echoes the web key text exactly as i18next does. Icons come from [ClientUtilitiesGlyphs] (lucide has no
 * Android equivalent, so the glyphs are authored locally — the same approach as the sibling widgets).
 */
object ClientUtilitiesCatalog {
    val tools: List<ClientUtilityTool> =
        listOf(
            ClientUtilityTool(
                ClientUtilityToolId.Vin,
                "Vin Decoder",
                null,
                "Vin Decoder Desc",
                null,
                ClientUtilitiesGlyphs.Car,
                ClientUtilityAccent.Cyan,
            ),
            ClientUtilityTool(
                ClientUtilityToolId.Jwt,
                "Jwt Decoder",
                null,
                "Jwt Decoder Desc",
                null,
                ClientUtilitiesGlyphs.Key,
                ClientUtilityAccent.Purple,
            ),
            ClientUtilityTool(
                ClientUtilityToolId.Timestamp,
                "Timestamp",
                R.string.translation_Timestamp,
                "Timestamp Desc",
                null,
                ClientUtilitiesGlyphs.Clock,
                ClientUtilityAccent.Green,
            ),
            ClientUtilityTool(
                ClientUtilityToolId.Base64,
                "devtools.utils.base64",
                R.string.translation_devtools_utils_base64,
                "devtools.utils.base64Desc",
                R.string.translation_devtools_utils_base64Desc,
                ClientUtilitiesGlyphs.Braces,
                ClientUtilityAccent.Amber,
            ),
            ClientUtilityTool(
                ClientUtilityToolId.Url,
                "Url Encoder",
                null,
                "Url Encoder Desc",
                null,
                ClientUtilitiesGlyphs.Link,
                ClientUtilityAccent.Cyan,
            ),
            ClientUtilityTool(
                ClientUtilityToolId.Json,
                "Json Formatter",
                null,
                "Json Formatter Desc",
                null,
                ClientUtilitiesGlyphs.Braces,
                ClientUtilityAccent.Green,
            ),
            ClientUtilityTool(
                ClientUtilityToolId.Uuid,
                "Uuid Generator",
                null,
                "Uuid Generator Desc",
                null,
                ClientUtilitiesGlyphs.Fingerprint,
                ClientUtilityAccent.Purple,
            ),
            ClientUtilityTool(
                ClientUtilityToolId.Hash,
                "Hash Calculator",
                null,
                "Hash Calculator Desc",
                null,
                ClientUtilitiesGlyphs.Hash,
                ClientUtilityAccent.Red,
            ),
            ClientUtilityTool(
                ClientUtilityToolId.Bytes,
                "Byte Size",
                null,
                "Byte Size Desc",
                null,
                ClientUtilitiesGlyphs.HardDrive,
                ClientUtilityAccent.Cyan,
            ),
            ClientUtilityTool(
                ClientUtilityToolId.Color,
                "Color Converter",
                null,
                "Color Converter Desc",
                null,
                ClientUtilitiesGlyphs.Palette,
                ClientUtilityAccent.Purple,
            ),
            ClientUtilityTool(
                ClientUtilityToolId.Cron,
                "Cron Parser",
                null,
                "Cron Parser Desc",
                null,
                ClientUtilitiesGlyphs.Timer,
                ClientUtilityAccent.Green,
            ),
            ClientUtilityTool(
                ClientUtilityToolId.Http,
                "Http Status",
                null,
                "Http Status Desc",
                null,
                ClientUtilitiesGlyphs.Network,
                ClientUtilityAccent.Amber,
            ),
            ClientUtilityTool(
                ClientUtilityToolId.TeslaApi,
                "Tesla Api Ref",
                null,
                "Tesla Api Ref Desc",
                null,
                ClientUtilitiesGlyphs.BookOpen,
                ClientUtilityAccent.Cyan,
            ),
            ClientUtilityTool(
                ClientUtilityToolId.Regex,
                "Regex Tester",
                null,
                "Regex Tester Desc",
                null,
                ClientUtilitiesGlyphs.Regex,
                ClientUtilityAccent.Red,
            ),
            ClientUtilityTool(
                ClientUtilityToolId.UnixPerm,
                "Unix Perm",
                null,
                "Unix Perm Desc",
                null,
                ClientUtilitiesGlyphs.Lock,
                ClientUtilityAccent.Green,
            ),
        )

    /** The default snapshot — the full registry, always content (web `useToolList()` is never empty). */
    val snapshot: ClientUtilitiesSnapshot = ClientUtilitiesSnapshot(tools)
}
