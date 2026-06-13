using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.SystemOps;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>MyActivityPage</c> surface's Microsoft.UI-free logic — the tolerant audit-row
/// parser (web <c>UserActivityEntry</c> / <c>safeArray</c>), the action → severity / label resolver (web
/// <c>getActivityVisual</c>), the i18n projection (the eight <c>activity.myActivity.*</c> + <c>common.retry</c>
/// keys and the five panel branches), the six-state view-model matrix (loading / disabled / unauthorized / error /
/// empty / loaded, mapping <c>apiError.status</c> 503 → disabled and 401 → unauthorized), the PII-safe diagnostics,
/// and the generated-client source's request shaping (web <c>useMyRecentActivity</c>). The WinUI view is exercised
/// by the app build; its per-region visibility is driven entirely by the <see cref="MyActivityDisplay"/> flags
/// asserted here. Mirrors the web spec (web/src/features/system/pages/MyActivityPage.tsx).
/// </summary>
public sealed class MyActivityPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The eight i18n keys the manifest requires the page to resolve, in the platform catalog's "translation."
    // namespace (web key names: activity.myActivity.* + common.retry).
    private static readonly string[] RequiredStringKeys =
    [
        "translation.activity.myActivity.disabled.description",
        "translation.activity.myActivity.disabled.title",
        "translation.activity.myActivity.error.title",
        "translation.activity.myActivity.subtitle",
        "translation.activity.myActivity.title",
        "translation.activity.myActivity.unauthorized.description",
        "translation.activity.myActivity.unauthorized.title",
        "translation.common.retry",
    ];

    // ---- Audit-row parser (web UserActivityEntry / safeArray) -----------------------

    [Fact]
    public void Entries_parse_snake_case_and_camel_case_fields()
    {
        using var doc = JsonDocument.Parse("""
        [{"id":7,"ts":"2026-06-12T10:00:00Z","action":"vehicle.command.wake","entity_type":"vehicle","entity_id":"3","detail":"Woke up"},
         {"id":"9","ts":"2026-06-11T09:00:00Z","action":"auth.login","entityType":"user","entityId":"u1"}]
        """);

        var rows = UserActivityEntry.FromArray(doc.RootElement);

        Assert.Equal(2, rows.Count);
        Assert.Equal(7, rows[0].Id);
        Assert.Equal("vehicle.command.wake", rows[0].Action);
        Assert.Equal("vehicle", rows[0].EntityType);
        Assert.Equal("3", rows[0].EntityId);
        Assert.Equal("Woke up", rows[0].Detail);
        Assert.Equal(DateTimeOffset.Parse("2026-06-12T10:00:00Z"), rows[0].Timestamp);
        Assert.Equal(9, rows[1].Id);
        Assert.Equal("user", rows[1].EntityType);
        Assert.Equal("u1", rows[1].EntityId);
    }

    [Fact]
    public void Entries_skip_non_objects_and_are_empty_for_non_arrays()
    {
        using var mixed = JsonDocument.Parse("""["x", 1, {"id":5,"action":"auth.logout"}]""");
        var rows = UserActivityEntry.FromArray(mixed.RootElement);
        Assert.Single(rows);
        Assert.Equal(5, rows[0].Id);
        Assert.Null(rows[0].Timestamp);

        using var obj = JsonDocument.Parse("{}");
        Assert.Empty(UserActivityEntry.FromArray(obj.RootElement));
    }

    // ---- Action → severity / label resolver (web getActivityVisual) -----------------

    [Fact]
    public void Visuals_resolve_exact_matches()
    {
        var wake = MyActivityVisuals.Resolve("vehicle.command.wake");
        Assert.Equal("warn", wake.Severity);
        Assert.Equal("activity.action.vehicleCommandWake", wake.I18nKey);
        Assert.Equal("Wake vehicle", wake.Fallback);

        Assert.Equal("success", MyActivityVisuals.Resolve("auth.login").Severity);
        Assert.Equal("critical", MyActivityVisuals.Resolve("alert.rule.delete").Severity);
    }

    [Fact]
    public void Visuals_walk_shrinking_prefixes_then_fall_back()
    {
        // No exact entry for vehicle.command.defrost → falls back to vehicle.command.
        var partial = MyActivityVisuals.Resolve("vehicle.command.defrost");
        Assert.Equal("activity.action.vehicleCommand", partial.I18nKey);
        Assert.Equal("Vehicle command", partial.Fallback);

        // Nothing matches → generic fallback.
        var unknown = MyActivityVisuals.Resolve("totally.unmapped.action");
        Assert.Equal("activity.action.unknown", unknown.I18nKey);
        Assert.Equal("Activity", unknown.Fallback);

        Assert.Equal("activity.action.unknown", MyActivityVisuals.Resolve("").I18nKey);
    }

    // ---- Projection / strings -------------------------------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key_with_verbatim_defaults()
    {
        var recorder = new RecordingLocalizer();

        // Drive every branch so the full key set is exercised through one recorder.
        foreach (var state in new[]
        {
            MyActivityState.Loading,
            MyActivityState.Disabled,
            MyActivityState.Unauthorized,
            MyActivityState.Error,
            MyActivityState.Empty,
            MyActivityState.Loaded,
        })
        {
            MyActivityProjection.Project(Array.Empty<UserActivityEntry>(), state, null, recorder);
        }

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }

        var disabled = MyActivityProjection.Project(Array.Empty<UserActivityEntry>(), MyActivityState.Disabled, null, Localizer);
        Assert.Equal("My Activity", disabled.Title);
        Assert.Equal("Recent actions you have taken in TeslaSync.", disabled.Subtitle);
        Assert.Equal("Activity feed disabled", disabled.NoticeTitle);
        Assert.StartsWith("Per-user activity is only available", disabled.NoticeMessage);
    }

    [Fact]
    public void Projection_disabled_and_unauthorized_show_a_notice_without_retry()
    {
        var disabled = MyActivityProjection.Project(Array.Empty<UserActivityEntry>(), MyActivityState.Disabled, null, Localizer);
        Assert.Equal(MyActivityBody.Notice, disabled.Body);
        Assert.False(disabled.ShowTimeline);
        Assert.False(disabled.ShowRetry);

        var unauth = MyActivityProjection.Project(Array.Empty<UserActivityEntry>(), MyActivityState.Unauthorized, null, Localizer);
        Assert.Equal("Identity required", unauth.NoticeTitle);
        Assert.StartsWith("Your request did not include", unauth.NoticeMessage);
        Assert.False(unauth.ShowRetry);
    }

    [Fact]
    public void Projection_error_shows_the_dynamic_detail_and_a_retry()
    {
        var withDetail = MyActivityProjection.Project(Array.Empty<UserActivityEntry>(), MyActivityState.Error, "Server exploded", Localizer);
        Assert.Equal("Could not load activity", withDetail.NoticeTitle);
        Assert.Equal("Server exploded", withDetail.NoticeMessage);
        Assert.True(withDetail.ShowRetry);
        Assert.Equal("Retry", withDetail.NoticeActionText);

        // Null detail falls back to the heading sentence rather than a blank message.
        var noDetail = MyActivityProjection.Project(Array.Empty<UserActivityEntry>(), MyActivityState.Error, null, Localizer);
        Assert.Equal("Could not load activity", noDetail.NoticeMessage);
    }

    [Fact]
    public void Projection_empty_shows_the_feed_empty_notice()
    {
        var empty = MyActivityProjection.Project(Array.Empty<UserActivityEntry>(), MyActivityState.Empty, null, Localizer);
        Assert.Equal(MyActivityBody.Notice, empty.Body);
        Assert.Equal(string.Empty, empty.NoticeTitle);
        Assert.Equal("No recent activity in this window.", empty.NoticeMessage);
        Assert.False(empty.ShowRetry);
    }

    [Fact]
    public void Projection_loading_marks_the_container_spinner()
    {
        var loading = MyActivityProjection.Project(Array.Empty<UserActivityEntry>(), MyActivityState.Loading, null, Localizer);
        Assert.True(loading.IsLoading);
        Assert.False(loading.ShowTimeline);
    }

    [Fact]
    public void Projection_loaded_maps_rows_to_timeline_entries()
    {
        var entries = new[]
        {
            new UserActivityEntry(1, Now, "vehicle.command.wake", "vehicle", "7", "Woke up"),
            new UserActivityEntry(2, Now.AddMinutes(-5), "auth.login", null, null, null),
        };

        var display = MyActivityProjection.Project(entries, MyActivityState.Loaded, null, Localizer);

        Assert.Equal(MyActivityBody.Timeline, display.Body);
        Assert.True(display.ShowTimeline);
        Assert.Equal(2, display.Rows.Count);

        var first = display.Rows[0];
        Assert.Equal("Wake vehicle", first.Title);
        Assert.Equal("vehicle \u00b7 7 \u2014 Woke up", first.Subtitle);
        Assert.Equal("warn", first.Severity);
        Assert.Equal(Now, first.Timestamp);

        var second = display.Rows[1];
        Assert.Equal("Signed in", second.Title);
        Assert.Null(second.Subtitle); // no entity / detail → no subtitle
        Assert.Equal("success", second.Severity);
    }

    [Fact]
    public void Projection_carries_the_copy_link_deep_link()
    {
        var display = MyActivityProjection.Project(Array.Empty<UserActivityEntry>(), MyActivityState.Loaded, null, Localizer);
        Assert.Equal("teslasync://me/activity", display.CopyLinkText);
    }

    // ---- View-model state matrix ----------------------------------------------------

    [Fact]
    public async Task ViewModel_starts_loading_then_resolves_loaded()
    {
        var rows = new[] { new UserActivityEntry(1, Now, "auth.login", null, null, null) };
        using var vm = NewViewModel(new FakeMyActivitySource(rows));

        Assert.Equal(MyActivityState.Loading, vm.State);

        await vm.LoadAsync();

        Assert.Equal(MyActivityState.Loaded, vm.State);
        Assert.True(vm.Display.ShowTimeline);
        Assert.Single(vm.Display.Rows);
    }

    [Fact]
    public async Task ViewModel_classifies_no_rows_as_empty()
    {
        using var vm = NewViewModel(new FakeMyActivitySource(Array.Empty<UserActivityEntry>()));

        await vm.LoadAsync();

        Assert.Equal(MyActivityState.Empty, vm.State);
        Assert.False(vm.Display.ShowRetry);
    }

    [Fact]
    public async Task ViewModel_maps_503_to_disabled()
    {
        using var vm = NewViewModel(new FakeMyActivitySource(error: new ApiException("disabled", 503)));

        await vm.LoadAsync();

        Assert.Equal(MyActivityState.Disabled, vm.State);
        Assert.Equal("Activity feed disabled", vm.Display.NoticeTitle);
        Assert.False(vm.Display.ShowRetry);
    }

    [Fact]
    public async Task ViewModel_maps_401_to_unauthorized()
    {
        using var vm = NewViewModel(new FakeMyActivitySource(error: new ApiException("no identity", 401)));

        await vm.LoadAsync();

        Assert.Equal(MyActivityState.Unauthorized, vm.State);
        Assert.Equal("Identity required", vm.Display.NoticeTitle);
    }

    [Fact]
    public async Task ViewModel_maps_other_failures_to_a_retriable_error()
    {
        using var vm = NewViewModel(new FakeMyActivitySource(error: new ApiException("kaboom", 500)));

        await vm.LoadAsync();

        Assert.Equal(MyActivityState.Error, vm.State);
        Assert.True(vm.Display.ShowRetry);
        Assert.Equal("kaboom", vm.Display.NoticeMessage);
    }

    [Fact]
    public async Task ViewModel_retry_reruns_the_load()
    {
        var source = new FakeMyActivitySource(error: new ApiException("kaboom", 500));
        using var vm = NewViewModel(source);

        await vm.LoadAsync();
        Assert.Equal(MyActivityState.Error, vm.State);

        source.Succeed(new[] { new UserActivityEntry(1, Now, "auth.login", null, null, null) });
        await vm.RefreshAsync();

        Assert.Equal(MyActivityState.Loaded, vm.State);
        Assert.Equal(2, source.Calls);
    }

    [Fact]
    public async Task ViewModel_set_range_reloads_the_new_window()
    {
        var source = new FakeMyActivitySource(Array.Empty<UserActivityEntry>());
        using var vm = NewViewModel(source);
        await vm.LoadAsync();

        var newRange = new DateRange(new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 31));
        await vm.SetRangeAsync(newRange);

        Assert.Equal(newRange, vm.Range);
        Assert.Equal(2, source.Calls);
        Assert.Equal(new MyActivityQuery("2026-01-01", "2026-01-31", MyActivityRegistration.ActivityLimit), source.LastQuery);
    }

    [Fact]
    public void ViewModel_records_a_pii_safe_view_opened_event()
    {
        var lines = new List<string>();
        using var vm = new MyActivityPageViewModel(
            new FakeMyActivitySource(Array.Empty<UserActivityEntry>()),
            Localizer,
            () => Now,
            new MyActivityDiagnostics(lines.Add));

        vm.NotifyOpened();

        Assert.Contains("view.opened slug=MyActivityPage", lines);
    }

    [Fact]
    public void ViewModel_default_window_is_the_last_30_days()
    {
        using var vm = NewViewModel(new FakeMyActivitySource(Array.Empty<UserActivityEntry>()));

        Assert.Equal(new DateOnly(2026, 5, 14), vm.Range.Start); // 30-day inclusive window ending 2026-06-12
        Assert.Equal(new DateOnly(2026, 6, 12), vm.Range.End);
    }

    // ---- Registration ---------------------------------------------------------------

    [Fact]
    public void Registration_mirrors_the_web_route_and_keys()
    {
        Assert.Equal("MyActivity", MyActivityRegistration.RouteName);
        Assert.Equal("me/activity", MyActivityRegistration.Route);
        Assert.Equal("MyActivityPage", MyActivityRegistration.Slug);
        Assert.Equal("get_api_v1_users_me_activity", MyActivityRegistration.ActivityOperation);
        Assert.Equal(200, MyActivityRegistration.ActivityLimit);
        Assert.Equal("My Activity", MyActivityRegistration.Title(Localizer));
        Assert.Equal("Recent actions you have taken in TeslaSync.", MyActivityRegistration.Subtitle(Localizer));
        Assert.Equal("teslasync://me/activity", MyActivityRegistration.CopyLink);
    }

    // ---- Source request shaping (web useMyRecentActivity) ---------------------------

    [Fact]
    public async Task Source_issues_the_activity_request_with_snake_case_window_params()
    {
        var body = Clone("""[{"id":1,"ts":"2026-06-12T10:00:00Z","action":"auth.login"}]""");
        var api = new FakeApiClient().ReturnsValue(body);
        var source = new MyActivitySource(api);

        var rows = await source.FetchAsync(new MyActivityQuery("2026-05-14", "2026-06-12", 200));

        Assert.Single(rows);
        Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_users_me_activity", api.Requests[0].OperationId);
        Assert.NotNull(api.Requests[0].Query);
        Assert.Equal("2026-05-14", api.Requests[0].Query!["start"]);
        Assert.Equal("2026-06-12", api.Requests[0].Query!["end"]);
        Assert.Equal(200, api.Requests[0].Query!["limit"]);
    }

    [Fact]
    public async Task Source_resolves_a_404_to_no_rows()
    {
        var api = new FakeApiClient().Throws(new ApiException("not found", 404));
        var source = new MyActivitySource(api);

        var rows = await source.FetchAsync(new MyActivityQuery("2026-05-14", "2026-06-12", 200));

        Assert.Empty(rows);
    }

    [Fact]
    public async Task Source_propagates_other_failures_for_the_view_model_to_classify()
    {
        var api = new FakeApiClient().Throws(new ApiException("forbidden", 503));
        var source = new MyActivitySource(api);

        var ex = await Assert.ThrowsAsync<ApiException>(() =>
            source.FetchAsync(new MyActivityQuery("2026-05-14", "2026-06-12", 200)));

        Assert.Equal(503, ex.StatusCode);
    }

    [Fact]
    public async Task Empty_source_resolves_to_no_rows()
    {
        var rows = await EmptyMyActivitySource.Instance.FetchAsync(new MyActivityQuery("a", "b", 1));
        Assert.Empty(rows);
    }

    // ---- Fakes / helpers ------------------------------------------------------------

    private static JsonElement Clone(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static MyActivityPageViewModel NewViewModel(IMyActivitySource source) =>
        new(source, Localizer, () => Now);

    private sealed class FakeMyActivitySource : IMyActivitySource
    {
        private IReadOnlyList<UserActivityEntry>? _rows;
        private Exception? _error;

        public FakeMyActivitySource(IReadOnlyList<UserActivityEntry>? rows = null, Exception? error = null)
        {
            _rows = rows;
            _error = error;
        }

        public int Calls { get; private set; }

        public MyActivityQuery? LastQuery { get; private set; }

        public void Succeed(IReadOnlyList<UserActivityEntry> rows)
        {
            _rows = rows;
            _error = null;
        }

        public Task<IReadOnlyList<UserActivityEntry>> FetchAsync(
            MyActivityQuery query,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            LastQuery = query;
            if (_error is not null)
            {
                return Task.FromException<IReadOnlyList<UserActivityEntry>>(_error);
            }

            return Task.FromResult(_rows ?? Array.Empty<UserActivityEntry>());
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
