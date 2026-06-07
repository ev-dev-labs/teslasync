using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the AlertFeedWidget's UI-thread-free logic — the parse adapter, the
/// drill-through map, the projection (sort / cap / subtitle / labels), the cache-then-network result
/// mapper, the registry metadata, the diagnostics, and the state-holder view-model's per-state
/// transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/AlertFeedWidget.tsx + lib/alertDrillthrough.ts).
/// </summary>
public sealed class AlertFeedWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static AlertFeedAlert Alert(
        long id,
        string severity = "info",
        string? title = "Title",
        string? message = "Message",
        string createdAt = "2026-06-06T12:00:00Z",
        long vehicleId = 7,
        string? ruleSignal = null) =>
        new(
            Id: id,
            VehicleId: vehicleId,
            Type: "rule",
            Severity: severity,
            Title: title,
            Message: message,
            IsRead: false,
            CreatedAt: createdAt,
            RuleId: ruleSignal is null ? null : 99,
            RuleSignal: ruleSignal,
            RuleSeverity: null);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void ParseList_reads_snake_case_fields()
    {
        const string json = """
        [{"id":1,"vehicle_id":7,"type":"low_battery","severity":"critical","title":"Battery low",
          "message":"Battery at 10%","is_read":true,"created_at":"2026-06-06T12:00:00Z",
          "rule_id":5,"rule_signal":"BatteryLevel","rule_severity":"critical"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var list = AlertFeedAlert.ParseList(doc.RootElement);

        var alert = Assert.Single(list);
        Assert.Equal(1, alert.Id);
        Assert.Equal(7, alert.VehicleId);
        Assert.Equal("critical", alert.Severity);
        Assert.Equal("Battery low", alert.Title);
        Assert.Equal("Battery at 10%", alert.Message);
        Assert.True(alert.IsRead);
        Assert.Equal("BatteryLevel", alert.RuleSignal);
        Assert.NotNull(alert.CreatedAtTime);
    }

    [Fact]
    public void ParseList_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"id":2}]""");

        var alert = Assert.Single(AlertFeedAlert.ParseList(doc.RootElement));

        Assert.Equal(2, alert.Id);
        Assert.Equal("info", alert.Severity); // default
        Assert.Null(alert.Title);
        Assert.Null(alert.CreatedAtTime);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Empty(AlertFeedAlert.ParseList(doc.RootElement));
    }

    // ---- Drill-through (port of lib/alertDrillthrough.ts) ---------------------------

    [Fact]
    public void Drillthrough_maps_known_signal_to_its_page_with_context()
    {
        var target = AlertFeedDrillthrough.For(Alert(1, ruleSignal: "BatteryLevel", vehicleId: 7));

        Assert.Equal("battery", target.Path);
        Assert.Contains(new KeyValuePair<string, string>("vehicle_id", "7"), target.Query);
        Assert.Contains(new KeyValuePair<string, string>("signal", "BatteryLevel"), target.Query);
        Assert.Contains(target.Query, q => q.Key == "t");
        Assert.StartsWith("battery?", target.Href, StringComparison.Ordinal);
        Assert.Contains("signal=BatteryLevel", target.Href, StringComparison.Ordinal);
    }

    [Fact]
    public void Drillthrough_falls_back_to_signal_explorer_for_unknown_signal()
    {
        var target = AlertFeedDrillthrough.For(Alert(1, ruleSignal: "MysterySignal"));

        Assert.Equal(AlertFeedDrillthrough.SignalExplorerFallback, target.Path);
        Assert.Contains(new KeyValuePair<string, string>("signal", "MysterySignal"), target.Query);
    }

    [Fact]
    public void Drillthrough_omits_unscoped_vehicle_and_absent_signal()
    {
        var target = AlertFeedDrillthrough.For(Alert(1, vehicleId: 0, ruleSignal: null));

        Assert.Equal(AlertFeedDrillthrough.SignalExplorerFallback, target.Path);
        Assert.DoesNotContain(target.Query, q => q.Key == "vehicle_id");
        Assert.DoesNotContain(target.Query, q => q.Key == "signal");
    }

    // ---- Size / maxItems (web isWide / isTall) -------------------------------------

    [Theory]
    [InlineData(2, 4, 8)]   // default: tall, not wide
    [InlineData(2, 1, 5)]   // neither
    [InlineData(3, 2, 12)]  // wide
    [InlineData(4, 40, 12)] // wide (max)
    public void Size_row_budget_matches_web(int cols, int rows, int expected) =>
        Assert.Equal(expected, new AlertFeedSize(cols, rows).MaxItems);

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_sorts_newest_first_and_caps_to_row_budget()
    {
        var alerts = new List<AlertFeedAlert>();
        for (int i = 0; i < 10; i++)
        {
            // i=0 oldest … i=9 newest
            var ts = new DateTimeOffset(2026, 6, 6, 10, i, 0, TimeSpan.Zero);
            alerts.Add(Alert(i, createdAt: ts.ToString("o", System.Globalization.CultureInfo.InvariantCulture)));
        }

        var rows = AlertFeedProjection.Project(alerts, new AlertFeedSize(2, 4), Localizer, Now);

        Assert.Equal(8, rows.Count);          // 2x4 budget = 8
        Assert.Equal(9, rows[0].Id);          // newest first
        Assert.Equal(2, rows[^1].Id);         // 8 newest of 0..9 -> ids 9..2
    }

    [Fact]
    public void Project_uses_message_subtitle_when_wide_else_severity_label()
    {
        var alert = Alert(1, severity: "warning", message: "Tire pressure low");

        var narrow = AlertFeedProjection.Project([alert], new AlertFeedSize(2, 4), Localizer, Now)[0];
        var wide = AlertFeedProjection.Project([alert], new AlertFeedSize(3, 4), Localizer, Now)[0];

        Assert.Equal("Warning", narrow.Subtitle); // severity label (normalize warning -> Warn -> "Warning")
        Assert.Equal("Tire pressure low", wide.Subtitle);
    }

    [Fact]
    public void Project_falls_back_to_em_dash_title()
    {
        var row = AlertFeedProjection.Project([Alert(1, title: "")], AlertFeedSize.Default, Localizer, Now)[0];
        Assert.Equal("\u2014", row.Title);
    }

    [Fact]
    public void Project_resolves_severity_presentation_and_relative_time()
    {
        var critical = SeverityLevels.Tokens(SeverityLevel.Critical);
        var row = AlertFeedProjection.Project([Alert(1, severity: "critical")], AlertFeedSize.Default, Localizer, Now)[0];

        Assert.Equal(SeverityLevel.Critical, row.Severity);
        Assert.Equal(critical.IconGlyph, row.Glyph);
        Assert.Equal(critical.AccentBrushKey, row.AccentBrushKey);
        Assert.Equal("5m ago", row.RelativeTime);
    }

    [Fact]
    public void Project_row_has_non_empty_accessibility_name()
    {
        var row = AlertFeedProjection.Project([Alert(1, severity: "info", title: "Door left open")], AlertFeedSize.Default, Localizer, Now)[0];

        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains("Door left open", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Info", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("5m ago", row.AutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"severity":"info","created_at":"2026-06-06T12:00:00Z"}]""");
        var fetchedAt = Now;

        var cached = AlertFeedResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, fetchedAt, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = AlertFeedResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, fetchedAt, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void Mapper_collapses_loaded_empty_array_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var mapped = AlertFeedResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Empty, mapped.Status);
    }

    [Fact]
    public void Mapper_maps_failure()
    {
        var mapped = AlertFeedResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, mapped.Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<AlertFeedAlert>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(AlertFeedState.Loading, vm.State);
        Assert.False(vm.HasRows);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_rows()
    {
        using var vm = NewViewModel(Loaded(Alert(1), Alert(2)));
        await vm.LoadAsync();

        Assert.Equal(AlertFeedState.Loaded, vm.State);
        Assert.True(vm.HasRows);
        Assert.Equal(2, vm.Rows.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<AlertFeedAlert>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(AlertFeedState.Empty, vm.State);
        Assert.False(vm.HasRows);
        Assert.Equal("No alerts yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<AlertFeedAlert>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(AlertFeedState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_rows()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<AlertFeedAlert>>.Cached(new[] { Alert(1) }, Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(AlertFeedState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasRows);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_rows()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<AlertFeedAlert>>.OfflineCached(
            new[] { Alert(1) }, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(AlertFeedState.Offline, vm.State);
        Assert.True(vm.HasRows);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<AlertFeedAlert>>.Loading(),
            RepositoryResult<IReadOnlyList<AlertFeedAlert>>.Cached(new[] { Alert(1) }, Now, stale: false),
            RepositoryResult<IReadOnlyList<AlertFeedAlert>>.Loaded(new[] { Alert(1), Alert(2) }, Now));
        await vm.LoadAsync();

        Assert.Equal(AlertFeedState.Loaded, vm.State);
        Assert.Equal(2, vm.Rows.Count);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_subtitle()
    {
        using var vm = NewViewModel(
            new AlertFeedSize(2, 4),
            RepositoryResult<IReadOnlyList<AlertFeedAlert>>.Loaded(new[] { Alert(1, severity: "info", message: "Hello") }, Now));
        await vm.LoadAsync();
        Assert.Equal("Info", vm.Rows[0].Subtitle); // narrow -> severity label

        vm.Size = new AlertFeedSize(3, 4);
        Assert.Equal("Hello", vm.Rows[0].Subtitle); // wide -> message
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<AlertFeedAlert>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Alert Feed", vm.Title);
        Assert.Equal("No alerts yet", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state()
    {
        using var vm = NewViewModel(Loaded(Alert(1)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(AlertFeedViewModel.State), changed);
        Assert.Contains(nameof(AlertFeedViewModel.Rows), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("alert-feed", AlertFeedRegistration.Id);
        Assert.Equal("alerts", AlertFeedRegistration.Category);
        Assert.Equal("AlertFeedWidget", AlertFeedRegistration.Slug);
        Assert.Equal(new AlertFeedSize(2, 4), AlertFeedRegistration.DefaultSize);
        Assert.Equal(new AlertFeedSize(2, 4), AlertFeedRegistration.MinSize);
        Assert.Equal(new AlertFeedSize(4, 40), AlertFeedRegistration.MaxSize);
        Assert.Equal("Alert Feed", AlertFeedRegistration.Name(Localizer));
        Assert.Contains("severity", AlertFeedRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(4, 40, true)]
    [InlineData(1, 4, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, AlertFeedRegistration.IsWithinBounds(new AlertFeedSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new AlertFeedSize(2, 4), AlertFeedRegistration.Clamp(new AlertFeedSize(1, 1)));
        Assert.Equal(new AlertFeedSize(4, 40), AlertFeedRegistration.Clamp(new AlertFeedSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AlertFeedDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AlertFeedWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<IReadOnlyList<AlertFeedAlert>> Loaded(params AlertFeedAlert[] alerts) =>
        RepositoryResult<IReadOnlyList<AlertFeedAlert>>.Loaded(alerts, Now);

    private static AlertFeedViewModel NewViewModel(params RepositoryResult<IReadOnlyList<AlertFeedAlert>>[] emissions) =>
        NewViewModel(AlertFeedSize.Default, emissions);

    private static AlertFeedViewModel NewViewModel(
        AlertFeedSize size,
        params RepositoryResult<IReadOnlyList<AlertFeedAlert>>[] emissions) =>
        new(new FakeAlertFeedSource(emissions), Localizer, size, () => Now);

    private sealed class FakeAlertFeedSource(params RepositoryResult<IReadOnlyList<AlertFeedAlert>>[] emissions) : IAlertFeedSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<AlertFeedAlert>>> StreamAsync(
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
}
