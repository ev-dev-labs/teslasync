// The native Jetpack Compose + Material 3 JwtDecoder feature view — a parity port of
// web/src/features/admin/components/devtools/tools/JwtDecoder.tsx. The web tool wraps a [ToolCard]
// around a textarea whose live value is decoded by a `useMemo`, rendering — in order — an optional
// "Invalid Jwt" line, then a [ResultPanel] for the decoded header, then one for the decoded payload,
// each shown only when present (web `{decoded.header && …}`). This surface reproduces that exactly: the
// shared [ToolCardContent] container, the shared [Textarea] input, and the shared [ResultPanelContent]
// blocks, composed over the pure [JwtDecoderLogic.decode] result.
//
// The web tool binds only `useTranslation` (i18n) plus local `useState`/`useMemo` — it performs NO
// network I/O — so, like the sibling ToolCard / ResultPanel surfaces, there is no ViewModel and no
// loading / stale / offline lifecycle to render here; modelling those would invent behaviour the source
// lacks (drift). The three states the source actually defines are reproduced faithfully: Idle (blank
// input → just the input field), Invalid (an error line), and Decoded (the two result panels). The
// always-present [ToolCardContent] header + input field means the surface is never a blank box. The
// decode-failure path is a live validation message that clears when the input is fixed — there is
// nothing to re-fetch — so it renders as the shared [ErrorText] line the web uses, not a `QueryError`
// with a retry affordance (that would imply a fetch the source does not perform).
//
// Every visible string is a web i18n key resolved through [JwtDecoderI18n]; none exist in the generated
// shared catalog (P1/S10) upstream, so they render via i18next's key-as-fallback — the identical
// treatment the sibling ClientUtilities registry gives these very keys. The lone catalog-backed string is
// the ResultPanel idle message (`common.noData`), which is supplied for contract-completeness though the
// panels only ever render with data. The KeyRound glyph (web lucide `KeyRound`) is authored locally as a
// 24×24 stroked vector — Android ships no lucide set — and is decorative (the title carries the meaning),
// so it exposes no content description.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/JwtDecoder — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path — exactly as the sibling ToolCard /
// ResultPanel surfaces do. `MatchingDeclarationName` is suppressed for the co-located glyph declaration.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.feature.views.jwtdecoder

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.feature.views.resultpanel.ResultPanelContent
import io.teslasync.android.featureviews.toolcard.ToolCardContent
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// Web `<Textarea rows={3} …>`: the input opens three lines tall.
private const val JWT_INPUT_ROWS = 3

/**
 * Stateful entry point for the JWT decoder. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), holds the pasted token (web `useState('')`), derives the decoded result (web `useMemo`), and
 * renders the presentational [JwtDecoderContent]. The token is kept in [rememberSaveable] so it survives
 * configuration changes; it is never logged.
 *
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun JwtDecoder(
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { JwtDecoderDiagnostics.recordViewOpened(logger) }
    var jwt by rememberSaveable { mutableStateOf("") }
    val result = remember(jwt) { JwtDecoderLogic.decode(jwt) }
    JwtDecoderContent(
        jwt = jwt,
        onJwtChange = { jwt = it },
        result = result,
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web composition exactly:
 * a [ToolCardContent] (purple, key glyph) wrapping a vertical stack (web `space-y-3`) of the [Textarea]
 * input and, conditioned on [result], the "Invalid Jwt" [ErrorText] (web `{decoded.error && …}`) or the
 * header + payload [ResultPanelContent] blocks (web `{decoded.header && …}` / `{decoded.payload && …}`).
 *
 * @param jwt the current input value (web `jwt` state).
 * @param onJwtChange invoked with the new value on every edit (web `setJwt`).
 * @param result the decoded outcome to render (web `decoded`).
 */
@Composable
fun JwtDecoderContent(
    jwt: String,
    onJwtChange: (String) -> Unit,
    result: JwtDecodeResult,
    modifier: Modifier = Modifier,
) {
    // Catalog-backed idle message for the ResultPanel contract; the panels here always carry data.
    val idleMessage = stringResource(R.string.translation_common_noData)
    ToolCardContent(
        icon = JwtKeyRoundGlyph,
        color = TOOL_ACCENT,
        title = JwtDecoderI18n.TITLE,
        description = JwtDecoderI18n.DESCRIPTION,
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Textarea(
                value = jwt,
                onValueChange = onJwtChange,
                label = JwtDecoderI18n.INPUT_LABEL,
                hint = JwtDecoderI18n.INPUT_EXAMPLE_TOKEN,
                minLines = JWT_INPUT_ROWS,
            )
            when (result) {
                JwtDecodeResult.Idle -> Unit
                JwtDecodeResult.Invalid ->
                    ErrorText(JwtDecoderI18n.INVALID_ERROR, modifier = Modifier.fillMaxWidth())
                is JwtDecodeResult.Decoded -> {
                    ResultPanelContent(
                        title = JwtDecoderI18n.HEADER_TITLE,
                        idleMessage = idleMessage,
                        data = result.header,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    ResultPanelContent(
                        title = JwtDecoderI18n.PAYLOAD_TITLE,
                        idleMessage = idleMessage,
                        data = result.payload,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

// Web `color="purple"` — folds to the purple accent in the shared ToolCard accent map.
private const val TOOL_ACCENT = "purple"

/**
 * The native stand-in for the web lucide `KeyRound` glyph — a 24×24 round-capped stroked vector: a ring
 * (bow) at the upper right, a shaft running down to the lower left, and two short teeth. Drawn in opaque
 * black and recolored at render time by the shared `Icon`'s tint, so it inherits the accent in every
 * theme. Purely decorative (the card title carries the meaning).
 */
private val JwtKeyRoundGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "KeyRound",
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            ) {
                // Ring (bow) — two semicircle arcs, center (15.5, 8.5), radius 3.5.
                moveTo(12f, 8.5f)
                arcTo(3.5f, 3.5f, 0f, false, true, 19f, 8.5f)
                arcTo(3.5f, 3.5f, 0f, false, true, 12f, 8.5f)
                // Shaft — from the lower-left of the bow down to the bottom-left.
                moveTo(13f, 11f)
                lineTo(5f, 19f)
                // Teeth — two short ticks off the shaft.
                moveTo(8f, 16f)
                lineTo(10f, 18f)
                moveTo(5f, 19f)
                lineTo(7f, 21f)
            }
        }.build()
