// The native Jetpack Compose + Material 3 Unix Permission tool feature view — a parity port of
// web/src/features/admin/components/devtools/tools/UnixPermissionTool.tsx. The web component is a
// self-contained developer tool wrapped in a `ToolCard` (a `GlassPanel` with a tinted lock icon, a title, and
// a description): it renders an "Octal Perm" text field (default "755"), a "Presets" select over the common
// modes, and — once the input is a valid three-digit octal — a three-cell grid breaking the symbolic string
// into Owner/Group/Other triads (color-coded green/cyan/amber) plus a row showing the full nine-character
// symbolic string with a copy button.
//
// The native surface keeps that contract. Its only web hook is `useTranslation`, mapped here to the i18n
// catalog (P1/S10); it performs NO HTTP and binds no feed (the PERMS map is a static constant and the
// conversion is pure string math, owned by [UnixPermissionToolProjection]). Because the feature-view contract
// still flows through the shared state-holder layer (P1/S8), the surface also renders every lifecycle state
// that layer can carry — loading skeleton, hard error with retry, stale/offline freshness chip — even though
// the tool's default host state is always "ready" (it has nothing to fetch). The web's hidden grid (no/invalid
// octal) becomes an always-visible empty hint, so the panel is never a blank box. A web-parity overload with
// no host state renders the live interactive tool directly.
//
// Per Android guidelines this is built from native primitives + design tokens (P1/S9), never ported Tailwind
// classes; the web `lucide-react` Lock glyph is authored locally as a stroked vector (Android ships no
// equivalent without the frozen material-icons-extended artifact). `view.opened` is emitted once via the
// sanctioned redacting logger (P1/S11).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/UnixPermissionTool — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.unixpermissiontool

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

private const val EM_DASH: String = "\u2014"
private const val GLYPH_VIEWPORT: Float = 24f
private const val GLYPH_STROKE: Float = 2f
private val GLYPH_SIZE: Dp = 24.dp
private val CELL_BORDER_RADIUS: Dp = Radius.sm
private val FIELD_SKELETON_HEIGHT: Dp = 56.dp
private val GRID_SKELETON_HEIGHT: Dp = 56.dp

/**
 * Stroked padlock glyph — the native analogue of the web `Lock` lucide icon (a closed shackle arc above a
 * rounded body). Drawn monochrome and recolored at render time by the [Icon] tint.
 */
private val LockGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "Lock",
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
            ) {
                // Shackle: up the left leg, over the arc, down the right leg (web `M7 11V7a5 5 0 0 1 10 0v4`).
                moveTo(7f, 11f)
                lineTo(7f, 7f)
                arcTo(5f, 5f, 0f, false, true, 17f, 7f)
                lineTo(17f, 11f)
                // Body: a rounded rectangle (web `<rect x=3 y=11 width=18 height=11 rx=2>`).
                moveTo(5f, 11f)
                lineTo(19f, 11f)
                arcTo(2f, 2f, 0f, false, true, 21f, 13f)
                lineTo(21f, 20f)
                arcTo(2f, 2f, 0f, false, true, 19f, 22f)
                lineTo(5f, 22f)
                arcTo(2f, 2f, 0f, false, true, 3f, 20f)
                lineTo(3f, 13f)
                arcTo(2f, 2f, 0f, false, true, 5f, 11f)
                close()
            }
        }.build()

/**
 * Stateful entry point for the Unix permission tool. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared feature-view layer can carry. The host owns the
 * lifecycle (P1/S8) and supplies [onRetry]; this view never performs HTTP.
 *
 * @param state the host lifecycle projection. The tool has no feed, so a host normally passes `Content`;
 *   `Loading`/`Error`/stale/offline are reproduced for full state coverage, never faked from a fetch.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun UnixPermissionTool(
    state: UiState<Unit>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        logger.info("view.opened", mapOf("surface" to UnixPermissionToolRegistration.SLUG))
    }
    UnixPermissionToolContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's self-contained, always-ready usage (no host feed). Renders
 * the live interactive tool directly in the `Content` phase. Records `view.opened` like the stateful entry;
 * there is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun UnixPermissionTool(
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember { UiState(phase = UiPhase.Content, data = Unit) }
    UnixPermissionTool(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Always draws the `ToolCard`
 * header (icon + title + description), then switches on the host lifecycle: a loading skeleton, a hard-error
 * retry surface, or — when ready — a freshness chip (only while refreshing/stale/offline) above the
 * interactive converter. Stale (non-error) data auto-refreshes, mirroring the web freshness contract.
 */
@Composable
fun UnixPermissionToolContent(
    state: UiState<Unit>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    strings: UnixPermissionToolStrings = rememberUnixPermissionToolStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val formatAge = rememberUnixPermFreshnessFormatter()

    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        UnixPermissionToolHeader(strings = strings)
        Spacer(modifier = Modifier.height(Spacing.md))
        when (unixPermSurfaceFor(isLoading = state.isLoading, isError = state.isError)) {
            UnixPermSurfaceState.Loading ->
                UnixPermissionToolLoading(label = stringResource(R.string.translation_common_loading))
            UnixPermSurfaceState.Error -> UnixPermissionToolError(onRetry = onRetry)
            UnixPermSurfaceState.Ready -> {
                if (state.stale || state.refreshing || state.hasError) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
                        horizontalArrangement = Arrangement.End,
                    ) {
                        DataFreshness(
                            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                            isFetching = state.refreshing,
                            isStale = state.stale,
                            isError = state.hasError,
                            fetchingLabel = stringResource(R.string.translation_common_loading),
                            errorLabel = stringResource(R.string.translation_common_offline),
                            formatAge = formatAge,
                        )
                    }
                }
                UnixPermissionConverter(strings = strings)
            }
        }
    }
}

/** The `ToolCard` header — a green-tinted lock icon box beside the title + description. */
@Composable
private fun UnixPermissionToolHeader(strings: UnixPermissionToolStrings) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        IconBox(tone = IconBoxTone.Success, size = IconBoxSize.Md) {
            Icon(imageVector = LockGlyph, contentDescription = null, size = IconSize.Lg)
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PanelTitle(strings.title)
            HelperText(strings.description)
        }
    }
}

/** The interactive body — the octal field, the preset select, and the symbolic breakdown or empty hint. */
@Composable
private fun UnixPermissionConverter(
    strings: UnixPermissionToolStrings,
    modifier: Modifier = Modifier,
) {
    var octal by rememberSaveable { mutableStateOf(DEFAULT_OCTAL) }
    val symbolic = remember(octal) { UnixPermissionToolProjection.symbolicFor(octal) }
    val presetOptions =
        remember {
            UnixPermissionToolProjection.presetOptions().map { preset ->
                SelectOption(value = preset.value, label = preset.label)
            }
        }

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Input(
            value = octal,
            onValueChange = { octal = it },
            label = strings.octalLabel,
            hint = DEFAULT_OCTAL,
            leadingIcon = LockGlyph,
            keyboardType = KeyboardType.Number,
        )
        Select(
            options = presetOptions,
            selectedValue = octal,
            onSelect = { octal = it },
            label = strings.presetsLabel,
        )
        val resolved = symbolic
        if (resolved != null) {
            PermissionClassGrid(symbolic = resolved, strings = strings)
            SymbolicRow(symbolic = resolved, strings = strings)
        } else {
            EmptyState(
                message = strings.emptyHint,
                icon = LockGlyph,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** The Owner/Group/Other breakdown — three equal columns (web `grid grid-cols-3`), color-coded per class. */
@Composable
private fun PermissionClassGrid(
    symbolic: SymbolicPermission,
    strings: UnixPermissionToolStrings,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        PermissionClassCell(
            modifier = Modifier.weight(1f),
            label = strings.ownerLabel,
            value = symbolic.owner,
            valueColor = TeslaTokens.status.success,
        )
        PermissionClassCell(
            modifier = Modifier.weight(1f),
            label = strings.groupLabel,
            value = symbolic.group,
            valueColor = TeslaTokens.status.info,
        )
        PermissionClassCell(
            modifier = Modifier.weight(1f),
            label = strings.otherLabel,
            value = symbolic.other,
            valueColor = TeslaTokens.status.warning,
        )
    }
}

/**
 * One permission-class cell — a muted-label caption over the color-coded monospace triad on a rounded surface
 * (web `rounded bg-[var(--surface-overlay)] px-3 py-2 text-center`). The cell folds to a single TalkBack node
 * reading "<label>, <value>". The monospace + semantic-color text is a justified one-off (no typography role
 * carries a class-coded color), built from the M3 type ramp and a design token rather than a hand-picked hex.
 */
@Composable
private fun PermissionClassCell(
    label: String,
    value: String,
    valueColor: Color,
    modifier: Modifier = Modifier,
) {
    val description = UnixPermissionToolProjection.classCellDescription(label, value)
    Column(
        modifier =
            modifier
                .clip(RoundedCornerShape(CELL_BORDER_RADIUS))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                .clearAndSetSemantics { contentDescription = description },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(label)
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
            color = valueColor,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * The full nine-character symbolic string with a copy affordance — web
 * `<code className="font-mono text-white">{symbolic}</code>` beside `<CopyButton text={symbolic} />`, laid on a
 * rounded surface row.
 */
@Composable
private fun SymbolicRow(
    symbolic: SymbolicPermission,
    strings: UnixPermissionToolStrings,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(CELL_BORDER_RADIUS))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CodeText(text = symbolic.full, modifier = Modifier.weight(1f))
        CopyButton(
            text = symbolic.full,
            copyLabel = strings.copyLabel,
            copiedLabel = strings.copiedLabel,
            iconOnly = true,
        )
    }
}

/** First-load skeleton — two field-shaped bars and a grid-shaped bar so the panel is never blank. */
@Composable
private fun UnixPermissionToolLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(height = FIELD_SKELETON_HEIGHT, rounded = true)
        Skeleton(height = FIELD_SKELETON_HEIGHT, rounded = true)
        Skeleton(height = GRID_SKELETON_HEIGHT, rounded = true)
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun UnixPermissionToolError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [UnixPermissionToolStrings]. `Presets`/`Owner`/`Group`/`Other` and the copy-button
 * labels resolve through compile-time resources; `Unix Perm`/`Unix Perm Desc`/`Octal Perm` and the empty hint
 * resolve by-name with the web `t(key, default)` fallback, since those keys exist in no catalog. Remembered
 * against the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberUnixPermissionToolStrings(): UnixPermissionToolStrings {
    val context = LocalContext.current
    val presetsLabel = stringResource(R.string.translation_Presets)
    val ownerLabel = stringResource(R.string.translation_Owner)
    val groupLabel = stringResource(R.string.translation_Group)
    val otherLabel = stringResource(R.string.translation_Other)
    val copyLabel = stringResource(R.string.translation_common_copyButton_copy)
    val copiedLabel = stringResource(R.string.translation_common_copyButton_copied)
    val lookup: (String) -> String? = { name -> context.optionalString(name) }
    val title = resolveOptional(lookup, KEY_TITLE, UnixPermissionToolDefaults.TITLE)
    val description = resolveOptional(lookup, KEY_DESCRIPTION, UnixPermissionToolDefaults.DESCRIPTION)
    val octalLabel = resolveOptional(lookup, KEY_OCTAL_LABEL, UnixPermissionToolDefaults.OCTAL_LABEL)
    val emptyHint = resolveOptional(lookup, KEY_EMPTY_HINT, UnixPermissionToolDefaults.EMPTY_HINT)
    return remember(title, description, octalLabel, presetsLabel, ownerLabel, groupLabel, otherLabel, emptyHint) {
        UnixPermissionToolStrings(
            title = title,
            description = description,
            octalLabel = octalLabel,
            presetsLabel = presetsLabel,
            ownerLabel = ownerLabel,
            groupLabel = groupLabel,
            otherLabel = otherLabel,
            emptyHint = emptyHint,
            copyLabel = copyLabel,
            copiedLabel = copiedLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`), with an explicit
 * [Locale] so the numeric substitution is locale-correct.
 */
@Composable
private fun rememberUnixPermFreshnessFormatter(): (FreshnessAge) -> String {
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
