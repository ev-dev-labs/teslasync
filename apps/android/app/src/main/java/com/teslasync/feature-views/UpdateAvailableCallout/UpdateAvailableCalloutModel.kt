// Pure, framework-free model + projection + diagnostics for the UpdateAvailableCallout feature view — the
// native analogue of everything the web component derives from its props before returning JSX
// (web/src/features/system/components/status/UpdateAvailableCallout.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// UpdateAvailableCallout is a purely presentational callout: the web component takes `current`, `latest`, and
// `checkedAt` as props from the /system-status page (which owns the `/system/update-check` query and only
// mounts the callout once it reports `update_available`), so this surface binds NO data hook of its own. As in
// the sibling LiveStatusPill / StatusHeader / DriveDetailHeader ports, the cache-then-network lifecycle
// (loading / error / stale / offline) lives on that owning page, not here; modelling those phases would invent
// behaviour the web spec does not have (honesty covenant: no silent drift, no scope narrowing). The branches
// the web source actually defines ARE the complete state set this surface renders, and each is projected here:
//   • the title — web `Update available{latest ? " — v{latest}" : ""}`, so the version suffix renders only
//     when a non-blank `latest` is present (else the bare "Update available");
//   • the "running" line — web `current ? "You're running v{current}. " : ""`, shown only with a non-blank
//     `current`;
//   • the "last checked" tail — web `checkedAt && " · Last checked {formatDateTime(checkedAt)}"`, shown only
//     when a non-blank `checkedAt` is present (an unparseable stamp still renders the em-dash fallback, exactly
//     like the web `@/lib/dateFormat` contract, so the surface is never a blank box).
// The body sentence ("Review the release notes before upgrading your deployment.") always renders, so even the
// all-absent input still produces a meaningful callout rather than an empty surface.
//
// Timezone/locale parity: the web renders `checkedAt` through `useDateFormat().formatDateTime`, which resolves
// the user's locale + tz from a provider OUTSIDE this component. This surface keeps that separation — the
// owning Compose boundary injects the [java.time.ZoneId] + [java.util.Locale] (defaulting to the device
// zone/locale) and the projection formats deterministically, so the off-device unit gate fully covers it. The
// `ofLocalizedDateTime(MEDIUM, SHORT)` style mirrors the web `{year, month:short, day, hour, minute}` options
// (date + minute-precision time, no seconds), and the em-dash fallback ("—") mirrors the web nullish/invalid
// contract.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/UpdateAvailableCallout — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.updateavailablecallout

import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes before
 * returning JSX. Pure data (no Compose/Android types) so the projection is unit-tested without a UI host;
 * because the composable is a thin render layer, each field here is exactly what it draws.
 *
 * @property latestVersion the trimmed, non-blank target version, or null — drives the title variant and is the
 *   interpolation argument for the "Update available — v{version}" title (web `latest`).
 * @property currentVersion the trimmed, non-blank installed version, or null — when present the "You're running
 *   v{version}." line renders (web `current`).
 * @property checkedAtLabel the already-formatted "last checked" timestamp, or null when no `checkedAt` was
 *   supplied; the localized [UpdateAvailableCalloutProjection.FALLBACK] em-dash when a stamp was supplied but
 *   could not be parsed (web `formatDateTime` contract). Non-null ⇒ the muted "· Last checked …" tail renders.
 */
data class UpdateAvailableCalloutDisplay(
    val latestVersion: String?,
    val currentVersion: String?,
    val checkedAtLabel: String?,
) {
    /** Web `latest ? " — v{latest}"` — true when the title carries the target-version suffix. */
    val showVersionInTitle: Boolean get() = latestVersion != null

    /** Web `current ? "You're running v{current}. "` — true when the installed-version line renders. */
    val showRunningLine: Boolean get() = currentVersion != null

    /** Web `checkedAt && " · Last checked …"` — true when the muted freshness tail renders. */
    val showLastChecked: Boolean get() = checkedAtLabel != null
}

/**
 * Pure projection from the web props (`current`, `latest`, `checkedAt`) to the render-ready
 * [UpdateAvailableCalloutDisplay] — a 1:1 port of the inline derivations the web component performs before
 * returning JSX (the version truthiness checks and the `formatDateTime(checkedAt)` call). The [zone] and
 * [locale] are injected at the Compose boundary so formatting is deterministic in tests.
 */
object UpdateAvailableCalloutProjection {
    /** Universal em-dash fallback for a supplied-but-unparseable timestamp (web `@/lib/dateFormat` FALLBACK). */
    const val FALLBACK: String = "—"

    /**
     * Project the web props onto the render-ready [UpdateAvailableCalloutDisplay]. `current` / `latest` are
     * trimmed and treated as absent when blank (web truthiness on `string | undefined`). `checkedAt` is
     * formatted in [zone] using [locale] only when non-blank; a non-blank but unparseable value yields the
     * [FALLBACK] so the "last checked" line still renders (never a blank box), exactly like the web.
     */
    fun project(
        current: String?,
        latest: String?,
        checkedAtIso: String?,
        zone: ZoneId,
        locale: Locale,
    ): UpdateAvailableCalloutDisplay =
        UpdateAvailableCalloutDisplay(
            latestVersion = normalize(latest),
            currentVersion = normalize(current),
            checkedAtLabel = normalize(checkedAtIso)?.let { formatDateTime(it, zone, locale) },
        )

    /** Web truthiness on an optional string prop: a null/blank value is "absent", otherwise the trimmed value. */
    fun normalize(value: String?): String? = value?.trim()?.takeIf { it.isNotEmpty() }

    /**
     * Web `formatDateTime(checkedAt)` — a localized date + minute-precision time ("Apr 4, 2026, 2:30 PM" in
     * en-US) rendered in [zone], or the [FALLBACK] em-dash when [iso] cannot be parsed. Mirrors the web
     * `Intl.DateTimeFormat` options `{year, month:short, day, hour, minute}` via the MEDIUM date + SHORT time
     * styles (SHORT time omits seconds, matching the web).
     */
    fun formatDateTime(
        iso: String,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val instant = parseInstant(iso) ?: return FALLBACK
        val formatter =
            DateTimeFormatter
                .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
                .withLocale(locale)
                .withZone(zone)
        return runCatching { formatter.format(instant) }.getOrDefault(FALLBACK)
    }

    /**
     * Tolerant ISO-8601 parse mirroring the JS `new Date(iso)` the web `formatDateTime` relies on: an offset
     * stamp ("…+02:00") is read via [OffsetDateTime], a UTC "…Z" stamp via [Instant]. Anything else yields null
     * so the caller renders the em-dash fallback.
     */
    private fun parseInstant(iso: String): Instant? =
        runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrNull()
            ?: runCatching { Instant.parse(iso) }.getOrNull()
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the current
 * or target version, nor the check timestamp — so a diagnostics line can never leak a deployment's version
 * posture.
 */
object UpdateAvailableCalloutDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "UpdateAvailableCallout"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
