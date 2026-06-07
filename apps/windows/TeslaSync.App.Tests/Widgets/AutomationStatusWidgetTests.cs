using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.DashboardWidgets;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the AutomationStatusWidget's UI-thread-free logic — the JSON parse adapter,
/// the status→badge map, the relative-time formatter, the projection (compact active/total hero, the
/// active/failing/auto-disabled counts + summary chips, the per-row badges/times/accessibility names),
/// the optimistic-flip snapshot mutation, the cache-then-network result mapper, the footprint flags, the
/// registry metadata, the diagnostics, and the state-holder view-model's per-state transitions
/// (loading / loaded / empty / error / stale / offline) and the optimistic toggle (commit + revert).
/// Mirrors the web spec (web/src/features/dashboard/widgets/AutomationStatusWidget.tsx).
/// </summary>
public sealed class AutomationStatusWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);

    private static Automation Auto(
        long id = 1,
        string name = "Automation",
        bool enabled = true,
        bool autoDisabled = false,
        int consecutiveFailures = 0,
        string? lastSuccessAt = "2026-06-06T11:00:00Z",
        string? lastTriggeredAt = "2026-06-06T12:00:00Z",
        string? nextFireTime = null) =>
        new(id, name, enabled, autoDisabled, consecutiveFailures, lastSuccessAt, lastTriggeredAt, nextFireTime);

    private static AutomationStatusSnapshot Snapshot(params Automation[] items) => new(items);

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void FromJson_reads_snake_case_array()
    {
        const string json = """
        [
          {"id":7,"name":"Morning Charge","enabled":true,"auto_disabled":false,
           "consecutive_failures":0,"last_success_at":"2026-06-06T11:00:00Z",
           "last_triggered_at":"2026-06-06T12:00:00Z","next_fire_time":"2026-06-07T07:00:00Z"}
        ]
        """;
        using var doc = JsonDocument.Parse(json);

        var snapshot = AutomationStatusSnapshot.FromJson(doc.RootElement);

        Assert.True(snapshot.HasData);
        var a = Assert.Single(snapshot.Items);
        Assert.Equal(7, a.Id);
        Assert.Equal("Morning Charge", a.Name);
        Assert.True(a.Enabled);
        Assert.False(a.AutoDisabled);
        Assert.Equal(0, a.ConsecutiveFailures);
        Assert.NotNull(a.LastSuccessAt);
        Assert.NotNull(a.LastTriggeredAtTime);
        Assert.NotNull(a.NextFireTimeValue);
    }

    [Fact]
    public void FromJson_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"id":2}]""");

        var a = Assert.Single(AutomationStatusSnapshot.FromJson(doc.RootElement).Items);
        Assert.Equal(2, a.Id);
        Assert.Equal(string.Empty, a.Name);
        Assert.False(a.Enabled);
        Assert.False(a.AutoDisabled);
        Assert.Equal(0, a.ConsecutiveFailures);
        Assert.Null(a.LastSuccessAt);
        Assert.Null(a.LastTriggeredAtTime);
        Assert.Null(a.NextFireTimeValue);
    }

    [Fact]
    public void FromJson_non_array_is_empty_without_data()
    {
        using var doc = JsonDocument.Parse("""{"error":"nope"}""");
        var snapshot = AutomationStatusSnapshot.FromJson(doc.RootElement);
        Assert.False(snapshot.HasData);
        Assert.Empty(snapshot.Items);
    }

    [Fact]
    public void FromJson_empty_array_has_data_but_no_items()
    {
        using var doc = JsonDocument.Parse("[]");
        var snapshot = AutomationStatusSnapshot.FromJson(doc.RootElement);
        Assert.True(snapshot.HasData);
        Assert.Empty(snapshot.Items);
    }

    [Fact]
    public void WithEnabled_flips_only_the_matching_automation()
    {
        var snapshot = Snapshot(Auto(id: 1, enabled: true), Auto(id: 2, enabled: true));

        var flipped = snapshot.WithEnabled(1, false);

        Assert.False(flipped.Items[0].Enabled);
        Assert.True(flipped.Items[1].Enabled);
        // Original snapshot is untouched (immutability).
        Assert.True(snapshot.Items[0].Enabled);
    }

    [Fact]
    public void WithEnabled_is_a_no_op_when_already_in_state()
    {
        var snapshot = Snapshot(Auto(id: 1, enabled: true));
        Assert.Same(snapshot, snapshot.WithEnabled(1, true));
        Assert.Same(snapshot, snapshot.WithEnabled(99, false));
    }

    // ---- Status badge (web getStatusBadge precedence) ------------------------------

    [Fact]
    public void Badge_auto_disabled_beats_everything()
    {
        var (variant, label) = AutomationStatusBadge.Resolve(
            Auto(autoDisabled: true, enabled: false, consecutiveFailures: 5), Localizer);
        Assert.Equal(StatusKind.Danger, variant);
        Assert.Equal("Auto-disabled", label);
    }

    [Fact]
    public void Badge_disabled_when_not_enabled()
    {
        var (variant, label) = AutomationStatusBadge.Resolve(Auto(enabled: false), Localizer);
        Assert.Equal(StatusKind.Neutral, variant);
        Assert.Equal("Disabled", label);
    }

    [Fact]
    public void Badge_failing_when_consecutive_failures()
    {
        var (variant, label) = AutomationStatusBadge.Resolve(Auto(consecutiveFailures: 2), Localizer);
        Assert.Equal(StatusKind.Warning, variant);
        Assert.Equal("Failing", label);
    }

    [Fact]
    public void Badge_ok_when_last_success()
    {
        var (variant, label) = AutomationStatusBadge.Resolve(
            Auto(consecutiveFailures: 0, lastSuccessAt: "2026-06-06T11:00:00Z"), Localizer);
        Assert.Equal(StatusKind.Success, variant);
        Assert.Equal("OK", label);
    }

    [Fact]
    public void Badge_idle_when_no_success_yet()
    {
        var (variant, label) = AutomationStatusBadge.Resolve(
            Auto(consecutiveFailures: 0, lastSuccessAt: null), Localizer);
        Assert.Equal(StatusKind.Neutral, variant);
        Assert.Equal("Idle", label);
    }

    // ---- Relative time (web formatRelativeTime) ------------------------------------

    [Theory]
    [InlineData(null, "\u2014")]
    [InlineData("2026-06-06T12:05:00Z", "Just now")]
    [InlineData("2026-06-06T12:00:00Z", "5m ago")]
    [InlineData("2026-06-06T10:05:00Z", "2h ago")]
    [InlineData("2026-06-04T12:05:00Z", "2d ago")]
    [InlineData("2026-06-06T12:15:00Z", "Just now")] // future → web quirk (negative diff < 1)
    public void FormatRelativeTime_matches_web_tiers(string? raw, string expected)
    {
        DateTimeOffset? value = raw is null
            ? null
            : DateTimeOffset.Parse(raw, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.RoundtripKind);

        Assert.Equal(expected, AutomationStatusProjection.FormatRelativeTime(value, Localizer, Now));
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_counts_and_summary_match_web()
    {
        var display = Project(Snapshot(
            Auto(id: 1, enabled: true, consecutiveFailures: 0, lastSuccessAt: "2026-06-06T11:00:00Z"),
            Auto(id: 2, enabled: true, consecutiveFailures: 3, lastSuccessAt: null),
            Auto(id: 3, enabled: false),
            Auto(id: 4, enabled: true, autoDisabled: true, consecutiveFailures: 0)));

        Assert.Equal(3, display.EnabledCount);  // 1, 2, 4 are enabled
        Assert.Equal(4, display.TotalCount);
        Assert.Equal(1, display.FailingCount);  // only 2 (cf>0 && enabled)
        Assert.Equal(1, display.AutoDisabledCount); // only 4
        Assert.Equal("3/4", display.CompactValueText);
        Assert.Equal("3 Active", display.ActiveSummaryText);
        Assert.Equal("1 Failing", display.FailingSummaryText);
        Assert.Equal("1 Auto-disabled", display.AutoDisabledSummaryText);
        Assert.True(display.HasFailing);
        Assert.True(display.HasAutoDisabled);
        Assert.True(display.HasItems);
    }

    [Fact]
    public void Project_rows_carry_badge_and_times()
    {
        var display = Project(Snapshot(
            Auto(id: 1, name: "Morning Charge", lastTriggeredAt: "2026-06-06T12:00:00Z", nextFireTime: "2026-06-07T07:00:00Z")));

        var row = Assert.Single(display.Items);
        Assert.Equal("Morning Charge", row.Name);
        Assert.Equal(StatusKind.Success, row.StatusVariant);
        Assert.Equal("OK", row.StatusLabel);
        Assert.True(row.HasLastRun);
        Assert.Equal("5m ago", row.LastRunRelative);
        Assert.True(row.HasNextFire);
    }

    [Fact]
    public void Project_row_without_times_collapses_meta()
    {
        var display = Project(Snapshot(Auto(id: 1, lastTriggeredAt: null, nextFireTime: null)));
        var row = Assert.Single(display.Items);
        Assert.False(row.HasLastRun);
        Assert.False(row.HasNextFire);
        Assert.Equal(string.Empty, row.LastRunRelative);
        Assert.Equal(string.Empty, row.NextFireRelative);
    }

    [Fact]
    public void Project_produces_accessibility_names()
    {
        var display = Project(Snapshot(
            Auto(id: 1, name: "Morning Charge", lastTriggeredAt: "2026-06-06T12:00:00Z")));

        var row = Assert.Single(display.Items);
        Assert.Contains("Morning Charge", row.RowName, StringComparison.Ordinal);
        Assert.Contains("OK", row.RowName, StringComparison.Ordinal);
        Assert.Equal("Toggle Morning Charge", row.ToggleLabel);
    }

    [Fact]
    public void Project_empty_snapshot_has_no_items()
    {
        var display = Project(AutomationStatusSnapshot.Empty);
        Assert.False(display.HasItems);
        Assert.Equal("0/0", display.CompactValueText);
        Assert.False(display.HasFailing);
        Assert.False(display.HasAutoDisabled);
    }

    [Theory]
    [InlineData(1, 4, true, false, false)]   // single column → compact, no header
    [InlineData(2, 1, true, false, true)]    // single row → compact, header shown
    [InlineData(2, 4, false, false, true)]   // default → full, header
    [InlineData(3, 6, false, true, true)]    // wide → toggles
    public void Project_footprint_flags(int cols, int rows, bool compact, bool wide, bool header)
    {
        var display = AutomationStatusProjection.Project(
            Snapshot(Auto(id: 1)), new AutomationStatusSize(cols, rows), Localizer, Now);
        Assert.Equal(compact, display.IsCompact);
        Assert.Equal(wide, display.IsWide);
        Assert.Equal(header, display.ShowHeader);
    }

    // ---- Result mapper (cache-then-network preservation) ---------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"name":"A","enabled":true}]""");

        var cached = AutomationStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!.Items);

        var offline = AutomationStatusResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Equal("A", offline.Value!.Items[0].Name);
    }

    [Fact]
    public void Mapper_maps_loaded_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("[]");

        Assert.Equal(LoadStatus.Loaded, AutomationStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, AutomationStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, AutomationStatusResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<AutomationStatusSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(AutomationStatusState.Loading, vm.State);
        Assert.False(vm.HasItems);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_rows()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Auto(id: 1), Auto(id: 2))));
        await vm.LoadAsync();

        Assert.Equal(AutomationStatusState.Loaded, vm.State);
        Assert.True(vm.HasItems);
        Assert.Equal(2, vm.Display.Items.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<AutomationStatusSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(AutomationStatusState.Empty, vm.State);
        Assert.False(vm.HasItems);
        Assert.Equal("No automations configured", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_loaded_without_rows_is_empty()
    {
        using var vm = NewViewModel(Loaded(Snapshot()));
        await vm.LoadAsync();

        Assert.Equal(AutomationStatusState.Empty, vm.State);
        Assert.False(vm.HasItems);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<AutomationStatusSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(AutomationStatusState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_rows()
    {
        using var vm = NewViewModel(
            RepositoryResult<AutomationStatusSnapshot>.Cached(Snapshot(Auto(id: 1)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(AutomationStatusState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasItems);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_rows()
    {
        using var vm = NewViewModel(RepositoryResult<AutomationStatusSnapshot>.OfflineCached(
            Snapshot(Auto(id: 1)), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(AutomationStatusState.Offline, vm.State);
        Assert.True(vm.HasItems);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<AutomationStatusSnapshot>.Loading(),
            RepositoryResult<AutomationStatusSnapshot>.Cached(Snapshot(Auto(id: 1)), Now, stale: false),
            RepositoryResult<AutomationStatusSnapshot>.Loaded(Snapshot(Auto(id: 1), Auto(id: 2)), Now));
        await vm.LoadAsync();

        Assert.Equal(AutomationStatusState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Items.Count);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new AutomationStatusSize(2, 4), Loaded(Snapshot(Auto(id: 1))));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new AutomationStatusSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(AutomationStatusState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<AutomationStatusSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Automation Status", vm.Title);
        Assert.Equal("No automations configured", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Auto(id: 1))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(AutomationStatusViewModel.State), changed);
        Assert.Contains(nameof(AutomationStatusViewModel.Display), changed);
    }

    // ---- Optimistic toggle (web useToggleAutomation) -------------------------------

    [Fact]
    public async Task ViewModel_toggle_commits_optimistically_on_success()
    {
        var toggle = new FakeAutomationToggle(result: true);
        using var vm = NewViewModel(toggle, Loaded(Snapshot(
            Auto(id: 1, enabled: true), Auto(id: 2, enabled: true))));
        await vm.LoadAsync();
        Assert.Equal(2, vm.Display.EnabledCount);

        await vm.ToggleAsync(1, enabled: false);

        Assert.Equal(1, vm.Display.EnabledCount);
        Assert.False(vm.Display.Items[0].Enabled);
        Assert.Equal("Disabled", vm.Display.Items[0].StatusLabel);
        Assert.Null(vm.ToggleErrorMessage);
        Assert.Equal((1L, false), Assert.Single(toggle.Calls));
        Assert.Equal(AutomationStatusState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_toggle_reverts_on_failure()
    {
        var toggle = new FakeAutomationToggle(result: false);
        using var vm = NewViewModel(toggle, Loaded(Snapshot(
            Auto(id: 1, enabled: true), Auto(id: 2, enabled: true))));
        await vm.LoadAsync();

        await vm.ToggleAsync(1, enabled: false);

        // Reverted back to the pre-toggle state.
        Assert.Equal(2, vm.Display.EnabledCount);
        Assert.True(vm.Display.Items[0].Enabled);
        Assert.Equal("Failed to toggle automation", vm.ToggleErrorMessage);
    }

    [Fact]
    public async Task ViewModel_toggle_is_noop_without_command()
    {
        using var vm = NewViewModel(Loaded(Snapshot(Auto(id: 1, enabled: true))));
        await vm.LoadAsync();

        await vm.ToggleAsync(1, enabled: false);

        Assert.Equal(1, vm.Display.EnabledCount);
        Assert.True(vm.Display.Items[0].Enabled);
        Assert.Null(vm.ToggleErrorMessage);
    }

    [Fact]
    public async Task ViewModel_load_clears_prior_toggle_error()
    {
        var toggle = new FakeAutomationToggle(result: false);
        using var vm = NewViewModel(toggle, Loaded(Snapshot(Auto(id: 1, enabled: true))));
        await vm.LoadAsync();
        await vm.ToggleAsync(1, enabled: false);
        Assert.NotNull(vm.ToggleErrorMessage);

        await vm.RetryAsync();

        Assert.Null(vm.ToggleErrorMessage);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("automation-status", AutomationStatusRegistration.Id);
        Assert.Equal("automations", AutomationStatusRegistration.Category);
        Assert.Equal("AutomationStatusWidget", AutomationStatusRegistration.Slug);
        Assert.Equal(new AutomationStatusSize(2, 4), AutomationStatusRegistration.DefaultSize);
        Assert.Equal(new AutomationStatusSize(1, 2), AutomationStatusRegistration.MinSize);
        Assert.Equal(new AutomationStatusSize(4, 40), AutomationStatusRegistration.MaxSize);
        Assert.Equal("Automation Status", AutomationStatusRegistration.Name(Localizer));
        Assert.Contains("next scheduled", AutomationStatusRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(1, 2, true)]   // min
    [InlineData(4, 40, true)]  // max
    [InlineData(0, 4, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    [InlineData(2, 1, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, AutomationStatusRegistration.IsWithinBounds(new AutomationStatusSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new AutomationStatusSize(1, 2), AutomationStatusRegistration.Clamp(new AutomationStatusSize(0, 0)));
        Assert.Equal(new AutomationStatusSize(4, 40), AutomationStatusRegistration.Clamp(new AutomationStatusSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AutomationStatusDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AutomationStatusWidget", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static AutomationStatusDisplay Project(AutomationStatusSnapshot snapshot) =>
        AutomationStatusProjection.Project(snapshot, AutomationStatusSize.Default, Localizer, Now);

    private static RepositoryResult<AutomationStatusSnapshot> Loaded(AutomationStatusSnapshot snapshot) =>
        RepositoryResult<AutomationStatusSnapshot>.Loaded(snapshot, Now);

    private static AutomationStatusViewModel NewViewModel(params RepositoryResult<AutomationStatusSnapshot>[] emissions) =>
        NewViewModel(AutomationStatusSize.Default, emissions);

    private static AutomationStatusViewModel NewViewModel(
        AutomationStatusSize size,
        params RepositoryResult<AutomationStatusSnapshot>[] emissions) =>
        new(new FakeAutomationStatusSource(emissions), Localizer, size, toggle: null, () => Now);

    private static AutomationStatusViewModel NewViewModel(
        IAutomationToggle toggle,
        params RepositoryResult<AutomationStatusSnapshot>[] emissions) =>
        new(new FakeAutomationStatusSource(emissions), Localizer, AutomationStatusSize.Default, toggle, () => Now);

    private sealed class FakeAutomationStatusSource(params RepositoryResult<AutomationStatusSnapshot>[] emissions)
        : IAutomationStatusSource
    {
        public async IAsyncEnumerable<RepositoryResult<AutomationStatusSnapshot>> StreamAsync(
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

    private sealed class FakeAutomationToggle(bool result) : IAutomationToggle
    {
        public List<(long Id, bool Enabled)> Calls { get; } = new();

        public Task<bool> ToggleAsync(long id, bool enabled, CancellationToken cancellationToken = default)
        {
            Calls.Add((id, enabled));
            return Task.FromResult(result);
        }
    }
}
