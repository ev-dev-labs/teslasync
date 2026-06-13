// The native Jetpack Compose + Material 3 TimeMachineBanner shared surface — a parity port of
// web/src/components/feedback/TimeMachineBanner.tsx. The web surface is the global "viewing data as of …" notice
// for the read-only point-in-time time-machine view: an `info` AlertBanner (History icon) showing the active
// anchor, a "Pick a date" toggle that reveals an inline `datetime-local` picker (label + input + "View as of
// date" submit, disabled until a draft is entered, + "Cancel"), and a "Return to live" affordance shown only
// while an anchor is set. It renders nothing in live mode with the picker closed.
//
// This surface keeps that contract end to end. All data flows through the shared [TimeMachineBannerViewModel] over
// the [TimeMachineBannerSource] seam (P1/S8) — the view performs NO HTTP and owns no anchor state itself. Every
// render decision flows through the pure [TimeMachineBannerProjection]; the composable is a thin render layer.
// Per Android guidelines the chrome is built from native primitives + shared components + design tokens (P1/S9),
// never ported Tailwind classes: the AlertBanner `info` tint comes from the shared feedback Tone palette, the
// History / Clock / Calendar glyphs from the shared icon sets, and the web `<input type="datetime-local">` becomes
// a tap-to-pick field backed by Material 3 Date + Time pickers (the same pattern as the sibling
// SignalCompareControls). Every visible string resolves through the P1/S10 catalog (no hardcoded English). The
// banner is a polite live region so TalkBack announces it when the anchor changes, the title + body are merged
// into one announcement, and every interactive control carries its own label. The one-shot `view.opened`
// diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/TimeMachineBanner) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless renderer + previews.
@file:OptIn(ExperimentalMaterial3Api::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.timemachinebanner

import android.text.format.DateFormat
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.toneColors
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset

/** Test tag identifying the banner region — the native mirror of the web `data-testid="time-machine-banner"`. */
const val TIME_MACHINE_BANNER_TEST_TAG: String = "time-machine-banner"

/** Test tag identifying the inline picker region — the native mirror of `data-testid="…-banner-picker"`. */
const val TIME_MACHINE_PICKER_TEST_TAG: String = "time-machine-banner-picker"

private val BANNER_BORDER_WIDTH = 1.dp

/** The two-step picker flow phases (Material 3 has no single date+time dialog): pick the date, then the time. */
private enum class PickPhase { Idle, Date, Time }

/**
 * The localized labels the surface folds into its output. The [heading] + [body] vary with the viewing/prompt
 * branch; the rest are static affordance labels. Built from `stringResource` at the render boundary (tests pass a
 * deterministic instance), keeping the projection a pure, locale-stable function. Every string resolves through
 * the P1/S10 catalog.
 */
data class TimeMachineBannerStrings(
    val heading: String,
    val body: String,
    val pick: String,
    val returnToLive: String,
    val inputLabel: String,
    val submit: String,
    val cancel: String,
    val confirm: String,
    val pickEmpty: String,
)

/**
 * Stateful entry point bound to the app-global time-machine anchor — the faithful port of the web
 * `TimeMachineBanner`. Binds the [TimeMachineBannerViewModel], records the one-shot `view.opened` diagnostic
 * (P1/S11), collects the anchor snapshot, owns the local picker UI state (open/draft/phase), projects everything
 * into the render the stateless surface paints, and wires the banner's writes back to the live anchor.
 *
 * @param modifier optional layout modifier for the banner.
 * @param source the as-of seam; defaults to the app-global holder ([AsOfDateStore]).
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun TimeMachineBanner(
    modifier: Modifier = Modifier,
    source: TimeMachineBannerSource = AsOfDateStore.asTimeMachineBannerSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: TimeMachineBannerViewModel =
        viewModel(
            key = TimeMachineBannerRegistration.ID,
            factory = TimeMachineBannerViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val snapshot by viewModel.snapshot.collectAsStateWithLifecycle()
    val asOf = snapshot.asOf

    val zone = remember { ZoneId.systemDefault() }
    val locale = LocalConfiguration.current.locales[0]

    var pickerOpen by remember { mutableStateOf(false) }
    var draftLocal by remember { mutableStateOf("") }
    var pickPhase by remember { mutableStateOf(PickPhase.Idle) }
    var pickedDate by remember { mutableStateOf<LocalDate?>(null) }

    val render =
        remember(asOf, pickerOpen, draftLocal) {
            TimeMachineBannerProjection.render(TimeMachineBannerInput(asOf, pickerOpen, draftLocal))
        }
    val whenLabel = if (asOf != null) TimeMachineTime.formatAsOfDisplay(asOf, zone, locale) else ""
    val strings = rememberTimeMachineBannerStrings(render.viewing, whenLabel)
    val draftDisplay = TimeMachineTime.displayLabel(draftLocal, strings.pickEmpty)

    TimeMachineBannerContent(
        render = render,
        strings = strings,
        draftDisplay = draftDisplay,
        modifier = modifier,
        onTogglePicker = {
            val opening = !pickerOpen
            pickerOpen = opening
            // Seed the draft on open (web command-palette `onOpen` seed) so the field is never empty.
            if (opening && draftLocal.isBlank()) {
                draftLocal = TimeMachineTime.seedLocalInput(asOf, System.currentTimeMillis(), zone)
            }
        },
        onReturnToLive = {
            viewModel.returnToLive()
            pickerOpen = false
            draftLocal = ""
        },
        onOpenPicker = { pickPhase = PickPhase.Date },
        onSubmit = {
            val iso = TimeMachineTime.localInputToIso(draftLocal, zone)
            if (iso != null) {
                viewModel.setAsOf(iso)
                pickerOpen = false
                draftLocal = ""
            }
        },
        onCancel = {
            pickerOpen = false
            draftLocal = ""
        },
    )

    when (pickPhase) {
        PickPhase.Date ->
            DatePickerPopup(
                initial = TimeMachineTime.parseLocalDatetime(draftLocal),
                confirmLabel = strings.confirm,
                cancelLabel = strings.cancel,
                onCancel = { pickPhase = PickPhase.Idle },
                onConfirm = { date ->
                    pickedDate = date
                    pickPhase = PickPhase.Time
                },
            )

        PickPhase.Time ->
            TimePickerPopup(
                initial = TimeMachineTime.parseLocalDatetime(draftLocal),
                confirmLabel = strings.confirm,
                cancelLabel = strings.cancel,
                onCancel = { pickPhase = PickPhase.Idle },
                onConfirm = { hour, minute ->
                    val date = pickedDate ?: TimeMachineTime.parseLocalDatetime(draftLocal)?.toLocalDate() ?: LocalDate.now()
                    draftLocal = TimeMachineTime.toLocalDatetimeInput(LocalDateTime.of(date, LocalTime.of(hour, minute)))
                    pickPhase = PickPhase.Idle
                },
            )

        PickPhase.Idle -> Unit
    }
}

/**
 * Stateless surface — the unit/UI-test and preview entry point. Renders nothing in live mode with the picker
 * closed (the faithful port of the web `if (effective == null && !pickerOpen) return null`, contributing zero
 * layout rather than a blank box). Otherwise draws the `info`-tinted banner: the History icon, the title + body
 * (merged into one TalkBack announcement), the "Pick a date" toggle, the "Return to live" affordance (only while
 * an anchor is set), and — when the picker is open — the inline date/time field, the submit (disabled until a
 * draft is set), and cancel. The whole banner is a polite live region (web `role="status"` / `aria-live`).
 */
@Composable
fun TimeMachineBannerContent(
    render: TimeMachineBannerRender,
    strings: TimeMachineBannerStrings,
    draftDisplay: String,
    modifier: Modifier = Modifier,
    onTogglePicker: () -> Unit = {},
    onReturnToLive: () -> Unit = {},
    onOpenPicker: () -> Unit = {},
    onSubmit: () -> Unit = {},
    onCancel: () -> Unit = {},
) {
    if (!render.visible) return

    val colors = toneColors(Tone.Info)
    val spokenLabel = bannerAccessibilityLabel(strings.heading, strings.body)

    Surface(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(TIME_MACHINE_BANNER_TEST_TAG)
                .semantics { liveRegion = LiveRegionMode.Polite },
        shape = RoundedCornerShape(Radius.md),
        color = colors.background,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(BANNER_BORDER_WIDTH, colors.border),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(DataDisplayGlyphs.History, contentDescription = null, size = IconSize.Md, tint = colors.foreground)
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Column(
                    modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = spokenLabel },
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Text(strings.heading, style = MaterialTheme.typography.titleSmall, color = colors.foreground)
                    BodyText(strings.body, color = MaterialTheme.colorScheme.onSurface)
                }
                TimeMachineBannerActions(render, strings, onTogglePicker, onReturnToLive)
                if (render.showPicker) {
                    TimeMachineBannerPicker(render, strings, draftDisplay, onOpenPicker, onSubmit, onCancel)
                }
            }
        }
    }
}

/** The "Pick a date" toggle (always shown when visible) + the "Return to live" affordance (only while viewing). */
@Composable
private fun TimeMachineBannerActions(
    render: TimeMachineBannerRender,
    strings: TimeMachineBannerStrings,
    onTogglePicker: () -> Unit,
    onReturnToLive: () -> Unit,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = strings.pick,
            onClick = onTogglePicker,
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            leadingIcon = FeedbackGlyphs.Clock,
        )
        if (render.showReturnToLive) {
            Button(
                label = strings.returnToLive,
                onClick = onReturnToLive,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

/**
 * The inline picker region (web `{pickerOpen && …}`): the "Date and time" label, a tap-to-pick field showing the
 * current draft (opens the Material 3 date → time dialogs), the "View as of date" submit (disabled until a draft
 * is set), and "Cancel". The field carries an explicit TalkBack description.
 */
@Composable
private fun TimeMachineBannerPicker(
    render: TimeMachineBannerRender,
    strings: TimeMachineBannerStrings,
    draftDisplay: String,
    onOpenPicker: () -> Unit,
    onSubmit: () -> Unit,
    onCancel: () -> Unit,
) {
    val fieldDescription = "${strings.inputLabel}: $draftDisplay"
    Column(
        modifier = Modifier.testTag(TIME_MACHINE_PICKER_TEST_TAG),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        FieldLabelText(strings.inputLabel)
        Button(
            label = draftDisplay,
            onClick = onOpenPicker,
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = fieldDescription },
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            leadingIcon = FormsGlyphs.Calendar,
        )
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                label = strings.submit,
                onClick = onSubmit,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                enabled = render.submitEnabled,
            )
            Button(
                label = strings.cancel,
                onClick = onCancel,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

/** Material 3 date-picker dialog seeded from the current draft, mirroring the date part of `datetime-local`. */
@Composable
private fun DatePickerPopup(
    initial: LocalDateTime?,
    confirmLabel: String,
    cancelLabel: String,
    onCancel: () -> Unit,
    onConfirm: (LocalDate) -> Unit,
) {
    val initialMillis =
        initial
            ?.toLocalDate()
            ?.atStartOfDay(ZoneOffset.UTC)
            ?.toInstant()
            ?.toEpochMilli()
    val state = rememberDatePickerState(initialSelectedDateMillis = initialMillis)
    DatePickerDialog(
        onDismissRequest = onCancel,
        confirmButton = {
            Button(
                label = confirmLabel,
                onClick = {
                    val picked =
                        state.selectedDateMillis?.let {
                            Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()
                        }
                    if (picked != null) onConfirm(picked) else onCancel()
                },
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
            )
        },
        dismissButton = {
            Button(label = cancelLabel, onClick = onCancel, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
        },
    ) {
        DatePicker(state = state)
    }
}

/** Material 3 time-picker dialog seeded from the current draft, mirroring the time part of `datetime-local`. */
@Composable
private fun TimePickerPopup(
    initial: LocalDateTime?,
    confirmLabel: String,
    cancelLabel: String,
    onCancel: () -> Unit,
    onConfirm: (Int, Int) -> Unit,
) {
    val is24Hour = DateFormat.is24HourFormat(LocalContext.current)
    val state =
        rememberTimePickerState(
            initialHour = initial?.hour ?: 0,
            initialMinute = initial?.minute ?: 0,
            is24Hour = is24Hour,
        )
    AlertDialog(
        onDismissRequest = onCancel,
        confirmButton = {
            Button(
                label = confirmLabel,
                onClick = { onConfirm(state.hour, state.minute) },
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
            )
        },
        dismissButton = {
            Button(label = cancelLabel, onClick = onCancel, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
        },
        text = { TimePicker(state = state) },
    )
}

/** Builds the localized labels from the P1/S10 catalog; the heading/body track the viewing/prompt branch. */
@Composable
private fun rememberTimeMachineBannerStrings(
    viewing: Boolean,
    whenLabel: String,
): TimeMachineBannerStrings =
    TimeMachineBannerStrings(
        heading =
            if (viewing) {
                stringResource(R.string.translation_timeMachine_banner_title, whenLabel)
            } else {
                stringResource(R.string.translation_timeMachine_banner_pickPrompt)
            },
        body =
            if (viewing) {
                stringResource(R.string.translation_timeMachine_banner_body)
            } else {
                stringResource(R.string.translation_timeMachine_banner_pickBody)
            },
        pick = stringResource(R.string.translation_timeMachine_banner_pick),
        returnToLive = stringResource(R.string.translation_timeMachine_banner_returnToLive),
        inputLabel = stringResource(R.string.translation_timeMachine_banner_inputLabel),
        submit = stringResource(R.string.translation_timeMachine_banner_submit),
        cancel = stringResource(R.string.translation_timeMachine_banner_cancel),
        confirm = stringResource(R.string.translation_common_confirm),
        pickEmpty = stringResource(R.string.translation_timeMachine_banner_pick),
    )

// ── Previews — one per visible state (viewing, viewing + picker, prompt). The live + closed-picker state is
// dormant (renders nothing, faithful to the web early return), so it has no preview. Strings resolve through the
// P1/S10 catalog; the sample anchor/draft below are tooling-only data fed into those catalog templates. ─────────

private const val PREVIEW_WHEN = "2024-11-12 14:30"
private const val PREVIEW_DRAFT = "2024-11-12 14:30"

@Preview(name = "TimeMachineBanner · viewing", showBackground = true)
@Composable
private fun TimeMachineBannerViewingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TimeMachineBannerContent(
            render =
                TimeMachineBannerRender(
                    visible = true,
                    viewing = true,
                    showReturnToLive = true,
                    showPicker = false,
                    submitEnabled = false,
                ),
            strings = rememberTimeMachineBannerStrings(viewing = true, whenLabel = PREVIEW_WHEN),
            draftDisplay = PREVIEW_DRAFT,
        )
    }
}

@Preview(name = "TimeMachineBanner · viewing + picker", showBackground = true)
@Composable
private fun TimeMachineBannerPickerPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TimeMachineBannerContent(
            render =
                TimeMachineBannerRender(
                    visible = true,
                    viewing = true,
                    showReturnToLive = true,
                    showPicker = true,
                    submitEnabled = true,
                ),
            strings = rememberTimeMachineBannerStrings(viewing = true, whenLabel = PREVIEW_WHEN),
            draftDisplay = PREVIEW_DRAFT,
        )
    }
}

@Preview(name = "TimeMachineBanner · prompt (no anchor)", showBackground = true)
@Composable
private fun TimeMachineBannerPromptPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TimeMachineBannerContent(
            render =
                TimeMachineBannerRender(
                    visible = true,
                    viewing = false,
                    showReturnToLive = false,
                    showPicker = true,
                    submitEnabled = true,
                ),
            strings = rememberTimeMachineBannerStrings(viewing = false, whenLabel = ""),
            draftDisplay = PREVIEW_DRAFT,
        )
    }
}
