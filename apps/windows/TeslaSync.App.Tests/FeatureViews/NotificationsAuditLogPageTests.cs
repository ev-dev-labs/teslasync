using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Notifications;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the notifications <c>AuditLogPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/notifications/pages/AuditLogPage.tsx), the tolerant <c>/system/audit</c> parser, the client-side
/// substring filter (web <c>useFilteredList</c>) and the view-model's four-state matrix (loading / empty / error /
/// success). The WinUI view is exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="NotificationsAuditLogDisplay"/> flags asserted here.
/// </summary>
public sealed class NotificationsAuditLogPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 12 i18n keys the manifest requires the page to resolve (string-group:notifications/AuditLog).
    private static readonly string[] RequiredStringKeys =
    [
        "Action",
        "Audit Log",
        "Details",
        "Failed to load audit logs",
        "No audit entries found",
        "Recent Activity",
        "Recent system-level changes recorded by the audit subsystem",
        "Resource",
        "Time",
        "audit.filterLabel.search",
        "audit.noMatches",
        "audit.searchPlaceholder", // parity:allow required web i18n key for the audit search prompt
    ];

    private static AuditLogEntry Entry(
        string id = "1",
        string action = "vehicle.command",
        string resource = "vehicle",
        string details = "wake_up",
        string createdAt = "2026-06-13T11:30:00Z") => new(id, action, resource, details, createdAt);

    private static NotificationsAuditLogModel Loaded(params AuditLogEntry[] entries) =>
        NotificationsAuditLogModel.Initial with { Loading = false, Entries = entries };

    // ── i18n key coverage (all 12 manifest strings) ──────────────────────────────────

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = NotificationsAuditLogProjection.Project(Loaded(Entry()), recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        // Chrome strings are resolved on every projection regardless of data state (visibility is gated separately).
        _ = NotificationsAuditLogProjection.Project(NotificationsAuditLogModel.Initial, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ── Four data states ─────────────────────────────────────────────────────────────

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = NotificationsAuditLogProjection.Project(NotificationsAuditLogModel.Initial, Localizer);

        Assert.Equal(NotificationsAuditLogState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_rows()
    {
        var display = NotificationsAuditLogProjection.Project(Loaded(), Localizer);

        Assert.Equal(NotificationsAuditLogState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.Equal("No audit entries found", display.EmptyText);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_error_shows_failure_surface_with_detail()
    {
        var model = NotificationsAuditLogModel.Initial with { Loading = false, HasError = true, ErrorDetail = "boom" };
        var display = NotificationsAuditLogProjection.Project(model, Localizer);

        Assert.Equal(NotificationsAuditLogState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Contains("Failed to load audit logs", display.ErrorText, StringComparison.Ordinal);
        Assert.Contains("boom", display.ErrorText, StringComparison.Ordinal);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_success_when_rows_present()
    {
        var display = NotificationsAuditLogProjection.Project(Loaded(Entry()), Localizer);

        Assert.Equal(NotificationsAuditLogState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.True(display.ShowTable);
        Assert.Single(display.Rows);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowNoMatches);
    }

    // ── Search / filter (web useFilteredList) ────────────────────────────────────────

    [Fact]
    public void Search_filters_rows_and_raises_the_chip()
    {
        var model = Loaded(Entry(action: "login"), Entry(id: "2", action: "vehicle.command")) with { Search = "login" };
        var display = NotificationsAuditLogProjection.Project(model, Localizer);

        Assert.Equal(NotificationsAuditLogState.Success, display.State);
        Assert.True(display.ShowTable);
        Assert.Single(display.Rows);
        Assert.True(display.ShowSearchChip);
        Assert.Equal("login", display.SearchChipValue);
        Assert.Equal("Search", display.SearchChipLabel);
    }

    [Fact]
    public void Search_with_no_matches_shows_the_no_matches_sentence()
    {
        var model = Loaded(Entry(action: "login")) with { Search = "zzz" };
        var display = NotificationsAuditLogProjection.Project(model, Localizer);

        // The raw feed is non-empty, so the page stays in success (search area visible) but the table collapses.
        Assert.Equal(NotificationsAuditLogState.Success, display.State);
        Assert.False(display.ShowTable);
        Assert.True(display.ShowNoMatches);
        Assert.Equal("No audit entries match your search.", display.NoMatchesText);
        Assert.Empty(display.Rows);
        Assert.True(display.ShowSearchChip);
    }

    [Fact]
    public void Search_matches_resource_and_details_case_insensitively()
    {
        var model = Loaded(Entry(action: "a", resource: "Vehicle", details: "d")) with { Search = "vehi" };
        var display = NotificationsAuditLogProjection.Project(model, Localizer);

        Assert.Single(display.Rows);
    }

    // ── Row projection ───────────────────────────────────────────────────────────────

    [Fact]
    public void Row_projects_the_four_cells()
    {
        var display = NotificationsAuditLogProjection.Project(Loaded(Entry()), Localizer);
        var row = Assert.Single(display.Rows);

        Assert.Equal("vehicle.command", row.Action);
        Assert.Equal("vehicle", row.Resource);
        Assert.Equal("wake_up", row.Details);
        Assert.Equal("2026-06-13 11:30", row.Time);
    }

    [Fact]
    public void Row_renders_em_dash_for_absent_values()
    {
        var display = NotificationsAuditLogProjection.Project(Loaded(Entry(details: string.Empty, createdAt: string.Empty)), Localizer);
        var row = Assert.Single(display.Rows);

        Assert.Equal("\u2014", row.Details);
        Assert.Equal("\u2014", row.Time);
    }

    // ── Column headers ───────────────────────────────────────────────────────────────

    [Fact]
    public void Column_headers_resolve_from_the_localizer()
    {
        var display = NotificationsAuditLogProjection.Project(Loaded(Entry()), Localizer);

        Assert.Equal("Time", display.TimeHeader);
        Assert.Equal("Action", display.ActionHeader);
        Assert.Equal("Resource", display.ResourceHeader);
        Assert.Equal("Details", display.DetailsHeader);
    }

    // ── Tolerant parser ──────────────────────────────────────────────────────────────

    [Fact]
    public void Entry_parses_the_go_wire_shape_and_tolerates_missing_fields()
    {
        var el = Parse("{\"id\":12,\"ts\":\"2026-06-13T00:00:00Z\",\"action\":\"x\",\"entity_type\":\"vehicle\",\"detail\":\"d\"}");
        var entry = AuditLogEntry.FromJson(el);

        Assert.Equal("12", entry.Id);
        Assert.Equal("x", entry.Action);
        Assert.Equal("vehicle", entry.Resource); // resource ← entity_type
        Assert.Equal("d", entry.Details); // details ← detail
        Assert.Equal("2026-06-13T00:00:00Z", entry.CreatedAt); // createdAt ← ts
    }

    [Fact]
    public void Entry_prefers_the_web_interface_field_names_when_present()
    {
        var el = Parse("{\"id\":\"a\",\"action\":\"x\",\"resource\":\"r\",\"details\":\"dd\",\"created_at\":\"2026\"}");
        var entry = AuditLogEntry.FromJson(el);

        Assert.Equal("a", entry.Id);
        Assert.Equal("r", entry.Resource);
        Assert.Equal("dd", entry.Details);
        Assert.Equal("2026", entry.CreatedAt);
    }

    [Fact]
    public void List_parses_a_bare_array_a_wrapped_array_and_a_non_array()
    {
        Assert.Equal(2, AuditLogEntry.ListFromJson(Parse("[{\"id\":1},{\"id\":2}]")).Count);
        Assert.Single(AuditLogEntry.ListFromJson(Parse("{\"items\":[{\"id\":1}]}")));
        Assert.Empty(AuditLogEntry.ListFromJson(Parse("{}")));
        Assert.Empty(AuditLogEntry.ListFromJson(Parse("null")));
    }

    // ── Registration contract (hook ↔ generated endpoint id) ─────────────────────────

    [Fact]
    public void Registration_operation_matches_the_generated_endpoint_id()
    {
        Assert.Equal("get_api_v1_system_audit", NotificationsAuditLogRegistration.ListOperation);
        Assert.Equal("NotificationsAudit", NotificationsAuditLogRegistration.RouteName);
        Assert.Equal("notifications/audit", NotificationsAuditLogRegistration.RoutePath);
        Assert.Equal(50, NotificationsAuditLogRegistration.PageSize);
        Assert.Equal("Audit Log", NotificationsAuditLogRegistration.Title(Localizer));
    }

    // ── View-model four-state matrix ─────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loads_rows_into_the_success_state()
    {
        var feed = new FakeAuditLogsFeed { Result = [Entry()] };
        using var vm = new NotificationsAuditLogPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(NotificationsAuditLogState.Success, vm.State);
        Assert.Single(vm.Display.Rows);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_empty_state()
    {
        var feed = new FakeAuditLogsFeed { Result = Array.Empty<AuditLogEntry>() };
        using var vm = new NotificationsAuditLogPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(NotificationsAuditLogState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        var feed = new FakeAuditLogsFeed { Error = new ApiException("audit boom", 500) };
        using var vm = new NotificationsAuditLogPageViewModel(feed, Localizer);

        await vm.LoadAsync();

        Assert.Equal(NotificationsAuditLogState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.Contains("audit boom", vm.Display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_set_search_filters_without_a_reload()
    {
        var feed = new FakeAuditLogsFeed { Result = [Entry(action: "login"), Entry(id: "2", action: "sleep")] };
        using var vm = new NotificationsAuditLogPageViewModel(feed, Localizer);

        await vm.LoadAsync();
        var callsAfterLoad = feed.Calls;

        vm.SetSearch("login");
        Assert.Single(vm.Display.Rows);
        Assert.Equal(callsAfterLoad, feed.Calls); // no reload — pure re-projection

        vm.ClearSearch();
        Assert.Equal(2, vm.Display.Rows.Count);
    }

    [Fact]
    public void ViewModel_notify_opened_records_a_pii_safe_diagnostic()
    {
        var events = new List<string>();
        var diagnostics = new NotificationsAuditLogDiagnostics(events.Add);
        using var vm = new NotificationsAuditLogPageViewModel(EmptyAuditLogsFeed.Instance, Localizer, diagnostics);

        vm.NotifyOpened();

        Assert.Contains("view.opened slug=NotificationsAuditLogPage", events);
    }

    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement;

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeAuditLogsFeed : IAuditLogsFeed
    {
        public IReadOnlyList<AuditLogEntry> Result { get; init; } = Array.Empty<AuditLogEntry>();

        public Exception? Error { get; init; }

        public int Calls { get; private set; }

        public Task<IReadOnlyList<AuditLogEntry>> FetchAsync(CancellationToken cancellationToken)
        {
            Calls++;
            return Error is not null
                ? Task.FromException<IReadOnlyList<AuditLogEntry>>(Error)
                : Task.FromResult(Result);
        }
    }
}
