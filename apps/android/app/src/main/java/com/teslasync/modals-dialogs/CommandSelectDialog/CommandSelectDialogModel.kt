// Pure, framework-free model + projection for the CommandSelectDialog modal/dialog surface — the native analogue of
// everything the web component derives before it returns JSX (web/src/features/system/components/CommandSelectDialog.tsx).
// No Compose, no Android, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest
// gate, so the composable stays a thin render layer over these pure functions.
//
// The web component is the option picker raised from a "select"-type vehicle command tile (e.g. seat-heater level,
// steering-wheel-heat level): a *controlled* dialog whose only data dependency is `useTranslation` (i18n, P1/S10). It
// binds no fetch and owns no store — the option list arrives pre-built in the `def: CommandDef` prop (the page's static
// `commands.ts` config), the owner decides when it is `open`, and the chosen option's value is handed straight back to
// the owner through `onSelect(opt.value)`. So (exactly like the sibling ConfirmDialog / AcknowledgeAlertDialog surfaces)
// the cache-then-network lifecycle (loading / empty / error / stale / offline) belongs to the OWNING command surface
// that decides to raise this picker, NOT here; modelling fetch error / stale / offline phases would invent behaviour the
// web spec does not have (drift — Honesty Covenant §9). The branches the web source actually defines are this surface's
// complete state set, and each is projected here:
//   1. the per-option disabled state while a command is dispatching (web `disabled={loading}` + the `opacity-50
//      cursor-not-allowed` wash) — [isOptionEnabled],
//   2. the optional per-option description sub-line (web `opt.description && (...)`) — [visibleDescription] /
//      [hasDescription],
//   3. the option list itself (web `sc.options.map(...)`) — and its empty projection [isEmpty] / [hasOptions], which the
//      composable renders as a friendly empty state rather than the blank `space-y-2` box the web would collapse to when
//      a malformed `selectConfig` carries no options (a native polish that never hides the surface).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/CommandSelectDialog — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally diverges
// from the path — exactly as the sibling modal/dialog surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.commandselectdialog

import io.teslasync.shared.core.diagnostics.Logger

/**
 * One selectable command option — the native, already-localized mirror of the web `SelectOption`
 * (`features/system/commands.ts`) after `t(opt.labelKey, opt.labelFallback)` has resolved. The owning command surface
 * (which owns the `commands.ts` config + `useTranslation`) resolves [label] at the i18n boundary; [description] is the
 * raw, optional sub-line the web renders verbatim (web `opt.description`, never a key). [value] is the opaque token the
 * command dispatch uses and is what [CommandSelectDialog]'s `onSelect` hands back (web `onSelect(opt.value)`).
 *
 * @property value the parameter value submitted when this option is chosen (web `opt.value`).
 * @property label the localized option label shown as the option's primary line (web `t(opt.labelKey, …)`).
 * @property description an optional secondary descriptor; shown only when non-blank (web `opt.description`).
 */
data class CommandSelectOption(
    val value: String,
    val label: String,
    val description: String? = null,
)

/**
 * The pure derivations the composable renders over — the native mirror of the web component's inline `sc.options.map`,
 * the per-option `disabled={loading}` guard, and the `opt.description && …` conditional. Stateless and
 * side-effect-free, so it is fully covered by the off-device unit gate.
 */
object CommandSelectDialogProjection {
    /** Whether the picker has at least one option to show (web `sc.options.length > 0`). */
    fun hasOptions(options: List<CommandSelectOption>): Boolean = options.isNotEmpty()

    /**
     * Whether the picker resolved to no options — drives the friendly empty state instead of the blank `space-y-2`
     * box the web would render. A malformed/empty `selectConfig.options` is the only way this is true.
     */
    fun isEmpty(options: List<CommandSelectOption>): Boolean = options.isEmpty()

    /**
     * Whether an option button is actionable — the inverse of the web `disabled={loading}` (and the `opacity-50
     * cursor-not-allowed` wash). Every option disables together while a command dispatch is in flight.
     */
    fun isOptionEnabled(loading: Boolean): Boolean = !loading

    /**
     * Whether an option carries a visible description sub-line — the web `opt.description && (...)` truthiness. A
     * `null`, empty, or whitespace-only description is not shown.
     */
    fun hasDescription(option: CommandSelectOption): Boolean = !option.description.isNullOrBlank()

    /**
     * The description sub-line to render, or `null` when there is none — the native resolution of the web
     * `opt.description && (...)` conditional. Whitespace-only descriptions collapse to `null` so the sub-line is
     * never an empty row.
     */
    fun visibleDescription(option: CommandSelectOption): String? = option.description?.takeIf { it.isNotBlank() }
}

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object CommandSelectDialogRegistration {
    /** Stable surface id. */
    const val ID: String = "command-select-dialog"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "CommandSelectDialog"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface
 * [CommandSelectDialogRegistration.SLUG] — never the command label, the option values/labels, or the chosen value — so
 * a diagnostics line can never leak which command the operator is configuring. Kept free of Compose so it is
 * unit-tested with a recording [Logger]; the composable calls it from its first-composition effect.
 */
object CommandSelectDialogDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to CommandSelectDialogRegistration.SLUG))
    }
}
