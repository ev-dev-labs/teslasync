// File holds the dialog family; co-located data classes are supporting types.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.feedback

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing

/** One released-version entry rendered by [ChangelogModal] / [ReleaseNotes]. */
data class ChangelogEntry(
    val version: String,
    val date: String? = null,
    val notes: List<String> = emptyList(),
)

/** One keyboard shortcut row (key combo + what it does) rendered by [KeyboardShortcutsModal]. */
data class KeyboardShortcut(
    val keys: String,
    val description: String,
)

/**
 * Feedback-collection dialog mirroring web `components/feedback/FeedbackModal`. A [Textarea] plus
 * Cancel / Send; Send is disabled until non-blank and forwards the trimmed text to [onSubmit].
 */
@Composable
fun FeedbackModal(
    onDismiss: () -> Unit,
    onSubmit: (String) -> Unit,
    modifier: Modifier = Modifier,
    title: String = "Send feedback",
    label: String = "Your feedback",
) {
    var text by remember { mutableStateOf("") }
    Modal(onDismissRequest = onDismiss, modifier = modifier, title = title) {
        Textarea(value = text, onValueChange = { text = it }, label = label)
        Spacer(Modifier.height(Spacing.lg))
        DialogActions(
            confirmLabel = "Send",
            onConfirm = { onSubmit(text.trim()) },
            confirmEnabled = text.isNotBlank(),
            cancelLabel = "Cancel",
            onCancel = onDismiss,
        )
    }
}

/** Vertical list of release notes for a single [version] — also embedded in [ChangelogModal]. */
@Composable
fun ReleaseNotes(
    version: String,
    notes: List<String>,
    modifier: Modifier = Modifier,
    date: String? = null,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.CenterVertically) {
            PanelTitle(version)
            if (date != null) {
                Caption(date)
            }
        }
        if (notes.isEmpty()) {
            Caption("No notes for this release.")
        } else {
            notes.forEach { note -> BodyText("\u2022 $note") }
        }
    }
}

/** "What's new" changelog dialog mirroring web `ChangelogModal`. */
@Composable
fun ChangelogModal(
    entries: List<ChangelogEntry>,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    title: String = "What's new",
) {
    Modal(onDismissRequest = onDismiss, modifier = modifier, title = title) {
        if (entries.isEmpty()) {
            EmptyState(message = "No release notes yet.", icon = FeedbackGlyphs.Rocket)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                entries.forEach { entry ->
                    ReleaseNotes(version = entry.version, notes = entry.notes, date = entry.date)
                }
            }
        }
    }
}

/** Keyboard-shortcuts reference dialog mirroring web `KeyboardShortcutsModal`. */
@Composable
fun KeyboardShortcutsModal(
    shortcuts: List<KeyboardShortcut>,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    title: String = "Keyboard shortcuts",
) {
    Modal(onDismissRequest = onDismiss, modifier = modifier, title = title) {
        if (shortcuts.isEmpty()) {
            EmptyState(message = "No shortcuts available.", icon = FeedbackGlyphs.Keyboard)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                shortcuts.forEach { shortcut ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CodeText(shortcut.keys, modifier = Modifier.weight(WEIGHT_KEYS))
                        BodyText(shortcut.description, modifier = Modifier.weight(WEIGHT_DESC))
                    }
                }
            }
        }
    }
}

/** Soft re-authentication dialog mirroring web `ReauthDialog`. */
@Composable
fun ReauthDialog(
    onReauth: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    title: String = "Re-authenticate",
    message: String = "For your security, please sign in again to continue.",
) {
    Modal(onDismissRequest = onCancel, modifier = modifier, title = title) {
        IconLeadRow(message)
        Spacer(Modifier.height(Spacing.lg))
        DialogActions(
            confirmLabel = "Sign in",
            onConfirm = onReauth,
            cancelLabel = "Cancel",
            onCancel = onCancel,
        )
    }
}

/**
 * Hard-blocking expired-session dialog mirroring web `SessionExpiredModal`. Backdrop/back
 * dismissal are disabled (no title close button) — the only path forward is to sign in again.
 */
@Composable
fun SessionExpiredModal(
    onSignIn: () -> Unit,
    modifier: Modifier = Modifier,
    message: String = "Your session has expired. Please sign in again to continue.",
) {
    Modal(onDismissRequest = {}, modifier = modifier, dismissOnBackdrop = false) {
        SectionTitle("Session expired")
        Spacer(Modifier.height(Spacing.md))
        IconLeadRow(message)
        Spacer(Modifier.height(Spacing.lg))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End)) {
            Button("Sign in", onClick = onSignIn, variant = ButtonVariant.Primary)
        }
    }
}

/**
 * Soft session-expiry warning mirroring web `SessionExpiringModal`. Shows a live [remainingSeconds]
 * countdown, any unsaved [drafts] that would survive a forced sign-out, and Stay / Sign-out actions.
 */
@Composable
fun SessionExpiringModal(
    remainingSeconds: Int,
    onStay: () -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
    drafts: List<DraftSummary> = emptyList(),
) {
    Modal(onDismissRequest = onStay, modifier = modifier, title = "Your session is about to expire") {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.Top) {
            Icon(FeedbackGlyphs.Clock, contentDescription = null, size = IconSize.Lg, tint = TeslaTokens.status.warning)
            BodyText("You will be signed out in ${formatCountdown(remainingSeconds)}.")
        }
        if (drafts.isNotEmpty()) {
            Spacer(Modifier.height(Spacing.md))
            PanelTitle("Unsaved drafts")
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                val shown = sortedDrafts(drafts).take(MAX_DRAFTS_SHOWN)
                shown.forEach { draft -> BodyText("\u2022 ${draft.label}") }
                if (drafts.size > MAX_DRAFTS_SHOWN) {
                    Caption("+${drafts.size - MAX_DRAFTS_SHOWN} more")
                }
            }
        }
        Spacer(Modifier.height(Spacing.lg))
        DialogActions(
            confirmLabel = "Stay signed in",
            onConfirm = onStay,
            cancelLabel = "Sign out now",
            onCancel = onSignOut,
        )
    }
}

@Composable
private fun IconLeadRow(message: String) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalAlignment = Alignment.Top) {
        Icon(FeedbackGlyphs.Lock, contentDescription = null, size = IconSize.Lg, tint = TeslaTokens.status.warning)
        BodyText(message)
    }
}

@Composable
private fun DialogActions(
    confirmLabel: String,
    onConfirm: () -> Unit,
    cancelLabel: String,
    onCancel: () -> Unit,
    confirmEnabled: Boolean = true,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(cancelLabel, onClick = onCancel, variant = ButtonVariant.Secondary)
        Button(confirmLabel, onClick = onConfirm, variant = ButtonVariant.Primary, enabled = confirmEnabled)
    }
}

private const val WEIGHT_KEYS = 0.4f
private const val WEIGHT_DESC = 0.6f
private const val MAX_DRAFTS_SHOWN = 5
