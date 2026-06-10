using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the NotificationSettings feature-view's UI-thread-free logic — the tab-signal
/// settings adapter (default-on parsing), the per-channel sound-preference model and its play-gate logic, the
/// per-state projection (every section + the OS-permission branches), the i18n routing, the accessibility
/// names, the cache-then-network state-holder transitions (loading / loaded / empty / stale / offline / error),
/// the optimistic tab-signal save, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/settings/components/NotificationSettings.tsx). The WinUI view itself is exercised by the
/// app build.
/// </summary>
public sealed class NotificationSettingsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    // ---- Sound catalog (web NOTIFICATION_SOUND_CATEGORIES + categoryFallback + defaults) ----------------

    [Fact]
    public void Catalog_orders_the_seven_channels_in_web_order()
    {
        Assert.Equal(
            new[]
            {
                NotificationSoundCategory.CriticalAlert,
                NotificationSoundCategory.WarningAlert,
                NotificationSoundCategory.InfoAlert,
                NotificationSoundCategory.ChargeComplete,
                NotificationSoundCategory.DriveComplete,
                NotificationSoundCategory.AutomationRun,
                NotificationSoundCategory.Achievement,
            },
            NotificationSoundCatalog.Ordered);
    }

    [Theory]
    [InlineData(NotificationSoundCategory.CriticalAlert, "critical_alert")]
    [InlineData(NotificationSoundCategory.WarningAlert, "warning_alert")]
    [InlineData(NotificationSoundCategory.InfoAlert, "info_alert")]
    [InlineData(NotificationSoundCategory.ChargeComplete, "charge_complete")]
    [InlineData(NotificationSoundCategory.DriveComplete, "drive_complete")]
    [InlineData(NotificationSoundCategory.AutomationRun, "automation_run")]
    [InlineData(NotificationSoundCategory.Achievement, "achievement")]
    public void Catalog_wire_key_matches_web_union(NotificationSoundCategory category, string wire)
    {
        Assert.Equal(wire, NotificationSoundCatalog.WireKey(category));
        Assert.Equal("notificationSounds.category." + wire, NotificationSoundCatalog.I18nKey(category));
    }

    [Fact]
    public void Catalog_default_gates_match_web_defaults()
    {
        Assert.True(NotificationSoundCatalog.DefaultEnabled(NotificationSoundCategory.CriticalAlert));
        Assert.True(NotificationSoundCatalog.DefaultEnabled(NotificationSoundCategory.WarningAlert));
        Assert.True(NotificationSoundCatalog.DefaultEnabled(NotificationSoundCategory.ChargeComplete));
        Assert.False(NotificationSoundCatalog.DefaultEnabled(NotificationSoundCategory.InfoAlert));
        Assert.False(NotificationSoundCatalog.DefaultEnabled(NotificationSoundCategory.DriveComplete));
        Assert.False(NotificationSoundCatalog.DefaultEnabled(NotificationSoundCategory.AutomationRun));
        Assert.False(NotificationSoundCatalog.DefaultEnabled(NotificationSoundCategory.Achievement));
    }

    // ---- Tab-signal adapter (web `settings?.field !== false` default-on) --------------------------------

    [Fact]
    public void TabSignals_default_is_both_on() =>
        Assert.Equal(new NotificationTabSignals(true, true), NotificationTabSignals.Default);

    [Fact]
    public void TabSignals_missing_fields_default_on()
    {
        var signals = NotificationTabSignals.FromSettings(Json("{}"));
        Assert.True(signals.TabBadgeEnabled);
        Assert.True(signals.CriticalFlashEnabled);
    }

    [Fact]
    public void TabSignals_explicit_false_turns_off()
    {
        var signals = NotificationTabSignals.FromSettings(
            Json("{\"tab_badge_enabled\":false,\"critical_flash_enabled\":false}"));
        Assert.False(signals.TabBadgeEnabled);
        Assert.False(signals.CriticalFlashEnabled);
    }

    [Fact]
    public void TabSignals_explicit_true_stays_on()
    {
        var signals = NotificationTabSignals.FromSettings(
            Json("{\"tab_badge_enabled\":true,\"critical_flash_enabled\":false}"));
        Assert.True(signals.TabBadgeEnabled);
        Assert.False(signals.CriticalFlashEnabled);
    }

    [Fact]
    public void TabSignals_non_object_body_defaults_on()
    {
        var signals = NotificationTabSignals.FromSettings(Json("null"));
        Assert.True(signals.TabBadgeEnabled);
        Assert.True(signals.CriticalFlashEnabled);
    }

    // ---- Sound preferences (web NotificationSoundPrefs defaults + clamp + patch) ------------------------

    [Fact]
    public void SoundPreferences_default_matches_web()
    {
        var prefs = NotificationSoundPreferences.Default;
        Assert.False(prefs.Master);
        Assert.Equal(0.6, prefs.Volume);
        Assert.True(prefs.IsCategoryEnabled(NotificationSoundCategory.CriticalAlert));
        Assert.False(prefs.IsCategoryEnabled(NotificationSoundCategory.InfoAlert));
    }

    [Theory]
    [InlineData(-1.0, 0.0)]
    [InlineData(0.0, 0.0)]
    [InlineData(0.5, 0.5)]
    [InlineData(1.0, 1.0)]
    [InlineData(2.0, 1.0)]
    [InlineData(double.NaN, 0.0)]
    public void SoundPreferences_clamp_bounds_volume(double input, double expected) =>
        Assert.Equal(expected, NotificationSoundPreferences.Clamp(input));

    [Fact]
    public void SoundPreferences_with_master_and_category_and_volume()
    {
        var prefs = NotificationSoundPreferences.Default
            .WithMaster(true)
            .WithCategory(NotificationSoundCategory.InfoAlert, true)
            .WithVolume(0.25);

        Assert.True(prefs.Master);
        Assert.True(prefs.IsCategoryEnabled(NotificationSoundCategory.InfoAlert));
        Assert.Equal(0.25, prefs.Volume);
    }

    [Fact]
    public void SoundPreferences_with_volume_clamps()
    {
        Assert.Equal(1.0, NotificationSoundPreferences.Default.WithVolume(5).Volume);
        Assert.Equal(0.0, NotificationSoundPreferences.Default.WithVolume(-3).Volume);
    }

    [Fact]
    public void SoundPreferences_normalized_fills_every_channel()
    {
        var prefs = new NotificationSoundPreferences
        {
            Master = true,
            PerCategory = new Dictionary<NotificationSoundCategory, bool>(),
            Volume = 0.3,
        }.Normalized();

        foreach (var category in NotificationSoundCatalog.Ordered)
        {
            Assert.Equal(NotificationSoundCatalog.DefaultEnabled(category), prefs.IsCategoryEnabled(category));
        }
    }

    // ---- Sound play-gate (web playNotificationSound + handleTestSound) ----------------------------------

    [Fact]
    public void Playback_master_off_is_master_off()
    {
        var result = NotificationSoundPlayback.Evaluate(
            NotificationSoundPreferences.Default,
            NotificationSoundCategory.CriticalAlert);
        Assert.False(result.Played);
        Assert.Equal(NotificationSoundPlayReason.MasterOff, result.Reason);
    }

    [Fact]
    public void Playback_category_off_is_category_off()
    {
        var prefs = NotificationSoundPreferences.Default.WithMaster(true);
        var result = NotificationSoundPlayback.Evaluate(prefs, NotificationSoundCategory.InfoAlert);
        Assert.False(result.Played);
        Assert.Equal(NotificationSoundPlayReason.CategoryOff, result.Reason);
    }

    [Fact]
    public void Playback_volume_zero_is_volume_zero()
    {
        var prefs = NotificationSoundPreferences.Default.WithMaster(true).WithVolume(0);
        var result = NotificationSoundPlayback.Evaluate(prefs, NotificationSoundCategory.CriticalAlert);
        Assert.False(result.Played);
        Assert.Equal(NotificationSoundPlayReason.VolumeZero, result.Reason);
    }

    [Fact]
    public void Playback_unavailable_audio_is_unavailable()
    {
        var prefs = NotificationSoundPreferences.Default.WithMaster(true);
        var result = NotificationSoundPlayback.Evaluate(prefs, NotificationSoundCategory.CriticalAlert, audioAvailable: false);
        Assert.False(result.Played);
        Assert.Equal(NotificationSoundPlayReason.Unavailable, result.Reason);
    }

    [Fact]
    public void Playback_all_gates_open_plays()
    {
        var prefs = NotificationSoundPreferences.Default.WithMaster(true);
        var result = NotificationSoundPlayback.Evaluate(prefs, NotificationSoundCategory.CriticalAlert);
        Assert.True(result.Played);
        Assert.Equal(NotificationSoundPlayReason.Played, result.Reason);
    }

    [Fact]
    public void Playback_test_override_forces_master_category_and_volume_floor()
    {
        // Master off, channel off, volume zero — the web Test button still plays.
        var prefs = NotificationSoundPreferences.Default.WithVolume(0);
        var forced = NotificationSoundPlayback.TestOverride(prefs, NotificationSoundCategory.InfoAlert);

        Assert.True(forced.Master);
        Assert.True(forced.IsCategoryEnabled(NotificationSoundCategory.InfoAlert));
        Assert.Equal(0.5, forced.Volume);
        Assert.True(NotificationSoundPlayback.Evaluate(forced, NotificationSoundCategory.InfoAlert).Played);
    }

    // ---- Projection: default render (all three sections) -----------------------------------------------

    [Fact]
    public void Project_default_renders_all_three_sections()
    {
        var display = Project(NotificationPermissionStatus.Default);

        Assert.Equal("Browser Notifications", display.Permission.Title);
        Assert.Equal("Get notified when the app tab is in the background", display.Permission.Subtitle);
        Assert.Equal("Browser tab signals", display.TabSignals.Heading);
        Assert.Equal("Notification sounds", display.Sounds.Title);
        Assert.Equal(7, display.Sounds.Categories.Count);
        Assert.Equal("Browser Notifications", display.AutomationName);
    }

    // ---- Projection: OS-permission branches (web permission states) ------------------------------------

    [Fact]
    public void Project_unsupported_shows_unsupported_message()
    {
        var permission = Project(NotificationPermissionStatus.Unsupported).Permission;
        Assert.False(permission.IsSupported);
        Assert.False(permission.ShowEnableButton);
        Assert.False(permission.ShowEvents);
        Assert.Equal("Browser notifications are not supported in this browser.", permission.UnsupportedMessage);
    }

    [Fact]
    public void Project_default_shows_enable_button()
    {
        var permission = Project(NotificationPermissionStatus.Default).Permission;
        Assert.True(permission.IsSupported);
        Assert.True(permission.ShowEnableButton);
        Assert.False(permission.ShowEnabledBadge);
        Assert.False(permission.ShowEvents);
        Assert.Equal("Enable Browser Notifications", permission.EnableButtonText);
    }

    [Fact]
    public void Project_granted_shows_badge_and_event_toggles()
    {
        var permission = Project(NotificationPermissionStatus.Granted).Permission;
        Assert.True(permission.ShowEnabledBadge);
        Assert.True(permission.ShowEvents);
        Assert.False(permission.ShowEnableButton);
        Assert.Equal("Enabled", permission.EnabledBadgeText);
        Assert.Equal("Notify me about", permission.EventsHeading);
        Assert.Equal("Alerts", permission.Alerts.Label);
        Assert.Equal("Export completions", permission.ExportStatus.Label);
    }

    [Fact]
    public void Project_denied_shows_blocked_message()
    {
        var permission = Project(NotificationPermissionStatus.Denied).Permission;
        Assert.True(permission.ShowBlocked);
        Assert.False(permission.ShowEnableButton);
        Assert.False(permission.ShowEvents);
        Assert.Equal("Notifications are blocked. Enable in your browser settings.", permission.BlockedMessage);
    }

    [Fact]
    public void Project_event_toggle_values_reflect_push_prefs()
    {
        var display = NotificationSettingsProjection.Project(
            NotificationPermissionStatus.Granted,
            new WebPushPreferences(true, false),
            NotificationTabSignals.Default,
            NotificationSoundPreferences.Default,
            autoplayHintDismissed: false,
            Localizer);

        Assert.True(display.Permission.Alerts.IsOn);
        Assert.False(display.Permission.ExportStatus.IsOn);
    }

    // ---- Projection: tab signals ------------------------------------------------------------------------

    [Fact]
    public void Project_tab_signal_values_reflect_settings()
    {
        var display = NotificationSettingsProjection.Project(
            NotificationPermissionStatus.Default,
            WebPushPreferences.Default,
            new NotificationTabSignals(false, true),
            NotificationSoundPreferences.Default,
            autoplayHintDismissed: false,
            Localizer);

        Assert.False(display.TabSignals.Badge.IsOn);
        Assert.True(display.TabSignals.Flash.IsOn);
        Assert.Equal("Show unread count in browser tab", display.TabSignals.Badge.Label);
        Assert.Equal("Flash tab title on critical alerts", display.TabSignals.Flash.Label);
    }

    // ---- Projection: sounds (master dim, autoplay hint, volume %, channels) ----------------------------

    [Fact]
    public void Project_sounds_dim_and_hint_follow_master()
    {
        var off = ProjectSounds(NotificationSoundPreferences.Default);
        Assert.False(off.ShowAutoplayHint);
        Assert.True(off.Categories[0].Dimmed);
        Assert.False(off.VolumeEnabled);

        var on = ProjectSounds(NotificationSoundPreferences.Default.WithMaster(true));
        Assert.True(on.ShowAutoplayHint);
        Assert.False(on.Categories[0].Dimmed);
        Assert.True(on.VolumeEnabled);
    }

    [Fact]
    public void Project_autoplay_hint_hidden_when_dismissed()
    {
        var display = NotificationSettingsProjection.Project(
            NotificationPermissionStatus.Default,
            WebPushPreferences.Default,
            NotificationTabSignals.Default,
            NotificationSoundPreferences.Default.WithMaster(true),
            autoplayHintDismissed: true,
            Localizer);

        Assert.False(display.Sounds.ShowAutoplayHint);
    }

    [Theory]
    [InlineData(0.0, 0, "0%")]
    [InlineData(0.6, 60, "60%")]
    [InlineData(0.555, 56, "56%")]
    [InlineData(1.0, 100, "100%")]
    public void Project_volume_percent_rounds_like_web(double volume, int percent, string text)
    {
        var sounds = ProjectSounds(NotificationSoundPreferences.Default.WithVolume(volume));
        Assert.Equal(percent, sounds.VolumePercent);
        Assert.Equal(text, sounds.VolumeValueText);
    }

    [Fact]
    public void Project_channels_render_in_order_with_labels()
    {
        var sounds = ProjectSounds(NotificationSoundPreferences.Default);
        for (int i = 0; i < NotificationSoundCatalog.Ordered.Count; i++)
        {
            Assert.Equal(NotificationSoundCatalog.Ordered[i], sounds.Categories[i].Category);
            Assert.Equal(NotificationSoundCatalog.Fallback(sounds.Categories[i].Category), sounds.Categories[i].Label);
        }
    }

    // ---- i18n routing (every owned string flows through the facade) ------------------------------------

    [Fact]
    public void Project_routes_owned_strings_through_localizer()
    {
        var display = NotificationSettingsProjection.Project(
            NotificationPermissionStatus.Granted,
            WebPushPreferences.Default,
            NotificationTabSignals.Default,
            NotificationSoundPreferences.Default,
            autoplayHintDismissed: false,
            new PrefixLocalizer());

        Assert.Equal("L:browserNotifications.title", display.Permission.Title);
        Assert.Equal("L:browserNotifications.events", display.Permission.EventsHeading);
        Assert.Equal("L:settings.tab.heading", display.TabSignals.Heading);
        Assert.Equal("L:notificationSounds.title", display.Sounds.Title);
        Assert.Equal("L:notificationSounds.category.critical_alert", display.Sounds.Categories[0].Label);
    }

    [Fact]
    public void Project_test_aria_interpolates_channel_name()
    {
        var sounds = ProjectSounds(NotificationSoundPreferences.Default);
        Assert.Equal("Test Critical alerts sound", sounds.Categories[0].TestAutomationName);
        Assert.Equal("Test", sounds.Categories[0].TestLabel);
    }

    // ---- Accessibility (every interactive element carries a Narrator name) -----------------------------

    [Fact]
    public void Project_interactive_elements_have_automation_names()
    {
        var display = Project(NotificationPermissionStatus.Granted);

        Assert.False(string.IsNullOrWhiteSpace(display.Permission.Alerts.AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(display.Permission.ExportStatus.AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(display.TabSignals.Badge.AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(display.TabSignals.Flash.AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(display.Sounds.Master.AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(display.Sounds.VolumeAutomationName));
        foreach (var row in display.Sounds.Categories)
        {
            Assert.False(string.IsNullOrWhiteSpace(row.ToggleAutomationName));
            Assert.False(string.IsNullOrWhiteSpace(row.TestAutomationName));
        }
    }

    // ---- Projection guards ------------------------------------------------------------------------------

    [Fact]
    public void Project_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => NotificationSettingsProjection.Project(
            NotificationPermissionStatus.Default,
            WebPushPreferences.Default,
            NotificationTabSignals.Default,
            NotificationSoundPreferences.Default,
            false,
            null!));

    [Fact]
    public void Playback_evaluate_rejects_null_prefs() =>
        Assert.Throws<ArgumentNullException>(() =>
            NotificationSoundPlayback.Evaluate(null!, NotificationSoundCategory.CriticalAlert));

    // ---- View-model: cache-then-network state transitions ----------------------------------------------

    [Fact]
    public async Task ViewModel_loading_then_loaded()
    {
        using var vm = NewViewModel(new FakeTabSource(
            RepositoryResult<NotificationTabSignals>.Loading(),
            RepositoryResult<NotificationTabSignals>.Loaded(new NotificationTabSignals(false, true), Now)));

        await vm.LoadAsync();

        Assert.Equal(NotificationSettingsState.Loaded, vm.State);
        Assert.False(vm.IsError);
        Assert.False(vm.TabSignals.TabBadgeEnabled);
        Assert.True(vm.TabSignals.CriticalFlashEnabled);
        Assert.Equal(Now, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_cached_stale_is_stale()
    {
        using var vm = NewViewModel(new FakeTabSource(
            RepositoryResult<NotificationTabSignals>.Loading(),
            RepositoryResult<NotificationTabSignals>.Cached(NotificationTabSignals.Default, Now, stale: true)));

        await vm.LoadAsync();

        Assert.Equal(NotificationSettingsState.Stale, vm.State);
        Assert.True(vm.IsStale);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_cache_and_message()
    {
        using var vm = NewViewModel(new FakeTabSource(
            RepositoryResult<NotificationTabSignals>.Loading(),
            RepositoryResult<NotificationTabSignals>.OfflineCached(
                new NotificationTabSignals(false, false),
                Now,
                new RepositoryError(RepositoryErrorKind.Network, "offline"))));

        await vm.LoadAsync();

        Assert.Equal(NotificationSettingsState.Offline, vm.State);
        Assert.False(vm.TabSignals.CriticalFlashEnabled);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_failure_is_error()
    {
        using var vm = NewViewModel(new FakeTabSource(
            RepositoryResult<NotificationTabSignals>.Loading(),
            RepositoryResult<NotificationTabSignals>.Failure(
                new RepositoryError(RepositoryErrorKind.Server, "boom"))));

        await vm.LoadAsync();

        Assert.Equal(NotificationSettingsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_empty_falls_back_to_default_signals()
    {
        using var vm = NewViewModel(new FakeTabSource(
            RepositoryResult<NotificationTabSignals>.Loading(),
            RepositoryResult<NotificationTabSignals>.Empty(Now)));

        await vm.LoadAsync();

        Assert.Equal(NotificationSettingsState.Empty, vm.State);
        Assert.Equal(NotificationTabSignals.Default, vm.TabSignals);
    }

    [Fact]
    public async Task ViewModel_retry_recovers_from_error()
    {
        var fake = new FakeTabSource(
            RepositoryResult<NotificationTabSignals>.Loading(),
            RepositoryResult<NotificationTabSignals>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        using var vm = NewViewModel(fake);
        await vm.LoadAsync();
        Assert.Equal(NotificationSettingsState.Error, vm.State);

        fake.Replace(
            RepositoryResult<NotificationTabSignals>.Loading(),
            RepositoryResult<NotificationTabSignals>.Loaded(NotificationTabSignals.Default, Now));
        await vm.RetryAsync();

        Assert.Equal(NotificationSettingsState.Loaded, vm.State);
        Assert.Equal(2, vm.Attempts);
    }

    // ---- View-model: actions (optimistic save + local stores) ------------------------------------------

    [Fact]
    public async Task ViewModel_toggle_tab_badge_is_optimistic_and_saves()
    {
        var fake = new FakeTabSource(
            RepositoryResult<NotificationTabSignals>.Loading(),
            RepositoryResult<NotificationTabSignals>.Loaded(new NotificationTabSignals(true, true), Now));
        using var vm = NewViewModel(fake);
        await vm.LoadAsync();

        vm.SetTabBadge(false);

        Assert.False(vm.TabSignals.TabBadgeEnabled);
        Assert.False(vm.Display.TabSignals.Badge.IsOn);
        Assert.Contains(fake.Saved, s => !s.TabBadgeEnabled && s.CriticalFlashEnabled);
    }

    [Fact]
    public void ViewModel_toggle_events_update_push_store()
    {
        var push = new InMemoryWebPushPreferenceStore();
        using var vm = NewViewModel(new FakeTabSource(), push: push);

        vm.SetAlerts(false);
        vm.SetExportStatus(false);

        Assert.False(push.Current.Alerts);
        Assert.False(push.Current.ExportStatus);
        Assert.False(vm.Display.Permission.Alerts.IsOn);
    }

    [Fact]
    public void ViewModel_sound_actions_update_sound_store()
    {
        var sound = new InMemoryNotificationSoundPreferenceStore();
        using var vm = NewViewModel(new FakeTabSource(), sound: sound);

        vm.SetSoundMaster(true);
        vm.SetSoundCategory(NotificationSoundCategory.InfoAlert, true);
        vm.SetVolumePercent(40);

        Assert.True(sound.Current.Master);
        Assert.True(sound.Current.IsCategoryEnabled(NotificationSoundCategory.InfoAlert));
        Assert.Equal(0.4, sound.Current.Volume, 3);
        Assert.True(vm.Display.Sounds.Master.IsOn);
        Assert.Equal(40, vm.Display.Sounds.VolumePercent);
    }

    [Fact]
    public void ViewModel_test_sound_forces_playback()
    {
        var sound = new InMemoryNotificationSoundPreferenceStore();
        using var vm = NewViewModel(new FakeTabSource(), sound: sound);

        var result = vm.TestSound(NotificationSoundCategory.InfoAlert);

        Assert.True(result.Played);
        Assert.False(sound.Current.Master); // the forced override does not mutate the saved prefs
    }

    [Fact]
    public async Task ViewModel_request_permission_transitions_and_reprojects()
    {
        using var vm = NewViewModel(new FakeTabSource(), permission: NotificationPermissionStatus.Default);
        Assert.True(vm.Display.Permission.ShowEnableButton);

        await vm.RequestPermissionAsync();

        Assert.Equal(NotificationPermissionStatus.Granted, vm.Permission);
        Assert.True(vm.Display.Permission.ShowEnabledBadge);
        Assert.True(vm.Display.Permission.ShowEvents);
    }

    [Fact]
    public void ViewModel_external_store_change_reprojects()
    {
        var sound = new InMemoryNotificationSoundPreferenceStore();
        using var vm = NewViewModel(new FakeTabSource(), sound: sound);
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        sound.Update(NotificationSoundPreferences.Default.WithMaster(true));

        Assert.True(vm.Display.Sounds.Master.IsOn);
        Assert.Contains(nameof(NotificationSettingsViewModel.Display), raised);
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        var source = new FakeTabSource();
        var permission = new InMemoryNotificationPermissionGateway();
        var push = new InMemoryWebPushPreferenceStore();
        var sound = new InMemoryNotificationSoundPreferenceStore();

        Assert.Throws<ArgumentNullException>(() => new NotificationSettingsViewModel(null!, permission, push, sound, Localizer));
        Assert.Throws<ArgumentNullException>(() => new NotificationSettingsViewModel(source, null!, push, sound, Localizer));
        Assert.Throws<ArgumentNullException>(() => new NotificationSettingsViewModel(source, permission, null!, sound, Localizer));
        Assert.Throws<ArgumentNullException>(() => new NotificationSettingsViewModel(source, permission, push, null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => new NotificationSettingsViewModel(source, permission, push, sound, null!));
    }

    // ---- Diagnostics (view.opened, PII-safe) -----------------------------------------------------------

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new NotificationSettingsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=NotificationSettings", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("NotificationSettings", NotificationSettingsRegistration.Slug);
        Assert.Equal("get_api_v1_settings", NotificationSettingsRegistration.SettingsGetOperation);
        Assert.Equal("put_api_v1_settings", NotificationSettingsRegistration.SettingsPutOperation);
        Assert.Equal(7, NotificationSettingsRegistration.SoundCategories.Count);
    }

    // ---- Source defaults (in-memory seams) -------------------------------------------------------------

    [Fact]
    public async Task PermissionGateway_default_grants_on_request()
    {
        var gateway = new InMemoryNotificationPermissionGateway();
        bool raised = false;
        gateway.StatusChanged += (_, _) => raised = true;

        var result = await gateway.RequestAsync();

        Assert.Equal(NotificationPermissionStatus.Granted, result);
        Assert.True(raised);
    }

    [Fact]
    public async Task PermissionGateway_denied_stays_denied_on_request()
    {
        var gateway = new InMemoryNotificationPermissionGateway(NotificationPermissionStatus.Denied);
        Assert.Equal(NotificationPermissionStatus.Denied, await gateway.RequestAsync());
    }

    // ---- Helpers / test doubles ------------------------------------------------------------------------

    private static NotificationSettingsDisplay Project(NotificationPermissionStatus permission) =>
        NotificationSettingsProjection.Project(
            permission,
            WebPushPreferences.Default,
            NotificationTabSignals.Default,
            NotificationSoundPreferences.Default,
            autoplayHintDismissed: false,
            Localizer);

    private static NotificationSoundsDisplay ProjectSounds(NotificationSoundPreferences soundPrefs) =>
        NotificationSettingsProjection.Project(
            NotificationPermissionStatus.Default,
            WebPushPreferences.Default,
            NotificationTabSignals.Default,
            soundPrefs,
            autoplayHintDismissed: false,
            Localizer).Sounds;

    private static NotificationSettingsViewModel NewViewModel(
        INotificationTabSignalsSource source,
        NotificationPermissionStatus permission = NotificationPermissionStatus.Default,
        IWebPushPreferenceStore? push = null,
        INotificationSoundPreferenceStore? sound = null) =>
        new(
            source,
            new InMemoryNotificationPermissionGateway(permission),
            push ?? new InMemoryWebPushPreferenceStore(),
            sound ?? new InMemoryNotificationSoundPreferenceStore(),
            Localizer);

    private static JsonElement Json(string raw) => JsonSerializer.Deserialize<JsonElement>(raw);

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }

    private sealed class FakeTabSource : INotificationTabSignalsSource
    {
        private RepositoryResult<NotificationTabSignals>[] _emissions;

        public FakeTabSource(params RepositoryResult<NotificationTabSignals>[] emissions) => _emissions = emissions;

        public List<NotificationTabSignals> Saved { get; } = new();

        public void Replace(params RepositoryResult<NotificationTabSignals>[] emissions) => _emissions = emissions;

        public async IAsyncEnumerable<RepositoryResult<NotificationTabSignals>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in _emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }

        public Task SaveAsync(NotificationTabSignals signals, CancellationToken cancellationToken = default)
        {
            Saved.Add(signals);
            return Task.CompletedTask;
        }
    }
}
