// The data port the NewVersionBanner shared surface binds to — the native analogue of the web hook the component
// composes: `useVersionWatcher` (web/src/hooks/useVersionWatcher.ts), which polls GET /system/version and compares
// the reported deployment identity against the value captured at boot. The view never performs HTTP; a concrete
// adapter over the shared S7/S8 Settings layer (or a test fake) drives this seam (the P1/S8 boundary, ADR-002).
//
// THE DEPLOY FINGERPRINT (the app_version parity bridge). The web hook reads `app_version` directly off the raw
// /system/version response. The canonical S8 Settings feed decodes that wire payload into the typed `VersionInfo`
// contract (chart_version / go_version / os / arch / endpoints / require_cookie_consent) — which does NOT carry
// `app_version`, and the shared contract is outside this surface's allowed files. So, exactly as the sibling
// VersionInfoWidget reproduces the web's untyped reads, this adapter derives a stable DEPLOY FINGERPRINT from the
// identity fields the contract DOES carry: any backend redeploy bumps chart_version (and a toolchain/platform
// change bumps go_version / os / arch), so the fingerprint changes on exactly the redeploys the web's
// `app_version` divergence detects. The fingerprint is the unit the watcher compares boot-vs-latest on.
//
// The feed preserves the cache-then-network freshness contract end to end (ADR-013): each `versionInfo()` emission
// is projected onto a `Resource<String>` carrying the same Loading/Success/Error + cached/stale flags, so the
// ViewModel can surface loading / content / stale / offline / error honestly.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/NewVersionBanner) cannot form a valid Kotlin package; `ktlint:standard:filename`
// / `MatchingDeclarationName` are suppressed for the co-located adapters alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.newversionbanner

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.settings.VersionInfo
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** Joins the [VersionInfo] identity fields into the deploy fingerprint (a delimiter no field value can contain). */
const val FINGERPRINT_SEPARATOR: String = "|"

/**
 * The single seam the [NewVersionBannerViewModel] binds to so it depends on an abstraction (real adapter ↔ test
 * fake), never on a concrete store, repository, or the network. [deployVersion] is the cold, cache-then-network
 * deployment-identity feed (web `useVersionWatcher`'s `/system/version` poll, projected to the deploy fingerprint).
 * No HTTP touches the view.
 */
interface NewVersionBannerSource {
    /**
     * The deployment identity as a cache-then-network `Resource<String>` (the web `app_version` analogue —
     * the deploy fingerprint). Collecting it opens the shared Settings version feed; the Loading/Success/Error +
     * cached/stale flags flow through unchanged so the surface renders loading / content / stale / offline / error.
     */
    fun deployVersion(): Flow<Resource<String>>
}

/**
 * Binds the surface to the shared **S8** [SettingsStore] — the memoized, multi-observer `versionInfo()` feed every
 * Settings surface shares (the same feed the dashboard VersionInfoWidget reads). Each typed `VersionInfo` emission
 * is projected to its deploy fingerprint, preserving every freshness flag. No HTTP touches the view.
 */
fun SettingsStore.asNewVersionBannerSource(): NewVersionBannerSource {
    val store = this
    return object : NewVersionBannerSource {
        override fun deployVersion(): Flow<Resource<String>> = store.versionInfo().map { it.mapDeployFingerprint() }
    }
}

/**
 * Binds the surface to the shared **S7** [SettingsRepository] — the cold cache-then-network `versionInfo()` `Flow`
 * the S8 [SettingsStore] also wraps. Re-collecting it performs a genuine cache-then-network re-fetch, which is what
 * backs the surface's manual refresh / error-retry affordance (the web `useVersionWatcher` poll). Each typed
 * payload is projected to its deploy fingerprint. No HTTP touches the view.
 */
fun SettingsRepository.asNewVersionBannerSource(): NewVersionBannerSource {
    val repo = this
    return object : NewVersionBannerSource {
        override fun deployVersion(): Flow<Resource<String>> = repo.versionInfo().map { it.mapDeployFingerprint() }
    }
}

/**
 * Builds a [NewVersionBannerSource] from an identity-[feed] provider — the test double used to drive each feed
 * state deterministically while exercising the real fingerprint + watcher logic. Mirrors the contract of the
 * production [asNewVersionBannerSource] bindings.
 */
fun newVersionBannerSource(feed: () -> Flow<Resource<String>>): NewVersionBannerSource =
    object : NewVersionBannerSource {
        override fun deployVersion(): Flow<Resource<String>> = feed()
    }

/**
 * The deploy fingerprint for a [VersionInfo] (the web `app_version` analogue): the identity fields joined by
 * [FINGERPRINT_SEPARATOR]. An all-blank payload — no identity reported at all — collapses to the empty string so
 * the surface treats it as an empty/unknown identity (the up-to-date resolved panel) rather than a real version.
 * `internal` so the off-device unit gate exercises the mapping directly.
 */
internal fun VersionInfo.deployFingerprint(): String {
    val parts = listOf(chartVersion, goVersion, os, arch)
    return if (parts.all { it.isBlank() }) "" else parts.joinToString(separator = FINGERPRINT_SEPARATOR)
}

/**
 * Projects a `Resource<VersionInfo>` (web `useVersionInfo`) onto the `Resource<String>` deploy-fingerprint feed,
 * preserving every Loading/Success/Error + cached/stale flag so the identity's freshness lifecycle reaches the
 * surface unchanged. `internal` so the off-device unit gate exercises the adapter mapping directly.
 */
internal fun Resource<VersionInfo>.mapDeployFingerprint(): Resource<String> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(cached = cached?.deployFingerprint(), fetchedAt = fetchedAt, stale = stale)
        is Resource.Success ->
            Resource.Success(data = data.deployFingerprint(), fetchedAt = fetchedAt, stale = stale)
        is Resource.Error ->
            Resource.Error(cached = cached?.deployFingerprint(), fetchedAt = fetchedAt, stale = stale, error = error)
    }

/**
 * The freshest known identity a `Resource<String>` carries (web `app_version` after a poll): the fresh value on
 * success, otherwise the cached value replayed during a refresh or after a failed fetch. A blank value collapses
 * to `null` so the watcher's boot-capture ignores an unknown identity. `internal` so the ViewModel and the unit
 * gate share one extraction.
 */
internal fun Resource<String>.latestKnownVersion(): String? =
    when (this) {
        is Resource.Success -> data
        is Resource.Loading -> cached
        is Resource.Error -> cached
    }?.takeIf { it.isNotBlank() }
