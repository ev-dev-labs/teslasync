using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the rate-limit status surface's UI-thread-free logic — the JSON parse adapters
/// (ScopeBudget / snapshot), the cache-then-network result mapper, the projection (severity → token status,
/// the live-snapshot vs windowed label, the "current / limit" usage label, the future-only "Refills in …"
/// reset countdown, the em-dash detail handling, the Narrator names and the relative "Updated {when}"
/// caption), the <c>formatDurationMsLong</c> port, the repository source's request shape, the state-holder
/// view-model's state matrix (loading / loaded / empty / error / stale / offline), the refresh flow, the
/// registry metadata and the diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/RateLimitStatusPanel.tsx).
/// </summary>
public sealed class RateLimitStatusPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // ---- ScopeBudget parse adapter -------------------------------------------------

    [Fact]
    public void Scope_parses_real_api_fields()
    {
        const string json = """
        [{"id":"tesla.fleet_api.burst","name":"Tesla burst","current":1,"limit":5,"window_seconds":0,
          "reset_at":"2026-06-06T12:05:00Z","severity":"ok","detail":"token bucket"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var scope = Assert.Single(ScopeBudget.ParseList(doc.RootElement));

        Assert.Equal("tesla.fleet_api.burst", scope.Id);
        Assert.Equal("Tesla burst", scope.Name);
        Assert.Equal(1, scope.Current);
        Assert.Equal(5, scope.Limit);
        Assert.Equal(0, scope.WindowSeconds);
        Assert.Equal("token bucket", scope.Detail);
        Assert.Equal(RateLimitSeverity.Ok, scope.Severity);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 12, 5, 0, TimeSpan.Zero), scope.ResetInstant);
    }

    [Fact]
    public void Scope_is_tolerant_of_missing_fields_and_non_array()
    {
        using var partial = JsonDocument.Parse("""[{"id":"x"}]""");
        var scope = Assert.Single(ScopeBudget.ParseList(partial.RootElement));
        Assert.Equal("x", scope.Id);
        Assert.Equal(string.Empty, scope.Name);
        Assert.Equal(0, scope.Current);
        Assert.Equal(0, scope.Limit);
        Assert.Null(scope.ResetAt);
        Assert.Null(scope.Detail);
        Assert.Equal(RateLimitSeverity.Ok, scope.Severity);

        using var notArray = JsonDocument.Parse("{}");
        Assert.Empty(ScopeBudget.ParseList(notArray.RootElement));
    }

    [Fact]
    public void Scope_severity_maps_ok_warn_critical_and_unknown()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":"a","severity":"warn"},{"id":"b","severity":"critical"},{"id":"c","severity":"ok"},{"id":"d","severity":"???"},{"id":"e"}]""");
        var list = ScopeBudget.ParseList(doc.RootElement);

        Assert.Equal(RateLimitSeverity.Warn, list[0].Severity);
        Assert.Equal(RateLimitSeverity.Critical, list[1].Severity);
        Assert.Equal(RateLimitSeverity.Ok, list[2].Severity);
        Assert.Equal(RateLimitSeverity.Ok, list[3].Severity);
        Assert.Equal(RateLimitSeverity.Ok, list[4].Severity);
    }

    [Fact]
    public void Snapshot_parses_envelope_and_tolerates_non_object()
    {
        using var doc = JsonDocument.Parse(
            """{"generated_at":"2026-06-06T11:55:00Z","scopes":[{"id":"a","severity":"ok"}]}""");
        var snap = RateLimitStatusSnapshot.FromJson(doc.RootElement);
        Assert.Equal("2026-06-06T11:55:00Z", snap.GeneratedAt);
        Assert.Single(snap.Scopes);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 11, 55, 0, TimeSpan.Zero), snap.GeneratedAtInstant);

        using var notObject = JsonDocument.Parse("[]");
        Assert.Empty(RateLimitStatusSnapshot.FromJson(notObject.RootElement).Scopes);
    }

    // ---- formatDurationMsLong port -------------------------------------------------

    [Theory]
    [InlineData(500, "500ms")]
    [InlineData(5000, "5.0s")]
    [InlineData(59000, "59.0s")]
    [InlineData(60000, "1m 0s")]
    [InlineData(90000, "1m 30s")]
    [InlineData(125000, "2m 5s")]
    [InlineData(3600000, "60m 0s")]
    public void Duration_formats_like_web(double ms, string expected) =>
        Assert.Equal(expected, RateLimitDuration.FormatMsLong(ms));

    [Fact]
    public void Duration_non_positive_or_non_finite_is_em_dash()
    {
        Assert.Equal("\u2014", RateLimitDuration.FormatMsLong(0));
        Assert.Equal("\u2014", RateLimitDuration.FormatMsLong(-5));
        Assert.Equal("\u2014", RateLimitDuration.FormatMsLong(double.NaN));
        Assert.Equal("\u2014", RateLimitDuration.FormatMsLong(double.PositiveInfinity));
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_maps_severity_to_token_status_and_brush()
    {
        var display = RateLimitStatusProjection.Project(
            new[]
            {
                Scope("ok", 1, 5, RateLimitSeverity.Ok, window: 0),
                Scope("warn", 350, 600, RateLimitSeverity.Warn),
                Scope("critical", 110, 120, RateLimitSeverity.Critical),
            },
            Localizer,
            Now);

        Assert.Equal(StatusKind.Success, display.Rows[0].SeverityStatus);
        Assert.Equal("TsColorSuccessBrush", display.Rows[0].AccentBrushKey);
        Assert.Equal(StatusKind.Warning, display.Rows[1].SeverityStatus);
        Assert.Equal("TsColorWarningBrush", display.Rows[1].AccentBrushKey);
        Assert.Equal(StatusKind.Danger, display.Rows[2].SeverityStatus);
        Assert.Equal("TsColorDangerBrush", display.Rows[2].AccentBrushKey);
    }

    [Fact]
    public void Project_window_label_is_live_snapshot_or_windowed()
    {
        var display = RateLimitStatusProjection.Project(
            new[] { Scope("a", 1, 5, RateLimitSeverity.Ok, window: 0), Scope("b", 1, 5, RateLimitSeverity.Ok, window: 60) },
            Localizer,
            Now);

        Assert.Equal("Live snapshot", display.Rows[0].WindowLabel);
        Assert.Equal("Last 60s window", display.Rows[1].WindowLabel);
    }

    [Fact]
    public void Project_usage_label_formats_counts_with_grouping()
    {
        var display = RateLimitStatusProjection.Project(
            new[] { Scope("a", 350, 600, RateLimitSeverity.Warn), Scope("b", 1500, 2000, RateLimitSeverity.Critical) },
            Localizer,
            Now);

        Assert.Equal("350 / 600", display.Rows[0].UsageLabel);
        Assert.Equal("1,500 / 2,000", display.Rows[1].UsageLabel);
    }

    [Fact]
    public void Project_bar_max_falls_back_to_one_when_limit_is_zero()
    {
        var display = RateLimitStatusProjection.Project(
            new[] { Scope("a", 0, 0, RateLimitSeverity.Ok) },
            Localizer,
            Now);

        Assert.Equal(1, display.Rows[0].Max);
    }

    [Fact]
    public void Project_reset_label_only_renders_for_a_future_reset()
    {
        var display = RateLimitStatusProjection.Project(
            new[]
            {
                Scope("future", 1, 5, RateLimitSeverity.Ok, window: 0, reset: Iso(Now.AddSeconds(90))),
                Scope("past", 1, 5, RateLimitSeverity.Ok, window: 0, reset: Iso(Now.AddSeconds(-90))),
                Scope("none", 1, 5, RateLimitSeverity.Ok, window: 0),
            },
            Localizer,
            Now);

        Assert.Equal("Refills in 1m 30s", display.Rows[0].ResetLabel);
        Assert.Null(display.Rows[1].ResetLabel);
        Assert.Null(display.Rows[2].ResetLabel);
    }

    [Fact]
    public void Project_severity_label_resolves_through_the_facade()
    {
        var display = RateLimitStatusProjection.Project(
            new[]
            {
                Scope("a", 1, 5, RateLimitSeverity.Ok, window: 0),
                Scope("b", 1, 5, RateLimitSeverity.Warn, window: 0),
                Scope("c", 1, 5, RateLimitSeverity.Critical, window: 0),
            },
            Localizer,
            Now);

        Assert.Equal("Healthy", display.Rows[0].SeverityLabel);
        Assert.Equal("Warning", display.Rows[1].SeverityLabel);
        Assert.Equal("Critical", display.Rows[2].SeverityLabel);
    }

    [Fact]
    public void Project_detail_passes_through_and_blanks_collapse_to_null()
    {
        var display = RateLimitStatusProjection.Project(
            new[]
            {
                Scope("a", 1, 5, RateLimitSeverity.Ok, window: 0, detail: "operator footnote"),
                Scope("b", 1, 5, RateLimitSeverity.Ok, window: 0, detail: "   "),
                Scope("c", 1, 5, RateLimitSeverity.Ok, window: 0),
            },
            Localizer,
            Now);

        Assert.Equal("operator footnote", display.Rows[0].Detail);
        Assert.Null(display.Rows[1].Detail);
        Assert.Null(display.Rows[2].Detail);
    }

    [Fact]
    public void Project_rows_carry_descriptive_non_empty_automation_names()
    {
        var display = RateLimitStatusProjection.Project(
            new[] { Scope("api.write.minute", 110, 120, RateLimitSeverity.Critical, window: 60) },
            Localizer,
            Now);

        string name = display.Rows[0].AutomationName;
        Assert.False(string.IsNullOrWhiteSpace(name));
        Assert.Contains("api.write.minute", name);
        Assert.Contains("Critical", name);
        Assert.Contains("110 / 120", name);
        Assert.Contains("Last 60s window", name);
    }

    [Fact]
    public void UpdatedLabel_is_null_without_a_timestamp_and_relative_with_one()
    {
        Assert.Null(RateLimitStatusProjection.UpdatedLabel(null, Localizer, Now));
        Assert.Equal("Updated 5m ago", RateLimitStatusProjection.UpdatedLabel(Now.AddMinutes(-5), Localizer, Now));
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_passes_through_transient_and_terminal_status()
    {
        Assert.Equal(LoadStatus.Loading, RateLimitStatusResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);
        Assert.Equal(LoadStatus.Empty, RateLimitStatusResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);
        Assert.Equal(
            LoadStatus.Error,
            RateLimitStatusResultMapper.Map(
                RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void Mapper_loaded_carries_snapshot_even_when_scopes_empty()
    {
        using var doc = JsonDocument.Parse("""{"generated_at":"2026-06-06T11:55:00Z","scopes":[]}""");
        var mapped = RateLimitStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement.Clone(), Now));

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.NotNull(mapped.Value);
        Assert.Empty(mapped.Value!.Scopes);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 11, 55, 0, TimeSpan.Zero), mapped.Value!.GeneratedAtInstant);
    }

    [Fact]
    public void Mapper_cached_preserves_stale_flag_and_offline_carries_rows()
    {
        using var doc = JsonDocument.Parse("""{"scopes":[{"id":"a","severity":"ok"}]}""");

        var cached = RateLimitStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement.Clone(), Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);

        var offline = RateLimitStatusResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(
                doc.RootElement.Clone(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!.Scopes);
    }

    // ---- View-model: state matrix --------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_loading()
    {
        using var vm = new RateLimitStatusViewModel(new FakeSource(), Localizer, () => Now);
        Assert.Equal(RateLimitPanelState.Loading, vm.State);
        Assert.False(vm.Display.HasRows);
    }

    [Fact]
    public async Task ViewModel_loaded_renders_one_row_per_scope()
    {
        using var vm = NewViewModel(Loaded(Snapshot(
            "2026-06-06T11:58:00Z",
            Scope("a", 1, 5, RateLimitSeverity.Ok, window: 0),
            Scope("b", 350, 600, RateLimitSeverity.Warn),
            Scope("c", 110, 120, RateLimitSeverity.Critical))));

        await vm.LoadAsync();

        Assert.Equal(RateLimitPanelState.Loaded, vm.State);
        Assert.Equal(3, vm.Display.Rows.Count);
        Assert.Equal("Updated 2m ago", vm.UpdatedLabel);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public async Task ViewModel_empty_when_scopes_empty_but_keeps_updated_caption()
    {
        using var vm = NewViewModel(Loaded(Snapshot("2026-06-06T11:55:00Z")));

        await vm.LoadAsync();

        Assert.Equal(RateLimitPanelState.Empty, vm.State);
        Assert.False(vm.Display.HasRows);
        Assert.Equal("Updated 5m ago", vm.UpdatedLabel);
        Assert.StartsWith("No rate-limited resources", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_error_with_no_cache()
    {
        using var vm = NewViewModel(
            RepositoryResult<RateLimitStatusSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.Equal(RateLimitPanelState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_keeps_rows()
    {
        using var vm = NewViewModel(RepositoryResult<RateLimitStatusSnapshot>.Cached(
            Snapshot("2026-06-06T11:50:00Z", Scope("a", 1, 5, RateLimitSeverity.Ok, window: 0)), Now, stale: true));

        await vm.LoadAsync();

        Assert.Equal(RateLimitPanelState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasRows);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_rows_and_sets_error_chip()
    {
        using var vm = NewViewModel(RepositoryResult<RateLimitStatusSnapshot>.OfflineCached(
            Snapshot("2026-06-06T11:50:00Z", Scope("a", 1, 5, RateLimitSeverity.Ok, window: 0)),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.Equal(RateLimitPanelState.Offline, vm.State);
        Assert.True(vm.Display.HasRows);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_and_increments_attempts()
    {
        using var vm = NewViewModel(Loaded(Snapshot("2026-06-06T11:58:00Z", Scope("a", 1, 5, RateLimitSeverity.Ok, window: 0))));
        await vm.LoadAsync();
        Assert.Equal(1, vm.Attempts);

        await vm.RefreshAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.Equal(RateLimitPanelState.Loaded, vm.State);
        Assert.False(vm.IsRefreshing);
        Assert.False(vm.IsFetching);
    }

    [Fact]
    public void ViewModel_exposes_localized_copy_through_the_facade()
    {
        using var vm = new RateLimitStatusViewModel(new FakeSource(), Localizer, () => Now);

        Assert.Equal("Rate-limit budgets", vm.Title);
        Assert.Equal("Refresh", vm.RefreshLabel);
        Assert.Equal("Refresh", vm.RetryLabel);
        Assert.Equal("Loading rate-limit status\u2026", vm.LoadingLabel);
        Assert.StartsWith("No rate-limited resources", vm.EmptyMessage);
        Assert.StartsWith("Could not load rate-limit status", vm.ErrorMessageDefault);
    }

    // ---- Repository source request shape -------------------------------------------

    [Fact]
    public async Task Source_streams_status_and_targets_the_generated_operation()
    {
        using var doc = JsonDocument.Parse(
            """{"generated_at":"2026-06-06T11:55:00Z","scopes":[{"id":"a","name":"A","current":1,"limit":5,"window_seconds":0,"severity":"ok"}]}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamStatusAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Single(emissions[^1].Value!.Scopes);
        Assert.Equal("get_api_v1_system_rate_limits", client.Requests[^1].OperationId);
        Assert.Equal(RateLimitStatusSource.StatusOperation, client.Requests[^1].OperationId);
        Assert.Null(client.Requests[^1].Query);
    }

    [Fact]
    public async Task Source_treats_a_non_object_body_as_empty()
    {
        using var doc = JsonDocument.Parse("null");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamStatusAsync());

        Assert.Equal(LoadStatus.Empty, emissions[^1].Status);
    }

    // ---- Registry + diagnostics ----------------------------------------------------

    [Fact]
    public void Registration_exposes_stable_id_slug_and_localized_copy()
    {
        Assert.Equal("rate-limit-status-panel", RateLimitStatusRegistration.Id);
        Assert.Equal("RateLimitStatusPanel", RateLimitStatusRegistration.Slug);
        Assert.Equal("Rate-limit budgets", RateLimitStatusRegistration.Title(Localizer));
        Assert.StartsWith("Live view of every server-side throttle", RateLimitStatusRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new RateLimitStatusDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RateLimitStatusPanel", Assert.Single(sink));
    }

    // ---- helpers -------------------------------------------------------------------

    private static RateLimitStatusViewModel NewViewModel(params RepositoryResult<RateLimitStatusSnapshot>[] results) =>
        new(new FakeSource(results), Localizer, () => Now);

    private static RateLimitStatusSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new RateLimitStatusSource(client, engine, options);
    }

    private static async Task<IReadOnlyList<RepositoryResult<RateLimitStatusSnapshot>>> Collect(
        IAsyncEnumerable<RepositoryResult<RateLimitStatusSnapshot>> stream)
    {
        var list = new List<RepositoryResult<RateLimitStatusSnapshot>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private static RepositoryResult<RateLimitStatusSnapshot> Loaded(RateLimitStatusSnapshot snapshot) =>
        RepositoryResult<RateLimitStatusSnapshot>.Loaded(snapshot, Now);

    private static RateLimitStatusSnapshot Snapshot(string? generatedAt, params ScopeBudget[] scopes) =>
        new(generatedAt, scopes);

    private static ScopeBudget Scope(
        string id,
        double current,
        double limit,
        RateLimitSeverity severity,
        long window = 60,
        string? reset = null,
        string? detail = null) =>
        new(id, id, current, limit, window, reset, severity, detail);

    private static string Iso(DateTimeOffset value) =>
        value.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture);

    private sealed class FakeSource : IRateLimitStatusSource
    {
        private readonly IReadOnlyList<RepositoryResult<RateLimitStatusSnapshot>> _results;

        public FakeSource(params RepositoryResult<RateLimitStatusSnapshot>[] results) => _results = results;

        public async IAsyncEnumerable<RepositoryResult<RateLimitStatusSnapshot>> StreamStatusAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var result in _results)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
                await Task.Yield();
            }
        }
    }
}
