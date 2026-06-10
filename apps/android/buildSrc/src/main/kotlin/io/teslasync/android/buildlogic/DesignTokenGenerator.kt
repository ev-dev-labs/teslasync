package io.teslasync.android.buildlogic

import groovy.json.JsonSlurper
import java.io.File
import java.math.BigDecimal
import java.math.BigInteger
import kotlin.math.roundToInt

/**
 * Deterministic transform from the neutral `apps/design/tokens.json` token set into
 * the Android Material 3 theme Kotlin layer (P3/A1, ADR-005/ADR-012).
 *
 * Pure string building: identical tokens always produce identical bytes, so [drift]
 * is a true regeneration gate and [generate] is idempotent. Mirrors the Windows
 * `TeslaSync.TokenGen` per-platform generator pattern.
 */
object DesignTokenGenerator {
    private const val PACKAGE = "io.teslasync.android.ui.theme.generated"
    private const val PACKAGE_PATH = "io/teslasync/android/ui/theme/generated"

    private val BANNER = listOf(
        "// AUTO-GENERATED from apps/design/tokens.json by the :android generateDesignTokens task.",
        "// DO NOT EDIT BY HAND. Regenerate with `./gradlew :android:generateDesignTokens`;",
        "// `./gradlew :android:checkDesignTokensDrift` fails the build on drift (P3/A1).",
    )

    /** Writes (only when changed) the generated theme files; deletes stale `.kt` peers. */
    fun generate(tokensFile: File, outDir: File) {
        val rendered = render(tokensFile)
        val pkgDir = File(outDir, PACKAGE_PATH).apply { mkdirs() }
        pkgDir.listFiles()
            ?.filter { it.isFile && it.extension == "kt" && it.name !in rendered.keys }
            ?.forEach { it.delete() }
        for ((name, content) in rendered) {
            val target = File(pkgDir, name)
            // Compare with normalized line endings so a CRLF working tree (Windows autocrlf=true,
            // since *.kt is not pinned to eol=lf in .gitattributes) is not treated as drift and the
            // file is not needlessly rewritten on every build.
            val current = if (target.exists()) target.readText(Charsets.UTF_8).replace("\r\n", "\n") else null
            if (current != content) {
                target.writeText(content, Charsets.UTF_8)
            }
        }
    }

    /** Returns human-readable drift descriptions (missing / stale / orphan); empty when in sync. */
    fun drift(tokensFile: File, outDir: File): List<String> {
        val rendered = render(tokensFile)
        val pkgDir = File(outDir, PACKAGE_PATH)
        val issues = mutableListOf<String>()
        for ((name, content) in rendered) {
            val target = File(pkgDir, name)
            when {
                !target.exists() -> issues += "missing $name"
                target.readText(Charsets.UTF_8).replace("\r\n", "\n") != content -> issues += "stale $name"
            }
        }
        pkgDir.listFiles()
            ?.filter { it.isFile && it.extension == "kt" && it.name !in rendered.keys }
            ?.forEach { issues += "orphan ${it.name}" }
        return issues
    }

    /** Pure render: filename -> file content. */
    @Suppress("UNCHECKED_CAST")
    fun render(tokensFile: File): Map<String, String> {
        val tokens = JsonSlurper().parse(tokensFile) as Map<String, Any?>
        return linkedMapOf(
            "GeneratedColor.kt" to renderColor(tokens),
            "GeneratedType.kt" to renderTypography(tokens),
            "GeneratedShape.kt" to renderShape(tokens),
            "GeneratedDimens.kt" to renderDimens(tokens),
            "GeneratedMotion.kt" to renderMotion(tokens),
        )
    }

    private fun file(imports: List<String>, body: List<String>): String {
        val lines = mutableListOf<String>()
        lines += BANNER
        lines += ""
        lines += "package $PACKAGE"
        lines += ""
        imports.sorted().forEach { lines += "import $it" }
        if (imports.isNotEmpty()) lines += ""
        lines += body
        return lines.joinToString("\n") + "\n"
    }

    // ── Colors ────────────────────────────────────────────────────────────────
    @Suppress("UNCHECKED_CAST")
    private fun renderColor(tokens: Map<String, Any?>): String {
        val color = tokens["color"] as Map<String, Any?>
        val chart = tokens["chart"] as Map<String, Any?>
        val light = color["light"] as Map<String, Any?>
        val dark = color["dark"] as Map<String, Any?>
        val highContrast = color["highContrast"] as Map<String, Any?>

        val body = mutableListOf<String>()
        body += "// Color schemes — semantic tokens mapped onto Material 3 ColorScheme roles."
        body += scheme("LightColorScheme", "lightColorScheme", light)
        body += ""
        body += scheme("DarkColorScheme", "darkColorScheme", dark)
        body += ""
        body += scheme("HighContrastColorScheme", "lightColorScheme", highContrast)
        body += ""
        body += "// Semantic status colors (per theme), exposed to the app via a CompositionLocal."
        body += "data class StatusColors("
        body += "    val success: Color,"
        body += "    val warning: Color,"
        body += "    val danger: Color,"
        body += "    val info: Color,"
        body += ")"
        body += ""
        body += statusColors("LightStatusColors", light)
        body += statusColors("DarkStatusColors", dark)
        body += statusColors("HighContrastStatusColors", highContrast)
        body += ""
        body += "// Brand chart palette — theme-invariant and index-stable across platforms."
        body += chartPalette(chart)

        return file(
            imports = listOf(
                "androidx.compose.material3.ColorScheme",
                "androidx.compose.material3.darkColorScheme",
                "androidx.compose.material3.lightColorScheme",
                "androidx.compose.ui.graphics.Color",
            ),
            body = body,
        )
    }

    @Suppress("UNCHECKED_CAST")
    private fun scheme(name: String, builder: String, c: Map<String, Any?>): String {
        val status = c["status"] as Map<String, Any?>
        val accent = color(c["accent"])
        val bg = color(c["bg"])
        val surface = color(c["surface"])
        val textPrimary = color(c["textPrimary"])
        val textSecondary = color(c["textSecondary"])
        val textMuted = color(c["textMuted"])
        val info = color(status["info"])
        val danger = color(status["danger"])
        // The glass/border tokens are translucent; flatten them over the opaque surface
        // so surfaceVariant/outline render as solid elevated colors derived from tokens.
        val surfaceVariant = composite(c["surfaceGlass"], c["surface"])
        val outline = composite(c["border"], c["surface"])
        return listOf(
            "val $name: ColorScheme =",
            "    $builder(",
            "        primary = $accent,",
            "        onPrimary = $bg,",
            "        secondary = $accent,",
            "        onSecondary = $bg,",
            "        tertiary = $info,",
            "        onTertiary = $bg,",
            "        background = $bg,",
            "        onBackground = $textPrimary,",
            "        surface = $surface,",
            "        onSurface = $textPrimary,",
            "        surfaceVariant = $surfaceVariant,",
            "        onSurfaceVariant = $textSecondary,",
            "        surfaceTint = $accent,",
            "        outline = $outline,",
            "        outlineVariant = $textMuted,",
            "        error = $danger,",
            "        onError = $bg,",
            "        inverseSurface = $textPrimary,",
            "        inverseOnSurface = $surface,",
            "        inversePrimary = $accent,",
            "        scrim = Color(0xFF000000),",
            "    )",
        ).joinToString("\n")
    }

    @Suppress("UNCHECKED_CAST")
    private fun statusColors(name: String, c: Map<String, Any?>): String {
        val status = c["status"] as Map<String, Any?>
        val success = color(status["success"])
        val warning = color(status["warning"])
        val danger = color(status["danger"])
        val info = color(status["info"])
        return "val $name: StatusColors = StatusColors(success = $success, warning = $warning, " +
            "danger = $danger, info = $info)"
    }

    @Suppress("UNCHECKED_CAST")
    private fun chartPalette(chart: Map<String, Any?>): String {
        val categorical = chart["categorical"] as List<String>
        val series = chart["series"] as Map<String, Any?>
        val lines = mutableListOf<String>()
        lines += "object ChartPalette {"
        lines += "    val categorical: List<Color> = listOf("
        categorical.forEach { lines += "        ${color(it)}," }
        lines += "    )"
        for ((key, value) in series) {
            lines += "    val $key: Color = ${color(value)}"
        }
        lines += "}"
        return lines.joinToString("\n")
    }

    // ── Typography ──────────────────────────────────────────────────────────────
    @Suppress("UNCHECKED_CAST")
    private fun renderTypography(tokens: Map<String, Any?>): String {
        val typography = tokens["typography"] as Map<String, Any?>
        val fonts = typography["fontFamily"] as Map<String, Any?>
        val sans = fonts["sans"] as String
        val mono = fonts["mono"] as String

        // Material 3 has 15 type-scale slots; the neutral ramp has 8 roles. Each slot maps
        // to the closest role so every slot is token-driven (no library baseline leaks in).
        val slotToRole = listOf(
            "displayLarge" to "display",
            "displayMedium" to "display",
            "displaySmall" to "display",
            "headlineLarge" to "title",
            "headlineMedium" to "title",
            "headlineSmall" to "section",
            "titleLarge" to "title",
            "titleMedium" to "section",
            "titleSmall" to "panel",
            "bodyLarge" to "body",
            "bodyMedium" to "body",
            "bodySmall" to "bodySm",
            "labelLarge" to "label",
            "labelMedium" to "caption",
            "labelSmall" to "label",
        )

        val body = mutableListOf<String>()
        body += "// Brand font-family names from tokens. Bundling the font files is out of scope here;"
        body += "// sizes/weights use the platform default family so user font-scaling keeps working."
        body += "object BrandFontFamilies {"
        body += "    const val SANS: String = \"$sans\""
        body += "    const val MONO: String = \"$mono\""
        body += "}"
        body += ""
        body += "val GeneratedTypography: Typography ="
        body += "    Typography("
        for ((slot, role) in slotToRole) {
            val r = typography[role] as Map<String, Any?>
            body += "        $slot = ${textStyle(r)},"
        }
        body += "    )"

        return file(
            imports = listOf(
                "androidx.compose.material3.Typography",
                "androidx.compose.ui.text.TextStyle",
                "androidx.compose.ui.text.font.FontWeight",
                "androidx.compose.ui.unit.sp",
            ),
            body = body,
        )
    }

    private fun textStyle(role: Map<String, Any?>): String {
        val size = sp(role["size"])
        val lineHeight = sp(role["lineHeight"])
        val letterSpacing = sp(role["letterSpacing"])
        val weight = fontWeight(role["weight"] as String)
        return "TextStyle(fontSize = $size, lineHeight = $lineHeight, " +
            "letterSpacing = $letterSpacing, fontWeight = $weight)"
    }

    private fun fontWeight(name: String): String = "FontWeight." + when (name) {
        "bold" -> "Bold"
        "semibold" -> "SemiBold"
        "medium" -> "Medium"
        "regular" -> "Normal"
        else -> error("unknown font weight: $name")
    }

    // ── Shapes ──────────────────────────────────────────────────────────────────
    @Suppress("UNCHECKED_CAST")
    private fun renderShape(tokens: Map<String, Any?>): String {
        val radius = tokens["radius"] as Map<String, Any?>
        val body = mutableListOf<String>()
        body += "// Corner radii (dp). `pill` is the fully-rounded token for chips/avatars."
        body += "object Radius {"
        for ((key, value) in radius) {
            body += "    val $key: Dp = ${dp(value)}"
        }
        body += "}"
        body += ""
        body += "val GeneratedShapes: Shapes ="
        body += "    Shapes("
        body += "        extraSmall = RoundedCornerShape(Radius.sm),"
        body += "        small = RoundedCornerShape(Radius.sm),"
        body += "        medium = RoundedCornerShape(Radius.md),"
        body += "        large = RoundedCornerShape(Radius.lg),"
        body += "        extraLarge = RoundedCornerShape(Radius.lg),"
        body += "    )"
        return file(
            imports = listOf(
                "androidx.compose.foundation.shape.RoundedCornerShape",
                "androidx.compose.material3.Shapes",
                "androidx.compose.ui.unit.Dp",
                "androidx.compose.ui.unit.dp",
            ),
            body = body,
        )
    }

    // ── Spacing + elevation ─────────────────────────────────────────────────────
    @Suppress("UNCHECKED_CAST")
    private fun renderDimens(tokens: Map<String, Any?>): String {
        val scale = (tokens["spacing"] as Map<String, Any?>)["scale"] as Map<String, Any?>
        val levels = (tokens["elevation"] as Map<String, Any?>)["levels"] as Map<String, Any?>
        // Token keys 2xl/3xl/4xl are not valid Kotlin identifiers -> xl2/xl3/xl4.
        val spacingNames = mapOf(
            "none" to "none", "xs" to "xs", "sm" to "sm", "md" to "md", "lg" to "lg",
            "xl" to "xl", "2xl" to "xl2", "3xl" to "xl3", "4xl" to "xl4",
        )
        // Map the token z-index {0,1,2,3} onto the Material 3 tonal-elevation dp scale.
        val tonal = mapOf(0 to 0, 1 to 1, 2 to 3, 3 to 6)

        val body = mutableListOf<String>()
        body += "// Spacing scale on a 4 dp base grid (token keys 2xl/3xl/4xl -> xl2/xl3/xl4)."
        body += "object Spacing {"
        for ((key, value) in scale) {
            val name = spacingNames[key] ?: error("unmapped spacing key: $key")
            body += "    val $name: Dp = ${dp(value)}"
        }
        body += "}"
        body += ""
        body += "// Tonal elevation (dp) per token elevation level (z-index {0,1,2,3} -> {0,1,3,6} dp)."
        body += "object Elevation {"
        for ((key, value) in levels) {
            @Suppress("UNCHECKED_CAST")
            val z = ((value as Map<String, Any?>)["z"] as Number).toInt()
            val elevationDp = tonal[z] ?: error("unmapped elevation z-index: $z")
            body += "    val $key: Dp = $elevationDp.dp"
        }
        body += "}"
        return file(
            imports = listOf(
                "androidx.compose.ui.unit.Dp",
                "androidx.compose.ui.unit.dp",
            ),
            body = body,
        )
    }

    // ── Motion ──────────────────────────────────────────────────────────────────
    @Suppress("UNCHECKED_CAST")
    private fun renderMotion(tokens: Map<String, Any?>): String {
        val motion = tokens["motion"] as Map<String, Any?>
        val durations = motion["durations"] as Map<String, Any?>
        val easing = motion["easing"] as Map<String, Any?>
        val body = mutableListOf<String>()
        body += "// Motion durations in milliseconds."
        body += "object MotionDurations {"
        for ((key, value) in durations) {
            body += "    const val $key: Int = ${number(value)}"
        }
        body += "}"
        body += ""
        body += "// Motion easing curves built from the token cubic-bezier control points."
        body += "object MotionEasing {"
        for ((key, value) in easing) {
            body += "    val $key: Easing = CubicBezierEasing(${cubicBezier(value as String)})"
        }
        body += "}"
        return file(
            imports = listOf(
                "androidx.compose.animation.core.CubicBezierEasing",
                "androidx.compose.animation.core.Easing",
            ),
            body = body,
        )
    }

    private fun cubicBezier(easing: String): String {
        val controls = Regex("-?[0-9]*\\.?[0-9]+").findAll(easing).map { it.value }.toList()
        require(controls.size == 4) { "expected 4 cubic-bezier control points: $easing" }
        return controls.joinToString(", ") { c -> if (c.startsWith("-")) "(${c}f)" else "${c}f" }
    }

    // ── Numeric + color helpers ──────────────────────────────────────────────────
    private fun number(value: Any?): String = when (value) {
        is Int -> value.toString()
        is Long -> value.toString()
        is BigInteger -> value.toString()
        is BigDecimal -> value.stripTrailingZeros().toPlainString()
        is Number -> value.toString()
        else -> error("expected a number, got: $value")
    }

    private fun sp(value: Any?): String {
        val n = number(value)
        return if (n.startsWith("-")) "($n).sp" else "$n.sp"
    }

    private fun dp(value: Any?): String {
        val n = number(value)
        return if (n.startsWith("-")) "($n).dp" else "$n.dp"
    }

    private fun color(value: Any?): String {
        val argb = parseArgb(value as String)
        return "Color(0x${argb.toString(16).uppercase().padStart(8, '0')})"
    }

    private fun composite(foreground: Any?, background: Any?): String {
        val fg = parseArgb(foreground as String)
        val bg = parseArgb(background as String)
        val alpha = ((fg ushr 24) and 0xFF) * 1.0 / 255.0
        fun blend(shift: Int): Int {
            val f = ((fg ushr shift) and 0xFF).toInt()
            val b = ((bg ushr shift) and 0xFF).toInt()
            return (f * alpha + b * (1.0 - alpha)).roundToInt()
        }
        val argb = packArgb(255, blend(16), blend(8), blend(0))
        return "Color(0x${argb.toString(16).uppercase().padStart(8, '0')})"
    }

    private fun parseArgb(raw: String): Long {
        val value = raw.trim()
        if (value.startsWith("#")) {
            var hex = value.substring(1)
            if (hex.length == 3) {
                hex = hex.toCharArray().joinToString("") { ch -> "$ch$ch" }
            }
            require(hex.length == 6) { "bad hex color: $raw" }
            return packArgb(
                255,
                hex.substring(0, 2).toInt(16),
                hex.substring(2, 4).toInt(16),
                hex.substring(4, 6).toInt(16),
            )
        }
        val match = Regex(
            "rgba?\\(\\s*([0-9.]+)\\s*,\\s*([0-9.]+)\\s*,\\s*([0-9.]+)\\s*(?:,\\s*([0-9.]+)\\s*)?\\)",
            RegexOption.IGNORE_CASE,
        ).find(value) ?: error("unsupported color: $raw")
        val (r, g, b, a) = match.destructured
        val alpha = if (a.isEmpty()) 255 else (parseDecimal(a) * 255.0).roundToInt()
        return packArgb(alpha, parseDecimal(r).roundToInt(), parseDecimal(g).roundToInt(), parseDecimal(b).roundToInt())
    }

    private fun parseDecimal(text: String): Double = java.lang.Double.parseDouble(text)

    private fun packArgb(a: Int, r: Int, g: Int, b: Int): Long {
        fun channel(x: Int): Long = x.coerceIn(0, 255).toLong()
        return (channel(a) shl 24) or (channel(r) shl 16) or (channel(g) shl 8) or channel(b)
    }
}
