// The native Jetpack Compose + Material 3 EntryDrawer modal/dialog — a parity port of
// web/src/features/admin/components/dlq-inspector/EntryDrawer.tsx. The web component is the DLQ Inspector's
// slide-in side panel: it lazy-loads the FULL dead-letter entry (summary + base64 raw + inner payloads), shows
// the summary as a key/value list and the payloads behind inner/raw tabs (decoded base64 -> UTF-8, with a
// binary marker + copy button when the body is not text), and hosts a Replay CTA in the footer that re-publishes
// the entry to its source topic. This port reproduces every one of those branches with native primitives.
//
// The web `Drawer` (`@/components/ui`: a scrim-backed, focus-trapped slide-in panel with a title header and a
// sticky footer) maps on Android to a Material 3 [ModalBottomSheet] — the HIG-correct native idiom for a
// scrim-backed, swipe/tap-dismissable overlay with a sticky header + footer. This mirrors the sibling
// WidgetPicker port's decision to map the web drawer onto the first-class Material primitive rather than porting
// Tailwind chrome; the shared native `Drawer` (a `ModalNavigationDrawer` that wraps the screen-behind and has no
// footer slot) cannot host this inspector's Replay footer, so the surface composes the bottom-sheet primitive
// like its siblings. The shared [GlassPanel] / [KVList] / [Tabs] / [CopyButton] / [Button] / [Spinner] /
// [EmptyState] map 1:1.
//
// The drawer's only data source is `useTranslation` (mapped to the generated i18n catalog, P1/S10) — there is
// no query/fetch on THIS surface, so the error / stale / offline states do not exist here (the owning DLQ
// Inspector page owns the list + full-entry queries and passes `full` / `loading` down). The render states the
// web source defines are reproduced in full: the loading Spinner (`loading && !full`), the content body
// (summary KVList + inner/raw payload tabs), and the empty state (`head` null — the web renders nothing, which
// would be a blank box, so the native surface shows a friendly empty state). Every derivation flows through the
// pure [EntryDrawerProjection]; the composable is a thin render layer that records the one-shot `view.opened`
// diagnostic (P1/S11).
//
// Token mapping (P1/S9 tokens, no ported Tailwind): the `<pre>` payload block (`max-h-80 overflow-auto
// rounded-md border bg-[var(--surface-2)] p-3 font-mono text-xs`) maps to a rounded [Box] with an `outline`
// border, a `surfaceVariant` fill, vertical scroll capped at [PAYLOAD_MAX_HEIGHT], horizontal scroll for long
// lines, and a [CodeText] body. Web `gap-*`/`space-y-*` insets map to `Spacing` tokens; the web `<Send>` lucide
// icon (absent from the shared glyph set) is authored locally as [EntryDrawerGlyphs.Send].
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/modals-dialogs/EntryDrawer) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")
@file:OptIn(ExperimentalMaterial3Api::class)

package io.teslasync.android.modalsdialogs.entrydrawer

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.KVItem
import io.teslasync.android.components.datadisplay.KVList
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TabItem
import io.teslasync.android.components.ui.Tabs
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/** Test tags for the nodes the UI test selects (the web `data-testid` analogues). */
object EntryDrawerTestTags {
    const val SHEET: String = "dlq-entry-drawer"
    const val CLOSE: String = "dlq-entry-drawer-close"
    const val LOADING: String = "dlq-entry-drawer-loading"
    const val EMPTY: String = "dlq-entry-drawer-empty"
    const val SUMMARY: String = "dlq-entry-drawer-summary"
    const val PAYLOAD: String = "dlq-entry-drawer-payload"
    const val COPY: String = "dlq-entry-drawer-copy"
    const val REPLAY: String = "dlq-entry-drawer-replay"
    const val FOOTER_CLOSE: String = "dlq-entry-drawer-footer-close"
}

/**
 * The already-localized drawer microcopy the composable reads from the i18n catalog (P1/S10). Bundled into one
 * carrier so the stateless [EntryDrawerContent] takes plain strings and stays trivially previewable +
 * UI-testable. The two interpolated strings (the title with the entry id, and the binary-body marker with the
 * byte count) are resolved inline at their call sites with their format argument.
 */
data class EntryDrawerStrings(
    val titleFallback: String,
    val close: String,
    val replay: String,
    val copy: String,
    val copied: String,
    val tabInner: String,
    val tabRaw: String,
    val labelId: String,
    val labelArrived: String,
    val labelDlqTopic: String,
    val labelReason: String,
    val labelVin: String,
    val labelSourceTopic: String,
    val labelRedeliveries: String,
    val labelParseError: String,
    val emptyMessage: String,
    val loadingLabel: String,
)

/** Resolves every static [EntryDrawerStrings] entry from the surface-owned i18n catalog keys (P1/S10). */
@Composable
fun rememberEntryDrawerStrings(): EntryDrawerStrings =
    EntryDrawerStrings(
        titleFallback = stringResource(R.string.translation_admin_dlq_drawer_titleFallback),
        close = stringResource(R.string.translation_common_close),
        replay = stringResource(R.string.translation_admin_dlq_drawer_replay),
        copy = stringResource(R.string.translation_common_copyButton_copy),
        copied = stringResource(R.string.translation_common_copyButton_copied),
        tabInner = stringResource(R.string.translation_admin_dlq_drawer_tabs_inner),
        tabRaw = stringResource(R.string.translation_admin_dlq_drawer_tabs_raw),
        labelId = stringResource(R.string.translation_admin_dlq_drawer_id),
        labelArrived = stringResource(R.string.translation_admin_dlq_drawer_arrivedAt),
        labelDlqTopic = stringResource(R.string.translation_admin_dlq_drawer_dlqTopic),
        labelReason = stringResource(R.string.translation_admin_dlq_drawer_reason),
        labelVin = stringResource(R.string.translation_admin_dlq_drawer_vin),
        labelSourceTopic = stringResource(R.string.translation_admin_dlq_drawer_sourceTopic),
        labelRedeliveries = stringResource(R.string.translation_admin_dlq_drawer_redeliveries),
        labelParseError = stringResource(R.string.translation_admin_dlq_drawer_parseError),
        emptyMessage = stringResource(R.string.translation_common_noData),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
    )

/**
 * Stateful entry point — the faithful 1:1 port of the web `EntryDrawer({ open, summary, full, loading,
 * replayEnabled, replayInFlight, onClose, onReplay })`. Records the one-shot PII-safe `view.opened` diagnostic
 * on first composition (P1/S11), projects the props via the pure [EntryDrawerProjection], resolves the localized
 * copy, and renders the body inside a Material 3 [ModalBottomSheet]. Renders nothing when [open] is false (web
 * `if (!open) return null`); the owning view drives [open]/[onClose].
 *
 * @param summary the cached list row, used for the header + summary while the full payload loads (web `summary`).
 * @param full the lazily-loaded full entry with the base64 payload blobs, or null while loading (web `full`).
 * @param loading whether the full-entry fetch is in flight (web `loading`).
 * @param replayEnabled the server's `DLQ_REPLAY_ENABLED` gate; disables Replay when false (web `replayEnabled`).
 * @param replayInFlight whether a replay POST is in flight; disables Replay and shows its spinner (web
 *   `replayInFlight`).
 * @param onClose dismiss handler — scrim tap, swipe, header/footer close (web `onClose`).
 * @param onReplay Replay handler — re-publishes the entry to its source topic (web `onReplay`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun EntryDrawer(
    open: Boolean,
    summary: DlqEntrySummary?,
    full: DlqEntryFull?,
    loading: Boolean,
    replayEnabled: Boolean,
    replayInFlight: Boolean,
    onClose: () -> Unit,
    onReplay: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    if (!open) return

    LaunchedEffect(Unit) { recordEntryDrawerOpened(logger) }

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val strings = rememberEntryDrawerStrings()
    val display = remember(summary, full) { EntryDrawerProjection.project(summary, full) }

    ModalBottomSheet(onDismissRequest = onClose, sheetState = sheetState, modifier = modifier) {
        EntryDrawerContent(
            display = display,
            loading = loading,
            hasFull = full != null,
            replayEnabled = replayEnabled,
            replayInFlight = replayInFlight,
            strings = strings,
            onClose = onClose,
            onReplay = onReplay,
        )
    }
}

/**
 * Stateless renderer + tab-state owner — the unit/UI-test and preview entry point. Owns the ephemeral active
 * payload tab (web `useState('inner')`) and lays out the sticky title/close header, the weighted body (one of
 * the loading / content / empty states), and the always-present sticky footer (Close + Replay). Host it inside a
 * height-bounded container (the [ModalBottomSheet] sheet, or a sized test root) so the body can scroll under the
 * sticky header/footer.
 */
@Composable
fun EntryDrawerContent(
    display: EntryDrawerDisplay?,
    loading: Boolean,
    hasFull: Boolean,
    replayEnabled: Boolean,
    replayInFlight: Boolean,
    strings: EntryDrawerStrings,
    onClose: () -> Unit,
    onReplay: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var activeTab by remember { mutableStateOf(EntryDrawerTab.Inner) }
    val showSpinner = EntryDrawerProjection.showSpinner(loading, hasFull)
    val replayDisabled =
        EntryDrawerProjection.replayDisabled(
            replayEnabled = replayEnabled,
            replayable = display?.replayable == true,
            replayInFlight = replayInFlight,
            loading = loading,
        )
    val title =
        if (display != null) {
            stringResource(R.string.translation_admin_dlq_drawer_title, display.id)
        } else {
            strings.titleFallback
        }

    Column(modifier = modifier.fillMaxWidth().testTag(EntryDrawerTestTags.SHEET)) {
        EntryDrawerHeader(title = title, closeLabel = strings.close, onClose = onClose)
        Box(modifier = Modifier.fillMaxWidth().weight(1f)) {
            when {
                showSpinner ->
                    Box(
                        modifier = Modifier.fillMaxSize().testTag(EntryDrawerTestTags.LOADING),
                        contentAlignment = Alignment.Center,
                    ) {
                        Spinner(accessibleLabel = strings.loadingLabel)
                    }

                display != null ->
                    EntryDrawerBody(
                        display = display,
                        activeTab = activeTab,
                        strings = strings,
                        onSelectTab = { activeTab = it },
                    )

                else ->
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        EmptyState(
                            message = strings.emptyMessage,
                            modifier = Modifier.testTag(EntryDrawerTestTags.EMPTY),
                            icon = TeslaGlyphs.Info,
                        )
                    }
            }
        }
        EntryDrawerFooter(
            strings = strings,
            replayDisabled = replayDisabled,
            replayInFlight = replayInFlight,
            onClose = onClose,
            onReplay = onReplay,
        )
    }
}

/** The sticky title + close header — the web `Drawer` title row (web `aria-label`/title + close button). */
@Composable
private fun EntryDrawerHeader(
    title: String,
    closeLabel: String,
    onClose: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.lg, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SectionTitle(title, modifier = Modifier.weight(1f))
        IconButton(
            imageVector = TeslaGlyphs.Close,
            contentDescription = closeLabel,
            onClick = onClose,
            modifier = Modifier.testTag(EntryDrawerTestTags.CLOSE),
            size = IconSize.Md,
        )
    }
}

/**
 * The scrollable content body — the web drawer body's `space-y-4` stack: the summary [GlassPanel] (a [KVList] of
 * the entry's metadata) over the payload [GlassPanel] (the inner/raw tabs, the copy button, and the payload
 * `<pre>` block). Scrolls vertically within the weighted region so a long summary + payload never clips.
 */
@Composable
private fun EntryDrawerBody(
    display: EntryDrawerDisplay,
    activeTab: EntryDrawerTab,
    strings: EntryDrawerStrings,
    onSelectTab: (EntryDrawerTab) -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Spacing.lg, vertical = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        EntryDrawerSummaryPanel(display = display, strings = strings)
        EntryDrawerPayloadPanel(
            display = display,
            activeTab = activeTab,
            strings = strings,
            onSelectTab = onSelectTab,
        )
    }
}

/** The summary metadata panel — the web first `GlassPanel` hosting the `KVList` of id/arrival/topics/etc. */
@Composable
private fun EntryDrawerSummaryPanel(
    display: EntryDrawerDisplay,
    strings: EntryDrawerStrings,
) {
    val arrivedFormatter =
        remember {
            DateTimeFormatter
                .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
                .withZone(ZoneId.systemDefault())
        }
    val arrived = EntryDrawerProjection.formatArrivedAt(display.arrivedAtRaw, arrivedFormatter)
    GlassPanel(modifier = Modifier.testTag(EntryDrawerTestTags.SUMMARY), padding = PanelPadding.Md) {
        KVList(
            items =
                listOf(
                    KVItem(strings.labelId, display.id),
                    KVItem(strings.labelArrived, arrived),
                    KVItem(strings.labelDlqTopic, display.dlqTopic),
                    KVItem(strings.labelReason, display.reason),
                    KVItem(strings.labelVin, display.vin),
                    KVItem(strings.labelSourceTopic, display.sourceTopic),
                    KVItem(strings.labelRedeliveries, display.redeliveries),
                    KVItem(strings.labelParseError, display.parseError),
                ),
        )
    }
}

/**
 * The payload panel — the web second `GlassPanel`: the inner/raw [Tabs], the end-aligned [CopyButton] for the
 * active tab's content, and the payload `<pre>` block showing the decoded UTF-8 text or the localized binary
 * marker (interpolated with the active tab's byte size).
 */
@Composable
private fun EntryDrawerPayloadPanel(
    display: EntryDrawerDisplay,
    activeTab: EntryDrawerTab,
    strings: EntryDrawerStrings,
    onSelectTab: (EntryDrawerTab) -> Unit,
) {
    val tabs =
        listOf(
            TabItem(EntryDrawerTab.Inner.key, strings.tabInner),
            TabItem(EntryDrawerTab.Raw.key, strings.tabRaw),
        )
    val binaryFallback =
        when (activeTab) {
            EntryDrawerTab.Inner ->
                stringResource(R.string.translation_admin_dlq_drawer_binaryPayload, display.innerPayloadSize)
            EntryDrawerTab.Raw ->
                stringResource(R.string.translation_admin_dlq_drawer_binaryEnvelope, display.rawPayloadSize)
        }
    val bodyText = EntryDrawerProjection.payloadText(activeTab, display, binaryFallback)
    val copyText = EntryDrawerProjection.copyText(activeTab, display)

    GlassPanel(padding = PanelPadding.Md) {
        Tabs(
            tabs = tabs,
            selectedKey = activeTab.key,
            onSelect = { onSelectTab(EntryDrawerTab.fromKey(it)) },
        )
        Spacer(Modifier.height(Spacing.md))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            CopyButton(
                text = copyText,
                copyLabel = strings.copy,
                copiedLabel = strings.copied,
                modifier = Modifier.testTag(EntryDrawerTestTags.COPY),
            )
        }
        Spacer(Modifier.height(Spacing.sm))
        PayloadBlock(text = bodyText)
    }
}

/**
 * The payload `<pre>` — a rounded, `outline`-bordered, `surfaceVariant`-filled block that scrolls vertically
 * (capped at [PAYLOAD_MAX_HEIGHT], the web `max-h-80`) and horizontally (long lines never wrap), hosting a
 * monospaced [CodeText] of the decoded payload or the binary marker.
 */
@Composable
private fun PayloadBlock(text: String) {
    val shape = RoundedCornerShape(Radius.md)
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(max = PAYLOAD_MAX_HEIGHT)
                .clip(shape)
                .border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline), shape)
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .verticalScroll(rememberScrollState())
                .testTag(EntryDrawerTestTags.PAYLOAD),
    ) {
        Box(modifier = Modifier.horizontalScroll(rememberScrollState()).padding(Spacing.md)) {
            CodeText(text = text)
        }
    }
}

/**
 * The always-present sticky footer — the web `Drawer` footer: end-aligned Close + Replay actions. Replay
 * disables per [replayDisabled] (server gate / non-replayable entry / in-flight / loading) and shows its
 * spinner while [replayInFlight], carrying the locally-authored paper-plane [EntryDrawerGlyphs.Send] (web
 * `<Send>`).
 */
@Composable
private fun EntryDrawerFooter(
    strings: EntryDrawerStrings,
    replayDisabled: Boolean,
    replayInFlight: Boolean,
    onClose: () -> Unit,
    onReplay: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(Spacing.lg),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, alignment = Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = strings.close,
            onClick = onClose,
            modifier = Modifier.testTag(EntryDrawerTestTags.FOOTER_CLOSE),
            variant = ButtonVariant.Secondary,
        )
        Button(
            label = strings.replay,
            onClick = onReplay,
            modifier = Modifier.testTag(EntryDrawerTestTags.REPLAY),
            variant = ButtonVariant.Primary,
            enabled = !replayDisabled,
            loading = replayInFlight,
            leadingIcon = EntryDrawerGlyphs.Send,
        )
    }
}

// ── Local glyph — the web `<Send>` (lucide). Authored as a 24×24 stroked vector because the shared glyph set
// carries no Send icon (mirrors NotificationStatsWidget's local Send). ──────────────────────────────────────

private object EntryDrawerGlyphs {
    /** Paper-plane "send" glyph (lucide `send`) — the Replay action icon. */
    val Send: ImageVector =
        entryDrawerStroked("EntryDrawerSend") {
            moveTo(22f, 2f)
            lineTo(11f, 13f)
            moveTo(22f, 2f)
            lineTo(15f, 22f)
            lineTo(11f, 13f)
            lineTo(2f, 9f)
            close()
        }
}

private fun entryDrawerStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private val PAYLOAD_MAX_HEIGHT = 320.dp

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────

private val previewStrings =
    EntryDrawerStrings(
        titleFallback = "DLQ entry",
        close = "Close",
        replay = "Replay",
        copy = "Copy",
        copied = "Copied",
        tabInner = "Inner payload",
        tabRaw = "Raw envelope",
        labelId = "ID",
        labelArrived = "Arrived",
        labelDlqTopic = "DLQ topic",
        labelReason = "Reason",
        labelVin = "VIN",
        labelSourceTopic = "Source topic",
        labelRedeliveries = "Redeliveries",
        labelParseError = "Parse error",
        emptyMessage = "No data available",
        loadingLabel = "Loading",
    )

private val previewDisplay =
    EntryDrawerDisplay(
        id = "4821",
        arrivedAtRaw = "2024-06-01T12:34:56Z",
        dlqTopic = "telemetry.dlq.v1",
        reason = "codec: unknown enum value",
        vin = "5YJ3E1EA7KF000000",
        sourceTopic = "telemetry/5YJ3.../v/Soc",
        redeliveries = "3",
        parseError = "\u2014",
        innerText = "{\n  \"field\": \"Soc\",\n  \"value\": 82\n}",
        rawText = "",
        innerPayloadB64 = "eyJmaWVsZCI6IlNvYyJ9",
        rawPayloadB64 = "AAECAwQF",
        innerPayloadSize = 42,
        rawPayloadSize = 1536,
        replayable = true,
    )

@Preview(name = "Content — summary + inner payload", showBackground = true, widthDp = 400, heightDp = 720)
@Composable
private fun EntryDrawerContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EntryDrawerContent(
            display = previewDisplay,
            loading = false,
            hasFull = true,
            replayEnabled = true,
            replayInFlight = false,
            strings = previewStrings,
            onClose = {},
            onReplay = {},
        )
    }
}

@Preview(name = "Loading — spinner, Replay disabled", showBackground = true, widthDp = 400, heightDp = 720)
@Composable
private fun EntryDrawerLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EntryDrawerContent(
            display = previewDisplay,
            loading = true,
            hasFull = false,
            replayEnabled = true,
            replayInFlight = false,
            strings = previewStrings,
            onClose = {},
            onReplay = {},
        )
    }
}

@Preview(name = "Empty — no head selected", showBackground = true, widthDp = 400, heightDp = 720)
@Composable
private fun EntryDrawerEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        EntryDrawerContent(
            display = null,
            loading = false,
            hasFull = false,
            replayEnabled = true,
            replayInFlight = false,
            strings = previewStrings,
            onClose = {},
            onReplay = {},
        )
    }
}
