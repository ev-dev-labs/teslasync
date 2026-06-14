// Pure, framework-free model + projection + diagnostics for the VersionSegment shared surface — the native
// analogue of everything the web component derives before returning JSX
// (web/src/components/layout/status-bar/VersionSegment.tsx). No Compose, no Android UI, no HTTP: every
// declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// WHAT THE WEB SOURCE IS (and therefore the COMPLETE branch set this surface reproduces). VersionSegment is a
// footer status-bar segment: an always-rendered button showing `v{appVersion}` (+ short SHA) with a status dot
// (amber when an update is available, else cyan when the changelog has unseen entries), and a click-opened
// "About this build" modal listing version provenance (app version, commit, helm chart, go runtime, platform,
// server uptime), an optional "update available" banner, and the What's-new / Release-notes / Close actions.
// Its three data inputs are `useVersionInfo` (GET /system/version), `useUpdateCheck` (GET /system/update-check),
// and `useChangelog` (the static catalog + local acknowledgement store).
//
// HOW THAT MAPS ONTO THE WIRED STATE (P1/S8, ADR-002/013). The version provenance is bound to the shared S8
// SettingsStore `versionInfo()` cache-then-network feed (the same `useVersionInfo` envelope the dashboard
// VersionInfoWidget reads). The shared `VersionInfo` contract carries chart_version / go_version / os / arch but
// NOT `app_version` or `uptime_seconds`; exactly as the sibling VersionInfoWidget does, the adapter re-encodes
// the typed payload to its JSON form and this projection reads the web's exact snake_case names off it, so a
// field outside the contract collapses to the web fallback (`app_version` → the build version, `uptime_seconds`
// → no uptime row) while a field the contract carries renders live — and the surface lights up automatically if
// the contract ever grows the field. The web reads `app_version` / `uptime_seconds` off the raw response the
// same opportunistic way.
//
// The web footer button never blanks during loading (it falls back to the build version), so the button is the
// always-rendered "content" surface; the cache-then-network lifecycle (loading / empty / error / stale /
// offline) is surfaced honestly INSIDE the About modal (the provenance view), where every phase renders a
// non-blank region with the build identity always visible — the platform "no hidden surfaces" contract.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/VersionSegment — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.versionsegment

import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull

/**
 * Canonical registry metadata for the VersionSegment surface. The diagnostics [SLUG] is the surface slug the
 * prompt mandates (`VersionSegment`), emitted with the one-shot `view.opened` event (P1/S11); [ID] is the stable
 * `viewModel` key the host binds the surface with.
 */
object VersionSegmentRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the surface with). */
    const val ID: String = "version-segment"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VersionSegment"
}

/** Worst-case version/SHA fallback — the web `BUILD_VERSION` / `BUILD_SHA` default of `'dev'`. */
const val DEV_VERSION: String = "dev"

/** Sentinel the server emits for an unresolved field — the web `app_version !== 'unknown'` / chart guard. */
private const val UNKNOWN: String = "unknown"

private const val SECONDS_PER_MINUTE: Long = 60L
private const val SECONDS_PER_HOUR: Long = 3_600L
private const val SECONDS_PER_DAY: Long = 86_400L

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/**
 * The update-check result the surface reads — the native port of the web `UpdateCheckResult` (GET
 * /system/update-check): whether a newer release [updateAvailable] exists, the [latest] tag, and an optional
 * human [message]. [None] is the resolved "no update" view (the web `!!updateCheck?.update_available` ⇒ `false`
 * when the query has no data), so an unwired host honestly renders "up to date" rather than a bogus update.
 */
data class UpdateCheckInfo(
    val updateAvailable: Boolean = false,
    val latest: String? = null,
    val message: String? = null,
) {
    companion object {
        /** The "no update available" view — the web default when the update-check query has no data. */
        val None: UpdateCheckInfo = UpdateCheckInfo()
    }
}

/**
 * The changelog acknowledgement view the segment reads — the native narrowing of the web `useChangelog` hook to
 * what THIS surface consumes: whether there are [hasUnseen] entries shipped since the user's last visit and the
 * [newCount] of them (web `hasUnseen` / `newEntries.length`). The full catalog + reducers live in the shared
 * ChangelogModal state holder (P1/S8); this surface binds only the unseen summary it needs for the dot + hint.
 */
data class ChangelogStatus(
    val hasUnseen: Boolean = false,
    val newCount: Int = 0,
) {
    companion object {
        /** The "all seen" view — no dot, no unseen hint. */
        val None: ChangelogStatus = ChangelogStatus()
    }
}

/**
 * The version provenance the surface reads off `version.data` — the native analogue of the web's untyped reads.
 * Every field is nullable so an absent wire key collapses to the web fallback ([appVersion] → the build version,
 * [uptimeSeconds] → no uptime row, the rest → a hidden row), exactly like the web reading the field off a sparse
 * response.
 */
data class VersionFields(
    val appVersion: String?,
    val uptimeSeconds: Long?,
    val chartVersion: String?,
    val goVersion: String?,
    val os: String?,
    val arch: String?,
)

/** The status dot the segment button carries — amber [Update], cyan [Unseen], or [None] (web colored dot). */
enum class SegmentDot { None, Update, Unseen }

/**
 * The build-time identity used as the fallback when the server provenance does not carry it — the web
 * `BUILD_VERSION` / `BUILD_SHA` constants. [version] seeds the app-version fallback; [sha] is the short commit
 * (rendered only when it is not the `'dev'` worst case).
 */
data class BuildIdentity(
    val version: String = DEV_VERSION,
    val sha: String = DEV_VERSION,
)

/** The freshness of the version feed behind the surface — drives the inline chip + the modal chrome. */
enum class SegmentFreshness { Fresh, Stale, Offline }

/** The mutually-exclusive primary region the About modal body paints (cache-then-network lifecycle). */
enum class ModalPhase { Loading, Content, Error, Empty }

/**
 * The localized strings the surface folds into its output — resolved once at the render boundary and handed to
 * the pure projection so the view stays a thin render layer. Tooltip/aria fragments + modal labels all resolve
 * from the P1/S10 catalog; tests pass a deterministic instance, keeping the projection a pure, locale-stable
 * function.
 */
data class VersionSegmentStrings(
    val tooltipWord: String,
    val ariaWord: String,
    val updateAvailable: String,
    val unseenAria: String,
    val appVersionLabel: String,
    val commitLabel: String,
    val chartLabel: String,
    val goLabel: String,
    val platformLabel: String,
    val uptimeRowLabel: String,
    val modalTitle: String,
    val updateBannerTitle: String,
    val whatsNew: String,
    val releaseNotes: String,
    val close: String,
    val loading: String,
    val stale: String,
    val offline: String,
    val retry: String,
    val errorMessage: String,
    val emptyMessage: String,
)

/**
 * The fully projected, render-ready segment button — the native analogue of everything the web component
 * computes for the footer control before returning JSX. [versionText] is `v{appVersion}` (always present),
 * [shaText] the short SHA shown only when it is not the `'dev'` fallback (web `sha && sha !== 'dev'`), [dot] the
 * amber/cyan status dot, and [freshness] the inline chip the platform adds over the always-rendered button.
 */
data class VersionButtonRender(
    val versionText: String,
    val shaText: String?,
    val dot: SegmentDot,
    val freshness: SegmentFreshness,
)

/** One projected provenance row of the About modal (web `dl` row): a [label], a [value], and its monospace flag. */
data class VersionRow(
    val label: String,
    val value: String,
    val mono: Boolean,
)

/** The optional "update available" banner inside the modal — a [title] (with the latest tag) + optional [message]. */
data class UpdateBanner(
    val title: String,
    val message: String?,
)

/**
 * The fully projected, render-ready About modal body — the native analogue of everything the web modal computes
 * before returning JSX. The provenance [rows] always carry the build identity (App version + Commit) so the
 * modal is never blank, even in [ModalPhase.Loading] / [ModalPhase.Error] / [ModalPhase.Empty]; [updateBanner]
 * renders when an update is available; [stale]/[offline] ride the cache-then-network freshness over the rows;
 * [chromeMessage] is the localized loading / error / empty hint for the active [phase] (`null` for content).
 */
data class VersionModalRender(
    val phase: ModalPhase,
    val rows: List<VersionRow>,
    val updateBanner: UpdateBanner?,
    val stale: Boolean,
    val offline: Boolean,
    val canRetry: Boolean,
    val chromeMessage: String?,
)

/**
 * Pure projection from the wired feeds (version provenance + update-check + changelog) to the render-ready
 * button + modal — the native port of the inline derivations the web component performs before returning JSX.
 * Framework-free (no Compose, no clock, no HTTP) so the whole contract is covered by the JVM unit gate.
 */
object VersionSegmentProjection {
    /**
     * Decodes the re-encoded `version.data` [json] into [VersionFields], or `null` when there is no object to
     * render (the web `version.data == null` empty fallback). A present object — even a sparse one — yields
     * fields whose missing keys collapse to `null`, exactly like the web reading `app_version` off the response.
     */
    fun parseVersion(json: JsonElement?): VersionFields? {
        val obj = json as? JsonObject ?: return null
        return VersionFields(
            appVersion = obj.stringField("app_version"),
            uptimeSeconds = obj.longField("uptime_seconds"),
            chartVersion = obj.stringField("chart_version"),
            goVersion = obj.stringField("go_version"),
            os = obj.stringField("os"),
            arch = obj.stringField("arch"),
        )
    }

    /**
     * Resolves the displayed app version — the web `(app_version && app_version !== 'unknown' ? app_version :
     * BUILD_VERSION) || 'dev'`: the server value when present and not the `unknown` sentinel, else the build
     * version, else the `'dev'` worst case.
     */
    fun resolveAppVersion(
        serverAppVersion: String?,
        buildVersion: String,
    ): String {
        val server = serverAppVersion?.takeIf { it.isNotBlank() && it != UNKNOWN }
        val build = buildVersion.takeIf { it.isNotBlank() }
        return server ?: build ?: DEV_VERSION
    }

    /** The short SHA shown beside the version, or `null` when it is the `'dev'` fallback (web `sha !== 'dev'`). */
    fun resolveSha(buildSha: String): String? = buildSha.takeIf { it.isNotBlank() && it != DEV_VERSION }

    /** Web `[os, arch].filter(Boolean).join('/')` — the Platform value, or `null` when both are absent. */
    fun platformText(
        os: String?,
        arch: String?,
    ): String? {
        val parts = listOfNotNull(os?.takeIf { it.isNotBlank() }, arch?.takeIf { it.isNotBlank() })
        return parts.takeIf { it.isNotEmpty() }?.joinToString(separator = "/")
    }

    /**
     * Human-readable uptime from [seconds] — the native port of the web `uptimeLabel`: `Nd Nh` past a day,
     * `Nh Nm` past an hour, else `Nm`; `null` for a missing / non-positive value (web `seconds <= 0` guard).
     */
    fun uptimeLabel(seconds: Long?): String? {
        if (seconds == null || seconds <= 0L) return null
        val days = seconds / SECONDS_PER_DAY
        val hours = (seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR
        val minutes = (seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
        return when {
            days > 0L -> "${days}d ${hours}h"
            hours > 0L -> "${hours}h ${minutes}m"
            else -> "${minutes}m"
        }
    }

    /** The status dot — amber when an update is available, else cyan when unseen entries exist (web dot logic). */
    fun selectDot(
        updateAvailable: Boolean,
        hasUnseen: Boolean,
    ): SegmentDot =
        when {
            updateAvailable -> SegmentDot.Update
            hasUnseen -> SegmentDot.Unseen
            else -> SegmentDot.None
        }

    /**
     * The version feed's freshness: [SegmentFreshness.Offline] when cached data is shown after a failed refresh,
     * [SegmentFreshness.Stale] when a refresh is in flight over the last-known value, else
     * [SegmentFreshness.Fresh]. Mirrors the cache-then-network split the sibling NewVersionBanner derives.
     */
    fun freshnessOf(state: UiState<JsonElement>): SegmentFreshness =
        when {
            state.hasData && state.stale && state.hasError -> SegmentFreshness.Offline
            state.hasData && state.stale -> SegmentFreshness.Stale
            else -> SegmentFreshness.Fresh
        }

    /**
     * Projects the always-rendered footer button — `v{appVersion}` (+ short SHA), the amber/cyan status dot, and
     * the inline freshness chip. The version never blanks during a load: it falls back to [buildVersion] exactly
     * as the web button does.
     */
    fun buildButton(
        fields: VersionFields?,
        update: UpdateCheckInfo,
        changelog: ChangelogStatus,
        state: UiState<JsonElement>,
        build: BuildIdentity,
    ): VersionButtonRender =
        VersionButtonRender(
            versionText = "v${resolveAppVersion(fields?.appVersion, build.version)}",
            shaText = resolveSha(build.sha),
            dot = selectDot(update.updateAvailable, changelog.hasUnseen),
            freshness = freshnessOf(state),
        )

    /**
     * Projects the About modal body. The provenance [VersionModalRender.rows] always lead with the build
     * identity (App version + Commit) so the modal is never blank, then add Helm chart / Go runtime / Platform /
     * Server uptime only when present (the web modal's conditional rows). The update banner, freshness flags, and
     * the loading / error / empty chrome ride the cache-then-network [state] over those rows.
     */
    fun buildModal(
        fields: VersionFields?,
        update: UpdateCheckInfo,
        state: UiState<JsonElement>,
        strings: VersionSegmentStrings,
        build: BuildIdentity,
    ): VersionModalRender {
        val appVersion = resolveAppVersion(fields?.appVersion, build.version)
        val sha = build.sha.takeIf { it.isNotBlank() } ?: DEV_VERSION
        val rows = buildRows(fields, appVersion, sha, strings)
        val phase = modalPhase(state)
        return VersionModalRender(
            phase = phase,
            rows = rows,
            updateBanner = if (update.updateAvailable) buildBanner(update, strings) else null,
            stale = state.hasData && state.stale && !state.hasError,
            offline = state.hasData && state.stale && state.hasError,
            canRetry = state.canRetry,
            chromeMessage = chromeMessage(phase, strings),
        )
    }

    /**
     * The modal provenance rows — App version + Commit always, then Helm chart (web `chart_version &&
     * chart_version !== 'unknown'`), Go runtime (web `go_version`), Platform (web `os || arch`), and Server
     * uptime (web `uptime`). All but uptime render monospace, mirroring the web `font-mono` value cells.
     */
    fun buildRows(
        fields: VersionFields?,
        appVersion: String,
        sha: String,
        strings: VersionSegmentStrings,
    ): List<VersionRow> =
        buildList {
            add(VersionRow(strings.appVersionLabel, "v$appVersion", mono = true))
            add(VersionRow(strings.commitLabel, sha, mono = true))
            fields?.chartVersion?.takeIf { it.isNotBlank() && it != UNKNOWN }?.let {
                add(VersionRow(strings.chartLabel, "v$it", mono = true))
            }
            fields?.goVersion?.takeIf { it.isNotBlank() }?.let {
                add(VersionRow(strings.goLabel, it, mono = true))
            }
            platformText(fields?.os, fields?.arch)?.let {
                add(VersionRow(strings.platformLabel, it, mono = true))
            }
            uptimeLabel(fields?.uptimeSeconds)?.let {
                add(VersionRow(strings.uptimeRowLabel, it, mono = false))
            }
        }

    /** The "update available" banner — web `{title}{latest ? ': v' + latest : ''}` plus the optional message. */
    fun buildBanner(
        update: UpdateCheckInfo,
        strings: VersionSegmentStrings,
    ): UpdateBanner {
        val latest = update.latest?.takeIf { it.isNotBlank() }
        val title = if (latest != null) "${strings.updateBannerTitle}: v$latest" else strings.updateBannerTitle
        return UpdateBanner(title = title, message = update.message?.takeIf { it.isNotBlank() })
    }

    /**
     * Classifies the modal body phase from the version feed: a cold load is [ModalPhase.Loading], a hard failure
     * with no cache is [ModalPhase.Error], a resolved-but-unparseable payload is the defensive [ModalPhase.Empty]
     * (a decoded /system/version is always an object, so this mirrors the web's `version.data == null` guard),
     * and anything with renderable data is [ModalPhase.Content].
     */
    fun modalPhase(state: UiState<JsonElement>): ModalPhase =
        when {
            state.isLoading -> ModalPhase.Loading
            state.isError -> ModalPhase.Error
            state.isEmpty -> ModalPhase.Empty
            else -> ModalPhase.Content
        }

    /** The localized chrome hint for [phase] (loading / error / empty), or `null` for the content phase. */
    fun chromeMessage(
        phase: ModalPhase,
        strings: VersionSegmentStrings,
    ): String? =
        when (phase) {
            ModalPhase.Loading -> strings.loading
            ModalPhase.Error -> strings.errorMessage
            ModalPhase.Empty -> strings.emptyMessage
            ModalPhase.Content -> null
        }

    /**
     * The footer button tooltip — the web `{versionWord} · v{appVersion}[ · {sha}][ · {uptimeText}][ ·
     * {unseenHintText}]`, joined with ` · `. The already-localized [uptimeText] (web `up {{uptime}}`) and
     * [unseenHintText] (web `{{count}} new release(s)`) are passed in so this stays a pure, locale-stable join.
     */
    fun tooltipLabel(
        versionWord: String,
        appVersion: String,
        sha: String?,
        uptimeText: String?,
        unseenHintText: String?,
    ): String =
        buildList {
            add("$versionWord · v$appVersion")
            sha?.let { add(it) }
            uptimeText?.let { add(it) }
            unseenHintText?.let { add(it) }
        }.joinToString(separator = " · ")

    /**
     * The footer button accessibility label — the web `{versionWord}: v{appVersion}[ ({sha})][, {unseenAria}]`.
     * [sha] is the resolved short SHA (null when `'dev'`); [unseenAria] is non-null only when there are unseen
     * changelog entries (web `hasUnseen`).
     */
    fun ariaLabel(
        versionWord: String,
        appVersion: String,
        sha: String?,
        unseenAria: String?,
    ): String {
        val withSha = if (sha != null) "$versionWord: v$appVersion ($sha)" else "$versionWord: v$appVersion"
        return if (unseenAria != null) "$withSha, $unseenAria" else withSha
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [VersionSegmentRegistration.SLUG]
 * (P1/S11) — never the version, build SHA, deployment identity, or update tag, so a diagnostics line can never
 * leak the server's build details. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * ViewModel calls it once per surface open.
 */
fun recordVersionSegmentOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to VersionSegmentRegistration.SLUG))
}

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.longField(key: String): Long? {
    val primitive = this[key] as? JsonPrimitive ?: return null
    return primitive.longOrNull ?: primitive.doubleOrNull?.toLong()
}
