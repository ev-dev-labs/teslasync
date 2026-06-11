// The native Jetpack Compose + Material 3 Quick Navigation dashboard surface — a parity port of
// web/src/features/dashboard/widgets/QuickNavWidget.tsx (which wraps
// web/src/features/dashboard/components/QuickNav.tsx in a `WidgetShell noPadding`). The web shell is
// handed no `loading`/`error`/`query`, and `QuickNav` is a static, data-free shortcut grid, so the
// native surface has a single rendered state (no skeleton / empty / error / stale / offline branch
// exists in the source to reproduce). It renders the four shortcuts — Drives, Charging, Analytics,
// Battery — as a 2-up or 4-up grid of tappable cards (web `grid-cols-2 sm:grid-cols-4`), each a tinted
// accent icon + label + muted description + trailing chevron, mirroring the web per-item `GlassPanel`.
// Navigation is hoisted to the host via [onNavigate] (no view performs navigation itself); the holder
// records the one-shot `view.opened` diagnostic. Every label resolves through the i18n catalog and every
// card is a single TalkBack node carrying a folded content description + the Button role.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/QuickNavWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.quicknav

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.NavGlyphs
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// Footprint of the accent icon container — the web `rounded-lg p-2` wrapper around an `h-5 w-5` glyph.
private val ACCENT_ICON_BOX_SIZE = 36.dp

// Background wash for the accent container — the native adaptation of the web `${color}10` tint, aligned
// with the shared `IconBox` wash so the tinted-icon affordance reads consistently across the app.
private const val ACCENT_WASH_ALPHA = 0.14f

private const val LABEL_MAX_LINES = 1

// Android resource names for the four description keys. They are absent from the generated catalog today
// (web `nav.{x}Desc`), so the optional lookup falls back to the web defaults in [QuickNavDefaults].
private const val DESC_KEY_DRIVES = "translation_nav_drivesDesc"
private const val DESC_KEY_CHARGING = "translation_nav_chargingDesc"
private const val DESC_KEY_ANALYTICS = "translation_nav_analyticsDesc"
private const val DESC_KEY_BATTERY = "translation_nav_batteryDesc"

/**
 * Stateful entry point. Spins up the [QuickNavWidgetViewModel] (carrying only the `view.opened`
 * diagnostic — QuickNav binds no feed), records that diagnostic once, resolves the localized strings,
 * and renders the shortcut grid for the given [size]. A dashboard host supplies [onNavigate] (wired to
 * its `NavHostController`) and a unique [instanceKey] per placement.
 *
 * @param onNavigate invoked with the tapped [QuickNavDestination]; the host performs the navigation.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun QuickNavWidget(
    modifier: Modifier = Modifier,
    size: QuickNavSize = QuickNavRegistration.defaultSize,
    onNavigate: (QuickNavDestination) -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = QuickNavRegistration.ID,
) {
    val viewModel: QuickNavWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { QuickNavWidgetViewModel(logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    QuickNavWidgetContent(
        strings = rememberQuickNavStrings(),
        size = size,
        onNavigate = onNavigate,
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/UI-test entry point. Projects [strings] into the four shortcut cards and
 * lays them out two-up or four-up per [QuickNavRegistration.columnCount] (web `grid-cols-2
 * sm:grid-cols-4`). A trailing partial row is padded with weighted spacers so every card keeps a uniform
 * width. There is no loading/empty/error branch — the web source renders this grid unconditionally.
 */
@Composable
fun QuickNavWidgetContent(
    strings: QuickNavStrings,
    size: QuickNavSize,
    onNavigate: (QuickNavDestination) -> Unit,
    modifier: Modifier = Modifier,
) {
    val items = remember(strings) { QuickNavProjection.items(strings) }
    val columns = QuickNavRegistration.columnCount(size)
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        items.chunked(columns).forEach { rowItems ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                rowItems.forEach { item ->
                    QuickNavCard(item = item, onNavigate = onNavigate, modifier = Modifier.weight(1f))
                }
                repeat(columns - rowItems.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun QuickNavCard(
    item: QuickNavItem,
    onNavigate: (QuickNavDestination) -> Unit,
    modifier: Modifier = Modifier,
) {
    val accent = remember(item.accentArgb) { Color(item.accentArgb) }
    GlassPanel(
        modifier =
            modifier
                .semantics(mergeDescendants = true) { contentDescription = item.contentDescription }
                .clickable(role = Role.Button, onClickLabel = item.label) { onNavigate(item.destination) },
        padding = PanelPadding.Md,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            AccentIconBox(color = accent) {
                Icon(
                    imageVector = glyphFor(item.destination),
                    contentDescription = null,
                    size = IconSize.Lg,
                    tint = accent,
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Heading(text = item.label, level = HeadingLevel.Sub, maxLines = LABEL_MAX_LINES)
                Caption(text = item.description)
            }
            Icon(
                imageVector = TeslaGlyphs.ChevronRight,
                contentDescription = null,
                size = IconSize.Md,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * Colored icon container mirroring the web `<div className="rounded-lg p-2" style={{ backgroundColor:
 * \`${color}10\` }}>`: a rounded box with a low-alpha wash of the item's accent [color], the full-strength
 * accent supplied to the [content] icon as its tint.
 */
@Composable
private fun AccentIconBox(
    color: Color,
    content: @Composable () -> Unit,
) {
    Surface(
        modifier = Modifier.size(ACCENT_ICON_BOX_SIZE),
        shape = RoundedCornerShape(Radius.md),
        color = color.copy(alpha = ACCENT_WASH_ALPHA),
        contentColor = color,
    ) {
        Box(contentAlignment = Alignment.Center) { content() }
    }
}

/**
 * Maps a [QuickNavDestination] onto its glyph — the native analogues of the web lucide icons
 * (`Route`, `BatteryCharging`, `Gauge`, `Activity`). The Battery item uses the activity/pulse line
 * (`NavGlyphs.Pulse`), matching the web `Activity` glyph.
 */
private fun glyphFor(destination: QuickNavDestination): ImageVector =
    when (destination) {
        QuickNavDestination.DRIVES -> NavGlyphs.Route
        QuickNavDestination.CHARGING -> DataDisplayGlyphs.BatteryCharging
        QuickNavDestination.ANALYTICS -> DataDisplayGlyphs.Gauge
        QuickNavDestination.BATTERY -> NavGlyphs.Pulse
    }

/**
 * Builds the localized [QuickNavStrings] from the i18n facade (P1/S10). The four labels resolve through
 * the generated catalog's `translation.nav.*` keys (web `t('nav.x', …)`); the four descriptions
 * reproduce web `t('nav.xDesc', default)` via [resolveOptional] over an optional by-name lookup, falling
 * back to the web source's inline defaults for the keys the catalog does not (yet) define. Remembered
 * against the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberQuickNavStrings(): QuickNavStrings {
    val context = LocalContext.current
    val drives = stringResource(R.string.translation_nav_drives)
    val charging = stringResource(R.string.translation_nav_charging)
    val analytics = stringResource(R.string.translation_nav_analytics)
    val battery = stringResource(R.string.translation_nav_battery)
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    val drivesDesc = resolveOptional(lookup, DESC_KEY_DRIVES, QuickNavDefaults.DRIVES_DESC)
    val chargingDesc = resolveOptional(lookup, DESC_KEY_CHARGING, QuickNavDefaults.CHARGING_DESC)
    val analyticsDesc = resolveOptional(lookup, DESC_KEY_ANALYTICS, QuickNavDefaults.ANALYTICS_DESC)
    val batteryDesc = resolveOptional(lookup, DESC_KEY_BATTERY, QuickNavDefaults.BATTERY_DESC)
    return remember(drives, charging, analytics, battery, drivesDesc, chargingDesc, analyticsDesc, batteryDesc) {
        QuickNavStrings(
            drives = drives,
            drivesDesc = drivesDesc,
            charging = charging,
            chargingDesc = chargingDesc,
            analytics = analytics,
            analyticsDesc = analyticsDesc,
            battery = battery,
            batteryDesc = batteryDesc,
        )
    }
}

/**
 * Optional by-name read from the Android string catalog — the production seam [resolveOptional] uses to
 * reproduce web `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent
 * (a compile-time `R.string` reference cannot express "resolve if present, else fall back"), so
 * `DiscouragedApi` is suppressed. Release builds keep resource names (resource shrinking is off — see
 * app/build.gradle.kts), so the by-name lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}
