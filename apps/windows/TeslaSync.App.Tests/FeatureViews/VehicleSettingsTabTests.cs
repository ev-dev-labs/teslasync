using System.Runtime.CompilerServices;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Vehicles;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>VehicleSettingsTab</c> surface's UI-thread-free logic — the descriptor whitelist,
/// the resolver source → pill mapping, the draft conversion / validation adapter (datetime-local ⇄ RFC3339), the
/// projection (every label, source pill, automation id and i18n key), the registration / diagnostics metadata, and
/// the state-holder view-model's per-state matrix (loading / loaded / empty / error / stale / offline) plus its
/// per-row dirty diff, validated upsert and override-only reset. Mirrors the web spec
/// (web/src/features/vehicles/components/VehicleSettingsTab.tsx).
/// </summary>
public sealed class VehicleSettingsTabTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 13, 9, 5, 0, TimeSpan.Zero);
    private const long VehicleId = 7;

    // ---- Descriptor whitelist (web VEHICLE_SETTING_DESCRIPTORS) -----------------------

    [Fact]
    public void Descriptors_match_the_web_whitelist_and_order()
    {
        var keys = VehicleSettingDescriptor.All.Select(d => d.Key).ToArray();
        Assert.Equal(
            new[] { "nickname", "mute_until", "charge_cost_tariff_id", "units_distance", "units_temperature", "units_energy" },
            keys);

        Assert.Equal(VehicleSettingKind.Text, Find("nickname").Kind);
        Assert.Equal(64, Find("nickname").MaxLength);
        Assert.Equal(VehicleSettingKind.Timestamp, Find("mute_until").Kind);
        Assert.Equal(VehicleSettingKind.Select, Find("units_distance").Kind);
        Assert.Equal(new[] { "mi", "km" }, Find("units_distance").Options.Select(o => o.Value));
        Assert.Equal(new[] { "C", "F" }, Find("units_temperature").Options.Select(o => o.Value));
        Assert.Equal(new[] { "kWh" }, Find("units_energy").Options.Select(o => o.Value));
    }

    // ---- Source token + pill colour (web SOURCE_PILL_VARIANT) -------------------------

    [Theory]
    [InlineData("override", VehicleSettingSource.Override, StatusKind.Success)]
    [InlineData("user", VehicleSettingSource.User, StatusKind.Info)]
    [InlineData("vehicle", VehicleSettingSource.Vehicle, StatusKind.Neutral)]
    [InlineData("default", VehicleSettingSource.Default, StatusKind.Warning)]
    [InlineData("nonsense", VehicleSettingSource.Default, StatusKind.Warning)]
    [InlineData(null, VehicleSettingSource.Default, StatusKind.Warning)]
    public void Source_parses_and_maps_to_the_web_pill_variant(string? token, VehicleSettingSource expected, StatusKind status)
    {
        var source = VehicleSettingSources.Parse(token);
        Assert.Equal(expected, source);
        Assert.Equal(status, VehicleSettingSources.Status(source));
    }

    // ---- datetime-local ⇄ RFC3339 bridge (web rfc3339ToLocalInput / localInputToRFC3339) --

    [Fact]
    public void Timestamp_round_trips_local_input_through_rfc3339()
    {
        const string local = "2026-06-13T09:30";
        string? iso = VehicleSettingDraft.LocalInputToRfc3339(local);
        Assert.NotNull(iso);
        Assert.EndsWith("Z", iso);
        Assert.Equal(local, VehicleSettingDraft.Rfc3339ToLocalInput(iso));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-date")]
    public void Rfc3339ToLocalInput_is_empty_for_unparseable(string value)
    {
        Assert.Equal(string.Empty, VehicleSettingDraft.Rfc3339ToLocalInput(value));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-date")]
    public void LocalInputToRfc3339_is_null_for_unparseable(string value)
    {
        Assert.Null(VehicleSettingDraft.LocalInputToRfc3339(value));
    }

    // ---- Draft seeding (web effectiveToDraft) ----------------------------------------

    [Fact]
    public void EffectiveToDraft_seeds_text_select_and_timestamp_kinds()
    {
        Assert.Equal("My Car", VehicleSettingDraft.EffectiveToDraft(Find("nickname"), Effective("nickname", "My Car", true, "override")));
        Assert.Equal(string.Empty, VehicleSettingDraft.EffectiveToDraft(Find("nickname"), null));

        Assert.Equal("mi", VehicleSettingDraft.EffectiveToDraft(Find("units_distance"), Effective("units_distance", "mi", true, "user")));
        Assert.Equal(string.Empty, VehicleSettingDraft.EffectiveToDraft(Find("units_distance"), Effective("units_distance", "42", false, "default")));

        const string iso = "2026-06-13T16:30:00Z";
        Assert.Equal(
            VehicleSettingDraft.Rfc3339ToLocalInput(iso),
            VehicleSettingDraft.EffectiveToDraft(Find("mute_until"), Effective("mute_until", iso, true, "override")));
    }

    // ---- Draft validation (web parseDraft) -------------------------------------------

    [Fact]
    public void ParseDraft_empty_is_required()
    {
        Assert.Equal(VehicleSettingParseStatus.Empty, VehicleSettingDraft.ParseDraft(Find("nickname"), "   ").Status);
    }

    [Fact]
    public void ParseDraft_text_passes_through_trimmed()
    {
        var result = VehicleSettingDraft.ParseDraft(Find("nickname"), "  Roadster  ");
        Assert.Equal(VehicleSettingParseStatus.Ok, result.Status);
        Assert.Equal("Roadster", result.Value!.Raw);
    }

    [Fact]
    public void ParseDraft_select_rejects_values_outside_the_option_set()
    {
        Assert.Equal(VehicleSettingParseStatus.Ok, VehicleSettingDraft.ParseDraft(Find("units_distance"), "mi").Status);

        var invalid = VehicleSettingDraft.ParseDraft(Find("units_distance"), "lightyears");
        Assert.Equal(VehicleSettingParseStatus.Invalid, invalid.Status);
        Assert.Equal("vehicleSettings.validation.invalid", invalid.MessageKey);
    }

    [Fact]
    public void ParseDraft_timestamp_requires_a_valid_instant()
    {
        var ok = VehicleSettingDraft.ParseDraft(Find("mute_until"), "2026-06-13T09:30");
        Assert.Equal(VehicleSettingParseStatus.Ok, ok.Status);
        Assert.EndsWith("Z", (string)ok.Value!.Raw!);

        var invalid = VehicleSettingDraft.ParseDraft(Find("mute_until"), "whenever");
        Assert.Equal(VehicleSettingParseStatus.Invalid, invalid.Status);
        Assert.Equal("vehicleSettings.validation.invalidDate", invalid.MessageKey);
    }

    // ---- Projection + accessibility labels -------------------------------------------

    [Fact]
    public void Projection_builds_every_row_with_labels_source_pills_and_automation_ids()
    {
        var data = Data(
            ("nickname", "My Car", true, "override"),
            ("units_distance", "mi", true, "user"));

        var display = VehicleSettingsTabProjection.Project(VehicleSettingsTabState.Loaded, data, Localizer);

        Assert.Equal("Per-vehicle settings", display.Title);
        Assert.Equal(display.Title, display.AutomationName);
        Assert.Equal(VehicleSettingDescriptor.All.Count, display.Rows.Count);

        foreach (var row in display.Rows)
        {
            Assert.False(string.IsNullOrEmpty(row.Label));
            Assert.False(string.IsNullOrEmpty(row.SourceText));
            Assert.Equal($"vehicle-settings-row-{row.Key}", row.RowAutomationId);
            Assert.Equal($"vehicle-settings-input-{row.Key}", row.InputAutomationId);
            Assert.Equal($"vehicle-settings-save-{row.Key}", row.SaveAutomationId);
            Assert.Equal($"vehicle-settings-reset-{row.Key}", row.ResetAutomationId);
        }

        var nickname = display.Rows.Single(r => r.Key == "nickname");
        Assert.True(nickname.IsOverride);
        Assert.Equal(StatusKind.Success, nickname.SourceStatus);
        Assert.Equal("vehicle-settings-source-override", nickname.SourceAutomationId);

        var distance = display.Rows.Single(r => r.Key == "units_distance");
        Assert.False(distance.IsOverride);
        Assert.Equal(StatusKind.Info, distance.SourceStatus);

        // A key with no resolved row falls back to the default source — still rendered, never hidden.
        var tariff = display.Rows.Single(r => r.Key == "charge_cost_tariff_id");
        Assert.Equal(VehicleSettingSource.Default, tariff.Source);
        Assert.Equal("vehicle-settings-source-default", tariff.SourceAutomationId);
    }

    [Fact]
    public void Registration_exposes_slug_and_generated_operation_ids()
    {
        Assert.Equal("vehicle-settings", VehicleSettingsTabRegistration.Id);
        Assert.Equal("VehicleSettingsTab", VehicleSettingsTabRegistration.Slug);
        Assert.Equal("get_api_v1_vehicles_vehicleID_settings", VehicleSettingsTabRegistration.SettingsOperation);
        Assert.Equal("put_api_v1_vehicles_vehicleID_settings_key", VehicleSettingsTabRegistration.UpsertOperation);
        Assert.Equal("delete_api_v1_vehicles_vehicleID_settings_key", VehicleSettingsTabRegistration.ResetOperation);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new VehicleSettingsTabDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=VehicleSettingsTab", Assert.Single(lines));
    }

    // ---- View-model: per-state matrix ------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_then_loaded_seeds_the_rows()
    {
        var source = new FakeSource(Set(
            RepositoryResult<VehicleSettingsData>.Loading(),
            RepositoryResult<VehicleSettingsData>.Loaded(Data(("nickname", "My Car", true, "override")), Now)));
        using var vm = NewViewModel(source);

        await vm.LoadAsync();

        Assert.Equal(VehicleSettingsTabState.Loaded, vm.State);
        Assert.Equal(VehicleId, source.LastVehicleId);
        var nickname = vm.Rows.Single(r => r.Key == "nickname");
        Assert.Equal("My Car", nickname.Draft);
        Assert.True(nickname.IsOverride);
        Assert.False(nickname.IsDirty);
    }

    [Fact]
    public async Task ViewModel_empty_renders_rows_with_defaults()
    {
        var source = new FakeSource(Set(RepositoryResult<VehicleSettingsData>.Empty(Now)));
        using var vm = NewViewModel(source);

        await vm.LoadAsync();

        Assert.Equal(VehicleSettingsTabState.Empty, vm.State);
        Assert.Equal(VehicleSettingDescriptor.All.Count, vm.Rows.Count);
        Assert.All(vm.Rows, r => Assert.False(r.IsOverride));
    }

    [Fact]
    public async Task ViewModel_error_exposes_the_retry_message()
    {
        var source = new FakeSource(Set(
            RepositoryResult<VehicleSettingsData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))));
        using var vm = NewViewModel(source);

        await vm.LoadAsync();

        Assert.Equal(VehicleSettingsTabState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.Equal("Could not load vehicle settings.", vm.ErrorMessage);
    }

    [Fact]
    public async Task ViewModel_stale_and_offline_keep_the_rows_visible()
    {
        var data = Data(("nickname", "My Car", true, "override"));

        var stale = new FakeSource(Set(RepositoryResult<VehicleSettingsData>.Cached(data, Now, stale: true)));
        using var staleVm = NewViewModel(stale);
        await staleVm.LoadAsync();
        Assert.Equal(VehicleSettingsTabState.Stale, staleVm.State);
        Assert.True(staleVm.IsStale);
        Assert.True(staleVm.Display.ShowFreshnessChip);

        var offline = new FakeSource(Set(RepositoryResult<VehicleSettingsData>.OfflineCached(
            data, Now, new RepositoryError(RepositoryErrorKind.Offline, "down"))));
        using var offlineVm = NewViewModel(offline);
        await offlineVm.LoadAsync();
        Assert.Equal(VehicleSettingsTabState.Offline, offlineVm.State);
        Assert.False(string.IsNullOrWhiteSpace(offlineVm.ErrorMessage));
    }

    // ---- View-model: dirty diff, save, reset, validation -----------------------------

    [Fact]
    public async Task ViewModel_edit_marks_dirty_then_save_upserts_and_reloads_clearing_dirty()
    {
        var source = new FakeSource(
            Set(RepositoryResult<VehicleSettingsData>.Loaded(Data(("nickname", "Old", true, "override")), Now)),
            Set(RepositoryResult<VehicleSettingsData>.Loaded(Data(("nickname", "New", true, "override")), Now)));
        var notices = new List<VehicleSettingsTabNotice>();
        using var vm = NewViewModel(source);
        vm.NoticeRequested += (_, n) => notices.Add(n);
        await vm.LoadAsync();

        var nickname = vm.Rows.Single(r => r.Key == "nickname");
        nickname.Draft = "New";
        Assert.True(nickname.IsDirty);
        Assert.True(nickname.CanSave);

        await vm.SaveRowAsync(nickname);

        var upsert = Assert.Single(source.Upserts);
        Assert.Equal("nickname", upsert.Key);
        Assert.Equal("New", upsert.Value.Raw);
        Assert.Contains(notices, n => n.Kind == VehicleSettingsTabNoticeKind.Success);
        Assert.False(nickname.IsDirty);
        Assert.Null(nickname.ValidationError);
    }

    [Fact]
    public async Task ViewModel_save_empty_required_field_blocks_the_upsert()
    {
        var source = new FakeSource(Set(
            RepositoryResult<VehicleSettingsData>.Loaded(Data(("nickname", "Old", true, "override")), Now)));
        using var vm = NewViewModel(source);
        await vm.LoadAsync();

        var nickname = vm.Rows.Single(r => r.Key == "nickname");
        nickname.Draft = "   ";

        await vm.SaveRowAsync(nickname);

        Assert.Empty(source.Upserts);
        Assert.Equal("Value is required.", nickname.ValidationError);
    }

    [Fact]
    public async Task ViewModel_save_invalid_select_surfaces_inline_error()
    {
        var source = new FakeSource(Set(
            RepositoryResult<VehicleSettingsData>.Loaded(Data(("units_distance", "km", true, "override")), Now)));
        using var vm = NewViewModel(source);
        await vm.LoadAsync();

        var distance = vm.Rows.Single(r => r.Key == "units_distance");
        distance.Draft = "lightyears";

        await vm.SaveRowAsync(distance);

        Assert.Empty(source.Upserts);
        Assert.Equal("Value is not valid for this setting.", distance.ValidationError);
    }

    [Fact]
    public async Task ViewModel_save_failure_raises_error_notice_and_keeps_the_draft()
    {
        var source = new FakeSource(Set(
            RepositoryResult<VehicleSettingsData>.Loaded(Data(("nickname", "Old", true, "override")), Now)))
        {
            ThrowOnUpsert = true,
        };
        var notices = new List<VehicleSettingsTabNotice>();
        using var vm = NewViewModel(source);
        vm.NoticeRequested += (_, n) => notices.Add(n);
        await vm.LoadAsync();

        var nickname = vm.Rows.Single(r => r.Key == "nickname");
        nickname.Draft = "New";
        await vm.SaveRowAsync(nickname);

        Assert.Contains(notices, n => n.Kind == VehicleSettingsTabNoticeKind.Error);
        Assert.Equal("New", nickname.Draft);
        Assert.True(nickname.IsDirty);
    }

    [Fact]
    public async Task ViewModel_reset_only_runs_for_overrides()
    {
        var source = new FakeSource(
            Set(RepositoryResult<VehicleSettingsData>.Loaded(
                Data(("nickname", "My Car", true, "override"), ("units_distance", "km", true, "user")), Now)),
            Set(RepositoryResult<VehicleSettingsData>.Loaded(
                Data(("units_distance", "km", true, "user")), Now)));
        using var vm = NewViewModel(source);
        await vm.LoadAsync();

        // A user-default row cannot be reset.
        var distance = vm.Rows.Single(r => r.Key == "units_distance");
        Assert.False(distance.CanReset);
        await vm.ResetRowAsync(distance);
        Assert.Empty(source.Resets);

        // An override row resets via DELETE.
        var nickname = vm.Rows.Single(r => r.Key == "nickname");
        Assert.True(nickname.CanReset);
        await vm.ResetRowAsync(nickname);
        Assert.Equal("nickname", Assert.Single(source.Resets));
    }

    // ---- Helpers ---------------------------------------------------------------------

    private static VehicleSettingsTabViewModel NewViewModel(IVehicleSettingsTabSource source) =>
        new(source, Localizer, VehicleId, () => Now);

    private static VehicleSettingDescriptor Find(string key) =>
        VehicleSettingDescriptor.All.Single(d => d.Key == key);

    private static EffectiveSettingData Effective(string key, string value, bool isText, string source) =>
        new(key, value, isText, source);

    private static VehicleSettingsData Data(params (string Key, string Value, bool IsText, string Source)[] rows) =>
        new(rows.Select(r => new EffectiveSettingData(r.Key, r.Value, r.IsText, r.Source)).ToArray());

    private static RepositoryResult<VehicleSettingsData>[] Set(params RepositoryResult<VehicleSettingsData>[] emissions) =>
        emissions;

    private sealed class FakeSource : IVehicleSettingsTabSource
    {
        private readonly IReadOnlyList<RepositoryResult<VehicleSettingsData>[]> _loads;
        private int _loadIndex;

        public FakeSource(params RepositoryResult<VehicleSettingsData>[][] loads) => _loads = loads;

        public bool ThrowOnUpsert { get; init; }

        public bool ThrowOnReset { get; init; }

        public long? LastVehicleId { get; private set; }

        public List<(string Key, VehicleSettingValue Value)> Upserts { get; } = new();

        public List<string> Resets { get; } = new();

        public async IAsyncEnumerable<RepositoryResult<VehicleSettingsData>> StreamSettingsAsync(
            long vehicleId,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            LastVehicleId = vehicleId;
            var set = _loads[Math.Min(_loadIndex, _loads.Count - 1)];
            _loadIndex++;
            foreach (var emission in set)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
            }

            await Task.CompletedTask.ConfigureAwait(false);
        }

        public Task UpsertAsync(long vehicleId, string key, VehicleSettingValue value, CancellationToken cancellationToken = default)
        {
            Upserts.Add((key, value));
            if (ThrowOnUpsert)
            {
                throw new InvalidOperationException("upsert failed");
            }

            return Task.CompletedTask;
        }

        public Task ResetAsync(long vehicleId, string key, CancellationToken cancellationToken = default)
        {
            Resets.Add(key);
            if (ThrowOnReset)
            {
                throw new InvalidOperationException("reset failed");
            }

            return Task.CompletedTask;
        }
    }
}
