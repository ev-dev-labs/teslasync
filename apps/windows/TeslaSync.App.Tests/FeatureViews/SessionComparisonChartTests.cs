using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the SessionComparisonChart's UI-thread-free logic — the charging-session JSON
/// parse adapter, the curve simulation + charger classification (ported from the web helpers), the
/// projection (overlay series, names, palette indices, axis labels, accessibility), the cache-then-network
/// result mapper, the registration metadata, the diagnostics, and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/charging/components/charging-curve/SessionComparisonChart.tsx).
/// </summary>
public sealed class SessionComparisonChartTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_session_fields()
    {
        const string json = """
        {
          "id": 42,
          "start_soc_pct": 20,
          "end_soc_pct": 80,
          "peak_power_w": 150000,
          "charger_type": "Tesla",
          "started_at": "2026-01-15T08:30:00Z"
        }
        """;
        using var doc = JsonDocument.Parse(json);

        var s = SessionComparisonSession.FromJson(doc.RootElement);

        Assert.Equal(42, s.Id);
        Assert.Equal(20, s.StartSocPct);
        Assert.Equal(80, s.EndSocPct);
        Assert.Equal(150000, s.PeakPowerW);
        Assert.Equal("Tesla", s.ChargerType);
        Assert.NotNull(s.StartedAt);
    }

    [Fact]
    public void ParseList_reads_array_and_preserves_order()
    {
        const string json = """
        [ {"id":1,"start_soc_pct":10}, {"id":2,"start_soc_pct":20} ]
        """;
        using var doc = JsonDocument.Parse(json);

        var list = SessionComparisonSession.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].Id);
        Assert.Equal(2, list[1].Id);
    }

    [Fact]
    public void ParseList_tolerates_missing_fields_and_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""[ {"id":"7","peak_power_w":"25000"} ]""");

        var list = SessionComparisonSession.ParseList(doc.RootElement);

        Assert.Single(list);
        Assert.Equal(7, list[0].Id);
        Assert.Null(list[0].StartSocPct);
        Assert.Null(list[0].EndSocPct);
        Assert.Equal(25000, list[0].PeakPowerW);
        Assert.Null(list[0].ChargerType);
        Assert.Null(list[0].StartedAt);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"id":1}""");
        Assert.Empty(SessionComparisonSession.ParseList(doc.RootElement));
    }

    // ---- Charger classification (web getChargerLabel / isDcSession) -----------------

    [Theory]
    [InlineData("Tesla", null, SessionChargerKind.Supercharger)]
    [InlineData("Tesla Supercharger", null, SessionChargerKind.Supercharger)]
    [InlineData("CCS", null, SessionChargerKind.DcFast)]
    [InlineData(null, 25000.0, SessionChargerKind.DcFast)]
    [InlineData(null, 11000.0, SessionChargerKind.HomeAc)]
    [InlineData("", 11000.0, SessionChargerKind.HomeAc)]
    public void ClassifyCharger_matches_web_heuristic(string? chargerType, double? peakW, SessionChargerKind expected)
    {
        var s = Session(chargerType: chargerType, peakW: peakW);
        Assert.Equal(expected, SessionComparisonProjection.ClassifyCharger(s));
    }

    [Theory]
    [InlineData("CCS", null, true)]
    [InlineData(null, 25000.0, true)]
    [InlineData(null, 20000.0, false)]
    [InlineData(null, 11000.0, false)]
    public void IsDcSession_matches_web_heuristic(string? chargerType, double? peakW, bool expected)
    {
        var s = Session(chargerType: chargerType, peakW: peakW);
        Assert.Equal(expected, SessionComparisonProjection.IsDcSession(s));
    }

    // ---- Curve generation (web generateChargingCurve) ------------------------------

    [Fact]
    public void GenerateCurve_ac_session_is_flat_at_peak()
    {
        var s = Session(startSoc: 10, endSoc: 12, peakW: 11000); // AC: no charger type, peak below threshold
        var curve = SessionComparisonProjection.GenerateCurve(s);

        Assert.Equal(3, curve.Count); // 10, 11, 12
        Assert.All(curve, p => Assert.Equal(11.0, p.PowerKw));
        Assert.Equal(10, curve[0].Soc);
        Assert.Equal(12, curve[^1].Soc);
    }

    [Fact]
    public void GenerateCurve_default_peak_is_11kw()
    {
        var s = Session(startSoc: 50, endSoc: 50, peakW: null); // AC, default peak 11_000 W
        var curve = SessionComparisonProjection.GenerateCurve(s);
        Assert.Single(curve);
        Assert.Equal(11.0, curve[0].PowerKw);
    }

    [Fact]
    public void GenerateCurve_dc_session_holds_then_tapers_then_drops()
    {
        var s = Session(chargerType: "CCS", startSoc: 40, endSoc: 90, peakW: 100000); // DC, 100 kW peak
        var curve = SessionComparisonProjection.GenerateCurve(s);

        Assert.Equal(100.0, PowerAt(curve, 50)); // hold to 50%
        Assert.Equal(50.0, PowerAt(curve, 80));  // taper end: 100 * (1 - 0.5)
        Assert.Equal(32.5, PowerAt(curve, 90));  // drop: 100 * 0.5 * (1 - 0.35)
    }

    [Fact]
    public void GenerateCurve_is_empty_when_start_above_end()
    {
        var s = Session(startSoc: 80, endSoc: 20);
        Assert.Empty(SessionComparisonProjection.GenerateCurve(s));
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_takes_first_ten_sessions()
    {
        var sessions = new List<SessionComparisonSession>();
        for (int i = 0; i < 14; i++)
        {
            sessions.Add(Session(startSoc: 10, endSoc: 60));
        }

        var view = SessionComparisonProjection.Project(sessions, Localizer, Now);

        Assert.Equal(SessionComparisonRegistration.WindowLimit, view.Series.Count);
        Assert.True(view.HasData);
    }

    [Fact]
    public void Project_assigns_cycling_palette_indices_and_names()
    {
        var sessions = new[]
        {
            Session(chargerType: "Tesla", startSoc: 10, endSoc: 60),
            Session(startSoc: 10, endSoc: 60),
        };

        var view = SessionComparisonProjection.Project(sessions, Localizer, Now);

        Assert.Equal(0, view.Series[0].ColorIndex);
        Assert.Equal(1, view.Series[1].ColorIndex);
        Assert.Equal("Supercharger", view.Series[0].ChargerLabel);
        Assert.Equal("Home / AC", view.Series[1].ChargerLabel);
        // Web <Line> name = `${date} (${chargerLabel})`; null started_at falls back to "#index".
        Assert.Equal("#1 (Supercharger)", view.Series[0].Name);
        Assert.Equal("#2 (Home / AC)", view.Series[1].Name);
    }

    [Fact]
    public void Project_empty_when_no_sessions()
    {
        var view = SessionComparisonProjection.Project(Array.Empty<SessionComparisonSession>(), Localizer, Now);

        Assert.False(view.HasData);
        Assert.Empty(view.Series);
        Assert.Equal("No charging sessions to plot a curve.", view.EmptyMessage);
    }

    [Fact]
    public void Project_empty_when_every_curve_is_empty()
    {
        var sessions = new[] { Session(startSoc: 90, endSoc: 10) }; // start above end -> empty curve
        var view = SessionComparisonProjection.Project(sessions, Localizer, Now);
        Assert.False(view.HasData);
    }

    [Fact]
    public void Project_uses_started_at_for_date_label_when_present()
    {
        var s = Session(startSoc: 10, endSoc: 60, startedAt: new DateTimeOffset(2026, 1, 15, 8, 0, 0, TimeSpan.Zero));
        var view = SessionComparisonProjection.Project(new[] { s }, Localizer, Now);

        Assert.False(string.IsNullOrWhiteSpace(view.Series[0].DateLabel));
        Assert.DoesNotContain('#', view.Series[0].DateLabel); // a real date, not the #index fallback
    }

    [Fact]
    public void Project_exposes_axis_labels_and_aria()
    {
        var view = SessionComparisonProjection.Project(Array.Empty<SessionComparisonSession>(), Localizer, Now);

        Assert.Equal("Session Comparison", view.Title);
        Assert.Equal("Power curves overlaid from last 10 sessions", view.Subtitle);
        Assert.Equal("SOC (%)", view.SocAxisLabel);
        Assert.Equal("Power (kW)", view.PowerAxisLabel);
        Assert.Equal(view.AriaLabel, view.AutomationName);
        Assert.False(string.IsNullOrWhiteSpace(view.AriaLabel));
    }

    [Fact]
    public void ToChartSeries_carries_points_unit_and_color()
    {
        var s = Session(chargerType: "CCS", startSoc: 40, endSoc: 90, peakW: 100000);
        var view = SessionComparisonProjection.Project(new[] { s }, Localizer, Now);

        IReadOnlyList<ChartSeries> series = view.ToChartSeries();

        Assert.Single(series);
        Assert.Equal(SessionComparisonProjection.PowerUnit, series[0].Unit);
        Assert.Equal(0, series[0].ColorIndex);
        Assert.Equal(ChartSeriesKind.Line, series[0].Kind);
        Assert.NotEmpty(series[0].Points);
        Assert.Contains(series[0].Points, p => p.X == 50 && p.Y == 100.0);
    }

    // ---- i18n: every label resolves through its catalog key -------------------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();
        var view = SessionComparisonProjection.Project(
            new[] { Session(chargerType: "Tesla", startSoc: 10, endSoc: 60) }, echo, Now);

        Assert.Equal("L:charging.curve.sessionComparison", view.Title);
        Assert.Equal("L:charging.curve.sessionComparisonDesc", view.Subtitle);
        Assert.Equal("L:charging.curve.sessionComparison.aria", view.AriaLabel);
        Assert.Equal("L:charging.curve.socPercent", view.SocAxisLabel);
        Assert.Equal("L:charging.curve.powerKw", view.PowerAxisLabel);
        Assert.Equal("L:charging.curve.empty", view.EmptyMessage);
        Assert.Equal("L:charging.curve.charger.supercharger", view.Series[0].ChargerLabel);
    }

    // ---- a11y: every overlay carries a spoken label --------------------------------

    [Fact]
    public void Every_series_carries_a_non_empty_name_and_labels()
    {
        var view = SessionComparisonProjection.Project(
            new[]
            {
                Session(chargerType: "Tesla", startSoc: 10, endSoc: 60),
                Session(startSoc: 10, endSoc: 60),
            },
            Localizer,
            Now);

        Assert.All(view.Series, s =>
        {
            Assert.False(string.IsNullOrWhiteSpace(s.Name));
            Assert.False(string.IsNullOrWhiteSpace(s.DateLabel));
            Assert.False(string.IsNullOrWhiteSpace(s.ChargerLabel));
        });
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_value()
    {
        using var doc = JsonDocument.Parse("""[ {"id":1,"start_soc_pct":10,"end_soc_pct":60} ]""");

        var cached = SessionComparisonResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = SessionComparisonResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void Mapper_maps_loading_empty_and_failure()
    {
        Assert.Equal(LoadStatus.Loading, SessionComparisonResultMapper.Map(
            RepositoryResult<JsonElement>.Loading()).Status);

        Assert.Equal(LoadStatus.Empty, SessionComparisonResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, SessionComparisonResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SessionComparisonSession>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SessionComparisonState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_series()
    {
        using var vm = NewViewModel(Loaded(Sessions(Session(chargerType: "Tesla", startSoc: 10, endSoc: 60))));
        await vm.LoadAsync();

        Assert.Equal(SessionComparisonState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Single(vm.Display.Series);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_plottable_data_renders_empty()
    {
        using var vm = NewViewModel(Loaded(Sessions())); // no sessions
        await vm.LoadAsync();

        Assert.Equal(SessionComparisonState.Empty, vm.State);
        Assert.False(vm.HasData);
        // Even empty, the surface keeps the friendly message (never a blank box).
        Assert.Equal("No charging sessions to plot a curve.", vm.Display.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SessionComparisonSession>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SessionComparisonState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<SessionComparisonSession>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SessionComparisonState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SessionComparisonSession>>.Cached(
            Sessions(Session(startSoc: 10, endSoc: 60)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SessionComparisonState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SessionComparisonSession>>.OfflineCached(
            Sessions(Session(startSoc: 10, endSoc: 60)),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SessionComparisonState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<SessionComparisonSession>>.Loading(),
            RepositoryResult<IReadOnlyList<SessionComparisonSession>>.Cached(
                Sessions(Session(startSoc: 10, endSoc: 60)), Now, stale: false),
            RepositoryResult<IReadOnlyList<SessionComparisonSession>>.Loaded(
                Sessions(Session(chargerType: "Tesla", startSoc: 10, endSoc: 60)), Now));
        await vm.LoadAsync();

        Assert.Equal(SessionComparisonState.Loaded, vm.State);
        Assert.Equal("Supercharger", vm.Display.Series[0].ChargerLabel);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SessionComparisonSession>>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Session Comparison", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Sessions(Session(startSoc: 10, endSoc: 60))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SessionComparisonViewModel.State), changed);
        Assert.Contains(nameof(SessionComparisonViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("session-comparison-chart", SessionComparisonRegistration.Id);
        Assert.Equal("charging", SessionComparisonRegistration.Category);
        Assert.Equal("SessionComparisonChart", SessionComparisonRegistration.Slug);
        Assert.Equal(10, SessionComparisonRegistration.WindowLimit);
        Assert.Equal("Session Comparison", SessionComparisonRegistration.Name(Localizer));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SessionComparisonDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SessionComparisonChart", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static SessionComparisonSession Session(
        long id = 1,
        double? startSoc = null,
        double? endSoc = null,
        double? peakW = null,
        string? chargerType = null,
        DateTimeOffset? startedAt = null) =>
        new(id, startSoc, endSoc, peakW, chargerType, startedAt);

    private static IReadOnlyList<SessionComparisonSession> Sessions(params SessionComparisonSession[] sessions) =>
        sessions;

    private static double PowerAt(IReadOnlyList<SessionCurvePoint> curve, int soc)
    {
        foreach (var p in curve)
        {
            if (p.Soc == soc)
            {
                return p.PowerKw;
            }
        }

        throw new InvalidOperationException(
            string.Create(CultureInfo.InvariantCulture, $"no curve point at soc={soc}"));
    }

    private static RepositoryResult<IReadOnlyList<SessionComparisonSession>> Loaded(IReadOnlyList<SessionComparisonSession> data) =>
        RepositoryResult<IReadOnlyList<SessionComparisonSession>>.Loaded(data, Now);

    private static SessionComparisonViewModel NewViewModel(params RepositoryResult<IReadOnlyList<SessionComparisonSession>>[] emissions) =>
        new(new FakeSessionComparisonSource(emissions), Localizer, () => Now);

    private sealed class FakeSessionComparisonSource(params RepositoryResult<IReadOnlyList<SessionComparisonSession>>[] emissions) : ISessionComparisonSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SessionComparisonSession>>> StreamAsync(
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
