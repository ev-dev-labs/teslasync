// The native Jetpack Compose + Material 3 MaskedValue shared surface — a parity port of
// web/src/components/ui/MaskedValue.tsx. The web surface is a privacy primitive: it renders a sensitive string
// masked by default (via the pure `maskFor`, ported in MaskedValueModel.kt) inside a monospace `<code>`, with a
// click-to-reveal eye toggle that flips to the raw value and auto-hides after 30 s, an optional copy affordance
// that copies the raw value regardless of mask state, and a semantic `aria-label` on the wrapper so a screen
// reader names the value (e.g. "API key") instead of blurting its bullets or cleartext. An empty value renders
// an em-dash with NO toggle. Revealing optionally records an out-of-band audit event (web `auditOnReveal`).
//
// This native surface keeps that contract end to end and renders every branch the web source draws — the empty
// em-dash, the masked code, the revealed code (auto-hiding back to masked), the optional copy button, and the
// reveal/hide toggle whose accessible name mirrors its state — without ever hiding a region. It performs NO
// HTTP and binds NO data state holder (the web component fetches nothing); the optional reveal audit is the
// dependency-inverted [RevealAuditSink], invoked inside a swallow-everything guard so it can never block the
// reveal. See MaskedValueModel.kt for the honesty rationale and why the generic loading/error/stale/offline
// states belong to the owning page, not this primitive. The chrome is composed from the shared ui atoms
// (IconButton / CopyButton / TeslaGlyphs) over the generated design tokens (P1/S9 — Spacing, the cyan
// `colorScheme.primary`, the secondary `onSurfaceVariant`), so it stays correct across light / dark /
// high-contrast themes; the only strings it renders resolve through the i18n catalog (P1/S10 — mask.reveal /
// mask.hide / mask.copy). The value carries the caller's semantic name (web wrapper `aria-label`); the toggle
// and copy are separately-focusable buttons each with their own state-mirroring label. A one-shot PII-safe
// `view.opened` diagnostic (P1/S11) fires on first composition, carrying only the surface slug — never the
// value. All branch selection flows through the pure [projectMaskedValue] / [toggleFor] in MaskedValueModel.kt.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/MaskedValue) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.maskedvalue

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay

/** Test tag identifying the value node (web `data-testid="masked-value"`) — used by the instrumented UI tests. */
const val MASKED_VALUE_TEST_TAG: String = "masked-value"

// The em-dash is rendered at the missing-data muted tone (web `--text-muted`), a touch dimmer than the
// secondary text the mask uses, so an absent value reads as absent rather than as a real masked value.
private const val MUTED_ALPHA: Float = 0.6f

/**
 * MaskedValue — the faithful port of the web privacy primitive. Renders [value] masked per [variant] with a
 * click-to-reveal eye toggle (auto-hiding after [autoHideMs]) and, when [copyable], a copy affordance that
 * copies the raw value regardless of mask state. [contentDescription] is the value's semantic accessible name
 * (web wrapper `ariaLabel`) so a screen reader never speaks the masked bullets or the cleartext. When
 * [auditOnReveal] is set the [revealAuditSink] records each reveal out of band (default: a no-op, matching the
 * web default). Records the one-shot PII-safe `view.opened` diagnostic on first composition.
 *
 * @param value the raw value to mask; null/empty renders an em-dash with no toggle (web `value ?? ''`).
 * @param variant the masking strategy (web `variant`).
 * @param contentDescription the value's semantic accessible name (web required `ariaLabel`).
 * @param showLast override the variant's default visible-suffix length (web `showLast`).
 * @param copyable render a copy affordance that copies the raw value (web `copyable`).
 * @param auditOnReveal record an audit event on each reveal via [revealAuditSink] (web `auditOnReveal`).
 * @param autoHideMs the auto-hide window for a revealed value (web `autoHideMs`, default 30 s).
 * @param revealAuditSink the out-of-band reveal-audit port; default no-op (web default `auditOnReveal=false`).
 * @param logger the sanctioned redacting logger; defaults to the app's data container logger.
 */
@Composable
fun MaskedValue(
    value: String?,
    variant: MaskVariant,
    contentDescription: String,
    modifier: Modifier = Modifier,
    showLast: Int? = null,
    copyable: Boolean = false,
    auditOnReveal: Boolean = false,
    autoHideMs: Long = DEFAULT_AUTO_HIDE_MS,
    revealAuditSink: RevealAuditSink = RevealAuditSink.None,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { MaskedValueDiagnostics.recordViewOpened(logger) }
    MaskedValueField(
        value = value,
        variant = variant,
        contentDescription = contentDescription,
        modifier = modifier,
        showLast = showLast,
        copyable = copyable,
        auditOnReveal = auditOnReveal,
        autoHideMs = autoHideMs,
        revealAuditSink = revealAuditSink,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point (no diagnostics, no data container). Owns the
 * reveal boolean exactly like the web `useState(false)`: it starts masked, resets to masked whenever the raw
 * value changes (a new secret is never shown pre-revealed), and re-masks after [autoHideMs]. An empty value
 * short-circuits to the [MaskedValueEmpty] em-dash (no toggle). Otherwise it lays out the monospace value, the
 * eye toggle, and the optional copy button as separately-focusable accessible nodes.
 */
@Composable
fun MaskedValueField(
    value: String?,
    variant: MaskVariant,
    contentDescription: String,
    modifier: Modifier = Modifier,
    showLast: Int? = null,
    copyable: Boolean = false,
    auditOnReveal: Boolean = false,
    autoHideMs: Long = DEFAULT_AUTO_HIDE_MS,
    revealAuditSink: RevealAuditSink = RevealAuditSink.None,
) {
    val projection = remember(value, variant, showLast) { projectMaskedValue(value, variant, showLast) }

    if (projection.isEmpty) {
        MaskedValueEmpty(contentDescription = contentDescription, modifier = modifier)
        return
    }

    // The reveal toggle starts masked and is re-keyed on the raw value, so a changed secret resets to masked —
    // the native mirror of the web `useState(false)` resetting on remount. Plain `remember` (not saveable)
    // re-masks on configuration change too, the safe default for a privacy primitive.
    var revealed by remember(projection.raw) { mutableStateOf(false) }

    // Auto-hide: once revealed, fall back to masked after the window (web 30 s `setTimeout`). Keying the effect
    // on `revealed` means a manual hide (revealed = false) cancels the pending fallback, exactly like the web
    // `clearTimer()`; a fresh reveal restarts it. A non-positive window disables auto-hide (web `autoHideMs > 0`).
    LaunchedEffect(revealed, autoHideMs) {
        if (revealed && autoHideMs > 0) {
            delay(autoHideMs)
            revealed = false
        }
    }

    val toggleLabel =
        when (toggleFor(revealed)) {
            RevealToggle.Hide -> stringResource(R.string.translation_mask_hide)
            RevealToggle.Reveal -> stringResource(R.string.translation_mask_reveal)
        }
    val colors = MaterialTheme.colorScheme

    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        // The masked/revealed value — web `<code>` (monospace, text-sm). The color is the sanctioned dynamic
        // exception: revealed -> primary (web `text-cyan-300`), masked -> onSurfaceVariant (web
        // `--text-secondary`). The semantic name is the caller's description, so the bullets/cleartext are never
        // spoken (web wrapper `aria-label`).
        Text(
            text = projection.display(revealed),
            modifier =
                Modifier
                    .testTag(MASKED_VALUE_TEST_TAG)
                    .semantics { this.contentDescription = contentDescription },
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
            color = if (revealed) colors.primary else colors.onSurfaceVariant,
        )
        IconButton(
            imageVector = if (revealed) TeslaGlyphs.EyeOff else TeslaGlyphs.Eye,
            contentDescription = toggleLabel,
            onClick = {
                if (revealed) {
                    revealed = false
                } else {
                    revealed = true
                    if (auditOnReveal) {
                        // Fire-and-forget: an audit failure must never block or break the reveal (web silent
                        // `.catch(() => {})`).
                        runCatching { revealAuditSink.recordReveal(variant) }
                    }
                }
            },
            size = IconSize.Sm,
        )
        if (copyable) {
            CopyButton(
                text = projection.raw,
                copyLabel = stringResource(R.string.translation_mask_copy),
                copiedLabel = stringResource(R.string.translation_common_copyButton_copied),
                iconOnly = true,
            )
        }
    }
}

/**
 * The empty branch — an em-dash at the muted tone with the caller's semantic name and NO toggle, since there is
 * nothing to reveal (web `raw.length === 0` short-circuit). Carries the same test tag so a test can assert the
 * empty surface renders without a blank node.
 */
@Composable
private fun MaskedValueEmpty(
    contentDescription: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = EM_DASH,
            modifier =
                Modifier
                    .testTag(MASKED_VALUE_TEST_TAG)
                    .semantics { this.contentDescription = contentDescription },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = MUTED_ALPHA),
        )
    }
}

// ── Previews (tooling-only; the sample secrets are never shipped UI) ──────────────────────────────────────

private const val PREVIEW_TOKEN = "sk_live_8f2a9c4e7b1d6035"
private const val PREVIEW_VIN = "5YJ3E1EA7KF000000"
private const val PREVIEW_LABEL = "API key"

@Preview(name = "MaskedValue · masked token (copyable)", showBackground = true)
@Composable
private fun MaskedValueTokenPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MaskedValueField(
            value = PREVIEW_TOKEN,
            variant = MaskVariant.Token,
            contentDescription = PREVIEW_LABEL,
            copyable = true,
        )
    }
}

@Preview(name = "MaskedValue · masked VIN", showBackground = true)
@Composable
private fun MaskedValueVinPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MaskedValueField(
            value = PREVIEW_VIN,
            variant = MaskVariant.Vin,
            contentDescription = "Vehicle VIN",
        )
    }
}

@Preview(name = "MaskedValue · empty (em-dash)", showBackground = true)
@Composable
private fun MaskedValueEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        MaskedValueField(
            value = null,
            variant = MaskVariant.Token,
            contentDescription = PREVIEW_LABEL,
        )
    }
}
