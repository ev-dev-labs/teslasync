using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the SecurityPanel's UI-thread-free logic — the <c>/security/latest</c> parse adapter
/// (the nullable lock / sentry / user-present booleans, the door / window scalars and the detail note), the
/// merged-snapshot HasData / HasSecurity gates, the projection (the lock tile + the Sentry / Doors / Windows /
/// User Present rows and the always-present Remote Start row, their formatted values, token brush keys, glyphs,
/// labels and accessibility names), the cache-then-network result mapper, the registration metadata, the
/// diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error /
/// stale / offline). Mirrors the web spec
/// (web/src/features/vehicles/components/telemetry-panels/SecurityPanel.tsx).
/// </summary>
public sealed class SecurityPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 10, 12, 5, 0, TimeSpan.Zero);

    // ---- Security parse adapter ----------------------------------------------------

    [Fact]
    public void Reading_FromResponse_reads_every_field()
    {
        using var doc = JsonDocument.Parse("""
        {
          "locked": true, "sentry_mode": false, "doors_open": "Closed",
          "windows_open": "Open", "user_present": true, "detail": "Door left ajar"
        }
        """);

        var reading = SecurityPanelReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.True(reading!.Locked);
        Assert.False(reading.SentryMode);
        Assert.Equal("Closed", reading.DoorsOpen);
        Assert.Equal("Open", reading.WindowsOpen);
        Assert.True(reading.UserPresent);
        Assert.Equal("Door left ajar", reading.Detail);
    }

    [Fact]
    public void Reading_FromResponse_returns_null_for_non_object()
    {
        using var nul = JsonDocument.Parse("null");
        Assert.Null(SecurityPanelReading.FromResponse(nul.RootElement));

        using var arr = JsonDocument.Parse("[]");
        Assert.Null(SecurityPanelReading.FromResponse(arr.RootElement));
    }

    [Fact]
    public void Reading_FromResponse_object_with_missing_fields_parses_all_null()
    {
        using var doc = JsonDocument.Parse("{}");

        var reading = SecurityPanelReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Null(reading!.Locked);
        Assert.Null(reading.SentryMode);
        Assert.Null(reading.DoorsOpen);
        Assert.Null(reading.WindowsOpen);
        Assert.Null(reading.UserPresent);
        Assert.Null(reading.Detail);
    }

    [Fact]
    public void Reading_FromResponse_tolerates_boolean_strings_and_numbers()
    {
        // Backend serializes raw signal.SignalValue: booleans can arrive as boolean strings or numbers.
        using var doc = JsonDocument.Parse("""{ "locked": "true", "sentry_mode": 1, "user_present": 0 }""");

        var reading = SecurityPanelReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.True(reading!.Locked);
        Assert.True(reading.SentryMode);
        Assert.False(reading.UserPresent);
    }

    [Fact]
    public void Reading_FromResponse_never_coerces_non_string_doors_to_text()
    {
        // doors_open is typed string|null; a boolean wire value narrows to null (the localized "Closed" fallback).
        using var doc = JsonDocument.Parse("""{ "doors_open": false, "windows_open": 3 }""");

        var reading = SecurityPanelReading.FromResponse(doc.RootElement);

        Assert.NotNull(reading);
        Assert.Null(reading!.DoorsOpen);
        Assert.Null(reading.WindowsOpen);
    }

    // ---- Snapshot HasData / HasSecurity gates --------------------------------------

    [Fact]
    public void Snapshot_hasData_when_security_present_or_remote_start_known()
    {
        Assert.True(new SecurityPanelSnapshot(Reading(locked: true), null).HasData);
        Assert.True(new SecurityPanelSnapshot(null, true).HasData);

        // Web parity: remoteStartEnabled != null — a known false flag still counts as data.
        Assert.True(new SecurityPanelSnapshot(null, false).HasData);
        Assert.False(new SecurityPanelSnapshot(null, null).HasData);
    }

    [Fact]
    public void Snapshot_hasSecurity_only_when_security_event_present()
    {
        Assert.True(new SecurityPanelSnapshot(Reading(locked: true), null).HasSecurity);
        Assert.False(new SecurityPanelSnapshot(null, true).HasSecurity);
    }

    // ---- Projection: lock tile -----------------------------------------------------

    [Fact]
    public void Project_lock_tile_locked_is_emerald_lock()
    {
        var view = Project(new SecurityPanelSnapshot(Reading(locked: true), null));

        Assert.True(view.HasData);
        Assert.True(view.HasSecurity);
        Assert.NotNull(view.LockTile);
        Assert.Equal("Locked", view.LockTile!.Text);
        Assert.Equal(SecurityPanelProjection.LockedGlyph, view.LockTile.Glyph);
        Assert.Equal(SecurityPanelProjection.SuccessBrushKey, view.LockTile.AccentBrushKey);
        Assert.Equal("Vehicle lock status", view.LockTile.Caption);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(null)]
    public void Project_lock_tile_unlocked_is_amber_unlock(bool? locked)
    {
        var view = Project(new SecurityPanelSnapshot(Reading(locked: locked), null));

        Assert.Equal("Unlocked", view.LockTile!.Text);
        Assert.Equal(SecurityPanelProjection.UnlockedGlyph, view.LockTile.Glyph);
        Assert.Equal(SecurityPanelProjection.WarningBrushKey, view.LockTile.AccentBrushKey);
    }

    // ---- Projection: rows ----------------------------------------------------------

    [Fact]
    public void Project_builds_the_four_security_rows_in_order()
    {
        var view = Project(new SecurityPanelSnapshot(
            Reading(locked: true, sentry: true, doors: "Open", windows: "Closed", present: true), null));

        Assert.Equal(4, view.SecurityRows.Count);
        Assert.Equal("sentry", view.SecurityRows[0].Key);
        Assert.Equal("doors", view.SecurityRows[1].Key);
        Assert.Equal("windows", view.SecurityRows[2].Key);
        Assert.Equal("userPresent", view.SecurityRows[3].Key);
    }

    [Fact]
    public void Project_sentry_active_is_a_danger_badge_with_shield_glyph()
    {
        var row = Project(new SecurityPanelSnapshot(Reading(sentry: true), null)).SecurityRows[0];

        Assert.Equal("Active", row.ValueText);
        Assert.Equal(SecurityValueKind.Badge, row.ValueKind);
        Assert.Equal(StatusKind.Danger, row.BadgeStatus);
        Assert.Equal(SecurityPanelProjection.ShieldGlyph, row.BadgeGlyph);
        Assert.Equal(SecurityPanelProjection.SentryGlyph, row.Glyph);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(null)]
    public void Project_sentry_inactive_is_a_neutral_badge(bool? sentry)
    {
        var row = Project(new SecurityPanelSnapshot(Reading(sentry: sentry), null)).SecurityRows[0];

        Assert.Equal("Inactive", row.ValueText);
        Assert.Equal(StatusKind.Neutral, row.BadgeStatus);
    }

    [Fact]
    public void Project_doors_and_windows_render_value_or_closed_fallback()
    {
        var withValues = Project(new SecurityPanelSnapshot(Reading(doors: "Open", windows: "Vented"), null));
        Assert.Equal("Open", withValues.SecurityRows[1].ValueText);
        Assert.Equal("Vented", withValues.SecurityRows[2].ValueText);
        Assert.Equal(SecurityValueKind.MonoText, withValues.SecurityRows[1].ValueKind);
        Assert.Equal(SecurityPanelProjection.PrimaryBrushKey, withValues.SecurityRows[1].TextBrushKey);

        // Web parity: `doors_open ?? 'Closed'` — absent fields fall back to the localized "Closed".
        var missing = Project(new SecurityPanelSnapshot(Reading(), null));
        Assert.Equal("Closed", missing.SecurityRows[1].ValueText);
        Assert.Equal("Closed", missing.SecurityRows[2].ValueText);
    }

    [Fact]
    public void Project_user_present_yes_is_emerald_no_is_muted()
    {
        var yes = Project(new SecurityPanelSnapshot(Reading(present: true), null)).SecurityRows[3];
        Assert.Equal("Yes", yes.ValueText);
        Assert.Equal(SecurityValueKind.AccentText, yes.ValueKind);
        Assert.Equal(SecurityPanelProjection.SuccessBrushKey, yes.TextBrushKey);

        var no = Project(new SecurityPanelSnapshot(Reading(present: false), null)).SecurityRows[3];
        Assert.Equal("No", no.ValueText);
        Assert.Equal(SecurityPanelProjection.MutedBrushKey, no.TextBrushKey);
    }

    [Fact]
    public void Project_detail_present_is_trimmed_blank_is_null()
    {
        Assert.Equal("ajar", Project(new SecurityPanelSnapshot(Reading(detail: "  ajar  "), null)).Detail);
        Assert.Null(Project(new SecurityPanelSnapshot(Reading(detail: "   "), null)).Detail);
        Assert.Null(Project(new SecurityPanelSnapshot(Reading(), null)).Detail);
    }

    // ---- Projection: remote start (always present) ---------------------------------

    [Fact]
    public void Project_remote_start_enabled_disabled_unknown()
    {
        var enabled = Project(new SecurityPanelSnapshot(null, true)).RemoteStart;
        Assert.Equal("Enabled", enabled.ValueText);
        Assert.Equal(SecurityValueKind.AccentText, enabled.ValueKind);
        Assert.Equal(SecurityPanelProjection.SuccessBrushKey, enabled.TextBrushKey);
        Assert.Equal(SecurityPanelProjection.RemoteStartGlyph, enabled.Glyph);

        var disabled = Project(new SecurityPanelSnapshot(null, false)).RemoteStart;
        Assert.Equal("Disabled", disabled.ValueText);
        Assert.Equal(SecurityPanelProjection.MutedBrushKey, disabled.TextBrushKey);

        // Web parity: remoteStartEnabled == null renders the em dash.
        var unknown = Project(new SecurityPanelSnapshot(Reading(locked: true), null)).RemoteStart;
        Assert.Equal(SecurityPanelProjection.EmDash, unknown.ValueText);
        Assert.Equal(SecurityPanelProjection.MutedBrushKey, unknown.TextBrushKey);
    }

    [Fact]
    public void Project_without_security_event_renders_only_remote_start()
    {
        var view = Project(new SecurityPanelSnapshot(null, true));

        Assert.True(view.HasData);
        Assert.False(view.HasSecurity);
        Assert.Null(view.LockTile);
        Assert.Empty(view.SecurityRows);
        Assert.Equal("Enabled", view.RemoteStart.ValueText);
    }

    // ---- i18n: every label resolves through its catalog key ------------------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();
        var view = SecurityPanelProjection.Project(
            new SecurityPanelSnapshot(Reading(locked: true, sentry: true, present: true), true), echo);

        Assert.Equal("L:common.security", view.Title);
        Assert.Equal("L:security.panel.aria", view.AriaLabel);
        Assert.Equal("L:telemetry.noSecurityData", view.EmptyMessage);

        Assert.Equal("L:common.locked", view.LockTile!.Text);
        Assert.Equal("L:telemetry.lockStatus", view.LockTile.Caption);

        Assert.Equal("L:telemetry.sentryMode", view.SecurityRows[0].Label);
        Assert.Equal("L:common.active", view.SecurityRows[0].ValueText);
        Assert.Equal("L:telemetry.doors", view.SecurityRows[1].Label);
        Assert.Equal("L:telemetry.windows", view.SecurityRows[2].Label);
        Assert.Equal("L:telemetry.userPresent", view.SecurityRows[3].Label);
        Assert.Equal("L:common.yes", view.SecurityRows[3].ValueText);

        Assert.Equal("L:telemetry.remoteStart", view.RemoteStart.Label);
        Assert.Equal("L:common.enabled", view.RemoteStart.ValueText);
    }

    [Fact]
    public void Labels_resolve_inactive_unlocked_closed_no_disabled_keys()
    {
        var echo = new KeyEchoLocalizer();
        var view = SecurityPanelProjection.Project(
            new SecurityPanelSnapshot(Reading(locked: false, sentry: false, present: false), false), echo);

        Assert.Equal("L:common.unlocked", view.LockTile!.Text);
        Assert.Equal("L:common.inactive", view.SecurityRows[0].ValueText);
        Assert.Equal("L:common.closed", view.SecurityRows[1].ValueText);
        Assert.Equal("L:common.closed", view.SecurityRows[2].ValueText);
        Assert.Equal("L:common.no", view.SecurityRows[3].ValueText);
        Assert.Equal("L:common.disabled", view.RemoteStart.ValueText);
    }

    // ---- a11y: every tile / row carries a spoken name ------------------------------

    [Fact]
    public void Every_row_carries_a_non_empty_automation_name_with_label_and_value()
    {
        var view = Project(new SecurityPanelSnapshot(
            Reading(locked: true, sentry: true, doors: "Open", windows: "Closed", present: true), true));

        Assert.Contains(view.LockTile!.Caption, view.LockTile.AutomationName, StringComparison.Ordinal);
        Assert.Contains(view.LockTile.Text, view.LockTile.AutomationName, StringComparison.Ordinal);

        foreach (var row in view.SecurityRows)
        {
            Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
            Assert.Contains(row.Label, row.AutomationName, StringComparison.Ordinal);
            Assert.Contains(row.ValueText, row.AutomationName, StringComparison.Ordinal);
        }

        Assert.Contains(view.RemoteStart.Label, view.RemoteStart.AutomationName, StringComparison.Ordinal);
        Assert.Contains(view.RemoteStart.ValueText, view.RemoteStart.AutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_folds_remote_start()
    {
        using var doc = JsonDocument.Parse("""{ "locked": true }""");

        var cached = SecurityPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true), remoteStartEnabled: true);
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.True(cached.Value!.Security!.Locked);
        Assert.True(cached.Value.RemoteStartEnabled);

        var offline = SecurityPanelResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")),
            remoteStartEnabled: false);
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.False(offline.Value!.RemoteStartEnabled);
    }

    [Fact]
    public void Mapper_maps_loading_and_failure()
    {
        Assert.Equal(LoadStatus.Loading, SecurityPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Loading(), null).Status);

        Assert.Equal(LoadStatus.Error, SecurityPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")), null).Status);
    }

    [Fact]
    public void Mapper_null_security_keeps_remote_start_for_loaded()
    {
        using var doc = JsonDocument.Parse("null");

        var loaded = SecurityPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now), remoteStartEnabled: true);

        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Null(loaded.Value!.Security);
        Assert.True(loaded.Value.RemoteStartEnabled);
        Assert.True(loaded.Value.HasData);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<SecurityPanelSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SecurityPanelState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_lock_tile_and_rows()
    {
        using var vm = NewViewModel(Loaded(new SecurityPanelSnapshot(
            Reading(locked: true, sentry: true, present: true), true)));
        await vm.LoadAsync();

        Assert.Equal(SecurityPanelState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.HasSecurity);
        Assert.NotNull(vm.Display.LockTile);
        Assert.Equal(4, vm.Display.SecurityRows.Count);
        Assert.Equal("Enabled", vm.Display.RemoteStart.ValueText);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_with_only_remote_start_has_data_without_security()
    {
        using var vm = NewViewModel(Loaded(new SecurityPanelSnapshot(null, false)));
        await vm.LoadAsync();

        Assert.Equal(SecurityPanelState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.False(vm.HasSecurity);
        Assert.Equal("Disabled", vm.Display.RemoteStart.ValueText);
    }

    [Fact]
    public async Task ViewModel_loaded_without_any_data_renders_empty()
    {
        using var vm = NewViewModel(Loaded(new SecurityPanelSnapshot(null, null)));
        await vm.LoadAsync();

        Assert.Equal(SecurityPanelState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.Display.EmptyMessage));
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<SecurityPanelSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SecurityPanelState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<SecurityPanelSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SecurityPanelState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<SecurityPanelSnapshot>.Cached(
            new SecurityPanelSnapshot(Reading(locked: true), true), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SecurityPanelState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<SecurityPanelSnapshot>.OfflineCached(
            new SecurityPanelSnapshot(Reading(locked: true), true),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SecurityPanelState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<SecurityPanelSnapshot>.Loading(),
            RepositoryResult<SecurityPanelSnapshot>.Cached(
                new SecurityPanelSnapshot(Reading(locked: false), null), Now, stale: false),
            RepositoryResult<SecurityPanelSnapshot>.Loaded(
                new SecurityPanelSnapshot(Reading(locked: true, sentry: true), true), Now));
        await vm.LoadAsync();

        Assert.Equal(SecurityPanelState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal("Locked", vm.Display.LockTile!.Text);
        Assert.Equal("Enabled", vm.Display.RemoteStart.ValueText);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<SecurityPanelSnapshot>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Security", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(new SecurityPanelSnapshot(Reading(locked: true), true)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SecurityPanelViewModel.State), changed);
        Assert.Contains(nameof(SecurityPanelViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("security-panel", SecurityPanelRegistration.Id);
        Assert.Equal("vehicles", SecurityPanelRegistration.Category);
        Assert.Equal("SecurityPanel", SecurityPanelRegistration.Slug);
        Assert.Equal("Security", SecurityPanelRegistration.Name(Localizer));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SecurityPanelDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SecurityPanel", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static SecurityPanelReading Reading(
        bool? locked = null,
        bool? sentry = null,
        string? doors = null,
        string? windows = null,
        bool? present = null,
        string? detail = null) =>
        new(locked, sentry, doors, windows, present, detail);

    private static SecurityPanelDisplay Project(SecurityPanelSnapshot snapshot) =>
        SecurityPanelProjection.Project(snapshot, Localizer);

    private static RepositoryResult<SecurityPanelSnapshot> Loaded(SecurityPanelSnapshot snapshot) =>
        RepositoryResult<SecurityPanelSnapshot>.Loaded(snapshot, Now);

    private static SecurityPanelViewModel NewViewModel(params RepositoryResult<SecurityPanelSnapshot>[] emissions) =>
        new(new FakeSecurityPanelSource(emissions), Localizer);

    private sealed class FakeSecurityPanelSource(params RepositoryResult<SecurityPanelSnapshot>[] emissions) : ISecurityPanelSource
    {
        public async IAsyncEnumerable<RepositoryResult<SecurityPanelSnapshot>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
