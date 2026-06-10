using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>PedalUsage</c> feature surface's UI-thread-free logic — the drive-dynamics
/// snapshot parse (throttle / brake position + brake-active, null-tolerant), the projection (gauge values, unit
/// suffixes, accents, decimal precision, brake-status colour + copy, accessible names), the cache-then-network
/// result mapper, the localized labels + i18n key set, the diagnostics, and the state-holder view-model's
/// per-state transitions (loading / ready / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/driving/components/driving-dynamics/PedalUsage.tsx). The WinUI view itself (PedalUsage.cs)
/// is exercised by the app build.
/// </summary>
public sealed class PedalUsageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    private const string SampleSnapshot = """
    {
      "pedal_position": 42,
      "brake_pedal_position": 13.5,
      "brake_pedal_active": true,
      "lateral_acceleration": 0.1,
      "longitudinal_acceleration": -0.2
    }
    """;

    private static JsonElement Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static PedalReading Reading(string json) => PedalReading.FromSnapshotJson(Parse(json));

    private static PedalUsageContent Project(PedalReading reading) =>
        PedalUsageProjection.Project(reading, Localizer);

    private static PedalReading Sample() => Reading(SampleSnapshot);

    // ---- Parse adapter --------------------------------------------------------------

    [Fact]
    public void FromSnapshotJson_reads_throttle_brake_and_active()
    {
        var reading = Sample();

        Assert.Equal(42, reading.ThrottlePercent);
        Assert.Equal(13.5, reading.BrakePercent);
        Assert.True(reading.BrakeActive);
        Assert.True(reading.HasData);
    }

    [Fact]
    public void FromSnapshotJson_is_tolerant_of_missing_fields()
    {
        var reading = Reading("""{"pedal_position": 0}""");

        Assert.Equal(0, reading.ThrottlePercent);
        Assert.Null(reading.BrakePercent);
        Assert.Null(reading.BrakeActive);
        Assert.True(reading.HasData); // throttle present (even at 0) — web hasAny
    }

    [Fact]
    public void FromSnapshotJson_accepts_numeric_string_positions()
    {
        var reading = Reading("""{"pedal_position": "42.5", "brake_pedal_position": "7"}""");

        Assert.Equal(42.5, reading.ThrottlePercent);
        Assert.Equal(7, reading.BrakePercent);
    }

    [Fact]
    public void FromSnapshotJson_rejects_non_boolean_active()
    {
        // web: typeof data.brake_pedal_active === 'boolean' ? … : null — a numeric flag is not a boolean.
        var reading = Reading("""{"brake_pedal_active": 1}""");

        Assert.Null(reading.BrakeActive);
        Assert.False(reading.HasData);
    }

    [Fact]
    public void FromSnapshotJson_reads_false_active()
    {
        var reading = Reading("""{"brake_pedal_active": false}""");

        Assert.False(reading.BrakeActive);
        Assert.True(reading.HasData); // brake-active present (false) — web hasAny
    }

    [Theory]
    [InlineData("{}")]    // property-less object
    [InlineData("[]")]    // array, not a snapshot object
    [InlineData("null")]  // null body
    [InlineData("\"x\"")] // scalar
    public void FromSnapshotJson_returns_empty_for_no_telemetry(string json)
    {
        var reading = Reading(json);

        Assert.False(reading.HasData);
        Assert.Null(reading.ThrottlePercent);
        Assert.Null(reading.BrakePercent);
        Assert.Null(reading.BrakeActive);
    }

    [Fact]
    public void FromSnapshotJson_rejects_nan_and_infinity()
    {
        var reading = Reading("""{"pedal_position": "NaN", "brake_pedal_position": "Infinity"}""");

        Assert.Null(reading.ThrottlePercent);
        Assert.Null(reading.BrakePercent);
    }

    // ---- Projection: gauges ---------------------------------------------------------

    [Fact]
    public void Project_throttle_gauge_matches_the_web_call_site()
    {
        var gauge = Project(Sample()).Throttle;

        Assert.Equal("Throttle", gauge.GaugeLabel);
        Assert.Equal("Throttle Position", gauge.CaptionText);
        Assert.Equal(42, gauge.Value);
        Assert.Equal(100, gauge.Max);
        Assert.Equal("%", gauge.Unit);
        Assert.Equal(0, gauge.Decimals); // integer value → no decimals
        Assert.Equal(PedalGaugeAccent.Cyan, gauge.Accent);
        Assert.Equal("Throttle, 42%, Throttle Position", gauge.AutomationName);
    }

    [Fact]
    public void Project_brake_gauge_uses_global_precision_for_non_integer()
    {
        var gauge = Project(Sample()).Brake;

        Assert.Equal("Brake", gauge.GaugeLabel);
        Assert.Equal("Brake Pedal Position", gauge.CaptionText);
        Assert.Equal(13.5, gauge.Value);
        Assert.Equal("%", gauge.Unit);
        Assert.Equal(2, gauge.Decimals); // non-integer → global precision (2)
        Assert.Equal(PedalGaugeAccent.Red, gauge.Accent);
        Assert.Equal("Brake, 13.50%, Brake Pedal Position", gauge.AutomationName);
    }

    [Fact]
    public void Project_null_value_renders_zero_with_em_dash_unit()
    {
        // web: value={x ?? 0}, unit={x != null ? '%' : '—'}.
        var content = Project(Reading("""{"pedal_position": 50}"""));

        Assert.Equal(0, content.Brake.Value);
        Assert.Equal("\u2014", content.Brake.Unit);
        Assert.Equal(PedalUsageProjection.UnknownUnit, content.Brake.Unit);
        Assert.Equal("Brake, 0\u2014, Brake Pedal Position", content.Brake.AutomationName);
    }

    [Fact]
    public void Project_clamps_value_to_max_like_the_web()
    {
        var gauge = Project(Reading("""{"pedal_position": 140}""")).Throttle;

        Assert.Equal(100, gauge.Value); // clamped to [0, 100]
    }

    [Fact]
    public void Project_clamps_negative_value_to_zero()
    {
        var gauge = Project(Reading("""{"brake_pedal_position": -5}""")).Brake;

        Assert.Equal(0, gauge.Value);
    }

    // ---- Projection: brake status ---------------------------------------------------

    [Fact]
    public void Project_brake_status_active_is_danger()
    {
        var status = Project(Reading("""{"brake_pedal_active": true}""")).BrakeStatus;

        Assert.Equal("Brake Active", status.BadgeText);
        Assert.Equal(StatusKind.Danger, status.BadgeStatus);
        Assert.Equal("Brake Pedal Status", status.CaptionText);
        Assert.Equal("Brake Active, Brake Pedal Status", status.AutomationName);
    }

    [Fact]
    public void Project_brake_status_inactive_when_false_is_success()
    {
        var status = Project(Reading("""{"brake_pedal_active": false}""")).BrakeStatus;

        Assert.Equal("Brake Inactive", status.BadgeText);
        Assert.Equal(StatusKind.Success, status.BadgeStatus);
    }

    [Fact]
    public void Project_brake_status_inactive_when_unknown_is_success()
    {
        // web parity: a null brakeActive is falsy → success "Brake Inactive".
        var status = Project(Reading("""{"pedal_position": 10}""")).BrakeStatus;

        Assert.Equal("Brake Inactive", status.BadgeText);
        Assert.Equal(StatusKind.Success, status.BadgeStatus);
    }

    [Theory]
    [InlineData(true, StatusKind.Danger)]
    [InlineData(false, StatusKind.Success)]
    [InlineData(null, StatusKind.Success)]
    public void BrakeStatusFor_follows_the_web_variant(bool? active, StatusKind expected) =>
        Assert.Equal(expected, PedalUsageProjection.BrakeStatusFor(active));

    // ---- Projection: title / empty / data flag / a11y -------------------------------

    [Fact]
    public void Project_title_and_empty_message_resolve_from_the_facade()
    {
        var content = Project(Sample());

        Assert.Equal("Pedal Usage", content.Title);
        Assert.Equal("No pedal telemetry received yet", content.EmptyMessage);
    }

    [Fact]
    public void Project_has_data_reflects_the_reading()
    {
        Assert.True(Project(Sample()).HasData);
        Assert.False(Project(PedalReading.Empty).HasData);
    }

    [Fact]
    public void Project_surface_automation_name_carries_title_and_every_tile()
    {
        var content = Project(Sample());

        Assert.Contains(content.Title, content.AutomationName, StringComparison.Ordinal);
        Assert.Contains(content.Throttle.AutomationName, content.AutomationName, StringComparison.Ordinal);
        Assert.Contains(content.Brake.AutomationName, content.AutomationName, StringComparison.Ordinal);
        Assert.Contains(content.BrakeStatus.AutomationName, content.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_constants_match_the_web_radial_gauge()
    {
        Assert.Equal(100, PedalUsageProjection.GaugeMax);
        Assert.Equal("%", PedalUsageProjection.PercentUnit);
        Assert.Equal("\u2014", PedalUsageProjection.UnknownUnit);
        Assert.Equal(2, PedalUsageProjection.DisplayPrecision);
    }

    // ---- Result mapper --------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        var snapshot = Parse(SampleSnapshot);

        var cached = PedalUsageResultMapper.Map(RepositoryResult<JsonElement>.Cached(snapshot, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.True(cached.Value!.HasData);
        Assert.Equal(42, cached.Value.ThrottlePercent);

        var offline = PedalUsageResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            snapshot, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.True(offline.Value!.HasData);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        var snapshot = Parse(SampleSnapshot);

        Assert.Equal(LoadStatus.Loaded, PedalUsageResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(snapshot, Now)).Status);

        Assert.Equal(LoadStatus.Empty, PedalUsageResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, PedalUsageResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ----------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<PedalReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(PedalUsageState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_with_data_is_ready()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(PedalUsageState.Ready, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(42, vm.Content.Throttle.Value);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_pedal_data_renders_empty()
    {
        using var vm = NewViewModel(Loaded(PedalReading.Empty));
        await vm.LoadAsync();

        Assert.Equal(PedalUsageState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No pedal telemetry received yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<PedalReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(PedalUsageState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<PedalReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(PedalUsageState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<PedalReading>.Cached(Sample(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(PedalUsageState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<PedalReading>.OfflineCached(
            Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(PedalUsageState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_ready()
    {
        using var vm = NewViewModel(
            RepositoryResult<PedalReading>.Loading(),
            RepositoryResult<PedalReading>.Cached(Sample(), Now, stale: false),
            RepositoryResult<PedalReading>.Loaded(Sample(), Now));
        await vm.LoadAsync();

        Assert.Equal(PedalUsageState.Ready, vm.State);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_surface_name_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<PedalReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Pedal Usage", vm.SurfaceName);
        Assert.Equal("No pedal telemetry received yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_content()
    {
        using var vm = NewViewModel(Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(PedalUsageViewModel.State), changed);
        Assert.Contains(nameof(PedalUsageViewModel.Content), changed);
    }

    // ---- Accessibility --------------------------------------------------------------

    [Fact]
    public void Every_tile_exposes_a_non_empty_automation_name()
    {
        var content = Project(Sample());

        Assert.False(string.IsNullOrWhiteSpace(content.AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(content.Throttle.AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(content.Brake.AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(content.BrakeStatus.AutomationName));
    }

    [Fact]
    public async Task Every_state_exposes_a_non_empty_surface_name()
    {
        foreach (var emission in new[]
        {
            RepositoryResult<PedalReading>.Loading(),
            RepositoryResult<PedalReading>.Empty(Now),
            RepositoryResult<PedalReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            RepositoryResult<PedalReading>.Cached(Sample(), Now, stale: true),
            RepositoryResult<PedalReading>.OfflineCached(Sample(), Now, new RepositoryError(RepositoryErrorKind.Network, "x")),
            RepositoryResult<PedalReading>.Loaded(Sample(), Now),
        })
        {
            using var vm = NewViewModel(emission);
            await vm.LoadAsync();
            Assert.False(string.IsNullOrWhiteSpace(vm.SurfaceName));
        }
    }

    // ---- Registration / diagnostics -------------------------------------------------

    [Fact]
    public void Registration_slug_category_and_name_are_stable()
    {
        Assert.Equal("PedalUsage", PedalUsageRegistration.Slug);
        Assert.Equal("driving", PedalUsageRegistration.Category);
        Assert.Equal("Pedal Usage", PedalUsageRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new PedalUsageDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=PedalUsage", Assert.Single(lines));
    }

    // ---- Fakes / helpers ------------------------------------------------------------

    private static RepositoryResult<PedalReading> Loaded(PedalReading reading) =>
        RepositoryResult<PedalReading>.Loaded(reading, Now);

    private static PedalUsageViewModel NewViewModel(params RepositoryResult<PedalReading>[] emissions) =>
        new(new FakePedalUsageSource(emissions), Localizer);

    private sealed class FakePedalUsageSource(params RepositoryResult<PedalReading>[] emissions) : IPedalUsageSource
    {
        public async IAsyncEnumerable<RepositoryResult<PedalReading>> StreamAsync(
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
}
