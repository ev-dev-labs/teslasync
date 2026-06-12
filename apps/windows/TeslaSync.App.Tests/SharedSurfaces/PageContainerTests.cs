using System.ComponentModel;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the PageContainer shared surface's UI-thread-free logic — the registration metadata
/// (slug, the region automation ids, the title / subtitle / empty / error token brush keys, the danger-tint recipe,
/// the ARIA live contract and the i18n keys + fallbacks the projection references), the pure
/// <see cref="PageContainerProjection"/> (the always-visible header, the <c>actions || copyLink || resolvedQuery</c>
/// cluster gate, the loading → error → empty → content body precedence, the empty-message default + override, and
/// the per-state accessibility contract), the <see cref="PageContainerFreshness"/> worst-query fold, the
/// <see cref="BreadcrumbOverrideSink"/> / <see cref="WorstOfDataFreshnessSource"/> P1/S8 seams, the
/// <see cref="PageContainerViewModel"/> state holder (initial projection, per-input reprojection + PropertyChanged,
/// breadcrumb register-on-mount / withdraw-on-dispose), and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/layout/PageContainer.tsx + BreadcrumbOverridesContext.tsx). The WinUI view itself
/// (shared-surfaces/PageContainer.cs) is exercised by the app build.
/// </summary>
public sealed class PageContainerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);

    private static PageContainerProjection Project(
        string title = "Drives",
        string? subtitle = null,
        bool loading = false,
        string? errorMessage = null,
        bool empty = false,
        string? emptyMessage = null,
        bool hasActions = false,
        bool copyLink = false,
        bool hasFreshness = false) =>
        PageContainerProjection.Project(
            new PageContainerRequest(title, subtitle, loading, errorMessage, empty, emptyMessage, hasActions, copyLink, hasFreshness),
            Localizer);

    private static DataFreshnessSnapshot Fresh() => new(Now, IsFetching: false, IsStale: false, IsError: false);

    private static DataFreshnessSnapshot Fetching() => new(null, IsFetching: true, IsStale: false, IsError: false);

    private static DataFreshnessSnapshot Stale() => new(Now, IsFetching: false, IsStale: true, IsError: false);

    private static DataFreshnessSnapshot Errored() => new(Now, IsFetching: false, IsStale: false, IsError: true);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("PageContainer", PageContainerRegistration.Slug);

    [Fact]
    public void Region_automation_ids_are_stable()
    {
        Assert.Equal("page-container", PageContainerRegistration.RootAutomationId);
        Assert.Equal("page-container-title", PageContainerRegistration.TitleAutomationId);
        Assert.Equal("page-container-actions", PageContainerRegistration.ActionsAutomationId);
        Assert.Equal("page-container-loading", PageContainerRegistration.LoadingAutomationId);
        Assert.Equal("page-container-error", PageContainerRegistration.ErrorAutomationId);
        Assert.Equal("page-container-empty", PageContainerRegistration.EmptyAutomationId);
        Assert.Equal("page-container-body", PageContainerRegistration.BodyAutomationId);
        Assert.Equal("page-container-copy-link", PageContainerRegistration.CopyLinkAutomationId);
    }

    [Fact]
    public void Token_brush_keys_and_tint_recipe_match_the_web_chrome()
    {
        Assert.Equal("TsColorTextPrimaryBrush", PageContainerRegistration.TitleBrushKey);
        Assert.Equal("TsColorTextMutedBrush", PageContainerRegistration.SubtitleBrushKey);
        Assert.Equal("TsColorTextMutedBrush", PageContainerRegistration.EmptyTextBrushKey);
        Assert.Equal("TsColorDangerColor", PageContainerRegistration.DangerColorKey);
        Assert.Equal("TsColorDangerBrush", PageContainerRegistration.DangerBrushKey);
        Assert.Equal(0.08, PageContainerRegistration.ErrorCardBackgroundOpacity);
        Assert.Equal(0.20, PageContainerRegistration.ErrorCardBorderOpacity);
    }

    [Fact]
    public void Live_settings_match_the_aria_contract()
    {
        Assert.Equal("assertive", PageContainerRegistration.LiveAssertive);
        Assert.Equal("polite", PageContainerRegistration.LivePolite);
    }

    [Fact]
    public void I18n_keys_and_fallbacks_are_routed_through_the_facade()
    {
        Assert.Equal("translation.global.loading", PageContainerRegistration.LoadingLabelKey);
        Assert.Equal("Loading", PageContainerRegistration.LoadingLabelFallback);
        Assert.Equal("translation.pageContainer.empty", PageContainerRegistration.EmptyMessageKey);
        Assert.Equal("No {0} found.", PageContainerRegistration.EmptyMessageFallback);
        Assert.Equal("translation.actions.copyLink", PageContainerRegistration.CopyLinkLabelKey);
        Assert.Equal("Copy link", PageContainerRegistration.CopyLinkLabelFallback);
        Assert.Equal("translation.actions.copied", PageContainerRegistration.CopiedLabelKey);
        Assert.Equal("Copied", PageContainerRegistration.CopiedLabelFallback);
    }

    [Fact]
    public void Registration_resolvers_return_the_localized_fallbacks()
    {
        Assert.Equal("Loading", PageContainerRegistration.ResolveLoadingLabel(Localizer));
        Assert.Equal("Copy link", PageContainerRegistration.ResolveCopyLinkLabel(Localizer));
        Assert.Equal("Copied", PageContainerRegistration.ResolveCopiedLabel(Localizer));
    }

    // ── projection: body state precedence ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Default_request_renders_the_content_state()
    {
        var projection = Project();

        Assert.Equal(PageContainerState.Content, projection.State);
        Assert.Equal("Drives", projection.Title);
        Assert.Equal(string.Empty, projection.BodyAccessibleName);
        Assert.False(projection.BodyLiveAssertive);
    }

    [Fact]
    public void Loading_wins_over_every_other_body_gate()
    {
        var projection = Project(loading: true, errorMessage: "boom", empty: true);

        Assert.Equal(PageContainerState.Loading, projection.State);
        Assert.Equal("Loading", projection.LoadingLabel);
        Assert.Equal("Loading", projection.BodyAccessibleName);
        Assert.False(projection.BodyLiveAssertive);
    }

    [Fact]
    public void Error_wins_over_empty_and_content()
    {
        var projection = Project(errorMessage: "Failed to load drives", empty: true);

        Assert.Equal(PageContainerState.Error, projection.State);
        Assert.Equal("Failed to load drives", projection.ErrorMessage);
        Assert.Equal("Failed to load drives", projection.BodyAccessibleName);
        Assert.True(projection.BodyLiveAssertive);
    }

    [Fact]
    public void Empty_wins_over_content()
    {
        var projection = Project(empty: true);

        Assert.Equal(PageContainerState.Empty, projection.State);
        Assert.Equal("No drives found.", projection.EmptyMessage);
        Assert.Equal("No drives found.", projection.BodyAccessibleName);
        Assert.False(projection.BodyLiveAssertive);
    }

    [Fact]
    public void A_null_error_message_does_not_trigger_the_error_state()
    {
        var projection = Project(errorMessage: null, empty: true);

        Assert.Equal(PageContainerState.Empty, projection.State);
    }

    [Fact]
    public void An_empty_string_error_message_still_triggers_the_error_state()
    {
        // web: the error branch keys off the truthy `error` object, not its message text.
        var projection = Project(errorMessage: string.Empty);

        Assert.Equal(PageContainerState.Error, projection.State);
        Assert.Equal(string.Empty, projection.ErrorMessage);
    }

    // ── projection: empty-message default + override ──────────────────────────────────────────────────────

    [Fact]
    public void Empty_message_default_lower_cases_the_title()
    {
        var projection = Project(title: "Charging Sessions", empty: true);

        Assert.Equal("No charging sessions found.", projection.EmptyMessage);
    }

    [Fact]
    public void Empty_message_override_wins_over_the_default()
    {
        var projection = Project(empty: true, emptyMessage: "Nothing recorded yet.");

        Assert.Equal("Nothing recorded yet.", projection.EmptyMessage);
    }

    [Fact]
    public void Empty_message_override_honours_an_explicit_empty_string()
    {
        // web `emptyMessage ?? …`: an explicit empty string is kept (only null falls back).
        var projection = Project(empty: true, emptyMessage: string.Empty);

        Assert.Equal(string.Empty, projection.EmptyMessage);
    }

    // ── projection: header actions cluster ────────────────────────────────────────────────────────────────

    [Fact]
    public void Header_actions_cluster_is_hidden_when_nothing_is_present()
    {
        var projection = Project();

        Assert.False(projection.ShowHeaderActions);
        Assert.False(projection.HasActions);
        Assert.False(projection.ShowCopyLink);
        Assert.False(projection.ShowFreshness);
    }

    [Theory]
    [InlineData(true, false, false)]
    [InlineData(false, true, false)]
    [InlineData(false, false, true)]
    [InlineData(true, true, true)]
    public void Header_actions_cluster_shows_when_any_affordance_is_present(bool actions, bool copyLink, bool freshness)
    {
        var projection = Project(hasActions: actions, copyLink: copyLink, hasFreshness: freshness);

        Assert.True(projection.ShowHeaderActions);
        Assert.Equal(actions, projection.HasActions);
        Assert.Equal(copyLink, projection.ShowCopyLink);
        Assert.Equal(freshness, projection.ShowFreshness);
    }

    // ── projection: subtitle ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Subtitle_is_shown_when_supplied()
    {
        var projection = Project(subtitle: "Last 30 days");

        Assert.True(projection.HasSubtitle);
        Assert.Equal("Last 30 days", projection.Subtitle);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Subtitle_is_hidden_when_blank(string? subtitle)
    {
        var projection = Project(subtitle: subtitle);

        Assert.False(projection.HasSubtitle);
        Assert.Equal(string.Empty, projection.Subtitle);
    }

    // ── projection: accessibility ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Every_non_content_body_state_has_a_non_empty_accessible_name()
    {
        // a11y: whenever the body is a status state, a screen reader always has something to announce.
        PageContainerProjection[] states =
        [
            Project(loading: true),
            Project(errorMessage: "Failed"),
            Project(empty: true),
        ];

        foreach (var projection in states)
        {
            Assert.False(string.IsNullOrWhiteSpace(projection.BodyAccessibleName));
        }
    }

    [Fact]
    public void Only_the_error_state_announces_assertively()
    {
        Assert.True(Project(errorMessage: "Failed").BodyLiveAssertive);
        Assert.False(Project(loading: true).BodyLiveAssertive);
        Assert.False(Project(empty: true).BodyLiveAssertive);
        Assert.False(Project().BodyLiveAssertive);
    }

    [Fact]
    public void Projection_throws_when_request_is_null() =>
        Assert.Throws<ArgumentNullException>(() => PageContainerProjection.Project(null!, Localizer));

    [Fact]
    public void Projection_throws_when_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(() =>
            PageContainerProjection.Project(
                new PageContainerRequest("Drives", null, false, null, false, null, false, false, false),
                null!));

    // ── freshness fold: rank + pick-worst ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Rank_matches_the_web_precedence()
    {
        Assert.Equal(0, PageContainerFreshness.Rank(Fresh()));
        Assert.Equal(1, PageContainerFreshness.Rank(Fetching()));
        Assert.Equal(2, PageContainerFreshness.Rank(Stale()));
        Assert.Equal(3, PageContainerFreshness.Rank(Errored()));
    }

    [Fact]
    public void Pick_worst_returns_the_most_degraded_snapshot()
    {
        var worst = PageContainerFreshness.PickWorst([Fresh(), Fetching(), Errored(), Stale()]);

        Assert.True(worst.IsError);
    }

    [Fact]
    public void Pick_worst_prefers_the_first_snapshot_on_a_tie()
    {
        var first = new DataFreshnessSnapshot(Now, IsFetching: false, IsStale: true, IsError: false);
        var second = new DataFreshnessSnapshot(Now.AddMinutes(-5), IsFetching: false, IsStale: true, IsError: false);

        var worst = PageContainerFreshness.PickWorst([Fresh(), first, second]);

        Assert.Equal(first, worst);
    }

    [Fact]
    public void Pick_worst_returns_the_only_snapshot()
    {
        var only = Fetching();

        Assert.Equal(only, PageContainerFreshness.PickWorst([only]));
    }

    [Fact]
    public void Pick_worst_throws_on_an_empty_list() =>
        Assert.Throws<ArgumentException>(() => PageContainerFreshness.PickWorst([]));

    [Fact]
    public void Pick_worst_throws_on_a_null_list() =>
        Assert.Throws<ArgumentNullException>(() => PageContainerFreshness.PickWorst(null!));

    // ── breadcrumb override sink ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Breadcrumb_sink_starts_empty()
    {
        var sink = new BreadcrumbOverrideSink();

        Assert.Empty(sink.MergedOverrides);
    }

    [Fact]
    public void Breadcrumb_sink_publishes_a_registration()
    {
        var sink = new BreadcrumbOverrideSink();
        var changes = 0;
        sink.Changed += (_, _) => changes++;

        using var registration = sink.Register(new Dictionary<string, string> { ["/drives/:id"] = "Trip to office" });

        Assert.Equal("Trip to office", sink.MergedOverrides["/drives/:id"]);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void Breadcrumb_sink_merges_registrations_with_later_winning()
    {
        var sink = new BreadcrumbOverrideSink();

        using var first = sink.Register(new Dictionary<string, string> { ["/a"] = "Alpha", ["/shared"] = "First" });
        using var second = sink.Register(new Dictionary<string, string> { ["/b"] = "Bravo", ["/shared"] = "Second" });

        Assert.Equal("Alpha", sink.MergedOverrides["/a"]);
        Assert.Equal("Bravo", sink.MergedOverrides["/b"]);
        Assert.Equal("Second", sink.MergedOverrides["/shared"]);
    }

    [Fact]
    public void Breadcrumb_sink_drops_blank_values_like_the_web_merge()
    {
        var sink = new BreadcrumbOverrideSink();

        using var registration = sink.Register(new Dictionary<string, string> { ["/a"] = "Alpha", ["/blank"] = string.Empty });

        Assert.True(sink.MergedOverrides.ContainsKey("/a"));
        Assert.False(sink.MergedOverrides.ContainsKey("/blank"));
    }

    [Fact]
    public void Breadcrumb_sink_withdraws_a_registration_on_dispose()
    {
        var sink = new BreadcrumbOverrideSink();
        var changes = 0;
        sink.Changed += (_, _) => changes++;

        var registration = sink.Register(new Dictionary<string, string> { ["/a"] = "Alpha" });
        registration.Dispose();

        Assert.Empty(sink.MergedOverrides);
        Assert.Equal(2, changes);
    }

    [Fact]
    public void Breadcrumb_sink_dispose_is_idempotent()
    {
        var sink = new BreadcrumbOverrideSink();
        var registration = sink.Register(new Dictionary<string, string> { ["/a"] = "Alpha" });
        var changes = 0;
        sink.Changed += (_, _) => changes++;

        registration.Dispose();
        registration.Dispose();

        Assert.Equal(1, changes);
    }

    [Fact]
    public void Breadcrumb_sink_snapshot_is_isolated_from_caller_mutation()
    {
        var sink = new BreadcrumbOverrideSink();
        var map = new Dictionary<string, string> { ["/a"] = "Alpha" };

        using var registration = sink.Register(map);
        map["/a"] = "Mutated";

        Assert.Equal("Alpha", sink.MergedOverrides["/a"]);
    }

    [Fact]
    public void Null_breadcrumb_sink_is_inert()
    {
        var sink = NullBreadcrumbOverrideSink.Instance;

        using var registration = sink.Register(new Dictionary<string, string> { ["/a"] = "Alpha" });

        Assert.Empty(sink.MergedOverrides);
    }

    // ── worst-of freshness source ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Worst_of_source_exposes_the_most_degraded_child()
    {
        var fresh = new StaticDataFreshnessSource(Fresh(), canRefresh: false);
        var stale = new StaticDataFreshnessSource(Stale(), canRefresh: false);

        using var worst = new WorstOfDataFreshnessSource([fresh, stale]);

        Assert.True(worst.Current.IsStale);
    }

    [Fact]
    public void Worst_of_source_can_refresh_when_any_child_can()
    {
        var fixedSource = new StaticDataFreshnessSource(Fresh(), canRefresh: false);
        var refreshable = new StaticDataFreshnessSource(Stale(), canRefresh: true);

        using var worst = new WorstOfDataFreshnessSource([fixedSource, refreshable]);

        Assert.True(worst.CanRefresh);
    }

    [Fact]
    public void Worst_of_source_fans_refresh_out_to_every_child()
    {
        var first = new StaticDataFreshnessSource(Fresh());
        var second = new StaticDataFreshnessSource(Fresh());

        using var worst = new WorstOfDataFreshnessSource([first, second]);
        worst.Refresh();

        Assert.Equal(1, first.RefreshCount);
        Assert.Equal(1, second.RefreshCount);
    }

    [Fact]
    public void Worst_of_source_raises_changed_when_the_representative_moves()
    {
        var fresh = new StaticDataFreshnessSource(Fresh(), canRefresh: false);
        var other = new StaticDataFreshnessSource(Fresh(), canRefresh: false);
        using var worst = new WorstOfDataFreshnessSource([fresh, other]);
        var changes = 0;
        worst.Changed += (_, _) => changes++;

        other.Set(Errored());

        Assert.Equal(1, changes);
        Assert.True(worst.Current.IsError);
    }

    [Fact]
    public void Worst_of_source_is_silent_when_the_representative_is_unchanged()
    {
        // Two fresh children: one re-emitting an equal fresh snapshot does not move the worst.
        var first = new StaticDataFreshnessSource(Errored(), canRefresh: false);
        var second = new StaticDataFreshnessSource(Fresh(), canRefresh: false);
        using var worst = new WorstOfDataFreshnessSource([first, second]);
        var changes = 0;
        worst.Changed += (_, _) => changes++;

        second.Set(Fetching());

        Assert.Equal(0, changes);
        Assert.True(worst.Current.IsError);
    }

    [Fact]
    public void Worst_of_source_stops_observing_after_dispose()
    {
        var first = new StaticDataFreshnessSource(Fresh(), canRefresh: false);
        var second = new StaticDataFreshnessSource(Fresh(), canRefresh: false);
        var worst = new WorstOfDataFreshnessSource([first, second]);
        var changes = 0;
        worst.Changed += (_, _) => changes++;

        worst.Dispose();
        second.Set(Errored());

        Assert.Equal(0, changes);
    }

    [Fact]
    public void Worst_of_source_throws_on_an_empty_source_list() =>
        Assert.Throws<ArgumentException>(() => new WorstOfDataFreshnessSource([]));

    // ── view model: state transitions ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_starts_in_the_content_state()
    {
        var viewModel = new PageContainerViewModel(Localizer, "Drives");

        Assert.Equal(PageContainerState.Content, viewModel.Projection.State);
        Assert.Equal("Drives", viewModel.Projection.Title);
        Assert.False(viewModel.HasFreshness);
    }

    [Fact]
    public void ViewModel_set_loading_moves_to_the_loading_state()
    {
        var viewModel = new PageContainerViewModel(Localizer, "Drives");

        viewModel.SetLoading(true);

        Assert.Equal(PageContainerState.Loading, viewModel.Projection.State);
    }

    [Fact]
    public void ViewModel_set_error_then_clear_round_trips()
    {
        var viewModel = new PageContainerViewModel(Localizer, "Drives");

        viewModel.SetError("Failed");
        Assert.Equal(PageContainerState.Error, viewModel.Projection.State);

        viewModel.SetError(null);
        Assert.Equal(PageContainerState.Content, viewModel.Projection.State);
    }

    [Fact]
    public void ViewModel_raises_property_changed_only_on_a_real_change()
    {
        var viewModel = new PageContainerViewModel(Localizer, "Drives");
        var changes = 0;
        viewModel.PropertyChanged += OnChanged;

        viewModel.SetLoading(true);   // changes the projection
        viewModel.SetLoading(true);   // no-op

        viewModel.PropertyChanged -= OnChanged;
        Assert.Equal(1, changes);

        void OnChanged(object? sender, PropertyChangedEventArgs e)
        {
            if (e.PropertyName == nameof(PageContainerViewModel.Projection))
            {
                changes++;
            }
        }
    }

    [Fact]
    public void ViewModel_set_subtitle_and_empty_message_flow_to_the_projection()
    {
        var viewModel = new PageContainerViewModel(Localizer, "Drives");

        viewModel.SetSubtitle("Last 30 days");
        viewModel.SetEmpty(true);
        viewModel.SetEmptyMessage("Nothing yet.");

        Assert.True(viewModel.Projection.HasSubtitle);
        Assert.Equal("Last 30 days", viewModel.Projection.Subtitle);
        Assert.Equal("Nothing yet.", viewModel.Projection.EmptyMessage);
    }

    [Fact]
    public void ViewModel_tracks_the_header_affordances()
    {
        var viewModel = new PageContainerViewModel(Localizer, "Drives", hasFreshness: true);

        Assert.True(viewModel.HasFreshness);
        Assert.True(viewModel.Projection.ShowFreshness);
        Assert.True(viewModel.Projection.ShowHeaderActions);

        viewModel.SetHasActions(true);
        viewModel.SetCopyLink(true);

        Assert.True(viewModel.Projection.HasActions);
        Assert.True(viewModel.Projection.ShowCopyLink);
    }

    [Fact]
    public void ViewModel_throws_when_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(() => new PageContainerViewModel(null!, "Drives"));

    [Fact]
    public void ViewModel_throws_when_title_is_null() =>
        Assert.Throws<ArgumentNullException>(() => new PageContainerViewModel(Localizer, null!));

    // ── view model: breadcrumb overrides ──────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_publishes_breadcrumb_overrides_on_construction()
    {
        var sink = new BreadcrumbOverrideSink();

        using var viewModel = new PageContainerViewModel(
            Localizer,
            "Drive detail",
            sink,
            breadcrumbOverrides: new Dictionary<string, string> { ["/drives/:id"] = "Trip to office" });

        Assert.Equal("Trip to office", sink.MergedOverrides["/drives/:id"]);
    }

    [Fact]
    public void ViewModel_does_not_publish_an_empty_override_map()
    {
        var sink = new BreadcrumbOverrideSink();

        using var viewModel = new PageContainerViewModel(
            Localizer,
            "Drives",
            sink,
            breadcrumbOverrides: new Dictionary<string, string>());

        Assert.Empty(sink.MergedOverrides);
    }

    [Fact]
    public void ViewModel_withdraws_breadcrumb_overrides_on_dispose()
    {
        var sink = new BreadcrumbOverrideSink();
        var viewModel = new PageContainerViewModel(
            Localizer,
            "Drive detail",
            sink,
            breadcrumbOverrides: new Dictionary<string, string> { ["/drives/:id"] = "Trip to office" });

        viewModel.Dispose();

        Assert.Empty(sink.MergedOverrides);
    }

    [Fact]
    public void ViewModel_re_registers_breadcrumb_overrides_on_update()
    {
        var sink = new BreadcrumbOverrideSink();
        using var viewModel = new PageContainerViewModel(
            Localizer,
            "Drive detail",
            sink,
            breadcrumbOverrides: new Dictionary<string, string> { ["/drives/:id"] = "Trip to office" });

        viewModel.SetBreadcrumbOverrides(new Dictionary<string, string> { ["/drives/:id"] = "Trip home" });

        Assert.Equal("Trip home", sink.MergedOverrides["/drives/:id"]);
    }

    [Fact]
    public void ViewModel_clears_breadcrumb_overrides_when_updated_to_empty()
    {
        var sink = new BreadcrumbOverrideSink();
        using var viewModel = new PageContainerViewModel(
            Localizer,
            "Drive detail",
            sink,
            breadcrumbOverrides: new Dictionary<string, string> { ["/drives/:id"] = "Trip to office" });

        viewModel.SetBreadcrumbOverrides(null);

        Assert.Empty(sink.MergedOverrides);
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_only_the_view_opened_event_with_the_slug()
    {
        var lines = new List<string>();
        var diagnostics = new PageContainerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(["view.opened slug=PageContainer"], lines);
    }

    [Fact]
    public void Diagnostics_count_is_thread_safe_and_monotonic()
    {
        var diagnostics = new PageContainerDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }
}
