// The native Jetpack Compose + Material 3 dashboard LayoutManager feature view — a parity port of
// web/src/features/dashboard/components/LayoutManager.tsx. The web component is the dashboard layout switcher:
// a horizontally scrollable strip of saved-dashboard chips (icon + name + a "default" tag for the protected
// layout) with the active layout highlighted; tapping a chip switches to it, a per-chip context menu (web
// right-click) carries Rename / Duplicate / Settings / Delete (Delete disabled for the default layout), chips
// reorder (web HTML5 drag), renaming swaps the chip for an inline editor, and a trailing "New Layout"
// affordance either opens the template gallery (when the host supplies onOpenTemplates) or reveals an inline
// create editor.
//
// The native surface keeps that contract. Its only web hook is useTranslation('dashboard'), mapped here to
// the i18n catalog (P1/S10); it performs NO HTTP and binds no feed of its own — the saved layouts arrive
// through the shared state-holder layer (P1/S8) as a [UiState], exactly as the Dashboard page would feed
// them. Because that layer carries a full lifecycle, the surface renders every state it can carry: a loading
// skeleton while the layout list first loads, a hard error with retry, the ready strip, a stale/offline
// freshness chip (with auto-refresh) when cached layouts are shown, and an empty strip that still offers the
// New Layout CTA (web parity) — never a blank box. A web-parity overload takes the layouts list directly for
// hosts that already hold it.
//
// Per Android guidelines this is built from native primitives + the shared component library + design tokens
// (P1/S9), never ported Tailwind classes. The web right-click menu becomes a long-press context menu (the
// documented Android idiom); the web HTML5 drag — which has no keyboard or screen-reader path — becomes
// accessible "Move left" / "Move right" menu actions that realize the same onReorder(from, to) contract.
// `view.opened` is emitted once via the sanctioned redacting logger (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LayoutManager — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.layoutmanager

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ContextMenu
import io.teslasync.android.components.ui.ContextMenuItem
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

private const val EM_DASH: String = "\u2014"
private val CHIP_NAME_MAX_WIDTH: Dp = 140.dp
private val EDITOR_FIELD_WIDTH: Dp = 176.dp
private val STRIP_SKELETON_HEIGHT: Dp = 36.dp

/**
 * Stateful entry point for the dashboard LayoutManager. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [layoutsState] the shared feature-view layer can carry. The host owns
 * the layouts feed (P1/S8) and supplies [onRetry]; this view never performs HTTP. Every other prop mirrors the
 * web component's nine callbacks.
 *
 * @param layoutsState the saved-layout list lifecycle projection (cached-then-network). `Loading`/`Error`/stale
 *   are reproduced for full state coverage; a host that already holds the list can use the web-parity overload.
 * @param activeId the selected layout id (web `activeId`) — the highlighted chip.
 * @param onSwitch switches to a layout (web `onSwitch`).
 * @param onCreate creates a new layout with the given name (web `onCreate`).
 * @param onRename renames a layout (web `onRename`).
 * @param onDelete deletes a layout (web `onDelete`); never offered for the default layout.
 * @param onReorder moves a layout from one index to another (web `onReorder`), realized via the move actions.
 * @param onDuplicate duplicates a layout (web `onDuplicate`).
 * @param onOpenSettings opens a layout's settings (web `onOpenSettings`).
 * @param onOpenTemplates opens the template gallery; when `null`, the New Layout button reveals the inline
 *   create editor instead (web `onOpenTemplates?`).
 * @param onRetry re-runs the host's layout load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LayoutManager(
    layoutsState: UiState<List<LayoutTab>>,
    activeId: String,
    onSwitch: (String) -> Unit,
    onCreate: (String) -> Unit,
    onRename: (String, String) -> Unit,
    onDelete: (String) -> Unit,
    onReorder: (Int, Int) -> Unit,
    onDuplicate: (String) -> Unit,
    onOpenSettings: (String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenTemplates: (() -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { LayoutManagerDiagnostics.recordViewOpened(logger) }
    LayoutManagerContent(
        layoutsState = layoutsState,
        activeId = activeId,
        onSwitch = onSwitch,
        onCreate = onCreate,
        onRename = onRename,
        onDelete = onDelete,
        onReorder = onReorder,
        onDuplicate = onDuplicate,
        onOpenSettings = onOpenSettings,
        onRetry = onRetry,
        modifier = modifier,
        onOpenTemplates = onOpenTemplates,
    )
}

/**
 * Web-parity overload mirroring the web component's controlled props (the host already holds the [dashboards]
 * list). Wraps the list in a ready/empty [UiState] and offers no retry affordance, since there is no fetch
 * behind it. Records `view.opened` like the stateful entry.
 */
@Composable
fun LayoutManager(
    dashboards: List<LayoutTab>,
    activeId: String,
    onSwitch: (String) -> Unit,
    onCreate: (String) -> Unit,
    onRename: (String, String) -> Unit,
    onDelete: (String) -> Unit,
    onReorder: (Int, Int) -> Unit,
    onDuplicate: (String) -> Unit,
    onOpenSettings: (String) -> Unit,
    modifier: Modifier = Modifier,
    onOpenTemplates: (() -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val phase = if (dashboards.isEmpty()) UiPhase.Empty else UiPhase.Content
    val state = remember(dashboards, phase) { UiState(phase = phase, data = dashboards) }
    LayoutManager(
        layoutsState = state,
        activeId = activeId,
        onSwitch = onSwitch,
        onCreate = onCreate,
        onRename = onRename,
        onDelete = onDelete,
        onReorder = onReorder,
        onDuplicate = onDuplicate,
        onOpenSettings = onOpenSettings,
        onRetry = {},
        modifier = modifier,
        onOpenTemplates = onOpenTemplates,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Switches on the host lifecycle: a
 * loading skeleton, a hard-error retry surface, or — when ready — an optional freshness chip (only while
 * refreshing/stale/offline) above the layout strip. Stale (non-error) data auto-refreshes, mirroring the
 * shared freshness contract.
 */
@Composable
fun LayoutManagerContent(
    layoutsState: UiState<List<LayoutTab>>,
    activeId: String,
    onSwitch: (String) -> Unit,
    onCreate: (String) -> Unit,
    onRename: (String, String) -> Unit,
    onDelete: (String) -> Unit,
    onReorder: (Int, Int) -> Unit,
    onDuplicate: (String) -> Unit,
    onOpenSettings: (String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenTemplates: (() -> Unit)? = null,
    strings: LayoutManagerStrings = rememberLayoutManagerStrings(),
) {
    LaunchedEffect(layoutsState.stale, layoutsState.refreshing, layoutsState.hasError) {
        if (layoutsState.stale && !layoutsState.refreshing && !layoutsState.hasError) onRetry()
    }
    val formatAge = rememberLayoutFreshnessFormatter()

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        when (layoutManagerSurfaceFor(isLoading = layoutsState.isLoading, isError = layoutsState.isError)) {
            LayoutManagerSurfaceState.Loading ->
                LayoutManagerLoading(label = stringResource(R.string.translation_common_loading))

            LayoutManagerSurfaceState.Error -> LayoutManagerError(onRetry = onRetry)

            LayoutManagerSurfaceState.Ready -> {
                if (layoutsState.stale || layoutsState.refreshing || layoutsState.hasError) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        DataFreshness(
                            updatedAtMillis = layoutsState.fetchedAt?.takeIf { it > 0 },
                            isFetching = layoutsState.refreshing,
                            isStale = layoutsState.stale,
                            isError = layoutsState.hasError,
                            fetchingLabel = stringResource(R.string.translation_common_loading),
                            errorLabel = stringResource(R.string.translation_common_offline),
                            formatAge = formatAge,
                        )
                    }
                }
                LayoutManagerStrip(
                    dashboards = layoutsState.data ?: emptyList(),
                    activeId = activeId,
                    strings = strings,
                    onSwitch = onSwitch,
                    onCreate = onCreate,
                    onRename = onRename,
                    onDelete = onDelete,
                    onReorder = onReorder,
                    onDuplicate = onDuplicate,
                    onOpenSettings = onOpenSettings,
                    onOpenTemplates = onOpenTemplates,
                )
            }
        }
    }
}

/**
 * The scrollable chip strip + trailing create affordance — the native analogue of the web `flex … overflow-x`
 * row. Owns the transient editor state (which chip is being renamed, and whether the inline create editor is
 * open) the web holds in `editingId` / `isCreating`. An empty list renders just the New Layout CTA (web
 * parity), so the strip is never a blank box.
 */
@Composable
private fun LayoutManagerStrip(
    dashboards: List<LayoutTab>,
    activeId: String,
    strings: LayoutManagerStrings,
    onSwitch: (String) -> Unit,
    onCreate: (String) -> Unit,
    onRename: (String, String) -> Unit,
    onDelete: (String) -> Unit,
    onReorder: (Int, Int) -> Unit,
    onDuplicate: (String) -> Unit,
    onOpenSettings: (String) -> Unit,
    onOpenTemplates: (() -> Unit)?,
) {
    var editingId by remember { mutableStateOf<String?>(null) }
    var editDraft by remember { mutableStateOf("") }
    var isCreating by remember { mutableStateOf(false) }
    var createDraft by remember { mutableStateOf("") }

    Row(
        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        dashboards.forEachIndexed { index, dashboard ->
            val display = LayoutManagerProjection.tab(dashboard, activeId, index, dashboards.size)
            if (editingId == dashboard.id) {
                LayoutInlineEditor(
                    value = editDraft,
                    label = strings.rename,
                    confirmLabel = strings.confirmRename,
                    cancelLabel = strings.cancelRename,
                    onValueChange = { editDraft = it },
                    onConfirm = {
                        LayoutManagerProjection.renameCommit(editDraft)?.let { onRename(dashboard.id, it) }
                        editingId = null
                    },
                    onCancel = { editingId = null },
                )
            } else {
                LayoutChip(
                    display = display,
                    strings = strings,
                    onSwitch = { onSwitch(dashboard.id) },
                    onStartRename = {
                        editDraft = dashboard.name
                        editingId = dashboard.id
                    },
                    onDuplicate = { onDuplicate(dashboard.id) },
                    onSettings = { onOpenSettings(dashboard.id) },
                    onMoveLeft = { onReorder(index, index - 1) },
                    onMoveRight = { onReorder(index, index + 1) },
                    onDelete = { onDelete(dashboard.id) },
                )
            }
        }

        if (isCreating) {
            LayoutInlineEditor(
                value = createDraft,
                label = strings.newName,
                confirmLabel = strings.confirmCreate,
                cancelLabel = strings.cancelCreate,
                onValueChange = { createDraft = it },
                onConfirm = {
                    LayoutManagerProjection.createCommit(createDraft)?.let { onCreate(it) }
                    isCreating = false
                },
                onCancel = { isCreating = false },
            )
        } else {
            Button(
                label = strings.newLayout,
                onClick = {
                    if (LayoutManagerProjection.startCreateOpensTemplates(onOpenTemplates != null)) {
                        onOpenTemplates?.invoke()
                    } else {
                        createDraft = ""
                        isCreating = true
                    }
                },
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
                leadingIcon = TeslaGlyphs.Plus,
            )
        }
    }
}

/**
 * One dashboard chip — the native analogue of the web tab `<div>`. Tap switches to the layout; a long press
 * opens the [ContextMenu] (the Android idiom for the web right-click menu) carrying Rename / Duplicate /
 * Settings / Move left / Move right / Delete. The active chip is highlighted via the Material primary
 * container; the protected-default tag renders inline. The chip announces its name + selected state to
 * TalkBack, and the long-press carries an explicit action label.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun LayoutChip(
    display: LayoutTabDisplay,
    strings: LayoutManagerStrings,
    onSwitch: () -> Unit,
    onStartRename: () -> Unit,
    onDuplicate: () -> Unit,
    onSettings: () -> Unit,
    onMoveLeft: () -> Unit,
    onMoveRight: () -> Unit,
    onDelete: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    val container =
        if (display.isActive) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
    val content =
        if (display.isActive) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
    val handlers =
        LayoutChipHandlers(
            onStartRename = onStartRename,
            onDuplicate = onDuplicate,
            onSettings = onSettings,
            onMoveLeft = onMoveLeft,
            onMoveRight = onMoveRight,
            onDelete = onDelete,
        )

    Box {
        Surface(
            shape = RoundedCornerShape(Radius.md),
            color = container,
            contentColor = content,
            modifier =
                Modifier
                    .clip(RoundedCornerShape(Radius.md))
                    .combinedClickable(
                        onClick = onSwitch,
                        onLongClick = { menuOpen = true },
                        onLongClickLabel = strings.options,
                    ).semantics {
                        role = Role.Tab
                        selected = display.isActive
                    },
        ) {
            Row(
                modifier = Modifier.padding(horizontal = Spacing.md, vertical = Spacing.sm),
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BodyText(
                    text = display.icon,
                    color = content,
                    modifier = Modifier.clearAndSetSemantics {},
                )
                BodyText(
                    text = display.name,
                    color = content,
                    maxLines = 1,
                    modifier = Modifier.widthIn(max = CHIP_NAME_MAX_WIDTH),
                )
                if (display.isDefault) {
                    Caption(strings.default)
                }
            }
        }
        ContextMenu(
            expanded = menuOpen,
            onDismissRequest = { menuOpen = false },
            items = chipMenuItems(display, strings, handlers),
        )
    }
}

/** Bundles a chip's action callbacks so the menu builder stays within the parameter budget. */
private data class LayoutChipHandlers(
    val onStartRename: () -> Unit,
    val onDuplicate: () -> Unit,
    val onSettings: () -> Unit,
    val onMoveLeft: () -> Unit,
    val onMoveRight: () -> Unit,
    val onDelete: () -> Unit,
)

/**
 * Builds the [ContextMenuItem]s for a chip from the pure [LayoutManagerProjection.menuItems] composition,
 * resolving each label through [strings] and dispatching to the matching [handlers] callback. The glyphs reuse
 * the shared [TeslaGlyphs] set plus the local [LayoutManagerGlyphs] gear/trash.
 */
private fun chipMenuItems(
    display: LayoutTabDisplay,
    strings: LayoutManagerStrings,
    handlers: LayoutChipHandlers,
): List<ContextMenuItem> =
    LayoutManagerProjection.menuItems(display).map { item ->
        ContextMenuItem(
            label = strings.labelFor(item.action),
            onClick = handlers.dispatch(item.action),
            enabled = item.enabled,
            destructive = item.destructive,
            leadingIcon = item.action.glyph(),
        )
    }

/** Maps a [LayoutAction] to its handler callback. */
private fun LayoutChipHandlers.dispatch(action: LayoutAction): () -> Unit =
    when (action) {
        LayoutAction.Rename -> onStartRename
        LayoutAction.Duplicate -> onDuplicate
        LayoutAction.Settings -> onSettings
        LayoutAction.MoveLeft -> onMoveLeft
        LayoutAction.MoveRight -> onMoveRight
        LayoutAction.Delete -> onDelete
    }

/** Maps a [LayoutAction] to its leading glyph (shared [TeslaGlyphs] where available, else the local gear/trash). */
private fun LayoutAction.glyph(): ImageVector =
    when (this) {
        LayoutAction.Rename -> TeslaGlyphs.Edit
        LayoutAction.Duplicate -> TeslaGlyphs.Copy
        LayoutAction.Settings -> LayoutManagerGlyphs.Settings
        LayoutAction.MoveLeft -> TeslaGlyphs.ChevronLeft
        LayoutAction.MoveRight -> TeslaGlyphs.ChevronRight
        LayoutAction.Delete -> LayoutManagerGlyphs.Trash
    }

/**
 * The inline name editor — the native analogue of the web inline `<input>` + confirm/cancel buttons used for
 * both rename and create. A bounded-width shared [Input] (so it fits the horizontal strip) with explicit
 * confirm (check) and cancel (x) [IconButton]s carrying the web `aria-label`s.
 */
@Composable
private fun LayoutInlineEditor(
    value: String,
    label: String,
    confirmLabel: String,
    cancelLabel: String,
    onValueChange: (String) -> Unit,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.width(EDITOR_FIELD_WIDTH)) {
            Input(value = value, onValueChange = onValueChange, label = label, singleLine = true)
        }
        IconButton(imageVector = TeslaGlyphs.Check, contentDescription = confirmLabel, onClick = onConfirm)
        IconButton(imageVector = TeslaGlyphs.Close, contentDescription = cancelLabel, onClick = onCancel)
    }
}

/** First-load skeleton — three chip-shaped bars so the strip is never blank while the layouts load. */
@Composable
private fun LayoutManagerLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(modifier = Modifier.weight(1f), height = STRIP_SKELETON_HEIGHT, rounded = true)
        Skeleton(modifier = Modifier.weight(1f), height = STRIP_SKELETON_HEIGHT, rounded = true)
        Skeleton(modifier = Modifier.weight(1f), height = STRIP_SKELETON_HEIGHT, rounded = true)
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun LayoutManagerError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [LayoutManagerStrings]. The eleven `dashboard.*` keys exist in the catalog and resolve
 * through compile-time resources; the two move actions and the long-press hint resolve by-name with the web
 * `t(key, default)` fallback (the catalog has no key for the platform-native affordances). Remembered against
 * the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberLayoutManagerStrings(): LayoutManagerStrings {
    val context = LocalContext.current
    val rename = stringResource(R.string.translation_dashboard_rename)
    val duplicate = stringResource(R.string.translation_dashboard_duplicate)
    val settings = stringResource(R.string.translation_dashboard_settings)
    val delete = stringResource(R.string.translation_dashboard_delete)
    val default = stringResource(R.string.translation_dashboard_default)
    val newLayout = stringResource(R.string.translation_dashboard_newLayout)
    val newName = stringResource(R.string.translation_dashboard_newName)
    val confirmRename = stringResource(R.string.translation_dashboard_confirmRename)
    val cancelRename = stringResource(R.string.translation_dashboard_cancelRename)
    val confirmCreate = stringResource(R.string.translation_dashboard_confirmCreate)
    val cancelCreate = stringResource(R.string.translation_dashboard_cancelCreate)
    val moveLeft = resolveOptional({ context.optionalString(it) }, KEY_MOVE_LEFT, LayoutManagerDefaults.MOVE_LEFT)
    val moveRight = resolveOptional({ context.optionalString(it) }, KEY_MOVE_RIGHT, LayoutManagerDefaults.MOVE_RIGHT)
    val options = resolveOptional({ context.optionalString(it) }, KEY_OPTIONS, LayoutManagerDefaults.OPTIONS)
    return remember(rename, duplicate, settings, delete, default, newLayout, newName) {
        LayoutManagerStrings(
            rename = rename,
            duplicate = duplicate,
            settings = settings,
            delete = delete,
            default = default,
            newLayout = newLayout,
            newName = newName,
            confirmRename = confirmRename,
            cancelRename = cancelRename,
            confirmCreate = confirmCreate,
            cancelCreate = cancelCreate,
            moveLeft = moveLeft,
            moveRight = moveRight,
            options = options,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`), with an explicit
 * [Locale] so the numeric substitution is locale-correct — the same pattern the sibling surfaces use.
 */
@Composable
private fun rememberLayoutFreshnessFormatter(): (FreshnessAge) -> String {
    val locale = currentLocale()
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(locale, justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(locale, age.value)
                is FreshnessAge.Minutes -> minutes.format(locale, age.value)
                is FreshnessAge.Hours -> hours.format(locale, age.value)
                is FreshnessAge.Days -> days.format(locale, age.value)
                is FreshnessAge.Weeks -> weeks.format(locale, age.value)
            }
        }
    }
}

/** The active configuration [Locale] (the first in the locale list), falling back to the JVM default. */
@Composable
private fun currentLocale(): Locale {
    val configuration = LocalConfiguration.current
    return if (configuration.locales.isEmpty) Locale.getDefault() else configuration.locales[0]
}

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is
 * suppressed. Release builds keep resource names (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

/**
 * The two glyphs this surface needs that the shared [TeslaGlyphs] set does not carry. The web uses lucide
 * `Settings` (gear) and `Trash2` (trash can) for two of its menu actions; Android ships no equivalent without
 * the frozen `material-icons-extended` artifact, so — exactly as the sibling surfaces author their lucide
 * ports — they are authored here as 24×24 stroked vectors, monochrome and recolored at render time by the
 * `Icon`/menu tint.
 */
private object LayoutManagerGlyphs {
    val Settings: ImageVector =
        stroked("Settings") {
            // Center hub.
            moveTo(9f, 12f)
            arcTo(3f, 3f, 0f, false, true, 15f, 12f)
            arcTo(3f, 3f, 0f, false, true, 9f, 12f)
            close()
            // Eight radial teeth around the hub.
            moveTo(12f, 3f)
            lineTo(12f, 6f)
            moveTo(12f, 18f)
            lineTo(12f, 21f)
            moveTo(3f, 12f)
            lineTo(6f, 12f)
            moveTo(18f, 12f)
            lineTo(21f, 12f)
            moveTo(5.6f, 5.6f)
            lineTo(7.8f, 7.8f)
            moveTo(16.2f, 16.2f)
            lineTo(18.4f, 18.4f)
            moveTo(5.6f, 18.4f)
            lineTo(7.8f, 16.2f)
            moveTo(16.2f, 7.8f)
            lineTo(18.4f, 5.6f)
        }

    val Trash: ImageVector =
        stroked("Trash") {
            // Lid line.
            moveTo(4f, 7f)
            lineTo(20f, 7f)
            // Handle.
            moveTo(9f, 7f)
            lineTo(9f, 4f)
            lineTo(15f, 4f)
            lineTo(15f, 7f)
            // Can body.
            moveTo(6f, 7f)
            lineTo(7f, 20f)
            lineTo(17f, 20f)
            lineTo(18f, 7f)
            // Inner streaks.
            moveTo(10f, 11f)
            lineTo(10f, 16f)
            moveTo(14f, 11f)
            lineTo(14f, 16f)
        }

    private fun stroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = 24.dp,
                defaultHeight = 24.dp,
                viewportWidth = 24f,
                viewportHeight = 24f,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

// ── Previews (tooling-only; @Preview entry points exercise each render surface) ──────────────────────────────

private val PREVIEW_DASHBOARDS =
    listOf(
        LayoutTab(id = "overview", name = "Overview", icon = "\uD83D\uDCCA", isDefault = true),
        LayoutTab(id = "charging", name = "Charging", icon = "\u26A1"),
        LayoutTab(id = "trips", name = "Road Trips", icon = null),
    )

@Preview(name = "Ready", showBackground = true)
@Composable
private fun LayoutManagerReadyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LayoutManagerContent(
            layoutsState = UiState(phase = UiPhase.Content, data = PREVIEW_DASHBOARDS),
            activeId = "overview",
            onSwitch = {},
            onCreate = {},
            onRename = { _, _ -> },
            onDelete = {},
            onReorder = { _, _ -> },
            onDuplicate = {},
            onOpenSettings = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun LayoutManagerEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LayoutManagerContent(
            layoutsState = UiState(phase = UiPhase.Empty, data = emptyList()),
            activeId = "",
            onSwitch = {},
            onCreate = {},
            onRename = { _, _ -> },
            onDelete = {},
            onReorder = { _, _ -> },
            onDuplicate = {},
            onOpenSettings = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun LayoutManagerLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LayoutManagerContent(
            layoutsState = UiState.loading(),
            activeId = "",
            onSwitch = {},
            onCreate = {},
            onRename = { _, _ -> },
            onDelete = {},
            onReorder = { _, _ -> },
            onDuplicate = {},
            onOpenSettings = {},
            onRetry = {},
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun LayoutManagerErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LayoutManagerContent(
            layoutsState = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            activeId = "",
            onSwitch = {},
            onCreate = {},
            onRename = { _, _ -> },
            onDelete = {},
            onReorder = { _, _ -> },
            onDuplicate = {},
            onOpenSettings = {},
            onRetry = {},
        )
    }
}
