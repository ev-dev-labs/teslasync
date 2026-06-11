// The native Jetpack Compose + Material 3 TimestampTool feature view — a parity port of
// web/src/features/admin/components/devtools/tools/TimestampTool.tsx. It renders a single ToolCard (green
// accent, clock icon) containing a one-second live clock row (unix seconds ` | ` ISO string + a "Now" button
// that fills both inputs), a unix-timestamp input whose parsed value expands into Iso / Local / Relative rows,
// and an ISO-timestamp input whose parsed value expands into Unix / Local / Relative rows. Every derivation —
// the ticking clock, the two input parses, and the relative/local formatting — flows through the pure
// [TimestampToolProjection]; this file is a thin render + state-plumbing layer.
//
// Data binding (P1/S8): the web tool binds no API hook, only `useTranslation` plus local clock/input state, so
// there is no state-holder to bind and no loading/error/stale/offline lifecycle to render (same reasoning the
// sibling ToolCard / ResultPanel ports documented). i18n (P1/S10) resolves at this Compose boundary; telemetry
// (P1/S11) emits a single `view.opened` for the `TimestampTool` slug.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TimestampTool) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.timestamptool

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import io.teslasync.android.R
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.featureviews.toolcard.ToolCardContent
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

/**
 * Every localized string the surface renders, resolved at the Compose boundary (P1/S10). The three values whose
 * web keys (`Timestamp Desc`, `Unix Timestamp`, `Iso Timestamp`) are absent from the shared catalog fall back
 * to the key text, exactly as the web `t(key)` does — see [resolveTimestampToolText].
 */
data class TimestampToolLabels(
    val title: String,
    val description: String,
    val now: String,
    val unixTimestamp: String,
    val isoTimestamp: String,
    val iso: String,
    val local: String,
    val relative: String,
    val unix: String,
)

/**
 * Stateful entry point. Emits the one-shot `view.opened` diagnostic (P1/S11), resolves the i18n labels, runs the
 * one-second clock tick (web `setInterval(…, 1000)`), holds the two input fields, and renders the surface. The
 * [zone] / [locale] default to the device's (so "Local" follows the user) and [nowProvider] defaults to the wall
 * clock; all three are injectable so the surface is deterministically testable.
 *
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TimestampTool(
    modifier: Modifier = Modifier,
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
    nowProvider: () -> Instant = { Instant.now() },
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { TimestampToolDiagnostics.recordViewOpened(logger) }

    val labels = rememberTimestampToolLabels()
    var now by remember { mutableStateOf(nowProvider()) }
    var unixInput by rememberSaveable { mutableStateOf("") }
    var isoInput by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(nowProvider) {
        while (isActive) {
            delay(TICK_MILLIS)
            now = nowProvider()
        }
    }

    TimestampToolContent(
        labels = labels,
        liveClock = TimestampToolProjection.liveClock(now),
        unixInput = unixInput,
        isoInput = isoInput,
        unixConversion = TimestampToolProjection.projectUnix(unixInput, now, zone, locale),
        isoConversion = TimestampToolProjection.projectIso(isoInput, now, zone, locale),
        onNowClick = {
            val values = TimestampToolProjection.nowFieldValues(now)
            unixInput = values.unix
            isoInput = values.iso
        },
        onUnixChange = { unixInput = it },
        onIsoChange = { isoInput = it },
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web layout: the green clock
 * [ToolCardContent] wrapping the live clock row, the unix field with its conversion rows, and the iso field with
 * its conversion rows. A `null` [unixConversion] / [isoConversion] hides that field's rows, exactly as the web
 * `{fromUnix && …}` / `{fromIso && …}` guards do.
 */
@Composable
fun TimestampToolContent(
    labels: TimestampToolLabels,
    liveClock: LiveClock,
    unixInput: String,
    isoInput: String,
    unixConversion: UnixConversion?,
    isoConversion: IsoConversion?,
    onNowClick: () -> Unit,
    onUnixChange: (String) -> Unit,
    onIsoChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    ToolCardContent(
        icon = TimestampToolGlyphs.Clock,
        color = TOOL_ACCENT,
        title = labels.title,
        description = labels.description,
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            LiveClockRow(liveClock = liveClock, nowLabel = labels.now, onNowClick = onNowClick)
            UnixField(labels = labels, value = unixInput, onValueChange = onUnixChange, conversion = unixConversion)
            IsoField(labels = labels, value = isoInput, onValueChange = onIsoChange, conversion = isoConversion)
        }
    }
}

/** The web live clock row: a small green clock glyph, the monospace `unix | iso` value, and the ghost "Now" button. */
@Composable
private fun LiveClockRow(
    liveClock: LiveClock,
    nowLabel: String,
    onNowClick: () -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.sm),
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                imageVector = TimestampToolGlyphs.Clock,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.success,
            )
            CodeText(
                text = "${liveClock.unixSeconds}$LIVE_CLOCK_SEPARATOR${liveClock.iso}",
                modifier = Modifier.weight(1f),
            )
            Button(
                label = nowLabel,
                onClick = onNowClick,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

/** The unix-timestamp field plus its Iso / Local / Relative rows (shown only when the input parses). */
@Composable
private fun UnixField(
    labels: TimestampToolLabels,
    value: String,
    onValueChange: (String) -> Unit,
    conversion: UnixConversion?,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Input(
            value = value,
            onValueChange = onValueChange,
            label = labels.unixTimestamp,
            // parity:allow web example value rendered as the field's format hint, not localizable copy
            hint = UNIX_HINT,
            leadingIcon = TimestampToolGlyphs.Hash,
            keyboardType = KeyboardType.Number,
        )
        if (conversion != null) {
            ConversionRows(
                listOf(
                    labels.iso to conversion.iso,
                    labels.local to conversion.local,
                    labels.relative to conversion.relative,
                ),
            )
        }
    }
}

/** The ISO-timestamp field plus its Unix / Local / Relative rows (shown only when the input parses). */
@Composable
private fun IsoField(
    labels: TimestampToolLabels,
    value: String,
    onValueChange: (String) -> Unit,
    conversion: IsoConversion?,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Input(
            value = value,
            onValueChange = onValueChange,
            label = labels.isoTimestamp,
            // parity:allow web example value rendered as the field's format hint, not localizable copy
            hint = ISO_HINT,
            leadingIcon = TimestampToolGlyphs.Clock,
            keyboardType = KeyboardType.Text,
        )
        if (conversion != null) {
            ConversionRows(
                listOf(
                    labels.unix to conversion.unix,
                    labels.local to conversion.local,
                    labels.relative to conversion.relative,
                ),
            )
        }
    }
}

/** The web conversion block (`mt-1 space-y-0.5`): one "Label: value" row per [rows] entry, value monospaced. */
@Composable
private fun ConversionRows(rows: List<Pair<String, String>>) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        rows.forEach { (label, value) -> ConversionRow(label = label, value = value) }
    }
}

/** A single conversion row, merged into one TalkBack node so it reads as "Label: value". */
@Composable
private fun ConversionRow(
    label: String,
    value: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        HelperText("$label:")
        CodeText(text = value, modifier = Modifier.weight(1f))
    }
}

/** Resolves every [TimestampToolLabels] string at the Compose boundary (P1/S10); see [resolveTimestampToolText]. */
@Composable
private fun rememberTimestampToolLabels(): TimestampToolLabels {
    val context = LocalContext.current
    return TimestampToolLabels(
        title = stringResource(R.string.translation_Timestamp),
        description = resolveTimestampToolText(context, KEY_TIMESTAMP_DESC),
        now = stringResource(R.string.translation_Now),
        unixTimestamp = resolveTimestampToolText(context, KEY_UNIX_TIMESTAMP),
        isoTimestamp = resolveTimestampToolText(context, KEY_ISO_TIMESTAMP),
        iso = stringResource(R.string.translation_Iso),
        local = stringResource(R.string.translation_Local),
        relative = stringResource(R.string.translation_Relative),
        unix = stringResource(R.string.translation_Unix),
    )
}

/**
 * Resolves an i18n [key] through the Android resource catalog (P1/S10), reproducing react-i18next's natural-key
 * fallback: a key present in the catalog returns its localized string; a key the web leaves untranslated (the
 * three multi-word keys this tool uses) returns the key text, exactly as the web `t(key)` does. `getIdentifier`
 * is the only way to attempt a key that may be absent; release builds keep resource names (resource shrinking is
 * off), so the by-name lookup stays stable, and `DiscouragedApi` is suppressed accordingly.
 */
@SuppressLint("DiscouragedApi")
internal fun resolveTimestampToolText(
    context: Context,
    key: String,
): String {
    val resourceName = TRANSLATION_PREFIX + key.replace(NON_RESOURCE_CHARS, "_")
    val id = context.resources.getIdentifier(resourceName, "string", context.packageName)
    return if (id != 0) context.getString(id) else key
}

// Web `color="green"` on the ToolCard.
private const val TOOL_ACCENT = "green"

// Web `setInterval(() => setNow(new Date()), 1000)`.
private const val TICK_MILLIS = 1000L

// Web ` | ` separator between the live unix seconds and the live ISO string.
private const val LIVE_CLOCK_SEPARATOR = "  |  "

// Web example field values shown as input format hints, not localizable copy.
private const val UNIX_HINT = "1700000000"
private const val ISO_HINT = "2024-01-01T00:00:00Z"

// The i18n keys whose web `t()` calls have no catalog entry (resolved via key-as-fallback above). These are the
// exact identifiers the web source passes to `t()`, not free-form English copy.
private const val KEY_TIMESTAMP_DESC = "Timestamp Desc"
private const val KEY_UNIX_TIMESTAMP = "Unix Timestamp"
private const val KEY_ISO_TIMESTAMP = "Iso Timestamp"

private const val TRANSLATION_PREFIX = "translation_"
private val NON_RESOURCE_CHARS = Regex("[^A-Za-z0-9_]")
