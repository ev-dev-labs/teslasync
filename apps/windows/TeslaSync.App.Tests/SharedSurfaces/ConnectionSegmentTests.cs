using System.Net;
using System.Net.Http;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the ConnectionSegment shared surface's UI-thread-free logic — the registration
/// metadata (slug, automation id, navigation target, the latency / timeout / poll constants, the seven i18n keys
/// the source references with their verbatim fallbacks, the per-state Segoe Fluent glyphs, token brush keys and
/// lowercase status tokens), the <see cref="ConnectionSegmentRegistration.Bucket"/> thresholds and
/// <see cref="ApiHealthSnapshot.FromProbe"/> adapter (the web <c>bucket()</c> + hook mapping), the pure
/// <see cref="ConnectionSegmentProjection"/> (per-state accent / glyph / labels, the latency / offline suffix
/// rules, the icon-only mode and the tooltip / aria composition), the <see cref="StaticConnectionSegmentSource"/>
/// / <see cref="PollingConnectionSegmentSource"/> seams, the <see cref="HttpApiHealthProbe"/> adapter (HTTP outcome
/// → probe result over a fake handler), the <see cref="ConnectionSegmentViewModel"/> state holder and navigation,
/// the navigator seam and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/layout/status-bar/ConnectionSegment.tsx + web/src/api/hooks/useApiHealth.ts). The WinUI view
/// itself (shared-surfaces/ConnectionSegment/ConnectionSegment.cs) is exercised by the app build.
/// </summary>
public sealed class ConnectionSegmentTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static ConnectionSegmentProjection Project(
        ApiHealthStatus status,
        int? latencyMs = null,
        bool iconOnly = false,
        ILocalizer? localizer = null) =>
        ConnectionSegmentProjection.Project(
            new ApiHealthSnapshot(status, latencyMs, latencyMs.HasValue ? Now : null),
            iconOnly,
            localizer ?? Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("ConnectionSegment", ConnectionSegmentRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_stable() =>
        Assert.Equal("connection-segment", ConnectionSegmentRegistration.RootAutomationId);

    [Fact]
    public void Navigation_target_matches_the_web_link()
    {
        // web: <Link to="/system-status"> — the RouteTable SystemStatus path pattern (no leading slash).
        Assert.Equal("system-status", ConnectionSegmentRegistration.NavigationTarget);
        Assert.Equal("system-status", Project(ApiHealthStatus.Ok, 10).NavigationTarget);
    }

    [Fact]
    public void Tier_constants_match_the_web_useApiHealth_thresholds()
    {
        Assert.Equal(500, ConnectionSegmentRegistration.DegradedLatencyMs);
        Assert.Equal(5_000, ConnectionSegmentRegistration.ProbeTimeoutMs);
        Assert.Equal(15_000, ConnectionSegmentRegistration.PollIntervalMs);
    }

    [Fact]
    public void Glyphs_map_to_the_fluent_stand_ins_for_the_web_lucide_icons()
    {
        Assert.Equal("\uE950", ConnectionSegmentRegistration.OkGlyph);
        Assert.Equal("\uE7BA", ConnectionSegmentRegistration.DegradedGlyph);
        Assert.Equal("\uEA39", ConnectionSegmentRegistration.OfflineGlyph);
        Assert.Equal("\uE897", ConnectionSegmentRegistration.UnknownGlyph);
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        Assert.Equal("translation.statusBar.connection.short", ConnectionSegmentRegistration.ShortKey);
        Assert.Equal("API", ConnectionSegmentRegistration.ShortFallback);
        Assert.Equal("translation.statusBar.connection.ok", ConnectionSegmentRegistration.OkKey);
        Assert.Equal("Online", ConnectionSegmentRegistration.OkFallback);
        Assert.Equal("translation.statusBar.connection.degraded", ConnectionSegmentRegistration.DegradedKey);
        Assert.Equal("Degraded", ConnectionSegmentRegistration.DegradedFallback);
        Assert.Equal("translation.statusBar.connection.offline", ConnectionSegmentRegistration.OfflineKey);
        Assert.Equal("Offline", ConnectionSegmentRegistration.OfflineFallback);
        Assert.Equal("translation.statusBar.connection.unknown", ConnectionSegmentRegistration.UnknownKey);
        Assert.Equal("Connecting\u2026", ConnectionSegmentRegistration.UnknownFallback);
        Assert.Equal("translation.statusBar.connection.tooltip", ConnectionSegmentRegistration.TooltipKey);
        Assert.Equal("API connection", ConnectionSegmentRegistration.TooltipFallback);
        Assert.Equal("translation.statusBar.connection.aria", ConnectionSegmentRegistration.AriaKey);
        Assert.Equal("API connection status", ConnectionSegmentRegistration.AriaFallback);
    }

    [Theory]
    [InlineData(ApiHealthStatus.Ok, "ok")]
    [InlineData(ApiHealthStatus.Degraded, "degraded")]
    [InlineData(ApiHealthStatus.Offline, "offline")]
    [InlineData(ApiHealthStatus.Unknown, "unknown")]
    public void StatusToken_is_the_lowercase_web_union(ApiHealthStatus status, string expected)
    {
        Assert.Equal(expected, ConnectionSegmentRegistration.StatusToken(status));
        Assert.Equal(expected, Project(status, 10).StatusToken);
    }

    [Theory]
    [InlineData(ApiHealthStatus.Ok, "\uE950")]
    [InlineData(ApiHealthStatus.Degraded, "\uE7BA")]
    [InlineData(ApiHealthStatus.Offline, "\uEA39")]
    [InlineData(ApiHealthStatus.Unknown, "\uE897")]
    public void Glyph_maps_each_state_to_its_fluent_icon(ApiHealthStatus status, string expected)
    {
        Assert.Equal(expected, ConnectionSegmentRegistration.Glyph(status));
        Assert.Equal(expected, Project(status, 10).IconGlyph);
    }

    [Theory]
    [InlineData(ApiHealthStatus.Ok, "TsColorSuccessBrush")]
    [InlineData(ApiHealthStatus.Degraded, "TsColorWarningBrush")]
    [InlineData(ApiHealthStatus.Offline, "TsColorDangerBrush")]
    [InlineData(ApiHealthStatus.Unknown, "TsColorTextMutedBrush")]
    public void AccentBrushKey_maps_each_state_to_its_token_brush(ApiHealthStatus status, string expectedKey) =>
        Assert.Equal(expectedKey, Project(status, 10).AccentBrushKey);

    // ── bucket / snapshot adapter (web bucket() + useApiHealth mapping) ──────────────────────────────────────

    [Theory]
    [InlineData(false, 10, ApiHealthStatus.Offline)]
    [InlineData(false, 5_000, ApiHealthStatus.Offline)]
    [InlineData(true, 0, ApiHealthStatus.Ok)]
    [InlineData(true, 499, ApiHealthStatus.Ok)]
    [InlineData(true, 500, ApiHealthStatus.Degraded)]
    [InlineData(true, 1_999, ApiHealthStatus.Degraded)]
    public void Bucket_ports_the_web_tiers(bool ok, int latencyMs, ApiHealthStatus expected)
    {
        var result = new ApiHealthProbeResult(ok, latencyMs, Now);
        Assert.Equal(expected, ConnectionSegmentRegistration.Bucket(result));
    }

    [Fact]
    public void FromProbe_buckets_and_carries_latency_and_timestamp()
    {
        var snapshot = ApiHealthSnapshot.FromProbe(new ApiHealthProbeResult(true, 320, Now));

        Assert.Equal(ApiHealthStatus.Ok, snapshot.Status);
        Assert.Equal(320, snapshot.LatencyMs);
        Assert.Equal(Now, snapshot.LastCheckedAt);
    }

    [Fact]
    public void FromProbe_throws_when_the_result_is_null() =>
        Assert.Throws<ArgumentNullException>(() => ApiHealthSnapshot.FromProbe(null!));

    [Fact]
    public void Snapshot_unknown_default_matches_the_web_no_data_return()
    {
        // web: !data => { status: 'unknown', latencyMs: null, lastCheckedAt: null }.
        Assert.Equal(ApiHealthStatus.Unknown, ApiHealthSnapshot.Unknown.Status);
        Assert.Null(ApiHealthSnapshot.Unknown.LatencyMs);
        Assert.Null(ApiHealthSnapshot.Unknown.LastCheckedAt);
    }

    // ── projection: per-state "snapshot" — each state renders a complete, distinct display ───────────────────

    [Fact]
    public void Ok_state_renders_a_complete_segment()
    {
        var p = Project(ApiHealthStatus.Ok, 42);

        Assert.Equal("ok", p.StatusToken);
        Assert.Equal("TsColorSuccessBrush", p.AccentBrushKey);
        Assert.Equal("\uE950", p.IconGlyph);
        Assert.Equal("API", p.ShortLabel);
        Assert.Equal("Online", p.StateLabel);
        Assert.Equal("42ms", p.LatencyLabel);
        Assert.True(p.ShowShortLabel);
        Assert.True(p.ShowLatencySuffix);
        Assert.Equal("\u00B7 42ms", p.LatencySuffixText);
        Assert.False(p.ShowOfflineSuffix);
        Assert.Equal("API connection \u00B7 Online \u00B7 42ms", p.TooltipText);
        Assert.Equal("API connection status: Online (42ms)", p.AutomationName);
    }

    [Fact]
    public void Degraded_state_renders_a_complete_segment()
    {
        var p = Project(ApiHealthStatus.Degraded, 800);

        Assert.Equal("degraded", p.StatusToken);
        Assert.Equal("TsColorWarningBrush", p.AccentBrushKey);
        Assert.Equal("\uE7BA", p.IconGlyph);
        Assert.Equal("Degraded", p.StateLabel);
        Assert.True(p.ShowLatencySuffix);
        Assert.Equal("\u00B7 800ms", p.LatencySuffixText);
        Assert.False(p.ShowOfflineSuffix);
        Assert.Equal("API connection \u00B7 Degraded \u00B7 800ms", p.TooltipText);
        Assert.Equal("API connection status: Degraded (800ms)", p.AutomationName);
    }

    [Fact]
    public void Offline_state_renders_the_offline_suffix_and_omits_latency()
    {
        // web: even with a measured latency, offline shows "· Offline" in the body and excludes ms from tooltip/aria.
        var p = Project(ApiHealthStatus.Offline, 5_000);

        Assert.Equal("offline", p.StatusToken);
        Assert.Equal("TsColorDangerBrush", p.AccentBrushKey);
        Assert.Equal("\uEA39", p.IconGlyph);
        Assert.Equal("Offline", p.StateLabel);
        Assert.False(p.ShowLatencySuffix);
        Assert.True(p.ShowOfflineSuffix);
        Assert.Equal("\u00B7 Offline", p.OfflineSuffixText);
        Assert.Equal("API connection \u00B7 Offline", p.TooltipText);
        Assert.Equal("API connection status: Offline", p.AutomationName);
    }

    [Fact]
    public void Unknown_state_is_the_loading_display_with_no_suffix()
    {
        // web 'unknown' is the pre-first-probe / loading state: Help glyph + "API", no latency, no offline suffix.
        var p = Project(ApiHealthStatus.Unknown);

        Assert.Equal("unknown", p.StatusToken);
        Assert.Equal("TsColorTextMutedBrush", p.AccentBrushKey);
        Assert.Equal("\uE897", p.IconGlyph);
        Assert.Equal("Connecting\u2026", p.StateLabel);
        Assert.Equal("\u2014", p.LatencyLabel);
        Assert.True(p.ShowShortLabel);
        Assert.False(p.ShowLatencySuffix);
        Assert.False(p.ShowOfflineSuffix);
        Assert.Equal("API connection \u00B7 Connecting\u2026", p.TooltipText);
        Assert.Equal("API connection status: Connecting\u2026", p.AutomationName);
    }

    // ── projection: icon-only mode (web iconOnly prop) ───────────────────────────────────────────────────────

    [Fact]
    public void IconOnly_mode_hides_the_short_label_and_both_suffixes()
    {
        var ok = Project(ApiHealthStatus.Ok, 42, iconOnly: true);
        Assert.True(ok.IconOnly);
        Assert.False(ok.ShowShortLabel);
        Assert.False(ok.ShowLatencySuffix);
        Assert.False(ok.ShowOfflineSuffix);

        var offline = Project(ApiHealthStatus.Offline, 5_000, iconOnly: true);
        Assert.False(offline.ShowShortLabel);
        Assert.False(offline.ShowOfflineSuffix);
    }

    [Fact]
    public void IconOnly_mode_still_carries_the_full_tooltip_and_aria()
    {
        // web: the <Tooltip> wraps the link in both modes, and the aria-label is unconditional.
        var p = Project(ApiHealthStatus.Ok, 42, iconOnly: true);

        Assert.Equal("API connection \u00B7 Online \u00B7 42ms", p.TooltipText);
        Assert.Equal("API connection status: Online (42ms)", p.AutomationName);
    }

    // ── projection: latency label + suffix rules ─────────────────────────────────────────────────────────────

    [Fact]
    public void Latency_label_is_the_em_dash_when_unmeasured() =>
        Assert.Equal("\u2014", Project(ApiHealthStatus.Unknown).LatencyLabel);

    [Fact]
    public void Latency_suffix_is_suppressed_when_no_measurement_exists()
    {
        // web body condition includes latencyMs != null; an ok state with no measurement shows no suffix.
        Assert.False(Project(ApiHealthStatus.Ok, latencyMs: null).ShowLatencySuffix);
    }

    [Fact]
    public void Tooltip_and_aria_omit_latency_when_unmeasured()
    {
        var p = Project(ApiHealthStatus.Ok, latencyMs: null);

        Assert.Equal("API connection \u00B7 Online", p.TooltipText);
        Assert.Equal("API connection status: Online", p.AutomationName);
    }

    // ── accessibility (Narrator name == the web aria-label, never blank) ─────────────────────────────────────

    [Theory]
    [InlineData(ApiHealthStatus.Ok, 42)]
    [InlineData(ApiHealthStatus.Degraded, 800)]
    [InlineData(ApiHealthStatus.Offline, 5_000)]
    [InlineData(ApiHealthStatus.Unknown, null)]
    public void AutomationName_is_present_for_every_state_and_mode(ApiHealthStatus status, int? latencyMs)
    {
        foreach (var iconOnly in new[] { false, true })
        {
            var p = Project(status, latencyMs, iconOnly);
            Assert.False(string.IsNullOrWhiteSpace(p.AutomationName));
            Assert.StartsWith("API connection status:", p.AutomationName, StringComparison.Ordinal);
            Assert.Contains(p.StateLabel, p.AutomationName, StringComparison.Ordinal);
        }
    }

    // ── i18n: every label routes through the localizer (no hardcoded English) ────────────────────────────────

    [Fact]
    public void Project_routes_every_label_through_the_localizer()
    {
        var fake = new RecordingLocalizer();

        Project(ApiHealthStatus.Ok, 42, localizer: fake);

        Assert.Contains("translation.statusBar.connection.short", fake.Keys);
        Assert.Contains("translation.statusBar.connection.ok", fake.Keys);
        Assert.Contains("translation.statusBar.connection.tooltip", fake.Keys);
        Assert.Contains("translation.statusBar.connection.aria", fake.Keys);
    }

    [Fact]
    public void Localized_copy_passes_through_verbatim_with_no_hardcoded_english()
    {
        var fake = new RecordingLocalizer(new Dictionary<string, string>
        {
            ["translation.statusBar.connection.ok"] = "オンライン",
            ["translation.statusBar.connection.short"] = "API接続",
        });

        var p = Project(ApiHealthStatus.Ok, 42, localizer: fake);

        Assert.Equal("オンライン", p.StateLabel);
        Assert.Equal("API接続", p.ShortLabel);
        Assert.Contains("オンライン", p.AutomationName, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(ApiHealthStatus.Ok, "translation.statusBar.connection.ok")]
    [InlineData(ApiHealthStatus.Degraded, "translation.statusBar.connection.degraded")]
    [InlineData(ApiHealthStatus.Offline, "translation.statusBar.connection.offline")]
    [InlineData(ApiHealthStatus.Unknown, "translation.statusBar.connection.unknown")]
    public void State_label_resolves_through_its_keyed_call_site(ApiHealthStatus status, string key)
    {
        var fake = new RecordingLocalizer();

        ConnectionSegmentRegistration.StateLabel(status, fake);

        Assert.Contains(key, fake.Keys);
    }

    // ── null-argument guards ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_snapshot() =>
        Assert.Throws<ArgumentNullException>(() =>
            ConnectionSegmentProjection.Project(null!, false, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() =>
            ConnectionSegmentProjection.Project(ApiHealthSnapshot.Unknown, false, null!));

    // ── source: StaticConnectionSegmentSource ────────────────────────────────────────────────────────────────

    [Fact]
    public void Static_source_defaults_to_unknown() =>
        Assert.Equal(ApiHealthStatus.Unknown, new StaticConnectionSegmentSource().Current.Status);

    [Fact]
    public void Static_source_set_moves_the_snapshot_and_raises_changed()
    {
        var source = new StaticConnectionSegmentSource();
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.Set(new ApiHealthSnapshot(ApiHealthStatus.Ok, 42, Now));

        Assert.Equal(1, raised);
        Assert.Equal(ApiHealthStatus.Ok, source.Current.Status);
        Assert.Equal(42, source.Current.LatencyMs);
    }

    [Fact]
    public void Static_source_set_rejects_null() =>
        Assert.Throws<ArgumentNullException>(() => new StaticConnectionSegmentSource().Set(null!));

    // ── source: PollingConnectionSegmentSource (drives the probe seam) ───────────────────────────────────────

    [Fact]
    public async Task Polling_source_folds_a_probe_into_the_snapshot()
    {
        var source = new PollingConnectionSegmentSource(
            new QueueProbe(new ApiHealthProbeResult(true, 120, Now)));

        var snapshot = await source.ProbeOnceAsync();

        Assert.Equal(ApiHealthStatus.Ok, snapshot.Status);
        Assert.Equal(120, snapshot.LatencyMs);
        Assert.Equal(ApiHealthStatus.Ok, source.Current.Status);
        source.Dispose();
    }

    [Fact]
    public async Task Polling_source_raises_changed_only_when_the_snapshot_moves()
    {
        // Two identical probe results (same timestamp) must collapse to one Changed emission.
        var source = new PollingConnectionSegmentSource(new QueueProbe(
            new ApiHealthProbeResult(true, 50, Now),
            new ApiHealthProbeResult(true, 50, Now)));
        var raised = 0;
        source.Changed += (_, _) => raised++;

        await source.ProbeOnceAsync();
        await source.ProbeOnceAsync();

        Assert.Equal(1, raised);
        source.Dispose();
    }

    [Fact]
    public async Task Polling_source_buckets_a_failed_probe_as_offline()
    {
        var source = new PollingConnectionSegmentSource(
            new QueueProbe(new ApiHealthProbeResult(false, 5_000, Now)));

        var snapshot = await source.ProbeOnceAsync();

        Assert.Equal(ApiHealthStatus.Offline, snapshot.Status);
        source.Dispose();
    }

    [Fact]
    public void Polling_source_rejects_a_null_probe() =>
        Assert.Throws<ArgumentNullException>(() => new PollingConnectionSegmentSource(null!));

    // ── adapter: HttpApiHealthProbe (HTTP outcome → probe result, over a fake handler) ───────────────────────

    [Fact]
    public async Task Http_probe_reports_a_2xx_response_as_ok_and_targets_healthz()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK));
        using var http = new HttpClient(handler);
        var probe = new HttpApiHealthProbe(http, new Uri("https://teslasync.local"), () => Now);

        var result = await probe.ProbeAsync();

        Assert.True(result.Ok);
        Assert.True(result.LatencyMs >= 0);
        Assert.Equal(ApiHealthStatus.Ok, ConnectionSegmentRegistration.Bucket(result));
        Assert.NotNull(handler.LastRequest);
        Assert.Equal("/healthz", handler.LastRequest!.RequestUri!.AbsolutePath);
        Assert.True(handler.LastRequest.Headers.CacheControl?.NoStore);
    }

    [Fact]
    public async Task Http_probe_reports_a_non_2xx_response_as_offline()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        using var http = new HttpClient(handler);
        var probe = new HttpApiHealthProbe(http, new Uri("https://teslasync.local"), () => Now);

        var result = await probe.ProbeAsync();

        Assert.False(result.Ok);
        Assert.Equal(ApiHealthStatus.Offline, ConnectionSegmentRegistration.Bucket(result));
    }

    [Fact]
    public async Task Http_probe_reports_a_network_error_as_offline()
    {
        var handler = new StubHandler(_ => throw new HttpRequestException("connection refused"));
        using var http = new HttpClient(handler);
        var probe = new HttpApiHealthProbe(http, new Uri("https://teslasync.local"), () => Now);

        var result = await probe.ProbeAsync();

        Assert.False(result.Ok);
        Assert.Equal(ApiHealthStatus.Offline, ConnectionSegmentRegistration.Bucket(result));
    }

    [Fact]
    public void Http_probe_rejects_null_dependencies()
    {
        using var http = new HttpClient(new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)));
        Assert.Throws<ArgumentNullException>(() => new HttpApiHealthProbe(null!, new Uri("https://teslasync.local")));
        Assert.Throws<ArgumentNullException>(() => new HttpApiHealthProbe(http, null!));
    }

    // ── view-model: binds the seam, projects, reprojects and routes navigation ───────────────────────────────

    [Fact]
    public void ViewModel_projects_the_initial_snapshot()
    {
        var source = new StaticConnectionSegmentSource(new ApiHealthSnapshot(ApiHealthStatus.Ok, 42, Now));
        using var vm = new ConnectionSegmentViewModel(Localizer, source);

        Assert.Equal(ApiHealthStatus.Ok, vm.Status);
        Assert.Equal("Online", vm.StateLabel);
        Assert.Equal("API", vm.ShortLabel);
        Assert.Equal("ConnectionSegment", ConnectionSegmentViewModel.Slug);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_source_changes()
    {
        var source = new StaticConnectionSegmentSource(ApiHealthSnapshot.Unknown);
        using var vm = new ConnectionSegmentViewModel(Localizer, source);
        var changes = 0;
        vm.PropertyChanged += (_, e) => { if (e.PropertyName == nameof(ConnectionSegmentViewModel.Projection)) changes++; };

        source.Set(new ApiHealthSnapshot(ApiHealthStatus.Offline, 5_000, Now));

        Assert.Equal(1, changes);
        Assert.Equal(ApiHealthStatus.Offline, vm.Status);
        Assert.True(vm.ShowOfflineSuffix);
        Assert.Equal("\u00B7 Offline", vm.OfflineSuffixText);
    }

    [Fact]
    public void ViewModel_navigate_routes_to_system_status_through_the_seam()
    {
        var navigator = new RecordingNavigator();
        var source = new StaticConnectionSegmentSource(new ApiHealthSnapshot(ApiHealthStatus.Ok, 42, Now));
        using var vm = new ConnectionSegmentViewModel(Localizer, source, iconOnly: false, navigator);

        vm.Navigate();

        Assert.Equal(new[] { "system-status" }, navigator.Routes);
    }

    [Fact]
    public void ViewModel_icon_only_flag_is_threaded_into_the_projection()
    {
        var source = new StaticConnectionSegmentSource(new ApiHealthSnapshot(ApiHealthStatus.Ok, 42, Now));
        using var vm = new ConnectionSegmentViewModel(Localizer, source, iconOnly: true);

        Assert.True(vm.IconOnly);
        Assert.False(vm.ShowShortLabel);
        Assert.False(vm.ShowLatencySuffix);
    }

    [Fact]
    public void ViewModel_stops_reprojecting_after_dispose()
    {
        var source = new StaticConnectionSegmentSource(new ApiHealthSnapshot(ApiHealthStatus.Ok, 42, Now));
        var vm = new ConnectionSegmentViewModel(Localizer, source);
        var changes = 0;
        vm.PropertyChanged += (_, _) => changes++;
        vm.Dispose();

        source.Set(new ApiHealthSnapshot(ApiHealthStatus.Offline, 5_000, Now));

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        var source = new StaticConnectionSegmentSource();
        Assert.Throws<ArgumentNullException>(() => new ConnectionSegmentViewModel(null!, source));
        Assert.Throws<ArgumentNullException>(() => new ConnectionSegmentViewModel(Localizer, null!));
    }

    // ── navigator seam ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Null_navigator_is_an_inert_no_op() =>
        NullConnectionSegmentNavigator.Instance.Navigate("system-status");

    [Fact]
    public void Delegate_navigator_forwards_to_the_callback()
    {
        string? captured = null;
        var navigator = new DelegateConnectionSegmentNavigator(route => captured = route);

        navigator.Navigate("system-status");

        Assert.Equal("system-status", captured);
    }

    [Fact]
    public void Delegate_navigator_rejects_a_null_callback() =>
        Assert.Throws<ArgumentNullException>(() => new DelegateConnectionSegmentNavigator(null!));

    // ── diagnostics (P1/S11): view.opened slug=ConnectionSegment, PII-safe ───────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new ConnectionSegmentDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ConnectionSegment", captured[0]);
        Assert.Equal("view.opened slug=ConnectionSegment", captured[1]);
    }

    /// <summary>An <see cref="ILocalizer"/> test double that records every key it is asked for and returns either
    /// a configured translation or the supplied fallback, so the keyed call sites are asserted headlessly.</summary>
    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string>? _map;

        public RecordingLocalizer(IReadOnlyDictionary<string, string>? map = null) => _map = map;

        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            if (_map is not null && _map.TryGetValue(key, out var translation))
            {
                return translation;
            }

            return fallback;
        }
    }

    /// <summary>An <see cref="IConnectionSegmentNavigator"/> test double that records every route it is asked to
    /// navigate to.</summary>
    private sealed class RecordingNavigator : IConnectionSegmentNavigator
    {
        public List<string> Routes { get; } = new();

        public void Navigate(string route) => Routes.Add(route);
    }

    /// <summary>An <see cref="IApiHealthProbe"/> test double that replays a fixed sequence of probe results.</summary>
    private sealed class QueueProbe : IApiHealthProbe
    {
        private readonly Queue<ApiHealthProbeResult> _results;

        public QueueProbe(params ApiHealthProbeResult[] results) => _results = new Queue<ApiHealthProbeResult>(results);

        public Task<ApiHealthProbeResult> ProbeAsync(CancellationToken cancellationToken = default)
        {
            var next = _results.Count > 0 ? _results.Dequeue() : new ApiHealthProbeResult(true, 10, Now);
            return Task.FromResult(next);
        }
    }

    /// <summary>An <see cref="HttpMessageHandler"/> test double that maps each request through a responder
    /// callback, capturing the last request so the probe's URL and headers are asserted.</summary>
    private sealed class StubHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _responder;

        public StubHandler(Func<HttpRequestMessage, HttpResponseMessage> responder) => _responder = responder;

        public HttpRequestMessage? LastRequest { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            LastRequest = request;
            return Task.FromResult(_responder(request));
        }
    }
}
