// Pure, framework-free model + projection for the ResultPanel feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/admin/components/devtools/ResultPanel.tsx). No Compose, no Android, no HTTP: every type
// here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin render
// layer.
//
// ResultPanel is a pure presentational surface — it takes its title/data/error/idleMessage as inputs and
// renders one of three branches the web component renders: an error line, the pretty-printed result with a
// copy affordance, or an idle message. It binds no data hooks, so the cache-then-network states
// (loading/stale/offline) the data-bound surfaces carry do not exist here; the three branches below are the
// complete state set the web source defines.
//
// The web reads `data` as untyped `unknown` and serializes it with `JSON.stringify(data, null, 2)`. The
// native analogue accepts a [JsonElement] (the canonical shape every other surface already threads through),
// pretty-printed with a two-space indent so the rendered text matches the web byte-for-byte in structure.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ResultPanel — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.feature.views.resultpanel

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * Which of the web component's three render branches applies. [Error] mirrors the web `error ? …`; [Result]
 * mirrors `hasData ? <pre>…`; [Idle] mirrors the trailing `idleMessage` fallback. There is no loading /
 * stale / offline branch — the web source binds no data hooks, so this is the complete state set.
 */
enum class ResultPanelMode { Error, Result, Idle }

/**
 * The surface's semantic tone — the native analogue of the web container tint
 * (`error ? bg-neon-red/5 : hasData ? bg-neon-green/5 : bg-white/[0.02]`). [Danger] takes precedence over
 * [Success] exactly as the web `error ?` arm precedes the `hasData ?` arm. The composable maps this onto the
 * shared GlassPanel border accent (the sanctioned native expression of the web "glow"/tint affordance).
 */
enum class ResultPanelTone { Neutral, Success, Danger }

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property title the caller-supplied, already-localized panel heading (web `title` prop).
 * @property mode which branch renders (web `error ? … : hasData ? … : …`).
 * @property tone the semantic container tone (web background tint), mapped to a panel accent by the view.
 * @property showCopy whether the copy affordance renders — true whenever there is data, **independent of
 *   error**, exactly like the web `{hasData ? <CopyButton/> : null}` (so an error carrying a payload still
 *   offers the copy button).
 * @property copyText what the copy button writes to the clipboard — the pretty-printed data (web
 *   `CopyButton text={stringifiedData}`), empty when there is no data.
 * @property bodyText the text the body renders for the active [mode]: the error message, the pretty-printed
 *   result, or the idle message.
 */
data class ResultPanelDisplay(
    val title: String,
    val mode: ResultPanelMode,
    val tone: ResultPanelTone,
    val showCopy: Boolean,
    val copyText: String,
    val bodyText: String,
)

/**
 * Pure projection from the raw inputs to the render-ready [ResultPanelDisplay] — the native port of the
 * handful of derivations the web component performs (`hasData`, `stringifiedData`, the tint expression, and
 * the three-way body branch) before returning JSX.
 */
object ResultPanelProjection {
    // Web `JSON.stringify(data, null, 2)`: pretty-printed with a two-space indent.
    private val prettyJson =
        Json {
            prettyPrint = true
            prettyPrintIndent = "  "
        }

    /**
     * Projects the inputs into the render-ready [ResultPanelDisplay].
     *
     * @param title the already-localized panel heading (web `title` prop).
     * @param data the result payload, or `null` when there is nothing to show. A JSON `null` ([JsonNull]) is
     *   treated as absent, mirroring the web `data != null` truthiness check (a JS `null` is not "data").
     * @param error a non-empty error message routes to the error branch; `null`/empty is treated as no error
     *   (web `error ?` truthiness — an empty string is falsy).
     * @param idleMessage the message shown when there is neither an error nor data. Caller-supplied and
     *   already localized: the web default literal `'No result yet'` is not reproducible as a Kotlin string
     *   literal (no-English-literals rule) and has no key in the generated i18n catalog, so the localized
     *   text is the caller's responsibility — the same way the web `title` prop is caller-supplied.
     */
    fun project(
        title: String,
        data: JsonElement?,
        error: String?,
        idleMessage: String,
    ): ResultPanelDisplay {
        val renderable: JsonElement? = data?.takeIf { it != JsonNull }
        val stringified = renderable?.let { prettyJson.encodeToString(JsonElement.serializer(), it) }.orEmpty()
        val hasData = renderable != null
        val hasError = !error.isNullOrEmpty()

        val mode =
            when {
                hasError -> ResultPanelMode.Error
                hasData -> ResultPanelMode.Result
                else -> ResultPanelMode.Idle
            }
        val tone =
            when {
                hasError -> ResultPanelTone.Danger
                hasData -> ResultPanelTone.Success
                else -> ResultPanelTone.Neutral
            }
        val bodyText =
            when (mode) {
                ResultPanelMode.Error -> error.orEmpty()
                ResultPanelMode.Result -> stringified
                ResultPanelMode.Idle -> idleMessage
            }

        return ResultPanelDisplay(
            title = title,
            mode = mode,
            tone = tone,
            showCopy = hasData,
            copyText = stringified,
            bodyText = bodyText,
        )
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * title, the error text, or the result payload — so a diagnostics line can never leak the inspected data.
 */
object ResultPanelDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "ResultPanel"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
