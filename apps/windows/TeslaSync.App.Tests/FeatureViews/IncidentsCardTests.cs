using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;
using IncidentList = System.Collections.Generic.IReadOnlyList<TeslaSync.App.FeatureViews.IncidentSummary>;
using IncidentResult = TeslaSync.App.Core.Data.State.RepositoryResult<
    System.Collections.Generic.IReadOnlyList<TeslaSync.App.FeatureViews.IncidentSummary>>;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the IncidentsCard feature-view's UI-thread-free logic — the active-incident JSON
/// adapter, the per-state / per-branch projection (status-badge tone, severity glyph + tone, the affected-
/// components line, the relative "Started …" tiers and the per-row Narrator name), the i18n key catalog, the
/// cache-then-network state-holder transitions (loading / loaded / empty / stale / offline / error), and the
/// PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/system/components/status/IncidentsCard.tsx). The WinUI view itself is exercised by the app
/// build.
/// </summary>
public sealed class IncidentsCardTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    // ---- Incident JSON adapter (web IncidentListResponse) ----------------------------------------------

    [Fact]
    public void ParseList_reads_every_field_from_the_envelope()
    {
        var incidents = IncidentSummary.ParseList(Json(
            "{\"incidents\":[{\"id\":7,\"title\":\"DB outage\",\"severity\":\"critical\"," +
            "\"status\":\"identified\",\"affected_components\":[\"api\",\"db\"]," +
            "\"updates\":[{\"at\":\"x\"},{\"at\":\"y\"},{\"at\":\"z\"}]," +
            "\"started_at\":\"2025-12-31T23:55:00Z\"}],\"count\":1}"));

        var incident = Assert.Single(incidents);
        Assert.Equal(7, incident.Id);
        Assert.Equal("DB outage", incident.Title);
        Assert.Equal(IncidentSeverity.Critical, incident.Severity);
        Assert.Equal(IncidentStatus.Identified, incident.Status);
        Assert.Equal(new[] { "api", "db" }, incident.AffectedComponents);
        Assert.Equal(3, incident.UpdateCount);
        Assert.Equal(new DateTimeOffset(2025, 12, 31, 23, 55, 0, TimeSpan.Zero), incident.StartedAt);
    }

    [Fact]
    public void ParseList_tolerates_a_bare_array_and_missing_optional_fields()
    {
        var incidents = IncidentSummary.ParseList(Json("[{\"id\":1,\"title\":\"x\"}]"));

        var incident = Assert.Single(incidents);
        Assert.Equal(IncidentSeverity.Minor, incident.Severity);
        Assert.Equal(IncidentStatus.Investigating, incident.Status);
        Assert.Empty(incident.AffectedComponents);
        Assert.Equal(0, incident.UpdateCount);
        Assert.Null(incident.StartedAt);
    }

    [Fact]
    public void ParseList_skips_rows_without_an_id()
    {
        var incidents = IncidentSummary.ParseList(Json(
            "{\"incidents\":[{\"title\":\"no id\"},{\"id\":2,\"title\":\"ok\"}]}"));

        Assert.Equal(2, Assert.Single(incidents).Id);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("\"oops\"")]
    [InlineData("123")]
    [InlineData("[]")]
    [InlineData("{}")]
    [InlineData("{\"incidents\":[]}")]
    [InlineData("{\"incidents\":\"nope\"}")]
    public void ParseList_non_lists_and_empty_lists_yield_no_incidents(string raw) =>
        Assert.Empty(IncidentSummary.ParseList(Json(raw)));

    [Theory]
    [InlineData("minor", IncidentSeverity.Minor)]
    [InlineData("MAJOR", IncidentSeverity.Major)]
    [InlineData("Critical", IncidentSeverity.Critical)]
    [InlineData("bogus", IncidentSeverity.Minor)]
    [InlineData(null, IncidentSeverity.Minor)]
    public void ParseSeverity_is_case_insensitive_with_minor_fallback(string? raw, IncidentSeverity expected) =>
        Assert.Equal(expected, IncidentSummary.ParseSeverity(raw));

    [Theory]
    [InlineData("investigating", IncidentStatus.Investigating)]
    [InlineData("IDENTIFIED", IncidentStatus.Identified)]
    [InlineData("Monitoring", IncidentStatus.Monitoring)]
    [InlineData("resolved", IncidentStatus.Resolved)]
    [InlineData("bogus", IncidentStatus.Investigating)]
    [InlineData(null, IncidentStatus.Investigating)]
    public void ParseStatus_is_case_insensitive_with_investigating_fallback(string? raw, IncidentStatus expected) =>
        Assert.Equal(expected, IncidentSummary.ParseStatus(raw));

    // ---- Projection: status badge tone (web STATUS_BADGE map) ------------------------------------------

    [Theory]
    [InlineData(IncidentStatus.Investigating, StatusKind.Danger)]
    [InlineData(IncidentStatus.Identified, StatusKind.Warning)]
    [InlineData(IncidentStatus.Monitoring, StatusKind.Info)]
    [InlineData(IncidentStatus.Resolved, StatusKind.Success)]
    public void Projection_maps_status_to_the_badge_tone(IncidentStatus status, StatusKind expected)
    {
        var row = ProjectRow(Incident(status: status));
        Assert.Equal(expected, row.StatusStatus);
    }

    [Theory]
    [InlineData(IncidentSeverity.Minor, StatusKind.Warning, IncidentsProjection.MinorGlyph, "minor")]
    [InlineData(IncidentSeverity.Major, StatusKind.Warning, IncidentsProjection.MajorGlyph, "major")]
    [InlineData(IncidentSeverity.Critical, StatusKind.Danger, IncidentsProjection.CriticalGlyph, "critical")]
    public void Projection_maps_severity_to_glyph_tone_and_label(
        IncidentSeverity severity,
        StatusKind tone,
        string glyph,
        string label)
    {
        var row = ProjectRow(Incident(severity: severity));
        Assert.Equal(tone, row.SeverityStatus);
        Assert.Equal(glyph, row.SeverityGlyph);
        Assert.Equal(label, row.SeverityLabel);
    }

    [Fact]
    public void Projection_renders_the_affects_line_only_when_components_are_present()
    {
        var withComponents = ProjectRow(Incident(affects: new[] { "api", "db" }));
        Assert.True(withComponents.HasAffects);
        Assert.Equal("Affects: api, db", withComponents.AffectsText);

        var without = ProjectRow(Incident(affects: Array.Empty<string>()));
        Assert.False(without.HasAffects);
        Assert.Equal(string.Empty, without.AffectsText);
    }

    [Fact]
    public void Projection_meta_line_carries_started_and_pluralizes_updates_above_one()
    {
        var single = ProjectRow(Incident(startedAt: Now.AddMinutes(-5), updates: 1));
        Assert.Equal("Started 5m ago", single.MetaText);

        var many = ProjectRow(Incident(startedAt: Now.AddMinutes(-5), updates: 3));
        Assert.Equal("Started 5m ago \u00B7 3 updates", many.MetaText);
    }

    [Fact]
    public void Projection_meta_line_omits_the_relative_time_when_started_is_unknown()
    {
        var row = ProjectRow(Incident(startedAt: null));
        Assert.Equal("Started", row.MetaText);
    }

    [Theory]
    [InlineData(30, "Started just now")]
    [InlineData(5 * 60, "Started 5m ago")]
    [InlineData(3 * 3600, "Started 3h ago")]
    [InlineData(2 * 86400, "Started 2d ago")]
    public void Projection_reproduces_the_web_relativeFrom_tiers(int secondsAgo, string expected)
    {
        var row = ProjectRow(Incident(startedAt: Now.AddSeconds(-secondsAgo)));
        Assert.Equal(expected, row.MetaText);
    }

    [Fact]
    public void Projection_header_carries_title_glyph_and_active_count()
    {
        var display = IncidentsProjection.Project(
            new[] { Incident(id: 1), Incident(id: 2) },
            Localizer,
            Now);

        Assert.Equal("Active incidents", display.Title);
        Assert.Equal(IncidentsProjection.HeaderGlyph, display.HeaderGlyph);
        Assert.True(display.ShowCount);
        Assert.Equal(2, display.Count);
        Assert.Equal("Log incident", display.LogIncidentText);
        Assert.Equal(2, display.Incidents.Count);
    }

    [Fact]
    public void Projection_empty_list_hides_the_count_and_carries_the_empty_copy()
    {
        var display = IncidentsProjection.Project(Array.Empty<IncidentSummary>(), Localizer, Now);

        Assert.False(display.ShowCount);
        Assert.Equal(0, display.Count);
        Assert.Empty(display.Incidents);
        Assert.Equal("No active incidents", display.EmptyTitle);
        Assert.False(string.IsNullOrWhiteSpace(display.EmptyMessage));
    }

    [Fact]
    public void Projection_preserves_server_order()
    {
        var display = IncidentsProjection.Project(
            new[] { Incident(id: 10, title: "first"), Incident(id: 20, title: "second") },
            Localizer,
            Now);

        Assert.Equal(10, display.Incidents[0].Id);
        Assert.Equal(20, display.Incidents[1].Id);
    }

    // ---- i18n catalog ----------------------------------------------------------------------------------

    [Fact]
    public void I18n_catalog_contains_every_surface_key()
    {
        var keys = IncidentsStrings.AllKeys;

        Assert.Contains("status.incidents.title", keys);
        Assert.Contains("status.incidents.log", keys);
        Assert.Contains("status.incidents.affects", keys);
        Assert.Contains("status.incidents.started", keys);
        Assert.Contains("status.incidents.updates", keys);
        Assert.Contains("status.incidents.open", keys);
        Assert.Contains("status.incidents.severity.minor", keys);
        Assert.Contains("status.incidents.severity.major", keys);
        Assert.Contains("status.incidents.severity.critical", keys);
        Assert.Contains("status.incidents.status.investigating", keys);
        Assert.Contains("status.incidents.status.identified", keys);
        Assert.Contains("status.incidents.status.monitoring", keys);
        Assert.Contains("status.incidents.status.resolved", keys);
        Assert.Contains("status.incidents.time.justNow", keys);
        Assert.Contains("status.incidents.time.minutesAgo", keys);
        Assert.Contains("status.incidents.time.hoursAgo", keys);
        Assert.Contains("status.incidents.time.daysAgo", keys);
        Assert.Contains("status.incidents.empty.title", keys);
        Assert.Contains("status.incidents.empty.message", keys);
    }

    [Fact]
    public void I18n_catalog_has_no_duplicate_keys()
    {
        var keys = IncidentsStrings.AllKeys;
        Assert.Equal(keys, keys.Distinct().ToList());
    }

    // ---- Accessibility names ---------------------------------------------------------------------------

    [Fact]
    public void Accessibility_surface_name_includes_the_active_count()
    {
        var display = IncidentsProjection.Project(new[] { Incident(id: 1) }, Localizer, Now);
        Assert.Equal("Active incidents (1)", display.AutomationName);

        var emptyDisplay = IncidentsProjection.Project(Array.Empty<IncidentSummary>(), Localizer, Now);
        Assert.Equal("Active incidents", emptyDisplay.AutomationName);
    }

    [Fact]
    public void Accessibility_row_name_includes_title_severity_status_meta_and_affects()
    {
        var row = ProjectRow(Incident(
            title: "API latency",
            severity: IncidentSeverity.Major,
            status: IncidentStatus.Monitoring,
            affects: new[] { "api" },
            startedAt: Now.AddMinutes(-2),
            updates: 1));

        Assert.Contains("API latency", row.AutomationName);
        Assert.Contains("major", row.AutomationName);
        Assert.Contains("monitoring", row.AutomationName);
        Assert.Contains("Started 2m ago", row.AutomationName);
        Assert.Contains("Affects: api", row.AutomationName);
        Assert.Equal("View incident timeline", row.OpenLabel);
    }

    // ---- State holder: cache-then-network transitions --------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_incidents()
    {
        var source = new FakeIncidentsSource(
            IncidentResult.Loading(),
            IncidentResult.Loaded(List(Incident(id: 1, title: "outage")), Now));
        using var vm = new IncidentsCardViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(IncidentsState.Loaded, vm.State);
        Assert.Single(vm.Incidents);
        Assert.False(vm.IsError);
        Assert.Single(vm.Display.Incidents);
        Assert.True(vm.Display.ShowCount);
    }

    [Fact]
    public async Task ViewModel_empty_response_sets_empty_state()
    {
        var source = new FakeIncidentsSource(IncidentResult.Loading(), IncidentResult.Empty(Now));
        using var vm = new IncidentsCardViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(IncidentsState.Empty, vm.State);
        Assert.Empty(vm.Incidents);
        Assert.False(vm.Display.ShowCount);
    }

    [Fact]
    public async Task ViewModel_stale_cache_sets_stale_state()
    {
        var source = new FakeIncidentsSource(
            IncidentResult.Loading(),
            IncidentResult.Cached(List(Incident(id: 1)), Now, stale: true));
        using var vm = new IncidentsCardViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(IncidentsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.Single(vm.Incidents);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_cached_incidents_and_message()
    {
        var source = new FakeIncidentsSource(
            IncidentResult.Loading(),
            IncidentResult.OfflineCached(
                List(Incident(id: 1)),
                Now,
                new RepositoryError(RepositoryErrorKind.Network, "down")));
        using var vm = new IncidentsCardViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(IncidentsState.Offline, vm.State);
        Assert.Single(vm.Incidents);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_hard_failure_sets_error_state()
    {
        var source = new FakeIncidentsSource(
            IncidentResult.Loading(),
            IncidentResult.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        using var vm = new IncidentsCardViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(IncidentsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_unauthorized_failure_uses_the_auth_message()
    {
        var source = new FakeIncidentsSource(
            IncidentResult.Failure(new RepositoryError(RepositoryErrorKind.Unauthorized, "401")));
        using var vm = new IncidentsCardViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal("Sign in to view incidents", vm.ErrorMessage);
    }

    [Fact]
    public async Task ViewModel_counts_attempts_across_retries()
    {
        var source = new FakeIncidentsSource(IncidentResult.Loading(), IncidentResult.Empty(Now));
        using var vm = new IncidentsCardViewModel(source, Localizer);

        await vm.LoadAsync();
        await vm.RetryAsync();

        Assert.Equal(2, vm.Attempts);
        Assert.True(source.StreamCount >= 2);
    }

    // ---- Diagnostics & registration --------------------------------------------------------------------

    [Fact]
    public void Diagnostics_records_view_opened_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new IncidentsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1L, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=IncidentsCard", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_stable_metadata()
    {
        Assert.Equal("IncidentsCard", IncidentsRegistration.Slug);
        Assert.Equal("get_api_v1_status_incidents", IncidentsRegistration.ListOperation);
        Assert.Equal("get_api_v1_status_incidents_id", IncidentsRegistration.DetailOperation);
    }

    [Fact]
    public void Registration_operation_ids_resolve_against_the_generated_endpoint_table()
    {
        Assert.Contains(
            GeneratedApi.ApiEndpoints.All,
            e => e.OperationId == IncidentsRegistration.ListOperation && e.Method == GeneratedApi.HttpMethod.Get);
        Assert.Contains(
            GeneratedApi.ApiEndpoints.All,
            e => e.OperationId == IncidentsRegistration.DetailOperation && e.Method == GeneratedApi.HttpMethod.Get);
    }

    // ---- helpers ---------------------------------------------------------------------------------------

    private static IncidentSummary Incident(
        long id = 1,
        string title = "Incident",
        IncidentSeverity severity = IncidentSeverity.Major,
        IncidentStatus status = IncidentStatus.Investigating,
        IReadOnlyList<string>? affects = null,
        DateTimeOffset? startedAt = null,
        int updates = 1) =>
        new(id, title, severity, status, affects ?? Array.Empty<string>(), startedAt, updates);

    private static IncidentRow ProjectRow(IncidentSummary incident) =>
        Assert.Single(IncidentsProjection.ProjectRows(new[] { incident }, Localizer, Now));

    private static IncidentList List(params IncidentSummary[] incidents) => incidents;

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private sealed class FakeIncidentsSource : IIncidentsSource
    {
        private readonly IncidentResult[] _emissions;

        public FakeIncidentsSource(params IncidentResult[] emissions) => _emissions = emissions;

        public int StreamCount { get; private set; }

        public async IAsyncEnumerable<IncidentResult> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            StreamCount++;
            foreach (var emission in _emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }
}
