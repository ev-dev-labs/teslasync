using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the SleepEfficiencyWidget's UI-thread-free logic — the JSON parse adapter (the
/// useSleepEfficiency normalisation of the snake_case <c>/analytics/sleep</c> body), the <c>efficiencyColor</c>
/// threshold helper, the gauge value clamp + "%" suffix, the localized "Efficiency" caption, the
/// <c>totalSleepHours</c> / <c>avgDrainPerDay</c> / <c>wakeEventsCount</c> derivations, the stat formatting
/// across the compact / wide footprints, the cache-then-network result mapper, the per-vehicle data source
/// (primary resolution + query-scoped request with the days window), the registry metadata, the diagnostics,
/// and the state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline).
/// Mirrors the web spec (web/src/features/dashboard/widgets/SleepEfficiencyWidget.tsx).
/// </summary>
public sealed class SleepEfficiencyWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);
    private static readonly SleepEfficiencySize StdSize = new(2, 2);

    // ---- Parse adapter (web useSleepEfficiency normalisation) -----------------------

    [Fact]
    public void FromResponse_reads_all_snake_case_fields()
    {
        using var doc = JsonDocument.Parse(
            """
            {"sleep_efficiency_pct":92,"sentry_off_drain_rate":0.5,
             "state_distribution":[{"state":"asleep","total_minutes":600},
                                   {"state":"offline","total_minutes":180},
                                   {"state":"online","total_minutes":120}],
             "recent_events":[{"id":1},{"id":2}]}
            """);

        var data = SleepEfficiencyData.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        Assert.Equal(92, data!.SleepEfficiencyPct);
        Assert.Equal(0.5, data.SentryOffDrainRate);
        Assert.Equal(3, data.StateDistribution.Count);
        Assert.Equal(2, data.RecentEventsCount);
    }

    [Fact]
    public void FromResponse_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"sleep_efficiency_pct":50}""");

        var data = SleepEfficiencyData.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        Assert.Equal(50, data!.SleepEfficiencyPct);
        Assert.Equal(0, data.SentryOffDrainRate);
        Assert.Empty(data.StateDistribution);
        Assert.Equal(0, data.RecentEventsCount);
    }

    [Fact]
    public void FromResponse_reads_empty_object_as_usable_zero_summary()
    {
        // Web parity: with a vehicle the response is always an object; `data` is truthy so the gauge renders at
        // 0% — the widget does NOT show the empty surface for an object body.
        using var doc = JsonDocument.Parse("{}");

        var data = SleepEfficiencyData.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        Assert.Equal(0, data!.SleepEfficiencyPct);
    }

    [Theory]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("42")]
    public void FromResponse_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(SleepEfficiencyData.FromResponse(doc.RootElement));
    }

    [Fact]
    public void FromResponse_skips_malformed_distribution_rows()
    {
        using var doc = JsonDocument.Parse(
            """{"state_distribution":[{"state":"asleep","total_minutes":300},42,{"total_minutes":60},{"state":"offline"}]}""");

        var data = SleepEfficiencyData.FromResponse(doc.RootElement);

        Assert.NotNull(data);
        // The scalar (42) is skipped; the two object rows missing a field default that field.
        Assert.Equal(3, data!.StateDistribution.Count);
        Assert.Equal("asleep", data.StateDistribution[0].State);
        Assert.Equal(300, data.StateDistribution[0].TotalMinutes);
        Assert.Equal(string.Empty, data.StateDistribution[1].State); // {"total_minutes":60}
        Assert.Equal(60, data.StateDistribution[1].TotalMinutes);
        Assert.Equal("offline", data.StateDistribution[2].State);    // {"state":"offline"}
        Assert.Equal(0, data.StateDistribution[2].TotalMinutes);
    }

    // ---- Derivations: totalSleepHours / sleep-state set (web parity) ----------------

    [Fact]
    public void TotalSleepHours_sums_asleep_and_offline_minutes_over_sixty()
    {
        // Web parity (SleepEfficiencyWidget.tsx L50-56): filter asleep|offline, reduce total_minutes, /60.
        var data = new SleepEfficiencyData(
            SleepEfficiencyPct: 0,
            SentryOffDrainRate: 0,
            StateDistribution: new[]
            {
                new SleepStateSlice("asleep", 600),
                new SleepStateSlice("offline", 180),
                new SleepStateSlice("online", 120),   // excluded
                new SleepStateSlice("driving", 240),   // excluded
            },
            RecentEventsCount: 0);

        Assert.Equal(13.0, data.TotalSleepHours()); // (600 + 180) / 60
    }

    [Fact]
    public void TotalSleepHours_is_zero_when_no_sleep_states_present()
    {
        var data = new SleepEfficiencyData(0, 0, new[] { new SleepStateSlice("online", 500) }, 0);
        Assert.Equal(0, data.TotalSleepHours());
    }

    [Theory]
    [InlineData("asleep", true)]
    [InlineData("offline", true)]
    [InlineData("online", false)]
    [InlineData("driving", false)]
    [InlineData("ASLEEP", false)] // web compares with === (case-sensitive)
    [InlineData(null, false)]
    public void IsSleepState_matches_web_literal_states(string? state, bool expected) =>
        Assert.Equal(expected, SleepEfficiencyData.IsSleepState(state));

    // ---- Efficiency colour thresholds (web efficiencyColor) ------------------------

    [Theory]
    [InlineData(100, StatusKind.Success)]
    [InlineData(96, StatusKind.Success)]
    [InlineData(95, StatusKind.Warning)]   // web: strict > 95
    [InlineData(86, StatusKind.Warning)]
    [InlineData(85, StatusKind.Danger)]    // web: strict > 85
    [InlineData(0, StatusKind.Danger)]
    public void StatusFor_classifies_by_threshold(double percent, StatusKind expected) =>
        Assert.Equal(expected, SleepEfficiencyProjection.StatusFor(percent));

    [Theory]
    [InlineData(StatusKind.Success, "TsColorSuccessBrush")]
    [InlineData(StatusKind.Warning, "TsColorWarningBrush")]
    [InlineData(StatusKind.Danger, "TsColorDangerBrush")]
    public void Status_maps_to_themed_status_brush(StatusKind status, string brushKey) =>
        Assert.Equal(brushKey, StatusResources.AccentBrushKey(status));

    [Fact]
    public void Threshold_constants_match_web()
    {
        Assert.Equal(95, SleepEfficiencyProjection.GreenThreshold);
        Assert.Equal(85, SleepEfficiencyProjection.AmberThreshold);
        Assert.Equal(100, SleepEfficiencyProjection.MaxPercent);
        Assert.Equal("%", SleepEfficiencyProjection.PercentUnit);
    }

    // ---- Projection: gauge value / caption / unit (web RadialGauge parity) ----------

    [Fact]
    public void Project_renders_integer_efficiency_with_percent_suffix_and_caption()
    {
        var view = SleepEfficiencyProjection.Project(
            Sample(efficiency: 96), StdSize, Localizer);

        Assert.Equal(96, view.GaugeValue);
        Assert.Equal(100, view.GaugeMax);
        Assert.Equal("96", view.GaugeValueText);
        Assert.Equal("%", view.GaugeUnit);
        Assert.Equal("Efficiency", view.GaugeCaption);
        Assert.Equal(StatusKind.Success, view.Status);
    }

    [Fact]
    public void Project_formats_fractional_efficiency_with_two_decimals()
    {
        // Web RadialGauge: integers render with 0 decimals, fractions with the global precision (2).
        var view = SleepEfficiencyProjection.Project(Sample(efficiency: 92.5), StdSize, Localizer);

        Assert.Equal(92.5, view.GaugeValue);
        Assert.Equal("92.50", view.GaugeValueText);
        Assert.Equal(StatusKind.Warning, view.Status); // 92.5 -> > 85, not > 95
    }

    [Fact]
    public void Project_clamps_gauge_value_into_range()
    {
        var view = SleepEfficiencyProjection.Project(Sample(efficiency: 105), StdSize, Localizer);

        Assert.Equal(100, view.GaugeValue);
        Assert.Equal("100", view.GaugeValueText);
        Assert.Equal(StatusKind.Success, view.Status);
    }

    [Fact]
    public void Project_coerces_non_finite_efficiency_to_zero()
    {
        var view = SleepEfficiencyProjection.Project(Sample(efficiency: double.NaN), StdSize, Localizer);

        Assert.Equal(0, view.GaugeValue);
        Assert.Equal("0", view.GaugeValueText);
        Assert.Equal(StatusKind.Danger, view.Status);
    }

    [Theory]
    [InlineData(96, StatusKind.Success)]
    [InlineData(90, StatusKind.Warning)]
    [InlineData(70, StatusKind.Danger)]
    public void Project_colours_arc_by_efficiency_percent(double pct, StatusKind expected)
    {
        var view = SleepEfficiencyProjection.Project(Sample(efficiency: pct), StdSize, Localizer);
        Assert.Equal(expected, view.Status);
    }

    // ---- Projection: stats (web GaugeHeroStat derivations) -------------------------

    [Fact]
    public void Project_derives_the_three_stats_with_unit_suffixes()
    {
        var data = new SleepEfficiencyData(
            SleepEfficiencyPct: 90,
            SentryOffDrainRate: 0.5,
            StateDistribution: new[]
            {
                new SleepStateSlice("asleep", 600),
                new SleepStateSlice("offline", 180),
            },
            RecentEventsCount: 2);

        var view = SleepEfficiencyProjection.Project(data, StdSize, Localizer);

        Assert.Equal(3, view.Stats.Count);

        Assert.Equal("Avg Drain/Day", view.Stats[0].Label);
        Assert.Equal("12.00", view.Stats[0].ValueText); // 0.5 * 24
        Assert.Equal("%", view.Stats[0].Unit);

        Assert.Equal("Total Sleep", view.Stats[1].Label);
        Assert.Equal("13", view.Stats[1].ValueText);    // (600 + 180) / 60
        Assert.Equal("h", view.Stats[1].Unit);

        Assert.Equal("Wake Events", view.Stats[2].Label);
        Assert.Equal("2", view.Stats[2].ValueText);
        Assert.Equal(string.Empty, view.Stats[2].Unit); // no unit
        Assert.True(view.ShowStats);
    }

    [Theory]
    [InlineData(0.5, "12.00")]
    [InlineData(1.25, "30.00")]
    [InlineData(0, "0.00")]
    public void Project_avg_drain_is_rate_times_twentyfour_to_two_decimals(double rate, string expected)
    {
        var data = new SleepEfficiencyData(0, rate, Array.Empty<SleepStateSlice>(), 0);
        var view = SleepEfficiencyProjection.Project(data, StdSize, Localizer);
        Assert.Equal(expected, view.Stats[0].ValueText);
    }

    [Fact]
    public void Project_wake_events_renders_as_integer_count()
    {
        var data = new SleepEfficiencyData(0, 0, Array.Empty<SleepStateSlice>(), 5);
        var view = SleepEfficiencyProjection.Project(data, StdSize, Localizer);
        Assert.Equal("5", view.Stats[2].ValueText);
    }

    [Fact]
    public void Project_every_stat_has_a_localized_label_and_measure_name()
    {
        var view = SleepEfficiencyProjection.Project(Sample(efficiency: 90), StdSize, Localizer);

        Assert.All(view.Stats, s =>
        {
            Assert.False(string.IsNullOrWhiteSpace(s.Label));
            Assert.False(string.IsNullOrWhiteSpace(s.AutomationName));
            Assert.Contains(s.Label, s.AutomationName, StringComparison.Ordinal);
        });
    }

    [Fact]
    public void Project_gauge_accessibility_name_contains_value_unit_and_caption()
    {
        var view = SleepEfficiencyProjection.Project(Sample(efficiency: 96), StdSize, Localizer);

        Assert.False(string.IsNullOrWhiteSpace(view.GaugeAutomationName));
        Assert.Contains("96", view.GaugeAutomationName, StringComparison.Ordinal);
        Assert.Contains("%", view.GaugeAutomationName, StringComparison.Ordinal);
        Assert.Contains("Efficiency", view.GaugeAutomationName, StringComparison.Ordinal);
        Assert.Contains("Sleep Efficiency", view.GaugeAutomationName, StringComparison.Ordinal);
    }

    // ---- Size / footprint flags (web isCompact / gauge diameter) -------------------

    [Theory]
    [InlineData(1, 2, true, 70)]    // default -> compact (cols <= 1) -> 70px, no stats
    [InlineData(1, 1, true, 70)]
    [InlineData(2, 2, false, 100)]  // wide -> 100px, stats
    [InlineData(3, 40, false, 100)] // max
    public void Size_flags_match_web(int cols, int rows, bool compact, double diameter)
    {
        var size = new SleepEfficiencySize(cols, rows);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(diameter, size.GaugeDiameter);
    }

    [Fact]
    public void Project_compact_blanks_caption_hides_stats_and_shrinks_gauge()
    {
        var view = SleepEfficiencyProjection.Project(Sample(efficiency: 96), new SleepEfficiencySize(1, 2), Localizer);

        Assert.True(view.IsCompact);
        Assert.False(view.ShowStats);
        Assert.Equal(string.Empty, view.GaugeCaption); // web: label = isCompact ? '' : 'Efficiency'
        Assert.Equal(70, view.GaugeDiameter);
        Assert.Equal(3, view.Stats.Count); // still projected, just not shown
        // Compact blanks the standalone caption: the gauge name is just "<title> <value>%" with no trailing caption.
        Assert.Equal("Sleep Efficiency 96%", view.GaugeAutomationName);
    }

    [Fact]
    public void Project_wide_shows_caption_and_stats_at_full_diameter()
    {
        var view = SleepEfficiencyProjection.Project(Sample(efficiency: 96), new SleepEfficiencySize(2, 2), Localizer);

        Assert.False(view.IsCompact);
        Assert.True(view.ShowStats);
        Assert.Equal("Efficiency", view.GaugeCaption);
        Assert.Equal(100, view.GaugeDiameter);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""{"sleep_efficiency_pct":80,"sentry_off_drain_rate":0.3}""");

        var cached = SleepEfficiencyResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(80, cached.Value!.SleepEfficiencyPct);

        var offline = SleepEfficiencyResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal(0.3, offline.Value!.SentryOffDrainRate);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""{"sleep_efficiency_pct":50}""");

        Assert.Equal(LoadStatus.Loaded, SleepEfficiencyResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, SleepEfficiencyResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, SleepEfficiencyResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_collapses_non_object_loaded_body_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");

        var mapped = SleepEfficiencyResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Empty, mapped.Status);
        Assert.Null(mapped.Value);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<SleepEfficiencyData>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SleepEfficiencyState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_gauge_display()
    {
        using var vm = NewViewModel(Loaded(Sample(efficiency: 96)));
        await vm.LoadAsync();

        Assert.Equal(SleepEfficiencyState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal("96", vm.Display!.GaugeValueText);
        Assert.Equal(StatusKind.Success, vm.Display.Status);
        Assert.True(vm.Display.ShowStats);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<SleepEfficiencyData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SleepEfficiencyState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Null(vm.Display);
        Assert.Equal("No sleep efficiency data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<SleepEfficiencyData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SleepEfficiencyState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<SleepEfficiencyData>.Cached(Sample(efficiency: 90), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SleepEfficiencyState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.Equal(StatusKind.Warning, vm.Display!.Status); // 90 -> amber
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<SleepEfficiencyData>.OfflineCached(
            Sample(efficiency: 70), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SleepEfficiencyState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.Equal(StatusKind.Danger, vm.Display!.Status); // 70 -> red
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<SleepEfficiencyData>.Loading(),
            RepositoryResult<SleepEfficiencyData>.Cached(Sample(efficiency: 80), Now, stale: false),
            RepositoryResult<SleepEfficiencyData>.Loaded(Sample(efficiency: 96), Now));
        await vm.LoadAsync();

        Assert.Equal(SleepEfficiencyState.Loaded, vm.State);
        Assert.Equal("96", vm.Display!.GaugeValueText);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new SleepEfficiencySize(2, 2), Loaded(Sample(efficiency: 96)));
        await vm.LoadAsync();
        Assert.False(vm.Display!.IsCompact);
        Assert.True(vm.Display.ShowStats);
        Assert.Equal("Efficiency", vm.Display.GaugeCaption);

        vm.Size = new SleepEfficiencySize(1, 2);
        Assert.True(vm.Display!.IsCompact);
        Assert.False(vm.Display.ShowStats);
        Assert.Equal(string.Empty, vm.Display.GaugeCaption);
        Assert.Equal(70, vm.Display.GaugeDiameter);
        Assert.Equal(SleepEfficiencyState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_help_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<SleepEfficiencyData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Sleep Efficiency", vm.Title);
        Assert.Equal("No sleep efficiency data", vm.EmptyMessage);
        Assert.False(string.IsNullOrWhiteSpace(vm.HelpText));
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sample(efficiency: 90)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SleepEfficiencyViewModel.State), changed);
        Assert.Contains(nameof(SleepEfficiencyViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("sleep-efficiency", SleepEfficiencyRegistration.Id);
        Assert.Equal("energy", SleepEfficiencyRegistration.Category);
        Assert.Equal("SleepEfficiencyWidget", SleepEfficiencyRegistration.Slug);
        Assert.Equal(new SleepEfficiencySize(1, 2), SleepEfficiencyRegistration.DefaultSize);
        Assert.Equal(new SleepEfficiencySize(1, 2), SleepEfficiencyRegistration.MinSize);
        Assert.Equal(new SleepEfficiencySize(3, 40), SleepEfficiencyRegistration.MaxSize);
        Assert.Equal("Sleep Efficiency", SleepEfficiencyRegistration.Name(Localizer));
        Assert.Contains("sleep", SleepEfficiencyRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 2, true)]    // min == default
    [InlineData(3, 40, true)]   // max
    [InlineData(2, 10, true)]   // inside
    [InlineData(4, 2, false)]   // above max cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(1, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, SleepEfficiencyRegistration.IsWithinBounds(new SleepEfficiencySize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new SleepEfficiencySize(1, 2), SleepEfficiencyRegistration.Clamp(new SleepEfficiencySize(0, 0)));
        Assert.Equal(new SleepEfficiencySize(3, 40), SleepEfficiencyRegistration.Clamp(new SleepEfficiencySize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SleepEfficiencyDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SleepEfficiencyWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new SleepEfficiencySource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_and_requests_sleep_by_query()
    {
        using var doc = JsonDocument.Parse(
            """{"sleep_efficiency_pct":92,"sentry_off_drain_rate":0.5}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new SleepEfficiencySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal(92, terminal.Value!.SleepEfficiencyPct);
        Assert.Equal(0.5, terminal.Value.SentryOffDrainRate);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_analytics_sleep", request.OperationId);
        Assert.Equal(7L, request.Query!["vehicle_id"]);
        Assert.Equal(30, request.Query!["days"]); // web parity: useSleepEfficiency defaults days=30
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""{"sleep_efficiency_pct":50}""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new SleepEfficiencySource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        var request = Assert.Single(api.Requests);
        Assert.Equal(42L, request.Query!["vehicle_id"]);
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_object_body_still_loads_zero_summary()
    {
        // Web parity: an object body (even {}) is truthy -> the gauge renders at 0%, NOT the empty surface.
        using var doc = JsonDocument.Parse("{}");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new SleepEfficiencySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Equal(0, results[^1].Value!.SleepEfficiencyPct);
    }

    [Fact]
    public async Task Source_non_object_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new SleepEfficiencySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static SleepEfficiencyData Sample(double efficiency) =>
        new(
            SleepEfficiencyPct: efficiency,
            SentryOffDrainRate: 0.5,
            StateDistribution: new[]
            {
                new SleepStateSlice("asleep", 600),
                new SleepStateSlice("offline", 180),
            },
            RecentEventsCount: 2);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<SleepEfficiencyData>>> Drain(ISleepEfficiencySource source)
    {
        var list = new List<RepositoryResult<SleepEfficiencyData>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<SleepEfficiencyData> Loaded(SleepEfficiencyData data) =>
        RepositoryResult<SleepEfficiencyData>.Loaded(data, Now);

    private static SleepEfficiencyViewModel NewViewModel(params RepositoryResult<SleepEfficiencyData>[] emissions) =>
        NewViewModel(StdSize, emissions);

    private static SleepEfficiencyViewModel NewViewModel(
        SleepEfficiencySize size,
        params RepositoryResult<SleepEfficiencyData>[] emissions) =>
        new(new FakeSleepEfficiencySource(emissions), Localizer, size);

    private sealed class FakeSleepEfficiencySource(params RepositoryResult<SleepEfficiencyData>[] emissions) : ISleepEfficiencySource
    {
        public async IAsyncEnumerable<RepositoryResult<SleepEfficiencyData>> StreamAsync(
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

    private sealed class FakeWidgetVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }
}
