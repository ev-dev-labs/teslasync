// The native Jetpack Compose + Material 3 TourLauncher misc surface — a parity port of
// web/src/features/onboarding/TourLauncher.tsx. The web component is a modal (web `Modal size="md"`) that lists
// every registered onboarding tour: each row shows a check-vs-play glyph in a rounded icon box, the tour title
// plus an optional "Recommended for this page" Sparkles chip and a "Completed" badge, the one-line
// description, and a Start/Replay action whose emphasis is primary on the recommended tour and ghost
// otherwise; a footer carries "Reset all tours" and "Close". Opening the launcher marks the list as seen;
// starting a tour closes the modal and dispatches the tour to the player.
//
// This port keeps that composition and contract end to end. The pure registry + completion + route-match
// LOGIC lives in [TourLauncherModel] (off-device tested); the completion read is bound through the shared
// **S8** [TourLauncherSource] into a [TourLauncherViewModel] (no persistence touches the view); and the
// per-row [TourRow] list is projected at the render boundary from the live completion snapshot + the hoisted
// path (web `useLocation().pathname`), exactly as the sibling surfaces hoist their location. The web
// component's internal `open` state + global open event become a small [TourLauncherController] the host
// remembers and any caller can `open()` — the idiomatic Compose analogue of "pop the launcher without a ref".
// Starting a tour is surfaced through [onStartTour] for the host to wire to the tour player (web
// `dispatchTourStart`), keeping this surface free of player coupling.
//
// State honesty (covenant: no silent drift): the web data is SYNCHRONOUS local state — a static registry plus
// localStorage completion flags — with no loading / error / stale / offline lifecycle, exactly like the
// sibling synchronous surfaces (LegacyAlertsRedirect's `useLocation`, QuickNav's `useTranslation`). So those
// states are intentionally not fabricated here; the reproduced branches are the web component's real ones — a
// populated list with per-row completed / recommended affordances — plus a defensive [EmptyState] so an
// (in-practice unreachable) empty registry is a friendly message rather than a blank box. Every visible string
// resolves through the i18n catalog (P1/S10); the Start/Replay actions carry the web aria-labels for TalkBack;
// the one mandated `view.opened` diagnostic (P1/S11) fires on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/misc-surfaces)
// cannot form a valid Kotlin package, so the package intentionally diverges from the path — exactly as the
// sibling feature-view surfaces do. `MatchingDeclarationName` is suppressed for the co-located stateless
// renderer, strings holder, controller, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.miscsurfaces.tourlauncher

import android.content.Context
import androidx.annotation.StringRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// ── Visual constants (the web row's washes / icon box; detekt MagicNumber is off, named here for clarity) ──
private val ICON_BOX_SIZE: Dp = 36.dp
private val HAIRLINE: Dp = 1.dp
private const val RECOMMENDED_FILL_ALPHA = 0.06f
private const val RECOMMENDED_BORDER_ALPHA = 0.40f
private const val CHIP_FILL_ALPHA = 0.12f
private const val ICON_FILL_ALPHA = 0.10f
private const val ICON_BORDER_ALPHA = 0.30f

/**
 * Owns the launcher's open state — the idiomatic Compose analogue of the web component's internal `open` state
 * plus the global `TOUR_OPEN_LAUNCHER_EVENT` (any caller pops the launcher via [open] without threading a
 * ref). A host remembers one with [rememberTourLauncherController] and shares it with the help button, the
 * command palette, and the Settings tour card.
 */
@Stable
class TourLauncherController internal constructor(
    initiallyOpen: Boolean,
) {
    /** Whether the launcher modal is currently shown. */
    var isOpen: Boolean by mutableStateOf(initiallyOpen)
        private set

    /** Open the launcher (web `TOUR_OPEN_LAUNCHER_EVENT` handler / the `open` prop being set true). */
    fun open() {
        isOpen = true
    }

    /** Close the launcher (web `setOpen(false)` from the close button, backdrop, start, or system back). */
    fun close() {
        isOpen = false
    }
}

/** Remembers a [TourLauncherController] for the composition; [initiallyOpen] is for previews/tests. */
@Composable
fun rememberTourLauncherController(initiallyOpen: Boolean = false): TourLauncherController =
    remember { TourLauncherController(initiallyOpen) }

/**
 * The localized chrome strings the launcher renders — resolved once at the Compose boundary (P1/S10) so the
 * row/footer layout stays framework-free. Per-tour titles + descriptions are resolved per row by id; the
 * Start/Replay aria-labels are resolved per row with the tour title formatted in.
 */
data class TourLauncherStrings(
    val title: String,
    val subtitle: String,
    val recommendedHere: String,
    val completed: String,
    val replay: String,
    val start: String,
    val resetAll: String,
    val close: String,
    val empty: String,
)

/** Resolves the launcher's chrome [TourLauncherStrings] from the i18n catalog (P1/S10). */
@Composable
fun rememberTourLauncherStrings(): TourLauncherStrings =
    TourLauncherStrings(
        title = stringResource(R.string.translation_tour_launcher_title),
        subtitle = stringResource(R.string.translation_tour_launcher_subtitle),
        recommendedHere = stringResource(R.string.translation_tour_launcher_recommendedHere),
        completed = stringResource(R.string.translation_tour_launcher_completed),
        replay = stringResource(R.string.translation_tour_launcher_replay),
        start = stringResource(R.string.translation_tour_launcher_start),
        resetAll = stringResource(R.string.translation_tour_launcher_resetAll),
        close = stringResource(R.string.translation_tour_launcher_close),
        empty = stringResource(R.string.translation_common_noData),
    )

/**
 * Stateful entry point for the tour launcher. Binds the shared S8 completion feed via [source] into a
 * [TourLauncherViewModel], records the one-shot `view.opened` diagnostic, marks the list seen each time the
 * launcher opens (web `markTourListSeen`), projects the live completion snapshot + hoisted [pathname] into the
 * [TourRow] list, and renders the modal while [controller] is open. The view performs no persistence.
 *
 * @param controller owns the open state (web internal `open` + open event); the host shares one across callers.
 * @param onStartTour invoked with the tour id when the user starts/replays a tour (web `dispatchTourStart`);
 *   the host hands it to the tour player. The launcher closes itself first (web `setOpen(false)`).
 * @param pathname the current path in web-path form (web `useLocation().pathname`), supplied by the host so the
 *   "Recommended for this page" highlight matches the web 1:1.
 * @param source an adapter over the shared S8 completion store; defaults to a SharedPreferences-backed store.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param instanceKey a unique key per placement so the hosted ViewModel is scoped correctly.
 */
@Composable
fun TourLauncher(
    controller: TourLauncherController,
    onStartTour: (String) -> Unit,
    pathname: String,
    modifier: Modifier = Modifier,
    source: TourLauncherSource = rememberTourLauncherSource(),
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = TourLauncherDiagnostics.SLUG,
) {
    val viewModel: TourLauncherViewModel =
        viewModel(key = instanceKey, factory = TourLauncherViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    LaunchedEffect(controller.isOpen) { if (controller.isOpen) viewModel.onLauncherOpened() }
    if (!controller.isOpen) return

    val completions by viewModel.completions.collectAsStateWithLifecycle()
    val rows =
        remember(completions, pathname) {
            TourLauncherProjection.rows(TourLauncherRegistry.TOURS, completions, pathname)
        }
    TourLauncherContent(
        rows = rows,
        strings = rememberTourLauncherStrings(),
        onStart = { id ->
            viewModel.startTour(id)
            controller.close()
            onStartTour(id)
        },
        onResetAll = viewModel::resetAll,
        onClose = controller::close,
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the modal shell (web `Modal`) wrapping the launcher body. The UI-test and host entry
 * point. The modal's title row supplies the heading + an X close (web modal header), and the body holds the
 * subtitle, the tour list (or the defensive empty state), and the reset/close footer.
 */
@Composable
fun TourLauncherContent(
    rows: List<TourRow>,
    strings: TourLauncherStrings,
    onStart: (String) -> Unit,
    onResetAll: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Modal(
        onDismissRequest = onClose,
        modifier = modifier,
        title = strings.title,
        closeLabel = strings.close,
    ) {
        TourLauncherBody(
            rows = rows,
            strings = strings,
            onStart = onStart,
            onResetAll = onResetAll,
            onClose = onClose,
        )
    }
}

/**
 * The modal body — the inline content (no dialog), so previews and UI tests can render it directly. Renders
 * the subtitle (web `Modal` lead paragraph), the tour rows or the defensive empty state, and the footer.
 */
@Composable
fun TourLauncherBody(
    rows: List<TourRow>,
    strings: TourLauncherStrings,
    onStart: (String) -> Unit,
    onResetAll: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        HelperText(strings.subtitle)
        if (rows.isEmpty()) {
            EmptyState(message = strings.empty)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                rows.forEach { row ->
                    TourRowItem(row = row, strings = strings, onStart = onStart)
                }
            }
        }
        TourLauncherFooter(strings = strings, onResetAll = onResetAll, onClose = onClose)
    }
}

@Composable
private fun TourRowItem(
    row: TourRow,
    strings: TourLauncherStrings,
    onStart: (String) -> Unit,
) {
    val title = stringResource(tourTitleRes(row.id))
    val description = stringResource(tourDescriptionRes(row.id))
    val actionLabel = if (row.completed) strings.replay else strings.start
    val actionAria =
        if (row.completed) {
            stringResource(R.string.translation_tour_launcher_replayAria, title)
        } else {
            stringResource(R.string.translation_tour_launcher_startAria, title)
        }
    val borderColor =
        if (row.recommended) {
            MaterialTheme.colorScheme.primary.copy(alpha = RECOMMENDED_BORDER_ALPHA)
        } else {
            MaterialTheme.colorScheme.outlineVariant
        }
    val fill =
        if (row.recommended) {
            MaterialTheme.colorScheme.primary.copy(alpha = RECOMMENDED_FILL_ALPHA)
        } else {
            MaterialTheme.colorScheme.surface
        }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = fill,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(HAIRLINE, borderColor),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            TourIconBox(completed = row.completed)
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Subhead(title)
                if (row.recommended || row.completed) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (row.recommended) RecommendedChip(label = strings.recommendedHere)
                        if (row.completed) Badge(text = strings.completed, variant = BadgeVariant.Success)
                    }
                }
                HelperText(description)
            }
            Button(
                label = actionLabel,
                onClick = { onStart(row.id) },
                modifier = Modifier.semantics { contentDescription = actionAria },
                variant = if (row.recommended) ButtonVariant.Primary else ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

@Composable
private fun TourIconBox(completed: Boolean) {
    val tint: Color =
        if (completed) TeslaTokens.status.success else MaterialTheme.colorScheme.onSurfaceVariant
    val fill: Color =
        if (completed) {
            TeslaTokens.status.success.copy(alpha = ICON_FILL_ALPHA)
        } else {
            MaterialTheme.colorScheme.surfaceVariant.copy(alpha = ICON_FILL_ALPHA)
        }
    val borderColor: Color =
        if (completed) {
            TeslaTokens.status.success.copy(alpha = ICON_BORDER_ALPHA)
        } else {
            MaterialTheme.colorScheme.outlineVariant
        }
    Box(
        modifier =
            Modifier
                .size(ICON_BOX_SIZE)
                .clip(RoundedCornerShape(Radius.sm))
                .background(fill)
                .border(HAIRLINE, borderColor, RoundedCornerShape(Radius.sm)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = if (completed) TeslaGlyphs.Check else TourLauncherGlyphs.PlayCircle,
            contentDescription = null,
            size = IconSize.Md,
            tint = tint,
        )
    }
}

/** Web recommended chip: a primary-washed pill with the Sparkles glyph + the "Recommended for this page" label. */
@Composable
private fun RecommendedChip(label: String) {
    Row(
        modifier =
            Modifier
                .clip(RoundedCornerShape(Radius.sm))
                .background(MaterialTheme.colorScheme.primary.copy(alpha = CHIP_FILL_ALPHA))
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = TourLauncherGlyphs.Sparkles,
            contentDescription = null,
            size = IconSize.Xs,
            tint = MaterialTheme.colorScheme.primary,
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

@Composable
private fun TourLauncherFooter(
    strings: TourLauncherStrings,
    onResetAll: () -> Unit,
    onClose: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                label = strings.resetAll,
                onClick = onResetAll,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = TourLauncherGlyphs.RotateCcw,
            )
            Button(
                label = strings.close,
                onClick = onClose,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = TeslaGlyphs.Close,
            )
        }
    }
}

/** Maps a tour id to its localized title resource (P1/S10); a defensive fallback keeps the row non-blank. */
@StringRes
private fun tourTitleRes(id: String): Int =
    when (id) {
        "main" -> R.string.translation_tour_tours_main_title
        "vehicles" -> R.string.translation_tour_tours_vehicles_title
        "drives" -> R.string.translation_tour_tours_drives_title
        "charging" -> R.string.translation_tour_tours_charging_title
        "alerts" -> R.string.translation_tour_tours_alerts_title
        "automations" -> R.string.translation_tour_tours_automations_title
        "settings" -> R.string.translation_tour_tours_settings_title
        "debugger" -> R.string.translation_tour_tours_debugger_title
        else -> R.string.translation_tour_launcher_title
    }

/** Maps a tour id to its localized description resource (P1/S10); a defensive fallback keeps the row non-blank. */
@StringRes
private fun tourDescriptionRes(id: String): Int =
    when (id) {
        "main" -> R.string.translation_tour_tours_main_description
        "vehicles" -> R.string.translation_tour_tours_vehicles_description
        "drives" -> R.string.translation_tour_tours_drives_description
        "charging" -> R.string.translation_tour_tours_charging_description
        "alerts" -> R.string.translation_tour_tours_alerts_description
        "automations" -> R.string.translation_tour_tours_automations_description
        "settings" -> R.string.translation_tour_tours_settings_description
        "debugger" -> R.string.translation_tour_tours_debugger_description
        else -> R.string.translation_tour_launcher_subtitle
    }

/** The default production source: a SharedPreferences-backed store over the app's tour preferences. */
@Composable
private fun rememberTourLauncherSource(): TourLauncherSource {
    val context = LocalContext.current
    return remember(context) {
        bindTourLauncherSource(
            context.getSharedPreferences(TOUR_LAUNCHER_PREFS_NAME, Context.MODE_PRIVATE),
        )
    }
}

// ── Previews (tooling-only; each exercises a visible render branch of the inline body) ───────────────────

@Preview(name = "Tours", showBackground = true)
@Composable
private fun TourLauncherBodyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Surface {
            Column(modifier = Modifier.padding(Spacing.lg)) {
                TourLauncherBody(
                    rows =
                        listOf(
                            TourRow("main", version = 2, completed = false, recommended = true),
                            TourRow("vehicles", version = 1, completed = true, recommended = false),
                            TourRow("drives", version = 1, completed = false, recommended = false),
                        ),
                    strings = rememberTourLauncherStrings(),
                    onStart = {},
                    onResetAll = {},
                    onClose = {},
                )
            }
        }
    }
}

@Preview(name = "Empty (defensive)", showBackground = true)
@Composable
private fun TourLauncherEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Surface {
            Column(modifier = Modifier.padding(Spacing.lg)) {
                TourLauncherBody(
                    rows = emptyList(),
                    strings = rememberTourLauncherStrings(),
                    onStart = {},
                    onResetAll = {},
                    onClose = {},
                )
            }
        }
    }
}
