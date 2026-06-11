using System.Collections.Generic;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the OperationsSection feature-view's UI-thread-free logic — the stats / logs /
/// audit JSON adapters (snake_case + camelCase + Go-wire <c>entity_type</c>/<c>detail</c>/<c>ts</c>
/// fallbacks), the helpers.tsx status classifier port, the success-rate derivation and threshold badge, the
/// projection (metric tiles, gauge value, rows and Narrator names), the cache-then-network result mappers,
/// the state-holder view-model's per-state transitions (loading / loaded / empty / stale / offline / error),
/// the registration metadata and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/system/components/status/OperationsSection.tsx). The WinUI view itself is exercised by
/// the app build.
/// </summary>
public sealed class OperationsSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    // ---- Stats adapter (web NotificationStats) ----------------------------------------------------------

    [Fact]
    public void Stats_FromJson_reads_snake_case_fields()
    {
        const string json = """
        { "total_sent": 200, "sent": 198, "failed": 2, "pending": 0,
          "total_channels": 4, "enabled_channels": 3 }
        """;
        using var doc = JsonDocument.Parse(json);

        var stats = OperationsNotificationStats.FromJson(doc.RootElement);

        Assert.True(stats.HasData);
        Assert.Equal(200, stats.TotalSent);
        Assert.Equal(198, stats.Sent);
        Assert.Equal(2, stats.Failed);
        Assert.Equal(3, stats.EnabledChannels);
        Assert.Equal(4, stats.TotalChannels);
        Assert.Equal(99.0, stats.SuccessRate, 3);
    }

    [Fact]
    public void Stats_FromJson_falls_back_to_camelCase()
    {
        const string json = """{ "totalSent": 50, "sent": 40 }""";
        using var doc = JsonDocument.Parse(json);

        var stats = OperationsNotificationStats.FromJson(doc.RootElement);

        Assert.Equal(50, stats.TotalSent);
        Assert.Equal(40, stats.Sent);
        Assert.Equal(80.0, stats.SuccessRate, 3);
    }

    [Fact]
    public void Stats_non_object_is_empty_and_rate_defaults_to_100()
    {
        using var doc = JsonDocument.Parse("null");

        var stats = OperationsNotificationStats.FromJson(doc.RootElement);

        Assert.False(stats.HasData);
        Assert.Same(OperationsNotificationStats.Empty, stats);
        // Web: total_sent == 0 => success rate defaults to a perfect 100, not 0.
        Assert.Equal(100.0, stats.SuccessRate, 3);
    }

    [Fact]
    public void Stats_zero_sent_rate_is_100()
    {
        const string json = """{ "total_sent": 0, "sent": 0, "failed": 0 }""";
        using var doc = JsonDocument.Parse(json);

        var stats = OperationsNotificationStats.FromJson(doc.RootElement);

        Assert.True(stats.HasData);
        Assert.Equal(100.0, stats.SuccessRate, 3);
    }

    // ---- Notification log adapter (web NotificationLog) -------------------------------------------------

    [Fact]
    public void Logs_ParseList_projects_rendered_fields_tolerantly()
    {
        const string json = """
        [ { "id": 7, "title": "Charge complete", "message": "Battery at 80%", "status": "sent",
            "created_at": "2026-06-09T11:55:00Z" },
          { "id": 8, "status": "failed" } ]
        """;
        using var doc = JsonDocument.Parse(json);

        var rows = OperationsNotificationLog.ParseList(doc.RootElement);

        Assert.Equal(2, rows.Count);
        Assert.Equal(7, rows[0].Id);
        Assert.Equal("Charge complete", rows[0].Title);
        Assert.Equal("sent", rows[0].Status);
        Assert.NotNull(rows[0].CreatedAtTime);
        Assert.Null(rows[1].Title); // missing -> null (projection later renders em-dash)
        Assert.Equal("failed", rows[1].Status);
    }

    [Fact]
    public void Logs_ParseList_non_array_is_empty()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Empty(OperationsNotificationLog.ParseList(doc.RootElement));
    }

    // ---- Audit adapter (web AuditLog interface vs Go wire shape) ----------------------------------------

    [Fact]
    public void Audit_FromJson_reads_web_interface_field_names()
    {
        const string json = """
        { "id": 3, "action": "update", "resource": "vehicle", "details": "renamed",
          "created_at": "2026-06-09T10:00:00Z" }
        """;
        using var doc = JsonDocument.Parse(json);

        var entry = OperationsAuditEntry.FromJson(doc.RootElement);

        Assert.Equal(3, entry.Id);
        Assert.Equal("update", entry.Action);
        Assert.Equal("vehicle", entry.Resource);
        Assert.Equal("renamed", entry.Details);
        Assert.NotNull(entry.CreatedAtTime);
    }

    [Fact]
    public void Audit_FromJson_falls_back_to_go_wire_field_names()
    {
        // The Go systemmodel.AuditLog serialises entity_type / detail / ts.
        const string json = """
        { "id": 9, "action": "delete", "entity_type": "geofence", "detail": "removed zone",
          "ts": "2026-06-09T09:00:00Z" }
        """;
        using var doc = JsonDocument.Parse(json);

        var entry = OperationsAuditEntry.FromJson(doc.RootElement);

        Assert.Equal("delete", entry.Action);
        Assert.Equal("geofence", entry.Resource);
        Assert.Equal("removed zone", entry.Details);
        Assert.NotNull(entry.CreatedAtTime);
    }

    // ---- Status classifier (web helpers.tsx) ------------------------------------------------------------

    [Theory]
    [InlineData("sent", StatusKind.Success)]
    [InlineData("completed", StatusKind.Success)]
    [InlineData("pending", StatusKind.Warning)]
    [InlineData("queued", StatusKind.Warning)]
    [InlineData("failed", StatusKind.Danger)]
    [InlineData("error", StatusKind.Danger)]
    public void Status_classify_matches_web_word_sets(string status, StatusKind expected)
    {
        Assert.Equal(expected, OperationsStatuses.Classify(status).Kind);
    }

    [Fact]
    public void Status_classify_unknown_and_null_fall_back_to_neutral_with_warning_glyph()
    {
        (StatusKind unknownKind, string unknownGlyph) = OperationsStatuses.Classify("carrier-pigeon");
        Assert.Equal(StatusKind.Neutral, unknownKind);
        Assert.Equal(OperationsStatuses.WarningGlyph, unknownGlyph);

        Assert.Equal(StatusKind.Neutral, OperationsStatuses.Classify(null).Kind);
        Assert.Equal(OperationsStatuses.EmDash, OperationsStatuses.Label(null));
        Assert.Equal("sent", OperationsStatuses.Label("sent"));
    }

    // ---- Success-rate threshold ladder (web badge variant) ----------------------------------------------

    [Theory]
    [InlineData(99.0, StatusKind.Success)]
    [InlineData(95.0, StatusKind.Success)]
    [InlineData(94.9, StatusKind.Warning)]
    [InlineData(80.0, StatusKind.Warning)]
    [InlineData(79.9, StatusKind.Danger)]
    [InlineData(0.0, StatusKind.Danger)]
    public void RateStatus_follows_web_threshold_ladder(double rate, StatusKind expected)
    {
        Assert.Equal(expected, OperationsSectionProjection.RateStatus(rate));
    }

    // ---- Projection (web render body) -------------------------------------------------------------------

    [Fact]
    public void Projection_builds_four_tiles_badge_and_rows()
    {
        var reading = new OperationsReading(
            new OperationsNotificationStats(TotalSent: 100, Sent: 99, Failed: 1, Pending: 0, TotalChannels: 3, EnabledChannels: 2),
            new[]
            {
                new OperationsNotificationLog(1, "Older", "msg", "sent", "2026-06-09T10:00:00Z"),
                new OperationsNotificationLog(2, "Newer", "msg", "failed", "2026-06-09T11:00:00Z"),
            },
            new[]
            {
                new OperationsAuditEntry(5, "update", "vehicle", "renamed", "2026-06-09T09:00:00Z"),
            });

        var display = OperationsSectionProjection.Project(reading, Localizer, Now);

        Assert.True(display.HasNotificationStats);
        Assert.Equal(4, display.MetricTiles.Count);
        Assert.Equal("Total Sent", display.MetricTiles[0].Label);
        Assert.Equal("2/3", display.MetricTiles[3].Value); // Channels = enabled/total
        Assert.Equal("99.0%", display.SuccessRateText);
        Assert.True(display.HasBadge);
        Assert.Equal(StatusKind.Success, display.BadgeStatus);
        Assert.Equal("99.0% success rate", display.BadgeText);
        Assert.Equal("Success", display.GaugeLabel);

        // Recent rows are most-recent first.
        Assert.True(display.HasNotificationLogs);
        Assert.Equal("Newer", display.NotificationRows[0].Title);
        Assert.Equal(StatusKind.Danger, display.NotificationRows[0].StatusKind);

        Assert.True(display.HasAudit);
        Assert.Equal("update", display.AuditRows[0].Action);
        Assert.True(display.HasAnyContent);
    }

    [Fact]
    public void Projection_renders_em_dash_for_missing_cells()
    {
        var reading = new OperationsReading(
            OperationsNotificationStats.Empty,
            new[] { new OperationsNotificationLog(1, null, null, null, null) },
            new[] { new OperationsAuditEntry(2, string.Empty, null, null, null) });

        var display = OperationsSectionProjection.Project(reading, Localizer, Now);

        Assert.False(display.HasNotificationStats); // empty stats hide the delivery sub-section
        Assert.Equal(OperationsStatuses.EmDash, display.NotificationRows[0].Title);
        Assert.Equal(OperationsStatuses.EmDash, display.NotificationRows[0].Message);
        Assert.Equal(OperationsStatuses.EmDash, display.NotificationRows[0].StatusText);
        Assert.Equal(OperationsStatuses.EmDash, display.AuditRows[0].Action);
        Assert.Equal(OperationsStatuses.EmDash, display.AuditRows[0].Resource);
        Assert.True(display.HasAnyContent); // rows still present
    }

    [Fact]
    public void Projection_empty_reading_has_no_content()
    {
        var display = OperationsSectionProjection.Project(OperationsReading.Empty, Localizer, Now);

        Assert.False(display.HasNotificationStats);
        Assert.False(display.HasNotificationLogs);
        Assert.False(display.HasAudit);
        Assert.False(display.HasAnyContent);
        Assert.Empty(display.MetricTiles);
    }

    // ---- Accessibility: every projected row/tile carries a Narrator name --------------------------------

    [Fact]
    public void Projection_every_tile_and_row_has_a_narrator_name()
    {
        var reading = new OperationsReading(
            new OperationsNotificationStats(10, 9, 1, 0, 2, 2),
            new[] { new OperationsNotificationLog(1, "T", "M", "sent", "2026-06-09T10:00:00Z") },
            new[] { new OperationsAuditEntry(2, "update", "vehicle", "d", "2026-06-09T09:00:00Z") });

        var display = OperationsSectionProjection.Project(reading, Localizer, Now);

        Assert.All(display.MetricTiles, t => Assert.False(string.IsNullOrWhiteSpace(t.AutomationName)));
        Assert.All(display.NotificationRows, r => Assert.False(string.IsNullOrWhiteSpace(r.AutomationName)));
        Assert.All(display.AuditRows, r => Assert.False(string.IsNullOrWhiteSpace(r.AutomationName)));
        Assert.Equal("Total Sent: 10", display.MetricTiles[0].AutomationName);
    }

    // ---- Result mappers (cache-then-network -> typed snapshot) ------------------------------------------

    [Fact]
    public void MapStats_loaded_object_becomes_loaded_snapshot()
    {
        using var doc = JsonDocument.Parse("""{ "total_sent": 5, "sent": 5 }""");
        var raw = RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now);

        var mapped = OperationsSectionResultMapper.MapStats(raw);

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.NotNull(mapped.Value);
        Assert.Equal(5, mapped.Value!.TotalSent);
    }

    [Fact]
    public void MapStats_null_body_becomes_empty()
    {
        using var doc = JsonDocument.Parse("null");
        var raw = RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now);

        Assert.Equal(LoadStatus.Empty, OperationsSectionResultMapper.MapStats(raw).Status);
    }

    [Fact]
    public void MapStats_failure_propagates_error()
    {
        var raw = RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Network, "boom"));
        var mapped = OperationsSectionResultMapper.MapStats(raw);

        Assert.Equal(LoadStatus.Error, mapped.Status);
        Assert.NotNull(mapped.Error);
    }

    [Fact]
    public void MapStats_offline_cached_preserves_value_and_offline_status()
    {
        using var doc = JsonDocument.Parse("""{ "total_sent": 1, "sent": 1 }""");
        var raw = RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "offline"));

        var mapped = OperationsSectionResultMapper.MapStats(raw);

        Assert.Equal(LoadStatus.Offline, mapped.Status);
        Assert.NotNull(mapped.Value);
    }

    [Fact]
    public void MapLogs_empty_array_becomes_empty_but_populated_array_loads()
    {
        using var emptyDoc = JsonDocument.Parse("[]");
        Assert.Equal(LoadStatus.Empty, OperationsSectionResultMapper.MapLogs(
            RepositoryResult<JsonElement>.Loaded(emptyDoc.RootElement, Now)).Status);

        using var fullDoc = JsonDocument.Parse("""[ { "id": 1, "status": "sent" } ]""");
        var mapped = OperationsSectionResultMapper.MapLogs(RepositoryResult<JsonElement>.Loaded(fullDoc.RootElement, Now));
        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.Single(mapped.Value!);
    }

    [Fact]
    public void MapAudit_cached_stale_is_preserved()
    {
        using var doc = JsonDocument.Parse("""[ { "id": 1, "action": "update" } ]""");
        var raw = RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true);

        var mapped = OperationsSectionResultMapper.MapAudit(raw);

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.IsStale);
        Assert.Single(mapped.Value!);
    }

    // ---- View-model: every state renders ----------------------------------------------------------------

    [Fact]
    public void ViewModel_starts_in_loading()
    {
        using var vm = new OperationsSectionViewModel(new FakeSource(), Localizer, () => Now);
        Assert.Equal(OperationsSectionState.Loading, vm.State);
    }

    [Fact]
    public async Task ViewModel_loaded_when_all_reads_carry_content()
    {
        var source = new FakeSource(
            Stats(LoadStatus.Loaded, new OperationsNotificationStats(10, 10, 0, 0, 1, 1)),
            Logs(LoadStatus.Loaded, new OperationsNotificationLog(1, "t", "m", "sent", "2026-06-09T10:00:00Z")),
            Audit(LoadStatus.Loaded, new OperationsAuditEntry(2, "update", "vehicle", "d", "2026-06-09T09:00:00Z")));
        using var vm = new OperationsSectionViewModel(source, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(OperationsSectionState.Loaded, vm.State);
        Assert.True(vm.Display.HasNotificationStats);
        Assert.True(vm.Display.HasAudit);
        Assert.False(vm.IsError);
        Assert.False(vm.IsStale);
    }

    [Fact]
    public async Task ViewModel_empty_when_all_reads_resolve_with_nothing()
    {
        var source = new FakeSource(
            StatsEmpty(), LogsEmpty(), AuditEmpty());
        using var vm = new OperationsSectionViewModel(source, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(OperationsSectionState.Empty, vm.State);
        Assert.False(vm.Display.HasAnyContent);
    }

    [Fact]
    public async Task ViewModel_error_when_all_reads_fail_with_nothing_cached()
    {
        var source = new FakeSource(StatsFail(), LogsFail(), AuditFail());
        using var vm = new OperationsSectionViewModel(source, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(OperationsSectionState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_when_a_read_is_cached_stale_with_content()
    {
        var source = new FakeSource(
            new[] { RepositoryResult<OperationsNotificationStats>.Cached(new OperationsNotificationStats(10, 9, 1, 0, 2, 2), Now, stale: true) },
            Logs(LoadStatus.Loaded, new OperationsNotificationLog(1, "t", "m", "sent", "2026-06-09T10:00:00Z")),
            Audit(LoadStatus.Loaded, new OperationsAuditEntry(2, "update", "vehicle", "d", "2026-06-09T09:00:00Z")));
        using var vm = new OperationsSectionViewModel(source, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(OperationsSectionState.Stale, vm.State);
        Assert.True(vm.IsStale);
    }

    [Fact]
    public async Task ViewModel_offline_when_a_read_is_offline_with_content()
    {
        var source = new FakeSource(
            new[]
            {
                RepositoryResult<OperationsNotificationStats>.OfflineCached(
                    new OperationsNotificationStats(10, 9, 1, 0, 2, 2), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")),
            },
            Logs(LoadStatus.Loaded, new OperationsNotificationLog(1, "t", "m", "sent", "2026-06-09T10:00:00Z")),
            AuditEmpty());
        using var vm = new OperationsSectionViewModel(source, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(OperationsSectionState.Offline, vm.State);
        Assert.True(vm.IsError);
        Assert.True(vm.IsStale);
    }

    [Fact]
    public async Task ViewModel_loaded_with_only_stats_when_logs_and_audit_are_empty()
    {
        var source = new FakeSource(
            Stats(LoadStatus.Loaded, new OperationsNotificationStats(10, 10, 0, 0, 1, 1)),
            LogsEmpty(),
            AuditEmpty());
        using var vm = new OperationsSectionViewModel(source, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(OperationsSectionState.Loaded, vm.State);
        Assert.True(vm.Display.HasNotificationStats);
        Assert.False(vm.Display.HasNotificationLogs);
        Assert.False(vm.Display.HasAudit);
    }

    // ---- Localized chrome resolves the required web keys ------------------------------------------------

    [Fact]
    public void ViewModel_exposes_web_strings_through_the_localizer()
    {
        using var vm = new OperationsSectionViewModel(new FakeSource(), Localizer, () => Now);

        Assert.Equal("Operations", vm.Title);
        Assert.Equal("Notification delivery and audit trail", vm.Description);
        Assert.Equal("Notification Delivery", vm.NotificationDeliveryTitle);
        Assert.Equal("Audit Log", vm.AuditLogTitle);
        Assert.Equal("No data available", vm.NoNotificationDataMessage);
        Assert.Equal("No audit log entries", vm.NoAuditMessage);
    }

    [Fact]
    public void Required_web_i18n_keys_are_requested_through_the_facade()
    {
        var recorder = new RecordingLocalizer();
        using var vm = new OperationsSectionViewModel(new FakeSource(), recorder, () => Now);

        _ = vm.Title;
        _ = vm.Description;
        _ = vm.NotificationDeliveryTitle;
        _ = vm.AuditLogTitle;
        _ = vm.NoNotificationDataMessage;

        Assert.Contains("featureView.operations.title", recorder.Keys);
        Assert.Contains("featureView.operations.description", recorder.Keys);
        Assert.Contains("featureView.operations.notificationDelivery", recorder.Keys);
        Assert.Contains("featureView.operations.auditLog", recorder.Keys);
        Assert.Contains("featureView.operations.noData", recorder.Keys);
    }

    // ---- Diagnostics + registration ---------------------------------------------------------------------

    [Fact]
    public void Diagnostics_records_view_opened_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new OperationsSectionDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=OperationsSection", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_canonical_metadata()
    {
        Assert.Equal("OperationsSection", OperationsSectionRegistration.Slug);
        Assert.Equal("operations-section", OperationsSectionRegistration.Id);
        Assert.Equal("Operations", OperationsSectionRegistration.Title(Localizer));
        Assert.Equal("Notification delivery and audit trail", OperationsSectionRegistration.Description(Localizer));
    }

    // ---- Test doubles -----------------------------------------------------------------------------------

    private static RepositoryResult<OperationsNotificationStats>[] Stats(LoadStatus status, OperationsNotificationStats value) =>
        new[] { status == LoadStatus.Loaded ? RepositoryResult<OperationsNotificationStats>.Loaded(value, Now) : RepositoryResult<OperationsNotificationStats>.Cached(value, Now, false) };

    private static RepositoryResult<OperationsNotificationStats>[] StatsEmpty() =>
        new[] { RepositoryResult<OperationsNotificationStats>.Empty(Now) };

    private static RepositoryResult<OperationsNotificationStats>[] StatsFail() =>
        new[] { RepositoryResult<OperationsNotificationStats>.Failure(new RepositoryError(RepositoryErrorKind.Unknown, "x")) };

    private static RepositoryResult<IReadOnlyList<OperationsNotificationLog>>[] Logs(LoadStatus status, params OperationsNotificationLog[] rows)
    {
        IReadOnlyList<OperationsNotificationLog> list = rows;
        return new[] { RepositoryResult<IReadOnlyList<OperationsNotificationLog>>.Loaded(list, Now) };
    }

    private static RepositoryResult<IReadOnlyList<OperationsNotificationLog>>[] LogsEmpty() =>
        new[] { RepositoryResult<IReadOnlyList<OperationsNotificationLog>>.Empty(Now) };

    private static RepositoryResult<IReadOnlyList<OperationsNotificationLog>>[] LogsFail() =>
        new[] { RepositoryResult<IReadOnlyList<OperationsNotificationLog>>.Failure(new RepositoryError(RepositoryErrorKind.Unknown, "x")) };

    private static RepositoryResult<IReadOnlyList<OperationsAuditEntry>>[] Audit(LoadStatus status, params OperationsAuditEntry[] rows)
    {
        IReadOnlyList<OperationsAuditEntry> list = rows;
        return new[] { RepositoryResult<IReadOnlyList<OperationsAuditEntry>>.Loaded(list, Now) };
    }

    private static RepositoryResult<IReadOnlyList<OperationsAuditEntry>>[] AuditEmpty() =>
        new[] { RepositoryResult<IReadOnlyList<OperationsAuditEntry>>.Empty(Now) };

    private static RepositoryResult<IReadOnlyList<OperationsAuditEntry>>[] AuditFail() =>
        new[] { RepositoryResult<IReadOnlyList<OperationsAuditEntry>>.Failure(new RepositoryError(RepositoryErrorKind.Unknown, "x")) };

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    /// <summary>A fake source that replays a fixed sequence of emissions per read. Defaults to a single
    /// Loading emission so a freshly-constructed view-model that never loads stays on the skeleton.</summary>
    private sealed class FakeSource : IOperationsSectionSource
    {
        private readonly RepositoryResult<OperationsNotificationStats>[] _stats;
        private readonly RepositoryResult<IReadOnlyList<OperationsNotificationLog>>[] _logs;
        private readonly RepositoryResult<IReadOnlyList<OperationsAuditEntry>>[] _audit;

        public FakeSource(
            RepositoryResult<OperationsNotificationStats>[]? stats = null,
            RepositoryResult<IReadOnlyList<OperationsNotificationLog>>[]? logs = null,
            RepositoryResult<IReadOnlyList<OperationsAuditEntry>>[]? audit = null)
        {
            _stats = stats ?? new[] { RepositoryResult<OperationsNotificationStats>.Loading() };
            _logs = logs ?? new[] { RepositoryResult<IReadOnlyList<OperationsNotificationLog>>.Loading() };
            _audit = audit ?? new[] { RepositoryResult<IReadOnlyList<OperationsAuditEntry>>.Loading() };
        }

        public IAsyncEnumerable<RepositoryResult<OperationsNotificationStats>> StreamStatsAsync(CancellationToken cancellationToken = default) =>
            Replay(_stats, cancellationToken);

        public IAsyncEnumerable<RepositoryResult<IReadOnlyList<OperationsNotificationLog>>> StreamLogsAsync(CancellationToken cancellationToken = default) =>
            Replay(_logs, cancellationToken);

        public IAsyncEnumerable<RepositoryResult<IReadOnlyList<OperationsAuditEntry>>> StreamAuditAsync(CancellationToken cancellationToken = default) =>
            Replay(_audit, cancellationToken);

        private static async IAsyncEnumerable<T> Replay<T>(T[] items, [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            foreach (var item in items)
            {
                cancellationToken.ThrowIfCancellationRequested();
                await Task.Yield();
                yield return item;
            }
        }
    }
}
