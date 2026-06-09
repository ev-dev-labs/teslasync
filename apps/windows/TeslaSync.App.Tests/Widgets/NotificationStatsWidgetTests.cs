using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the NotificationStatsWidget's UI-thread-free logic — the JSON parse adapters
/// (the delivery-stats rollup and the recent-delivery log), the status → badge/glyph mapping, the
/// projection (four stat tiles with the volume/healthy/needs-attention trend gates, the compact big-number
/// delivery rate, and the wide recent-delivery rows with relative-time tiers), the multi-source combine
/// mapper (stats load-bearing; logs enriching with the freshness union), the footprint flags, the registry
/// metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading / loaded /
/// empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/NotificationStatsWidget.tsx).
/// </summary>
public sealed class NotificationStatsWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static NotificationStatsReading Reading(
        long totalSent = 100,
        long sent = 95,
        long failed = 2,
        long pending = 3,
        long totalChannels = 4,
        long enabledChannels = 3,
        params NotificationLogEntry[] logs) =>
        new(
            new NotificationStatsData(totalSent, sent, failed, pending, totalChannels, enabledChannels),
            logs);

    private static NotificationLogEntry Log(
        long id,
        string? title = "Email",
        string? message = "low_battery",
        string? status = "sent",
        string createdAt = "2026-06-06T12:00:00Z") =>
        new(id, title, message, status, createdAt);

    // ---- Stats parse adapter -------------------------------------------------------

    [Fact]
    public void StatsFromJson_reads_snake_case_fields()
    {
        const string json = """
        {"total_sent":120,"sent":110,"failed":7,"pending":3,"total_channels":5,"enabled_channels":4}
        """;
        using var doc = JsonDocument.Parse(json);

        var stats = NotificationStatsData.FromJson(doc.RootElement);

        Assert.Equal(120, stats.TotalSent);
        Assert.Equal(110, stats.Sent);
        Assert.Equal(7, stats.Failed);
        Assert.Equal(3, stats.Pending);
        Assert.Equal(5, stats.TotalChannels);
        Assert.Equal(4, stats.EnabledChannels);
        Assert.True(stats.HasData);
    }

    [Fact]
    public void StatsFromJson_falls_back_to_camel_case()
    {
        using var doc = JsonDocument.Parse("""{"totalSent":50,"enabledChannels":2}""");

        var stats = NotificationStatsData.FromJson(doc.RootElement);

        Assert.Equal(50, stats.TotalSent);
        Assert.Equal(2, stats.EnabledChannels);
    }

    [Fact]
    public void StatsFromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""{"sent":4}""");

        var stats = NotificationStatsData.FromJson(doc.RootElement);

        Assert.Equal(0, stats.TotalSent);
        Assert.Equal(4, stats.Sent);
        Assert.True(stats.HasData); // a present object renders (web shows zeros, not empty)
    }

    [Fact]
    public void StatsFromJson_accepts_numeric_strings()
    {
        using var doc = JsonDocument.Parse("""{"total_sent":"42","sent":"40"}""");
        var stats = NotificationStatsData.FromJson(doc.RootElement);
        Assert.Equal(42, stats.TotalSent);
        Assert.Equal(40, stats.Sent);
    }

    [Fact]
    public void StatsFromJson_returns_empty_for_non_object()
    {
        using var doc = JsonDocument.Parse("[]");
        var stats = NotificationStatsData.FromJson(doc.RootElement);
        Assert.False(stats.HasData);
        Assert.Equal(0, stats.TotalSent);
    }

    [Fact]
    public void StatsEmpty_snapshot_has_no_data()
    {
        Assert.False(NotificationStatsData.Empty.HasData);
        Assert.True(new NotificationStatsData(1, 1, 0, 0, 1, 1).HasData);
    }

    [Theory]
    [InlineData(100, 95, 95.0)]
    [InlineData(0, 0, 0.0)]      // web: totalSent === 0 -> 0
    [InlineData(200, 50, 25.0)]
    public void DeliveryRate_matches_web(long totalSent, long sent, double expected) =>
        Assert.Equal(expected, new NotificationStatsData(totalSent, sent, 0, 0, 0, 0).DeliveryRate, 3);

    // ---- Log parse adapter ---------------------------------------------------------

    [Fact]
    public void LogParseList_reads_snake_case_fields()
    {
        const string json = """
        [{"id":7,"title":"Email","message":"low_battery","status":"sent","created_at":"2026-06-06T12:00:00Z"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var log = Assert.Single(NotificationLogEntry.ParseList(doc.RootElement));

        Assert.Equal(7, log.Id);
        Assert.Equal("Email", log.Title);
        Assert.Equal("low_battery", log.Message);
        Assert.Equal("sent", log.Status);
        Assert.NotNull(log.CreatedAtTime);
    }

    [Fact]
    public void LogParseList_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"id":2}]""");

        var log = Assert.Single(NotificationLogEntry.ParseList(doc.RootElement));

        Assert.Equal(2, log.Id);
        Assert.Null(log.Title);
        Assert.Null(log.Status);
        Assert.Null(log.CreatedAtTime);
    }

    [Fact]
    public void LogParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Empty(NotificationLogEntry.ParseList(doc.RootElement));
    }

    // ---- Status mapping (web STATUS_VARIANT + icon ternaries) ----------------------

    [Theory]
    [InlineData("sent", StatusKind.Success)]
    [InlineData("failed", StatusKind.Danger)]
    [InlineData("pending", StatusKind.Warning)]
    [InlineData("deferred_dnd", StatusKind.Warning)] // web `?? 'warning'`
    [InlineData(null, StatusKind.Warning)]
    public void Status_variant_matches_web(string? status, StatusKind expected) =>
        Assert.Equal(expected, NotificationStatuses.Variant(status));

    [Fact]
    public void Status_glyph_only_set_for_known_statuses()
    {
        Assert.Equal(NotificationStatuses.SentGlyph, NotificationStatuses.Glyph("sent"));
        Assert.Equal(NotificationStatuses.FailedGlyph, NotificationStatuses.Glyph("failed"));
        Assert.Equal(NotificationStatuses.PendingGlyph, NotificationStatuses.Glyph("pending"));
        Assert.Equal(string.Empty, NotificationStatuses.Glyph("deferred_dnd"));
        Assert.Equal(string.Empty, NotificationStatuses.Glyph(null));
    }

    [Fact]
    public void Status_label_falls_back_to_em_dash()
    {
        Assert.Equal("sent", NotificationStatuses.Label("sent"));
        Assert.Equal("\u2014", NotificationStatuses.Label(null));
        Assert.Equal("\u2014", NotificationStatuses.Label(""));
    }

    // ---- Size / footprint (web isCompact / isWide) ---------------------------------

    [Theory]
    [InlineData(1, true, false, 2, 3)]   // compact
    [InlineData(2, false, false, 2, 5)]  // standard 2-up
    [InlineData(3, false, true, 4, 5)]   // wide 4-up
    [InlineData(4, false, true, 4, 5)]   // wide (max)
    public void Size_flags_match_web(int cols, bool compact, bool wide, int statCols, int logLimit)
    {
        var size = new NotificationStatsSize(cols, 2);
        Assert.Equal(compact, size.IsCompact);
        Assert.Equal(wide, size.IsWide);
        Assert.Equal(statCols, size.StatColumns);
        Assert.Equal(logLimit, size.RecentLogLimit);
    }

    // ---- Projection: stat tiles ----------------------------------------------------

    [Fact]
    public void Project_builds_four_tiles_in_web_order()
    {
        var display = NotificationStatsProjection.Project(Reading(), new NotificationStatsSize(2, 2), Localizer, Now);

        Assert.Equal(4, display.Stats.Count);
        Assert.Equal("Total Sent (7d)", display.Stats[0].Label);
        Assert.Equal("Delivery Rate", display.Stats[1].Label);
        Assert.Equal("Failed", display.Stats[2].Label);
        Assert.Equal("Active Channels", display.Stats[3].Label);
        Assert.Equal(2, display.StatColumns);
    }

    [Fact]
    public void Project_formats_values_and_units_like_web()
    {
        var display = NotificationStatsProjection.Project(
            Reading(totalSent: 1234, sent: 1200, failed: 5, enabledChannels: 3),
            new NotificationStatsSize(2, 2),
            Localizer,
            Now);

        Assert.Equal("1,234", display.Stats[0].Value);  // fmtInt grouping
        Assert.Equal("%", display.Stats[1].Unit);
        Assert.Equal("5", display.Stats[2].Value);
        Assert.Equal("3", display.Stats[3].Value);
        Assert.Null(display.Stats[0].Unit);
    }

    [Fact]
    public void Project_total_sent_trend_only_when_volume_present()
    {
        var withVolume = NotificationStatsProjection.Project(Reading(totalSent: 10), NotificationStatsSize.Default, Localizer, Now);
        var zeroVolume = NotificationStatsProjection.Project(Reading(totalSent: 0, sent: 0, failed: 0), NotificationStatsSize.Default, Localizer, Now);

        Assert.NotNull(withVolume.Stats[0].Trend);
        Assert.Equal("\u2191", withVolume.Stats[0].Trend!.Arrow);
        Assert.Null(zeroVolume.Stats[0].Trend);
    }

    [Fact]
    public void Project_delivery_rate_healthy_trend_at_threshold()
    {
        var healthy = NotificationStatsProjection.Project(Reading(totalSent: 100, sent: 96), NotificationStatsSize.Default, Localizer, Now);
        var unhealthy = NotificationStatsProjection.Project(Reading(totalSent: 100, sent: 80), NotificationStatsSize.Default, Localizer, Now);

        Assert.Equal("96.0", healthy.Stats[1].Value);
        Assert.NotNull(healthy.Stats[1].Trend);
        Assert.Equal("Healthy", healthy.Stats[1].Trend!.Value);
        Assert.Null(unhealthy.Stats[1].Trend); // web: trendValue undefined below 95 -> no badge
    }

    [Fact]
    public void Project_failed_tile_flags_danger_and_needs_attention()
    {
        var withFailures = NotificationStatsProjection.Project(Reading(failed: 3), NotificationStatsSize.Default, Localizer, Now);
        var noFailures = NotificationStatsProjection.Project(Reading(failed: 0), NotificationStatsSize.Default, Localizer, Now);

        Assert.NotNull(withFailures.Stats[2].Trend);
        Assert.Equal("\u2193", withFailures.Stats[2].Trend!.Arrow);
        Assert.Equal("Needs attention", withFailures.Stats[2].Trend!.Value);
        Assert.Equal("TsColorDangerBrush", withFailures.Stats[2].ValueBrushKey); // web valueColor text-red-400

        Assert.Null(noFailures.Stats[2].Trend);
        Assert.Null(noFailures.Stats[2].ValueBrushKey);
    }

    [Fact]
    public void Project_tiles_have_non_empty_accessibility_names()
    {
        var display = NotificationStatsProjection.Project(Reading(), NotificationStatsSize.Default, Localizer, Now);

        foreach (var tile in display.Stats)
        {
            Assert.False(string.IsNullOrWhiteSpace(tile.AutomationName));
            Assert.Contains(tile.Label, tile.AutomationName, StringComparison.Ordinal);
            Assert.Contains(tile.Value, tile.AutomationName, StringComparison.Ordinal);
        }
    }

    // ---- Projection: compact -------------------------------------------------------

    [Fact]
    public void Project_compact_shows_rate_label_and_failed_line()
    {
        var display = NotificationStatsProjection.Project(
            Reading(totalSent: 100, sent: 90, failed: 4),
            new NotificationStatsSize(1, 2),
            Localizer,
            Now);

        Assert.True(display.IsCompact);
        Assert.Equal("90.0%", display.CompactValue);
        Assert.Equal("Delivery Rate", display.CompactLabel);
        Assert.Equal("4 failed", display.CompactFailedText);
        Assert.Contains("90.0%", display.CompactAutomationName, StringComparison.Ordinal);
        Assert.Contains("4 failed", display.CompactAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_compact_omits_failed_line_when_no_failures()
    {
        var display = NotificationStatsProjection.Project(
            Reading(totalSent: 100, sent: 100, failed: 0),
            new NotificationStatsSize(1, 2),
            Localizer,
            Now);

        Assert.Null(display.CompactFailedText);
        Assert.Equal("100.0%", display.CompactValue);
    }

    // ---- Projection: recent log table (wide only) ----------------------------------

    [Fact]
    public void Project_log_table_only_shows_when_wide_and_non_empty()
    {
        var logs = new[] { Log(1), Log(2) };
        var wide = NotificationStatsProjection.Project(Reading(logs: logs), new NotificationStatsSize(3, 4), Localizer, Now);
        var standard = NotificationStatsProjection.Project(Reading(logs: logs), new NotificationStatsSize(2, 2), Localizer, Now);
        var wideNoLogs = NotificationStatsProjection.Project(Reading(), new NotificationStatsSize(3, 4), Localizer, Now);

        Assert.True(wide.ShowLogTable);
        Assert.False(standard.ShowLogTable); // not wide
        Assert.False(wideNoLogs.ShowLogTable); // wide but no rows
    }

    [Fact]
    public void Project_log_rows_sorted_newest_first_and_capped()
    {
        var logs = new List<NotificationLogEntry>();
        for (int i = 0; i < 8; i++)
        {
            var ts = new DateTimeOffset(2026, 6, 6, 10, i, 0, TimeSpan.Zero);
            logs.Add(Log(i, createdAt: ts.ToString("o", CultureInfo.InvariantCulture)));
        }

        var display = NotificationStatsProjection.Project(
            Reading(logs: logs.ToArray()),
            new NotificationStatsSize(3, 4),
            Localizer,
            Now);

        Assert.Equal(5, display.LogRows.Count);   // limit 5
        Assert.Equal(7, display.LogRows[0].Id);    // newest first
        Assert.Equal(3, display.LogRows[^1].Id);
    }

    [Fact]
    public void Project_log_row_resolves_status_relative_time_and_em_dashes()
    {
        var display = NotificationStatsProjection.Project(
            Reading(logs: new[] { Log(1, title: null, message: null, status: "failed", createdAt: "2026-06-06T12:00:00Z") }),
            new NotificationStatsSize(3, 4),
            Localizer,
            Now);

        var row = Assert.Single(display.LogRows);
        Assert.Equal("\u2014", row.Channel);  // title ?? '—'
        Assert.Equal("\u2014", row.Type);      // message ?? '—'
        Assert.Equal(StatusKind.Danger, row.StatusVariant);
        Assert.Equal("failed", row.StatusLabel);
        Assert.Equal(NotificationStatuses.FailedGlyph, row.StatusGlyph);
        Assert.Equal("5m ago", row.RelativeTime);
        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
    }

    // ---- Combine mapper (stats load-bearing; logs enriching) -----------------------

    [Fact]
    public void Combine_merges_stats_and_logs()
    {
        using var stats = JsonDocument.Parse("""{"total_sent":100,"sent":95,"failed":2,"enabled_channels":3}""");
        using var logs = JsonDocument.Parse("""[{"id":1,"title":"Email","status":"sent","created_at":"2026-06-06T12:00:00Z"}]""");

        var result = NotificationStatsResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(stats.RootElement, Now.AddMinutes(-1)),
            RepositoryResult<JsonElement>.Loaded(logs.RootElement, Now));

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.Equal(100, result.Value!.Stats.TotalSent);
        Assert.Single(result.Value!.Logs);
        Assert.Equal(Now, result.FetchedAt); // web Math.max(...dataUpdatedAt)
    }

    [Fact]
    public void Combine_stats_failure_is_the_retry_surface()
    {
        var result = NotificationStatsResultMapper.Combine(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")),
            null);

        Assert.Equal(LoadStatus.Error, result.Status);
    }

    [Fact]
    public void Combine_absent_stats_body_is_empty()
    {
        var result = NotificationStatsResultMapper.Combine(RepositoryResult<JsonElement>.Empty(Now), null);
        Assert.Equal(LoadStatus.Empty, result.Status); // web stats ? ... : <EmptyState>
    }

    [Fact]
    public void Combine_without_logs_still_renders_stats()
    {
        using var stats = JsonDocument.Parse("""{"total_sent":10,"sent":9}""");

        var result = NotificationStatsResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(stats.RootElement, Now), null);

        Assert.Equal(LoadStatus.Loaded, result.Status);
        Assert.Empty(result.Value!.Logs);
    }

    [Fact]
    public void Combine_failed_logs_still_render_stats()
    {
        using var stats = JsonDocument.Parse("""{"total_sent":10,"sent":9}""");

        var result = NotificationStatsResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(stats.RootElement, Now),
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "logs down")));

        Assert.Equal(LoadStatus.Loaded, result.Status); // stats load-bearing; logs enrichment degrades
        Assert.Empty(result.Value!.Logs);
    }

    [Fact]
    public void Combine_stale_logs_mark_the_union_stale()
    {
        using var stats = JsonDocument.Parse("""{"total_sent":10,"sent":9}""");
        using var logs = JsonDocument.Parse("""[{"id":1,"status":"sent","created_at":"2026-06-06T12:00:00Z"}]""");

        var result = NotificationStatsResultMapper.Combine(
            RepositoryResult<JsonElement>.Loaded(stats.RootElement, Now),
            RepositoryResult<JsonElement>.Cached(logs.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, result.Status);
        Assert.True(result.IsStale);
    }

    [Fact]
    public void Combine_offline_stats_is_offline_cached()
    {
        using var stats = JsonDocument.Parse("""{"total_sent":10,"sent":9}""");

        var result = NotificationStatsResultMapper.Combine(
            RepositoryResult<JsonElement>.OfflineCached(stats.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")),
            null);

        Assert.Equal(LoadStatus.Offline, result.Status);
        Assert.Equal(10, result.Value!.Stats.TotalSent);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<NotificationStatsReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(NotificationStatsState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_display()
    {
        using var vm = NewViewModel(RepositoryResult<NotificationStatsReading>.Loaded(Reading(), Now));
        await vm.LoadAsync();

        Assert.Equal(NotificationStatsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal(4, vm.Display!.Stats.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<NotificationStatsReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(NotificationStatsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No notification data", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<NotificationStatsReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(NotificationStatsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_content()
    {
        using var vm = NewViewModel(
            RepositoryResult<NotificationStatsReading>.Cached(Reading(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(NotificationStatsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_content()
    {
        using var vm = NewViewModel(RepositoryResult<NotificationStatsReading>.OfflineCached(
            Reading(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(NotificationStatsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<NotificationStatsReading>.Loading(),
            RepositoryResult<NotificationStatsReading>.Cached(Reading(), Now, stale: false),
            RepositoryResult<NotificationStatsReading>.Loaded(Reading(totalSent: 200), Now));
        await vm.LoadAsync();

        Assert.Equal(NotificationStatsState.Loaded, vm.State);
        Assert.Equal("200", vm.Display!.Stats[0].Value);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_layout()
    {
        using var vm = NewViewModel(
            new NotificationStatsSize(1, 2),
            RepositoryResult<NotificationStatsReading>.Loaded(Reading(totalSent: 100, sent: 90), Now));
        await vm.LoadAsync();
        Assert.True(vm.Display!.IsCompact);

        vm.Size = new NotificationStatsSize(3, 4);
        Assert.False(vm.Display!.IsCompact);
        Assert.True(vm.Display!.IsWide);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state()
    {
        using var vm = NewViewModel(RepositoryResult<NotificationStatsReading>.Loaded(Reading(), Now));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(NotificationStatsViewModel.State), changed);
        Assert.Contains(nameof(NotificationStatsViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("notification-stats", NotificationStatsRegistration.Id);
        Assert.Equal("alerts", NotificationStatsRegistration.Category);
        Assert.Equal("NotificationStatsWidget", NotificationStatsRegistration.Slug);
        Assert.Equal(new NotificationStatsSize(2, 2), NotificationStatsRegistration.DefaultSize);
        Assert.Equal(new NotificationStatsSize(1, 2), NotificationStatsRegistration.MinSize);
        Assert.Equal(new NotificationStatsSize(4, 40), NotificationStatsRegistration.MaxSize);
        Assert.Equal("Notification Stats", NotificationStatsRegistration.Name(Localizer));
        Assert.Contains("delivery", NotificationStatsRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 2, true)]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(1, 1, false)]  // below min rows
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, NotificationStatsRegistration.IsWithinBounds(new NotificationStatsSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new NotificationStatsSize(1, 2), NotificationStatsRegistration.Clamp(new NotificationStatsSize(0, 1)));
        Assert.Equal(new NotificationStatsSize(4, 40), NotificationStatsRegistration.Clamp(new NotificationStatsSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new NotificationStatsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=NotificationStatsWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static NotificationStatsViewModel NewViewModel(params RepositoryResult<NotificationStatsReading>[] emissions) =>
        NewViewModel(NotificationStatsSize.Default, emissions);

    private static NotificationStatsViewModel NewViewModel(
        NotificationStatsSize size,
        params RepositoryResult<NotificationStatsReading>[] emissions) =>
        new(new FakeNotificationStatsSource(emissions), Localizer, size, () => Now);

    private sealed class FakeNotificationStatsSource(params RepositoryResult<NotificationStatsReading>[] emissions)
        : INotificationStatsSource
    {
        public async IAsyncEnumerable<RepositoryResult<NotificationStatsReading>> StreamAsync(
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
