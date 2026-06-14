// Pure, framework-free model + projection + a11y affordances + diagnostics for the WidgetDetailCard shared
// widget primitive — the native analogue of every decision the web component makes
// (web/src/features/dashboard/widgets/shared/WidgetDetailCard.tsx) before it paints. No Compose, no Android,
// no HTTP: every declaration here is exercised off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A PURE, presentational building block reused by many dashboard widgets: it takes a list of
//     `DetailEntry { label, value: string | number | null, badge?, mono? }` plus a `compact` flag, an
//     `emptyMessage` and an `emptyIcon`, and renders a vertically-scrolling stack of label/value rows. There is
//     NO hook, NO fetch and NO data port to bind (no P1/S8 state holder, no Source/ViewModel) — modelling one
//     would invent an async dependency the web spec does not have (honesty covenant: no scope narrowing, no
//     silent drift). The sibling presentational ports Accordion / VisuallyHidden set the same precedent
//     (composable + pure model, no Source/ViewModel).
//   • So the surface's REAL, fully-reproduced states are: the EMPTY state (web `entries.length === 0` → the
//     shared `EmptyState`, never a blank box) and the POPULATED state crossed with its per-row branches — a
//     badge present/absent (web `{entry.badge && …}`), a monospace value vs a proportional one (web
//     `entry.mono && 'font-mono'`), a null value rendered as an em dash (web `entry.value ?? '—'`), the
//     compact cap that shows at most the first four rows (web `compact ? entries.slice(0, 4) : entries`), and
//     the hairline divider under every row except the last (web `i < visible.length - 1 && 'border-b …'`).
//     Each is reduced here in [projectWidgetDetailCard] and asserted off-device, doubling as the per-state
//     snapshot.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// primitive fetches nothing — its rows are handed in by the parent widget. There is no query to be loading, to
// fail, to go stale, or to be offline, so inventing those states would be dishonest. The owning widget that DOES
// fetch (and can be loading / stale / offline) renders its own data surface and only hands this card the rows it
// already resolved.
//
// i18n: the web source renders no `t()` key of its own (its labels, values and `emptyMessage` are all
// caller-supplied, already-localized strings); its ONLY built-in string is the hardcoded English default
// `'No details available'`. That default resolves here through the i18n facade by-name ([resolveOptional], the
// native mirror of i18next `t(key, default)`) with the English [WidgetDetailCardDefaults.EMPTY_MESSAGE] fallback
// — exactly the Accordion precedent for a string the web owns implicitly rather than through the catalog — so no
// English literal is hardcoded at the render boundary and a future catalog entry is picked up automatically.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/widget-primitives/WidgetDetailCard — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgetdetailcard

import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no label, value, or badge —
 * only this constant identifier — so a diagnostics line can never leak what the card shows. Matches the
 * prompt-mandated surface slug (`WidgetDetailCard`).
 */
const val WIDGET_DETAIL_CARD_SLUG: String = "WidgetDetailCard"

/**
 * The semantic tone of a [DetailBadge] — the native tag for the web `badge.variant`
 * (`'success' | 'warning' | 'error' | 'neutral'`). Mapped onto the shared [BadgeVariant] at the render boundary
 * by [badgeVariantFor], the faithful port of the web `badgeVariantMap`.
 */
enum class DetailBadgeVariant { Success, Warning, Error, Neutral }

/**
 * An optional status chip rendered after a row's value — the native analogue of the web
 * `badge?: { text; variant }`. [text] is a caller-supplied, already-localized short label; [variant] selects the
 * chip's tone.
 */
data class DetailBadge(
    val text: String,
    val variant: DetailBadgeVariant,
)

/**
 * One label/value row handed in by the parent widget — the native analogue of the web `DetailEntry`.
 *
 * @property label the row's caller-supplied, already-localized label (web `label`); shown uppercased + muted.
 * @property value the row's already-formatted display string (web `value`); `null` renders as an em dash
 *   ([EM_DASH]), exactly as the web `entry.value ?? '—'`. Numbers are formatted to a string at
 *   the call site (the native convention), mirroring React's `string | number` coercion.
 * @property badge an optional trailing status chip (web `badge`); `null` ⇒ no chip.
 * @property mono renders the value in a monospace face when `true` (web `entry.mono && 'font-mono'`).
 */
data class DetailEntry(
    val label: String,
    val value: String?,
    val badge: DetailBadge? = null,
    val mono: Boolean = false,
)

/** The em dash shown for a null value — the native mirror of the web `entry.value ?? '—'`. */
const val EM_DASH: String = "\u2014"

/** How many rows the compact variant shows at most — the native mirror of web `entries.slice(0, 4)`. */
const val COMPACT_ROW_LIMIT: Int = 4

/**
 * A render-ready row reduced from a [DetailEntry] — everything the view needs to draw one line, so the value
 * fallback, the divider rule and the slot flags are decided once here and unit-tested off-device.
 *
 * @property label the (original-case) row label; the view uppercases it for display while a11y reads this.
 * @property value the resolved display value (web `value ?? '—'`); never null.
 * @property badge the optional trailing chip, carried through verbatim.
 * @property mono whether the value renders monospace.
 * @property showDivider whether a hairline divider is drawn beneath the row — every row except the last
 *   (web `i < visible.length - 1`).
 */
data class DetailRow(
    val label: String,
    val value: String,
    val badge: DetailBadge?,
    val mono: Boolean,
    val showDivider: Boolean,
)

/**
 * The render-ready classification of the whole card — either the empty branch (web `entries.length === 0`) or
 * the populated list of [rows]. The card always renders SOMETHING (rows or the friendly empty state), so there
 * is no hidden surface.
 *
 * @property isEmpty no rows were supplied — the view shows the shared empty state, never a blank box.
 * @property rows the render-ready rows in order (empty when [isEmpty]).
 */
data class WidgetDetailCardRender(
    val isEmpty: Boolean,
    val rows: List<DetailRow>,
)

/**
 * Resolve a row's display value — the native mirror of the web `entry.value ?? '—'`. A non-null value
 * (including the empty string and `"0"`) is shown verbatim; only `null` becomes the em dash.
 */
fun resolveDetailValue(value: String?): String = value ?: EM_DASH

/**
 * The rows actually drawn for [entries] — all of them, or the first [COMPACT_ROW_LIMIT] when [compact] is set
 * (web `compact ? entries.slice(0, 4) : entries`). `take` is safe when fewer than the cap exist.
 */
fun visibleDetailEntries(
    entries: List<DetailEntry>,
    compact: Boolean,
): List<DetailEntry> = if (compact) entries.take(COMPACT_ROW_LIMIT) else entries

/**
 * Reduce the parent's [entries] into the render-ready [WidgetDetailCardRender]. Pure (no Compose). An empty
 * list flags [WidgetDetailCardRender.isEmpty] so the view shows the shared empty state (the prompt's
 * "empty → friendly empty state, never a blank box" contract); otherwise each visible entry becomes a
 * [DetailRow] with its value resolved and its divider flagged for every row but the last.
 */
fun projectWidgetDetailCard(
    entries: List<DetailEntry>,
    compact: Boolean,
): WidgetDetailCardRender {
    if (entries.isEmpty()) {
        return WidgetDetailCardRender(isEmpty = true, rows = emptyList())
    }
    val visible = visibleDetailEntries(entries, compact)
    val lastIndex = visible.size - 1
    val rows =
        visible.mapIndexed { index, entry ->
            DetailRow(
                label = entry.label,
                value = resolveDetailValue(entry.value),
                badge = entry.badge,
                mono = entry.mono,
                showDivider = index < lastIndex,
            )
        }
    return WidgetDetailCardRender(isEmpty = false, rows = rows)
}

/**
 * Map a [DetailBadgeVariant] onto the shared [BadgeVariant] — the faithful port of the web `badgeVariantMap`
 * (`success→success, warning→warning, error→danger, neutral→neutral`). Kept pure so the mapping is unit-tested
 * without a Compose host; `error` deliberately lands on [BadgeVariant.Danger] (the shared chip's tone name).
 */
fun badgeVariantFor(variant: DetailBadgeVariant): BadgeVariant =
    when (variant) {
        DetailBadgeVariant.Success -> BadgeVariant.Success
        DetailBadgeVariant.Warning -> BadgeVariant.Warning
        DetailBadgeVariant.Error -> BadgeVariant.Danger
        DetailBadgeVariant.Neutral -> BadgeVariant.Neutral
    }

/**
 * The single spoken description for a row — so TalkBack reads "label, value[, badge]" as one unit instead of
 * spelling out the visually-uppercased label letter by letter. Built from the ORIGINAL-case [DetailRow.label]
 * and the resolved value (and badge text when present), it is applied at the render boundary with
 * `clearAndSetSemantics`. Pure so the a11y label is unit-tested off-device.
 */
fun detailRowContentDescription(row: DetailRow): String =
    buildString {
        append(row.label)
        append(": ")
        append(row.value)
        row.badge?.let { badge ->
            append(", ")
            append(badge.text)
        }
    }

/**
 * Native-only default copy — the web source's one built-in string. Absent a catalog hit this English fallback is
 * used (the native mirror of i18next's default argument), matching the Accordion precedent for a string the web
 * owns implicitly rather than through a `t()` key.
 */
object WidgetDetailCardDefaults {
    /** The default empty-state message — web `emptyMessage ?? 'No details available'`. */
    const val EMPTY_MESSAGE: String = "No details available"
}

/** Resource name for the default empty-state message (by-name; absent ⇒ the English [WidgetDetailCardDefaults.EMPTY_MESSAGE]). */
const val KEY_WIDGET_DETAIL_CARD_EMPTY: String = "translation_widget_detailCard_empty"

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a thin
 * seam over the Android string catalog in production (an optional by-name resource read) and a map in tests, so
 * the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a label,
 * value, or badge — so a diagnostics line can never leak what the card shows.
 */
object WidgetDetailCardDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = WIDGET_DETAIL_CARD_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
