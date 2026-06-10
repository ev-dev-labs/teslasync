// File named after its primary @Composable; the co-located data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.ui.theme.generated.Spacing

/** Minimal user record rendered by [UserCell]. */
data class UserCellUser(
    val id: String? = null,
    val name: String? = null,
    val email: String? = null,
)

/** True when the user has at least one non-blank identity field worth rendering. */
private fun UserCellUser.isAttributable(): Boolean = !name.isNullOrBlank() || !email.isNullOrBlank() || !id.isNullOrBlank()

/**
 * Drop-in cell for user-attributed columns (audit actor, feedback reporter, …) — the Android
 * counterpart of the web `UserCell`. Renders the shared [Avatar] beside the display name with an
 * optional muted email line. A null/blank user renders an em dash so dense lists stay scannable.
 */
@Composable
fun UserCell(
    user: UserCellUser?,
    modifier: Modifier = Modifier,
    showEmail: Boolean = false,
    size: AvatarSize = AvatarSize.Sm,
    unknownLabel: String = "Unknown user",
) {
    if (user == null || !user.isAttributable()) {
        Text("\u2014", modifier = modifier, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        return
    }
    val displayName =
        user.name?.trim()?.takeIf { it.isNotEmpty() }
            ?: user.email?.substringBefore("@")?.takeIf { it.isNotEmpty() }
            ?: user.id
            ?: unknownLabel
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Avatar(userId = user.id, name = displayName, size = size, contentDescription = displayName)
        Column {
            Text(
                displayName,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (showEmail && !user.email.isNullOrBlank()) Caption(user.email)
        }
    }
}
