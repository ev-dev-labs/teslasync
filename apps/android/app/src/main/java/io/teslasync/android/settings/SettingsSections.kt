package io.teslasync.android.settings

import android.os.Build
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import io.teslasync.android.R
import io.teslasync.android.components.ui.ConfirmDialog
import io.teslasync.android.components.ui.ConfirmSeverity
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.ThemeMode
import io.teslasync.android.components.ui.UiDensity
import io.teslasync.android.notifications.NotificationKind
import io.teslasync.android.notifications.NotificationPreferencesController
import io.teslasync.android.notifications.QuietHours
import io.teslasync.android.ui.theme.generated.Spacing

private const val MINUTES_PER_HOUR = 60
private const val LAST_HOUR = 23

// ── Appearance ───────────────────────────────────────────────────────────────────

/** Theme mode, Material You dynamic color (Android 12+), high contrast, and information density. */
@Composable
internal fun AppearanceSection(appSettings: AppSettingsController) {
    val settings = appSettings.settings
    SettingsSection(
        title = stringResource(R.string.settings_section_appearance),
        description = stringResource(R.string.settings_section_appearance_desc),
    ) {
        SettingsSegmentedRow(
            title = stringResource(R.string.settings_theme),
            options =
                listOf(
                    ThemeMode.System to stringResource(R.string.settings_theme_system),
                    ThemeMode.Light to stringResource(R.string.settings_theme_light),
                    ThemeMode.Dark to stringResource(R.string.settings_theme_dark),
                ),
            selected = settings.themeMode,
            onSelect = appSettings::setThemeMode,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            SettingsToggleRow(
                title = stringResource(R.string.settings_dynamic_color),
                subtitle = stringResource(R.string.settings_dynamic_color_desc),
                checked = settings.dynamicColor,
                onCheckedChange = appSettings::setDynamicColor,
            )
        }
        SettingsToggleRow(
            title = stringResource(R.string.settings_high_contrast),
            subtitle = stringResource(R.string.settings_high_contrast_desc),
            checked = settings.highContrast,
            onCheckedChange = appSettings::setHighContrast,
        )
        SettingsSegmentedRow(
            title = stringResource(R.string.settings_density),
            options =
                listOf(
                    UiDensity.Compact to stringResource(R.string.settings_density_compact),
                    UiDensity.Comfortable to stringResource(R.string.settings_density_comfortable),
                    UiDensity.Spacious to stringResource(R.string.settings_density_spacious),
                ),
            selected = settings.density,
            onSelect = appSettings::setDensity,
        )
    }
}

// ── Accessibility ──────────────────────────────────────────────────────────────────

/** Reduced motion and in-app haptic feedback. */
@Composable
internal fun AccessibilitySection(appSettings: AppSettingsController) {
    val settings = appSettings.settings
    SettingsSection(title = stringResource(R.string.settings_section_accessibility)) {
        SettingsToggleRow(
            title = stringResource(R.string.settings_reduce_motion),
            subtitle = stringResource(R.string.settings_reduce_motion_desc),
            checked = settings.reduceMotion,
            onCheckedChange = appSettings::setReduceMotion,
        )
        SettingsToggleRow(
            title = stringResource(R.string.settings_haptics),
            subtitle = stringResource(R.string.settings_haptics_desc),
            checked = settings.haptics,
            onCheckedChange = appSettings::setHaptics,
        )
    }
}

// ── Notifications ────────────────────────────────────────────────────────────────

/** Master + per-kind toggles, quiet hours, privacy redaction, and a jump to OS channel settings. */
@Composable
internal fun NotificationsSection(
    controller: NotificationPreferencesController,
    notificationsEnabled: Boolean,
    onOpenSystemSettings: () -> Unit,
) {
    val settings = controller.settings
    SettingsSection(
        title = stringResource(R.string.settings_section_notifications),
        description = stringResource(R.string.settings_section_notifications_desc),
    ) {
        if (!notificationsEnabled) {
            HelperText(stringResource(R.string.settings_notifications_blocked))
            Spacer(Modifier.height(Spacing.xs))
        }
        SettingsToggleRow(
            title = stringResource(R.string.settings_notifications_enabled),
            checked = settings.enabled,
            onCheckedChange = controller::setEnabled,
        )
        Spacer(Modifier.height(Spacing.xs))
        FieldLabelText(stringResource(R.string.settings_notification_kinds_title))
        NotificationKind.entries.forEach { kind ->
            SettingsToggleRow(
                title = stringResource(notificationKindLabel(kind)),
                checked = settings.isKindEnabled(kind),
                onCheckedChange = { enabled -> controller.setKindEnabled(kind, enabled) },
                enabled = settings.enabled,
            )
        }
        SettingsToggleRow(
            title = stringResource(R.string.settings_redact),
            subtitle = stringResource(R.string.settings_redact_desc),
            checked = settings.redactSensitiveContent,
            onCheckedChange = controller::setRedactSensitiveContent,
        )
        SettingsToggleRow(
            title = stringResource(R.string.settings_critical_breakthrough),
            subtitle = stringResource(R.string.settings_critical_breakthrough_desc),
            checked = settings.allowCriticalBreakthrough,
            onCheckedChange = controller::setAllowCriticalBreakthrough,
        )
        SettingsToggleRow(
            title = stringResource(R.string.settings_quiet_hours),
            subtitle = stringResource(R.string.settings_quiet_hours_desc),
            checked = settings.quietHours.enabled,
            onCheckedChange = { enabled -> controller.setQuietHours(settings.quietHours.copy(enabled = enabled)) },
        )
        if (settings.quietHours.enabled) {
            QuietHoursRange(quietHours = settings.quietHours, onChange = controller::setQuietHours)
        }
        SettingsActionRow(
            title = stringResource(R.string.settings_open_system_notifications),
            actionLabel = stringResource(R.string.settings_open_action),
            onClick = onOpenSystemSettings,
        )
    }
}

@Composable
private fun QuietHoursRange(
    quietHours: QuietHours,
    onChange: (QuietHours) -> Unit,
) {
    val hourOptions = (0..LAST_HOUR).map { hour -> SelectOption(hour.toString(), formatHour(hour)) }
    Select(
        options = hourOptions,
        selectedValue = (quietHours.startMinuteOfDay / MINUTES_PER_HOUR).toString(),
        onSelect = { value -> onChange(quietHours.copy(startMinuteOfDay = value.toInt() * MINUTES_PER_HOUR)) },
        label = stringResource(R.string.settings_quiet_hours_start),
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(Spacing.xs))
    Select(
        options = hourOptions,
        selectedValue = (quietHours.endMinuteOfDay / MINUTES_PER_HOUR).toString(),
        onSelect = { value -> onChange(quietHours.copy(endMinuteOfDay = value.toInt() * MINUTES_PER_HOUR)) },
        label = stringResource(R.string.settings_quiet_hours_end),
        modifier = Modifier.fillMaxWidth(),
    )
}

private fun notificationKindLabel(kind: NotificationKind): Int =
    when (kind) {
        NotificationKind.Generic -> R.string.notif_kind_generic
        NotificationKind.Alert -> R.string.notif_kind_alert
        NotificationKind.ChargeComplete -> R.string.notif_kind_charge_complete
        NotificationKind.VehicleState -> R.string.notif_kind_vehicle_state
        NotificationKind.Automation -> R.string.notif_kind_automation
        NotificationKind.CommandResult -> R.string.notif_kind_command_result
        NotificationKind.SystemIncident -> R.string.notif_kind_system_incident
        NotificationKind.ReauthNeeded -> R.string.notif_kind_reauth
    }

private fun formatHour(hour: Int): String = hour.toString().padStart(2, '0') + ":00"

// ── Language ─────────────────────────────────────────────────────────────────────

/** Per-app language (catalog locales + follow-system), with a jump to OS settings on Android 13+. */
@Composable
internal fun LanguageSection(
    appSettings: AppSettingsController,
    languageSettingsSupported: Boolean,
    onSelectLanguage: (String?) -> Unit,
    onOpenSystemSettings: () -> Unit,
) {
    val current = appSettings.settings.languageTag ?: AppLanguage.SYSTEM_TAG
    val options =
        listOf(
            SelectOption(AppLanguage.SYSTEM_TAG, stringResource(R.string.settings_language_system)),
            SelectOption("en", stringResource(R.string.language_en)),
            SelectOption("ar", stringResource(R.string.language_ar)),
            SelectOption("he", stringResource(R.string.language_he)),
        )
    SettingsSection(
        title = stringResource(R.string.settings_section_language),
        description = stringResource(R.string.settings_section_language_desc),
    ) {
        Select(
            options = options,
            selectedValue = current,
            onSelect = { value -> onSelectLanguage(value.ifEmpty { null }) },
            label = stringResource(R.string.settings_language_label),
            modifier = Modifier.fillMaxWidth(),
        )
        if (languageSettingsSupported) {
            SettingsActionRow(
                title = stringResource(R.string.settings_open_system_language),
                actionLabel = stringResource(R.string.settings_open_action),
                onClick = onOpenSystemSettings,
            )
        }
    }
}

// ── Privacy & telemetry (ADR-016) ──────────────────────────────────────────────────

/** Diagnostics/crash-sharing opt-in (default off) plus the Play-review-safe privacy statement. */
@Composable
internal fun PrivacySection(appSettings: AppSettingsController) {
    val settings = appSettings.settings
    SettingsSection(
        title = stringResource(R.string.settings_section_privacy),
        description = stringResource(R.string.settings_section_privacy_desc),
    ) {
        SettingsToggleRow(
            title = stringResource(R.string.settings_share_diagnostics),
            subtitle = stringResource(R.string.settings_share_diagnostics_desc),
            checked = settings.shareDiagnostics,
            onCheckedChange = appSettings::setShareDiagnostics,
        )
        Spacer(Modifier.height(Spacing.xs))
        HelperText(stringResource(R.string.settings_privacy_note))
    }
}

// ── Data & storage ─────────────────────────────────────────────────────────────────

/** Offline-cache control with a confirmation gate (ADR-013). */
@Composable
internal fun DataSection(onClearCache: () -> Unit) {
    var confirming by remember { mutableStateOf(false) }
    SettingsSection(
        title = stringResource(R.string.settings_section_data),
        description = stringResource(R.string.settings_section_data_desc),
    ) {
        SettingsActionRow(
            title = stringResource(R.string.settings_clear_cache),
            subtitle = stringResource(R.string.settings_clear_cache_desc),
            actionLabel = stringResource(R.string.settings_clear_cache_action),
            onClick = { confirming = true },
        )
    }
    if (confirming) {
        ConfirmDialog(
            title = stringResource(R.string.settings_clear_cache_confirm_title),
            message = stringResource(R.string.settings_clear_cache_confirm_message),
            confirmLabel = stringResource(R.string.settings_clear_cache_action),
            cancelLabel = stringResource(R.string.settings_cancel),
            onConfirm = {
                confirming = false
                onClearCache()
            },
            onCancel = { confirming = false },
            severity = ConfirmSeverity.Warning,
            closeLabel = stringResource(R.string.settings_cancel),
        )
    }
}

// ── Account ──────────────────────────────────────────────────────────────────────

/** Secure sign-out (revokes + clears cached data) behind a destructive confirmation. */
@Composable
internal fun AccountSection(onSignOut: () -> Unit) {
    var confirming by remember { mutableStateOf(false) }
    SettingsSection(
        title = stringResource(R.string.settings_section_account),
        description = stringResource(R.string.settings_section_account_desc),
    ) {
        SettingsActionRow(
            title = stringResource(R.string.settings_sign_out),
            subtitle = stringResource(R.string.settings_sign_out_desc),
            actionLabel = stringResource(R.string.settings_sign_out_action),
            onClick = { confirming = true },
            danger = true,
        )
    }
    if (confirming) {
        ConfirmDialog(
            title = stringResource(R.string.settings_sign_out_confirm_title),
            message = stringResource(R.string.settings_sign_out_confirm_message),
            confirmLabel = stringResource(R.string.settings_sign_out_action),
            cancelLabel = stringResource(R.string.settings_cancel),
            onConfirm = {
                confirming = false
                onSignOut()
            },
            onCancel = { confirming = false },
            severity = ConfirmSeverity.Danger,
            closeLabel = stringResource(R.string.settings_cancel),
        )
    }
}

// ── About ──────────────────────────────────────────────────────────────────────────

/** App version, release-notes pointer, and the update/Play-listing hook. */
@Composable
internal fun AboutSection(
    versionLabel: String,
    onOpenPlayStore: () -> Unit,
) {
    SettingsSection(title = stringResource(R.string.settings_section_about)) {
        SettingsActionRow(
            title = stringResource(R.string.settings_release_notes),
            subtitle = stringResource(R.string.settings_release_notes_desc),
            actionLabel = stringResource(R.string.settings_open_play_store),
            onClick = onOpenPlayStore,
        )
        Spacer(Modifier.height(Spacing.xs))
        FieldLabelText(stringResource(R.string.settings_version))
        HelperText(versionLabel)
    }
}
