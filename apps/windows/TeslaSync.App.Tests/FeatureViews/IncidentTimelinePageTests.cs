using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.FeatureViews.SystemOps;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the IncidentTimelinePage feature-view's UI-thread-free logic — the incident-detail /
/// update JSON adapters, the per-branch projection (status-badge tone, severity glyph + tone, the open/resolved
/// duration tiers, the newest-first timeline reversal, the affected-components and meta lines and the append-form
/// status options), the i18n key catalog, the contract-client-backed source's request shapes + error
/// classification (the web <c>useIncident</c> / <c>useAppendIncidentUpdate</c> / <c>usePatchIncident</c> hooks),
/// the state-holder view-model's read / append / resolve flows (including the toast + form-reset contract that
/// mirrors <c>useToast</c>), and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/system/pages/IncidentTimelinePage.tsx + web/src/api/hooks/useIncidents.ts). The WinUI view
/// itself (IncidentTimelinePage.cs) is exercised by the app build.
/// </summary>
public sealed class IncidentTimelinePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);

    // ── JSON adapters (web Incident / IncidentUpdateEntry) ───────────────────────────────────────────────

    [Fact]
    public void IncidentDetail_reads_every_rendered_field()
    {
        var incident = IncidentDetail.FromJson(Json(
            "{\"id\":42,\"title\":\"DB outage\",\"description\":\"Primary down\",\"severity\":\"critical\"," +
            "\"status\":\"monitoring\",\"source\":\"manual\",\"affected_components\":[\"api\",\"db\"]," +
            "\"started_at\":\"2026-01-01T10:00:00Z\",\"resolved_at\":\"2026-01-01T11:00:00Z\"," +
            "\"updates\":[{\"at\":\"2026-01-01T10:00:00Z\",\"status\":\"investigating\",\"message\":\"opened\"," +
            "\"author\":\"ops\"},{\"at\":\"2026-01-01T11:00:00Z\",\"status\":\"monitoring\",\"message\":\"fix applied\"}]}"));

        Assert.NotNull(incident);
        Assert.Equal(42, incident!.Id);
        Assert.Equal("DB outage", incident.Title);
        Assert.Equal("Primary down", incident.Description);
        Assert.Equal(IncidentSeverity.Critical, incident.Severity);
        Assert.Equal(IncidentStatus.Monitoring, incident.Status);
        Assert.Equal("manual", incident.Source);
        Assert.Equal(new[] { "api", "db" }, incident.AffectedComponents);
        Assert.Equal(2, incident.Updates.Count);
        Assert.Equal(new DateTimeOffset(2026, 1, 1, 10, 0, 0, TimeSpan.Zero), incident.StartedAt);
        Assert.Equal(new DateTimeOffset(2026, 1, 1, 11, 0, 0, TimeSpan.Zero), incident.ResolvedAt);
        Assert.False(incident.IsResolved);

        var first = incident.Updates[0];
        Assert.Equal(IncidentStatus.Investigating, first.Status);
        Assert.Equal("opened", first.Message);
        Assert.Equal("ops", first.Author);
        Assert.Null(incident.Updates[1].Author);
    }

    [Fact]
    public void IncidentDetail_tolerates_missing_optionals_and_defaults()
    {
        var incident = IncidentDetail.FromJson(Json("{\"id\":1,\"title\":\"x\"}"));

        Assert.NotNull(incident);
        Assert.Equal(string.Empty, incident!.Description);
        Assert.Equal(IncidentSeverity.Minor, incident.Severity);
        Assert.Equal(IncidentStatus.Investigating, incident.Status);
        Assert.Empty(incident.AffectedComponents);
        Assert.Empty(incident.Updates);
        Assert.Null(incident.StartedAt);
        Assert.Null(incident.ResolvedAt);
    }

    [Theory]
    [InlineData("{\"title\":\"no id\"}")]
    [InlineData("[]")]
    [InlineData("\"scalar\"")]
    public void IncidentDetail_without_numeric_id_is_null(string json)
    {
        Assert.Null(IncidentDetail.FromJson(Json(json)));
    }

    [Fact]
    public void IncidentDetail_marks_resolved_status()
    {
        var incident = IncidentDetail.FromJson(Json("{\"id\":1,\"status\":\"resolved\"}"));
        Assert.True(incident!.IsResolved);
    }

    // ── Request wire shapes (web Append / Patch payloads) ────────────────────────────────────────────────

    [Fact]
    public void AppendRequest_serializes_message_and_omits_null_status()
    {
        string json = JsonSerializer.Serialize(new AppendIncidentUpdateRequest("hello", null));
        Assert.Contains("\"message\":\"hello\"", json, StringComparison.Ordinal);
        Assert.DoesNotContain("status", json, StringComparison.Ordinal);
    }

    [Fact]
    public void AppendRequest_serializes_status_when_present()
    {
        string json = JsonSerializer.Serialize(new AppendIncidentUpdateRequest("hello", "monitoring"));
        Assert.Contains("\"status\":\"monitoring\"", json, StringComparison.Ordinal);
    }

    [Fact]
    public void PatchRequest_serializes_resolved_flag()
    {
        string json = JsonSerializer.Serialize(new PatchIncidentRequest(true));
        Assert.Contains("\"resolved\":true", json, StringComparison.Ordinal);
    }

    // ── Projection: tone tables (web SEVERITY_TONE / STATUS_BADGE) ────────────────────────────────────────

    [Theory]
    [InlineData(IncidentStatus.Investigating, TeslaSync.App.Core.StatusKind.Danger)]
    [InlineData(IncidentStatus.Identified, TeslaSync.App.Core.StatusKind.Warning)]
    [InlineData(IncidentStatus.Monitoring, TeslaSync.App.Core.StatusKind.Info)]
    [InlineData(IncidentStatus.Resolved, TeslaSync.App.Core.StatusKind.Success)]
    public void StatusTone_matches_web_status_badge(IncidentStatus status, TeslaSync.App.Core.StatusKind tone)
    {
        Assert.Equal(tone, IncidentTimelineProjection.StatusTone(status));
    }

    [Theory]
    [InlineData(IncidentSeverity.Minor, TeslaSync.App.Core.StatusKind.Warning)]
    [InlineData(IncidentSeverity.Major, TeslaSync.App.Core.StatusKind.Warning)]
    [InlineData(IncidentSeverity.Critical, TeslaSync.App.Core.StatusKind.Danger)]
    public void SeverityTone_matches_web_severity_tone(IncidentSeverity severity, TeslaSync.App.Core.StatusKind tone)
    {
        Assert.Equal(tone, IncidentTimelineProjection.SeverityTone(severity));
        Assert.False(string.IsNullOrEmpty(IncidentTimelineProjection.SeverityGlyph(severity)));
    }

    // ── Projection: fmtDuration tiers (web fmtDuration) ──────────────────────────────────────────────────

    [Fact]
    public void FormatDuration_walks_the_web_tiers()
    {
        Assert.Equal(string.Empty, IncidentTimelineProjection.FormatDuration(null, null, Now));
        Assert.Equal("30s", IncidentTimelineProjection.FormatDuration(Now.AddSeconds(-30), Now, Now));
        Assert.Equal("5m", IncidentTimelineProjection.FormatDuration(Now.AddMinutes(-5), Now, Now));
        Assert.Equal(
            "2h 3m",
            IncidentTimelineProjection.FormatDuration(Now.AddMinutes(-123), Now, Now));
        Assert.Equal(
            "1d 5h",
            IncidentTimelineProjection.FormatDuration(Now.AddHours(-29), Now, Now));
    }

    [Fact]
    public void FormatDuration_uses_now_when_end_is_open()
    {
        Assert.Equal("10m", IncidentTimelineProjection.FormatDuration(Now.AddMinutes(-10), null, Now));
    }

    // ── Projection: timeline reversal + author + status (web [...updates].reverse()) ─────────────────────

    [Fact]
    public void BuildRows_reverses_updates_newest_first_with_author_and_status()
    {
        var incident = IncidentDetail.FromJson(Json(
            "{\"id\":1,\"updates\":[" +
            "{\"at\":\"2026-01-01T10:00:00Z\",\"status\":\"investigating\",\"message\":\"first\"}," +
            "{\"at\":\"2026-01-01T11:00:00Z\",\"status\":\"monitoring\",\"message\":\"second\",\"author\":\"ops\"}]}"));

        var rows = IncidentTimelineProjection.BuildRows(incident!.Updates, Localizer, Now);

        Assert.Equal(2, rows.Count);
        Assert.Equal("second", rows[0].Message);
        Assert.True(rows[0].HasAuthor);
        Assert.Contains("ops", rows[0].AuthorText, StringComparison.Ordinal);
        Assert.Equal("Monitoring", rows[0].StatusText);
        Assert.Equal(TeslaSync.App.Core.StatusKind.Info, rows[0].StatusTone);
        Assert.Equal("first", rows[1].Message);
        Assert.False(rows[1].HasAuthor);
        Assert.Equal(string.Empty, rows[1].AuthorText);
    }

    // ── Projection: status options (web inline option array) ─────────────────────────────────────────────

    [Fact]
    public void BuildStatusOptions_keeps_current_then_four_targets()
    {
        var options = IncidentTimelineProjection.BuildStatusOptions(IncidentStatus.Monitoring, Localizer);

        Assert.Equal(5, options.Count);
        Assert.Null(options[0].Value);
        Assert.Contains("Monitoring", options[0].Label, StringComparison.Ordinal);
        Assert.Equal(
            new IncidentStatus?[]
            {
                null,
                IncidentStatus.Investigating,
                IncidentStatus.Identified,
                IncidentStatus.Monitoring,
                IncidentStatus.Resolved,
            },
            options.Select(o => o.Value).ToArray());
    }

    // ── Projection: top-level branches (web loading / not-found / success) ───────────────────────────────

    [Fact]
    public void Project_loading_branch_shows_spinner_subtitle()
    {
        var display = IncidentTimelineProjection.Project(
            new IncidentTimelineModel(null, true, null, 7), Localizer, Now);

        Assert.Equal(IncidentTimelineState.Loading, display.State);
        Assert.True(display.IsLoading);
        Assert.Equal("Incident", display.Title);
        Assert.Equal("Loading\u2026", display.Subtitle);
    }

    [Fact]
    public void Project_not_found_branch_embeds_the_route_id()
    {
        var display = IncidentTimelineProjection.Project(
            new IncidentTimelineModel(null, false, new RepositoryError(RepositoryErrorKind.NotFound, "x"), 99),
            Localizer,
            Now);

        Assert.Equal(IncidentTimelineState.NotFound, display.State);
        Assert.False(display.IsLoading);
        Assert.Equal("Not found", display.Subtitle);
        Assert.Contains("99", display.NotFoundText, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_ready_branch_projects_open_header_timeline_and_form()
    {
        var incident = IncidentDetail.FromJson(Json(
            "{\"id\":12,\"title\":\"Wall connector restart\",\"description\":\"desc\",\"severity\":\"major\"," +
            "\"status\":\"identified\",\"source\":\"auto\",\"affected_components\":[\"tesla\"]," +
            "\"started_at\":\"2026-01-01T11:00:00Z\"," +
            "\"updates\":[{\"at\":\"2026-01-01T11:00:00Z\",\"status\":\"identified\",\"message\":\"opened\"}]}"));

        var display = IncidentTimelineProjection.Project(
            new IncidentTimelineModel(incident, false, null, 12), Localizer, Now);

        Assert.Equal(IncidentTimelineState.Ready, display.State);
        Assert.Equal("Wall connector restart", display.Title);
        Assert.Equal("Incident #12", display.Subtitle);
        Assert.Equal("Identified", display.StatusText);
        Assert.Equal(TeslaSync.App.Core.StatusKind.Warning, display.StatusTone);
        Assert.True(display.HasSource);
        Assert.Equal("auto", display.SourceText);
        Assert.True(display.HasDescription);
        Assert.True(display.HasAffects);
        Assert.Contains("tesla", display.AffectsText, StringComparison.Ordinal);
        Assert.Contains("Started", display.MetaText, StringComparison.Ordinal);
        Assert.False(display.IsResolved);
        Assert.StartsWith("Open", display.DurationBadgeText, StringComparison.Ordinal);
        Assert.Equal(TeslaSync.App.Core.StatusKind.Neutral, display.DurationBadgeTone);
        Assert.Single(display.Rows);
        Assert.Contains("1 entries", display.EntriesText, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_resolved_incident_hides_open_badge_and_uses_success_tone()
    {
        var incident = IncidentDetail.FromJson(Json(
            "{\"id\":3,\"title\":\"closed\",\"status\":\"resolved\"," +
            "\"started_at\":\"2026-01-01T10:00:00Z\",\"resolved_at\":\"2026-01-01T10:30:00Z\"}"));

        var display = IncidentTimelineProjection.Project(
            new IncidentTimelineModel(incident, false, null, 3), Localizer, Now);

        Assert.True(display.IsResolved);
        Assert.StartsWith("Resolved", display.DurationBadgeText, StringComparison.Ordinal);
        Assert.Equal(TeslaSync.App.Core.StatusKind.Success, display.DurationBadgeTone);
        Assert.Contains("Resolved", display.MetaText, StringComparison.Ordinal);
    }

    // ── i18n key catalog (every projected literal flows through a key) ───────────────────────────────────

    [Fact]
    public void Every_projected_string_routes_through_a_catalogued_key()
    {
        var recorder = new RecordingLocalizer();
        var incident = IncidentDetail.FromJson(Json(
            "{\"id\":1,\"title\":\"t\",\"status\":\"investigating\",\"affected_components\":[\"a\"]," +
            "\"updates\":[{\"at\":\"2026-01-01T10:00:00Z\",\"status\":\"investigating\",\"message\":\"m\"}]}"));

        _ = IncidentTimelineProjection.Project(new IncidentTimelineModel(incident, false, null, 1), recorder, Now);

        Assert.NotEmpty(recorder.Keys);
        Assert.All(recorder.Keys, key => Assert.Contains(key, IncidentTimelineStrings.AllKeys));
    }

    [Fact]
    public void Status_and_severity_labels_reuse_the_shared_incident_keys()
    {
        Assert.Equal("status.incidents.status.investigating", IncidentTimelineStrings.StatusInvestigating);
        Assert.Equal("status.incidents.severity.critical", IncidentTimelineStrings.SeverityCritical);
    }

    // ── Registration: generated operation ids (ADR-004) ──────────────────────────────────────────────────

    [Fact]
    public void Registration_binds_the_three_generated_incident_operations()
    {
        Assert.Equal("get_api_v1_status_incidents_id", IncidentTimelineRegistration.FetchOperation);
        Assert.Equal("post_api_v1_status_incidents_id_updates", IncidentTimelineRegistration.AppendOperation);
        Assert.Equal("patch_api_v1_status_incidents_id", IncidentTimelineRegistration.PatchOperation);
        Assert.Equal("IncidentTimeline", IncidentTimelineRegistration.RouteName);
        Assert.Equal("id", IncidentTimelineRegistration.IdParam);
    }

    // ── Source: contract-client request shapes + error classification ────────────────────────────────────

    [Fact]
    public async Task ClientSource_fetch_targets_the_detail_operation_with_the_id_path()
    {
        var api = new FakeApiClient { Response = "{\"id\":5,\"title\":\"x\"}" };
        var source = new IncidentTimelineClientSource(api);

        var fetch = await source.FetchAsync(5);

        Assert.Equal("get_api_v1_status_incidents_id", api.Last!.OperationId);
        Assert.Equal("5", api.Last.PathParams!["id"]);
        Assert.NotNull(fetch.Incident);
        Assert.Equal(5, fetch.Incident!.Id);
    }

    [Fact]
    public async Task ClientSource_fetch_maps_a_404_to_a_not_found_failure()
    {
        var api = new FakeApiClient { Failure = new ApiException("nope", 404) };
        var source = new IncidentTimelineClientSource(api);

        var fetch = await source.FetchAsync(5);

        Assert.Null(fetch.Incident);
        Assert.Equal(RepositoryErrorKind.NotFound, fetch.Error!.Kind);
    }

    [Fact]
    public async Task ClientSource_append_posts_to_the_updates_operation_and_returns_the_incident()
    {
        var api = new FakeApiClient { Response = "{\"id\":5,\"status\":\"monitoring\"}" };
        var source = new IncidentTimelineClientSource(api);

        var outcome = await source.AppendUpdateAsync(5, new AppendIncidentUpdateRequest("m", "monitoring"));

        Assert.Equal("post_api_v1_status_incidents_id_updates", api.Last!.OperationId);
        Assert.Equal("5", api.Last.PathParams!["id"]);
        Assert.True(outcome.Success);
        Assert.Equal(IncidentStatus.Monitoring, outcome.Incident!.Status);
    }

    [Fact]
    public async Task ClientSource_patch_targets_the_patch_operation()
    {
        var api = new FakeApiClient { Response = "{\"id\":5,\"status\":\"resolved\"}" };
        var source = new IncidentTimelineClientSource(api);

        var outcome = await source.PatchAsync(5, new PatchIncidentRequest(true));

        Assert.Equal("patch_api_v1_status_incidents_id", api.Last!.OperationId);
        Assert.True(outcome.Success);
        Assert.True(outcome.Incident!.IsResolved);
    }

    [Fact]
    public async Task ClientSource_mutation_classifies_a_fault()
    {
        var api = new FakeApiClient { Failure = new ApiException("boom", 500) };
        var source = new IncidentTimelineClientSource(api);

        var outcome = await source.PatchAsync(5, new PatchIncidentRequest(true));

        Assert.False(outcome.Success);
        Assert.Equal(RepositoryErrorKind.Server, outcome.Error!.Kind);
    }

    // ── View-model: read state machine (web useIncident) ─────────────────────────────────────────────────

    [Fact]
    public void ViewModel_starts_in_the_loading_state()
    {
        using var vm = NewViewModel(new FakeSource(), out _);
        Assert.Equal(IncidentTimelineState.Loading, vm.State);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_load_success_enters_ready_and_stamps_updated_at()
    {
        var source = new FakeSource { FetchResult = IncidentTimelineFetch.Loaded(SampleIncident()) };
        using var vm = NewViewModel(source, out _);

        await vm.LoadAsync();

        Assert.Equal(IncidentTimelineState.Ready, vm.State);
        Assert.False(vm.IsError);
        Assert.Equal(1, source.FetchCalls);
        Assert.Equal(Now, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_load_failure_enters_not_found()
    {
        var source = new FakeSource
        {
            FetchResult = IncidentTimelineFetch.Failed(new RepositoryError(RepositoryErrorKind.NotFound, "x")),
        };
        using var vm = NewViewModel(source, out _);

        await vm.LoadAsync();

        Assert.Equal(IncidentTimelineState.NotFound, vm.State);
        Assert.True(vm.IsError);
    }

    // ── View-model: append (web handleAppend) ────────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_append_with_blank_message_toasts_and_skips_the_write()
    {
        var source = new FakeSource { FetchResult = IncidentTimelineFetch.Loaded(SampleIncident()) };
        using var vm = NewViewModel(source, out var toasts);
        await vm.LoadAsync();

        vm.Message = "   ";
        bool ok = await vm.AppendUpdateAsync();

        Assert.False(ok);
        Assert.Equal(0, source.AppendCalls);
        var toast = Assert.Single(toasts);
        Assert.True(toast.IsError);
        Assert.Equal("Update message is required.", toast.Message);
    }

    [Fact]
    public async Task ViewModel_append_success_clears_form_and_applies_refreshed_incident()
    {
        var refreshed = IncidentDetail.FromJson(Json(
            "{\"id\":1,\"status\":\"monitoring\",\"updates\":[" +
            "{\"at\":\"2026-01-01T10:00:00Z\",\"status\":\"investigating\",\"message\":\"a\"}," +
            "{\"at\":\"2026-01-01T11:00:00Z\",\"status\":\"monitoring\",\"message\":\"b\"}]}"))!;
        var source = new FakeSource
        {
            FetchResult = IncidentTimelineFetch.Loaded(SampleIncident()),
            AppendResult = IncidentMutationOutcome.Ok(refreshed),
        };
        using var vm = NewViewModel(source, out var toasts);
        await vm.LoadAsync();

        vm.Message = "  mitigation applied  ";
        vm.NextStatus = IncidentStatus.Monitoring;
        bool ok = await vm.AppendUpdateAsync();

        Assert.True(ok);
        Assert.Equal(1, source.AppendCalls);
        Assert.Equal("mitigation applied", source.LastAppend!.Message);
        Assert.Equal("monitoring", source.LastAppend.Status);
        Assert.Equal(string.Empty, vm.Message);
        Assert.Null(vm.NextStatus);
        Assert.Equal(2, vm.Display.Rows.Count);
        Assert.Contains(toasts, t => !t.IsError && t.Message == "Update added.");
    }

    [Fact]
    public async Task ViewModel_append_failure_raises_the_error_toast()
    {
        var source = new FakeSource
        {
            FetchResult = IncidentTimelineFetch.Loaded(SampleIncident()),
            AppendResult = IncidentMutationOutcome.Fail(new RepositoryError(RepositoryErrorKind.Server, "x")),
        };
        using var vm = NewViewModel(source, out var toasts);
        await vm.LoadAsync();

        vm.Message = "note";
        bool ok = await vm.AppendUpdateAsync();

        Assert.False(ok);
        Assert.Contains(toasts, t => t.IsError && t.Message == "Failed to append update");
    }

    // ── View-model: resolve (web handleResolve) ──────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_resolve_patches_resolved_true_and_applies_the_result()
    {
        var resolved = IncidentDetail.FromJson(Json("{\"id\":1,\"status\":\"resolved\"}"))!;
        var source = new FakeSource
        {
            FetchResult = IncidentTimelineFetch.Loaded(SampleIncident()),
            PatchResult = IncidentMutationOutcome.Ok(resolved),
        };
        using var vm = NewViewModel(source, out var toasts);
        await vm.LoadAsync();

        bool ok = await vm.ResolveAsync();

        Assert.True(ok);
        Assert.Equal(1, source.PatchCalls);
        Assert.True(source.LastPatch!.Resolved);
        Assert.True(vm.Display.IsResolved);
        Assert.Contains(toasts, t => !t.IsError && t.Message == "Incident resolved.");
    }

    [Fact]
    public async Task ViewModel_resolve_failure_raises_the_error_toast()
    {
        var source = new FakeSource
        {
            FetchResult = IncidentTimelineFetch.Loaded(SampleIncident()),
            PatchResult = IncidentMutationOutcome.Fail(new RepositoryError(RepositoryErrorKind.Server, "x")),
        };
        using var vm = NewViewModel(source, out var toasts);
        await vm.LoadAsync();

        bool ok = await vm.ResolveAsync();

        Assert.False(ok);
        Assert.Contains(toasts, t => t.IsError && t.Message == "Failed to resolve");
    }

    // ── Diagnostics (PII-safe counters) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_count_open_append_and_resolve_without_leaking_content()
    {
        var lines = new List<string>();
        var diagnostics = new IncidentTimelineDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordUpdateAppended();
        diagnostics.RecordIncidentResolved();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.UpdatesAppended);
        Assert.Equal(1, diagnostics.IncidentsResolved);
        Assert.All(lines, line => Assert.Contains("slug=IncidentTimelinePage", line, StringComparison.Ordinal));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────

    private static IncidentTimelinePageViewModel NewViewModel(
        IIncidentTimelineSource source,
        out List<IncidentTimelineToast> toasts)
    {
        var captured = new List<IncidentTimelineToast>();
        var vm = new IncidentTimelinePageViewModel(source, Localizer, 1, () => Now);
        vm.ToastRequested += (_, toast) => captured.Add(toast);
        toasts = captured;
        return vm;
    }

    private static IncidentDetail SampleIncident() =>
        IncidentDetail.FromJson(Json(
            "{\"id\":1,\"title\":\"Sample\",\"status\":\"investigating\"," +
            "\"started_at\":\"2026-01-01T11:00:00Z\"," +
            "\"updates\":[{\"at\":\"2026-01-01T11:00:00Z\",\"status\":\"investigating\",\"message\":\"opened\"}]}"))!;

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private sealed class FakeSource : IIncidentTimelineSource
    {
        public int FetchCalls { get; private set; }

        public int AppendCalls { get; private set; }

        public int PatchCalls { get; private set; }

        public long LastId { get; private set; }

        public AppendIncidentUpdateRequest? LastAppend { get; private set; }

        public PatchIncidentRequest? LastPatch { get; private set; }

        public IncidentTimelineFetch FetchResult { get; set; } =
            IncidentTimelineFetch.Failed(new RepositoryError(RepositoryErrorKind.NotFound, "x"));

        public IncidentMutationOutcome AppendResult { get; set; } = IncidentMutationOutcome.Ok(null);

        public IncidentMutationOutcome PatchResult { get; set; } = IncidentMutationOutcome.Ok(null);

        public Task<IncidentTimelineFetch> FetchAsync(long incidentId, CancellationToken cancellationToken = default)
        {
            FetchCalls++;
            LastId = incidentId;
            return Task.FromResult(FetchResult);
        }

        public Task<IncidentMutationOutcome> AppendUpdateAsync(
            long incidentId,
            AppendIncidentUpdateRequest request,
            CancellationToken cancellationToken = default)
        {
            AppendCalls++;
            LastId = incidentId;
            LastAppend = request;
            return Task.FromResult(AppendResult);
        }

        public Task<IncidentMutationOutcome> PatchAsync(
            long incidentId,
            PatchIncidentRequest request,
            CancellationToken cancellationToken = default)
        {
            PatchCalls++;
            LastId = incidentId;
            LastPatch = request;
            return Task.FromResult(PatchResult);
        }
    }

    private sealed class FakeApiClient : IApiClient
    {
        public ApiRequest? Last { get; private set; }

        public string Response { get; set; } = "{}";

        public Exception? Failure { get; set; }

        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            throw new NotSupportedException();

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
        {
            Last = request;
            if (Failure is { } error)
            {
                return Task.FromException<T>(error);
            }

            using var doc = JsonDocument.Parse(Response);
            object element = doc.RootElement.Clone();
            return Task.FromResult((T)element);
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
