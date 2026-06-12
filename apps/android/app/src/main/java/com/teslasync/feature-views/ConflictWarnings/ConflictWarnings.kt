// The native Jetpack Compose + Material 3 ConflictWarnings feature view — a parity port of
// web/src/features/automations/pages/ConflictWarnings.tsx. The web component renders a vertical stack
// (`space-y-2`) of inline AlertBanners, one per automation conflict: a warning-toned banner with a triangle
// glyph when `severity === 'warning'`, an info-toned banner with an info glyph otherwise, each titled
// "Potential Conflict" with a body of `"${automation_name}": ${reason}`. When there are no conflicts the web
// component returns null — it renders nothing — and this port reproduces that exactly (an empty stack is
// never a blank box; the surface simply contributes no chrome to its host).
//
// Every derivation flows through the pure [ConflictWarningsProjection]; the composable is a thin render
// layer over the shared AlertBanner (components/feedback). The surface binds no data hook — the `conflicts`
// arrive as a prop (web parity) — and its one catalog string, the banner title, resolves through the
// generated i18n catalog (P1/S10) `automations.builder.conflict` key
// (R.string.translation_automations_builder_conflict), so there is no English literal in this file. The
// one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// Tone + glyph (P1/S9 tokens, no ported Tailwind): the web warning/info variants map to [Tone.Warning] /
// [Tone.Info], whose AlertBanner default leading glyph is the warning triangle / info circle — the same two
// lucide icons the web passes explicitly (`AlertTriangle` / `Info`), so the icon is left to the shared
// component's tone default rather than re-authored here. Inter-banner spacing uses the `Spacing.sm` (8dp)
// token, the native analogue of the web `space-y-2`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ConflictWarnings) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.conflictwarnings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point — the faithful 1:1 port of the web `ConflictWarnings({ conflicts })` prop. Records
 * the one-shot PII-safe `view.opened` diagnostic on first composition (P1/S11) and renders the stack. The
 * surface binds no data of its own; the caller supplies the [conflicts] (web parity).
 *
 * @param conflicts the automation conflicts to surface (web `conflicts`); an empty list renders nothing.
 * @param modifier the layout modifier applied to the banner stack.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ConflictWarnings(
    conflicts: List<AutomationConflict>,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { ConflictWarningsDiagnostics.recordViewOpened(logger) }
    ConflictWarningsContent(conflicts = conflicts, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Reproduces the web layout exactly: a vertical
 * [Column] (web `space-y-2`) of one AlertBanner per conflict, each titled with the localized "Potential
 * Conflict" string and bodied with `"${automation_name}": ${reason}`. When [ConflictWarningsDisplay.isHidden]
 * is set (no conflicts) it renders nothing, mirroring the web `if (conflicts.length === 0) return null`.
 */
@Composable
fun ConflictWarningsContent(
    conflicts: List<AutomationConflict>,
    modifier: Modifier = Modifier,
) {
    val display = remember(conflicts) { ConflictWarningsProjection.project(conflicts) }
    if (display.isHidden) return

    val title = stringResource(R.string.translation_automations_builder_conflict)
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        display.rows.forEach { row ->
            key(row.key) {
                AlertBanner(
                    message = row.message,
                    tone = row.severity.toTone(),
                    title = title,
                )
            }
        }
    }
}

/** Maps the vendor-neutral [ConflictSeverity] to the shared feedback [Tone] (web `variant`). */
private fun ConflictSeverity.toTone(): Tone =
    when (this) {
        ConflictSeverity.Warning -> Tone.Warning
        ConflictSeverity.Info -> Tone.Info
    }

// ── Previews (tooling-only; each @Preview exercises a render branch) ─────────────────────────────────────

private val PREVIEW_CONFLICTS =
    listOf(
        AutomationConflict(
            automationId = 12,
            automationName = "Precondition at 7am",
            reason = "Overlaps with \"Nightly charge to 80%\" on the same trigger window.",
            severity = "warning",
        ),
        AutomationConflict(
            automationId = 34,
            automationName = "Arrive-home lights",
            reason = "Shares a geofence trigger with another enabled automation.",
            severity = "info",
        ),
    )

@Preview(name = "Warning + info", showBackground = true)
@Composable
private fun ConflictWarningsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ConflictWarningsContent(conflicts = PREVIEW_CONFLICTS)
    }
}

@Preview(name = "Single warning", showBackground = true)
@Composable
private fun ConflictWarningsWarningPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ConflictWarningsContent(conflicts = listOf(PREVIEW_CONFLICTS.first()))
    }
}

@Preview(name = "Single info", showBackground = true)
@Composable
private fun ConflictWarningsInfoPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ConflictWarningsContent(conflicts = listOf(PREVIEW_CONFLICTS.last()))
    }
}
