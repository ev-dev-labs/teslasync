// File named after its primary @Composable; the co-located helper is a supporting declaration.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.feedback

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing

/*
 * Card-style prompts mirroring the web update/draft family (`DraftRestorePrompt`, `ReloadPrompt`,
 * `InstallPrompt`). Unlike the inline banners these are self-contained [Card]s with a primary +
 * optional secondary action, suitable for floating over content (e.g. a PWA/Play update nudge).
 */

/** Restore-unsaved-draft prompt — mirrors web `DraftRestorePrompt`. */
@Composable
fun DraftRestorePrompt(
    onRestore: () -> Unit,
    onDiscard: () -> Unit,
    modifier: Modifier = Modifier,
    savedAtLabel: String? = null,
) {
    val detail = savedAtLabel?.let { "from $it " } ?: ""
    PromptCard(
        modifier = modifier,
        icon = TeslaGlyphs.Edit,
        title = "Restore unsaved draft?",
        message = "We found an unsaved draft ${detail}of this form. Restore it or discard and start fresh.",
        primaryLabel = "Restore",
        onPrimary = onRestore,
        secondaryLabel = "Discard",
        onSecondary = onDiscard,
    )
}

/** Service-worker / app-update "reload to update" prompt — mirrors web `ReloadPrompt`. */
@Composable
fun ReloadPrompt(
    onReload: () -> Unit,
    modifier: Modifier = Modifier,
    onDismiss: (() -> Unit)? = null,
) {
    PromptCard(
        modifier = modifier,
        icon = FeedbackGlyphs.Refresh,
        title = "Update ready",
        message = "A new version of TeslaSync has been downloaded. Reload to apply it.",
        primaryLabel = "Reload",
        onPrimary = onReload,
        secondaryLabel = onDismiss?.let { "Later" },
        onSecondary = onDismiss,
    )
}

/** Play install/update nudge — mirrors web `InstallPrompt` (PWA install). */
@Composable
fun InstallPrompt(
    onInstall: () -> Unit,
    modifier: Modifier = Modifier,
    onDismiss: (() -> Unit)? = null,
) {
    PromptCard(
        modifier = modifier,
        icon = FeedbackGlyphs.Download,
        title = "Install TeslaSync",
        message = "Install the app for a faster, full-screen experience with offline support.",
        primaryLabel = "Install",
        onPrimary = onInstall,
        secondaryLabel = onDismiss?.let { "Not now" },
        onSecondary = onDismiss,
    )
}

@Composable
private fun PromptCard(
    icon: ImageVector,
    title: String,
    message: String,
    primaryLabel: String,
    onPrimary: () -> Unit,
    modifier: Modifier = Modifier,
    secondaryLabel: String? = null,
    onSecondary: (() -> Unit)? = null,
) {
    Card(modifier = modifier.fillMaxWidth()) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.Top) {
            Icon(icon, contentDescription = null, size = IconSize.Lg, tint = TeslaTokens.status.info)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PanelTitle(title)
                BodyText(message)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (secondaryLabel != null && onSecondary != null) {
                        Button(secondaryLabel, onClick = onSecondary, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
                    }
                    Button(primaryLabel, onClick = onPrimary, variant = ButtonVariant.Primary, size = ButtonSize.Sm)
                }
            }
        }
    }
}
