using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the DataFreshness shared surface's UI-thread-free logic — the registration metadata
/// (slug, automation id, the twelve i18n keys the source references, the ARIA role/live contract, the per-state
/// token brush keys and Segoe Fluent glyphs), the <see cref="DataFreshnessSnapshot.FromRepositoryResult{T}"/>
/// adapter (every cache-then-network state, the offline-cached case and the <c>forceStaleAfterMs</c> override),
/// the pure <see cref="DataFreshnessProjection"/> (status precedence, relative-time tiers, title / aria-label /
/// role, and the reduced-motion-gated spin / ping / pulse flags), the <see cref="DataFreshnessViewModel"/> state
/// holder (initial projection, snapshot + motion reprojection, refresh gating, relative-time tick, subscription
/// cleanup), the <see cref="StaticDataFreshnessSource"/> / <see cref="RepositoryDataFreshnessSource{T}"/> seams,
/// and the PII-safe diagnostics. Mirrors the web spec (web/src/components/data-display/DataFreshness.tsx). The
/// WinUI view itself (shared-surfaces/DataFreshness.cs) is exercised by the app build.
/// </summary>
public sealed class DataFreshnessTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static string FormatTime(DateTimeOffset ts) => "TIME";

    private static DataFreshnessSnapshot Snap(
        DateTimeOffset? updatedAt = null,
        bool fetching = false,
        bool stale = false,
        bool error = false) => new(updatedAt, fetching, stale, error);

    private static DataFreshnessProjection Project(
        DataFreshnessSnapshot snapshot,
        bool compact = false,
        bool canRefresh = false,
        bool reduceMotion = false,
        ILocalizer? localizer = null) =>
        DataFreshnessProjection.Project(snapshot, compact, canRefresh, reduceMotion, Now, localizer ?? Localizer, FormatTime);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("DataFreshness", DataFreshnessRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_stable() =>
        Assert.Equal("data-freshness", DataFreshnessRegistration.RootAutomationId);

    [Fact]
    public void Aria_roles_and_live_setting_match_the_web_container()
    {
        // web: role={onRefresh ? 'button' : 'status'} aria-live="polite".
        Assert.Equal("button", DataFreshnessRegistration.ButtonRole);
        Assert.Equal("status", DataFreshnessRegistration.StatusRole);
        Assert.Equal("polite", DataFreshnessRegistration.LiveSetting);
    }

    [Theory]
    [InlineData(DataFreshnessStatus.Fresh, "TsColorSuccessBrush")]
    [InlineData(DataFreshnessStatus.Fetching, "TsColorInfoBrush")]
    [InlineData(DataFreshnessStatus.Stale, "TsColorWarningBrush")]
    [InlineData(DataFreshnessStatus.Error, "TsColorDangerBrush")]
    public void AccentBrushKey_maps_each_state_to_its_token_brush(DataFreshnessStatus status, string expected) =>
        Assert.Equal(expected, DataFreshnessRegistration.AccentBrushKey(status));

    [Theory]
    [InlineData(DataFreshnessStatus.Fresh, "\uE701")]
    [InlineData(DataFreshnessStatus.Stale, "\uE701")]
    [InlineData(DataFreshnessStatus.Fetching, "\uE72C")]
    [InlineData(DataFreshnessStatus.Error, "\uEB5E")]
    public void Glyph_maps_each_state_to_its_fluent_icon(DataFreshnessStatus status, string expected) =>
        Assert.Equal(expected, DataFreshnessRegistration.Glyph(status));

    [Theory]
    [InlineData(DataFreshnessStatus.Fresh, "fresh")]
    [InlineData(DataFreshnessStatus.Fetching, "fetching")]
    [InlineData(DataFreshnessStatus.Stale, "stale")]
    [InlineData(DataFreshnessStatus.Error, "error")]
    public void StatusToken_matches_the_web_union(DataFreshnessStatus status, string expected) =>
        Assert.Equal(expected, DataFreshnessRegistration.StatusToken(status));

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        // web freshness.* keys (translation-namespaced for the WinUI resource catalog) with verbatim fallbacks.
        Assert.Equal("translation.freshness.justNow", DataFreshnessRegistration.JustNowKey);
        Assert.Equal("just now", DataFreshnessRegistration.JustNowFallback);
        Assert.Equal("translation.freshness.minutes", DataFreshnessRegistration.MinutesKey);
        Assert.Equal("{0}m ago", DataFreshnessRegistration.MinutesFallback);
        Assert.Equal("translation.freshness.hours", DataFreshnessRegistration.HoursKey);
        Assert.Equal("{0}h ago", DataFreshnessRegistration.HoursFallback);
        Assert.Equal("translation.freshness.days", DataFreshnessRegistration.DaysKey);
        Assert.Equal("{0}d ago", DataFreshnessRegistration.DaysFallback);
        Assert.Equal("translation.freshness.weeks", DataFreshnessRegistration.WeeksKey);
        Assert.Equal("{0}w ago", DataFreshnessRegistration.WeeksFallback);
        Assert.Equal("translation.freshness.updating", DataFreshnessRegistration.UpdatingKey);
        Assert.Equal("updating\u2026", DataFreshnessRegistration.UpdatingFallback);
        Assert.Equal("translation.freshness.error", DataFreshnessRegistration.ErrorKey);
        Assert.Equal("error", DataFreshnessRegistration.ErrorFallback);
        Assert.Equal("translation.freshness.updatingTooltip", DataFreshnessRegistration.UpdatingTooltipKey);
        Assert.Equal("Updating\u2026", DataFreshnessRegistration.UpdatingTooltipFallback);
        Assert.Equal("translation.freshness.lastUpdated", DataFreshnessRegistration.LastUpdatedKey);
        Assert.Equal("Last updated: {0}", DataFreshnessRegistration.LastUpdatedFallback);
        Assert.Equal("translation.freshness.neverUpdated", DataFreshnessRegistration.NeverUpdatedKey);
        Assert.Equal("Never updated", DataFreshnessRegistration.NeverUpdatedFallback);
        Assert.Equal("translation.freshness.refresh", DataFreshnessRegistration.RefreshKey);
        Assert.Equal("Refresh", DataFreshnessRegistration.RefreshFallback);
        Assert.Equal("translation.a11y.dataFreshness", DataFreshnessRegistration.DataFreshnessAriaKey);
        Assert.Equal("Data freshness: {0}", DataFreshnessRegistration.DataFreshnessAriaFallback);
    }

    // ── snapshot adapter (RepositoryResult → snapshot): the web DataFreshnessAuto prop derivation ────────────

    [Fact]
    public void FromResult_loading_is_fetching_with_no_timestamp()
    {
        var snap = DataFreshnessSnapshot.FromRepositoryResult(RepositoryResult<int>.Loading(), Now);

        Assert.Null(snap.UpdatedAt);
        Assert.True(snap.IsFetching);
        Assert.False(snap.IsStale);
        Assert.False(snap.IsError);
    }

    [Fact]
    public void FromResult_cached_fresh_carries_the_timestamp_and_is_not_stale()
    {
        var at = Now.AddMinutes(-1);
        var snap = DataFreshnessSnapshot.FromRepositoryResult(RepositoryResult<int>.Cached(1, at, stale: false), Now);

        Assert.Equal(at, snap.UpdatedAt);
        Assert.False(snap.IsFetching);
        Assert.False(snap.IsStale);
        Assert.False(snap.IsError);
    }

    [Fact]
    public void FromResult_cached_stale_flags_stale()
    {
        var at = Now.AddMinutes(-10);
        var snap = DataFreshnessSnapshot.FromRepositoryResult(RepositoryResult<int>.Cached(1, at, stale: true), Now);

        Assert.True(snap.IsStale);
        Assert.False(snap.IsFetching);
        Assert.False(snap.IsError);
    }

    [Fact]
    public void FromResult_refreshing_is_fetching_over_a_cached_value()
    {
        var at = Now.AddMinutes(-2);
        var snap = DataFreshnessSnapshot.FromRepositoryResult(RepositoryResult<int>.Refreshing(1, at, stale: false), Now);

        Assert.Equal(at, snap.UpdatedAt);
        Assert.True(snap.IsFetching);
        Assert.False(snap.IsError);
    }

    [Fact]
    public void FromResult_loaded_is_fresh()
    {
        var snap = DataFreshnessSnapshot.FromRepositoryResult(RepositoryResult<int>.Loaded(1, Now), Now);

        Assert.Equal(Now, snap.UpdatedAt);
        Assert.False(snap.IsFetching);
        Assert.False(snap.IsStale);
        Assert.False(snap.IsError);
    }

    [Fact]
    public void FromResult_empty_carries_its_fetch_time_but_no_error()
    {
        var snap = DataFreshnessSnapshot.FromRepositoryResult(RepositoryResult<int>.Empty(Now), Now);

        Assert.Equal(Now, snap.UpdatedAt);
        Assert.False(snap.IsError);
        Assert.False(snap.IsFetching);
    }

    [Fact]
    public void FromResult_failure_is_error_with_no_timestamp()
    {
        var error = new RepositoryError(RepositoryErrorKind.Server, "boom");
        var snap = DataFreshnessSnapshot.FromRepositoryResult(RepositoryResult<int>.Failure(error), Now);

        Assert.Null(snap.UpdatedAt);
        Assert.True(snap.IsError);
        Assert.False(snap.IsFetching);
    }

    [Fact]
    public void FromResult_offline_cached_is_error_but_keeps_the_cached_timestamp()
    {
        // web: a TanStack query can be isError yet still hold its last dataUpdatedAt — the offline-cached chip
        // shows the WifiOff glyph beside the cached age.
        var at = Now.AddMinutes(-3);
        var error = new RepositoryError(RepositoryErrorKind.Network, "offline");
        var snap = DataFreshnessSnapshot.FromRepositoryResult(RepositoryResult<int>.OfflineCached(1, at, error), Now);

        Assert.Equal(at, snap.UpdatedAt);
        Assert.True(snap.IsError);
        Assert.True(snap.IsStale);
        Assert.False(snap.IsFetching);
    }

    [Fact]
    public void FromResult_force_stale_window_overrides_a_fresh_value()
    {
        var at = Now.AddMinutes(-10);
        var loaded = RepositoryResult<int>.Loaded(1, at);

        var withoutOverride = DataFreshnessSnapshot.FromRepositoryResult(loaded, Now);
        var withOverride = DataFreshnessSnapshot.FromRepositoryResult(loaded, Now, forceStaleAfterMs: TimeSpan.FromMinutes(5).TotalMilliseconds);

        Assert.False(withoutOverride.IsStale);
        Assert.True(withOverride.IsStale);
    }

    [Fact]
    public void FromResult_throws_when_the_result_is_null() =>
        Assert.Throws<ArgumentNullException>(() => DataFreshnessSnapshot.FromRepositoryResult<int>(null!, Now));

    // ── projection: status precedence (web error > fetching > stale > fresh) ─────────────────────────────────

    [Fact]
    public void Status_error_wins_over_every_other_flag() =>
        Assert.Equal(DataFreshnessStatus.Error, Project(Snap(updatedAt: Now, fetching: true, stale: true, error: true)).Status);

    [Fact]
    public void Status_fetching_wins_over_stale_and_fresh() =>
        Assert.Equal(DataFreshnessStatus.Fetching, Project(Snap(fetching: true, stale: true)).Status);

    [Fact]
    public void Status_stale_wins_over_fresh() =>
        Assert.Equal(DataFreshnessStatus.Stale, Project(Snap(updatedAt: Now, stale: true)).Status);

    [Fact]
    public void Status_defaults_to_fresh() =>
        Assert.Equal(DataFreshnessStatus.Fresh, Project(Snap(updatedAt: Now)).Status);

    // ── projection: relative-time text (web relativeTime + formatRelativeTime tiers) ─────────────────────────

    [Fact]
    public void RelativeText_just_now_holds_for_the_first_minute() =>
        Assert.Equal("just now", Project(Snap(updatedAt: Now.AddSeconds(-30))).RelativeText);

    [Fact]
    public void RelativeText_minutes_tier() =>
        Assert.Equal("5m ago", Project(Snap(updatedAt: Now.AddMinutes(-5))).RelativeText);

    [Fact]
    public void RelativeText_hours_tier() =>
        Assert.Equal("2h ago", Project(Snap(updatedAt: Now.AddHours(-2))).RelativeText);

    [Fact]
    public void RelativeText_days_tier() =>
        Assert.Equal("3d ago", Project(Snap(updatedAt: Now.AddDays(-3))).RelativeText);

    [Fact]
    public void RelativeText_weeks_tier() =>
        Assert.Equal("2w ago", Project(Snap(updatedAt: Now.AddDays(-14))).RelativeText);

    [Fact]
    public void RelativeText_fetching_reads_updating() =>
        Assert.Equal("updating\u2026", Project(Snap(updatedAt: Now.AddMinutes(-5), fetching: true)).RelativeText);

    [Fact]
    public void RelativeText_hard_error_reads_error() =>
        Assert.Equal("error", Project(Snap(error: true)).RelativeText);

    [Fact]
    public void RelativeText_offline_cached_shows_the_cached_age_not_error() =>
        Assert.Equal("3m ago", Project(Snap(updatedAt: Now.AddMinutes(-3), stale: true, error: true)).RelativeText);

    [Fact]
    public void RelativeText_never_updated_is_empty() =>
        Assert.Equal(string.Empty, Project(Snap()).RelativeText);

    [Fact]
    public void FormatRelativeTime_tiers_are_exact()
    {
        Assert.Equal("just now", DataFreshnessProjection.FormatRelativeTime(TimeSpan.FromSeconds(59), Localizer));
        Assert.Equal("1m ago", DataFreshnessProjection.FormatRelativeTime(TimeSpan.FromSeconds(60), Localizer));
        Assert.Equal("59m ago", DataFreshnessProjection.FormatRelativeTime(TimeSpan.FromMinutes(59), Localizer));
        Assert.Equal("1h ago", DataFreshnessProjection.FormatRelativeTime(TimeSpan.FromHours(1), Localizer));
        Assert.Equal("23h ago", DataFreshnessProjection.FormatRelativeTime(TimeSpan.FromHours(23), Localizer));
        Assert.Equal("1d ago", DataFreshnessProjection.FormatRelativeTime(TimeSpan.FromDays(1), Localizer));
        Assert.Equal("6d ago", DataFreshnessProjection.FormatRelativeTime(TimeSpan.FromDays(6), Localizer));
        Assert.Equal("1w ago", DataFreshnessProjection.FormatRelativeTime(TimeSpan.FromDays(7), Localizer));
        Assert.Equal("just now", DataFreshnessProjection.FormatRelativeTime(TimeSpan.FromSeconds(-5), Localizer));
    }

    // ── projection: title / tooltip (web title) ──────────────────────────────────────────────────────────────

    [Fact]
    public void Title_reduced_motion_fetching_reads_updating_tooltip() =>
        Assert.Equal("Updating\u2026", Project(Snap(updatedAt: Now, fetching: true), reduceMotion: true).Title);

    [Fact]
    public void Title_fetching_with_motion_falls_through_to_last_updated() =>
        Assert.Equal("Last updated: TIME", Project(Snap(updatedAt: Now, fetching: true)).Title);

    [Fact]
    public void Title_last_updated_when_timestamped() =>
        Assert.Equal("Last updated: TIME", Project(Snap(updatedAt: Now)).Title);

    [Fact]
    public void Title_never_updated_when_no_timestamp() =>
        Assert.Equal("Never updated", Project(Snap()).Title);

    // ── projection: aria-label + role (web aria-label / role) ────────────────────────────────────────────────

    [Fact]
    public void AutomationName_is_refresh_when_refreshable()
    {
        var projection = Project(Snap(updatedAt: Now), canRefresh: true);

        Assert.Equal("Refresh", projection.AutomationName);
        Assert.Equal("button", projection.Role);
        Assert.True(projection.Interactive);
    }

    [Theory]
    [InlineData(DataFreshnessStatus.Fresh, "Data freshness: fresh")]
    [InlineData(DataFreshnessStatus.Error, "Data freshness: error")]
    public void AutomationName_is_data_freshness_state_when_read_only(DataFreshnessStatus expectedStatus, string expectedName)
    {
        var snapshot = expectedStatus == DataFreshnessStatus.Error ? Snap(error: true) : Snap(updatedAt: Now);
        var projection = Project(snapshot, canRefresh: false);

        Assert.Equal(expectedStatus, projection.Status);
        Assert.Equal(expectedName, projection.AutomationName);
        Assert.Equal("status", projection.Role);
        Assert.False(projection.Interactive);
    }

    // ── projection: reduced-motion-gated animation flags (web animate-spin / ping / pulse) ───────────────────

    [Fact]
    public void Fetching_spins_and_pings_when_motion_is_allowed()
    {
        var projection = Project(Snap(fetching: true));

        Assert.True(projection.Spin);
        Assert.True(projection.Ping);
    }

    [Fact]
    public void Fetching_does_not_spin_or_ping_under_reduced_motion()
    {
        var projection = Project(Snap(fetching: true), reduceMotion: true);

        Assert.False(projection.Spin);
        Assert.False(projection.Ping);
    }

    [Fact]
    public void Background_refetch_pulses_the_dot_when_motion_is_allowed() =>
        Assert.True(Project(Snap(updatedAt: Now, fetching: true)).PulseDot);

    [Fact]
    public void Background_refetch_does_not_pulse_under_reduced_motion() =>
        Assert.False(Project(Snap(updatedAt: Now, fetching: true), reduceMotion: true).PulseDot);

    [Fact]
    public void Initial_fetch_with_no_data_does_not_pulse() =>
        Assert.False(Project(Snap(fetching: true)).PulseDot);

    [Fact]
    public void Idle_states_never_animate()
    {
        var projection = Project(Snap(updatedAt: Now));

        Assert.False(projection.Spin);
        Assert.False(projection.Ping);
        Assert.False(projection.PulseDot);
    }

    [Fact]
    public void Compact_hides_the_text()
    {
        Assert.False(Project(Snap(updatedAt: Now), compact: true).ShowText);
        Assert.True(Project(Snap(updatedAt: Now), compact: false).ShowText);
    }

    // ── projection: per-state snapshot + value equality ──────────────────────────────────────────────────────

    [Theory]
    [InlineData(false, false, false, DataFreshnessStatus.Fresh, "TsColorSuccessBrush", "\uE701")]
    [InlineData(true, false, false, DataFreshnessStatus.Fetching, "TsColorInfoBrush", "\uE72C")]
    [InlineData(false, true, false, DataFreshnessStatus.Stale, "TsColorWarningBrush", "\uE701")]
    [InlineData(false, false, true, DataFreshnessStatus.Error, "TsColorDangerBrush", "\uEB5E")]
    public void Projection_snapshot_per_state(
        bool fetching,
        bool stale,
        bool error,
        DataFreshnessStatus expectedStatus,
        string expectedBrush,
        string expectedGlyph)
    {
        var projection = Project(Snap(updatedAt: Now, fetching: fetching, stale: stale, error: error));

        Assert.Equal(expectedStatus, projection.Status);
        Assert.Equal(expectedBrush, projection.AccentBrushKey);
        Assert.Equal(expectedGlyph, projection.IconGlyph);
        Assert.Equal("polite", projection.LiveSetting);
    }

    [Fact]
    public void Projection_value_equality_makes_identical_states_equal()
    {
        var a = Project(Snap(updatedAt: Now));
        var b = Project(Snap(updatedAt: Now));
        var different = Project(Snap(updatedAt: Now, stale: true));

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    [Fact]
    public void Project_throws_when_dependencies_are_null()
    {
        Assert.Throws<ArgumentNullException>(
            () => DataFreshnessProjection.Project(null!, false, false, false, Now, Localizer, FormatTime));
        Assert.Throws<ArgumentNullException>(
            () => DataFreshnessProjection.Project(Snap(), false, false, false, Now, null!, FormatTime));
        Assert.Throws<ArgumentNullException>(
            () => DataFreshnessProjection.Project(Snap(), false, false, false, Now, Localizer, null!));
    }

    [Fact]
    public void Projection_resolves_labels_through_the_localizer()
    {
        var localizer = new StubLocalizer(new Dictionary<string, string>
        {
            [DataFreshnessRegistration.MinutesKey] = "il y a {0} min",
        });

        Assert.Equal("il y a 5 min", Project(Snap(updatedAt: Now.AddMinutes(-5)), localizer: localizer).RelativeText);
    }

    // ── view-model (state holder) ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("DataFreshness", DataFreshnessViewModel.Slug);

    [Fact]
    public void ViewModel_starts_from_the_source_snapshot()
    {
        var source = new StaticDataFreshnessSource(Snap(updatedAt: Now.AddMinutes(-5)), canRefresh: false);
        using var viewModel = NewViewModel(source);

        Assert.Equal(DataFreshnessStatus.Fresh, viewModel.Status);
        Assert.Equal("5m ago", viewModel.RelativeText);
        Assert.Equal("status", viewModel.Role);
        Assert.False(viewModel.Interactive);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_snapshot_changes()
    {
        var source = new StaticDataFreshnessSource(Snap(updatedAt: Now.AddMinutes(-5)), canRefresh: false);
        using var viewModel = NewViewModel(source);
        var changes = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changes.Add(e.PropertyName);

        source.Set(Snap(fetching: true));

        Assert.Equal(DataFreshnessStatus.Fetching, viewModel.Status);
        Assert.Contains(nameof(DataFreshnessViewModel.Projection), changes);
    }

    [Fact]
    public void ViewModel_reacts_to_a_runtime_reduce_motion_change()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        var source = new StaticDataFreshnessSource(Snap(fetching: true), canRefresh: false);
        using var viewModel = new DataFreshnessViewModel(Localizer, source, motion, compact: false, clock: () => Now, formatTime: FormatTime);
        Assert.True(viewModel.Spin);

        motion.Set(reduceMotion: true);

        Assert.False(viewModel.Spin);
    }

    [Fact]
    public void ViewModel_request_refresh_forwards_when_idle_and_refreshable()
    {
        var source = new StaticDataFreshnessSource(Snap(updatedAt: Now), canRefresh: true);
        using var viewModel = NewViewModel(source);

        viewModel.RequestRefresh();

        Assert.Equal(1, source.RefreshCount);
    }

    [Fact]
    public void ViewModel_request_refresh_is_suppressed_while_fetching()
    {
        // web handleClick: if (onRefresh && !isFetching) onRefresh().
        var source = new StaticDataFreshnessSource(Snap(updatedAt: Now, fetching: true), canRefresh: true);
        using var viewModel = NewViewModel(source);

        viewModel.RequestRefresh();

        Assert.Equal(0, source.RefreshCount);
    }

    [Fact]
    public void ViewModel_request_refresh_is_a_no_op_when_not_refreshable()
    {
        var source = new StaticDataFreshnessSource(Snap(updatedAt: Now), canRefresh: false);
        using var viewModel = NewViewModel(source);

        viewModel.RequestRefresh();

        Assert.Equal(0, source.RefreshCount);
    }

    [Fact]
    public void ViewModel_notify_time_changed_advances_the_relative_label()
    {
        var clock = Now;
        var source = new StaticDataFreshnessSource(Snap(updatedAt: Now), canRefresh: false);
        using var viewModel = new DataFreshnessViewModel(Localizer, source, StaticMotionPreferenceSource.FullMotion, compact: false, clock: () => clock, formatTime: FormatTime);
        Assert.Equal("just now", viewModel.RelativeText);

        clock = Now.AddMinutes(5);
        viewModel.NotifyTimeChanged();

        Assert.Equal("5m ago", viewModel.RelativeText);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_both_sources()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        var source = new StaticDataFreshnessSource(Snap(updatedAt: Now), canRefresh: false);
        var viewModel = new DataFreshnessViewModel(Localizer, source, motion, compact: false, clock: () => Now, formatTime: FormatTime);
        Assert.Equal(1, motion.ObserverCount);

        viewModel.Dispose();

        Assert.Equal(0, motion.ObserverCount);

        // A late snapshot or motion change must not move the projection after dispose.
        var raised = false;
        viewModel.PropertyChanged += (_, _) => raised = true;
        source.Set(Snap(error: true));
        motion.Set(reduceMotion: true);
        Assert.False(raised);
        Assert.Equal(DataFreshnessStatus.Fresh, viewModel.Status);
    }

    [Fact]
    public void ViewModel_throws_when_dependencies_are_null()
    {
        var source = new StaticDataFreshnessSource(Snap(), canRefresh: false);
        Assert.Throws<ArgumentNullException>(
            () => new DataFreshnessViewModel(null!, source, StaticMotionPreferenceSource.FullMotion));
        Assert.Throws<ArgumentNullException>(
            () => new DataFreshnessViewModel(Localizer, null!, StaticMotionPreferenceSource.FullMotion));
        Assert.Throws<ArgumentNullException>(
            () => new DataFreshnessViewModel(Localizer, source, null!));
    }

    // ── sources (P1/S8 seam) ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void StaticSource_set_and_refresh_raise_changed()
    {
        var source = new StaticDataFreshnessSource(Snap(updatedAt: Now), canRefresh: true);
        var changes = 0;
        source.Changed += (_, _) => changes++;

        source.Set(Snap(fetching: true));
        source.Refresh();

        Assert.True(source.Current.IsFetching);
        Assert.Equal(2, changes);
        Assert.Equal(1, source.RefreshCount);
        Assert.True(source.CanRefresh);
    }

    [Fact]
    public void StaticSource_throws_when_constructed_with_a_null_snapshot() =>
        Assert.Throws<ArgumentNullException>(() => new StaticDataFreshnessSource(null!));

    [Fact]
    public void RepositorySource_streams_a_cache_then_network_read_into_the_snapshot()
    {
        using var source = new RepositoryDataFreshnessSource<int>(
            _ => Stream(
                RepositoryResult<int>.Loading(),
                RepositoryResult<int>.Cached(1, Now.AddMinutes(-1), stale: false),
                RepositoryResult<int>.Loaded(2, Now)),
            clock: () => Now);

        Assert.True(WaitUntil(() => source.Current.UpdatedAt == Now && !source.Current.IsFetching));
        Assert.False(source.Current.IsError);
        Assert.True(source.CanRefresh);
    }

    [Fact]
    public void RepositorySource_surfaces_an_offline_cached_terminal()
    {
        var at = Now.AddMinutes(-2);
        var error = new RepositoryError(RepositoryErrorKind.Network, "offline");
        using var source = new RepositoryDataFreshnessSource<int>(
            _ => Stream(
                RepositoryResult<int>.Loading(),
                RepositoryResult<int>.OfflineCached(1, at, error)),
            clock: () => Now);

        Assert.True(WaitUntil(() => source.Current.IsError));
        Assert.Equal(at, source.Current.UpdatedAt);
        Assert.True(source.Current.IsStale);
    }

    [Fact]
    public void RepositorySource_throws_when_the_stream_factory_is_null() =>
        Assert.Throws<ArgumentNullException>(() => new RepositoryDataFreshnessSource<int>(null!));

    // ── diagnostics (view.opened, PII-safe — only the slug) ──────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new DataFreshnessDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DataFreshness", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new DataFreshnessDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    private static DataFreshnessViewModel NewViewModel(IDataFreshnessSource source) =>
        new(Localizer, source, StaticMotionPreferenceSource.FullMotion, compact: false, clock: () => Now, formatTime: FormatTime);

    private static async IAsyncEnumerable<RepositoryResult<int>> Stream(params RepositoryResult<int>[] items)
    {
        foreach (var item in items)
        {
            await Task.Yield();
            yield return item;
        }
    }

    private static bool WaitUntil(Func<bool> condition)
    {
        for (var i = 0; i < 200; i++)
        {
            if (condition())
            {
                return true;
            }

            Thread.Sleep(10);
        }

        return condition();
    }

    private sealed class StubLocalizer : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string> _map;

        public StubLocalizer(IReadOnlyDictionary<string, string> map) => _map = map;

        public string GetString(string key, string fallback) =>
            _map.TryGetValue(key, out var value) ? value : fallback;
    }

    private sealed class FakeMotionSource : IMotionPreferenceSource
    {
        private readonly List<Action<bool>> _observers = new();
        private bool _reduceMotion;

        public FakeMotionSource(bool reduceMotion) => _reduceMotion = reduceMotion;

        public bool ReduceMotion => _reduceMotion;

        public int ObserverCount => _observers.Count;

        public IDisposable Observe(Action<bool> onChanged)
        {
            ArgumentNullException.ThrowIfNull(onChanged);
            _observers.Add(onChanged);
            return new Subscription(this, onChanged);
        }

        public void Set(bool reduceMotion)
        {
            _reduceMotion = reduceMotion;
            foreach (var observer in _observers.ToArray())
            {
                observer(reduceMotion);
            }
        }

        private sealed class Subscription : IDisposable
        {
            private readonly FakeMotionSource _owner;
            private readonly Action<bool> _observer;
            private bool _disposed;

            public Subscription(FakeMotionSource owner, Action<bool> observer)
            {
                _owner = owner;
                _observer = observer;
            }

            public void Dispose()
            {
                if (_disposed)
                {
                    return;
                }

                _disposed = true;
                _owner._observers.Remove(_observer);
            }
        }
    }
}
