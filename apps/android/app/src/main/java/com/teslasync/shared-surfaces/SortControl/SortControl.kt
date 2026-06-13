// The native Jetpack Compose + Material 3 SortControl shared surface — a parity port of
// web/src/components/forms/SortControl.tsx. The web surface is a controlled, presentational sort control: a field
// dropdown ([Select]) beside a direction-toggle button whose arrow reflects the current direction, so a user can
// read the ascending/descending state at a glance. Changing either calls the matching callback, so the parent
// list page keeps ownership of the URL/list sort state — the surface itself holds no sort state.
//
// All render decisions flow through the pure [SortControlProjection] (which arrow, the direction label, the merged
// accessibility name, the field label, the option mapping) so the composable stays a thin render layer (ADR-002).
// Every visible/spoken string resolves through the i18n catalog (P1/S10) and every interactive element carries a
// TalkBack label. The atomic chrome ([Select], [IconButton], [FormsGlyphs]) is reused from the shared component
// library; this surface only composes it — no web Tailwind classes, platform design tokens only (P1/S9).
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the templated loading / empty / content /
// error / stale / offline contract is mapped onto this controlled surface's real behaviour, because it performs no
// data fetch (see SortControlModel.kt). `content` is the field Select + direction toggle; `empty` (no options) is
// the same control with a disabled, labelled Select so it is never a blank box; loading / error / stale / offline
// have no web branch (the parent page owns list state + any fetch). The one-shot `view.opened` diagnostic is
// emitted on first composition (P1/S11), carrying only the surface slug.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces) cannot
// form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.sortcontrol

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.forms.SortOption
import io.teslasync.android.components.forms.flipSortDirection
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconButtonVariant
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point — the faithful port of the web `SortControl`. Resolves the localized [SortControlStrings]
 * at the render boundary (P1/S10), records the one-shot `view.opened` diagnostic (P1/S11), and renders the
 * stateless [SortControlContent]. The surface performs no business logic and owns no sort state; [logger] defaults
 * to the process logger so a host mounts it with just the controlled props.
 *
 * @param field the currently selected sort field key (web `field`).
 * @param direction the current sort direction (web `direction`).
 * @param options the sort options to choose from, in order (web `options`).
 * @param onFieldChange invoked with the newly chosen field key (web `onFieldChange`).
 * @param onDirectionChange invoked with the flipped direction when the toggle is pressed (web `onDirectionChange`).
 * @param directionAccessibilityLabel optional explicit accessible name for the direction button (web
 *   `directionAriaLabel`); when null the localized "{Sort direction}: {label}" form is used.
 * @param testTag optional UI-test tag for the root (web `testId`); the field and direction get `-field` / `-direction`.
 */
@Composable
fun SortControl(
    field: String,
    direction: SortDirection,
    options: List<SortOption>,
    onFieldChange: (String) -> Unit,
    onDirectionChange: (SortDirection) -> Unit,
    modifier: Modifier = Modifier,
    directionAccessibilityLabel: String? = null,
    testTag: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SortControlDiagnostics.recordViewOpened(logger) }
    SortControlContent(
        field = field,
        direction = direction,
        options = options,
        strings = sortControlStrings(),
        onFieldChange = onFieldChange,
        onDirectionChange = onDirectionChange,
        modifier = modifier,
        directionAccessibilityLabel = directionAccessibilityLabel,
        testTag = testTag,
    )
}

/**
 * Stateless renderer — the unit/preview entry point. Projects the controlled props + [strings] through
 * [SortControlProjection] and lays out the field [Select] (labelled "Sort by", disabled when there are no options
 * so the empty state is never a blank box) beside the direction [IconButton] (the up/down arrow + the merged
 * accessible name). Changing either routes straight back through [onFieldChange] / [onDirectionChange].
 */
@Composable
fun SortControlContent(
    field: String,
    direction: SortDirection,
    options: List<SortOption>,
    strings: SortControlStrings,
    onFieldChange: (String) -> Unit,
    onDirectionChange: (SortDirection) -> Unit,
    modifier: Modifier = Modifier,
    directionAccessibilityLabel: String? = null,
    testTag: String? = null,
) {
    val display =
        remember(field, direction, options, strings, directionAccessibilityLabel) {
            SortControlProjection.project(field, direction, options, strings, directionAccessibilityLabel)
        }
    Row(
        modifier = modifier.tagOrNull(testTag),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier =
                Modifier
                    .weight(1f)
                    .semantics { contentDescription = display.fieldLabel }
                    .tagOrNull(testTag?.let { "$it-field" }),
        ) {
            Select(
                options = display.selectOptions,
                selectedValue = field,
                onSelect = onFieldChange,
                emptyLabel = display.fieldLabel,
                enabled = display.hasOptions,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        IconButton(
            imageVector = if (display.isAscending) FormsGlyphs.ArrowUp else FormsGlyphs.ArrowDown,
            contentDescription = display.directionContentDescription,
            onClick = { onDirectionChange(flipSortDirection(direction)) },
            variant = IconButtonVariant.Outline,
            size = IconSize.Sm,
            modifier = Modifier.tagOrNull(testTag?.let { "$it-direction" }),
        )
    }
}

/** Resolves the four localized [SortControlStrings] from the P1/S10 catalog at the render boundary. */
@Composable
private fun sortControlStrings(): SortControlStrings =
    SortControlStrings(
        ascending = stringResource(R.string.translation_sortControl_ascending),
        descending = stringResource(R.string.translation_sortControl_descending),
        fieldLabel = stringResource(R.string.translation_sortControl_fieldLabel),
        direction = stringResource(R.string.translation_sortControl_direction),
    )

/** Appends a [testTag] semantics tag when [tag] is non-null, leaving the modifier untouched otherwise. */
private fun Modifier.tagOrNull(tag: String?): Modifier = if (tag != null) this.testTag(tag) else this

@Preview(name = "SortControl — ascending", showBackground = true)
@Composable
private fun SortControlAscendingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SortControlContent(
            field = "date",
            direction = SortDirection.Asc,
            options = listOf(SortOption("date", "Date"), SortOption("distance", "Distance"), SortOption("score", "Score")),
            strings = previewStrings,
            onFieldChange = {},
            onDirectionChange = {},
        )
    }
}

@Preview(name = "SortControl — descending", showBackground = true)
@Composable
private fun SortControlDescendingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SortControlContent(
            field = "distance",
            direction = SortDirection.Desc,
            options = listOf(SortOption("date", "Date"), SortOption("distance", "Distance"), SortOption("score", "Score")),
            strings = previewStrings,
            onFieldChange = {},
            onDirectionChange = {},
        )
    }
}

private val previewStrings =
    SortControlStrings(
        ascending = "Ascending",
        descending = "Descending",
        fieldLabel = "Sort by",
        direction = "Sort direction",
    )
