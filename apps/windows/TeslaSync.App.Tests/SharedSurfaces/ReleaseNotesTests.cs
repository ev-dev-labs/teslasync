using System.Runtime.CompilerServices;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the ReleaseNotes shared surface's UI-thread-free logic — the registration metadata
/// (slug, default cap, list automation id, the "Gift" glyph, and the i18n keys + fallbacks), the badge / icon /
/// change-dot mapping, the pure <see cref="ReleaseNotesProjection"/> (the newest-<c>limit</c> slice, the flat
/// author-ordered change list with NO section grouping, the first-release-expanded default, the version label and
/// Narrator names), the <see cref="ReleaseNotesViewModel"/> state holder (per-state transitions across loading /
/// loaded / empty / error / stale / offline, the single-expansion accordion state, the property-change
/// notifications, the i18n-resolved strings, and the load cap), and the PII-safe diagnostics. Mirrors the web
/// spec (web/src/components/feedback/ReleaseNotes.tsx). The WinUI view itself (shared-surfaces/ReleaseNotes.cs)
/// is exercised by the app build.
/// </summary>
public sealed class ReleaseNotesTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    private static IReadOnlyList<ChangelogEntry> Sample() => new[]
    {
        new ChangelogEntry("0.7.0", "2026-03-29", ChangelogBadge.Latest, new ChangelogChange[]
        {
            new(ChangelogChangeType.Added, "Added A"),
            new(ChangelogChangeType.Fixed, "Fixed B"),
            new(ChangelogChangeType.Added, "Added C"),
            new(ChangelogChangeType.Security, "Sec D"),
        }),
        new ChangelogEntry("0.6.0", "2026-03-28", ChangelogBadge.Stable, new ChangelogChange[]
        {
            new(ChangelogChangeType.Changed, "Changed E"),
        }),
        new ChangelogEntry("0.5.0", "2026-03-23", ChangelogBadge.Beta, new ChangelogChange[]
        {
            new(ChangelogChangeType.Removed, "Removed F"),
        }),
        new ChangelogEntry("0.4.0", "2026-03-10", ChangelogBadge.Stable, new ChangelogChange[]
        {
            new(ChangelogChangeType.Deprecated, "Deprecated G"),
        }),
    };

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_and_defaults_match_the_web_surface()
    {
        Assert.Equal("ReleaseNotes", ReleaseNotesRegistration.Slug);
        Assert.Equal(3, ReleaseNotesRegistration.DefaultLimit);
        Assert.Equal("release-notes-list", ReleaseNotesRegistration.ListAutomationId);
        Assert.Equal("\uE8C9", ReleaseNotesRegistration.GiftGlyph);
    }

    [Fact]
    public void Registration_i18n_keys_and_fallbacks_match_the_catalogue()
    {
        Assert.Equal("translation.changelog.releaseNotes.heading", ReleaseNotesRegistration.HeadingKey);
        Assert.Equal("What's New", ReleaseNotesRegistration.HeadingFallback);
        Assert.Equal("translation.changelog.badges.latest", ReleaseNotesRegistration.BadgeLatestKey);
        Assert.Equal("translation.changelog.badges.stable", ReleaseNotesRegistration.BadgeStableKey);
        Assert.Equal("translation.changelog.badges.beta", ReleaseNotesRegistration.BadgeBetaKey);
        Assert.Equal("translation.common.noData", ReleaseNotesRegistration.EmptyKey);
        Assert.Equal("translation.common.retry", ReleaseNotesRegistration.RetryKey);
        Assert.Equal("translation.common.stale", ReleaseNotesRegistration.StaleKey);
        Assert.Equal("translation.common.offline", ReleaseNotesRegistration.OfflineKey);
        Assert.Equal("translation.common.loading", ReleaseNotesRegistration.LoadingKey);
        Assert.Equal("translation.error.serverError.message", ReleaseNotesRegistration.ErrorKey);
    }

    [Fact]
    public void Registration_heading_resolves_through_i18n() =>
        Assert.Equal("What's New", ReleaseNotesRegistration.Heading(Localizer));

    [Theory]
    [InlineData(ChangelogBadge.Latest, "Latest", StatusKind.Success)]
    [InlineData(ChangelogBadge.Stable, "Stable", StatusKind.Info)]
    [InlineData(ChangelogBadge.Beta, "Beta", StatusKind.Warning)]
    public void Registration_badge_maps_label_and_status(ChangelogBadge badge, string label, StatusKind status)
    {
        Assert.Equal(label, ReleaseNotesRegistration.BadgeLabel(badge, Localizer));
        Assert.Equal(status, ReleaseNotesRegistration.BadgeStatus(badge));
    }

    [Theory]
    [InlineData(ChangelogChangeType.Added, StatusKind.Success)]
    [InlineData(ChangelogChangeType.Changed, StatusKind.Info)]
    [InlineData(ChangelogChangeType.Fixed, StatusKind.Warning)]
    [InlineData(ChangelogChangeType.Removed, StatusKind.Danger)]
    [InlineData(ChangelogChangeType.Deprecated, StatusKind.Neutral)]
    [InlineData(ChangelogChangeType.Security, StatusKind.Danger)]
    public void Registration_change_dot_maps_to_status(ChangelogChangeType type, StatusKind status) =>
        Assert.Equal(status, ReleaseNotesRegistration.ChangeDotStatus(type));

    // ── projection ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_caps_to_the_newest_limit_entries()
    {
        var display = ReleaseNotesProjection.Project(new ChangelogReading(Sample(), null), 3, Localizer);

        Assert.True(display.HasEntries);
        Assert.Equal(3, display.Entries.Count);
        Assert.Equal("0.7.0", display.Entries[0].Version);
        Assert.Equal("0.6.0", display.Entries[1].Version);
        Assert.Equal("0.5.0", display.Entries[2].Version);
        Assert.Equal("What's New", display.Heading);
    }

    [Fact]
    public void Project_limit_larger_than_count_returns_all_entries()
    {
        var display = ReleaseNotesProjection.Project(new ChangelogReading(Sample(), null), 99, Localizer);

        Assert.Equal(4, display.Entries.Count);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void Project_non_positive_limit_yields_no_entries(int limit)
    {
        var display = ReleaseNotesProjection.Project(new ChangelogReading(Sample(), null), limit, Localizer);

        Assert.False(display.HasEntries);
        Assert.Empty(display.Entries);
        Assert.Equal("What's New", display.Heading);
    }

    [Fact]
    public void Project_renders_changes_as_a_flat_author_ordered_list_not_grouped()
    {
        // Web parity: unlike the ChangelogModal, ReleaseNotes does NOT group changes into Keep-a-Changelog
        // sections — every change is rendered in author order with its own type-coloured dot.
        var entry = ReleaseNotesProjection.Project(new ChangelogReading(Sample(), null), 3, Localizer).Entries[0];

        Assert.Equal(4, entry.Changes.Count);
        Assert.Equal(new[] { "Added A", "Fixed B", "Added C", "Sec D" }, entry.Changes.Select(c => c.Text));
        Assert.Equal(
            new[] { StatusKind.Success, StatusKind.Warning, StatusKind.Success, StatusKind.Danger },
            entry.Changes.Select(c => c.DotStatus));
    }

    [Fact]
    public void Project_first_entry_is_expanded_by_default_others_are_not()
    {
        var display = ReleaseNotesProjection.Project(new ChangelogReading(Sample(), null), 3, Localizer);

        Assert.True(display.Entries[0].DefaultExpanded);
        Assert.False(display.Entries[1].DefaultExpanded);
        Assert.False(display.Entries[2].DefaultExpanded);
    }

    [Fact]
    public void Project_entry_carries_version_label_badge_and_automation_name()
    {
        var entry = ReleaseNotesProjection.Project(new ChangelogReading(Sample(), null), 3, Localizer).Entries[0];

        Assert.Equal("v0.7.0", entry.VersionLabel);
        Assert.Equal("Latest", entry.BadgeLabel);
        Assert.Equal(StatusKind.Success, entry.BadgeStatus);
        Assert.Equal("v0.7.0, Latest, 2026-03-29", entry.AutomationName);
    }

    [Fact]
    public void Project_over_the_embedded_catalogue_caps_to_the_default_limit()
    {
        // Parity with the web reading the generated CHANGELOG and slicing to the default cap.
        var display = ReleaseNotesProjection.Project(
            new ChangelogReading(ChangelogCatalog.Entries, null),
            ReleaseNotesRegistration.DefaultLimit,
            Localizer);

        Assert.Equal(3, display.Entries.Count);
        Assert.Equal(ChangelogCatalog.LatestVersion, display.Entries[0].Version);
    }

    // ── view-model state matrix ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(3, RepositoryResult<ChangelogReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(ReleaseNotesState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_capped_list()
    {
        using var vm = NewViewModel(3, Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(ReleaseNotesState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal(3, vm.Display!.Entries.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
        Assert.False(vm.IsStale);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty_without_display()
    {
        using var vm = NewViewModel(3, RepositoryResult<ChangelogReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ReleaseNotesState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Null(vm.Display);
        Assert.Equal("No data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            3,
            RepositoryResult<ChangelogReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ReleaseNotesState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.Equal("Retry", vm.RetryText);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_list()
    {
        using var vm = NewViewModel(
            3,
            RepositoryResult<ChangelogReading>.Cached(new ChangelogReading(Sample(), null), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ReleaseNotesState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
        Assert.Equal("Stale", vm.StaleText);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_cached_list()
    {
        using var vm = NewViewModel(
            3,
            RepositoryResult<ChangelogReading>.OfflineCached(
                new ChangelogReading(Sample(), null), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ReleaseNotesState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
        Assert.Equal("Offline", vm.OfflineText);
        Assert.Equal("Offline", vm.ErrorMessage);
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            3,
            RepositoryResult<ChangelogReading>.Loading(),
            RepositoryResult<ChangelogReading>.Cached(new ChangelogReading(Sample(), null), Now, stale: false),
            RepositoryResult<ChangelogReading>.Loaded(new ChangelogReading(Sample(), null), Now));
        await vm.LoadAsync();

        Assert.Equal(ReleaseNotesState.Loaded, vm.State);
        Assert.Equal(3, vm.Display!.Entries.Count);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(3, Loaded(Sample()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ReleaseNotesViewModel.State), changed);
        Assert.Contains(nameof(ReleaseNotesViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_strings_resolve_through_i18n()
    {
        using var vm = NewViewModel(3, Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal("What's New", vm.Heading);
        Assert.Equal("No data available", vm.EmptyMessage);
        Assert.Equal("Retry", vm.RetryText);
        Assert.Equal("Loading...", vm.LoadingText);
    }

    [Fact]
    public async Task ViewModel_honours_the_render_cap()
    {
        using var vm = NewViewModel(1, Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal(1, vm.Limit);
        Assert.Single(vm.Display!.Entries);
        Assert.Equal("0.7.0", vm.Display.Entries[0].Version);
    }

    // ── single-expansion accordion (web `expanded`) ───────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_expands_the_newest_release_by_default()
    {
        using var vm = NewViewModel(3, Loaded(Sample()));
        await vm.LoadAsync();

        Assert.Equal("0.7.0", vm.ExpandedVersion);
        Assert.True(vm.IsExpanded("0.7.0"));
        Assert.False(vm.IsExpanded("0.6.0"));
    }

    [Fact]
    public async Task ViewModel_toggle_collapses_the_open_release()
    {
        using var vm = NewViewModel(3, Loaded(Sample()));
        await vm.LoadAsync();

        vm.ToggleExpanded("0.7.0");

        Assert.Null(vm.ExpandedVersion);
        Assert.False(vm.IsExpanded("0.7.0"));
    }

    [Fact]
    public async Task ViewModel_toggle_moves_expansion_to_a_single_release()
    {
        using var vm = NewViewModel(3, Loaded(Sample()));
        await vm.LoadAsync();

        vm.ToggleExpanded("0.6.0");

        Assert.Equal("0.6.0", vm.ExpandedVersion);
        Assert.True(vm.IsExpanded("0.6.0"));
        Assert.False(vm.IsExpanded("0.7.0"));
    }

    [Fact]
    public async Task ViewModel_refresh_does_not_reset_the_users_expansion_choice()
    {
        // Web parity: the `expanded` useState is seeded once and survives re-renders.
        using var vm = NewViewModel(3, Loaded(Sample()));
        await vm.LoadAsync();
        vm.ToggleExpanded("0.6.0");

        await vm.LoadAsync();

        Assert.Equal("0.6.0", vm.ExpandedVersion);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_when_expansion_changes()
    {
        using var vm = NewViewModel(3, Loaded(Sample()));
        await vm.LoadAsync();
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.ToggleExpanded("0.6.0");

        Assert.Contains(nameof(ReleaseNotesViewModel.ExpandedVersion), changed);
    }

    // ── catalog-backed source (production composition) ────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_over_catalog_source_loads_the_shipped_release_history()
    {
        var source = new ChangelogSource(new InMemoryChangelogAcknowledgementStore(), clock: () => Now);
        using var vm = new ReleaseNotesViewModel(source, Localizer, ReleaseNotesRegistration.DefaultLimit);

        await vm.LoadAsync();

        Assert.Equal(ReleaseNotesState.Loaded, vm.State);
        Assert.Equal(3, vm.Display!.Entries.Count);
        Assert.Equal(ChangelogCatalog.LatestVersion, vm.Display.Entries[0].Version);
        Assert.Equal(ChangelogCatalog.LatestVersion, vm.ExpandedVersion);
    }

    // ── diagnostics (view.opened, PII-safe) ───────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_only_the_view_opened_event_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ReleaseNotesDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(
            new[] { "view.opened slug=ReleaseNotes", "view.opened slug=ReleaseNotes" },
            lines);
    }

    // ── fakes / helpers ───────────────────────────────────────────────────────────────────────────────────

    private static RepositoryResult<ChangelogReading> Loaded(IReadOnlyList<ChangelogEntry> entries) =>
        RepositoryResult<ChangelogReading>.Loaded(new ChangelogReading(entries, null), Now);

    private static ReleaseNotesViewModel NewViewModel(
        int limit,
        params RepositoryResult<ChangelogReading>[] emissions) =>
        new(new FakeChangelogSource(emissions), Localizer, limit);

    private sealed class FakeChangelogSource(params RepositoryResult<ChangelogReading>[] emissions) : IChangelogSource
    {
        public async IAsyncEnumerable<RepositoryResult<ChangelogReading>> StreamAsync(
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
