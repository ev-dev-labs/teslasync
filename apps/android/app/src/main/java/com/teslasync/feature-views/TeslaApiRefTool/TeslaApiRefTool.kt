// The native Jetpack Compose + Material 3 TeslaApiRefTool feature view — a parity port of
// web/src/features/admin/components/devtools/tools/TeslaApiRefTool.tsx. The web component wraps a
// `ToolCard` (BookOpen icon, cyan accent) around a search `Input` and a `DataTable` over the static
// TESLA_ENDPOINTS reference (method / path / description), filtering the rows live by a case-insensitive
// substring match. Its only hook is `useTranslation`; the data is a compile-time constant.
//
// Because the surface binds no data feed, there is no loading / error / stale / offline lifecycle to
// render — modelling those would invent behaviour the spec does not have (drift), exactly as the
// sibling ToolCard and ReferenceLinksSection surfaces document. The genuine states are the two the web
// source actually has: the populated table (content), and the search-yields-nothing empty state (web
// `DataTable` `emptyMessage`, here the shared `emptyText`). Both are always rendered — the panel is
// never a hidden or blank surface. All derivation lives in the pure [TeslaApiRefProjection] /
// [TeslaApiRefPaging]; this file is a thin render layer.
//
// The card is composed with the stateless `ToolCardContent` (not the stateful `ToolCard`) so that this
// surface emits exactly one `view.opened` diagnostic — its own slug `TeslaApiRefTool` — mirroring the
// web, where `ToolCard` is a presentational child that emits no telemetry of its own.
//
// Glyph: the web lucide `BookOpen` (used for BOTH the card icon and the search input's leading icon) is
// absent from every shared glyph catalog, and the surface's allowed-files scope forbids editing those
// shared files, so it is authored locally below as a 24×24 stroked vector recolored at render by the
// `Icon` tint — the same approach the sibling ReferenceLinksSection surface takes.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/feature-views/TeslaApiRefTool) cannot form a valid Kotlin package identifier;
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.teslaapiref

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.toolcard.ToolCardContent
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// Web `color="cyan"` accent passed to the ToolCard container.
private const val TOOL_CARD_ACCENT = "cyan"

// Relative column widths: the method badge is narrow, the path is the widest, the description is medium.
private const val METHOD_WEIGHT = 1f
private const val PATH_WEIGHT = 3f
private const val DESC_WEIGHT = 2f

// Locally authored BookOpen glyph geometry (24×24 viewport, 2 dp stroke), recolored by the Icon tint.
private const val ICON_VIEWPORT = 24f
private const val ICON_STROKE_WIDTH = 2f

/**
 * Stateful entry point — the faithful port of the web `TeslaApiRefTool()`. Spins up the
 * [TeslaApiRefToolViewModel] (which carries only the `view.opened` diagnostic — this surface binds no
 * feed), records that diagnostic once, owns the search query state (web `useState('')`), resolves the
 * localized strings, and renders the card. A host may inject a [logger] and a unique [instanceKey].
 *
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param instanceKey distinguishes multiple instances' ViewModels; defaults to the surface slug.
 */
@Composable
fun TeslaApiRefTool(
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = TeslaApiRefToolRegistration.SLUG,
) {
    val viewModel: TeslaApiRefToolViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { TeslaApiRefToolViewModel(logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    var search by rememberSaveable { mutableStateOf("") }
    TeslaApiRefToolContent(
        strings = rememberTeslaApiRefStrings(),
        search = search,
        onSearchChange = { search = it },
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Renders the web composition: a
 * [ToolCardContent] (BookOpen + cyan + title/description) wrapping the search [Input] (web prompt →
 * Material floating label, with the BookOpen leading icon) above the filtered, paginated endpoint table.
 * Hoisting [search] + [onSearchChange] keeps the surface driveable from tests with no ViewModel.
 */
@Composable
fun TeslaApiRefToolContent(
    strings: TeslaApiRefStrings,
    search: String,
    onSearchChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    endpoints: List<TeslaApiEndpoint> = TeslaApiReference.endpoints,
) {
    ToolCardContent(
        icon = TeslaApiRefGlyphs.BookOpen,
        color = TOOL_CARD_ACCENT,
        title = strings.title,
        description = strings.description,
        modifier = modifier,
    ) {
        Input(
            value = search,
            onValueChange = onSearchChange,
            label = strings.searchHint,
            leadingIcon = TeslaApiRefGlyphs.BookOpen,
        )
        Spacer(Modifier.height(Spacing.md))
        EndpointTable(strings = strings, endpoints = endpoints, search = search)
    }
}

/**
 * The filtered, paginated reference table. Projects the endpoints for the current [search] via the pure
 * [TeslaApiRefProjection], slices the current page via [TeslaApiRefPaging] (web `defaultPageSize` 25),
 * and renders the shared [DataTable]. The page resets to 1 whenever the filtered row count changes (web
 * `useEffect(() => setPage(1), [data.length])`). The `Pagination` footer is shown only when there are
 * rows (web `paginationEnabled && data.length > 0`); when the filter matches nothing the table renders
 * the friendly empty message instead of a blank box.
 */
@Composable
private fun EndpointTable(
    strings: TeslaApiRefStrings,
    endpoints: List<TeslaApiEndpoint>,
    search: String,
) {
    val rows =
        remember(endpoints, search, strings.copyLabel) {
            TeslaApiRefProjection.rows(endpoints, search, strings.copyLabel)
        }
    val total = rows.size
    var page by remember(total) { mutableIntStateOf(1) }
    val visible = TeslaApiRefPaging.page(rows, page, TeslaApiRefToolRegistration.PAGE_SIZE)
    val columns = teslaApiRefColumns(strings)

    val firstLabel = stringResource(R.string.translation_pagination_first)
    val previousLabel = stringResource(R.string.translation_pagination_previous)
    val nextLabel = stringResource(R.string.translation_pagination_next)
    val lastLabel = stringResource(R.string.translation_pagination_last)
    val context = LocalContext.current

    val paginationFooter: (@Composable () -> Unit)? =
        if (rows.isEmpty()) {
            null
        } else {
            {
                Pagination(
                    page = page,
                    pageSize = TeslaApiRefToolRegistration.PAGE_SIZE,
                    total = total,
                    onPageChange = { page = it },
                    firstLabel = firstLabel,
                    previousLabel = previousLabel,
                    nextLabel = nextLabel,
                    lastLabel = lastLabel,
                    showingText = { start, end, count ->
                        context.getString(R.string.translation_pagination_showing, start, end, count)
                    },
                )
            }
        }

    DataTable(
        columns = columns,
        rows = visible,
        keyOf = { it.endpoint.path },
        emptyText = strings.emptyMessage,
        footer = paginationFooter,
    )
}

/**
 * Builds the three web columns — Method (a status badge), Path (monospace path + an icon-only copy
 * button), and Endpoint Desc (muted caption). Headers arrive already-localized, so this helper holds no
 * English literal; the cell renderers are the only place the row data reaches the UI.
 */
private fun teslaApiRefColumns(strings: TeslaApiRefStrings): List<TableColumn<TeslaApiRow>> =
    listOf(
        TableColumn(key = "method", header = strings.methodHeader, weight = METHOD_WEIGHT) { row ->
            Badge(text = row.endpoint.method, variant = badgeVariant(row.accent))
        },
        TableColumn(key = "path", header = strings.pathHeader, weight = PATH_WEIGHT) { row ->
            PathCell(row = row, copiedLabel = strings.copiedLabel)
        },
        TableColumn(key = "desc", header = strings.descHeader, weight = DESC_WEIGHT) { row ->
            Caption(row.endpoint.desc)
        },
    )

/**
 * The Path cell — the web `<div className="flex items-center gap-1"><code>{path}</code><CopyButton/>`.
 * The monospace path takes the available width; the trailing icon-only [CopyButton] copies the path and
 * exposes the per-row [TeslaApiRow.copyActionLabel] (e.g. "Copy /api/1/vehicles") as its TalkBack name,
 * so every row's copy affordance is individually distinguishable.
 */
@Composable
private fun PathCell(
    row: TeslaApiRow,
    copiedLabel: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        CodeText(text = row.endpoint.path, modifier = Modifier.weight(1f))
        CopyButton(
            text = row.endpoint.path,
            copyLabel = row.copyActionLabel,
            copiedLabel = copiedLabel,
            iconOnly = true,
        )
    }
}

/** Maps the pure [MethodAccent] onto the shared [BadgeVariant] (web `'info'` / `'warning'`). */
private fun badgeVariant(accent: MethodAccent): BadgeVariant =
    when (accent) {
        MethodAccent.Info -> BadgeVariant.Info
        MethodAccent.Warning -> BadgeVariant.Warning
    }

/**
 * Resolves the localized [TeslaApiRefStrings] from the i18n facade (P1/S10). `Method` / `Path` and the
 * shared-component keys (`Copy`, `Copied`, `common.noData`) are present in the catalog and read via their
 * compile-time `R.string` ids; the four keys absent today (see the model header) are read by name via
 * [resolveOptional] so the localized value renders once the catalog defines them, falling back to the
 * documented [TeslaApiRefDefaults] (which equal the exact text the web renders now). Remembered against
 * the resolved values so a locale change re-projects the surface.
 */
@Composable
private fun rememberTeslaApiRefStrings(): TeslaApiRefStrings {
    val context = LocalContext.current
    val methodHeader = stringResource(R.string.translation_Method)
    val pathHeader = stringResource(R.string.translation_Path)
    val copyLabel = stringResource(R.string.translation_Copy)
    val copiedLabel = stringResource(R.string.translation_Copied)
    val emptyMessage = stringResource(R.string.translation_common_noData)
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    val title = resolveOptional(lookup, TeslaApiRefKeys.TITLE, TeslaApiRefDefaults.TITLE)
    val description = resolveOptional(lookup, TeslaApiRefKeys.DESCRIPTION, TeslaApiRefDefaults.DESCRIPTION)
    val searchHint =
        resolveOptional(lookup, TeslaApiRefKeys.SEARCH_HINT, TeslaApiRefDefaults.SEARCH_HINT)
    val descHeader = resolveOptional(lookup, TeslaApiRefKeys.DESC_HEADER, TeslaApiRefDefaults.DESC_HEADER)
    return remember(
        title,
        description,
        searchHint,
        methodHeader,
        pathHeader,
        descHeader,
        copyLabel,
        copiedLabel,
        emptyMessage,
    ) {
        TeslaApiRefStrings(
            title = title,
            description = description,
            searchHint = searchHint,
            methodHeader = methodHeader,
            pathHeader = pathHeader,
            descHeader = descHeader,
            copyLabel = copyLabel,
            copiedLabel = copiedLabel,
            emptyMessage = emptyMessage,
        )
    }
}

/**
 * Optional by-name read from the Android string catalog — the production seam [resolveOptional] uses to
 * reproduce web `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a
 * compile-time `R.string` reference cannot express "resolve if present, else fall back"), so
 * `DiscouragedApi` is suppressed. Release builds keep resource names (resource shrinking is off), so the
 * by-name lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

/**
 * Locally authored line-style glyph for the web lucide `BookOpen` icon (absent from the shared catalogs),
 * drawn as a 24×24 stroked [ImageVector] and recolored at render time by the [Icon] tint.
 */
private object TeslaApiRefGlyphs {
    /** Open-book glyph (lucide `book-open`) — the card icon and the search field's leading icon. */
    val BookOpen: ImageVector =
        teslaApiRefStroked("TeslaApiRefBookOpen") {
            moveTo(12f, 7f)
            lineTo(12f, 20f)
            moveTo(12f, 7f)
            curveTo(12f, 5.3f, 9f, 4.5f, 4f, 4.5f)
            lineTo(4f, 17f)
            curveTo(8.5f, 17f, 11f, 17.8f, 12f, 19f)
            moveTo(12f, 7f)
            curveTo(12f, 5.3f, 15f, 4.5f, 20f, 4.5f)
            lineTo(20f, 17f)
            curveTo(15.5f, 17f, 13f, 17.8f, 12f, 19f)
        }
}

private fun teslaApiRefStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = ICON_VIEWPORT.dp,
            defaultHeight = ICON_VIEWPORT.dp,
            viewportWidth = ICON_VIEWPORT,
            viewportHeight = ICON_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = ICON_STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()
