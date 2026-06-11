// Pure, framework-free model + projection for the Unix Permission tool feature view — the native analogue of
// everything the web component derives via `useMemo` before returning JSX
// (web/src/features/admin/components/devtools/tools/UnixPermissionTool.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// The web tool is a self-contained converter. Its only data hook is `useTranslation`; the octal→symbolic map
// (`PERMS`) is a static constant and the conversion is pure string math over the user's input — there is no
// network feed. This file owns the parts the web `useMemo` computes from the typed octal: the
// `^[0-7]{3}$` guard (a non-matching value yields `null`, the web hidden-grid sentinel), the per-digit
// `PERMS[d] ?? '---'` lookup, the 9-character symbolic string, and its owner/group/other slices
// (`slice(0,3)`, `slice(3,6)`, `slice(6)`). It also carries the preset ladder (verbatim web values, with the
// `"<octal> (<symbolic>)"` labels recomputed from the same projection so they can never drift), the
// `t(key, default)` resolver for the three title/label keys the i18n catalog does not define, and the pure
// top-level surface classifier the composable switches on so each lifecycle branch is testable.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/UnixPermissionTool — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ByteSizeConverter + feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.unixpermissiontool

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object UnixPermissionToolRegistration {
    /** Stable surface id. */
    const val ID: String = "unix-permission-tool"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "UnixPermissionTool"
}

/**
 * The octal-digit → symbolic-triad map — verbatim web `PERMS` (devtools `constants.ts`). Each octal digit
 * `0`…`7` maps to its three-character `r`/`w`/`x` representation; the composable concatenates three of these
 * into the nine-character permission string.
 */
val PERMS: Map<String, String> =
    mapOf(
        "7" to "rwx",
        "6" to "rw-",
        "5" to "r-x",
        "4" to "r--",
        "3" to "-wx",
        "2" to "-w-",
        "1" to "--x",
        "0" to "---",
    )

/** The web `useState('755')` initial octal and the `Input` hint example. */
const val DEFAULT_OCTAL: String = "755"

/** The web `?? '---'` fallback used when an octal digit is not in [PERMS] (defensive; the regex precludes it). */
const val PERMISSION_FALLBACK: String = "---"

/** Required octal length — the web `octal.length !== 3` guard. */
const val OCTAL_LENGTH: Int = 3

/** The web preset `value`s, in source order — the option ladder the select offers. */
val PRESET_OCTALS: List<String> = listOf("755", "644", "700", "600", "777", "444")

/** The web `/^[0-7]{3}$/` validity guard: exactly three octal digits. */
val OCTAL_PATTERN: Regex = Regex("^[0-7]{3}$")

/**
 * One fully projected, render-ready symbolic permission — the native analogue of the web `symbolic` value plus
 * the three `slice(...)` reads the JSX performs. Pure data (no Compose types) so the projection is unit-tested
 * without a UI host. [full] is the nine-character string; [owner]/[group]/[other] are its three triads.
 */
data class SymbolicPermission(
    val full: String,
    val owner: String,
    val group: String,
    val other: String,
)

/** One preset select option — a stable octal [value] and its display [label] (`"<value> (<symbolic>)"`). */
data class PresetOption(
    val value: String,
    val label: String,
)

/**
 * The three mutually-exclusive top-level surfaces the composable renders. The Unix permission tool has no
 * network feed, so a host normally supplies [Ready]; [Loading] and [Error] are the lifecycle chrome the shared
 * feature-view contract (P1/S8) can still carry — reproduced for full state coverage, never faked from a fetch
 * the tool does not perform.
 */
enum class UnixPermSurfaceState { Loading, Error, Ready }

/**
 * Classifies the host lifecycle flags into the top-level [UnixPermSurfaceState] — the pure mirror of the
 * composable's `when` (loading first, then hard error, otherwise the ready converter). Kept framework-free so
 * each branch is asserted off-device.
 */
fun unixPermSurfaceFor(
    isLoading: Boolean,
    isError: Boolean,
): UnixPermSurfaceState =
    when {
        isLoading -> UnixPermSurfaceState.Loading
        isError -> UnixPermSurfaceState.Error
        else -> UnixPermSurfaceState.Ready
    }

/**
 * The pure projection the composable renders — the native mirror of the web component's `useMemo` block plus
 * its preset list. Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object UnixPermissionToolProjection {
    /**
     * Converts the typed [octal] the way the web `useMemo` does: a value that is not exactly [OCTAL_LENGTH]
     * octal digits (`^[0-7]{3}$`) yields `null` — the web sentinel that hides the grid (rendered here as an
     * always-visible empty hint). Otherwise each digit is mapped through [PERMS] (with the `?? '---'`
     * fallback) and the nine-character result is sliced into its owner/group/other triads.
     */
    fun symbolicFor(octal: String): SymbolicPermission? {
        if (octal.length != OCTAL_LENGTH || !OCTAL_PATTERN.matches(octal)) return null
        val full =
            buildString {
                octal.forEach { digit -> append(PERMS[digit.toString()] ?: PERMISSION_FALLBACK) }
            }
        return SymbolicPermission(
            full = full,
            owner = full.substring(0, 3),
            group = full.substring(3, 6),
            other = full.substring(6),
        )
    }

    /**
     * The display label for a preset octal — the web `"755 (rwxr-xr-x)"` form, recomputed from [symbolicFor]
     * so the label can never drift from the conversion. An octal that fails the guard folds to the bare value.
     */
    fun presetLabel(octal: String): String {
        val symbolic = symbolicFor(octal) ?: return octal
        return "$octal (${symbolic.full})"
    }

    /** The full preset option ladder — [PRESET_OCTALS] paired with their [presetLabel]s, in source order. */
    fun presetOptions(): List<PresetOption> = PRESET_OCTALS.map { octal -> PresetOption(octal, presetLabel(octal)) }

    /**
     * Folds a permission-class [label] and its [value] into a single TalkBack content description
     * ("<label>, <value>") so each owner/group/other cell reads as one node.
     */
    fun classCellDescription(
        label: String,
        value: String,
    ): String = "$label, $value"
}

/**
 * The web `t(key, default)` fallback strings. The web calls `t('Unix Perm')`, `t('Unix Perm Desc')`, and
 * `t('Octal Perm')`, whose keys exist in no i18n catalog (and must not be added to the generated,
 * drift-checked catalog — ADR-014), so i18next renders the key text itself; these defaults reproduce that
 * exactly. [EMPTY_HINT] is the friendly "no valid octal yet" microcopy the always-visible empty state shows
 * where the web hides the grid.
 */
object UnixPermissionToolDefaults {
    /** Web `t('Unix Perm')` → "Unix Perm" (no catalog entry, so i18next returns the key). */
    const val TITLE: String = "Unix Perm"

    /** Web `t('Unix Perm Desc')` → "Unix Perm Desc" (no catalog entry, so i18next returns the key). */
    const val DESCRIPTION: String = "Unix Perm Desc"

    /** Web `t('Octal Perm')` → "Octal Perm" (no catalog entry, so i18next returns the key). */
    const val OCTAL_LABEL: String = "Octal Perm"

    /** Native-only empty hint (no valid octal entered) — the always-visible counterpart to the web hidden grid. */
    const val EMPTY_HINT: String = "Enter a 3-digit octal (e.g. 755)"
}

/** Resource name for the web `Unix Perm` title key (by-name; absent ⇒ [UnixPermissionToolDefaults.TITLE]). */
const val KEY_TITLE: String = "translation_Unix_Perm"

/** Resource name for the web `Unix Perm Desc` key (by-name; absent ⇒ [UnixPermissionToolDefaults.DESCRIPTION]). */
const val KEY_DESCRIPTION: String = "translation_Unix_Perm_Desc"

/** Resource name for the web `Octal Perm` label key (by-name; absent ⇒ [UnixPermissionToolDefaults.OCTAL_LABEL]). */
const val KEY_OCTAL_LABEL: String = "translation_Octal_Perm"

/** Resource name for the empty hint (by-name; absent ⇒ [UnixPermissionToolDefaults.EMPTY_HINT]). */
const val KEY_EMPTY_HINT: String = "translation_unixPerm_enterOctal"

/**
 * Reproduces i18next's `t(key, default)` against the native i18n facade: returns the [lookup] result for
 * [resourceName] when it resolves to a non-blank string, otherwise the [fallback] default. [lookup] is a thin
 * seam over the Android string catalog in production (an optional by-name resource read) and a map in tests,
 * so the resolve-or-fallback decision stays pure and unit-tested.
 */
fun resolveOptional(
    lookup: (String) -> String?,
    resourceName: String,
    fallback: String,
): String = lookup(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * Localized microcopy folded into the surface — the web `t('Unix Perm')`, `t('Unix Perm Desc')`,
 * `t('Octal Perm')`, `t('Presets')`, `t('Owner')`, `t('Group')`, and `t('Other')` strings plus the
 * always-visible empty hint and the copy-button labels. The composable builds this from the i18n facade; tests
 * pass a deterministic instance.
 */
data class UnixPermissionToolStrings(
    val title: String,
    val description: String,
    val octalLabel: String,
    val presetsLabel: String,
    val ownerLabel: String,
    val groupLabel: String,
    val otherLabel: String,
    val emptyHint: String,
    val copyLabel: String,
    val copiedLabel: String,
)
