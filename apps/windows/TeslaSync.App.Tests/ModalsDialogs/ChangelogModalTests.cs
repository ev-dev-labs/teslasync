using System.Runtime.CompilerServices;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using TeslaSync.App.Tests.Fakes;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the ChangelogModal's UI-thread-free logic — the embedded catalog, the projection
/// (unseen-subset gate, first-visit vs since-last-visit subtitle, section grouping/order, badge + dot mapping,
/// Narrator names), the semver comparison, the catalog-backed source, the registration metadata, the
/// diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error /
/// stale / offline) plus the acknowledgement + auto-show gating. Mirrors the web spec
/// (web/src/components/feedback/ChangelogModal.tsx, web/src/hooks/useChangelog.ts).
/// </summary>
public sealed class ChangelogModalTests
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
        }),
        new ChangelogEntry("0.6.0", "2026-03-28", ChangelogBadge.Stable, new ChangelogChange[]
        {
            new(ChangelogChangeType.Changed, "Changed D"),
        }),
        new ChangelogEntry("0.5.0", "2026-03-23", ChangelogBadge.Beta, new ChangelogChange[]
        {
            new(ChangelogChangeType.Security, "Sec E"),
        }),
    };

    // ---- Embedded catalog (web @/generated/changelog parity) -----------------------

    [Fact]
    public void Catalog_has_six_releases_newest_first_latest_badge_on_top()
    {
        var entries = ChangelogCatalog.Entries;

        Assert.Equal(6, entries.Count);
        Assert.Equal("0.7.0", ChangelogCatalog.LatestVersion);
        Assert.Equal(ChangelogCatalog.LatestVersion, entries[0].Version);
        Assert.Equal(ChangelogBadge.Latest, entries[0].Badge);
        Assert.All(entries.Skip(1), e => Assert.NotEqual(ChangelogBadge.Latest, e.Badge));
        Assert.All(entries, e => Assert.NotEmpty(e.Changes));
        for (int i = 1; i < entries.Count; i++)
        {
            Assert.True(ChangelogModalProjection.CompareVersions(entries[i - 1].Version, entries[i].Version) > 0);
        }
    }

    // ---- Projection (the body the modal renders) -----------------------------------

    [Fact]
    public void Project_first_visit_shows_all_entries_with_welcome_subtitle()
    {
        var display = ChangelogModalProjection.Project(new ChangelogReading(Sample(), null), Localizer);

        Assert.True(display.IsFirstVisit);
        Assert.True(display.HasUnseen);
        Assert.Equal(3, display.NewCount);
        Assert.Equal(3, display.VisibleEntries.Count);
        Assert.Equal(
            "Welcome! Here's a quick tour of what TeslaSync ships with right now.",
            display.Subtitle);
    }

    [Fact]
    public void Project_since_last_visit_shows_unseen_subset_with_count_subtitle()
    {
        var display = ChangelogModalProjection.Project(new ChangelogReading(Sample(), "0.5.0"), Localizer);

        Assert.False(display.IsFirstVisit);
        Assert.True(display.HasUnseen);
        Assert.Equal(2, display.NewCount);
        Assert.Equal(2, display.VisibleEntries.Count);
        Assert.Equal("0.7.0", display.VisibleEntries[0].Version);
        Assert.Equal("0.6.0", display.VisibleEntries[1].Version);
        Assert.Equal("2 new release(s) since your last visit.", display.Subtitle);
    }

    [Fact]
    public void Project_all_seen_falls_back_to_all_entries_without_unseen()
    {
        var display = ChangelogModalProjection.Project(new ChangelogReading(Sample(), "0.7.0"), Localizer);

        Assert.False(display.HasUnseen);
        Assert.Equal(0, display.NewCount);
        Assert.Equal(3, display.VisibleEntries.Count); // web visibleEntries fallback to all
        // Web parity: the since-last-visit count is visibleEntries.length, which here is the fall-back
        // to all 3 entries (newEntries is empty), so the subtitle reads "3" even though none are unseen.
        Assert.Equal("3 new release(s) since your last visit.", display.Subtitle);
    }

    [Fact]
    public void Project_first_two_entries_default_expanded()
    {
        var display = ChangelogModalProjection.Project(new ChangelogReading(Sample(), null), Localizer);

        Assert.True(display.VisibleEntries[0].DefaultExpanded);
        Assert.True(display.VisibleEntries[1].DefaultExpanded);
        Assert.False(display.VisibleEntries[2].DefaultExpanded);
    }

    [Fact]
    public void Project_groups_changes_by_type_in_section_order_dropping_empty()
    {
        var entry = ChangelogModalProjection.Project(new ChangelogReading(Sample(), null), Localizer)
            .VisibleEntries[0];

        Assert.Equal(2, entry.Sections.Count); // Added + Fixed only (no Changed/Removed/Deprecated/Security)
        Assert.Equal(ChangelogChangeType.Added, entry.Sections[0].Type);
        Assert.Equal(ChangelogChangeType.Fixed, entry.Sections[1].Type);
        Assert.Equal(new[] { "Added A", "Added C" }, entry.Sections[0].Items);
        Assert.Equal(new[] { "Fixed B" }, entry.Sections[1].Items);
    }

    [Theory]
    [InlineData(ChangelogBadge.Latest, "Latest", StatusKind.Success)]
    [InlineData(ChangelogBadge.Stable, "Stable", StatusKind.Info)]
    [InlineData(ChangelogBadge.Beta, "Beta", StatusKind.Warning)]
    public void Project_badge_maps_label_and_status(ChangelogBadge badge, string label, StatusKind status)
    {
        Assert.Equal(label, ChangelogModalProjection.BadgeLabel(badge, Localizer));
        Assert.Equal(status, ChangelogModalProjection.BadgeStatus(badge));
    }

    [Theory]
    [InlineData(ChangelogChangeType.Added, "Added", StatusKind.Success)]
    [InlineData(ChangelogChangeType.Changed, "Changed", StatusKind.Info)]
    [InlineData(ChangelogChangeType.Fixed, "Fixed", StatusKind.Warning)]
    [InlineData(ChangelogChangeType.Removed, "Removed", StatusKind.Danger)]
    [InlineData(ChangelogChangeType.Deprecated, "Deprecated", StatusKind.Neutral)]
    [InlineData(ChangelogChangeType.Security, "Security", StatusKind.Danger)]
    public void Project_section_maps_label_and_dot(ChangelogChangeType type, string label, StatusKind dot)
    {
        Assert.Equal(label, ChangelogModalProjection.SectionLabel(type, Localizer));
        Assert.Equal(dot, ChangelogModalProjection.SectionDotStatus(type));
    }

    // ---- Accessibility labels ------------------------------------------------------

    [Fact]
    public void Project_entry_automation_name_carries_version_badge_and_date()
    {
        var entry = ChangelogModalProjection.Project(new ChangelogReading(Sample(), null), Localizer)
            .VisibleEntries[0];

        Assert.Equal("v0.7.0, Latest, 2026-03-29", entry.AutomationName);
        Assert.Equal("v0.7.0", entry.VersionLabel);
    }

    [Fact]
    public void Project_modal_automation_name_carries_title_and_subtitle()
    {
        var display = ChangelogModalProjection.Project(new ChangelogReading(Sample(), null), Localizer);

        Assert.Contains("What's new in TeslaSync", display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.Subtitle, display.AutomationName, StringComparison.Ordinal);
    }

    // ---- Semver comparison (web compareVersions) -----------------------------------

    [Theory]
    [InlineData("0.7.0", "0.6.0", 1)]
    [InlineData("0.6.0", "0.7.0", -1)]
    [InlineData("0.7.0", "0.7.0", 0)]
    [InlineData("1.0.0", "1.0.0-beta.1", 1)]   // release sorts after its pre-release
    [InlineData("1.0.0-beta.1", "1.0.0", -1)]
    [InlineData("1.2.3", "1.2.10", -1)]        // numeric, not lexicographic
    [InlineData("2.0.0", "1.9.9", 1)]
    public void CompareVersions_matches_web(string a, string b, int expected) =>
        Assert.Equal(expected, ChangelogModalProjection.CompareVersions(a, b));

    [Fact]
    public void CompareVersions_malformed_falls_back_to_ordinal_without_throwing()
    {
        Assert.Equal(0, ChangelogModalProjection.CompareVersions("nightly", "nightly"));
        Assert.NotEqual(0, ChangelogModalProjection.CompareVersions("nightly", "0.7.0"));
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(new InMemoryChangelogAcknowledgementStore(), RepositoryResult<ChangelogReading>.Loading());
        await vm.LoadAsync();

        Assert.Equal(ChangelogModalState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_body_display()
    {
        using var vm = NewViewModel(new InMemoryChangelogAcknowledgementStore(), Loaded(new ChangelogReading(Sample(), null)));
        await vm.LoadAsync();

        Assert.Equal(ChangelogModalState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.Display);
        Assert.Equal(3, vm.Display!.VisibleEntries.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty_without_display()
    {
        using var vm = NewViewModel(new InMemoryChangelogAcknowledgementStore(), RepositoryResult<ChangelogReading>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(ChangelogModalState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Null(vm.Display);
        Assert.Equal("No data available", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            new InMemoryChangelogAcknowledgementStore(),
            RepositoryResult<ChangelogReading>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(ChangelogModalState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.Equal("Retry", vm.RetryText);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_display()
    {
        using var vm = NewViewModel(
            new InMemoryChangelogAcknowledgementStore(),
            RepositoryResult<ChangelogReading>.Cached(new ChangelogReading(Sample(), null), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(ChangelogModalState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_display()
    {
        using var vm = NewViewModel(
            new InMemoryChangelogAcknowledgementStore(),
            RepositoryResult<ChangelogReading>.OfflineCached(
                new ChangelogReading(Sample(), null), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(ChangelogModalState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError);
        Assert.Equal("Offline", vm.OfflineText);
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            new InMemoryChangelogAcknowledgementStore(),
            RepositoryResult<ChangelogReading>.Loading(),
            RepositoryResult<ChangelogReading>.Cached(new ChangelogReading(Sample(), "0.6.0"), Now, stale: false),
            RepositoryResult<ChangelogReading>.Loaded(new ChangelogReading(Sample(), null), Now));
        await vm.LoadAsync();

        Assert.Equal(ChangelogModalState.Loaded, vm.State);
        Assert.Equal(3, vm.Display!.VisibleEntries.Count);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(new InMemoryChangelogAcknowledgementStore(), Loaded(new ChangelogReading(Sample(), null)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ChangelogModalViewModel.State), changed);
        Assert.Contains(nameof(ChangelogModalViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_strings_resolve_through_i18n()
    {
        using var vm = NewViewModel(new InMemoryChangelogAcknowledgementStore(), Loaded(new ChangelogReading(Sample(), null)));
        await vm.LoadAsync();

        Assert.Equal("What's new in TeslaSync", vm.Title);
        Assert.Equal("Got it", vm.GotItText);
        Assert.Equal("View full changelog", vm.ViewFullText);
    }

    // ---- Acknowledgement + auto-show gating (web useChangelog) ----------------------

    [Fact]
    public async Task MarkSeen_stamps_seen_version_and_throttle_and_clears_unseen()
    {
        var store = new InMemoryChangelogAcknowledgementStore();
        var clock = new TestClock(Now);
        using var vm = new ChangelogModalViewModel(
            new FakeChangelogSource(Loaded(new ChangelogReading(Sample(), null))), store, Localizer, clock.Func);
        await vm.LoadAsync();

        Assert.True(vm.HasUnseen);

        vm.MarkSeen();

        Assert.True(vm.Acknowledged);
        Assert.Equal("0.7.0", store.GetSeenVersion());
        Assert.Equal(1, store.SeenWrites);
        Assert.Equal(1, store.ShownWrites);
        Assert.Equal(Now, store.GetLastShownAt());
        Assert.False(vm.HasUnseen);
    }

    [Fact]
    public async Task StampShown_stamps_throttle_without_marking_seen()
    {
        var store = new InMemoryChangelogAcknowledgementStore();
        var clock = new TestClock(Now);
        using var vm = new ChangelogModalViewModel(
            new FakeChangelogSource(Loaded(new ChangelogReading(Sample(), null))), store, Localizer, clock.Func);
        await vm.LoadAsync();

        vm.StampShown();

        Assert.False(vm.Acknowledged);
        Assert.Null(store.GetSeenVersion());
        Assert.Equal(0, store.SeenWrites);
        Assert.Equal(1, store.ShownWrites);
    }

    [Fact]
    public async Task ShouldAutoShow_respects_unseen_throttle_and_onboarding()
    {
        var store = new InMemoryChangelogAcknowledgementStore(onboarded: true);
        var clock = new TestClock(Now);
        using var vm = new ChangelogModalViewModel(
            new FakeChangelogSource(Loaded(new ChangelogReading(Sample(), null))), store, Localizer, clock.Func);
        await vm.LoadAsync();

        // Unseen + onboarded + never shown -> eligible.
        Assert.True(vm.ShouldAutoShow);

        // Stamp now -> within the 24h throttle, no longer eligible.
        vm.StampShown();
        Assert.False(vm.CanAutoShow);
        Assert.False(vm.ShouldAutoShow);

        // Past the throttle window -> eligible again.
        clock.Advance(TimeSpan.FromHours(25));
        Assert.True(vm.CanAutoShow);
        Assert.True(vm.ShouldAutoShow);
    }

    [Fact]
    public async Task ShouldAutoShow_false_until_onboarding_complete()
    {
        var store = new InMemoryChangelogAcknowledgementStore(onboarded: false);
        using var vm = new ChangelogModalViewModel(
            new FakeChangelogSource(Loaded(new ChangelogReading(Sample(), null))), store, Localizer, () => Now);
        await vm.LoadAsync();

        Assert.True(vm.HasUnseen);
        Assert.True(vm.CanAutoShow);
        Assert.False(vm.HasCompletedOnboarding);
        Assert.False(vm.ShouldAutoShow);
    }

    // ---- Registration metadata (web parity) ----------------------------------------

    [Fact]
    public void Registration_matches_web()
    {
        Assert.Equal("ChangelogModal", ChangelogModalRegistration.Slug);
        Assert.Equal("https://github.com/ev-dev-labs/teslasync/releases", ChangelogModalRegistration.ReleasesUrl);
        Assert.Equal(TimeSpan.FromHours(24), ChangelogModalRegistration.AutoShowThrottle);
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ChangelogModalDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChangelogModal", Assert.Single(lines));
    }

    // ---- Source (catalog-backed adapter) -------------------------------------------

    [Fact]
    public async Task Source_emits_loading_then_loaded_catalog_reading()
    {
        var store = new InMemoryChangelogAcknowledgementStore(seenVersion: "0.6.0");
        var source = new ChangelogSource(store, clock: () => Now);

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Loading, results[0].Status);
        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Equal("0.6.0", terminal.Value!.SeenVersion);
        Assert.Equal(ChangelogCatalog.Entries.Count, terminal.Value.Entries.Count);
        Assert.Equal("0.7.0", terminal.Value.LatestVersion);
        Assert.Equal(Now, terminal.FetchedAt);
    }

    [Fact]
    public async Task Source_empty_catalog_collapses_to_empty()
    {
        var source = new ChangelogSource(
            new InMemoryChangelogAcknowledgementStore(), Array.Empty<ChangelogEntry>(), () => Now);

        var terminal = (await Drain(source))[^1];

        Assert.Equal(LoadStatus.Empty, terminal.Status);
        Assert.Null(terminal.Value);
    }

    [Fact]
    public async Task Source_reads_seen_version_live_from_store()
    {
        var store = new InMemoryChangelogAcknowledgementStore();
        var source = new ChangelogSource(store, Sample(), () => Now);

        var first = (await Drain(source))[^1];
        Assert.Null(first.Value!.SeenVersion);

        store.SetSeenVersion("0.6.0");
        var second = (await Drain(source))[^1];
        Assert.Equal("0.6.0", second.Value!.SeenVersion);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static RepositoryResult<ChangelogReading> Loaded(ChangelogReading reading) =>
        RepositoryResult<ChangelogReading>.Loaded(reading, Now);

    private static ChangelogModalViewModel NewViewModel(
        IChangelogAcknowledgementStore store,
        params RepositoryResult<ChangelogReading>[] emissions) =>
        new(new FakeChangelogSource(emissions), store, Localizer, () => Now);

    private static async Task<List<RepositoryResult<ChangelogReading>>> Drain(IChangelogSource source)
    {
        var list = new List<RepositoryResult<ChangelogReading>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

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
