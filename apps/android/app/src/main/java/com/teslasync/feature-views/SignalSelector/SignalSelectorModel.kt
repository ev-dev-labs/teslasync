// Pure, framework-free model + projection for the SignalSelector feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/telemetry/components/SignalSelector.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// SignalSelector is the `ComboboxMulti` wrapper specialised for signal names. The web component is a
// controlled control — it takes `options` / `value` and the `onChange` callback as props from whichever
// page mounts it (e.g. the Signal Explorer filter, which owns the per-vehicle signal-catalog query and the
// selected-signals client state). The owning page gates the cache-then-network lifecycle: it renders a
// skeleton while the catalog loads, a QueryError on failure, and an EmptyState when the vehicle exposes no
// signals, mounting this control only once options have resolved. So, exactly as the sibling presentational
// ports (WeekSelector, StatusHeader) document, the loading / error / stale / offline states live on the
// owning page, not here; the branches the web source itself defines are the complete state set this surface
// renders, namely: the label form (an explicit `labelOverride`, the capped `Signals (N / max)`, or the
// uncapped `Signals (N)`), the optional layer-help affordance (`showLayerHelp`), the hard selection cap
// (`max`, default 5, `null` for no cap), and the resolved-but-empty options set (a friendly empty note
// rather than a blank box). The only data source the web component itself binds is `useTranslation`, mapped
// natively to the generated i18n catalog (P1/S10).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SignalSelector — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalselector

import io.teslasync.android.components.forms.ComboOption
import io.teslasync.shared.core.diagnostics.Logger

/**
 * The fully projected, render-ready view — the native analogue of everything the web component decides
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property label the resolved label text the header renders — web's
 *   `labelOverride ?? (max != null ? "Signals (N / max)" : "Signals (N)")`.
 * @property showLayerHelp whether the live-state-layer help affordance renders beside the label — web's
 *   `showLayerHelp ? <HelpTooltip … /> : null`.
 * @property options every signal mapped to a [ComboOption]; an option is `enabled` when it is already
 *   selected (so it can be removed) or the cap has not been reached — the native analogue of the web
 *   `maxItems` guard that disables further additions once `value.length >= max`.
 * @property selectedValues the current selection as a set, fed straight to the shared `ComboboxMulti`.
 * @property atCap whether the selection has reached [max] — web `value.length >= maxItems`.
 * @property hasOptions whether any signal is available to pick; drives the friendly empty note so the
 *   surface is never a blank box when the catalog resolves empty.
 */
data class SignalSelectorDisplay(
    val label: String,
    val showLayerHelp: Boolean,
    val options: List<ComboOption>,
    val selectedValues: Set<String>,
    val atCap: Boolean,
    val hasOptions: Boolean,
)

/**
 * Pure projection from the surface's inputs to its render-ready [SignalSelectorDisplay] — a 1:1 port of the
 * decisions the web component makes: the three label forms, the `showLayerHelp` gate, and the hard cap that
 * both disables further additions and slices the emitted selection. Side-effect-free, so it is fully
 * covered by the off-device unit gate.
 */
object SignalSelectorProjection {
    /** Default hard cap — web `max = 5`, chosen to keep a chart legible. Pass `null` for no cap. */
    const val DEFAULT_MAX: Int = 5

    /**
     * Build the header label. Mirrors the web ternary exactly: an explicit [labelOverride] wins verbatim;
     * otherwise the localised [signalsWord] is suffixed with the live `(count / max)` when a cap is set, or
     * `(count)` when uncapped. [signalsWord] is supplied already-localised (the composable resolves it from
     * the catalog) so this stays framework-free and testable. The composable composes this with [project]:
     * it resolves the label here, then hands it to [project] alongside the raw inputs.
     */
    fun resolveLabel(
        signalsWord: String,
        count: Int,
        max: Int?,
        labelOverride: String?,
    ): String = labelOverride ?: if (max != null) "$signalsWord ($count / $max)" else "$signalsWord ($count)"

    /**
     * Assemble the render-ready [SignalSelectorDisplay] from the already-resolved [label] (see [resolveLabel])
     * and the raw inputs. [value] is the ordered current selection (mirrors the web `value: string[]`); it is
     * exposed to the shared combobox as a set and is also the source of [atCap]. When the cap is reached,
     * every not-yet-selected option is disabled — the native analogue of the web `maxItems` guard — while
     * selected options stay enabled so they can be removed.
     */
    fun project(
        label: String,
        options: List<String>,
        value: List<String>,
        max: Int?,
        showLayerHelp: Boolean,
    ): SignalSelectorDisplay {
        val selected = value.toSet()
        val atCap = max != null && value.size >= max
        val comboOptions =
            options.map { name ->
                ComboOption(value = name, label = name, enabled = name in selected || !atCap)
            }
        return SignalSelectorDisplay(
            label = label,
            showLayerHelp = showLayerHelp,
            options = comboOptions,
            selectedValues = selected,
            atCap = atCap,
            hasOptions = options.isNotEmpty(),
        )
    }

    /**
     * Compute the next selection when [signal] is toggled. Removing is always allowed; adding appends to the
     * ordered selection and then clamps to [max] — the native analogue of the web
     * `onChange(Number.isFinite(cap) ? next.slice(0, cap) : next)` safety slice. A `null` [max] means no cap.
     */
    fun applyToggle(
        current: List<String>,
        signal: String,
        max: Int?,
    ): List<String> {
        val next = if (signal in current) current.filterNot { it == signal } else current + signal
        return if (max != null) next.take(max.coerceAtLeast(0)) else next
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * signal names, which can fingerprint a vehicle's capabilities or a user's interests — so a diagnostics line
 * can never leak which signals an operator was inspecting.
 */
object SignalSelectorDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "SignalSelector"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
