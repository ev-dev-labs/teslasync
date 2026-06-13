// The single data seam the Currency shared surface binds to — the native analogue of the one data hook the web
// component composes (web/src/components/data-display/format/Currency.tsx via web/src/hooks/useFormatting.ts →
// web/src/hooks/useSettings.ts): the `/settings` document feed it reads `currency_symbol` + the global locale
// from. The view-model depends on this abstraction (a real adapter over the shared S8 [SettingsStore] in
// production, a fake in tests), never on a concrete store or the network, so the view performs NO HTTP (P1/S8
// boundary, ADR-002).
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/Currency) cannot form a valid Kotlin package; `ktlint:standard:filename` /
// `MatchingDeclarationName` are suppressed for the co-located factory + projection alongside the namesake
// interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.currency

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * The seam the [CurrencyViewModel] binds to so it depends on an abstraction (real adapter ↔ test fake), never
 * on a concrete store/repository or the network. [currencyFormat] is the cache-then-network symbol/locale feed
 * the web `useFormatting` derives from `useSettings`; no HTTP touches the view.
 */
interface CurrencySource {
    /**
     * Stream the user's [CurrencyFormat] (symbol + locale) as a cache-then-network [Resource] — the native
     * analogue of the web `useFormatting()` projection over the `/settings` document. The cold-start /
     * loading / stale / offline / error lifecycle is carried by the [Resource] so the surface can disclose the
     * symbol's freshness while always rendering the amount.
     */
    fun currencyFormat(): Flow<Resource<CurrencyFormat>>
}

/**
 * Binds the surface to the shared **S8** [SettingsStore] — the memoized, multi-observer holder every settings
 * consumer shares app-wide (the same `/settings` feed that backs the unit formatter). Projecting the document
 * here, at the adapter boundary, keeps the view free of any JSON shape knowledge and folds the formatter into
 * the one shared settings fetch. No HTTP touches the view.
 */
fun currencySource(settingsStore: SettingsStore): CurrencySource =
    object : CurrencySource {
        override fun currencyFormat(): Flow<Resource<CurrencyFormat>> = settingsStore.settings().map { it.toCurrencyFormat() }
    }

/**
 * Projects a settings-document [Resource] onto a [CurrencyFormat] [Resource], preserving the cache-then-network
 * variant + freshness flags so the surface still distinguishes loading / stale / offline / error. A `null`
 * cached document stays `null` (a genuine first-load Loading) so the surface shows its loading affordance;
 * every present document is run through [resolveCurrencyFormat] (the web `useFormatting` projection). Internal
 * so the adapter's cached → projection mapping is unit-tested off-device.
 */
internal fun Resource<JsonElement>.toCurrencyFormat(): Resource<CurrencyFormat> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.let { resolveCurrencyFormat(it) },
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = resolveCurrencyFormat(data),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = cached?.let { resolveCurrencyFormat(it) },
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }
