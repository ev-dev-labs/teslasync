// Pure, framework-free model + masking math + projection for the MaskedValue shared surface — the native
// analogue of every decision the web component makes (web/src/components/ui/MaskedValue.tsx and its sibling
// web/src/lib/maskValue.ts) before it paints. No Compose, no Android, no HTTP: every declaration here is
// unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable in MaskedValue.kt a
// thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): a privacy primitive
// that renders a sensitive string masked by default with a click-to-reveal affordance. The mask is computed by
// the pure `maskFor(value, variant, showLast?)` (ported verbatim below as [maskFor]) across five strategies —
// `token` (12 fixed bullets + last 4, length-hiding), `vin` (the 3-char WMI prefix + bullets + last 4 once the
// input is plausibly a real VIN, otherwise a full bullet run), `coords` (`..lat.., ..lng..` rounded to
// nothing), `email` (masked local-part, visible domain), and `generic` (bullets + the last `showLast` chars).
// Each variant has a conservative default visible-suffix length ([defaultShowLast]). An empty/blank value
// renders an em-dash with NO toggle (there is nothing to reveal). When non-empty, the value shows masked, an
// eye toggle reveals it (auto-hiding after [DEFAULT_AUTO_HIDE_MS]), and — when the caller opts in — a copy
// affordance copies the raw value regardless of mask state. Revealing optionally records an out-of-band audit
// event (web `auditOnReveal` -> a fire-and-forget POST), reproduced here as the dependency-inverted
// [RevealAuditSink] so the view never performs I/O. Every one of those branches is reproduced by the composable
// over this model.
//
// The web source's three `t()` calls (`mask.reveal`, `mask.hide`, `mask.copy`) map to the existing P1/S10
// catalog keys (translation_mask_reveal / _hide / _copy), resolved in the composable via stringResource — this
// surface adds NO new key and NO English literal (honesty covenant: no silent drift). The web `useId` is NOT
// ported: it only stamped a DOM `id` on the `<code>` element that nothing references; the Compose tree needs no
// such id (its stable identity for tests is the composable's test tag), so reproducing it would invent dead
// state the spec does not use.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this
// surface fetches nothing. It renders a caller-supplied string and only ever shows one of its real states —
// the empty em-dash, the masked value, or the revealed value (auto-hiding back to masked). There is no query
// to be loading, to fail, to go stale, or to be offline, so inventing those states would be dishonest. The
// owning screen that DOES fetch the secret renders its own data surface (with those states) and drops this
// primitive into it. The surface's REAL, fully-reproduced states are therefore the projection branches reduced
// here in [projectMaskedValue] + [MaskedValueProjection.display] + [toggleFor], each asserted off-device,
// doubling as the per-state snapshot.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/MaskedValue — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling Accordion / Checkbox surfaces do. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.maskedvalue

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no value, variant, or label —
 * only this constant identifier — so a diagnostics line can never leak what is being masked.
 */
const val MASKED_VALUE_SLUG: String = "MaskedValue"

/** The bullet glyph (U+2022) every mask is built from — matches the web `BULLET` constant. */
const val BULLET: String = "\u2022"

/** The em-dash (U+2014) shown for an empty value, matching the rest of the UI's missing-data convention. */
const val EM_DASH: String = "\u2014"

/** Default auto-hide window for a revealed value (web `DEFAULT_AUTO_HIDE_MS`, 30 s). */
const val DEFAULT_AUTO_HIDE_MS: Long = 30_000L

private const val SEPARATOR: String = ", "

// Tokens render a fixed-length bullet run so the masked form never leaks the original length (a 16-char token
// and a 64-char token must look identical when masked) — web `maskToken` uses `bullets(12)`.
private const val TOKEN_BULLET_RUN: Int = 12

// A Tesla VIN is 17 chars with a 3-char WMI prefix; below this length the input almost certainly is not a real
// VIN, so the web `maskVin` falls back to a full bullet run rather than exposing the prefix.
private const val VIN_PREFIX_LEN: Int = 3
private const val VIN_MIN_LEN: Int = 11

/**
 * Canonical registry metadata for the MaskedValue surface. [SLUG] is emitted with the one-shot `view.opened`
 * event (P1/S11) and is the surface slug the prompt mandates (`MaskedValue`); [ID] is the stable kebab-case id
 * the composable stamps as its test tag.
 */
object MaskedValueRegistration {
    const val ID: String = "masked-value"
    const val SLUG: String = MASKED_VALUE_SLUG
}

/**
 * Masking strategy — the native mirror of the web `MaskVariant` union (`token` / `vin` / `coords` / `email` /
 * `generic`). Pure (no Compose) so the per-variant masking math stays a thin, exhaustively-tested lookup.
 */
enum class MaskVariant {
    Token,
    Vin,
    Coords,
    Email,
    Generic,
}

/**
 * Default number of trailing characters left visible per [variant] (web `DEFAULT_SHOW_LAST`). Callers may
 * override with an explicit `showLast`. The defaults err on the side of less-visible: any caller wanting a
 * longer suffix asks for it explicitly.
 */
fun defaultShowLast(variant: MaskVariant): Int =
    when (variant) {
        MaskVariant.Token -> 4
        MaskVariant.Vin -> 4
        MaskVariant.Coords -> 0
        MaskVariant.Email -> 1
        MaskVariant.Generic -> 0
    }

private fun bullets(count: Int): String = if (count <= 0) "" else BULLET.repeat(count)

private fun maskGeneric(
    value: String,
    showLast: Int,
): String {
    if (value.isEmpty()) return ""
    val visible = showLast.coerceIn(0, value.length)
    val hidden = value.length - visible
    return bullets(hidden) + value.substring(value.length - visible)
}

private fun maskToken(
    value: String,
    showLast: Int,
): String {
    if (value.isEmpty()) return ""
    val visible = showLast.coerceIn(0, value.length)
    return bullets(TOKEN_BULLET_RUN) + value.substring(value.length - visible)
}

private fun maskVin(
    value: String,
    showLast: Int,
): String {
    // Below the VIN length the input almost certainly is not a real VIN, so fall back to a full bullet run
    // rather than exposing the WMI prefix. An empty value lands here too (bullets(0) == ""), matching the web.
    if (value.length < VIN_MIN_LEN) return bullets(value.length)
    val visibleSuffix = showLast.coerceIn(0, value.length - VIN_PREFIX_LEN)
    val hidden = value.length - VIN_PREFIX_LEN - visibleSuffix
    return value.substring(0, VIN_PREFIX_LEN) + bullets(hidden) + value.substring(value.length - visibleSuffix)
}

private fun maskEmail(
    value: String,
    showLast: Int,
): String {
    val at = value.indexOf('@')
    if (at <= 0) return maskGeneric(value, maxOf(showLast, 0))
    val local = value.substring(0, at)
    val domain = value.substring(at)
    val visible = showLast.coerceIn(0, local.length)
    val masked = local.substring(0, visible) + bullets(maxOf(local.length - visible, 1))
    return masked + domain
}

private fun maskCoords(value: String): String {
    val trimmed = value.trim()
    val parts = trimmed.split(',').map { it.trim() }.filter { it.isNotEmpty() }
    return when {
        // No numeric components (also the empty/blank input) renders nothing, matching the web early returns.
        parts.isEmpty() -> ""
        // A lat/lng pair (or a single number) masks each component to whole-degree-only context. A Float parse
        // is enough here: only finiteness decides the branch (the parsed value is discarded — every component
        // renders as fixed bullets), so this stays faithful to the web `Number.isFinite(Number(p))` check.
        parts.all { it.toFloatOrNull()?.isFinite() == true } ->
            parts.joinToString(SEPARATOR) { "$BULLET$BULLET.$BULLET$BULLET$BULLET" }
        // Anything else (non-numeric) falls back to a generic full mask.
        else -> maskGeneric(trimmed, 0)
    }
}

/**
 * Returns the user-visible masked representation of [value] — the verbatim port of the web `maskFor`. Pure and
 * total: it never throws, even on a null/empty string, so render paths can wrap it without a null guard.
 */
fun maskFor(
    value: String?,
    variant: MaskVariant,
    showLast: Int? = null,
): String {
    if (value == null) return ""
    val last = showLast ?: defaultShowLast(variant)
    return when (variant) {
        MaskVariant.Token -> maskToken(value, last)
        MaskVariant.Vin -> maskVin(value, last)
        MaskVariant.Coords -> maskCoords(value)
        MaskVariant.Email -> maskEmail(value, last)
        MaskVariant.Generic -> maskGeneric(value, last)
    }
}

/**
 * The reduced render inputs for one MaskedValue — the native analogue of the web component's `raw` / `masked` /
 * empty-check memo. [isEmpty] selects the em-dash branch (no toggle); otherwise [raw] and [masked] feed the
 * code element and the copy affordance.
 */
data class MaskedValueProjection(
    val raw: String,
    val masked: String,
    val isEmpty: Boolean,
)

/**
 * Reduce the caller inputs into the single [MaskedValueProjection] the composable renders — pure (no Compose),
 * so every branch is unit-tested off-device and doubles as the per-state snapshot. Mirrors the web `raw = value
 * ?? ''` and `masked = maskFor(raw, variant, showLast)`.
 */
fun projectMaskedValue(
    value: String?,
    variant: MaskVariant,
    showLast: Int? = null,
): MaskedValueProjection {
    val raw = value ?: ""
    return MaskedValueProjection(
        raw = raw,
        masked = maskFor(raw, variant, showLast),
        isEmpty = raw.isEmpty(),
    )
}

/**
 * What the code element shows: the [raw] value when [revealed], otherwise the [masked] form — the web
 * `revealed ? raw : masked`.
 */
fun MaskedValueProjection.display(revealed: Boolean): String = if (revealed) raw else masked

/**
 * The eye toggle's two states — the native mirror of the web `revealed ? <EyeOff/> : <Eye/>` plus its
 * state-mirroring `aria-label`. [Reveal] is shown while masked, [Hide] while revealed; the composable maps each
 * to its catalog key (`mask.reveal` / `mask.hide`) and to the matching glyph.
 */
enum class RevealToggle {
    Reveal,
    Hide,
}

/** Select the toggle state for the current [revealed] flag (web `revealed ? hide : reveal`). */
fun toggleFor(revealed: Boolean): RevealToggle = if (revealed) RevealToggle.Hide else RevealToggle.Reveal

/**
 * The reveal-audit port — the native, dependency-inverted analogue of the web component's fire-and-forget
 * `postRevealAudit` (a `POST /audit/reveal`). The view NEVER performs HTTP; a caller that has enabled
 * `auditOnReveal` supplies a sink that records the reveal out of band, and the composable invokes it inside a
 * swallow-everything guard so an audit failure can never block or break the reveal UX (matching the web's
 * silent `.catch(() => {})`). The default [None] records nothing, matching the web default `auditOnReveal=false`
 * (the audit route is opt-in; until a caller wires one, revealing stays a purely local action). Wiring a real
 * sink to the backend audit endpoint is the owning screen's concern and is out of scope for this surface.
 */
fun interface RevealAuditSink {
    fun recordReveal(variant: MaskVariant)

    companion object {
        /** A no-op sink — the default, equivalent to the web's conservative `auditOnReveal=false`. */
        val None: RevealAuditSink = RevealAuditSink { }
    }
}

/**
 * The PII-safe diagnostics this surface emits (P1/S11). The one `view.opened` event carries only the constant
 * surface [SLUG] — never the value, the variant, or any user data — so a diagnostics line can never leak what
 * is being masked. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object MaskedValueDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = MASKED_VALUE_SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on every diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the
     * composable's first-composition effect.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}
