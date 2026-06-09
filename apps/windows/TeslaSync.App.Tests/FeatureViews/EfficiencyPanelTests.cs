using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the EfficiencyPanel's UI-thread-free logic — the charging-session JSON parse
/// adapter, the duration + efficiency computation (ported from the web helpers), the projection (the four
/// tiles, their formatted values, tones, the average progress bar fraction, the header summary, the labels
/// and accessibility names), the cache-then-network result mapper, the registration metadata, the
/// diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error /
/// stale / offline). Mirrors the web spec
/// (web/src/features/charging/components/charging-list/EfficiencyPanel.tsx + helpers.ts).
/// </summary>
public sealed class EfficiencyPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Start = new(2026, 1, 15, 8, 0, 0, TimeSpan.Zero);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_session_fields()
    {
        const string json = """
        {
          "id": 42,
          "total_energy_added_wh": 30000,
          "started_at": "2026-01-15T08:00:00Z",
          "ended_at": "2026-01-15T09:00:00Z"
        }
        """;
        using var doc = JsonDocument.Parse(json);

        var s = EfficiencyPanelSession.FromJson(doc.RootElement);

        Assert.Equal(42, s.Id);
        Assert.Equal(30000, s.TotalEnergyAddedWh);
        Assert.NotNull(s.StartedAt);
        Assert.NotNull(s.EndedAt);
    }

    [Fact]
    public void ParseList_reads_array_and_preserves_order()
    {
        const string json = """
        [ {"id":1,"total_energy_added_wh":10}, {"id":2,"total_energy_added_wh":20} ]
        """;
        using var doc = JsonDocument.Parse(json);

        var list = EfficiencyPanelSession.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].Id);
        Assert.Equal(2, list[1].Id);
    }

    [Fact]
    public void ParseList_tolerates_missing_fields_and_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""[ {"id":"7","total_energy_added_wh":"25000"} ]""");

        var list = EfficiencyPanelSession.ParseList(doc.RootElement);

        Assert.Single(list);
        Assert.Equal(7, list[0].Id);
        Assert.Equal(25000, list[0].TotalEnergyAddedWh);
        Assert.Null(list[0].StartedAt);
        Assert.Null(list[0].EndedAt);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"id":1}""");
        Assert.Empty(EfficiencyPanelSession.ParseList(doc.RootElement));
    }

    // ---- Duration (web durationMinutes) --------------------------------------------

    [Fact]
    public void DurationMinutes_rounds_whole_minutes()
    {
        Assert.Equal(30, EfficiencyPanelProjection.DurationMinutes(Start, Start.AddMinutes(30)));
        Assert.Equal(60, EfficiencyPanelProjection.DurationMinutes(Start, Start.AddHours(1)));
        // Web Math.round(0.5) === 1 (round half up; positive window so away-from-zero matches).
        Assert.Equal(1, EfficiencyPanelProjection.DurationMinutes(Start, Start.AddSeconds(30)));
    }

    [Fact]
    public void DurationMinutes_is_zero_for_missing_or_non_positive_window()
    {
        Assert.Equal(0, EfficiencyPanelProjection.DurationMinutes(Start, null));
        Assert.Equal(0, EfficiencyPanelProjection.DurationMinutes(null, Start));
        Assert.Equal(0, EfficiencyPanelProjection.DurationMinutes(Start, Start));            // end == start
        Assert.Equal(0, EfficiencyPanelProjection.DurationMinutes(Start, Start.AddMinutes(-5))); // end < start
    }

    // ---- ComputeStats (web computeEfficiencyStats) ---------------------------------

    [Fact]
    public void ComputeStats_returns_null_for_no_sessions()
    {
        Assert.Null(EfficiencyPanelProjection.ComputeStats(Array.Empty<EfficiencyPanelSession>()));
    }

    [Fact]
    public void ComputeStats_excludes_sessions_without_energy_or_duration()
    {
        var sessions = new[]
        {
            Session(energy: 0, minutes: 60),     // no energy -> excluded
            Session(energy: 10000, minutes: 0),  // no duration -> excluded
        };

        Assert.Null(EfficiencyPanelProjection.ComputeStats(sessions));
    }

    [Fact]
    public void ComputeStats_derives_avg_best_worst_totals_and_constant_wall_loss()
    {
        var sessions = new[]
        {
            Session(energy: 30000, minutes: 60), // efficiency 30000
            Session(energy: 10000, minutes: 60), // efficiency 10000
        };

        var stats = EfficiencyPanelProjection.ComputeStats(sessions);

        Assert.NotNull(stats);
        Assert.Equal(2, stats!.Count);
        Assert.Equal(20000, stats.AvgEfficiency);   // (30000 + 10000) / 2
        Assert.Equal(30000, stats.Best.Efficiency); // highest
        Assert.Equal(10000, stats.Worst.Efficiency); // lowest
        Assert.Equal(40000, stats.TotalAdded);
        Assert.Equal(40000, stats.TotalUsed);        // web: totalUsed == totalAdded
        Assert.Equal(0, stats.WallLoss);             // web constant 0
    }

    [Fact]
    public void ComputeStats_single_session_best_equals_worst()
    {
        var stats = EfficiencyPanelProjection.ComputeStats(new[] { Session(energy: 12000, minutes: 60) });

        Assert.NotNull(stats);
        Assert.Equal(1, stats!.Count);
        Assert.Equal(stats.Best.Id, stats.Worst.Id);
        Assert.Equal(12000, stats.Best.Efficiency);
    }

    // ---- BarFraction (web Math.min(avg, 100)% width) -------------------------------

    [Theory]
    [InlineData(50.0, 0.5)]
    [InlineData(100.0, 1.0)]
    [InlineData(150.0, 1.0)]   // capped at 100%
    [InlineData(0.0, 0.0)]
    [InlineData(-5.0, 0.0)]    // clamped to 0
    public void BarFraction_matches_web_cap(double avg, double expected)
    {
        Assert.Equal(expected, EfficiencyPanelProjection.BarFraction(avg));
    }

    [Fact]
    public void BarFraction_is_zero_for_non_finite()
    {
        Assert.Equal(0, EfficiencyPanelProjection.BarFraction(double.NaN));
        Assert.Equal(0, EfficiencyPanelProjection.BarFraction(double.PositiveInfinity));
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_empty_when_no_efficiency_data()
    {
        var view = EfficiencyPanelProjection.Project(Array.Empty<EfficiencyPanelSession>(), Localizer, Now);

        Assert.False(view.HasData);
        Assert.Empty(view.Metrics);
        Assert.Equal(0, view.Count);
        Assert.Equal("No charging sessions with efficiency data yet.", view.EmptyMessage);
        Assert.Contains("0", view.HeaderSummary, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_builds_four_tiles_with_web_formatting_and_tones()
    {
        var sessions = new[]
        {
            Session(energy: 30000, minutes: 60, startedAt: Start),
            Session(energy: 10000, minutes: 60, startedAt: Start.AddDays(1)),
        };

        var view = EfficiencyPanelProjection.Project(sessions, Localizer, Now);

        Assert.True(view.HasData);
        Assert.Equal(2, view.Count);
        Assert.Equal(4, view.Metrics.Count);

        // Web header: `{hint} ({count} {sessionsWithData})`.
        Assert.Equal("Wall-to-battery energy conversion (2 sessions with data)", view.HeaderSummary);

        var avg = view.Metrics[0];
        Assert.Equal(EfficiencyTone.Cyan, avg.Tone);
        Assert.Equal("20,000.00%", avg.ValueText);            // fmtPercent(avgEfficiency)
        Assert.Equal("Average Efficiency", avg.Label);
        Assert.NotNull(avg.BarFraction);                      // only the average tile has the bar
        Assert.Null(avg.SubText);

        var best = view.Metrics[1];
        Assert.Equal(EfficiencyTone.Emerald, best.Tone);
        Assert.Equal("30,000.00%", best.ValueText);
        Assert.Equal("Best Session", best.Label);
        Assert.False(string.IsNullOrWhiteSpace(best.SubText));  // formatted date
        Assert.Null(best.BarFraction);

        var worst = view.Metrics[2];
        Assert.Equal(EfficiencyTone.Rose, worst.Tone);
        Assert.Equal("10,000.00%", worst.ValueText);
        Assert.Equal("Worst Session", worst.Label);
        Assert.False(string.IsNullOrWhiteSpace(worst.SubText));

        var wallLoss = view.Metrics[3];
        Assert.Equal(EfficiencyTone.Amber, wallLoss.Tone);
        Assert.Equal("0.00 kWh", wallLoss.ValueText);          // fmtWithUnit(0, 'kWh')
        Assert.Equal("Wall-to-Battery Loss", wallLoss.Label);
        // Web: `{fmtNumber(totalUsed)} kWh → {fmtNumber(totalAdded)} kWh`.
        Assert.Equal("40,000.00 kWh \u2192 40,000.00 kWh", wallLoss.SubText);
    }

    [Fact]
    public void Project_dates_use_full_variant_not_the_em_dash_fallback()
    {
        var view = EfficiencyPanelProjection.Project(
            new[] { Session(energy: 20000, minutes: 60, startedAt: Start) }, Localizer, Now);

        Assert.DoesNotContain('\u2014', view.Metrics[1].SubText!); // a real date, not the em-dash fallback
    }

    // ---- i18n: every label resolves through its catalog key -------------------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();
        var view = EfficiencyPanelProjection.Project(
            new[] { Session(energy: 20000, minutes: 60, startedAt: Start) }, echo, Now);

        Assert.Equal("L:charging.efficiency.title", view.Title);
        Assert.Equal("L:charging.efficiency.hint", view.Hint);
        Assert.Equal("L:charging.efficiency.sessionsWithData", view.SessionsWithDataLabel);
        Assert.Equal("L:charging.efficiency.empty", view.EmptyMessage);
        Assert.Equal("L:charging.efficiency.aria", view.AriaLabel);
        Assert.Equal("L:charging.efficiency.average", view.Metrics[0].Label);
        Assert.Equal("L:charging.efficiency.best", view.Metrics[1].Label);
        Assert.Equal("L:charging.efficiency.worst", view.Metrics[2].Label);
        Assert.Equal("L:charging.efficiency.wallLoss", view.Metrics[3].Label);
    }

    // ---- a11y: every tile carries a spoken name ------------------------------------

    [Fact]
    public void Every_metric_carries_a_non_empty_value_label_and_automation_name()
    {
        var view = EfficiencyPanelProjection.Project(
            new[]
            {
                Session(energy: 30000, minutes: 60, startedAt: Start),
                Session(energy: 10000, minutes: 60, startedAt: Start.AddDays(1)),
            },
            Localizer,
            Now);

        Assert.All(view.Metrics, m =>
        {
            Assert.False(string.IsNullOrWhiteSpace(m.ValueText));
            Assert.False(string.IsNullOrWhiteSpace(m.Label));
            Assert.False(string.IsNullOrWhiteSpace(m.AutomationName));
            Assert.Contains(m.ValueText, m.AutomationName, StringComparison.Ordinal);
            Assert.Contains(m.Label, m.AutomationName, StringComparison.Ordinal);
        });
    }

    // ---- Tone -> token brush mapping -----------------------------------------------

    [Theory]
    [InlineData(EfficiencyTone.Cyan, "TsColorAccentBrush")]
    [InlineData(EfficiencyTone.Emerald, "TsColorSuccessBrush")]
    [InlineData(EfficiencyTone.Rose, "TsColorDangerBrush")]
    [InlineData(EfficiencyTone.Amber, "TsColorWarningBrush")]
    public void ToneBrushKey_maps_each_web_accent(EfficiencyTone tone, string expected)
    {
        Assert.Equal(expected, EfficiencyPanelTokens.ToneBrushKey(tone));
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_value()
    {
        using var doc = JsonDocument.Parse("""[ {"id":1,"total_energy_added_wh":10} ]""");

        var cached = EfficiencyPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = EfficiencyPanelResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void Mapper_maps_loading_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loading, EfficiencyPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);

        Assert.Equal(LoadStatus.Empty, EfficiencyPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, EfficiencyPanelResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(EfficiencyPanelState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_metrics()
    {
        using var vm = NewViewModel(Loaded(Sessions(Session(energy: 30000, minutes: 60, startedAt: Start))));
        await vm.LoadAsync();

        Assert.Equal(EfficiencyPanelState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Metrics.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_efficiency_data_renders_empty()
    {
        using var vm = NewViewModel(Loaded(Sessions(Session(energy: 0, minutes: 60))));
        await vm.LoadAsync();

        Assert.Equal(EfficiencyPanelState.Empty, vm.State);
        Assert.False(vm.HasData);
        // Even empty, the surface keeps the friendly message (never a blank box).
        Assert.Equal("No charging sessions with efficiency data yet.", vm.Display.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(EfficiencyPanelState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(EfficiencyPanelState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>.Cached(
            Sessions(Session(energy: 30000, minutes: 60, startedAt: Start)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(EfficiencyPanelState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>.OfflineCached(
            Sessions(Session(energy: 30000, minutes: 60, startedAt: Start)),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(EfficiencyPanelState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>.Loading(),
            RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>.Cached(
                Sessions(Session(energy: 10000, minutes: 60, startedAt: Start)), Now, stale: false),
            RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>.Loaded(
                Sessions(Session(energy: 30000, minutes: 60, startedAt: Start)), Now));
        await vm.LoadAsync();

        Assert.Equal(EfficiencyPanelState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal("30,000.00%", vm.Display.Metrics[1].ValueText);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Charging Efficiency", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sessions(Session(energy: 30000, minutes: 60, startedAt: Start))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(EfficiencyPanelViewModel.State), changed);
        Assert.Contains(nameof(EfficiencyPanelViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("efficiency-panel", EfficiencyPanelRegistration.Id);
        Assert.Equal("charging", EfficiencyPanelRegistration.Category);
        Assert.Equal("EfficiencyPanel", EfficiencyPanelRegistration.Slug);
        Assert.Equal("Charging Efficiency", EfficiencyPanelRegistration.Name(Localizer));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new EfficiencyPanelDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=EfficiencyPanel", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static EfficiencyPanelSession Session(
        double energy,
        long minutes,
        long id = 1,
        DateTimeOffset? startedAt = null)
    {
        DateTimeOffset start = startedAt ?? Start;
        DateTimeOffset? end = minutes > 0 ? start.AddMinutes(minutes) : null;
        return new EfficiencyPanelSession(id, energy, start, end);
    }

    private static IReadOnlyList<EfficiencyPanelSession> Sessions(params EfficiencyPanelSession[] sessions) =>
        sessions;

    private static RepositoryResult<IReadOnlyList<EfficiencyPanelSession>> Loaded(IReadOnlyList<EfficiencyPanelSession> data) =>
        RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>.Loaded(data, Now);

    private static EfficiencyPanelViewModel NewViewModel(params RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>[] emissions) =>
        new(new FakeEfficiencyPanelSource(emissions), Localizer, () => Now);

    private sealed class FakeEfficiencyPanelSource(params RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>[] emissions) : IEfficiencyPanelSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<EfficiencyPanelSession>>> StreamAsync(
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
