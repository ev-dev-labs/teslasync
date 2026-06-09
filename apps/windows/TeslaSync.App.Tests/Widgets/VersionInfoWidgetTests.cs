using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the VersionInfoWidget's UI-thread-free logic — the two JSON parse adapters (the
/// useVersionInfo / useCaptureStats reads), the projection (em-dash fallbacks, seven-char SHA truncation, the
/// KV-row weights, the human byte formatting, the signals / messages / latency readouts, the compact / wide
/// footprint flags, the Narrator name), the version-driven two-source combine mapper, the concurrent server-wide
/// data source (the two reads), the registry metadata, the diagnostics, and the state-holder view-model's
/// per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/VersionInfoWidget.tsx).
/// </summary>
public sealed class VersionInfoWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private const string EmDash = "\u2014";

    private const string VersionJson =
        """{"chart_version":"v2.5.0","go_version":"go1.25.1","build_date":"2026-06-01","git_commit":"abcdef1234567890","uptime":"3d 4h","os":"linux","arch":"amd64","endpoints":{}}""";

    private const string CaptureJson =
        """{"signals_per_sec":12.5,"messages_today":84210,"bytes_processed":5242880,"avg_processing_latency_ms":4.2,"mongodb_enabled":true}""";

    private const string CaptureStatsOperation = "get_api_v1_dev_tools_telemetry_capture_stats";

    // ---- Parse adapters (web hook reads) -------------------------------------------

    [Fact]
    public void ParseVersion_reads_every_consumed_field()
    {
        using var doc = JsonDocument.Parse(VersionJson);
        var snap = VersionSnapshot.Parse(doc.RootElement);

        Assert.NotNull(snap);
        Assert.Equal("v2.5.0", snap!.ChartVersion);
        Assert.Equal("go1.25.1", snap.GoVersion);
        Assert.Equal("2026-06-01", snap.BuildDate);
        Assert.Equal("abcdef1234567890", snap.GitCommit);
        Assert.Equal("3d 4h", snap.Uptime);
        Assert.Equal("linux", snap.Os);
        Assert.Equal("amd64", snap.Arch);
    }

    [Fact]
    public void ParseVersion_empty_object_yields_snapshot_with_null_fields()
    {
        using var doc = JsonDocument.Parse("{}");
        var snap = VersionSnapshot.Parse(doc.RootElement);

        Assert.NotNull(snap);
        Assert.Null(snap!.ChartVersion);
        Assert.Null(snap.GitCommit);
        Assert.Null(snap.Os);
    }

    [Theory]
    [InlineData("5")]
    [InlineData("null")]
    [InlineData("\"x\"")]
    [InlineData("[]")]
    public void ParseVersion_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(VersionSnapshot.Parse(doc.RootElement));
    }

    [Fact]
    public void ParseCapture_reads_numeric_fields()
    {
        using var doc = JsonDocument.Parse(CaptureJson);
        var snap = CaptureSnapshot.Parse(doc.RootElement);

        Assert.NotNull(snap);
        Assert.Equal(12.5, snap!.SignalsPerSec!.Value);
        Assert.Equal(84210d, snap.MessagesToday!.Value);
        Assert.Equal(5242880d, snap.BytesProcessed!.Value);
        Assert.Equal(4.2, snap.AvgLatencyMs!.Value);
    }

    [Fact]
    public void ParseCapture_absent_fields_are_null()
    {
        using var doc = JsonDocument.Parse("""{"signals_per_sec":1}""");
        var snap = CaptureSnapshot.Parse(doc.RootElement);

        Assert.Equal(1d, snap!.SignalsPerSec!.Value);
        Assert.Null(snap.MessagesToday);
        Assert.Null(snap.BytesProcessed);
        Assert.Null(snap.AvgLatencyMs);
    }

    [Theory]
    [InlineData("5")]
    [InlineData("null")]
    [InlineData("[]")]
    public void ParseCapture_returns_null_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Null(CaptureSnapshot.Parse(doc.RootElement));
    }

    [Fact]
    public void JsonReadText_handles_string_number_empty_bool_and_absent()
    {
        using var doc = JsonDocument.Parse("""{"s":"hi","n":12,"e":"","b":true}""");
        var root = doc.RootElement;

        Assert.Equal("hi", VersionInfoJson.ReadText(root, "s"));
        Assert.Equal("12", VersionInfoJson.ReadText(root, "n"));
        Assert.Null(VersionInfoJson.ReadText(root, "e"));
        Assert.Null(VersionInfoJson.ReadText(root, "b"));
        Assert.Null(VersionInfoJson.ReadText(root, "missing"));
    }

    [Fact]
    public void JsonReadDouble_handles_number_integer_string_and_absent()
    {
        using var doc = JsonDocument.Parse("""{"d":1.5,"i":3,"s":"x"}""");
        var root = doc.RootElement;

        Assert.Equal(1.5, VersionInfoJson.ReadDouble(root, "d"));
        Assert.Equal(3d, VersionInfoJson.ReadDouble(root, "i"));
        Assert.Null(VersionInfoJson.ReadDouble(root, "s"));
        Assert.Null(VersionInfoJson.ReadDouble(root, "missing"));
    }

    // ---- Projection (the full body the view renders) --------------------------------

    [Fact]
    public void Project_full_default_maps_kv_and_two_stats()
    {
        var display = VersionInfoProjection.Project(FullReading(), VersionInfoRegistration.DefaultSize, Localizer);

        Assert.True(display.HasData);
        Assert.False(display.IsCompact);
        Assert.False(display.IsWide);
        Assert.False(display.ShowOsArch);
        Assert.Equal(2, display.StatColumns);
        Assert.Equal("v2.5.0", display.ChartVersion);
        Assert.Equal("abcdef1", display.TruncatedSha);
        Assert.Equal(5, display.KvRows.Count);
        Assert.Equal(2, display.Stats.Count);
        Assert.Equal("Signals/sec", display.Stats[0].Label);
        Assert.Equal("12.5", display.Stats[0].Value);
        Assert.Equal("Messages Today", display.Stats[1].Label);
        Assert.Equal("84,210", display.Stats[1].Value);
    }

    [Fact]
    public void Project_kv_rows_carry_label_value_and_weight()
    {
        var rows = VersionInfoProjection.Project(FullReading(), VersionInfoRegistration.DefaultSize, Localizer).KvRows;

        AssertRow(rows[0], "Version", "v2.5.0", VersionValueStyle.Bold);
        AssertRow(rows[1], "Build Date", "2026-06-01", VersionValueStyle.Normal);
        AssertRow(rows[2], "Git SHA", "abcdef1", VersionValueStyle.Mono);
        AssertRow(rows[3], "Go Version", "go1.25.1", VersionValueStyle.Normal);
        AssertRow(rows[4], "Uptime", "3d 4h", VersionValueStyle.Normal);
    }

    [Fact]
    public void Project_wide_adds_osarch_and_four_stats()
    {
        var display = VersionInfoProjection.Project(FullReading(), new VersionInfoSize(4, 4), Localizer);

        Assert.True(display.IsWide);
        Assert.True(display.ShowOsArch);
        Assert.Equal(4, display.StatColumns);
        Assert.Equal("linux", display.OsValue);
        Assert.Equal("amd64", display.ArchValue);
        Assert.Equal(4, display.Stats.Count);
        Assert.Equal("Bytes Processed", display.Stats[2].Label);
        Assert.Equal("5.0 MB", display.Stats[2].Value);
        Assert.Equal("Avg Latency", display.Stats[3].Label);
        Assert.Equal("4.2 ms", display.Stats[3].Value);
    }

    [Fact]
    public void Project_compact_footprint_sets_flag()
    {
        var display = VersionInfoProjection.Project(FullReading(), new VersionInfoSize(1, 2), Localizer);
        Assert.True(display.IsCompact);
    }

    [Fact]
    public void Project_no_version_renders_em_dashes_and_zero_stats()
    {
        var display = VersionInfoProjection.Project(
            new VersionInfoReading(null, null), VersionInfoRegistration.DefaultSize, Localizer);

        Assert.False(display.HasData);
        Assert.Equal(EmDash, display.ChartVersion);
        Assert.Equal(EmDash, display.TruncatedSha);
        Assert.Equal(EmDash, display.OsValue);
        Assert.Equal(EmDash, display.ArchValue);
        Assert.All(display.KvRows, r => Assert.Equal(EmDash, r.Value));
        Assert.Equal("0.0", display.Stats[0].Value);
        Assert.Equal("0", display.Stats[1].Value);
    }

    [Fact]
    public void Project_capture_missing_defaults_stats_to_zero()
    {
        var reading = new VersionInfoReading(
            new VersionSnapshot("v1", null, null, null, null, null, null), null);
        var display = VersionInfoProjection.Project(reading, VersionInfoRegistration.DefaultSize, Localizer);

        Assert.True(display.HasData);
        Assert.Equal("0.0", display.Stats[0].Value);
        Assert.Equal("0", display.Stats[1].Value);
    }

    [Theory]
    [InlineData("abcdef1234567890", "abcdef1")]
    [InlineData("abc", "abc")]
    [InlineData("", "\u2014")]
    [InlineData(null, "\u2014")]
    public void TruncateSha_matches_web(string? input, string expected) =>
        Assert.Equal(expected, VersionInfoProjection.TruncateSha(input));

    [Theory]
    [InlineData(0.0, "0 B")]
    [InlineData(512.0, "512 B")]
    [InlineData(1536.0, "1.5 KB")]
    [InlineData(5242880.0, "5.0 MB")]
    [InlineData(2147483648.0, "2.00 GB")]
    public void FormatBytes_matches_web(double bytes, string expected) =>
        Assert.Equal(expected, VersionInfoProjection.FormatBytes(bytes));

    [Fact]
    public void Project_automation_name_carries_version_sha_and_stats()
    {
        var display = VersionInfoProjection.Project(FullReading(), new VersionInfoSize(4, 4), Localizer);

        Assert.Contains("Version Info:", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Version v2.5.0", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Git SHA abcdef1", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("OS linux", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Signals/sec 12.5", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_compact_automation_name_carries_version_and_sha()
    {
        var display = VersionInfoProjection.Project(FullReading(), new VersionInfoSize(1, 2), Localizer);

        Assert.Contains("Version v2.5.0", display.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("Git SHA abcdef1", display.CompactAutomationName, StringComparison.Ordinal);
    }

    // ---- Combine mapper (version-driven two-source merge) ---------------------------

    [Fact]
    public void Combine_all_loaded_renders_body()
    {
        using var version = JsonDocument.Parse(VersionJson);
        using var capture = JsonDocument.Parse(CaptureJson);

        var combined = VersionInfoResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(version.RootElement, Now),
            RepositoryResult<JsonElement>.Loaded(capture.RootElement, Now));

        Assert.Equal(LoadStatus.Loaded, combined.Status);
        Assert.True(combined.Value!.HasVersion);
        Assert.NotNull(combined.Value.Capture);
        Assert.Equal(Now, combined.FetchedAt);
    }

    [Fact]
    public void Combine_version_only_renders_body_without_enrichment()
    {
        using var version = JsonDocument.Parse(VersionJson);
        var combined = VersionInfoResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(version.RootElement, Now), null);

        Assert.Equal(LoadStatus.Loaded, combined.Status);
        Assert.True(combined.Value!.HasVersion);
        Assert.Null(combined.Value.Capture);
    }

    [Fact]
    public void Combine_version_empty_collapses_to_empty()
    {
        var combined = VersionInfoResultMapper.Combine(
            RepositoryResult<JsonElement>.Empty(Now),
            RepositoryResult<JsonElement>.Empty(Now));

        Assert.Equal(LoadStatus.Empty, combined.Status);
        Assert.Null(combined.Value);
    }

    [Fact]
    public void Combine_version_null_body_collapses_to_empty()
    {
        using var nullBody = JsonDocument.Parse("null");
        var combined = VersionInfoResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(nullBody.RootElement, Now), null);

        Assert.Equal(LoadStatus.Empty, combined.Status);
    }

    [Fact]
    public void Combine_version_error_with_no_content_collapses_to_failure()
    {
        var combined = VersionInfoResultMapper.Combine(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            null);

        Assert.Equal(LoadStatus.Error, combined.Status);
        Assert.NotNull(combined.Error);
    }

    [Fact]
    public void Combine_version_stale_marks_body_stale()
    {
        using var version = JsonDocument.Parse(VersionJson);
        var combined = VersionInfoResultMapper.Combine(
            RepositoryResult<JsonElement>.Cached(version.RootElement, Now, stale: true), null);

        Assert.Equal(LoadStatus.Cached, combined.Status);
        Assert.True(combined.IsStale);
    }

    [Fact]
    public void Combine_version_offline_marks_body_offline()
    {
        using var version = JsonDocument.Parse(VersionJson);
        var combined = VersionInfoResultMapper.Combine(
            RepositoryResult<JsonElement>.OfflineCached(version.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")),
            null);

        Assert.Equal(LoadStatus.Offline, combined.Status);
        Assert.True(combined.Value!.HasVersion);
    }

    [Fact]
    public void Combine_version_refreshing_keeps_body()
    {
        using var version = JsonDocument.Parse(VersionJson);
        var combined = VersionInfoResultMapper.Combine(
            RepositoryResult<JsonElement>.Refreshing(version.RootElement, Now, stale: false), null);

        Assert.Equal(LoadStatus.Refreshing, combined.Status);
        Assert.True(combined.Value!.HasVersion);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<VersionInfoReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(VersionInfoState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_body_display()
    {
        using var vm = NewViewModel(Loaded(FullReading()));
        await vm.LoadAsync();

        Assert.Equal(VersionInfoState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal("v2.5.0", vm.Display!.ChartVersion);
        Assert.Equal("abcdef1", vm.Display.TruncatedSha);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty_without_display()
    {
        using var vm = NewViewModel(RepositoryResult<VersionInfoReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(VersionInfoState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Null(vm.Display);
        Assert.Equal("No version data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<VersionInfoReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(VersionInfoState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            RepositoryResult<VersionInfoReading>.Cached(FullReading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(VersionInfoState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(RepositoryResult<VersionInfoReading>.OfflineCached(
            FullReading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(VersionInfoState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<VersionInfoReading>.Loading(),
            RepositoryResult<VersionInfoReading>.Cached(new VersionInfoReading(new VersionSnapshot("v1", null, null, null, null, null, null), null), Now, stale: false),
            RepositoryResult<VersionInfoReading>.Loaded(FullReading(), Now));
        await vm.LoadAsync();

        Assert.Equal(VersionInfoState.Loaded, vm.State);
        Assert.Equal("v2.5.0", vm.Display!.ChartVersion);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_layout()
    {
        using var vm = new VersionInfoViewModel(
            new FakeVersionInfoSource(Loaded(FullReading())), Localizer, new VersionInfoSize(1, 2));
        await vm.LoadAsync();
        Assert.True(vm.Display!.IsCompact);

        vm.Size = new VersionInfoSize(4, 4);
        Assert.False(vm.Display!.IsCompact);
        Assert.True(vm.Display!.IsWide);
        Assert.Equal(VersionInfoState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(FullReading()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(VersionInfoViewModel.State), changed);
        Assert.Contains(nameof(VersionInfoViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_and_messages_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<VersionInfoReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Version Info", vm.Title);
        Assert.Equal("No version data available", vm.EmptyMessage);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("version-info", VersionInfoRegistration.Id);
        Assert.Equal("system", VersionInfoRegistration.Category);
        Assert.Equal("VersionInfoWidget", VersionInfoRegistration.Slug);
        Assert.Equal(new VersionInfoSize(2, 2), VersionInfoRegistration.DefaultSize);
        Assert.Equal(new VersionInfoSize(1, 2), VersionInfoRegistration.MinSize);
        Assert.Equal(new VersionInfoSize(4, 40), VersionInfoRegistration.MaxSize);
        Assert.Equal("Version Info", VersionInfoRegistration.Name(Localizer));
        Assert.Equal("TeslaSync version, build info, uptime, data capture rates", VersionInfoRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(1, 2, true)]    // min
    [InlineData(4, 40, true)]   // max
    [InlineData(2, 2, true)]    // default
    [InlineData(0, 2, false)]   // below min cols
    [InlineData(1, 1, false)]   // below min rows
    [InlineData(5, 4, false)]   // above max cols
    [InlineData(2, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, VersionInfoRegistration.IsWithinBounds(new VersionInfoSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new VersionInfoSize(1, 2), VersionInfoRegistration.Clamp(new VersionInfoSize(0, 0)));
        Assert.Equal(new VersionInfoSize(4, 40), VersionInfoRegistration.Clamp(new VersionInfoSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new VersionInfoDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=VersionInfoWidget", Assert.Single(lines));
    }

    // ---- Source (concurrent two-endpoint server-wide adapter) ----------------------

    [Fact]
    public async Task Source_merges_two_reads()
    {
        using var version = JsonDocument.Parse(VersionJson);
        using var capture = JsonDocument.Parse(CaptureJson);
        var api = new KeyedFakeApiClient()
            .Returns(Operations.SystemAdmin.Version, version.RootElement)
            .Returns(CaptureStatsOperation, capture.RootElement);

        var source = new VersionInfoSource(api, NewEngine(), new ApiClientOptions());
        var terminal = (await DrainAsync(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.HasVersion);
        Assert.Equal("v2.5.0", terminal.Value.Version!.ChartVersion);
        Assert.Equal(12.5, terminal.Value.Capture!.SignalsPerSec!.Value);
    }

    [Fact]
    public async Task Source_requests_the_two_operations()
    {
        using var version = JsonDocument.Parse(VersionJson);
        using var capture = JsonDocument.Parse(CaptureJson);
        var api = new KeyedFakeApiClient()
            .Returns(Operations.SystemAdmin.Version, version.RootElement)
            .Returns(CaptureStatsOperation, capture.RootElement);

        var source = new VersionInfoSource(api, NewEngine(), new ApiClientOptions());
        await DrainAsync(source);

        Assert.Contains(api.Requests, r => r.OperationId == Operations.SystemAdmin.Version);
        Assert.Contains(api.Requests, r => r.OperationId == CaptureStatsOperation);
    }

    [Fact]
    public async Task Source_version_only_content_renders_body()
    {
        using var version = JsonDocument.Parse(VersionJson);
        using var nullBody = JsonDocument.Parse("null");
        var api = new KeyedFakeApiClient()
            .Returns(Operations.SystemAdmin.Version, version.RootElement)
            .Returns(CaptureStatsOperation, nullBody.RootElement);

        var source = new VersionInfoSource(api, NewEngine(), new ApiClientOptions());
        var terminal = (await DrainAsync(source))[^1];

        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.True(terminal.Value!.HasVersion);
        Assert.Null(terminal.Value.Capture);
    }

    [Fact]
    public async Task Source_version_null_body_collapses_to_empty()
    {
        using var nullBody = JsonDocument.Parse("null");
        var api = new KeyedFakeApiClient()
            .Returns(Operations.SystemAdmin.Version, nullBody.RootElement)
            .Returns(CaptureStatsOperation, nullBody.RootElement);

        var source = new VersionInfoSource(api, NewEngine(), new ApiClientOptions());
        var terminal = (await DrainAsync(source))[^1];

        Assert.Equal(LoadStatus.Empty, terminal.Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static VersionInfoReading FullReading() => new(
        new VersionSnapshot("v2.5.0", "go1.25.1", "2026-06-01", "abcdef1234567890", "3d 4h", "linux", "amd64"),
        new CaptureSnapshot(12.5, 84210, 5242880, 4.2));

    private static RepositoryResult<VersionInfoReading> Loaded(VersionInfoReading reading) =>
        RepositoryResult<VersionInfoReading>.Loaded(reading, Now);

    private static VersionInfoViewModel NewViewModel(params RepositoryResult<VersionInfoReading>[] emissions) =>
        new(new FakeVersionInfoSource(emissions), Localizer, VersionInfoRegistration.DefaultSize);

    private static async Task<List<RepositoryResult<VersionInfoReading>>> DrainAsync(IVersionInfoSource source)
    {
        var list = new List<RepositoryResult<VersionInfoReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static void AssertRow(VersionKvRow row, string label, string value, VersionValueStyle style)
    {
        Assert.Equal(label, row.Label);
        Assert.Equal(value, row.Value);
        Assert.Equal(style, row.Style);
    }

    private sealed class FakeVersionInfoSource(params RepositoryResult<VersionInfoReading>[] emissions) : IVersionInfoSource
    {
        public async IAsyncEnumerable<RepositoryResult<VersionInfoReading>> StreamAsync(
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

    private sealed class KeyedFakeApiClient : IApiClient
    {
        private readonly Dictionary<string, Func<object?>> _responses = new(StringComparer.Ordinal);
        private readonly object _gate = new();

        public List<ApiRequest> Requests { get; } = new();

        public KeyedFakeApiClient Returns<T>(string operationId, T value)
        {
            _responses[operationId] = () => value;
            return this;
        }

        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            GeneratedApi.ApiEndpoints.All.First(e => e.OperationId == operationId);

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            lock (_gate)
            {
                Requests.Add(request);
            }

            if (!_responses.TryGetValue(request.OperationId, out var factory))
            {
                throw new InvalidOperationException($"No scripted response for {request.OperationId}");
            }

            return Task.FromResult((T)factory()!);
        }
    }
}
