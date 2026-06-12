// The native Jetpack Compose + Material 3 CollapsibleCommandGroup feature view — a parity port of
// web/src/features/system/components/CollapsibleCommandGroup.tsx. The web component renders one collapsible
// command-category group: a full-width ghost button header (the category icon, the UPPERCASE localized label,
// the `(count)`, and a chevron that rotates 180° when open) and, when open, a FadeIn-wrapped responsive grid
// of the command tiles passed as children. Open state persists per (vehicle, category) in session storage so
// each group remembers its posture as the user scrolls and navigates.
//
// Every derivation flows through the pure CollapsibleCommandGroupModel.kt (label resolution, the persistence
// key, the open-state initializer, the count label); this file is a thin render layer. The surface's only
// web hook is `useTranslation`, so it binds NO data feed and has NO loading / error / stale / offline branch
// to reproduce — modelling those would invent behaviour the source lacks (as documented on the sibling
// BatteryPill / CronParser ports). The branches the source defines ARE reproduced: collapsed (header only),
// expanded (header + FadeIn grid), the chevron rotation, and init-from-persistence. The header is rendered in
// every state, so the surface is never a blank box even with a zero count.
//
// Native mapping (P1/S9 tokens, no ported Tailwind): the web ghost `Button` maps to the shared `Button`
// Ghost/Sm; the `text-[var(--text-muted)]` icon, label, count, and chevron map to `onSurfaceVariant`; the web
// `transition-transform` chevron maps to an `animateFloatAsState` rotation suppressed to an instant snap
// under reduced motion (P1/S9 `rememberReducedMotion`); the responsive `grid-cols-2/3/4` maps to a wrapping
// `FlowRow`; the web `<FadeIn>` maps to the shared native `FadeIn`. The toggle is one accessibility node
// announcing its merged label + count plus a `stateDescription` expand/collapse affordance (the native
// analogue of the web `aria-expanded`). The lucide category glyphs are absent from the shared catalogs and
// the surface's allowed-files scope forbids editing shared files, so they are authored locally below as
// 24×24 stroked vectors (the same approach the CronParser / WidgetPicker ports take); the chevron reuses the
// shared `TeslaGlyphs.ChevronDown`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/CollapsibleCommandGroup) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.collapsiblecommandgroup

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

// ── i18n facade keys (the affordance keys resolve from the catalog; category labels fall back) ────────────
private const val EXPAND_KEY = "automations.presets.expand"
private const val EXPAND_FALLBACK = "Click to expand"
private const val COLLAPSE_KEY = "automations.presets.collapse"
private const val COLLAPSE_FALLBACK = "Click to collapse"

// ── Chevron rotation (web `open && 'rotate-180'` over `transition-transform`) ─────────────────────────────
private const val CHEVRON_OPEN_DEGREES = 180f
private const val CHEVRON_CLOSED_DEGREES = 0f
private const val INSTANT_SNAP_MS = 0

/**
 * The localized chrome strings the renderer needs — resolved once through the i18n facade. [label] is already
 * uppercased (web `uppercase` on the eyebrow label); [expandLabel] / [collapseLabel] are the accessibility
 * affordance for the toggle (the native analogue of the web `aria-expanded`).
 */
data class CollapsibleCommandGroupStrings(
    val label: String,
    val expandLabel: String,
    val collapseLabel: String,
)

/**
 * Stateful entry point — the faithful 1:1 port of the web `CollapsibleCommandGroup` props. Records the
 * one-shot `view.opened` diagnostic on first composition (P1/S11) and owns the open state: it seeds from the
 * per-(vehicle, category) [store] (the session-storage analogue) via [resolveInitialOpen], survives
 * configuration changes through [rememberSaveable], and writes every toggle back to the store.
 *
 * @param category the command category this group heads (web `category`).
 * @param vehicleId the owning vehicle (web `vehicleId`); part of the persistence key.
 * @param count the number of commands in the category, shown as `(count)` (web `count`).
 * @param defaultOpen the initial open state when nothing is persisted (web `defaultOpen`, default `false`).
 * @param store the open-state persistence seam; defaults to the process-scoped session analogue.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param content the command tiles rendered in the grid when open (web `children`).
 */
@Composable
fun CollapsibleCommandGroup(
    category: CommandCategory,
    vehicleId: Long,
    count: Int,
    modifier: Modifier = Modifier,
    defaultOpen: Boolean = false,
    store: CommandGroupCollapseStore = SessionCommandGroupCollapseStore,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable () -> Unit,
) {
    LaunchedEffect(Unit) { CollapsibleCommandGroupDiagnostics.recordViewOpened(logger) }
    val storageKey = remember(vehicleId, category) { collapseStorageKey(vehicleId, category) }
    var expanded by rememberSaveable(storageKey) {
        mutableStateOf(resolveInitialOpen(store.read(storageKey), defaultOpen))
    }
    CollapsibleCommandGroupContent(
        category = category,
        count = count,
        expanded = expanded,
        onToggle = {
            val next = !expanded
            expanded = next
            store.write(storageKey, serializeOpen(next))
        },
        modifier = modifier,
        content = content,
    )
}

/**
 * Stateless renderer — the unit / UI-test + preview entry point. Reproduces the web layout exactly: a
 * full-width ghost-button header (category icon, uppercase label, `(count)`, and a right-aligned chevron that
 * rotates when open) over a FadeIn-wrapped wrapping grid of [content] shown only while [expanded]. The whole
 * header is one accessibility node announcing the merged label + count plus an expand/collapse affordance.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CollapsibleCommandGroupContent(
    category: CommandCategory,
    count: Int,
    expanded: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val strings = rememberCommandGroupStrings(category)
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val affordance = if (expanded) strings.collapseLabel else strings.expandLabel
    val rotation by animateChevronRotation(expanded)

    Column(modifier = modifier) {
        Button(
            onClick = onToggle,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .semantics {
                        role = Role.Button
                        stateDescription = affordance
                    },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        ) {
            Icon(
                imageVector = categoryIcon(category),
                contentDescription = null,
                size = IconSize.Sm,
                tint = muted,
            )
            Spacer(Modifier.width(Spacing.sm))
            Caption(strings.label)
            Spacer(Modifier.width(Spacing.xs))
            MetricLabel(countLabel(count))
            Spacer(Modifier.weight(1f))
            Icon(
                imageVector = TeslaGlyphs.ChevronDown,
                contentDescription = null,
                size = IconSize.Xs,
                tint = muted,
                modifier = Modifier.rotate(rotation),
            )
        }
        if (expanded) {
            FadeIn {
                FlowRow(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(top = Spacing.sm),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                    verticalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    content()
                }
            }
        }
    }
}

/** Resolves the surface's chrome strings through the i18n facade (web `t(key, default)`). */
@Composable
private fun rememberCommandGroupStrings(category: CommandCategory): CollapsibleCommandGroupStrings {
    val context = LocalContext.current
    val locale: Locale = LocalConfiguration.current.locales[0]
    return remember(context, locale, category) {
        val lookup: (String) -> String? = { name -> context.optionalString(name) }
        CollapsibleCommandGroupStrings(
            label = categoryLabel(category, lookup).uppercase(locale),
            expandLabel = resolveOptional(lookup, foldCatalogKey(EXPAND_KEY), EXPAND_FALLBACK),
            collapseLabel = resolveOptional(lookup, foldCatalogKey(COLLAPSE_KEY), COLLAPSE_FALLBACK),
        )
    }
}

/** The animated chevron rotation, snapped instantly when reduced motion is requested (web parity). */
@Composable
private fun animateChevronRotation(expanded: Boolean): State<Float> {
    val reduce = rememberReducedMotion()
    return animateFloatAsState(
        targetValue = if (expanded) CHEVRON_OPEN_DEGREES else CHEVRON_CLOSED_DEGREES,
        animationSpec = tween(durationMillis = if (reduce) INSTANT_SNAP_MS else MotionDurations.normal),
        label = "command-group-chevron",
    )
}

/** The category icon (web `CATEGORY_META[category].icon`), drawn from the locally authored glyph set. */
private fun categoryIcon(category: CommandCategory): ImageVector = CATEGORY_ICONS.getValue(category)

/**
 * Optional by-name read from the Android string catalog — the production seam that reproduces web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent, so `DiscouragedApi`
 * is suppressed. Release builds keep resource names (resource shrinking is off — see app/build.gradle.kts), so
 * the by-name lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ── Locally authored lucide-style glyphs (24×24 stroked vectors; recolored at render time by the tint) ────

private val ICON_DIMENSION: Dp = 24.dp
private const val ICON_VIEWPORT = 24f
private const val STROKE_WIDTH = 2f
private const val DOT_EPSILON = 0.1f

/** The web `CATEGORY_META[category].icon` map, ported to the locally authored glyph set. */
private val CATEGORY_ICONS: Map<CommandCategory, ImageVector> =
    mapOf(
        CommandCategory.Security to CommandGroupGlyphs.Shield,
        CommandCategory.Climate to CommandGroupGlyphs.Wind,
        CommandCategory.ClimateProtection to CommandGroupGlyphs.ShieldAlert,
        CommandCategory.Charging to CommandGroupGlyphs.Bolt,
        CommandCategory.Doors to CommandGroupGlyphs.DoorOpen,
        CommandCategory.Drive to CommandGroupGlyphs.Car,
        CommandCategory.Windows to CommandGroupGlyphs.Wind,
        CommandCategory.Sunroof to CommandGroupGlyphs.ArrowUpFromDot,
        CommandCategory.Schedules to CommandGroupGlyphs.CalendarPlus,
        CommandCategory.Alerts to CommandGroupGlyphs.Speaker,
        CommandCategory.Navigation to CommandGroupGlyphs.Navigation,
        CommandCategory.Software to CommandGroupGlyphs.Download,
        CommandCategory.Vehicle to CommandGroupGlyphs.Car,
        CommandCategory.Media to CommandGroupGlyphs.Play,
    )

/**
 * The category glyph set, mirroring the lucide icons the web `CATEGORY_META` references (Shield, Wind,
 * ShieldAlert, Zap, DoorOpen, Car, ArrowUpFromDot, CalendarPlus, Speaker, Navigation, Download, Play). Each
 * is a monochrome 24×24 stroked vector, recolored by the `Icon` tint.
 */
private object CommandGroupGlyphs {
    val Shield: ImageVector =
        commandGroupStroked("CommandGroupShield") { shieldOutline() }

    val ShieldAlert: ImageVector =
        commandGroupStroked("CommandGroupShieldAlert") {
            shieldOutline()
            moveTo(12f, 8f)
            lineTo(12f, 13f)
            commandGroupDot(12f, 16f)
        }

    val Wind: ImageVector =
        commandGroupStroked("CommandGroupWind") {
            moveTo(3f, 9f)
            lineTo(13f, 9f)
            curveTo(15.2f, 9f, 15.2f, 6f, 13f, 6f)
            moveTo(3f, 13f)
            lineTo(17f, 13f)
            curveTo(19.5f, 13f, 19.5f, 16f, 17f, 16f)
            moveTo(3f, 16.5f)
            lineTo(10f, 16.5f)
            curveTo(12f, 16.5f, 12f, 19f, 10f, 19f)
        }

    val Bolt: ImageVector =
        commandGroupStroked("CommandGroupBolt") {
            moveTo(13f, 3f)
            lineTo(5f, 13f)
            lineTo(11f, 13f)
            lineTo(11f, 21f)
            lineTo(19f, 11f)
            lineTo(13f, 11f)
            close()
        }

    val DoorOpen: ImageVector =
        commandGroupStroked("CommandGroupDoorOpen") {
            moveTo(4f, 21f)
            lineTo(4f, 5f)
            lineTo(14f, 3f)
            lineTo(14f, 21f)
            moveTo(14f, 5f)
            lineTo(18f, 5f)
            lineTo(18f, 21f)
            moveTo(2f, 21f)
            lineTo(20f, 21f)
            commandGroupDot(11f, 12f)
        }

    val Car: ImageVector =
        commandGroupStroked("CommandGroupCar") {
            commandGroupRect(3.5f, 11f, 20.5f, 16f)
            moveTo(5.5f, 11f)
            lineTo(7f, 7f)
            curveTo(7.3f, 6.4f, 7.9f, 6f, 8.6f, 6f)
            lineTo(15.4f, 6f)
            curveTo(16.1f, 6f, 16.7f, 6.4f, 17f, 7f)
            lineTo(18.5f, 11f)
            commandGroupCircle(7.5f, 16f, 1.5f)
            commandGroupCircle(16.5f, 16f, 1.5f)
        }

    val ArrowUpFromDot: ImageVector =
        commandGroupStroked("CommandGroupArrowUpFromDot") {
            moveTo(7f, 8f)
            lineTo(12f, 3f)
            lineTo(17f, 8f)
            moveTo(12f, 3f)
            lineTo(12f, 16f)
            commandGroupDot(12f, 20f)
        }

    val CalendarPlus: ImageVector =
        commandGroupStroked("CommandGroupCalendarPlus") {
            commandGroupRect(4f, 5f, 20f, 20f)
            moveTo(8f, 3f)
            lineTo(8f, 7f)
            moveTo(16f, 3f)
            lineTo(16f, 7f)
            moveTo(4f, 9f)
            lineTo(20f, 9f)
            moveTo(12f, 12f)
            lineTo(12f, 17f)
            moveTo(9.5f, 14.5f)
            lineTo(14.5f, 14.5f)
        }

    val Speaker: ImageVector =
        commandGroupStroked("CommandGroupSpeaker") {
            commandGroupRect(5f, 2f, 19f, 22f)
            commandGroupCircle(12f, 14f, 3.5f)
            commandGroupDot(12f, 6f)
        }

    val Navigation: ImageVector =
        commandGroupStroked("CommandGroupNavigation") {
            moveTo(3f, 11f)
            lineTo(22f, 2f)
            lineTo(13f, 21f)
            lineTo(11f, 13f)
            close()
        }

    val Download: ImageVector =
        commandGroupStroked("CommandGroupDownload") {
            moveTo(4f, 16f)
            lineTo(4f, 20f)
            lineTo(20f, 20f)
            lineTo(20f, 16f)
            moveTo(8f, 11f)
            lineTo(12f, 15f)
            lineTo(16f, 11f)
            moveTo(12f, 15f)
            lineTo(12f, 3f)
        }

    val Play: ImageVector =
        commandGroupStroked("CommandGroupPlay") {
            moveTo(7f, 5f)
            lineTo(19f, 12f)
            lineTo(7f, 19f)
            close()
        }
}

/** The shared shield silhouette used by both Shield and ShieldAlert. */
private fun PathBuilder.shieldOutline() {
    moveTo(12f, 3f)
    lineTo(19f, 6f)
    lineTo(19f, 12f)
    curveTo(19f, 16.5f, 16f, 19.5f, 12f, 21f)
    curveTo(8f, 19.5f, 5f, 16.5f, 5f, 12f)
    lineTo(5f, 6f)
    close()
}

/** Builds a 24×24 round-capped stroked [ImageVector]; the path is filled by [build]. */
private fun commandGroupStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = ICON_DIMENSION,
            defaultHeight = ICON_DIMENSION,
            viewportWidth = ICON_VIEWPORT,
            viewportHeight = ICON_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** Axis-aligned rectangle from ([left], [top]) to ([right], [bottom]). */
private fun PathBuilder.commandGroupRect(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
) {
    moveTo(left, top)
    lineTo(right, top)
    lineTo(right, bottom)
    lineTo(left, bottom)
    close()
}

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.commandGroupCircle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

/** A single dot (a degenerate one-unit stroke) at ([x], [y]). */
private fun PathBuilder.commandGroupDot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + DOT_EPSILON, y)
}

// ── Previews (tooling-only; exercise the collapsed and expanded states) ───────────────────────────────────

private const val PREVIEW_COUNT = 4

@Preview(name = "Collapsed", showBackground = true)
@Composable
private fun CollapsibleCommandGroupCollapsedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CollapsibleCommandGroupContent(
            category = CommandCategory.Security,
            count = PREVIEW_COUNT,
            expanded = false,
            onToggle = {},
        ) {}
    }
}

@Preview(name = "Expanded", showBackground = true)
@Composable
private fun CollapsibleCommandGroupExpandedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CollapsibleCommandGroupContent(
            category = CommandCategory.Climate,
            count = PREVIEW_COUNT,
            expanded = true,
            onToggle = {},
        ) {
            Caption("Wake")
            Caption("Vent")
            Caption("Heat")
            Caption("Cool")
        }
    }
}
