// The native Jetpack Compose + Material 3 Infrastructure dev-tools surface — a parity port of
// web/src/features/admin/components/devtools/InfrastructureSection.tsx and its composed BackendTool /
// MqttTestTool / ToolCard / ResultPanel. The web surface is a responsive grid of five on-demand tools;
// on a phone the idiomatic layout is a single vertical column of cards (the web `lg:grid-cols-2` collapses
// to one column on small screens). Each card reproduces the web tool exactly: a colored icon box, title +
// description, a Run / Send Test control with an in-flight spinner, a Success/Failed status badge (backend
// tools only, mirroring the web), and a result panel that shows the pretty-printed JSON payload (with a
// copy control), an error message, or the idle "no result yet" hint — so no surface is ever blank.
//
// All data flows through the shared [InfrastructureSectionViewModel] (P1/S8); the view performs NO HTTP.
// Every string resolves through the i18n facade (P1/S10) via [infraText] — for keys the shared catalog
// defines this returns the localized resource, and for the web's natural-key fallbacks (e.g. "Db Stats",
// "Env Check", "Send Test", the "* Desc" descriptions) it falls back to the key text, reproducing
// react-i18next's behaviour 1:1 so the on-screen text matches the web verbatim. Icons are local
// lucide-style vector glyphs (the app uses no Material-icons artifact). Every interactive element carries
// a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/InfrastructureSection) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.infrastructure

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * Stateful entry point. Binds the `/dev-tools/{endpoint}` command seam via [source] into an
 * [InfrastructureSectionViewModel], records the one-shot `view.opened` diagnostic, collects the live
 * per-tool run state, and renders the surface. A dev-tools host supplies [source] (typically
 * `api.asInfrastructureSectionSource()`); [logger] defaults to the process logger from the data container.
 */
@Composable
fun InfrastructureSection(
    source: InfrastructureSectionSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: InfrastructureSectionViewModel =
        viewModel(
            key = InfrastructureSectionRegistration.ID,
            factory = InfrastructureSectionViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    InfrastructureSectionContent(state = state, onRun = viewModel::run, modifier = modifier)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Renders the five tool cards
 * (web grid order) as a single vertical column; each card draws its own idle / running / succeeded /
 * failed / offline state. [onRun] is invoked with the tool plus the MQTT topic + message (empty for the
 * bodyless tools).
 */
@Composable
fun InfrastructureSectionContent(
    state: InfrastructureSectionState,
    onRun: (InfraTool, String, String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        InfraTool.entries.forEach { tool ->
            InfraToolCard(tool = tool, run = state.runOf(tool), onRun = onRun)
        }
    }
}

// ─── tool card ─────────────────────────────────────────────────────────────

@Composable
private fun InfraToolCard(
    tool: InfraTool,
    run: ToolRun,
    onRun: (InfraTool, String, String) -> Unit,
) {
    ToolCardShell(tool) {
        if (tool.needsInput) {
            MqttToolBody(tool = tool, run = run, onRun = onRun)
        } else {
            BackendToolBody(tool = tool, run = run, onRun = onRun)
        }
    }
}

/**
 * The web `ToolCard`: a [GlassPanel] with a header row (colored [IconBox] + title + description) above the
 * tool's [body]. The icon inherits the tone color from the [IconBox] content color.
 */
@Composable
private fun ToolCardShell(
    tool: InfraTool,
    body: @Composable () -> Unit,
) {
    GlassPanel(padding = PanelPadding.Lg) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            IconBox(tone = tool.tone.toIconBoxTone()) {
                Icon(imageVector = tool.glyph(), contentDescription = null, size = IconSize.Lg)
            }
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PanelTitle(infraText(tool.titleKey))
                Caption(infraText(tool.descKey))
            }
        }
        Spacer(Modifier.height(Spacing.md))
        body()
    }
}

/** The web `BackendTool` body: a Run button, a post-run Success/Failed badge, and the result panel. */
@Composable
private fun BackendToolBody(
    tool: InfraTool,
    run: ToolRun,
    onRun: (InfraTool, String, String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RunButton(labelKey = InfraKeys.RUN, run = run, onClick = { onRun(tool, "", "") })
            if (run.isSucceeded || run.isFailed) {
                StatusBadge(run)
            }
            if (run.isOffline) {
                OfflineChip()
            }
        }
        ResultPanel(tool = tool, run = run)
    }
}

/** The web `MqttTestTool` body: topic + message fields, a Send Test button, and the result panel. */
@Composable
private fun MqttToolBody(
    tool: InfraTool,
    run: ToolRun,
    onRun: (InfraTool, String, String) -> Unit,
) {
    var topic by rememberSaveable { mutableStateOf("") }
    var message by rememberSaveable { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Input(
            value = topic,
            onValueChange = { topic = it },
            label = infraText(InfraKeys.TOPIC),
            leadingIcon = InfraGlyphs.Radio,
        )
        Textarea(
            value = message,
            onValueChange = { message = it },
            label = infraText(InfraKeys.MESSAGE),
            minLines = 3,
            maxLines = 6,
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RunButton(labelKey = InfraKeys.SEND_TEST, run = run, onClick = { onRun(tool, topic, message) })
            if (run.isOffline) {
                OfflineChip()
            }
        }
        ResultPanel(tool = tool, run = run)
    }
}

@Composable
private fun RunButton(
    labelKey: String,
    run: ToolRun,
    onClick: () -> Unit,
) {
    Button(
        label = infraText(labelKey),
        onClick = onClick,
        variant = ButtonVariant.Primary,
        size = ButtonSize.Sm,
        loading = run.isRunning,
        leadingIcon = InfraGlyphs.Play,
    )
}

/** Post-run status chip — the web `Badge variant={error ? 'danger' : 'success'} dot`. */
@Composable
private fun StatusBadge(run: ToolRun) {
    val ok = run.isSucceeded
    Badge(
        text = infraText(if (ok) InfraKeys.SUCCESS else InfraKeys.FAILED),
        variant = if (ok) BadgeVariant.Success else BadgeVariant.Danger,
        dot = true,
    )
}

/** Connectivity affordance shown when the last run failed offline — the surface stays usable to retry. */
@Composable
private fun OfflineChip() {
    Badge(text = infraText(InfraKeys.OFFLINE), variant = BadgeVariant.Warning, dot = true)
}

// ─── result panel ──────────────────────────────────────────────────────────

/**
 * The web `ResultPanel`: a tinted region showing the pretty-printed JSON payload with a copy control on
 * success, the error message on failure, or the idle "no result yet" hint otherwise (so the region is
 * never a blank box). The wash color reflects the outcome (success / error / idle), mirroring the web
 * `bg-neon-green/5` / `bg-neon-red/5` / neutral.
 */
@Composable
private fun ResultPanel(
    tool: InfraTool,
    run: ToolRun,
) {
    val resultJson = run.result?.let { InfrastructureSectionProjection.prettyJson(it) }
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(resultBackground(run), RoundedCornerShape(Radius.md))
                .padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Caption(infraText(tool.titleKey))
            if (resultJson != null) {
                CopyButton(
                    text = resultJson,
                    copyLabel = infraText(InfraKeys.COPY),
                    copiedLabel = infraText(InfraKeys.COPIED),
                    iconOnly = true,
                )
            }
        }
        when {
            run.isFailed -> ErrorText(failureMessage(run))
            resultJson != null -> JsonResult(resultJson)
            else -> BodyText(infraText(InfraKeys.NO_RESULT), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Scrollable, monospace JSON payload — the web `<pre className="max-h-64 overflow-auto …">`. */
@Composable
private fun JsonResult(text: String) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(max = JSON_MAX_HEIGHT)
                .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(Radius.sm))
                .verticalScroll(rememberScrollState())
                .padding(Spacing.sm)
                .semantics { contentDescription = text },
    ) {
        CodeText(text)
    }
}

// ─── tone + glyph mapping ──────────────────────────────────────────────────

private fun InfraTone.toIconBoxTone(): IconBoxTone =
    when (this) {
        InfraTone.Cyan -> IconBoxTone.Info
        InfraTone.Green -> IconBoxTone.Success
        InfraTone.Amber -> IconBoxTone.Warning
        InfraTone.Purple -> IconBoxTone.Primary
    }

private fun InfraTool.glyph(): ImageVector =
    when (this) {
        InfraTool.DbStats -> InfraGlyphs.Database
        InfraTool.Migrations -> InfraGlyphs.GitBranch
        InfraTool.MqttTest -> InfraGlyphs.Radio
        InfraTool.EnvCheck -> InfraGlyphs.Shield
        InfraTool.Runtime -> InfraGlyphs.Cpu
    }

@Composable
private fun resultBackground(run: ToolRun): Color =
    when {
        run.isFailed -> TeslaTokens.status.danger.copy(alpha = RESULT_WASH_ALPHA)
        run.isSucceeded -> TeslaTokens.status.success.copy(alpha = RESULT_WASH_ALPHA)
        else -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = IDLE_WASH_ALPHA)
    }

/**
 * The error copy for a failed run: a verbatim backend `{error: "..."}` string when present (web parity),
 * else a localized generic failure message derived from the classified transport error.
 */
@Composable
private fun failureMessage(run: ToolRun): String = run.errorDetail ?: infraText(InfraKeys.REQUEST_FAILED)

// ─── i18n facade ───────────────────────────────────────────────────────────

/**
 * Resolves an i18n [key] through the Android resource facade (P1/S10), reproducing react-i18next's
 * natural-key fallback: a key present in the shared catalog returns its localized string; a key the web
 * leaves untranslated returns the key text, exactly as the web `t(key)` does. Recomputed on locale change
 * (the context is keyed into the [remember]).
 */
@Composable
private fun infraText(key: String): String {
    val context = LocalContext.current
    return remember(key, context) { resolveInfraText(context, key) }
}

/** Pure resolver (no Compose) — looks up `translation_<sanitized-key>`, falling back to [key] when absent. */
@SuppressLint("DiscouragedApi")
internal fun resolveInfraText(
    context: Context,
    key: String,
): String {
    val resourceName = "translation_" + key.replace(NON_RESOURCE_CHARS, "_")
    val id = context.resources.getIdentifier(resourceName, "string", context.packageName)
    return if (id != 0) context.getString(id) else key
}

private val NON_RESOURCE_CHARS = Regex("[^A-Za-z0-9_]")

private val JSON_MAX_HEIGHT = 256.dp
private const val RESULT_WASH_ALPHA = 0.08f
private const val IDLE_WASH_ALPHA = 0.4f

// ─── glyphs (local lucide-style vectors; the app uses no Material-icons artifact) ───

/**
 * The five tool glyphs, mirroring the web lucide icons (`Database`, `GitBranch`, `Radio`, `Shield`, `Cpu`)
 * plus the `Play` run glyph. Built with the same 24dp stroked-path convention as the shared `TeslaGlyphs`.
 */
internal object InfraGlyphs {
    val Database: ImageVector =
        stroked("Database") {
            moveTo(3f, 5f)
            arcTo(9f, 3f, 0f, false, true, 21f, 5f)
            arcTo(9f, 3f, 0f, false, true, 3f, 5f)
            close()
            moveTo(3f, 5f)
            lineTo(3f, 19f)
            arcTo(9f, 3f, 0f, false, false, 21f, 19f)
            lineTo(21f, 5f)
            moveTo(3f, 12f)
            arcTo(9f, 3f, 0f, false, false, 21f, 12f)
        }

    val GitBranch: ImageVector =
        stroked("GitBranch") {
            moveTo(6f, 4.5f)
            lineTo(6f, 15f)
            circle(6f, 18f, 2.5f)
            circle(18f, 6f, 2.5f)
            moveTo(18f, 8.5f)
            arcTo(9f, 9f, 0f, false, true, 9f, 17.5f)
        }

    val Radio: ImageVector =
        stroked("Radio") {
            circle(12f, 12f, 2f)
            moveTo(8.5f, 15.5f)
            arcTo(5f, 5f, 0f, false, true, 8.5f, 8.5f)
            moveTo(15.5f, 8.5f)
            arcTo(5f, 5f, 0f, false, true, 15.5f, 15.5f)
            moveTo(6f, 18f)
            arcTo(8.5f, 8.5f, 0f, false, true, 6f, 6f)
            moveTo(18f, 6f)
            arcTo(8.5f, 8.5f, 0f, false, true, 18f, 18f)
        }

    val Shield: ImageVector =
        stroked("Shield") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 12f)
            curveTo(19f, 16.5f, 16f, 19.5f, 12f, 21f)
            curveTo(8f, 19.5f, 5f, 16.5f, 5f, 12f)
            lineTo(5f, 6f)
            close()
        }

    val Cpu: ImageVector =
        stroked("Cpu") {
            rect(4f, 4f, 20f, 20f)
            rect(9f, 9f, 15f, 15f)
            pin(9f, 2f, 9f, 4f)
            pin(15f, 2f, 15f, 4f)
            pin(9f, 20f, 9f, 22f)
            pin(15f, 20f, 15f, 22f)
            pin(2f, 9f, 4f, 9f)
            pin(2f, 15f, 4f, 15f)
            pin(20f, 9f, 22f, 9f)
            pin(20f, 15f, 22f, 15f)
        }

    val Play: ImageVector =
        stroked("Play") {
            moveTo(7f, 5f)
            lineTo(19f, 12f)
            lineTo(7f, 19f)
            close()
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

/** Axis-aligned rectangle from ([left], [top]) to ([right], [bottom]). */
private fun PathBuilder.rect(
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
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

/** A short straight pin segment from ([x1], [y1]) to ([x2], [y2]) (CPU edge contacts). */
private fun PathBuilder.pin(
    x1: Float,
    y1: Float,
    x2: Float,
    y2: Float,
) {
    moveTo(x1, y1)
    lineTo(x2, y2)
}

// ─── previews (tooling only) ───────────────────────────────────────────────

@Preview(name = "Infrastructure — idle", showBackground = true)
@Composable
private fun PreviewInfrastructureIdle() {
    TeslaSyncTheme(dynamicColor = false) {
        InfrastructureSectionContent(state = InfrastructureSectionState.initial(), onRun = { _, _, _ -> })
    }
}

@Preview(name = "Infrastructure — mixed states", showBackground = true)
@Composable
private fun PreviewInfrastructureMixed() {
    TeslaSyncTheme(dynamicColor = false) {
        InfrastructureSectionContent(state = previewMixedState(), onRun = { _, _, _ -> })
    }
}

private fun previewMixedState(): InfrastructureSectionState =
    InfrastructureSectionState(
        runs =
            mapOf(
                InfraTool.DbStats to ToolRun(phase = RunPhase.Succeeded, result = PreviewJson.dbStats),
                InfraTool.Migrations to ToolRun(phase = RunPhase.Running),
                InfraTool.MqttTest to ToolRun.IDLE,
                InfraTool.EnvCheck to ToolRun(phase = RunPhase.Failed, errorKind = ErrorKind.Network),
                InfraTool.Runtime to ToolRun(phase = RunPhase.Failed, errorDetail = "permission denied"),
            ),
    )

/** Sample payloads for the previews only (tooling-rendered, never shipped to a device). */
private object PreviewJson {
    val dbStats: JsonElement =
        buildJsonObject {
            put("tables", JsonPrimitive(42))
            put("size", JsonPrimitive("128 MB"))
            put("rows", JsonPrimitive(1_948_223))
        }
}
