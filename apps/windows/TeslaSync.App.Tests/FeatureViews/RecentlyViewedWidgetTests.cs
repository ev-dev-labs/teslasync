using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the RecentlyViewedWidget's UI-thread-free logic — the path → kind classifier
/// (web <c>classifyPath</c>), the observable source adapter over the Core recorder, the projection
/// (rows, glyph map, relative-time formatting, responsive columns, a11y names), the state-holder view-model's
/// ready / empty transitions and live updates, the i18n key + fallback contract, and the PII-safe
/// diagnostics. Mirrors the web spec
/// (web/src/features/dashboard/components/RecentlyViewedWidget.tsx + web/src/lib/recentPages.ts). The WinUI
/// view itself (RecentlyViewedWidget.cs) is exercised by the app build.
/// </summary>
public sealed class RecentlyViewedWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    private static RecentlyViewedSource NewSource() => new(new RecentPages(50));

    private static RecentlyViewedViewModel NewViewModel(
        IRecentlyViewedSource source,
        ILocalizer? localizer = null,
        int limit = RecentlyViewedRegistration.DisplayLimit) =>
        new(source, localizer ?? Localizer, limit, () => Now);

    // ── Path → kind classification (web classifyPath parity) ────────────────────────────────────────────

    [Theory]
    [InlineData("vehicles/1", RecentlyViewedKind.Vehicle)]
    [InlineData("drives/42", RecentlyViewedKind.Drive)]
    [InlineData("charging/7", RecentlyViewedKind.Charging)]
    [InlineData("trips/3", RecentlyViewedKind.Trip)]
    [InlineData("geofences/9", RecentlyViewedKind.Geofence)]
    [InlineData("year-review/2024", RecentlyViewedKind.YearReview)]
    public void Classify_maps_prefixed_paths_to_their_kind(string path, RecentlyViewedKind expected) =>
        Assert.Equal(expected, RecentlyViewedSource.ClassifyKind(path));

    [Theory]
    [InlineData("vehicles")]      // bare list page — no sub-segment, web falls through to 'page'
    [InlineData("drives")]
    [InlineData("charging")]
    [InlineData("system")]        // unknown prefix
    [InlineData("")]
    [InlineData("/")]
    public void Classify_falls_back_to_page_without_a_sub_segment(string path) =>
        Assert.Equal(RecentlyViewedKind.Page, RecentlyViewedSource.ClassifyKind(path));

    [Fact]
    public void Classify_tolerates_a_leading_slash()
    {
        Assert.Equal(RecentlyViewedKind.Vehicle, RecentlyViewedSource.ClassifyKind("/vehicles/1"));
        Assert.Equal(RecentlyViewedKind.Drive, RecentlyViewedSource.ClassifyKind("/drives/42"));
    }

    // ── Source adapter: ordering, cap, dedup, title fallback, Changed signal ─────────────────────────────

    [Fact]
    public void Source_returns_recorded_entries_newest_first()
    {
        var source = NewSource();
        source.Record("/vehicles/1", "Model 3");
        source.Record("/drives/42", "Drive 42");
        source.Record("/charging/7", "Charge 7");

        var entries = source.GetEntries(5);

        Assert.Equal(new[] { "charging/7", "drives/42", "vehicles/1" }, entries.Select(e => e.Path).ToArray());
        Assert.Equal("Charge 7", entries[0].Title);
        Assert.Equal(RecentlyViewedKind.Charging, entries[0].Kind);
    }

    [Fact]
    public void Source_caps_entries_at_the_requested_limit()
    {
        var source = NewSource();
        for (int i = 0; i < 12; i++)
        {
            source.Record($"/vehicles/{i}", $"Vehicle {i}");
        }

        Assert.Equal(5, source.GetEntries(5).Count);
    }

    [Fact]
    public void Source_revisiting_a_path_moves_it_to_the_front_without_duplicating()
    {
        var source = NewSource();
        source.Record("/drives/1", "Drive 1");
        source.Record("/drives/2", "Drive 2");
        source.Record("/drives/1", "Drive 1 again");

        var entries = source.GetEntries(5);

        Assert.Equal(2, entries.Count);
        Assert.Equal("drives/1", entries[0].Path);
        Assert.Equal("Drive 1 again", entries[0].Title);
    }

    [Fact]
    public void Source_blank_title_falls_back_to_the_path()
    {
        var source = NewSource();
        source.Record("/drives/55", "   ");

        Assert.Equal("drives/55", Assert.Single(source.GetEntries(5)).Title);
    }

    [Fact]
    public void Source_record_and_clear_raise_changed()
    {
        var source = NewSource();
        int changes = 0;
        source.Changed += (_, _) => changes++;

        source.Record("/drives/1", "Drive 1");
        source.Clear();

        Assert.Equal(2, changes);
        Assert.Empty(source.GetEntries(5));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-3)]
    public void Source_non_positive_limit_yields_no_entries(int limit)
    {
        var source = NewSource();
        source.Record("/drives/1", "Drive 1");

        Assert.Empty(source.GetEntries(limit));
    }

    // ── Projection: glyph map, relative-time, ordering, cap, a11y name ───────────────────────────────────

    [Theory]
    [InlineData(RecentlyViewedKind.Vehicle, "\uE804")]
    [InlineData(RecentlyViewedKind.Drive, "\uE7C0")]
    [InlineData(RecentlyViewedKind.Charging, "\uE945")]
    [InlineData(RecentlyViewedKind.Trip, "\uE81E")]
    [InlineData(RecentlyViewedKind.Geofence, "\uE909")]
    [InlineData(RecentlyViewedKind.YearReview, "\uE787")]
    [InlineData(RecentlyViewedKind.Page, "\uE7C3")]
    public void Glyph_map_covers_every_kind(RecentlyViewedKind kind, string glyph) =>
        Assert.Equal(glyph, RecentlyViewedProjection.GlyphFor(kind));

    [Fact]
    public void Unknown_kind_uses_the_generic_page_glyph()
    {
        var source = NewSource();
        source.Record("/system", "System");

        var display = RecentlyViewedProjection.Project(source.GetEntries(5), 5, Now, Localizer);

        Assert.Equal(RecentlyViewedProjection.GlyphFor(RecentlyViewedKind.Page), Assert.Single(display.Rows).Glyph);
    }

    [Fact]
    public void FormatRelative_under_a_minute_is_just_now() =>
        Assert.Equal("Just now", RecentlyViewedProjection.FormatRelative(Now.AddSeconds(-30), Now, Localizer));

    [Fact]
    public void FormatRelative_clamps_a_future_timestamp_to_just_now() =>
        Assert.Equal("Just now", RecentlyViewedProjection.FormatRelative(Now.AddMinutes(5), Now, Localizer));

    [Theory]
    [InlineData(5, "5m")]
    [InlineData(59, "59m")]
    public void FormatRelative_minutes(int minutes, string expected) =>
        Assert.Equal(expected, RecentlyViewedProjection.FormatRelative(Now.AddMinutes(-minutes), Now, Localizer));

    [Theory]
    [InlineData(1, "1h")]
    [InlineData(23, "23h")]
    public void FormatRelative_hours(int hours, string expected) =>
        Assert.Equal(expected, RecentlyViewedProjection.FormatRelative(Now.AddHours(-hours), Now, Localizer));

    [Theory]
    [InlineData(1, "1d")]
    [InlineData(9, "9d")]
    public void FormatRelative_days(int days, string expected) =>
        Assert.Equal(expected, RecentlyViewedProjection.FormatRelative(Now.AddDays(-days), Now, Localizer));

    [Fact]
    public void Project_preserves_order_and_caps_at_the_limit()
    {
        var source = NewSource();
        for (int i = 0; i < 12; i++)
        {
            source.Record($"/vehicles/{i}", $"Vehicle {i}");
        }

        var display = RecentlyViewedProjection.Project(source.GetEntries(5), 5, Now, Localizer);

        Assert.Equal(5, display.Rows.Count);
        Assert.True(display.HasRows);
        // Newest push (Vehicle 11) is first.
        Assert.Equal("Vehicle 11", display.Rows[0].Title);
    }

    [Fact]
    public void Project_empty_source_yields_no_rows()
    {
        var display = RecentlyViewedProjection.Project(Array.Empty<RecentlyViewedEntry>(), 5, Now, Localizer);

        Assert.Empty(display.Rows);
        Assert.False(display.HasRows);
    }

    [Fact]
    public void Project_row_carries_its_navigation_path()
    {
        var source = NewSource();
        source.Record("/drives/55", "Drive 55");

        var row = Assert.Single(RecentlyViewedProjection.Project(source.GetEntries(5), 5, Now, Localizer).Rows);

        Assert.Equal("drives/55", row.Path);
    }

    [Fact]
    public void Project_automation_name_joins_title_and_relative_time()
    {
        var source = NewSource();
        source.Record("/drives/42", "Drive 42", Now.AddMinutes(-5));

        var row = Assert.Single(RecentlyViewedProjection.Project(source.GetEntries(5), 5, Now, Localizer).Rows);

        Assert.Equal("Drive 42", row.Title);
        Assert.Equal("5m", row.RelativeText);
        Assert.Equal("Drive 42, 5m", row.AutomationName);
        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
    }

    // ── Responsive columns (web grid-cols-1 sm:grid-cols-2 lg:grid-cols-3) ───────────────────────────────

    [Theory]
    [InlineData(320, 1)]
    [InlineData(639, 1)]
    [InlineData(640, 2)]
    [InlineData(900, 2)]
    [InlineData(1023, 2)]
    [InlineData(1024, 3)]
    [InlineData(1600, 3)]
    public void ColumnsForWidth_is_responsive(double width, int expected) =>
        Assert.Equal(expected, RecentlyViewedProjection.ColumnsForWidth(width));

    [Fact]
    public void ColumnsForWidth_treats_unmeasured_width_as_a_single_column() =>
        Assert.Equal(1, RecentlyViewedProjection.ColumnsForWidth(double.NaN));

    // ── View-model: ready / empty + live updates ────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_starts_empty_when_nothing_is_recorded()
    {
        using var vm = NewViewModel(NewSource());

        Assert.Equal(RecentlyViewedState.Empty, vm.State);
        Assert.False(vm.HasRows);
        Assert.Empty(vm.Display.Rows);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public void ViewModel_is_ready_with_recorded_pages_newest_first()
    {
        var source = NewSource();
        source.Record("/vehicles/1", "Model 3");
        source.Record("/drives/42", "Drive 42");

        using var vm = NewViewModel(source);

        Assert.Equal(RecentlyViewedState.Ready, vm.State);
        Assert.True(vm.HasRows);
        Assert.Equal("Drive 42", vm.Display.Rows[0].Title);
    }

    [Fact]
    public void ViewModel_updates_live_when_a_page_is_recorded_after_construction()
    {
        var source = NewSource();
        using var vm = NewViewModel(source);
        Assert.Equal(RecentlyViewedState.Empty, vm.State);

        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        source.Record("/drives/99", "Late Drive");

        Assert.Equal(RecentlyViewedState.Ready, vm.State);
        Assert.Equal("Late Drive", vm.Display.Rows[0].Title);
        Assert.Contains(nameof(RecentlyViewedViewModel.State), raised);
        Assert.Contains(nameof(RecentlyViewedViewModel.Display), raised);
    }

    [Fact]
    public void ViewModel_caps_rows_at_the_configured_limit()
    {
        var source = NewSource();
        for (int i = 0; i < 12; i++)
        {
            source.Record($"/vehicles/{i}", $"Vehicle {i}");
        }

        using var vm = NewViewModel(source);

        Assert.Equal(5, vm.Display.Rows.Count);
    }

    [Fact]
    public void ViewModel_clearing_the_store_returns_to_empty()
    {
        var source = NewSource();
        source.Record("/drives/1", "Drive 1");
        using var vm = NewViewModel(source);
        Assert.Equal(RecentlyViewedState.Ready, vm.State);

        source.Clear();

        Assert.Equal(RecentlyViewedState.Empty, vm.State);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_source()
    {
        var source = NewSource();
        var vm = NewViewModel(source);
        vm.Dispose();

        source.Record("/drives/1", "Drive 1");

        // After dispose the surface no longer reacts to store changes.
        Assert.Equal(RecentlyViewedState.Empty, vm.State);
        Assert.Empty(vm.Display.Rows);
    }

    // ── i18n: every web key + fallback flows through the facade ──────────────────────────────────────────

    [Fact]
    public void Title_and_empty_message_resolve_through_the_localizer()
    {
        var prefix = new PrefixLocalizer();
        using var vm = NewViewModel(NewSource(), prefix);

        Assert.Equal("L:recentPages.widgetTitle", vm.Title);
        Assert.Equal("L:recentPages.empty", vm.EmptyMessage);
    }

    [Fact]
    public void Every_web_i18n_key_and_fallback_is_requested_from_the_catalog()
    {
        var recording = new RecordingLocalizer();
        using var vm = NewViewModel(NewSource(), recording);

        // Title + empty hint.
        _ = vm.Title;
        _ = vm.EmptyMessage;
        // Exercise each relative-time branch so its key is requested.
        RecentlyViewedProjection.FormatRelative(Now.AddSeconds(-10), Now, recording); // justNow
        RecentlyViewedProjection.FormatRelative(Now.AddMinutes(-5), Now, recording);   // shortMinute
        RecentlyViewedProjection.FormatRelative(Now.AddHours(-2), Now, recording);     // shortHour
        RecentlyViewedProjection.FormatRelative(Now.AddDays(-3), Now, recording);      // shortDay

        Assert.Equal("Recently Viewed", recording.Fallback("recentPages.widgetTitle"));
        Assert.Equal("Pages you visit will appear here for quick access.", recording.Fallback("recentPages.empty"));
        Assert.Equal("Just now", recording.Fallback("recentPages.justNow"));
        Assert.Equal("m", recording.Fallback("recentPages.shortMinute"));
        Assert.Equal("h", recording.Fallback("recentPages.shortHour"));
        Assert.Equal("d", recording.Fallback("recentPages.shortDay"));
    }

    // ── Diagnostics (view.opened, PII-safe) ─────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new RecentlyViewedDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RecentlyViewedWidget", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_leak_user_data_in_the_slug() =>
        Assert.Equal("RecentlyViewedWidget", RecentlyViewedRegistration.Slug);

    // ── Test doubles ────────────────────────────────────────────────────────────────────────────────────

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly Dictionary<string, string> _calls = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            _calls[key] = fallback;
            return fallback;
        }

        public string Fallback(string key) => _calls.TryGetValue(key, out var f) ? f : null!;
    }
}
