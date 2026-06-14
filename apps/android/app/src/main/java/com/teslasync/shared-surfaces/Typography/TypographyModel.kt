// Pure, framework-free model + role/size/weight/color taxonomy + projection + diagnostics for the Typography
// shared surface — the native analogue of every decision the web module makes (web/src/components/ui/Typography.tsx)
// before it renders text. No Compose, no Android, no HTTP: every declaration here is exercised off-device in the
// :app:testReleaseUnitTest gate, keeping the composable in Typography.kt a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): a pure presentational
// typography primitive built over the `@/lib/tokens` type tokens. It exports:
//   • Heading(level) — one of four heading levels (page / section / panel / sub), each bound to a composed role
//     (pageTitle / sectionTitle / panelTitle / subhead) and a default semantic tag, with an `as` escape hatch to
//     override the rendered tag;
//   • Text(variant | size + weight + color + mono) — either a pre-composed role (`variant`, which when set makes
//     size/weight/color irrelevant), or a granular size/weight/color with an optional monospace family;
//   • the convenience wrappers PageTitle / SectionTitle / PanelTitle / Subhead (headings) and
//     Caption / HelperText / ErrorText / Label / MetricValue / MetricLabel / Code (roled text), each a 1:1 binding
//     to a role. ErrorText additionally carries the web `role="alert"` assertive announcement.
// All thirteen roles, eight sizes, four weights, six colors, the monospace family, and the four heading levels are
// modelled below and reduced by [specForRole] / [headingRole] / [fontSizeSp], so the composable never hand-picks a
// `fontSize` or `Color`.
//
// The web source has NO `useTranslation` and NO `t()` call — every string is the caller's `children`, never a
// literal the component owns. So this surface adds NO i18n keys and NO English literal (honesty covenant: no silent
// drift). It likewise has NO data hook, NO fetch, and NO data port to bind (no P1/S8 Source/ViewModel): modelling
// an async dependency would invent one the web spec does not have. The presentational precedents are the sibling
// Checkbox / Label surfaces (composable + model, no Source).
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent: this
// surface fetches nothing — it renders the caller's text in one of the modelled roles (optionally with the granular
// size/weight/color/mono overrides). There is no query to be loading, to be empty, to fail, to go stale, or to be
// offline, so inventing those states would be dishonest. The owning screen that DOES fetch renders its own data
// surface (with those states) and composes this typography once it already has values. The surface's REAL,
// fully-reproduced states are therefore the role / size / weight / color / mono / heading-level branches reduced
// here, each asserted off-device, doubling as the per-state snapshot.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Typography — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally diverges from
// the path — exactly as the sibling Checkbox / Label surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.typography

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no rendered text — only this
 * constant identifier — so a diagnostics line can never leak what the surface is displaying.
 */
const val TYPOGRAPHY_SLUG: String = "Typography"

/** The OpenType `tnum` feature tag — tabular (monospaced) figures, the web `tabular-nums` on the metric value. */
const val TYPOGRAPHY_TABULAR_FIGURES: String = "tnum"

/**
 * Canonical registry metadata for the Typography surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`Typography`).
 */
object TypographyRegistration {
    /** Stable surface id (kebab-case), also the test tag the composable stamps on its node. */
    const val ID: String = "typography"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = TYPOGRAPHY_SLUG
}

/**
 * The four heading levels — the native mirror of the web `HeadingLevel` union (`page` / `section` / `panel` /
 * `sub`). Each maps to a composed [TypographyRole] via [headingRole] and, on the platform, to a heading a11y
 * announcement (the native analogue of the web default h1/h2/h3/h4 tags). Defaults to [Section] in the composable,
 * matching the web default.
 */
enum class HeadingLevel {
    Page,
    Section,
    Panel,
    Sub,
}

/**
 * The thirteen composed text roles — the native mirror of the web `typography.role` keys. A role is the canonical
 * "kind" of text the app renders; selecting one fixes the size, weight, color, family, and (for the metric value)
 * tabular figures, so callers never hand-pick them. [specForRole] reduces each role to its render-ready [TypographyRoleSpec].
 */
enum class TypographyRole {
    PageTitle,
    SectionTitle,
    PanelTitle,
    Subhead,
    Body,
    BodySm,
    Caption,
    Label,
    MetricValue,
    MetricLabel,
    Code,
    Helper,
    Error,
}

/**
 * The eight granular type sizes — the native mirror of the web `typography.size` scale (Tailwind `text-2xs` … `text-3xl`).
 * Used only on the granular `Text` path (when no [TypographyRole] variant is set), exactly as the web ignores
 * size/weight/color when a variant is present. [fontSizeSp] maps each to its sp value.
 */
enum class TypographySize {
    Xs2,
    Xs,
    Sm,
    Base,
    Lg,
    Xl,
    Xl2,
    Xl3,
}

/**
 * The four font weights — the native mirror of the web `typography.weight` keys (regular / medium / semibold / bold).
 * Applied on the granular path and as the per-role weight override in [TypographyRoleSpec].
 */
enum class TypographyWeight {
    Regular,
    Medium,
    Semibold,
    Bold,
}

/**
 * The six granular text colors — the native mirror of the web `typography.color` keys. Theme-aware: each resolves at
 * the render boundary onto a Material 3 color-scheme slot (generated from `apps/design/tokens.json`) so light / dark /
 * high-contrast all stay correct. Used only on the granular `Text` path.
 */
enum class TypographyColor {
    Primary,
    Secondary,
    Muted,
    Subtle,
    Disabled,
    Inverse,
}

/**
 * The semantic color a composed [TypographyRole] resolves to — a small, role-scoped set. It is deliberately distinct
 * from the granular [TypographyColor] union: the web `error` role uses a literal (`text-rose-300`) that is not one of
 * the six `typography.color` tokens, so it lives here rather than polluting the granular color set (no silent drift).
 * Each resolves at the render boundary onto a Material 3 color-scheme slot.
 */
enum class RoleColor {
    Primary,
    Secondary,
    Muted,
    Error,
}

/**
 * The Material 3 type-scale slot a role binds to. Kept as a pure enum (no Compose) so the role→slot decision is
 * unit-tested off-device; the composable maps each entry onto the matching `MaterialTheme.typography` slot from the
 * generated token ramp. The slot carries the role's size/line-height/letter-spacing; the [TypographyRoleSpec] layers
 * the weight / family / color / tabular-figures overrides on top.
 */
enum class TypeScaleSlot {
    TitleLarge,
    TitleMedium,
    TitleSmall,
    HeadlineMedium,
    BodyMedium,
    BodySmall,
    LabelLarge,
    LabelMedium,
    LabelSmall,
}

/**
 * The render-ready description of a composed role — everything the view needs to build the text style, reduced from
 * the role so the mapping is exhaustively covered and unit-tested off-device. The native mirror of the web role's
 * composed class string.
 *
 * @property slot the Material 3 type-scale slot carrying the role's size / line-height / letter-spacing.
 * @property color the semantic, theme-aware color the role resolves to.
 * @property weight an explicit weight override applied over the slot's default (null = keep the slot weight).
 * @property mono switch the family to monospace (the web `font-mono` on the code role).
 * @property tabularFigures enable tabular (monospaced) figures (the web `tabular-nums` on the metric value).
 */
data class TypographyRoleSpec(
    val slot: TypeScaleSlot,
    val color: RoleColor,
    val weight: TypographyWeight?,
    val mono: Boolean,
    val tabularFigures: Boolean,
)

/**
 * Reduce a [TypographyRole] into its render-ready [TypographyRoleSpec] — pure (no Compose), the native mirror of the
 * web `typography.role[...]` composed class string. Exhaustive over all thirteen roles so the off-device test covers
 * every branch, doubling as the per-role snapshot.
 */
fun specForRole(role: TypographyRole): TypographyRoleSpec =
    when (role) {
        // text-xl…3xl font-bold tracking-tight, primary.
        TypographyRole.PageTitle -> roleSpec(TypeScaleSlot.TitleLarge, RoleColor.Primary, TypographyWeight.Bold)
        // text-lg font-semibold tracking-tight, primary.
        TypographyRole.SectionTitle -> roleSpec(TypeScaleSlot.TitleMedium, RoleColor.Primary, TypographyWeight.Semibold)
        // text-base font-semibold, primary.
        TypographyRole.PanelTitle -> roleSpec(TypeScaleSlot.TitleSmall, RoleColor.Primary, TypographyWeight.Semibold)
        // text-sm font-medium, secondary.
        TypographyRole.Subhead -> roleSpec(TypeScaleSlot.BodyMedium, RoleColor.Secondary, TypographyWeight.Medium)
        // text-sm, primary.
        TypographyRole.Body -> roleSpec(TypeScaleSlot.BodyMedium, RoleColor.Primary)
        // text-xs, secondary.
        TypographyRole.BodySm -> roleSpec(TypeScaleSlot.BodySmall, RoleColor.Secondary)
        // text-xs, muted.
        TypographyRole.Caption -> roleSpec(TypeScaleSlot.LabelMedium, RoleColor.Muted)
        // text-xs font-medium uppercase tracking-wider, muted.
        TypographyRole.Label -> roleSpec(TypeScaleSlot.LabelLarge, RoleColor.Muted, TypographyWeight.Medium)
        // text-2xl…3xl font-bold tracking-tight tabular-nums, primary.
        TypographyRole.MetricValue ->
            roleSpec(TypeScaleSlot.HeadlineMedium, RoleColor.Primary, TypographyWeight.Bold, tabularFigures = true)
        // text-2xs font-medium uppercase tracking-wider, muted.
        TypographyRole.MetricLabel -> roleSpec(TypeScaleSlot.LabelSmall, RoleColor.Muted, TypographyWeight.Medium)
        // text-xs font-mono, primary.
        TypographyRole.Code -> roleSpec(TypeScaleSlot.BodySmall, RoleColor.Primary, mono = true)
        // text-xs, muted.
        TypographyRole.Helper -> roleSpec(TypeScaleSlot.LabelMedium, RoleColor.Muted)
        // text-xs, rose (error).
        TypographyRole.Error -> roleSpec(TypeScaleSlot.BodySmall, RoleColor.Error)
    }

/**
 * Compact constructor for a [TypographyRoleSpec] with the common defaults (no weight override, sans family, lining
 * figures). Keeps [specForRole] one readable arm per role without tripping the line-length budget.
 */
private fun roleSpec(
    slot: TypeScaleSlot,
    color: RoleColor,
    weight: TypographyWeight? = null,
    mono: Boolean = false,
    tabularFigures: Boolean = false,
): TypographyRoleSpec = TypographyRoleSpec(slot = slot, color = color, weight = weight, mono = mono, tabularFigures = tabularFigures)

/**
 * Map a [HeadingLevel] onto its composed [TypographyRole] — pure (no Compose), the native mirror of the web
 * `HEADING_ROLE` record (page→pageTitle, section→sectionTitle, panel→panelTitle, sub→subhead).
 */
fun headingRole(level: HeadingLevel): TypographyRole =
    when (level) {
        HeadingLevel.Page -> TypographyRole.PageTitle
        HeadingLevel.Section -> TypographyRole.SectionTitle
        HeadingLevel.Panel -> TypographyRole.PanelTitle
        HeadingLevel.Sub -> TypographyRole.Subhead
    }

/**
 * The sp value of a granular [TypographySize] — pure (no Compose; returns a raw Float so the model stays
 * framework-free and unit-testable off-device). Mirrors the web Tailwind type scale verbatim: `text-2xs` 10 …
 * `text-3xl` 30. The composable wraps the result in `.sp` at the render boundary, so user font-scaling still applies.
 */
fun TypographySize.fontSizeSp(): Float =
    when (this) {
        TypographySize.Xs2 -> 10f
        TypographySize.Xs -> 12f
        TypographySize.Sm -> 14f
        TypographySize.Base -> 16f
        TypographySize.Lg -> 18f
        TypographySize.Xl -> 20f
        TypographySize.Xl2 -> 24f
        TypographySize.Xl3 -> 30f
    }

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). The `view.opened` event carries only the constant surface
 * [SLUG] — never the rendered text — so a diagnostics line can never leak what is being displayed. Kept free of
 * Compose so it is unit-tested with a recording [Logger].
 */
object TypographyDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event — the slug the prompt mandates. */
    const val SLUG: String = TYPOGRAPHY_SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on every diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the composable's
     * first-composition effect.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}
