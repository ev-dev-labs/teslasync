// The native Jetpack Compose + Material 3 view for the AnnotationList shared surface — the parity port of the
// web `AnnotationList` component (web/src/components/charts/AnnotationList.tsx). Its data layer (the
// [AnnotationEntry] render shape, the [AnnotationCategory] palette, the [AnnotationListState] holder, and the
// [AnnotationListDiagnostics] event) lives in AnnotationListModel.kt.
//
// Web parity, element for element: the web renders a small titled list beneath a chart. A tiny uppercase
// "Annotations" caption, then one row per annotation — a category-coloured dot, the bold label, an optional
// muted "— description", the right-pinned timestamp (`ml-auto`), and a ghost remove button that reveals on
// hover. When the array is empty it renders NOTHING (`if (annotations.length === 0) return null`). The native
// port reproduces each piece: the caption is a [Caption]; each row is a hairline-bordered Material [Surface]
// with the dot ([CategoryDot]), label, optional description, timestamp, and an [IconButton] carrying the
// localized "Remove annotation" accessible name; the empty state renders nothing, faithful to the web spec.
//
// Data binding: the view performs NO HTTP. The stateful entry collects the P1/S8 [AnnotationListState] with
// `collectAsStateWithLifecycle` and delegates to the stateless entry, which is the pure parent-driven port of
// the web props (`annotations` + `onRemove`) and the unit/UI-test + preview seam. Diagnostics: one PII-safe
// `view.opened` (P1/S11) fires on first composition — before the empty early-return, so the surface is always
// recorded even when it then renders nothing.
//
// Accessibility: each row's text cluster is one merged TalkBack node that leads with the localized category
// name, so the dot's colour is never the sole signal of the category; the remove [IconButton] is a separate
// 48 dp touch target with a localized content description. All copy resolves through the P1/S10 catalog
// (`R.string.translation_annotation_*`); there are no English literals. Native adaptation (documented per
// Honesty Covenant #9): the web hides the description below the `sm` breakpoint, but the native row shows it
// inline and ellipsised — a phone row has the horizontal budget the web chart sidebar lacks, and hiding data
// on mobile is the worse trade.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.annotationlist

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web `h-2 w-2` category dot diameter. */
private val DotSize: Dp = 8.dp

/** Web row `border` hairline width. */
private val RowBorderWidth: Dp = 1.dp

/** Web row `bg-white/[0.02]` faint fill, applied to the neutral surface tint. */
private const val ROW_FILL_ALPHA: Float = 0.04f

/** Test tag for the list title — lets the UI test assert the populated state shows the caption. */
const val ANNOTATION_LIST_TITLE_TAG: String = "annotation-list-title"

/** Test-tag prefix for a row container, suffixed with the entry id. */
const val ANNOTATION_ROW_TAG_PREFIX: String = "annotation-row-"

/** Test-tag prefix for a row's remove button, suffixed with the entry id. */
const val ANNOTATION_REMOVE_TAG_PREFIX: String = "annotation-remove-"

/**
 * Stateful entry point — binds the P1/S8 [AnnotationListState] and renders the list. Collects the holder's
 * entries with lifecycle awareness and forwards the holder's [AnnotationListState.remove] writer as the
 * remove callback, the native analogue of the web parent owning `annotations` + `onRemove`.
 *
 * @param state the shared state holder the surface binds to.
 * @param logger the sanctioned redacting logger the `view.opened` diagnostic is emitted through; defaults to
 *   the app's [LocalDataContainer].
 */
@Composable
fun AnnotationList(
    state: AnnotationListState,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val entries by state.entries.collectAsStateWithLifecycle()
    AnnotationList(
        annotations = entries,
        onRemove = state::remove,
        modifier = modifier,
        logger = logger,
    )
}

/**
 * Stateless entry point — the faithful port of the web `AnnotationList` props (`annotations` + `onRemove`) and
 * the unit/UI-test + preview seam. Records the one-shot PII-safe `view.opened` diagnostic, then renders the
 * titled list, or renders nothing when [annotations] is empty (web `return null`).
 *
 * @param annotations the rows to render; an empty list renders nothing, faithful to the web spec.
 * @param onRemove invoked with an entry id when its remove button is tapped (web `onRemove`).
 */
@Composable
fun AnnotationList(
    annotations: List<AnnotationEntry>,
    onRemove: (String) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { AnnotationListDiagnostics.recordViewOpened(logger) }

    // Web parity: `if (annotations.length === 0) return null` — the surface is absent until it has rows. A
    // visible empty box would contradict the web spec and clutter every chart that mounts the list.
    if (annotations.isEmpty()) return

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(
            text = stringResource(R.string.translation_annotation_listTitle).uppercase(),
            modifier = Modifier.testTag(ANNOTATION_LIST_TITLE_TAG),
        )
        annotations.forEach { entry ->
            AnnotationRow(entry = entry, onRemove = onRemove)
        }
    }
}

/**
 * One annotation row — the web `group flex … rounded-lg border bg-gray-50` row. A hairline-bordered surface
 * holding the category dot, the label, the optional description, the right-pinned timestamp, and the remove
 * button. The dot + text cluster form a single merged TalkBack node ([rowAccessibilityLabel]); the remove
 * button stays a separate, individually-focusable touch target.
 */
@Composable
private fun AnnotationRow(
    entry: AnnotationEntry,
    onRemove: (String) -> Unit,
) {
    val category = categoryLabel(entry.category)
    val removeLabel = stringResource(R.string.translation_annotation_remove)
    Surface(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(ANNOTATION_ROW_TAG_PREFIX + entry.id),
        shape = RoundedCornerShape(Radius.lg),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = ROW_FILL_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(RowBorderWidth, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Spacing.md, vertical = Spacing.xs)
                    .semantics(mergeDescendants = true) {
                        contentDescription = rowAccessibilityLabel(category, entry)
                    },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            CategoryDot(entry.category)
            Row(
                modifier = Modifier.weight(1f),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                BodyText(
                    text = entry.label,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                )
                val description = entry.description
                if (!description.isNullOrBlank()) {
                    BodyText(
                        text = "— $description",
                        modifier = Modifier.weight(1f),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                    )
                } else {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
            HelperText(text = entry.timestamp)
            IconButton(
                imageVector = TeslaGlyphs.Close,
                contentDescription = removeLabel,
                onClick = { onRemove(entry.id) },
                size = IconSize.Sm,
                modifier = Modifier.testTag(ANNOTATION_REMOVE_TAG_PREFIX + entry.id),
            )
        }
    }
}

/** The category-coloured dot — web `h-2 w-2 rounded-full` with the fixed `ANNOTATION_COLORS` fill. */
@Composable
private fun CategoryDot(category: AnnotationCategory) {
    Box(
        modifier =
            Modifier
                .size(DotSize)
                .clip(CircleShape)
                .background(Color(category.argbColor)),
    )
}

/** Resolves the localized category name (P1/S10) used as the dot's spoken meaning in the row readout. */
@Composable
private fun categoryLabel(category: AnnotationCategory): String =
    stringResource(
        when (category) {
            AnnotationCategory.Milestone -> R.string.translation_annotation_cat_milestone
            AnnotationCategory.Maintenance -> R.string.translation_annotation_cat_maintenance
            AnnotationCategory.Trip -> R.string.translation_annotation_cat_trip
            AnnotationCategory.Issue -> R.string.translation_annotation_cat_issue
            AnnotationCategory.Upgrade -> R.string.translation_annotation_cat_upgrade
            AnnotationCategory.Custom -> R.string.translation_annotation_cat_custom
        },
    )

/**
 * Builds the merged row readout: the category name (so colour is spoken), then the label, the description if
 * present, and the timestamp — comma-joined so TalkBack voices the row as one coherent sentence.
 */
private fun rowAccessibilityLabel(
    category: String,
    entry: AnnotationEntry,
): String =
    listOfNotNull(
        category,
        entry.label,
        entry.description?.takeIf { it.isNotBlank() },
        entry.timestamp,
    ).joinToString(separator = ", ")
