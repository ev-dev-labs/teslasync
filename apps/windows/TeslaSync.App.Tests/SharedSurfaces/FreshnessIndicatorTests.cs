using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the FreshnessIndicator shared surface's UI-thread-free logic — the registration
/// metadata (slug, automation id, the relative-time / accessible-name i18n keys, the per-state token brush keys,
/// the per-size dot / font metrics and the web threshold defaults), the
/// <see cref="FreshnessIndicatorSnapshot.FromRepositoryResult{T}"/> adapter (the datum-timestamp selector across
/// the cache-then-network states), the pure <see cref="FreshnessIndicatorProjection"/> (status classification,
/// the <c>formatAge</c> tiers and their boundaries, sizes, the reduced-motion-gated pulse, the
/// <c>useIsStale</c> isStale / isOffline booleans, the timestamp tooltip and the composed accessible name), the
/// <see cref="FreshnessIndicatorViewModel"/> state holder (initial projection, sample + motion reprojection,
/// the relative-time tick, subscription cleanup), the <see cref="StaticFreshnessIndicatorSource"/> /
/// <see cref="RepositoryFreshnessIndicatorSource{T}"/> seams, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/data-display/FreshnessIndicator.tsx). The WinUI view itself
/// (shared-surfaces/FreshnessIndicator.cs) is exercised by the app build.
/// </summary>
public sealed class FreshnessIndicatorTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static string FormatTimestamp(DateTimeOffset ts) => "TS";

    private static FreshnessIndicatorSnapshot Snap(int? ageSeconds) =>
        new(ageSeconds is { } a ? Now.AddSeconds(-a) : null);

    private static FreshnessIndicatorProjection Project(
        FreshnessIndicatorSnapshot snapshot,
        FreshnessIndicatorSize size = FreshnessIndicatorSize.Small,
        bool showLabel = true,
        int staleThreshold = FreshnessIndicatorRegistration.DefaultStaleThresholdSeconds,
        int offlineThreshold = FreshnessIndicatorRegistration.DefaultOfflineThresholdSeconds,
        bool reduceMotion = false,
        ILocalizer? localizer = null) =>
        FreshnessIndicatorProjection.Project(
            snapshot,
            size,
            showLabel,
            staleThreshold,
            offlineThreshold,
            reduceMotion,
            Now,
            localizer ?? Localizer,
            FormatTimestamp);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("FreshnessIndicator", FreshnessIndicatorRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_stable() =>
        Assert.Equal("freshness-indicator", FreshnessIndicatorRegistration.RootAutomationId);

    [Fact]
    public void Status_role_is_a_read_only_status_indicator() =>
        Assert.Equal("status", FreshnessIndicatorRegistration.StatusRole);

    [Fact]
    public void Threshold_defaults_match_the_web_props()
    {
        // web: staleThreshold = 120, offlineThreshold = 600.
        Assert.Equal(120, FreshnessIndicatorRegistration.DefaultStaleThresholdSeconds);
        Assert.Equal(600, FreshnessIndicatorRegistration.DefaultOfflineThresholdSeconds);
    }

    [Theory]
    [InlineData(FreshnessStatus.Fresh, "TsColorSuccessBrush")]
    [InlineData(FreshnessStatus.Stale, "TsColorWarningBrush")]
    [InlineData(FreshnessStatus.Offline, "TsColorDangerBrush")]
    [InlineData(FreshnessStatus.Unknown, "TsColorTextMutedBrush")]
    public void AccentBrushKey_maps_each_state_to_its_token_brush(FreshnessStatus status, string expected) =>
        Assert.Equal(expected, FreshnessIndicatorRegistration.AccentBrushKey(status));

    [Theory]
    [InlineData(FreshnessStatus.Fresh, "fresh")]
    [InlineData(FreshnessStatus.Stale, "stale")]
    [InlineData(FreshnessStatus.Offline, "offline")]
    [InlineData(FreshnessStatus.Unknown, "unknown")]
    public void StatusToken_matches_the_web_union(FreshnessStatus status, string expected) =>
        Assert.Equal(expected, FreshnessIndicatorRegistration.StatusToken(status));

    [Theory]
    [InlineData(FreshnessIndicatorSize.Small, 6.0, 10.0)]
    [InlineData(FreshnessIndicatorSize.Medium, 8.0, 12.0)]
    public void Size_metrics_match_the_web_dot_and_label_tables(
        FreshnessIndicatorSize size,
        double expectedDot,
        double expectedFont)
    {
        Assert.Equal(expectedDot, FreshnessIndicatorRegistration.DotDiameter(size));
        Assert.Equal(expectedFont, FreshnessIndicatorRegistration.LabelFontSize(size));
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        // web freshness.* tiers (translation-namespaced for the WinUI resource catalog) with verbatim fallbacks.
        Assert.Equal("translation.freshness.justNow", FreshnessIndicatorRegistration.JustNowKey);
        Assert.Equal("just now", FreshnessIndicatorRegistration.JustNowFallback);
        Assert.Equal("translation.freshness.seconds", FreshnessIndicatorRegistration.SecondsKey);
        Assert.Equal("{0}s ago", FreshnessIndicatorRegistration.SecondsFallback);
        Assert.Equal("translation.freshness.minutes", FreshnessIndicatorRegistration.MinutesKey);
        Assert.Equal("{0}m ago", FreshnessIndicatorRegistration.MinutesFallback);
        Assert.Equal("translation.freshness.hours", FreshnessIndicatorRegistration.HoursKey);
        Assert.Equal("{0}h ago", FreshnessIndicatorRegistration.HoursFallback);
        Assert.Equal("translation.freshness.unknown", FreshnessIndicatorRegistration.UnknownKey);
        Assert.Equal("\u2014", FreshnessIndicatorRegistration.UnknownFallback);
        Assert.Equal("translation.a11y.freshnessIndicator", FreshnessIndicatorRegistration.DetailedAriaKey);
        Assert.Equal("Data freshness: {0}, {1}", FreshnessIndicatorRegistration.DetailedAriaFallback);
        Assert.Equal("translation.a11y.dataFreshness", FreshnessIndicatorRegistration.StatusAriaKey);
        Assert.Equal("Data freshness: {0}", FreshnessIndicatorRegistration.StatusAriaFallback);
    }

    // ── snapshot adapter (RepositoryResult → datum timestamp) ────────────────────────────────────────────────

    [Fact]
    public void FromResult_loading_has_no_reading()
    {
        var snapshot = FreshnessIndicatorSnapshot.FromRepositoryResult(
            RepositoryResult<int>.Loading(),
            v => Now.AddMinutes(-v));

        Assert.Null(snapshot.Timestamp);
    }

    [Fact]
    public void FromResult_loaded_selects_the_datum_timestamp()
    {
        var snapshot = FreshnessIndicatorSnapshot.FromRepositoryResult(
            RepositoryResult<int>.Loaded(5, Now),
            v => Now.AddMinutes(-v));

        Assert.Equal(Now.AddMinutes(-5), snapshot.Timestamp);
    }

    [Fact]
    public void FromResult_offline_cached_selects_the_cached_datum_timestamp_not_the_fetch_time()
    {
        var error = new RepositoryError(RepositoryErrorKind.Network, "offline");
        var snapshot = FreshnessIndicatorSnapshot.FromRepositoryResult(
            RepositoryResult<int>.OfflineCached(2, Now.AddHours(-1), error),
            v => Now.AddMinutes(-v));

        // The datum's own timestamp (selector over the value), not RepositoryResult.FetchedAt.
        Assert.Equal(Now.AddMinutes(-2), snapshot.Timestamp);
    }

    [Fact]
    public void FromResult_throws_when_dependencies_are_null()
    {
        Assert.Throws<ArgumentNullException>(
            () => FreshnessIndicatorSnapshot.FromRepositoryResult<int>(null!, v => Now));
        Assert.Throws<ArgumentNullException>(
            () => FreshnessIndicatorSnapshot.FromRepositoryResult(RepositoryResult<int>.Loaded(1, Now), null!));
    }

    // ── projection: status classification (web getStatus) ────────────────────────────────────────────────────

    [Theory]
    [InlineData(30, FreshnessStatus.Fresh, "TsColorSuccessBrush")]
    [InlineData(200, FreshnessStatus.Stale, "TsColorWarningBrush")]
    [InlineData(700, FreshnessStatus.Offline, "TsColorDangerBrush")]
    public void Projection_classifies_age_against_the_thresholds(int ageSeconds, FreshnessStatus status, string brush)
    {
        var projection = Project(Snap(ageSeconds));

        Assert.Equal(status, projection.Status);
        Assert.Equal(brush, projection.AccentBrushKey);
        Assert.Equal(ageSeconds, projection.AgeSeconds);
    }

    [Fact]
    public void Projection_no_reading_is_unknown()
    {
        var projection = Project(Snap(null));

        Assert.Equal(FreshnessStatus.Unknown, projection.Status);
        Assert.Equal("TsColorTextMutedBrush", projection.AccentBrushKey);
        Assert.Null(projection.AgeSeconds);
        Assert.Equal("\u2014", projection.Label);
    }

    // ── projection: relative label (web formatAge) ───────────────────────────────────────────────────────────

    [Theory]
    [InlineData(null, "\u2014")]
    [InlineData(0, "just now")]
    [InlineData(9, "just now")]
    [InlineData(10, "10s ago")]
    [InlineData(45, "45s ago")]
    [InlineData(59, "59s ago")]
    [InlineData(60, "1m ago")]
    [InlineData(300, "5m ago")]
    [InlineData(3599, "59m ago")]
    [InlineData(3600, "1h ago")]
    [InlineData(10800, "3h ago")]
    public void Projection_label_matches_the_formatAge_tiers(int? ageSeconds, string expected) =>
        Assert.Equal(expected, Project(Snap(ageSeconds)).Label);

    [Fact]
    public void FormatAgeLabel_tiers_are_exact()
    {
        Assert.Equal("\u2014", FreshnessIndicatorProjection.FormatAgeLabel(null, Localizer));
        Assert.Equal("just now", FreshnessIndicatorProjection.FormatAgeLabel(0, Localizer));
        Assert.Equal("just now", FreshnessIndicatorProjection.FormatAgeLabel(9, Localizer));
        Assert.Equal("10s ago", FreshnessIndicatorProjection.FormatAgeLabel(10, Localizer));
        Assert.Equal("59s ago", FreshnessIndicatorProjection.FormatAgeLabel(59, Localizer));
        Assert.Equal("1m ago", FreshnessIndicatorProjection.FormatAgeLabel(60, Localizer));
        Assert.Equal("59m ago", FreshnessIndicatorProjection.FormatAgeLabel(3599, Localizer));
        Assert.Equal("1h ago", FreshnessIndicatorProjection.FormatAgeLabel(3600, Localizer));
        Assert.Equal("3h ago", FreshnessIndicatorProjection.FormatAgeLabel(10_800, Localizer));
    }

    // ── projection: sizes (web DOT_SIZE / LABEL_SIZE) ────────────────────────────────────────────────────────

    [Fact]
    public void Projection_small_size_uses_the_compact_metrics()
    {
        var projection = Project(Snap(30), size: FreshnessIndicatorSize.Small);

        Assert.Equal(FreshnessIndicatorSize.Small, projection.Size);
        Assert.Equal(6.0, projection.DotDiameter);
        Assert.Equal(10.0, projection.LabelFontSize);
    }

    [Fact]
    public void Projection_medium_size_uses_the_roomier_metrics()
    {
        var projection = Project(Snap(30), size: FreshnessIndicatorSize.Medium);

        Assert.Equal(FreshnessIndicatorSize.Medium, projection.Size);
        Assert.Equal(8.0, projection.DotDiameter);
        Assert.Equal(12.0, projection.LabelFontSize);
    }

    [Fact]
    public void Projection_show_label_toggles_visibility()
    {
        Assert.True(Project(Snap(30), showLabel: true).ShowLabel);
        Assert.False(Project(Snap(30), showLabel: false).ShowLabel);
    }

    // ── projection: reduced-motion-gated pulse (web fresh-dot animate-pulse) ─────────────────────────────────

    [Fact]
    public void Fresh_dot_pulses_when_motion_is_allowed() =>
        Assert.True(Project(Snap(30)).Pulse);

    [Fact]
    public void Fresh_dot_does_not_pulse_under_reduced_motion() =>
        Assert.False(Project(Snap(30), reduceMotion: true).Pulse);

    [Theory]
    [InlineData(200)]
    [InlineData(700)]
    [InlineData(null)]
    public void Non_fresh_states_never_pulse(int? ageSeconds) =>
        Assert.False(Project(Snap(ageSeconds)).Pulse);

    // ── projection: useIsStale booleans (web useIsStale return value) ────────────────────────────────────────

    [Theory]
    [InlineData(30, false, false)]
    [InlineData(200, true, false)]
    [InlineData(700, true, true)]
    [InlineData(null, false, false)]
    public void Projection_exposes_the_useIsStale_booleans(int? ageSeconds, bool isStale, bool isOffline)
    {
        var projection = Project(Snap(ageSeconds));

        Assert.Equal(isStale, projection.IsStale);
        Assert.Equal(isOffline, projection.IsOffline);
    }

    // ── projection: tooltip (web title={timestamp}) ──────────────────────────────────────────────────────────

    [Fact]
    public void Title_is_the_formatted_reading_time_when_present() =>
        Assert.Equal("TS", Project(Snap(30)).Title);

    [Fact]
    public void Title_is_empty_when_there_is_no_reading() =>
        Assert.Equal(string.Empty, Project(Snap(null)).Title);

    // ── projection: accessible name ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void AutomationName_announces_status_and_age_when_a_reading_exists() =>
        Assert.Equal("Data freshness: stale, 5m ago", Project(Snap(300)).AutomationName);

    [Fact]
    public void AutomationName_announces_status_only_when_there_is_no_reading() =>
        Assert.Equal("Data freshness: unknown", Project(Snap(null)).AutomationName);

    // ── projection: equality, guards, localizer routing ─────────────────────────────────────────────────────

    [Fact]
    public void Projection_value_equality_makes_identical_states_equal()
    {
        var a = Project(Snap(300));
        var b = Project(Snap(300));
        var different = Project(Snap(30));

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    [Fact]
    public void Project_throws_when_dependencies_are_null()
    {
        Assert.Throws<ArgumentNullException>(() => FreshnessIndicatorProjection.Project(
            null!, FreshnessIndicatorSize.Small, true, 120, 600, false, Now, Localizer, FormatTimestamp));
        Assert.Throws<ArgumentNullException>(() => FreshnessIndicatorProjection.Project(
            Snap(30), FreshnessIndicatorSize.Small, true, 120, 600, false, Now, null!, FormatTimestamp));
        Assert.Throws<ArgumentNullException>(() => FreshnessIndicatorProjection.Project(
            Snap(30), FreshnessIndicatorSize.Small, true, 120, 600, false, Now, Localizer, null!));
    }

    [Fact]
    public void Projection_resolves_labels_through_the_localizer()
    {
        var localizer = new StubLocalizer(new Dictionary<string, string>
        {
            [FreshnessIndicatorRegistration.MinutesKey] = "il y a {0} min",
        });

        Assert.Equal("il y a 5 min", Project(Snap(300), localizer: localizer).Label);
    }

    // ── view-model (state holder) ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("FreshnessIndicator", FreshnessIndicatorViewModel.Slug);

    [Fact]
    public void ViewModel_starts_from_the_source_sample()
    {
        var source = new StaticFreshnessIndicatorSource(Snap(300));
        using var viewModel = NewViewModel(source);

        Assert.Equal(FreshnessStatus.Stale, viewModel.Status);
        Assert.Equal("5m ago", viewModel.AgeLabel);
        Assert.True(viewModel.IsStale);
        Assert.False(viewModel.IsOffline);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_sample_changes()
    {
        var source = new StaticFreshnessIndicatorSource(Snap(30));
        using var viewModel = NewViewModel(source);
        var changes = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changes.Add(e.PropertyName);

        source.Set(Snap(700));

        Assert.Equal(FreshnessStatus.Offline, viewModel.Status);
        Assert.Contains(nameof(FreshnessIndicatorViewModel.Projection), changes);
    }

    [Fact]
    public void ViewModel_reacts_to_a_runtime_reduce_motion_change()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        var source = new StaticFreshnessIndicatorSource(Snap(30));
        using var viewModel = new FreshnessIndicatorViewModel(Localizer, source, motion, clock: () => Now, formatTimestamp: FormatTimestamp);
        Assert.True(viewModel.Pulse);

        motion.Set(reduceMotion: true);

        Assert.False(viewModel.Pulse);
    }

    [Fact]
    public void ViewModel_notify_time_changed_advances_the_relative_label()
    {
        var clock = Now;
        var source = new StaticFreshnessIndicatorSource(new FreshnessIndicatorSnapshot(Now));
        using var viewModel = new FreshnessIndicatorViewModel(Localizer, source, StaticMotionPreferenceSource.FullMotion, clock: () => clock, formatTimestamp: FormatTimestamp);
        Assert.Equal("just now", viewModel.AgeLabel);

        clock = Now.AddMinutes(5);
        viewModel.NotifyTimeChanged();

        Assert.Equal("5m ago", viewModel.AgeLabel);
        Assert.True(viewModel.IsStale);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_both_sources()
    {
        var motion = new FakeMotionSource(reduceMotion: false);
        var source = new StaticFreshnessIndicatorSource(Snap(30));
        var viewModel = new FreshnessIndicatorViewModel(Localizer, source, motion, clock: () => Now, formatTimestamp: FormatTimestamp);
        Assert.Equal(1, motion.ObserverCount);

        viewModel.Dispose();

        Assert.Equal(0, motion.ObserverCount);

        // A late sample or motion change must not move the projection after dispose.
        var raised = false;
        viewModel.PropertyChanged += (_, _) => raised = true;
        source.Set(Snap(700));
        motion.Set(reduceMotion: true);
        Assert.False(raised);
        Assert.Equal(FreshnessStatus.Fresh, viewModel.Status);
    }

    [Fact]
    public void ViewModel_throws_when_dependencies_are_null()
    {
        var source = new StaticFreshnessIndicatorSource(Snap(null));
        Assert.Throws<ArgumentNullException>(
            () => new FreshnessIndicatorViewModel(null!, source, StaticMotionPreferenceSource.FullMotion));
        Assert.Throws<ArgumentNullException>(
            () => new FreshnessIndicatorViewModel(Localizer, null!, StaticMotionPreferenceSource.FullMotion));
        Assert.Throws<ArgumentNullException>(
            () => new FreshnessIndicatorViewModel(Localizer, source, null!));
    }

    // ── sources (P1/S8 seam) ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void StaticSource_set_raises_changed()
    {
        var source = new StaticFreshnessIndicatorSource(Snap(30));
        var changes = 0;
        source.Changed += (_, _) => changes++;

        source.Set(Snap(700));

        Assert.Equal(Now.AddSeconds(-700), source.Current.Timestamp);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void StaticSource_throws_when_constructed_with_a_null_sample() =>
        Assert.Throws<ArgumentNullException>(() => new StaticFreshnessIndicatorSource(null!));

    [Fact]
    public void RepositorySource_streams_a_cache_then_network_read_into_the_sample()
    {
        using var source = new RepositoryFreshnessIndicatorSource<int>(
            _ => Stream(
                RepositoryResult<int>.Loading(),
                RepositoryResult<int>.Cached(10, Now.AddHours(-1), stale: false),
                RepositoryResult<int>.Loaded(5, Now)),
            selectTimestamp: v => Now.AddMinutes(-v));

        Assert.True(WaitUntil(() => source.Current.Timestamp == Now.AddMinutes(-5)));
    }

    [Fact]
    public void RepositorySource_throws_when_dependencies_are_null()
    {
        Assert.Throws<ArgumentNullException>(
            () => new RepositoryFreshnessIndicatorSource<int>(null!, v => Now));
        Assert.Throws<ArgumentNullException>(
            () => new RepositoryFreshnessIndicatorSource<int>(_ => Stream(RepositoryResult<int>.Loading()), null!));
    }

    // ── diagnostics (view.opened, PII-safe — only the slug) ──────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new FreshnessIndicatorDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=FreshnessIndicator", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new FreshnessIndicatorDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    private static FreshnessIndicatorViewModel NewViewModel(IFreshnessIndicatorSource source) =>
        new(Localizer, source, StaticMotionPreferenceSource.FullMotion, clock: () => Now, formatTimestamp: FormatTimestamp);

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
