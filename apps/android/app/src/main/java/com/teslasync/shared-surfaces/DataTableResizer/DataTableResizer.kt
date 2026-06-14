// The native Jetpack Compose + Material 3 DataTableResizer shared surface — a parity port of
// web/src/components/ui/DataTableResizer.tsx. The web surface is a drag handle that resizes a `<th>`: it follows
// the WAI-ARIA "Window Splitter" pattern (`role="separator"` + `aria-valuenow/min/max` + `tabIndex`), captures the
// pointer so a drag can travel outside the column, emits a continuous `onResize` while dragging and a final
// `onResizeEnd` on release (for persistence), and supports keyboard resize (ArrowLeft/Right ±8 px, Home → 80 px,
// End → maxWidth). It highlights while dragging and stops click-bubbling so the resize never triggers a sort.
//
// This native surface keeps that contract end to end. The horizontal drag (density-converted so the handle tracks
// the finger 1:1) emits the continuous [onResize] and the release/cancel emits [onResizeEnd]; the WAI-ARIA splitter
// becomes the platform-native adjustable node — `contentDescription` (the web `aria-label`), `ProgressBarRangeInfo`
// (the web `aria-valuenow/min/max`) and a `setProgress` action so TalkBack / Switch Access can set the width, plus
// a hardware `onKeyEvent` map (DPad-Left/Right ±step, Move-Home → 80 dp, Move-End → max) that mirrors the web key
// handler. The handle highlights while focused or dragging (the web `bg-cyan-400/60` → `colorScheme.primary`), and
// its own gesture detector consumes taps/drags so the resize never bubbles to a parent sort (the web
// `stopPropagation`); a tap focuses the splitter so a keyboard/Switch user can then arrow-key it. All bounds math,
// the keyboard command map, and the i18n label resolution flow through the pure DataTableResizerModel.kt, so the
// composable is a thin render layer; a one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first
// composition. The chrome is composed from platform tokens (P1/S9 — `colorScheme.primary` / `outlineVariant`), so
// it stays correct across light / dark / high-contrast themes.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DataTableResizer) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datatableresizer

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.roundToInt

/** Test tag identifying the resize handle — used by the instrumented per-state + a11y UI tests. */
const val DATA_TABLE_RESIZER_TEST_TAG: String = "data-table-resizer"

// The hit/affordance width of the handle (the web thin `cursor-col-resize` grip); intentionally narrower than the
// 48 dp touch minimum because adjacent column grips cannot overlap — non-pointer access is provided by the
// setProgress action + the hardware keyboard map below.
private val HANDLE_WIDTH: Dp = 16.dp

// The visible 1.5 px web rule → a crisp 2 dp vertical line.
private val HANDLE_LINE: Dp = 2.dp

// Faint accent fill behind the grip while dragging (web `bg-cyan-400/60`), theme-aware via colorScheme.primary.
private const val DRAG_FILL_ALPHA: Float = 0.24f

private val DEFAULT_MIN_WIDTH: Dp = DEFAULT_MIN_WIDTH_DP.dp
private val DEFAULT_MAX_WIDTH: Dp = DEFAULT_MAX_WIDTH_DP.dp

/**
 * Controlled resize handle — the faithful port of the web `DataTableResizer`. Resizes a column whose current
 * [width] the parent owns: the drag emits a continuous [onResize] and the release a final [onResizeEnd] (the web
 * persistence hook), all clamped to `[minWidth, maxWidth]`. Records the one-shot `view.opened` diagnostic
 * (P1/S11) on first composition and resolves the accessible label from [columnKey] (or the [label] override)
 * through the i18n facade.
 *
 * @param columnKey the column identifier folded into the default accessible label (web `columnKey`).
 * @param width the current column width the parent controls (web `width`).
 * @param onResize emitted continuously as the width changes during a drag/keyboard/a11y adjust (web `onResize`).
 * @param minWidth the smallest allowed width (web `minWidth`, default 60 dp).
 * @param maxWidth the largest allowed width (web `maxWidth`, default 800 dp).
 * @param onResizeEnd emitted once with the settled width on release/keyboard commit (web `onResizeEnd`).
 * @param label an explicit accessible-label override (web `label`); blank/absent ⇒ the localized default.
 * @param logger the sanctioned redacting logger; defaults to the app's data-container logger.
 */
@Composable
fun DataTableResizer(
    columnKey: String,
    width: Dp,
    onResize: (Dp) -> Unit,
    modifier: Modifier = Modifier,
    minWidth: Dp = DEFAULT_MIN_WIDTH,
    maxWidth: Dp = DEFAULT_MAX_WIDTH,
    onResizeEnd: ((Dp) -> Unit)? = null,
    label: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { DataTableResizerDiagnostics.recordViewOpened(logger) }
    DataTableResizerHandle(
        width = width,
        onResize = onResize,
        contentDescription = rememberResizeColumnLabel(label, columnKey),
        modifier = modifier,
        minWidth = minWidth,
        maxWidth = maxWidth,
        onResizeEnd = onResizeEnd,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point (no diagnostics, no data container). Draws the
 * grip and wires the drag, the hardware keyboard map, and the adjustable accessibility node over the pure
 * [ResizeBounds] derived from [minWidth] / [maxWidth]. The grip highlights while focused or dragging; its own
 * gesture detector consumes the gesture so the resize never bubbles to a parent sort, and a tap focuses the
 * splitter so it can then be arrow-keyed.
 *
 * @param contentDescription the already-resolved accessible name (web `aria-label`).
 */
@Composable
fun DataTableResizerHandle(
    width: Dp,
    onResize: (Dp) -> Unit,
    contentDescription: String,
    modifier: Modifier = Modifier,
    minWidth: Dp = DEFAULT_MIN_WIDTH,
    maxWidth: Dp = DEFAULT_MAX_WIDTH,
    onResizeEnd: ((Dp) -> Unit)? = null,
) {
    val density = LocalDensity.current
    val label = contentDescription
    val bounds =
        remember(minWidth, maxWidth) {
            ResizeBounds(minWidthDp = minWidth.value.roundToInt(), maxWidthDp = maxWidth.value.roundToInt())
        }
    val currentWidth by rememberUpdatedState(width)
    val emitResize by rememberUpdatedState(onResize)
    val emitResizeEnd by rememberUpdatedState(onResizeEnd)

    var dragging by remember { mutableStateOf(false) }
    var focused by remember { mutableStateOf(false) }
    val focusRequester = remember { FocusRequester() }
    val dragStartDp = remember { floatArrayOf(0f) }
    val dragAccumPx = remember { floatArrayOf(0f) }

    // A keyboard / accessibility adjust is a single discrete change, so it emits BOTH onResize and onResizeEnd —
    // mirroring the web key handler (`onResize(next); onResizeEnd?.(next)`); a drag emits them separately.
    val commit: (Int) -> Unit = { nextDp ->
        val next = nextDp.dp
        emitResize(next)
        emitResizeEnd?.invoke(next)
    }

    val active = dragging || focused
    val rangeLo = minWidth.value
    val rangeHi = maxOf(minWidth.value, maxWidth.value)
    val lineColor =
        if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
    val fillColor =
        if (dragging) MaterialTheme.colorScheme.primary.copy(alpha = DRAG_FILL_ALPHA) else Color.Transparent

    Box(
        modifier =
            modifier
                .fillMaxHeight()
                .width(HANDLE_WIDTH)
                .testTag(DATA_TABLE_RESIZER_TEST_TAG)
                .background(fillColor)
                .focusRequester(focusRequester)
                .onFocusChanged { focused = it.isFocused }
                .focusable()
                .semantics {
                    this.contentDescription = label
                    progressBarRangeInfo =
                        ProgressBarRangeInfo(
                            current = currentWidth.value.coerceIn(rangeLo, rangeHi),
                            range = rangeLo..rangeHi,
                        )
                    setProgress { target ->
                        commit(bounds.clamp(target))
                        true
                    }
                }.onKeyEvent { event ->
                    handleResizeKey(event, bounds, currentWidth.value.roundToInt(), commit)
                }.pointerInput(bounds) {
                    detectHorizontalDragGestures(
                        onDragStart = {
                            dragging = true
                            focusRequester.requestFocus()
                            dragStartDp[0] = currentWidth.value
                            dragAccumPx[0] = 0f
                        },
                        onDragEnd = {
                            dragging = false
                            emitResizeEnd?.invoke(currentWidth)
                        },
                        onDragCancel = {
                            dragging = false
                            emitResizeEnd?.invoke(currentWidth)
                        },
                    ) { change, dragAmount ->
                        change.consume()
                        dragAccumPx[0] += dragAmount
                        val deltaDp = with(density) { dragAccumPx[0].toDp() }
                        emitResize(bounds.clamp(dragStartDp[0] + deltaDp.value).dp)
                    }
                }.pointerInput(Unit) {
                    detectTapGestures(onTap = { focusRequester.requestFocus() })
                },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier =
                Modifier
                    .width(HANDLE_LINE)
                    .fillMaxHeight()
                    .background(lineColor),
        )
    }
}

/**
 * Map a physical [KeyEvent] onto a [ResizeCommand] and commit the resolved width — the native mirror of the web
 * `onKeyDown` switch. Only key-down events are handled; a non-resize key is ignored (returns `false` so the
 * event continues to propagate). Returns `true` when a resize was applied so the event is consumed.
 */
private fun handleResizeKey(
    event: KeyEvent,
    bounds: ResizeBounds,
    currentDp: Int,
    commit: (Int) -> Unit,
): Boolean {
    val command = if (event.type == KeyEventType.KeyDown) keyToResizeCommand(event.key) else null
    return if (command == null) {
        false
    } else {
        commit(bounds.applyCommand(currentDp, command))
        true
    }
}

/** The WAI-ARIA "Window Splitter" key → command map (web ArrowLeft/Right/Home/End); other keys yield null. */
private fun keyToResizeCommand(key: Key): ResizeCommand? =
    when (key) {
        Key.DirectionLeft -> ResizeCommand.Shrink
        Key.DirectionRight -> ResizeCommand.Grow
        Key.MoveHome -> ResizeCommand.Home
        Key.MoveEnd -> ResizeCommand.End
        else -> null
    }

/**
 * Resolve the handle's accessible label — the native mirror of the web `label ?? \`Resize column ${columnKey}\``.
 * The template resolves by-name through the i18n facade (the catalog key [KEY_RESIZE_COLUMN]) with the English
 * [DataTableResizerDefaults.RESIZE_COLUMN_TEMPLATE] fallback, then [columnKey] is formatted into it — unless the
 * caller supplied a non-blank [override].
 */
@Composable
private fun rememberResizeColumnLabel(
    override: String?,
    columnKey: String,
): String {
    val context = LocalContext.current
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    val template = resolveOptional(lookup, KEY_RESIZE_COLUMN, DataTableResizerDefaults.RESIZE_COLUMN_TEMPLATE)
    return remember(override, template, columnKey) { resolvedResizeLabel(override, template, columnKey) }
}

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)` for the resize label. `getIdentifier` is the only way to attempt a key that may be absent, so
 * `DiscouragedApi` is suppressed; release builds keep resource names so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ── Previews (tooling-only; the sample column names are never shipped UI) ──────────────────────────────────

private const val PREVIEW_COLUMN = "speed"

@Composable
private fun PreviewHeaderCell(
    title: String,
    width: Dp,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            text = title,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.width(width).padding(horizontal = HANDLE_LINE),
        )
        Box(modifier = Modifier.height(HANDLE_WIDTH.times(2f))) {
            DataTableResizerHandle(
                width = width,
                onResize = {},
                contentDescription =
                    resolvedResizeLabel(
                        override = null,
                        template = DataTableResizerDefaults.RESIZE_COLUMN_TEMPLATE,
                        columnKey = PREVIEW_COLUMN,
                    ),
            )
        }
    }
}

@Preview(name = "DataTableResizer · idle grip (default width)", showBackground = true)
@Composable
private fun DataTableResizerIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Row(horizontalArrangement = Arrangement.spacedBy(HANDLE_WIDTH)) {
            PreviewHeaderCell(title = "Speed", width = 120.dp)
        }
    }
}

@Preview(name = "DataTableResizer · at min / at max", showBackground = true)
@Composable
private fun DataTableResizerBoundsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Row(horizontalArrangement = Arrangement.spacedBy(HANDLE_WIDTH)) {
            PreviewHeaderCell(title = "Min", width = DEFAULT_MIN_WIDTH)
            PreviewHeaderCell(title = "Wide", width = 200.dp)
        }
    }
}
