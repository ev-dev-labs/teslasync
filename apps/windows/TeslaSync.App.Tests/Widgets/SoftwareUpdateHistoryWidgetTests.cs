using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the SoftwareUpdateHistoryWidget's UI-thread-free logic — the parse adapter, the
/// status presentation map, the projection (current detection / sort / cap / compact summary / labels), the
/// cache-then-network result mapper, the registry metadata, the diagnostics, and the state-holder view-model's
/// per-state transitions (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/SoftwareUpdateHistoryWidget.tsx).
/// </summary>
public sealed class SoftwareUpdateHistoryWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static SoftwareUpdateSample Update(
        long id = 1,
        string? version = "2026.8.1",
        string? status = "installed",
        string? installedAt = "2026-06-06T12:00:00Z",
        string? scheduledAt = null,
        string? createdAt = "2026-06-06T11:00:00Z",
        long vehicleId = 7) =>
        new(
            Id: id,
            VehicleId: vehicleId,
            Version: version,
            Status: status,
            InstalledAtRaw: installedAt,
            ScheduledAtRaw: scheduledAt,
            CreatedAtRaw: createdAt);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void ParseList_reads_snake_case_fields()
    {
        const string json = """
        [{"id":3,"vehicle_id":7,"version":"2026.8.1","status":"installing",
          "installed_at":null,"scheduled_at":"2026-06-07T03:00:00Z","created_at":"2026-06-06T11:00:00Z"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var sample = Assert.Single(SoftwareUpdateSample.ParseList(doc.RootElement));

        Assert.Equal(3, sample.Id);
        Assert.Equal(7, sample.VehicleId);
        Assert.Equal("2026.8.1", sample.Version);
        Assert.Equal("installing", sample.Status);
        Assert.Null(sample.InstalledAtRaw);
        Assert.Equal("2026-06-07T03:00:00Z", sample.ScheduledAtRaw);
        Assert.Equal("2026-06-06T11:00:00Z", sample.CreatedAtRaw);
    }

    [Fact]
    public void ParseList_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"id":2}]""");

        var sample = Assert.Single(SoftwareUpdateSample.ParseList(doc.RootElement));

        Assert.Equal(2, sample.Id);
        Assert.Null(sample.Version);
        Assert.Null(sample.Status);
        Assert.Null(sample.EffectiveTimestamp);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Empty(SoftwareUpdateSample.ParseList(doc.RootElement));
    }

    [Theory]
    [InlineData("2026-06-06T12:00:00Z", "2026-06-07T03:00:00Z", "2026-06-06T11:00:00Z", "2026-06-06T12:00:00Z")] // installed wins
    [InlineData(null, "2026-06-07T03:00:00Z", "2026-06-06T11:00:00Z", "2026-06-07T03:00:00Z")]                   // scheduled wins
    [InlineData(null, null, "2026-06-06T11:00:00Z", "2026-06-06T11:00:00Z")]                                     // created wins
    public void EffectiveTimestamp_follows_web_precedence(string? installed, string? scheduled, string? created, string expected)
    {
        var sample = Update(installedAt: installed, scheduledAt: scheduled, createdAt: created);

        Assert.Equal(DateTimeOffset.Parse(expected, CultureInfo.InvariantCulture), sample.EffectiveTimestamp);
    }

    // ---- Status presentation (port of web STATUS_MAP) ------------------------------

    [Theory]
    [InlineData("installed", "TsColorSuccessBrush", SeverityLevel.Info)]
    [InlineData("installing", "TsColorWarningBrush", SeverityLevel.Warn)]
    [InlineData("downloading", "TsColorInfoBrush", SeverityLevel.Info)]
    [InlineData("available", "TsColorTextSecondaryBrush", SeverityLevel.Info)]
    [InlineData("scheduled", "TsColorInfoBrush", SeverityLevel.Info)]
    [InlineData("mystery", "TsColorTextSecondaryBrush", SeverityLevel.Info)] // default
    public void StatusPresentation_maps_status_to_tokens(string status, string accentKey, SeverityLevel severity)
    {
        var tokens = SoftwareUpdateStatusPresentation.For(status);

        Assert.Equal(accentKey, tokens.AccentBrushKey);
        Assert.Equal(severity, tokens.Severity);
        Assert.False(string.IsNullOrEmpty(tokens.Glyph));
    }

    [Theory]
    [InlineData("installed", StatusKind.Success)]
    [InlineData("installing", StatusKind.Warning)]
    [InlineData("downloading", StatusKind.Info)]
    [InlineData("available", StatusKind.Info)]
    [InlineData("scheduled", StatusKind.Info)]
    public void StatusPresentation_badge_status_matches_web_variant(string status, StatusKind expected) =>
        Assert.Equal(expected, SoftwareUpdateStatusPresentation.BadgeStatus(status));

    [Fact]
    public void StatusPresentation_is_case_insensitive()
    {
        Assert.True(SoftwareUpdateStatusPresentation.IsInstalled("INSTALLED"));
        Assert.Equal("TsColorWarningBrush", SoftwareUpdateStatusPresentation.For("Installing").AccentBrushKey);
    }

    // ---- Size (web isCompact) ------------------------------------------------------

    [Theory]
    [InlineData(1, 4, true)]
    [InlineData(2, 4, false)]
    [InlineData(4, 40, false)]
    public void Size_is_compact_at_single_column(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new SoftwareUpdateHistorySize(cols, rows).IsCompact);

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_empty_list_has_no_data()
    {
        var display = SoftwareUpdateHistoryProjection.Project(
            Array.Empty<SoftwareUpdateSample>(), SoftwareUpdateHistorySize.Default, Localizer, Now);

        Assert.False(display.HasData);
        Assert.Empty(display.Rows);
        Assert.Null(display.Compact);
    }

    [Fact]
    public void Project_marks_first_installed_row_as_current()
    {
        var samples = new[]
        {
            Update(1, version: "2026.8.1", status: "installed", installedAt: "2026-06-06T12:00:00Z"),
            Update(2, version: "2026.4.2", status: "installed", installedAt: "2026-05-01T09:00:00Z"),
        };

        var display = SoftwareUpdateHistoryProjection.Project(samples, new SoftwareUpdateHistorySize(2, 4), Localizer, Now);

        var current = Assert.Single(display.Rows, r => r.IsCurrent);
        Assert.Equal(1, current.Id);
        Assert.Equal("Current", current.Subtitle);
        Assert.Equal(SoftwareUpdateHistoryProjection.CurrentAccentBrushKey, current.AccentBrushKey);
        Assert.Equal(SoftwareUpdateHistoryProjection.CurrentGlyph, current.Glyph);
    }

    [Fact]
    public void Project_does_not_mark_current_when_first_not_installed()
    {
        var samples = new[]
        {
            Update(1, status: "downloading", installedAt: null, createdAt: "2026-06-06T12:00:00Z"),
            Update(2, status: "installed", installedAt: "2026-05-01T09:00:00Z"),
        };

        var display = SoftwareUpdateHistoryProjection.Project(samples, new SoftwareUpdateHistorySize(2, 4), Localizer, Now);

        Assert.DoesNotContain(display.Rows, r => r.IsCurrent);
        var downloading = Assert.Single(display.Rows, r => r.Id == 1);
        Assert.Equal("downloading", downloading.Subtitle);
        Assert.Equal("TsColorInfoBrush", downloading.AccentBrushKey);
    }

    [Fact]
    public void Project_sorts_newest_first_and_caps_to_15()
    {
        var samples = new List<SoftwareUpdateSample>();
        for (int i = 0; i < 20; i++)
        {
            // i=0 oldest … i=19 newest
            var ts = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero).AddDays(i);
            samples.Add(Update(
                id: i,
                version: $"2026.{i}",
                status: "available",
                installedAt: null,
                scheduledAt: null,
                createdAt: ts.ToString("o", CultureInfo.InvariantCulture)));
        }

        var display = SoftwareUpdateHistoryProjection.Project(samples, new SoftwareUpdateHistorySize(2, 4), Localizer, Now);

        Assert.Equal(15, display.Rows.Count);    // web maxItems={15}
        Assert.Equal(19, display.Rows[0].Id);     // newest first
        Assert.Equal(5, display.Rows[^1].Id);      // 15 newest of 0..19 -> ids 19..5
    }

    [Fact]
    public void Project_compact_summarizes_latest_installed()
    {
        var samples = new[] { Update(1, version: "2026.8.1", status: "installed") };

        var display = SoftwareUpdateHistoryProjection.Project(samples, new SoftwareUpdateHistorySize(1, 4), Localizer, Now);

        Assert.True(display.IsCompact);
        Assert.NotNull(display.Compact);
        Assert.Equal("2026.8.1", display.Compact!.Version);
        Assert.Equal("Current", display.Compact.BadgeText);
        Assert.Equal(StatusKind.Success, display.Compact.BadgeStatus);
    }

    [Fact]
    public void Project_compact_shows_raw_status_when_not_installed()
    {
        var samples = new[] { Update(1, version: "2026.9.0", status: "downloading", installedAt: null) };

        var display = SoftwareUpdateHistoryProjection.Project(samples, new SoftwareUpdateHistorySize(1, 4), Localizer, Now);

        Assert.Equal("downloading", display.Compact!.BadgeText);
        Assert.Equal(StatusKind.Info, display.Compact.BadgeStatus);
    }

    [Fact]
    public void Project_falls_back_to_em_dash_for_missing_version_and_status()
    {
        var samples = new[] { Update(1, version: "", status: "", installedAt: null, scheduledAt: null, createdAt: "2026-06-06T11:00:00Z") };

        var display = SoftwareUpdateHistoryProjection.Project(samples, new SoftwareUpdateHistorySize(2, 4), Localizer, Now);

        var row = Assert.Single(display.Rows);
        Assert.Equal("\u2014", row.Version);
        Assert.Equal("\u2014", row.Subtitle);
    }

    [Fact]
    public void Project_uses_unix_epoch_when_all_timestamps_absent()
    {
        var samples = new[] { Update(1, status: "available", installedAt: null, scheduledAt: null, createdAt: null) };

        var display = SoftwareUpdateHistoryProjection.Project(samples, new SoftwareUpdateHistorySize(2, 4), Localizer, Now);

        Assert.Equal(DateTimeOffset.UnixEpoch, Assert.Single(display.Rows).Timestamp);
    }

    [Fact]
    public void Project_row_has_non_empty_accessibility_name()
    {
        var samples = new[] { Update(1, version: "2026.8.1", status: "installed", installedAt: "2026-06-06T12:00:00Z") };

        var row = Assert.Single(SoftwareUpdateHistoryProjection.Project(samples, new SoftwareUpdateHistorySize(2, 4), Localizer, Now).Rows);

        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains("2026.8.1", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Current", row.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_compact_has_non_empty_accessibility_name()
    {
        var samples = new[] { Update(1, version: "2026.8.1", status: "installed") };

        var compact = SoftwareUpdateHistoryProjection.Project(samples, new SoftwareUpdateHistorySize(1, 4), Localizer, Now).Compact!;

        Assert.False(string.IsNullOrWhiteSpace(compact.AutomationName));
        Assert.Contains("2026.8.1", compact.AutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"version":"2026.8.1","status":"installed","created_at":"2026-06-06T12:00:00Z"}]""");
        var fetchedAt = Now;

        var cached = SoftwareUpdateHistoryResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, fetchedAt, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = SoftwareUpdateHistoryResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, fetchedAt, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void Mapper_collapses_loaded_empty_array_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var mapped = SoftwareUpdateHistoryResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Empty, mapped.Status);
    }

    [Fact]
    public void Mapper_maps_failure()
    {
        var mapped = SoftwareUpdateHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, mapped.Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SoftwareUpdateHistoryState.Loading, vm.State);
        Assert.False(vm.HasRows);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_rows()
    {
        using var vm = NewViewModel(Loaded(Update(1), Update(2, version: "2026.4.2", status: "installed", installedAt: "2026-05-01T09:00:00Z")));
        await vm.LoadAsync();

        Assert.Equal(SoftwareUpdateHistoryState.Loaded, vm.State);
        Assert.True(vm.HasRows);
        Assert.Equal(2, vm.Display.Rows.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SoftwareUpdateHistoryState.Empty, vm.State);
        Assert.False(vm.HasRows);
        Assert.Equal("No update history", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SoftwareUpdateHistoryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_rows()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.Cached(new[] { Update(1) }, Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SoftwareUpdateHistoryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasRows);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_rows()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.OfflineCached(
            new[] { Update(1) }, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SoftwareUpdateHistoryState.Offline, vm.State);
        Assert.True(vm.HasRows);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.Loading(),
            RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.Cached(new[] { Update(1) }, Now, stale: false),
            RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.Loaded(new[] { Update(1), Update(2, version: "2026.4.2") }, Now));
        await vm.LoadAsync();

        Assert.Equal(SoftwareUpdateHistoryState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Rows.Count);
    }

    [Fact]
    public async Task ViewModel_size_change_switches_between_feed_and_compact()
    {
        using var vm = NewViewModel(
            new SoftwareUpdateHistorySize(2, 4),
            RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.Loaded(new[] { Update(1, version: "2026.8.1", status: "installed") }, Now));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);
        Assert.NotEmpty(vm.Display.Rows);

        vm.Size = new SoftwareUpdateHistorySize(1, 4);
        Assert.True(vm.Display.IsCompact);
        Assert.NotNull(vm.Display.Compact);
        Assert.Equal("2026.8.1", vm.Display.Compact!.Version);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Update History", vm.Title);
        Assert.Equal("No update history", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state()
    {
        using var vm = NewViewModel(Loaded(Update(1)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SoftwareUpdateHistoryViewModel.State), changed);
        Assert.Contains(nameof(SoftwareUpdateHistoryViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("software-update-history", SoftwareUpdateHistoryRegistration.Id);
        Assert.Equal("vehicle", SoftwareUpdateHistoryRegistration.Category);
        Assert.Equal("SoftwareUpdateHistoryWidget", SoftwareUpdateHistoryRegistration.Slug);
        Assert.Equal(new SoftwareUpdateHistorySize(2, 4), SoftwareUpdateHistoryRegistration.DefaultSize);
        Assert.Equal(new SoftwareUpdateHistorySize(1, 4), SoftwareUpdateHistoryRegistration.MinSize);
        Assert.Equal(new SoftwareUpdateHistorySize(4, 40), SoftwareUpdateHistoryRegistration.MaxSize);
        Assert.Equal("Update History", SoftwareUpdateHistoryRegistration.Name(Localizer));
        Assert.Contains("Firmware", SoftwareUpdateHistoryRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(1, 4, true)]   // min
    [InlineData(2, 4, true)]   // default
    [InlineData(4, 40, true)]  // max
    [InlineData(0, 4, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 3, false)]  // below min rows
    [InlineData(2, 41, false)] // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, SoftwareUpdateHistoryRegistration.IsWithinBounds(new SoftwareUpdateHistorySize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new SoftwareUpdateHistorySize(1, 4), SoftwareUpdateHistoryRegistration.Clamp(new SoftwareUpdateHistorySize(0, 0)));
        Assert.Equal(new SoftwareUpdateHistorySize(4, 40), SoftwareUpdateHistoryRegistration.Clamp(new SoftwareUpdateHistorySize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SoftwareUpdateHistoryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SoftwareUpdateHistoryWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<IReadOnlyList<SoftwareUpdateSample>> Loaded(params SoftwareUpdateSample[] samples) =>
        RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.Loaded(samples, Now);

    private static SoftwareUpdateHistoryViewModel NewViewModel(params RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>[] emissions) =>
        NewViewModel(SoftwareUpdateHistorySize.Default, emissions);

    private static SoftwareUpdateHistoryViewModel NewViewModel(
        SoftwareUpdateHistorySize size,
        params RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>[] emissions) =>
        new(new FakeSource(emissions), Localizer, size, () => Now);

    private sealed class FakeSource(params RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>[] emissions) : ISoftwareUpdateHistorySource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>> StreamAsync(
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
