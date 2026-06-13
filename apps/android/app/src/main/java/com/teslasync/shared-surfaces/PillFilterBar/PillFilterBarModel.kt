// Pure, framework-free model + projection + diagnostics for the PillFilterBar shared surface — the native
// analogue of web/src/components/forms/PillFilterBar.tsx together with the only hook it reads
// (React `useId`, mapped to the P1/S8 id seam in PillFilterBarSource.kt) and the integer formatter it
// delegates the count to (web/src/lib/numberFormat.ts `fmtInt`). No Compose, no Android framework, no
// HTTP: every declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): `PillFilterBar`
// is an accessible single-select filter row implementing the WAI-ARIA Tabs pattern — a `tablist` whose
// `tab` pills switch a "pick one" collection (trend metric switchers, All / Anomalies / Notable list
// filters, …). The PARENT owns the data: it passes the immutable `items`, the controlled `activeKey`, and
// an `onChange` callback. The component itself fetches nothing; its single hook is `useId`, used purely to
// mint the stable per-tab element ids (`${tablistId}-tab-${key}`). Its real render decisions, all
// reproduced here:
//   * each pill resolves selected = activeKey === key, an accent (web `item.accent ?? 'cyan'`), a disabled
//     flag, an optional left icon, the label, and an optional count rendered as the muted suffix
//     `({fmtInt(count)})` — reduced into [PillView];
//   * `variant` switches the chrome (rounded `pills` with an active fill + dot, or flat `tabs` with a
//     bottom-border underline) — carried as [PillVariant];
//   * `scrollable` allows horizontal overflow on small screens — carried into the render layer;
//   * the per-tab element id is `${tablistId}-tab-${key}` — reproduced by [pillTabId].
// The keyboard contract (web Arrow/Home/End moving focus + activation among the enabled keys) is NOT a
// projection concern: on Android it maps to the platform focus system + `selectableGroup`, so it lives in
// the composable, not here (documented in PillFilterBar.kt).
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// surface is PURE PRESENTATIONAL — it renders the controlled collection the parent already holds and
// fetches nothing, so it never loads, errors, goes stale or goes offline. Modelling those would fabricate
// behaviour the web spec does not have (Honesty Covenant: no scope narrowing, no silent drift) — the same
// rationale the accepted sibling presentational ports Delta / ScoreBadge document. Its REAL, fully
// reproduced states are the populated row ([PillFilterBarProjection.Resolved], every per-pill branch:
// selected / unselected, enabled / disabled, with / without icon, with / without count, each accent) and
// the no-items branch ([PillFilterBarProjection.Empty]). The web renders an empty `tablist` when `items`
// is empty; the native port resolves that to a friendly empty surface so a panel is never a blank box
// (the P3 "every state renders" contract).
//
// SI boundary (unit-conversion instructions, Phase-48): the only number this surface formats is a unitless
// item count, so — like the web component, which feeds it straight to `fmtInt` — this projection performs
// no display-unit conversion and the surface needs no live unit formatter.
//
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations; `InvalidPackageDeclaration`
// because the mandated surface directory (com/teslasync/shared-surfaces/PillFilterBar — the P3 prompt's
// allowed-files path) cannot form a valid Kotlin package (a hyphen segment and a PascalCase leaf are
// illegal in a package identifier), so the package intentionally diverges from the path — exactly as the
// sibling shared surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pillfilterbar

import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/**
 * Canonical registry metadata for the PillFilterBar surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`PillFilterBar`).
 */
object PillFilterBarRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the filter bar with). */
    const val ID: String = "pillFilterBar"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "PillFilterBar"
}

/**
 * The chrome style of the bar — the native tag for the web `variant` prop (`'pills' | 'tabs'`). [Pills]
 * (web default) renders rounded chips with an active accent fill + leading dot; [Tabs] renders a flat row
 * underlined by a bottom border on the active item. The render boundary maps this onto the chip shape.
 */
enum class PillVariant {
    /** Web `variant="pills"` (default) — rounded-full chips with an active fill. */
    Pills,

    /** Web `variant="tabs"` — a flat row with a bottom-border underline on the active item. */
    Tabs,
}

/**
 * The accent a pill paints with — the native mirror of the web `PillItem['accent']` union
 * (`'cyan' | 'green' | 'amber' | 'red' | 'purple' | 'blue'`). Kept render-agnostic (an enum, never a raw
 * hex) so the off-device test can assert the choice without a Compose host; the composable maps each onto
 * a per-app design token (P1/S9) at the boundary. Web default is [Cyan] (`item.accent ?? 'cyan'`).
 */
enum class PillAccent {
    /** Web `'cyan'` (the default). */
    Cyan,

    /** Web `'green'`. */
    Green,

    /** Web `'amber'`. */
    Amber,

    /** Web `'red'`. */
    Red,

    /** Web `'purple'`. */
    Purple,

    /** Web `'blue'`. */
    Blue,

    ;

    companion object {
        /** The accent applied when an item supplies none — the web `item.accent ?? 'cyan'` fallback. */
        val DEFAULT: PillAccent = Cyan
    }
}

/**
 * The framework-free fields of one pill — the native analogue of the web `PillItem` value fields. The
 * optional icon (web `icon?: ReactNode`) is NOT here: it is an `ImageVector` (a Compose type) carried by
 * the public [io.teslasync.android.sharedsurfaces.pillfilterbar.PillFilterBarItem] and rendered at the
 * boundary, keeping this model purely off-device-testable.
 *
 * @property key the stable identifier written to `onChange` (web `item.key`).
 * @property label the visible label (web `item.label`).
 * @property count an optional count rendered as the muted `(N)` suffix (web `item.count`).
 * @property accent the accent tint (web `item.accent`); defaults to [PillAccent.DEFAULT].
 * @property disabled when `true` the pill is non-interactive and dimmed (web `item.disabled`).
 */
data class PillItemInput(
    val key: String,
    val label: String,
    val count: Int? = null,
    val accent: PillAccent = PillAccent.DEFAULT,
    val disabled: Boolean = false,
)

/**
 * The caller-supplied inputs the projection consumes — the framework-free analogue of the web
 * `PillFilterBarProps` fields that drive the per-pill data. [items] is the controlled collection and
 * [activeKey] the controlled selection (web `activeKey`). The chrome (`variant`) and overflow (`scrollable`)
 * flags are render-only and stay on the composable, never entering the projection (mirroring the web split
 * between mapped item state and presentational classes).
 */
data class PillFilterBarInput(
    val items: List<PillItemInput>,
    val activeKey: String,
)

/**
 * The fully reduced, render-ready projection of one pill — everything the composable needs to paint a
 * single chip, derived purely so every branch is covered off-device. The view only resolves the accent
 * token, the chip chrome, and the accessible state, then draws the [label] (+ optional icon + [countText]).
 *
 * @property key the pill's stable id (web `item.key`); echoed to `onChange` on click.
 * @property label the visible label (web `{item.label}`).
 * @property countText the formatted muted suffix `(N)` (web `({fmtInt(item.count)})`), or `null` when the
 *   item carries no count.
 * @property accent the resolved accent (web `item.accent ?? 'cyan'`), mapped to a token at the boundary.
 * @property selected whether this pill is the active one (web `activeKey === item.key`).
 * @property disabled whether this pill is non-interactive (web `item.disabled`).
 */
data class PillView(
    val key: String,
    val label: String,
    val countText: String?,
    val accent: PillAccent,
    val selected: Boolean,
    val disabled: Boolean,
)

/**
 * The projected render state the bar paints — the native analogue of the web component's two real render
 * outcomes. Framework-free so the whole contract is covered by the JVM unit gate without a Compose host.
 */
sealed interface PillFilterBarProjection {
    /**
     * The web empty-`items` outcome. The web renders an empty `tablist`; the native port resolves it to a
     * friendly empty surface (the P3 "never a blank box" contract).
     */
    data object Empty : PillFilterBarProjection

    /**
     * The populated row — one [PillView] per item, in source order, each carrying its selected / accent /
     * disabled / count branch (web maps `items.map(...)`).
     */
    data class Resolved(
        val pills: List<PillView>,
    ) : PillFilterBarProjection

    companion object {
        /**
         * Projects [input] (with the user's [locale] for the count's grouping separators) into the branch
         * the composable paints — the native mirror of everything the web `PillFilterBar` decides before
         * its returned JSX. An empty collection renders [Empty]; otherwise every item is reduced into a
         * [PillView] (web `items.map`), preserving source order so arrow navigation and visual order match.
         */
        fun project(
            input: PillFilterBarInput,
            locale: Locale,
        ): PillFilterBarProjection =
            if (input.items.isEmpty()) {
                Empty
            } else {
                Resolved(input.items.map { toPillView(it, input.activeKey, locale) })
            }

        private fun toPillView(
            item: PillItemInput,
            activeKey: String,
            locale: Locale,
        ): PillView =
            PillView(
                key = item.key,
                label = item.label,
                countText = item.count?.let { formatPillCount(it, locale) },
                accent = item.accent,
                selected = activeKey == item.key,
                disabled = item.disabled,
            )
    }
}

/**
 * Formats a pill [count] as the muted parenthesised suffix the web renders (`({fmtInt(item.count)})`).
 * `fmtInt` is locale-grouped integer formatting (`fmtInt(12345) → "12,345"`); the native mirror is the
 * grouped integer conversion `%,d` against the user's [locale].
 */
fun formatPillCount(
    count: Int,
    locale: Locale,
): String = "(${String.format(locale, "%,d", count)})"

/**
 * Composes the stable per-tab element id — the native mirror of the web `${tablistId}-tab-${item.key}`.
 * [tablistId] is the value minted by the `useId` seam (P1/S8); the composable uses the result as each
 * pill's test / semantics tag so assistive tech and instrumented tests can address a single pill.
 */
fun pillTabId(
    tablistId: String,
    key: String,
): String = "$tablistId-tab-$key"

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [PillFilterBarRegistration.SLUG]
 * (P1/S11) — never an item key, label or count, so a diagnostics line can never leak what a user filtered
 * by. Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it once per
 * surface open.
 */
fun recordPillFilterBarOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to PillFilterBarRegistration.SLUG))
}
