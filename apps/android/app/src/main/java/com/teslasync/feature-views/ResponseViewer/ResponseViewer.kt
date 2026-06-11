// The native Jetpack Compose + Material 3 ResponseViewer feature view — a parity port of
// web/src/features/admin/components/ResponseViewer.tsx. It reproduces the web composition: a `GlassPanel`
// "Response" section that renders one of three branches the web source defines — a loading skeleton, a
// friendly empty state ("Send a request to see the response"), or a resolved response (a tinted status bar,
// the pretty-printed body in a scrollable monospace block, and a collapsible "Response Headers" toggle) —
// followed by a "Recent Requests" history strip that hides when empty. The exported web `SnippetPanel` is
// reproduced as a public composable: a collapsible "Code Snippet" section with a cURL/JavaScript/Python/Go
// selector, a copy affordance, and the generated snippet.
//
// All derivations flow through the pure [ResponseViewerProjection] / [ResponseHistoryProjection] /
// [SnippetModel]; the composables are a thin render layer. The surface binds NO data hook (its only web hook
// is `useTranslation`), so — like the sibling ResultPanel — there is no loading-from-network / stale /
// offline lifecycle: `loading` is a caller-supplied prop and the three response branches are the complete
// state set the web source defines. Every string resolves through the i18n boundary (the six `playground.*`
// keys plus the shared copy-button keys), every interactive element carries an accessibility label, and the
// status tint maps onto the shared status palette (the sanctioned native expression of the web color wash).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ResponseViewer) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.responseviewer

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Accordion
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TabItem
import io.teslasync.android.components.ui.Tabs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// Web `<Skeleton className="h-48 …">`: the loading block stands forty-eight rem-units (192 dp) tall.
private val RESPONSE_SKELETON_HEIGHT: Dp = 192.dp

// Web `<pre className="max-h-[500px] overflow-auto">`: the body scrolls past five hundred dp of content.
private val BODY_MAX_HEIGHT: Dp = 500.dp

// Web `max-h-40 overflow-y-auto`: the header list scrolls past forty rem-units (160 dp).
private val HEADERS_MAX_HEIGHT: Dp = 160.dp

// Web `max-w-[120px] truncate`: the history chip's path is capped and ellipsized.
private val HISTORY_PATH_MAX_WIDTH: Dp = 120.dp

private val HAIRLINE: Dp = 1.dp

// Web status bar `bg-{tone}-500/10 border-{tone}-500/20`: a ten-percent wash behind a twenty-percent border.
private const val STATUS_WASH_ALPHA: Float = 0.10f
private const val STATUS_BORDER_ALPHA: Float = 0.20f

/**
 * Stateful entry point. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11), then renders the
 * surface for the given inputs. Mirrors the web `ResponseViewer` props: the optional [response], the
 * [loading] flag, the recent-request [history], and the [onReplay] callback fired when a history chip is
 * tapped. The surface performs no HTTP (ADR-002) — its data is entirely caller-supplied.
 *
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ResponseViewer(
    response: ApiResponse?,
    loading: Boolean,
    history: List<HistoryEntry>,
    onReplay: (HistoryEntry) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ResponseViewerDiagnostics.recordViewOpened(logger) }
    ResponseViewerContent(
        response = response,
        loading = loading,
        history = history,
        modifier = modifier,
        onReplay = onReplay,
    )
}

/**
 * Stateless renderer for every branch — the unit/UI-test and preview entry point. Reproduces the web
 * composition: the "Response" [GlassPanel] (loading / empty / resolved) above the "Recent Requests" history
 * strip, which is omitted entirely when there is no history (web `{history.length === 0 ? null : …}`).
 */
@Composable
fun ResponseViewerContent(
    response: ApiResponse?,
    loading: Boolean,
    history: List<HistoryEntry>,
    modifier: Modifier = Modifier,
    onReplay: (HistoryEntry) -> Unit = {},
) {
    val display = remember(response, loading) { ResponseViewerProjection.project(response, loading) }
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        ResponsePanel(display)
        if (ResponseHistoryProjection.hasHistory(history)) {
            RequestHistory(entries = history, onReplay = onReplay)
        }
    }
}

/** The "Response" panel — the localized heading above the active state branch. */
@Composable
private fun ResponsePanel(display: ResponseViewerDisplay) {
    GlassPanel(padding = PanelPadding.Md) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Caption(
                text = stringResource(R.string.translation_playground_response),
                modifier = Modifier.semantics { heading() },
            )
            when (display.mode) {
                ResponseViewerMode.Loading -> ResponseLoading()
                ResponseViewerMode.Empty ->
                    EmptyState(message = stringResource(R.string.translation_playground_noResponse))
                ResponseViewerMode.Content -> display.content?.let { ResponseBody(it) }
            }
        }
    }
}

/** Loading branch — the web `<Skeleton className="h-48 rounded-lg" />`, labelled for TalkBack. */
@Composable
private fun ResponseLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Skeleton(
        modifier = Modifier.semantics { contentDescription = label },
        height = RESPONSE_SKELETON_HEIGHT,
        rounded = true,
    )
}

/** Resolved-response branch — the status bar, the body block, and the headers toggle, faded in (web `FadeIn`). */
@Composable
private fun ResponseBody(content: ResponseContent) {
    FadeIn {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            StatusBar(content)
            ResponseCodeBlock(content.body)
            if (content.hasHeaders) {
                ResponseHeaders(headers = content.headers, count = content.headerCount)
            }
        }
    }
}

/** The web status bar: the status line on a tone wash + border, the duration/size meta to the right. */
@Composable
private fun StatusBar(content: ResponseContent) {
    val tone = statusColor(content.tone)
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = tone.copy(alpha = STATUS_WASH_ALPHA),
        contentColor = tone,
        border = BorderStroke(HAIRLINE, tone.copy(alpha = STATUS_BORDER_ALPHA)),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = content.statusLine,
                style =
                    MaterialTheme.typography.bodyMedium.copy(
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                    ),
                color = tone,
            )
            Caption(content.meta)
        }
    }
}

/**
 * Web `<pre>` body block: the rendered body on an overlay surface, monospaced, scrollable past
 * [BODY_MAX_HEIGHT]. The whole block is collapsed to a single accessible node so TalkBack reads the payload
 * as one utterance instead of line-by-line. Reused by [SnippetPanel] for the generated snippet.
 */
@Composable
private fun ResponseCodeBlock(text: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.small,
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        CodeText(
            text = text,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(max = BODY_MAX_HEIGHT)
                    .verticalScroll(rememberScrollState())
                    .padding(Spacing.md)
                    .clearAndSetSemantics { contentDescription = text },
        )
    }
}

/** The collapsible "Response Headers (N)" toggle — the web `ResponseHeaders` (hidden by the caller when empty). */
@Composable
private fun ResponseHeaders(
    headers: List<Pair<String, String>>,
    count: Int,
) {
    val title = "${stringResource(R.string.translation_playground_responseHeaders)} ($count)"
    Accordion(title = title) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(max = HEADERS_MAX_HEIGHT)
                    .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            headers.forEach { (key, value) ->
                CodeText(text = "$key: $value", modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

/** The "Recent Requests" history strip — a horizontally scrollable row of replayable request chips. */
@Composable
private fun RequestHistory(
    entries: List<HistoryEntry>,
    onReplay: (HistoryEntry) -> Unit,
) {
    val rows = remember(entries) { ResponseHistoryProjection.rows(entries) }
    GlassPanel(padding = PanelPadding.Sm) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Caption(
                text = stringResource(R.string.translation_playground_history),
                modifier = Modifier.semantics { heading() },
            )
            Row(
                modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                rows.forEachIndexed { index, row ->
                    HistoryChip(row = row, onClick = { onReplay(entries[index]) })
                }
            }
        }
    }
}

/** One replayable history chip: the method badge, the (truncated) path, the toned status, and the duration. */
@Composable
private fun HistoryChip(
    row: HistoryRow,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = row.accessibleLabel },
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        border = BorderStroke(HAIRLINE, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Badge(text = row.method, variant = methodVariant(row.methodTone))
            Text(
                text = row.path,
                style = MaterialTheme.typography.labelMedium.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = HISTORY_PATH_MAX_WIDTH),
            )
            Text(
                text = row.status.toString(),
                style =
                    MaterialTheme.typography.labelMedium.copy(
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                    ),
                color = statusColor(row.statusTone),
            )
            Caption(row.durationText)
        }
    }
}

/**
 * The exported web `SnippetPanel`, reproduced as a public composable. A collapsible "Code Snippet" section
 * holding the cURL/JavaScript/Python/Go selector ([Tabs]), a copy affordance, and the generated snippet for
 * the active [method], [url], and optional [body]. The selected format survives configuration change.
 */
@Composable
fun SnippetPanel(
    method: String,
    url: String,
    modifier: Modifier = Modifier,
    body: String? = null,
) {
    var formatKey by rememberSaveable { mutableStateOf(SnippetFormat.Curl.key) }
    val format = SnippetFormat.fromKey(formatKey)
    val snippet = remember(method, url, format, body) { SnippetModel.generate(method, url, format, body) }
    Accordion(title = stringResource(R.string.translation_playground_codeSnippet), modifier = modifier) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Tabs(
                tabs = SnippetModel.formats.map { TabItem(key = it.key, label = it.label) },
                selectedKey = formatKey,
                onSelect = { formatKey = it },
            )
            CopyButton(
                text = snippet,
                copyLabel = stringResource(R.string.translation_playground_copy),
                copiedLabel = stringResource(R.string.translation_playground_copied),
                modifier = Modifier.align(Alignment.End),
            )
            ResponseCodeBlock(snippet)
        }
    }
}

/** Maps a status tone onto the shared status palette (web `text-{green|amber|red}-400`). */
@Composable
private fun statusColor(tone: ResponseStatusTone): Color =
    when (tone) {
        ResponseStatusTone.Success -> TeslaTokens.status.success
        ResponseStatusTone.Redirect -> TeslaTokens.status.warning
        ResponseStatusTone.Error -> TeslaTokens.status.danger
    }

/** Maps a method tone onto the shared [BadgeVariant] (web `GET → green, POST → blue, DELETE → red, else amber`). */
private fun methodVariant(tone: HttpMethodTone): BadgeVariant =
    when (tone) {
        HttpMethodTone.Get -> BadgeVariant.Success
        HttpMethodTone.Post -> BadgeVariant.Info
        HttpMethodTone.Delete -> BadgeVariant.Danger
        HttpMethodTone.Other -> BadgeVariant.Warning
    }

// ── Previews — one per rendered state (loading / empty / content / error status / history / snippet) ────────

private val previewResponse =
    ApiResponse(
        status = 200,
        statusText = "OK",
        headers = linkedMapOf("content-type" to "application/json", "x-request-id" to "req_abc123"),
        body =
            buildJsonObject {
                put("id", 7)
                put("name", "Model 3")
            },
        bodyText = "{\"id\":7,\"name\":\"Model 3\"}",
        durationMs = 128L,
        sizeBytes = 1536L,
        contentType = "application/json",
    )

private val previewHistory =
    listOf(
        HistoryEntry(method = "GET", path = "/api/v1/vehicles", status = 200, durationMs = 128L, timestamp = "t1"),
        HistoryEntry(method = "POST", path = "/api/v1/drives", status = 201, durationMs = 240L, timestamp = "t2"),
        HistoryEntry(method = "DELETE", path = "/api/v1/alerts/3", status = 404, durationMs = 88L, timestamp = "t3"),
    )

@Preview(name = "ResponseViewer · content", showBackground = true)
@Composable
private fun ResponseViewerContentPreview() {
    TeslaSyncTheme {
        ResponseViewerContent(response = previewResponse, loading = false, history = previewHistory)
    }
}

@Preview(name = "ResponseViewer · loading", showBackground = true)
@Composable
private fun ResponseViewerLoadingPreview() {
    TeslaSyncTheme {
        ResponseViewerContent(response = null, loading = true, history = emptyList())
    }
}

@Preview(name = "ResponseViewer · empty", showBackground = true)
@Composable
private fun ResponseViewerEmptyPreview() {
    TeslaSyncTheme {
        ResponseViewerContent(response = null, loading = false, history = emptyList())
    }
}

@Preview(name = "ResponseViewer · error status", showBackground = true)
@Composable
private fun ResponseViewerErrorStatusPreview() {
    TeslaSyncTheme {
        ResponseViewerContent(
            response =
                previewResponse.copy(
                    status = 404,
                    statusText = "Not Found",
                    bodyText = "{\"error\":\"not found\"}",
                ),
            loading = false,
            history = previewHistory,
        )
    }
}

@Preview(name = "SnippetPanel · POST", showBackground = true)
@Composable
private fun SnippetPanelPreview() {
    TeslaSyncTheme {
        SnippetPanel(method = "POST", url = "https://app.teslasync.io/api/v1/drives", body = "{\"vehicle_id\":1}")
    }
}
