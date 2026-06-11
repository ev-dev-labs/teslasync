using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the SourceLayerBadge shared surface's UI-thread-free logic — the registration
/// metadata (slug, automation id, status role, the age + per-layer description i18n keys with their verbatim web
/// fallbacks, the per-layer token brush keys / glyphs / lowercase tokens, the badge metrics), the
/// <see cref="SourceLayerBadgeSnapshot.FromRepositoryResult{T}"/> adapter (the source-layer selector across the
/// cache-then-network states), the pure <see cref="SourceLayerBadgeProjection"/> (layer classification, the
/// <c>data-source</c> token, the glyph + tint, the <c>formatAge</c> tiers, the description + age tooltip
/// composition, the <c>min-w</c> width and the accessible name), the <see cref="SourceLayerBadgeViewModel"/>
/// state holder (initial projection, source reprojection, subscription cleanup), the
/// <see cref="StaticSourceLayerBadgeSource"/> / <see cref="RepositorySourceLayerBadgeSource{T}"/> seams, and the
/// PII-safe diagnostics. Mirrors the web spec (web/src/components/data-display/SourceLayerBadge.tsx). The WinUI
/// view itself (shared-surfaces/SourceLayerBadge.cs) is exercised by the app build.
/// </summary>
public sealed class SourceLayerBadgeTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private const string L1Desc = "Read from the in-process SignalStore (hot path, freshest).";
    private const string L2Desc = "Read from Redis cross-pod cache (legacy entry; freshness unknown).";
    private const string LogDesc = "Replayed from signal_log (durable history).";
    private const string StaleDesc = "Redis-backed value older than the 2-minute freshness window.";
    private const string UnknownDesc = "Source layer unknown.";

    private sealed record Sample(string? Source, double? Age);

    private static SourceLayerBadgeProjection Project(
        SourceLayerBadgeSnapshot snapshot,
        bool showLabel = false,
        ILocalizer? localizer = null) =>
        SourceLayerBadgeProjection.Project(snapshot, showLabel, localizer ?? Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("SourceLayerBadge", SourceLayerBadgeRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_stable() =>
        Assert.Equal("source-layer-badge", SourceLayerBadgeRegistration.RootAutomationId);

    [Fact]
    public void Status_role_is_a_read_only_status_indicator() =>
        Assert.Equal("status", SourceLayerBadgeRegistration.StatusRole);

    [Fact]
    public void Min_widths_match_the_web_show_label_variants()
    {
        // web: showLabel ? min-w-[2.5rem] (40) : min-w-[1.5rem] (24).
        Assert.Equal(40, SourceLayerBadgeRegistration.ExpandedMinWidth);
        Assert.Equal(24, SourceLayerBadgeRegistration.CompactMinWidth);
    }

    [Fact]
    public void Age_i18n_key_and_fallback_match_the_web_source()
    {
        Assert.Equal("translation.sourceLayer.age", SourceLayerBadgeRegistration.AgeKey);
        Assert.Equal("age", SourceLayerBadgeRegistration.AgeFallback);
    }

    [Theory]
    [InlineData(SourceLayer.L1, "l1")]
    [InlineData(SourceLayer.L2, "l2")]
    [InlineData(SourceLayer.Log, "log")]
    [InlineData(SourceLayer.Stale, "stale")]
    [InlineData(SourceLayer.Unknown, "unknown")]
    public void LayerToken_matches_the_web_data_source(SourceLayer layer, string expected) =>
        Assert.Equal(expected, SourceLayerBadgeRegistration.LayerToken(layer));

    [Theory]
    [InlineData(SourceLayer.L1, "translation.sourceLayer.l1.desc")]
    [InlineData(SourceLayer.L2, "translation.sourceLayer.l2.desc")]
    [InlineData(SourceLayer.Log, "translation.sourceLayer.log.desc")]
    [InlineData(SourceLayer.Stale, "translation.sourceLayer.stale.desc")]
    [InlineData(SourceLayer.Unknown, "translation.sourceLayer.unknown.desc")]
    public void DescriptionKey_matches_the_web_style_table(SourceLayer layer, string expected) =>
        Assert.Equal(expected, SourceLayerBadgeRegistration.DescriptionKey(layer));

    [Theory]
    [InlineData(SourceLayer.L1, L1Desc)]
    [InlineData(SourceLayer.L2, L2Desc)]
    [InlineData(SourceLayer.Log, LogDesc)]
    [InlineData(SourceLayer.Stale, StaleDesc)]
    [InlineData(SourceLayer.Unknown, UnknownDesc)]
    public void DescriptionFallback_matches_the_web_style_table(SourceLayer layer, string expected) =>
        Assert.Equal(expected, SourceLayerBadgeRegistration.DescriptionFallback(layer));

    [Theory]
    [InlineData(SourceLayer.L1, "L1", "TsColorSuccessBrush")]
    [InlineData(SourceLayer.L2, "L2", "TsColorInfoBrush")]
    [InlineData(SourceLayer.Log, "LOG", "TsColorTextSecondaryBrush")]
    [InlineData(SourceLayer.Stale, "STALE", "TsColorWarningBrush")]
    [InlineData(SourceLayer.Unknown, "\u2014", "TsColorTextMutedBrush")]
    public void Label_and_brush_match_the_web_style_table(SourceLayer layer, string label, string brush)
    {
        Assert.Equal(label, SourceLayerBadgeRegistration.Label(layer));
        Assert.Equal(brush, SourceLayerBadgeRegistration.AccentBrushKey(layer));
    }

    // ── snapshot adapter (RepositoryResult → source layer) ─────────────────────────────────────────────────

    [Fact]
    public void FromResult_loading_has_no_source()
    {
        var snapshot = SourceLayerBadgeSnapshot.FromRepositoryResult(
            RepositoryResult<Sample>.Loading(),
            v => v.Source,
            v => v.Age);

        Assert.Null(snapshot.Source);
        Assert.Null(snapshot.AgeMs);
    }

    [Fact]
    public void FromResult_loaded_selects_the_source_and_age()
    {
        var snapshot = SourceLayerBadgeSnapshot.FromRepositoryResult(
            RepositoryResult<Sample>.Loaded(new Sample("l1", 450), DateTimeOffset.UnixEpoch),
            v => v.Source,
            v => v.Age);

        Assert.Equal("l1", snapshot.Source);
        Assert.Equal(450, snapshot.AgeMs);
    }

    [Fact]
    public void FromResult_offline_cached_selects_the_cached_source()
    {
        var error = new RepositoryError(RepositoryErrorKind.Network, "offline");
        var snapshot = SourceLayerBadgeSnapshot.FromRepositoryResult(
            RepositoryResult<Sample>.OfflineCached(new Sample("stale", 130_000), DateTimeOffset.UnixEpoch, error),
            v => v.Source,
            v => v.Age);

        Assert.Equal("stale", snapshot.Source);
        Assert.Equal(130_000, snapshot.AgeMs);
    }

    [Fact]
    public void FromResult_empty_and_failure_fall_back_to_the_unknown_badge()
    {
        var empty = SourceLayerBadgeSnapshot.FromRepositoryResult(
            RepositoryResult<Sample>.Empty(), v => v.Source, v => v.Age);
        var failure = SourceLayerBadgeSnapshot.FromRepositoryResult(
            RepositoryResult<Sample>.Failure(new RepositoryError(RepositoryErrorKind.Unknown, "boom")),
            v => v.Source,
            v => v.Age);

        Assert.Null(empty.Source);
        Assert.Null(failure.Source);
        Assert.Equal(SourceLayer.Unknown, Project(empty).Layer);
        Assert.Equal(SourceLayer.Unknown, Project(failure).Layer);
    }

    [Fact]
    public void FromResult_without_an_age_selector_keeps_age_null()
    {
        var snapshot = SourceLayerBadgeSnapshot.FromRepositoryResult(
            RepositoryResult<Sample>.Loaded(new Sample("log", 999), DateTimeOffset.UnixEpoch),
            v => v.Source);

        Assert.Equal("log", snapshot.Source);
        Assert.Null(snapshot.AgeMs);
    }

    [Fact]
    public void FromResult_throws_when_required_dependencies_are_null()
    {
        Assert.Throws<ArgumentNullException>(
            () => SourceLayerBadgeSnapshot.FromRepositoryResult<Sample>(null!, v => v.Source));
        Assert.Throws<ArgumentNullException>(
            () => SourceLayerBadgeSnapshot.FromRepositoryResult(
                RepositoryResult<Sample>.Loaded(new Sample("l1", null), DateTimeOffset.UnixEpoch), null!));
    }

    // ── projection: layer classification (web STYLE[key] ?? unknown) ───────────────────────────────────────

    [Theory]
    [InlineData("l1", SourceLayer.L1, "l1", "L1", "TsColorSuccessBrush")]
    [InlineData("l2", SourceLayer.L2, "l2", "L2", "TsColorInfoBrush")]
    [InlineData("log", SourceLayer.Log, "log", "LOG", "TsColorTextSecondaryBrush")]
    [InlineData("stale", SourceLayer.Stale, "stale", "STALE", "TsColorWarningBrush")]
    public void Projection_classifies_each_known_layer(string source, SourceLayer layer, string token, string label, string brush)
    {
        var projection = Project(SourceLayerBadgeSnapshot.Of(source));

        Assert.Equal(layer, projection.Layer);
        Assert.Equal(token, projection.SourceToken);
        Assert.Equal(label, projection.Label);
        Assert.Equal(brush, projection.AccentBrushKey);
    }

    [Fact]
    public void Projection_uppercase_source_lowercases_the_token_like_the_web()
    {
        var projection = Project(SourceLayerBadgeSnapshot.Of("L1"));

        Assert.Equal(SourceLayer.L1, projection.Layer);
        Assert.Equal("l1", projection.SourceToken);
        Assert.Equal("L1", projection.Label);
    }

    [Fact]
    public void Projection_null_source_is_the_unknown_em_dash_badge()
    {
        var projection = Project(SourceLayerBadgeSnapshot.Empty);

        Assert.Equal(SourceLayer.Unknown, projection.Layer);
        Assert.Equal("unknown", projection.SourceToken);
        Assert.Equal("\u2014", projection.Label);
        Assert.Equal("TsColorTextMutedBrush", projection.AccentBrushKey);
        Assert.Equal(UnknownDesc, projection.Tooltip);
    }

    [Fact]
    public void Projection_unrecognized_source_renders_unknown_but_preserves_the_raw_token()
    {
        // web: STYLE['foo'] is undefined → unknown label '—', but data-source stays the lowercased raw 'foo'.
        var projection = Project(SourceLayerBadgeSnapshot.Of("FOO"));

        Assert.Equal(SourceLayer.Unknown, projection.Layer);
        Assert.Equal("foo", projection.SourceToken);
        Assert.Equal("\u2014", projection.Label);
    }

    // ── projection: relative age (web formatAge) + tooltip composition ─────────────────────────────────────

    [Theory]
    [InlineData(450.0, "450 ms")]
    [InlineData(3200.0, "3.2 s")]
    [InlineData(300_000.0, "5 min")]
    [InlineData(5_400_000.0, "1.5 h")]
    [InlineData(172_800_000.0, "2.0 d")]
    public void Projection_age_text_matches_the_formatAge_tiers(double ageMs, string expected) =>
        Assert.Equal(expected, Project(new SourceLayerBadgeSnapshot("l1", ageMs)).AgeText);

    [Fact]
    public void Projection_tooltip_without_age_is_just_the_description()
    {
        var projection = Project(SourceLayerBadgeSnapshot.Of("l2"));

        Assert.Null(projection.AgeText);
        Assert.Equal(L2Desc, projection.Tooltip);
    }

    [Fact]
    public void Projection_tooltip_with_age_appends_the_age_clause()
    {
        var projection = Project(new SourceLayerBadgeSnapshot("l2", 3200));

        Assert.Equal("3.2 s", projection.AgeText);
        Assert.Equal($"{L2Desc} (age: 3.2 s)", projection.Tooltip);
    }

    // ── projection: show-label min-width (web min-w) ───────────────────────────────────────────────────────

    [Fact]
    public void Projection_show_label_widens_the_badge()
    {
        Assert.False(Project(SourceLayerBadgeSnapshot.Of("l1"), showLabel: false).ShowLabel);
        Assert.Equal(24, Project(SourceLayerBadgeSnapshot.Of("l1"), showLabel: false).MinWidth);

        Assert.True(Project(SourceLayerBadgeSnapshot.Of("l1"), showLabel: true).ShowLabel);
        Assert.Equal(40, Project(SourceLayerBadgeSnapshot.Of("l1"), showLabel: true).MinWidth);
    }

    // ── projection: accessible name, equality, guards, localizer routing ───────────────────────────────────

    [Fact]
    public void Projection_automation_name_is_the_composed_tooltip_for_every_state()
    {
        Assert.Equal(L1Desc, Project(SourceLayerBadgeSnapshot.Of("l1")).AutomationName);
        Assert.Equal($"{StaleDesc} (age: 5 min)", Project(new SourceLayerBadgeSnapshot("stale", 300_000)).AutomationName);
        Assert.Equal(UnknownDesc, Project(SourceLayerBadgeSnapshot.Empty).AutomationName);
        Assert.False(string.IsNullOrEmpty(Project(SourceLayerBadgeSnapshot.Of("log")).AutomationName));
    }

    [Fact]
    public void Projection_value_equality_makes_identical_states_equal()
    {
        var a = Project(new SourceLayerBadgeSnapshot("l1", 450));
        var b = Project(new SourceLayerBadgeSnapshot("l1", 450));
        var different = Project(new SourceLayerBadgeSnapshot("l2", 450));

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    [Fact]
    public void Project_throws_when_dependencies_are_null()
    {
        Assert.Throws<ArgumentNullException>(() => SourceLayerBadgeProjection.Project(null!, false, Localizer));
        Assert.Throws<ArgumentNullException>(
            () => SourceLayerBadgeProjection.Project(SourceLayerBadgeSnapshot.Of("l1"), false, null!));
    }

    [Fact]
    public void Projection_resolves_strings_through_the_localizer()
    {
        var localizer = new StubLocalizer(new Dictionary<string, string>
        {
            [SourceLayerBadgeRegistration.DescriptionKey(SourceLayer.L1)] = "depuis le SignalStore",
            [SourceLayerBadgeRegistration.AgeKey] = "âge",
        });

        var projection = Project(new SourceLayerBadgeSnapshot("l1", 450), localizer: localizer);

        Assert.Equal("depuis le SignalStore (âge: 450 ms)", projection.Tooltip);
    }

    // ── view-model (state holder) ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("SourceLayerBadge", SourceLayerBadgeViewModel.Slug);

    [Fact]
    public void ViewModel_starts_from_the_source_sample()
    {
        var source = new StaticSourceLayerBadgeSource(SourceLayerBadgeSnapshot.Of("stale"));
        using var viewModel = new SourceLayerBadgeViewModel(Localizer, source);

        Assert.Equal(SourceLayer.Stale, viewModel.Layer);
        Assert.Equal("STALE", viewModel.Label);
        Assert.Equal("stale", viewModel.SourceToken);
        Assert.Equal(StaleDesc, viewModel.Tooltip);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_sample_changes()
    {
        var source = new StaticSourceLayerBadgeSource(SourceLayerBadgeSnapshot.Empty);
        using var viewModel = new SourceLayerBadgeViewModel(Localizer, source);
        var changes = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changes.Add(e.PropertyName);

        source.Set(SourceLayerBadgeSnapshot.Of("l1"));

        Assert.Equal(SourceLayer.L1, viewModel.Layer);
        Assert.Contains(nameof(SourceLayerBadgeViewModel.Projection), changes);
    }

    [Fact]
    public void ViewModel_show_label_widens_the_badge()
    {
        var source = new StaticSourceLayerBadgeSource(SourceLayerBadgeSnapshot.Of("l1"));
        using var viewModel = new SourceLayerBadgeViewModel(Localizer, source, showLabel: true);

        Assert.True(viewModel.ShowLabel);
        Assert.Equal(40, viewModel.MinWidth);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_source()
    {
        var source = new StaticSourceLayerBadgeSource(SourceLayerBadgeSnapshot.Of("l1"));
        var viewModel = new SourceLayerBadgeViewModel(Localizer, source);

        viewModel.Dispose();

        var raised = false;
        viewModel.PropertyChanged += (_, _) => raised = true;
        source.Set(SourceLayerBadgeSnapshot.Of("stale"));

        Assert.False(raised);
        Assert.Equal(SourceLayer.L1, viewModel.Layer);
    }

    [Fact]
    public void ViewModel_throws_when_dependencies_are_null()
    {
        var source = new StaticSourceLayerBadgeSource(SourceLayerBadgeSnapshot.Empty);
        Assert.Throws<ArgumentNullException>(() => new SourceLayerBadgeViewModel(null!, source));
        Assert.Throws<ArgumentNullException>(() => new SourceLayerBadgeViewModel(Localizer, null!));
    }

    // ── sources (P1/S8 seam) ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void StaticSource_set_raises_changed()
    {
        var source = new StaticSourceLayerBadgeSource(SourceLayerBadgeSnapshot.Of("l1"));
        var changes = 0;
        source.Changed += (_, _) => changes++;

        source.Set(SourceLayerBadgeSnapshot.Of("l2"));

        Assert.Equal("l2", source.Current.Source);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void StaticSource_throws_on_null_inputs()
    {
        Assert.Throws<ArgumentNullException>(() => new StaticSourceLayerBadgeSource(null!));
        var source = new StaticSourceLayerBadgeSource(SourceLayerBadgeSnapshot.Empty);
        Assert.Throws<ArgumentNullException>(() => source.Set(null!));
    }

    [Fact]
    public void RepositorySource_streams_a_cache_then_network_read_into_the_sample()
    {
        using var source = new RepositorySourceLayerBadgeSource<Sample>(
            _ => Stream(
                RepositoryResult<Sample>.Loading(),
                RepositoryResult<Sample>.Cached(new Sample("l2", 130_000), DateTimeOffset.UnixEpoch, stale: true),
                RepositoryResult<Sample>.Loaded(new Sample("l1", 450), DateTimeOffset.UnixEpoch)),
            selectSource: v => v.Source,
            selectAgeMs: v => v.Age);

        Assert.True(WaitUntil(() => source.Current.Source == "l1" && source.Current.AgeMs == 450));
    }

    [Fact]
    public void RepositorySource_throws_when_required_dependencies_are_null()
    {
        Assert.Throws<ArgumentNullException>(
            () => new RepositorySourceLayerBadgeSource<Sample>(null!, v => v.Source));
        Assert.Throws<ArgumentNullException>(
            () => new RepositorySourceLayerBadgeSource<Sample>(_ => Stream(RepositoryResult<Sample>.Loading()), null!));
    }

    // ── diagnostics (view.opened, PII-safe — only the slug) ────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SourceLayerBadgeDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SourceLayerBadge", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new SourceLayerBadgeDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    private static async IAsyncEnumerable<RepositoryResult<Sample>> Stream(params RepositoryResult<Sample>[] items)
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
}
