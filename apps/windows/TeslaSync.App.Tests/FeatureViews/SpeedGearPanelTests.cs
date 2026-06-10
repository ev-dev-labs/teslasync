using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the SpeedGearPanel's UI-thread-free logic — the motor + drives JSON parse adapters,
/// the drive-speed reduction (the average / top memos ported from the web), the shift colour / badge token
/// mapping, the projection (the shift tile + the three stat tiles, their formatted + unit-converted values,
/// labels and accessibility names), the cache-then-network result mapper, the registration metadata, the
/// diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error /
/// stale / offline) plus unit re-projection. Mirrors the web spec
/// (web/src/features/driving/components/driving-dynamics/SpeedGearPanel.tsx).
/// </summary>
public sealed class SpeedGearPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 10, 12, 5, 0, TimeSpan.Zero);

    // ---- Motor parse adapter -------------------------------------------------------

    [Fact]
    public void Motor_FromResponse_reads_shift_and_power()
    {
        using var doc = JsonDocument.Parse("""{ "shift_state": "D", "power_kw": 12.5 }""");

        var motor = SpeedGearMotorReading.FromResponse(doc.RootElement);

        Assert.NotNull(motor);
        Assert.Equal("D", motor!.ShiftState);
        Assert.Equal(12.5, motor.PowerKw);
    }

    [Fact]
    public void Motor_FromResponse_tolerates_missing_fields_and_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{ "power_kw": "42" }""");

        var motor = SpeedGearMotorReading.FromResponse(doc.RootElement);

        Assert.NotNull(motor);
        Assert.Null(motor!.ShiftState);
        Assert.Equal(42, motor.PowerKw);
    }

    [Fact]
    public void Motor_FromResponse_returns_null_for_non_object()
    {
        using var doc = JsonDocument.Parse("null");
        Assert.Null(SpeedGearMotorReading.FromResponse(doc.RootElement));

        using var arr = JsonDocument.Parse("[]");
        Assert.Null(SpeedGearMotorReading.FromResponse(arr.RootElement));
    }

    [Fact]
    public void Motor_FromResponse_object_with_missing_fields_parses_all_null()
    {
        using var doc = JsonDocument.Parse("{}");

        var motor = SpeedGearMotorReading.FromResponse(doc.RootElement);

        Assert.NotNull(motor);
        Assert.Null(motor!.ShiftState);
        Assert.Null(motor.PowerKw);
    }

    // ---- Drive aggregate reduction (web avgDriveSpeedMps / topDriveSpeedMps) --------

    [Fact]
    public void Drives_FromDrives_reduces_average_and_top_in_si()
    {
        using var doc = JsonDocument.Parse("""
        [ { "avg_speed_mps": 10, "max_speed_mps": 30 }, { "avg_speed_mps": 20, "max_speed_mps": 40 } ]
        """);

        var drives = SpeedGearDriveStats.FromDrives(doc.RootElement);

        Assert.Equal(2, drives.DriveCount);
        Assert.Equal(15, drives.AvgSpeedMps);   // (10 + 20) / 2
        Assert.Equal(40, drives.TopSpeedMps);   // max(30, 40)
        Assert.True(drives.HasData);
    }

    [Fact]
    public void Drives_FromDrives_counts_every_drive_and_treats_missing_speed_as_zero()
    {
        // Web: filteredDrives.length counts both drives; a missing avgSpeedMps contributes 0 to the mean.
        using var doc = JsonDocument.Parse("""
        [ { "avg_speed_mps": 20, "max_speed_mps": 30 }, { "max_speed_mps": 10 } ]
        """);

        var drives = SpeedGearDriveStats.FromDrives(doc.RootElement);

        Assert.Equal(2, drives.DriveCount);
        Assert.Equal(10, drives.AvgSpeedMps);   // (20 + 0) / 2
        Assert.Equal(30, drives.TopSpeedMps);   // max(30, 10)
    }

    [Fact]
    public void Drives_FromDrives_empty_array_yields_null_aggregates()
    {
        using var doc = JsonDocument.Parse("[]");

        var drives = SpeedGearDriveStats.FromDrives(doc.RootElement);

        Assert.Equal(0, drives.DriveCount);
        Assert.Null(drives.AvgSpeedMps);
        Assert.Null(drives.TopSpeedMps);
        Assert.False(drives.HasData);
    }

    [Fact]
    public void Drives_FromDrives_non_array_yields_empty()
    {
        using var doc = JsonDocument.Parse("""{ "not": "an array" }""");
        Assert.Same(SpeedGearDriveStats.Empty, SpeedGearDriveStats.FromDrives(doc.RootElement));
    }

    // ---- Shift colour / badge token mapping (web shiftColor / shiftBadgeVariant) ----

    [Theory]
    [InlineData("D", "TsColorSuccessBrush")]
    [InlineData("R", "TsColorDangerBrush")]
    [InlineData("N", "TsColorWarningBrush")]
    [InlineData("P", "TsColorTextMutedBrush")]
    [InlineData("X", "TsColorTextSecondaryBrush")]
    [InlineData(null, "TsColorTextSecondaryBrush")]
    public void ShiftBrushKey_maps_each_web_accent(string? shift, string expected)
    {
        Assert.Equal(expected, SpeedGearPanelTokens.ShiftBrushKey(shift));
    }

    [Theory]
    [InlineData("D", StatusKind.Success)]
    [InlineData("R", StatusKind.Danger)]
    [InlineData("N", StatusKind.Warning)]
    [InlineData("P", StatusKind.Neutral)]
    [InlineData(null, StatusKind.Neutral)]
    public void ShiftStatus_maps_each_web_variant(string? shift, StatusKind expected)
    {
        Assert.Equal(expected, SpeedGearPanelTokens.ShiftStatus(shift));
    }

    // ---- Snapshot HasData gate -----------------------------------------------------

    [Fact]
    public void Snapshot_hasData_when_motor_present_or_drives_present()
    {
        Assert.True(new SpeedGearSnapshot(Motor("D", 1), Stats(5, 5, 1)).HasData);
        Assert.True(new SpeedGearSnapshot(Motor("D", 1), SpeedGearDriveStats.Empty).HasData);
        Assert.True(new SpeedGearSnapshot(null, Stats(5, 5, 1)).HasData);
        Assert.False(new SpeedGearSnapshot(null, SpeedGearDriveStats.Empty).HasData);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_builds_shift_and_three_tiles_in_metric()
    {
        var snapshot = new SpeedGearSnapshot(Motor("D", 12.5), Stats(15, 40, 2));

        var view = SpeedGearPanelProjection.Project(snapshot, UnitPref.Metric, Localizer);

        Assert.True(view.HasData);
        Assert.Equal("Speed & Gear", view.Title);

        Assert.Equal("D", view.Shift.Letter);
        Assert.Equal("TsColorSuccessBrush", view.Shift.BrushKey);
        Assert.Equal(StatusKind.Success, view.Shift.BadgeStatus);
        Assert.Equal("Shift State", view.Shift.BadgeLabel);

        Assert.Equal(3, view.Metrics.Count);

        var power = view.Metrics[0];
        Assert.Equal("Motor Power", power.Label);
        Assert.Equal("12.50", power.ValueText);   // fmtNumber(power_kw) at precision 2
        Assert.Equal("kW", power.Unit);

        var avg = view.Metrics[1];
        Assert.Equal("Avg Drive Speed", avg.Label);
        Assert.Equal("54", avg.ValueText);          // 15 m/s -> 54 km/h, fmtNumber(_, 0)
        Assert.Equal("km/h", avg.Unit);

        var top = view.Metrics[2];
        Assert.Equal("Top Drive Speed", top.Label);
        Assert.Equal("144", top.ValueText);         // 40 m/s -> 144 km/h
        Assert.Equal("km/h", top.Unit);
    }

    [Fact]
    public void Project_converts_speed_to_imperial_display_unit()
    {
        var snapshot = new SpeedGearSnapshot(Motor("D", 12.5), Stats(15, 40, 2));

        var view = SpeedGearPanelProjection.Project(snapshot, UnitPref.Imperial, Localizer);

        Assert.Equal("34", view.Metrics[1].ValueText);   // 15 m/s -> 33.55 mph -> "34"
        Assert.Equal("mph", view.Metrics[1].Unit);
        Assert.Equal("89", view.Metrics[2].ValueText);   // 40 m/s -> 89.48 mph -> "89"
        Assert.Equal("mph", view.Metrics[2].Unit);
        // Power is rendered verbatim in kW (web parity — no conversion).
        Assert.Equal("12.50", view.Metrics[0].ValueText);
        Assert.Equal("kW", view.Metrics[0].Unit);
    }

    [Fact]
    public void Project_renders_em_dash_for_missing_motor_and_drives()
    {
        var snapshot = new SpeedGearSnapshot(null, SpeedGearDriveStats.Empty);

        var view = SpeedGearPanelProjection.Project(snapshot, UnitPref.Metric, Localizer);

        Assert.False(view.HasData);
        Assert.Equal("\u2014", view.Shift.Letter);
        Assert.Equal("\u2014", view.Metrics[0].ValueText); // power
        Assert.Equal("\u2014", view.Metrics[1].ValueText); // avg speed
        Assert.Equal("\u2014", view.Metrics[2].ValueText); // top speed
    }

    [Fact]
    public void Project_zero_average_is_a_value_not_em_dash()
    {
        // Web: avgDriveSpeedMps != null even when 0 (a drive with null speed contributes 0).
        var snapshot = new SpeedGearSnapshot(null, Stats(0, 0, 1));

        var view = SpeedGearPanelProjection.Project(snapshot, UnitPref.Metric, Localizer);

        Assert.True(view.HasData);
        Assert.Equal("0", view.Metrics[1].ValueText);
        Assert.Equal("0", view.Metrics[2].ValueText);
    }

    [Fact]
    public void Project_motor_present_but_no_drives_shows_speed_em_dash()
    {
        var snapshot = new SpeedGearSnapshot(Motor("R", 8), SpeedGearDriveStats.Empty);

        var view = SpeedGearPanelProjection.Project(snapshot, UnitPref.Metric, Localizer);

        Assert.True(view.HasData);
        Assert.Equal("R", view.Shift.Letter);
        Assert.Equal("8.00", view.Metrics[0].ValueText);
        Assert.Equal("\u2014", view.Metrics[1].ValueText);
        Assert.Equal("\u2014", view.Metrics[2].ValueText);
    }

    // ---- i18n: every label resolves through its catalog key ------------------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();
        var view = SpeedGearPanelProjection.Project(
            new SpeedGearSnapshot(Motor("D", 1), Stats(1, 1, 1)), UnitPref.Metric, echo);

        Assert.Equal("L:dynamics.speedGear", view.Title);
        Assert.Equal("L:dynamics.shiftState", view.Shift.BadgeLabel);
        Assert.Equal("L:dynamics.power", view.Metrics[0].Label);
        Assert.Equal("L:dynamics.avgDriveSpeed", view.Metrics[1].Label);
        Assert.Equal("L:dynamics.topDriveSpeed", view.Metrics[2].Label);
        Assert.Equal("L:dynamics.speedGear.empty", view.EmptyMessage);
        Assert.Equal("L:dynamics.speedGear.aria", view.AriaLabel);
    }

    // ---- a11y: every tile carries a spoken name ------------------------------------

    [Fact]
    public void Every_tile_carries_a_non_empty_automation_name_with_value()
    {
        var view = SpeedGearPanelProjection.Project(
            new SpeedGearSnapshot(Motor("D", 12.5), Stats(15, 40, 2)), UnitPref.Metric, Localizer);

        Assert.Contains(view.Shift.Letter, view.Shift.AutomationName, StringComparison.Ordinal);
        Assert.Contains(view.Shift.BadgeLabel, view.Shift.AutomationName, StringComparison.Ordinal);

        Assert.All(view.Metrics, m =>
        {
            Assert.False(string.IsNullOrWhiteSpace(m.AutomationName));
            Assert.Contains(m.Label, m.AutomationName, StringComparison.Ordinal);
            Assert.Contains(m.ValueText, m.AutomationName, StringComparison.Ordinal);
        });

        // A populated metric mentions its unit; an em-dash metric does not append a stray unit.
        Assert.Contains("kW", view.Metrics[0].AutomationName, StringComparison.Ordinal);
        var empty = SpeedGearPanelProjection.Project(
            new SpeedGearSnapshot(null, SpeedGearDriveStats.Empty), UnitPref.Metric, Localizer);
        Assert.DoesNotContain("km/h", empty.Metrics[1].AutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_folds_drives()
    {
        using var doc = JsonDocument.Parse("""{ "shift_state": "N", "power_kw": 3 }""");
        var drives = Stats(5, 9, 1);

        var cached = SpeedGearPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true), drives);
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal("N", cached.Value!.Motor!.ShiftState);
        Assert.Equal(drives, cached.Value.Drives);

        var offline = SpeedGearPanelResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")),
            drives);
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(drives, offline.Value!.Drives);
    }

    [Fact]
    public void Mapper_maps_loading_and_failure()
    {
        Assert.Equal(LoadStatus.Loading, SpeedGearPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Loading(), SpeedGearDriveStats.Empty).Status);

        Assert.Equal(LoadStatus.Error, SpeedGearPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            SpeedGearDriveStats.Empty).Status);
    }

    [Fact]
    public void Mapper_null_motor_keeps_drives_for_loaded()
    {
        using var doc = JsonDocument.Parse("null");
        var drives = Stats(10, 12, 1);

        var loaded = SpeedGearPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now), drives);

        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Null(loaded.Value!.Motor);
        Assert.Equal(drives, loaded.Value.Drives);
        Assert.True(loaded.Value.HasData);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<SpeedGearSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SpeedGearPanelState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_tiles()
    {
        using var vm = NewViewModel(Loaded(new SpeedGearSnapshot(Motor("D", 12.5), Stats(15, 40, 2))));
        await vm.LoadAsync();

        Assert.Equal(SpeedGearPanelState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(3, vm.Display.Metrics.Count);
        Assert.Equal("D", vm.Display.Shift.Letter);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_any_data_renders_empty()
    {
        using var vm = NewViewModel(Loaded(new SpeedGearSnapshot(null, SpeedGearDriveStats.Empty)));
        await vm.LoadAsync();

        Assert.Equal(SpeedGearPanelState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.Display.EmptyMessage));
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<SpeedGearSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SpeedGearPanelState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<SpeedGearSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SpeedGearPanelState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<SpeedGearSnapshot>.Cached(
            new SpeedGearSnapshot(Motor("D", 12.5), Stats(15, 40, 2)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SpeedGearPanelState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<SpeedGearSnapshot>.OfflineCached(
            new SpeedGearSnapshot(Motor("D", 12.5), Stats(15, 40, 2)),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SpeedGearPanelState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<SpeedGearSnapshot>.Loading(),
            RepositoryResult<SpeedGearSnapshot>.Cached(
                new SpeedGearSnapshot(Motor("N", 1), Stats(5, 5, 1)), Now, stale: false),
            RepositoryResult<SpeedGearSnapshot>.Loaded(
                new SpeedGearSnapshot(Motor("D", 12.5), Stats(15, 40, 2)), Now));
        await vm.LoadAsync();

        Assert.Equal(SpeedGearPanelState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal("D", vm.Display.Shift.Letter);
        Assert.Equal("54", vm.Display.Metrics[1].ValueText);
    }

    [Fact]
    public async Task ViewModel_unit_change_reprojects_speeds()
    {
        using var vm = NewViewModel(Loaded(new SpeedGearSnapshot(Motor("D", 12.5), Stats(15, 40, 2))));
        await vm.LoadAsync();
        Assert.Equal("54", vm.Display.Metrics[1].ValueText);

        vm.Units = UnitPref.Imperial;

        Assert.Equal("34", vm.Display.Metrics[1].ValueText);
        Assert.Equal("mph", vm.Display.Metrics[1].Unit);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<SpeedGearSnapshot>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Speed & Gear", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(new SpeedGearSnapshot(Motor("D", 12.5), Stats(15, 40, 2))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SpeedGearPanelViewModel.State), changed);
        Assert.Contains(nameof(SpeedGearPanelViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("speed-gear-panel", SpeedGearPanelRegistration.Id);
        Assert.Equal("driving", SpeedGearPanelRegistration.Category);
        Assert.Equal("SpeedGearPanel", SpeedGearPanelRegistration.Slug);
        Assert.Equal("Speed & Gear", SpeedGearPanelRegistration.Name(Localizer));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SpeedGearPanelDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SpeedGearPanel", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static SpeedGearMotorReading Motor(string? shift, double? power) => new(shift, power);

    private static SpeedGearDriveStats Stats(double? avg, double? top, int count) => new(avg, top, count);

    private static RepositoryResult<SpeedGearSnapshot> Loaded(SpeedGearSnapshot snapshot) =>
        RepositoryResult<SpeedGearSnapshot>.Loaded(snapshot, Now);

    private static SpeedGearPanelViewModel NewViewModel(params RepositoryResult<SpeedGearSnapshot>[] emissions) =>
        new(new FakeSpeedGearPanelSource(emissions), Localizer);

    private sealed class FakeSpeedGearPanelSource(params RepositoryResult<SpeedGearSnapshot>[] emissions) : ISpeedGearPanelSource
    {
        public async IAsyncEnumerable<RepositoryResult<SpeedGearSnapshot>> StreamAsync(
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
