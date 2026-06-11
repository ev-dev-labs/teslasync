package io.teslasync.android.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.notifications.NotificationPreferencesController
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * The stateless Material 3 settings screen (P3/A8). Renders every preference section — appearance,
 * accessibility, notifications, language, privacy/telemetry, data, account, and about — as
 * [GlassPanel] sections driven by the [AppSettingsController] / [NotificationPreferencesController]
 * snapshot state. All platform side effects (applying a language, launching system screens, clearing
 * the cache, signing out) are hoisted to the caller ([SettingsRoute]) as callbacks, so the visual
 * screen stays free of Android plumbing and is exercised by Compose UI tests.
 */
@Composable
fun SettingsScreen(
    appSettings: AppSettingsController,
    notifications: NotificationPreferencesController,
    notificationsEnabled: Boolean,
    languageSettingsSupported: Boolean,
    versionLabel: String,
    onSelectLanguage: (String?) -> Unit,
    onOpenNotificationSystemSettings: () -> Unit,
    onOpenLanguageSystemSettings: () -> Unit,
    onOpenPlayStore: () -> Unit,
    onClearCache: () -> Unit,
    onSignOut: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        AppearanceSection(appSettings)
        AccessibilitySection(appSettings)
        NotificationsSection(
            controller = notifications,
            notificationsEnabled = notificationsEnabled,
            onOpenSystemSettings = onOpenNotificationSystemSettings,
        )
        LanguageSection(
            appSettings = appSettings,
            languageSettingsSupported = languageSettingsSupported,
            onSelectLanguage = onSelectLanguage,
            onOpenSystemSettings = onOpenLanguageSystemSettings,
        )
        PrivacySection(appSettings)
        DataSection(onClearCache = onClearCache)
        AccountSection(onSignOut = onSignOut)
        AboutSection(versionLabel = versionLabel, onOpenPlayStore = onOpenPlayStore)
    }
}

// ── Section container + reusable preference rows ─────────────────────────────────────

/** A titled [GlassPanel] settings section with an optional [description] and a [ColumnScope] body. */
@Composable
internal fun SettingsSection(
    title: String,
    modifier: Modifier = Modifier,
    description: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    GlassPanel(modifier = modifier.fillMaxWidth()) {
        SectionTitle(title)
        if (description != null) {
            Spacer(Modifier.height(Spacing.xs))
            HelperText(description)
        }
        Spacer(Modifier.height(Spacing.sm))
        content()
    }
}

/** A switch preference row: the whole row toggles, with an optional [subtitle] beneath (P3/A8). */
@Composable
internal fun SettingsToggleRow(
    title: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    enabled: Boolean = true,
) {
    val haptic = rememberAppHaptic()
    Column(modifier = modifier.fillMaxWidth().padding(vertical = Spacing.xs)) {
        Toggle(
            checked = checked,
            onCheckedChange = { value ->
                haptic(HapticFeedbackType.LongPress)
                onCheckedChange(value)
            },
            label = title,
            enabled = enabled,
        )
        if (subtitle != null) {
            HelperText(subtitle)
        }
    }
}

/** A single-choice segmented preference row (theme mode, density, …) with an optional [subtitle]. */
@Composable
internal fun <T> SettingsSegmentedRow(
    title: String,
    options: List<Pair<T, String>>,
    selected: T,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    enabled: Boolean = true,
) {
    val haptic = rememberAppHaptic()
    Column(modifier = modifier.fillMaxWidth().padding(vertical = Spacing.xs)) {
        FieldLabelText(title)
        if (subtitle != null) {
            HelperText(subtitle)
        }
        Spacer(Modifier.height(Spacing.xs))
        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
            options.forEachIndexed { index, option ->
                SegmentedButton(
                    selected = option.first == selected,
                    enabled = enabled,
                    onClick = {
                        haptic(HapticFeedbackType.LongPress)
                        onSelect(option.first)
                    },
                    shape = SegmentedButtonDefaults.itemShape(index, options.size),
                ) {
                    Text(option.second, maxLines = 1)
                }
            }
        }
    }
}

/** A label/description row with a trailing action button (open settings, clear cache, sign out). */
@Composable
internal fun SettingsActionRow(
    title: String,
    actionLabel: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    danger: Boolean = false,
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            BodyText(title)
            if (subtitle != null) {
                HelperText(subtitle)
            }
        }
        Spacer(Modifier.width(Spacing.sm))
        Button(
            label = actionLabel,
            onClick = onClick,
            variant = if (danger) ButtonVariant.Danger else ButtonVariant.Secondary,
            size = ButtonSize.Sm,
        )
    }
}
