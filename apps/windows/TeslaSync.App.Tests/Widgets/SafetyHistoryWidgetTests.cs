using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the SafetyHistoryWidget's UI-thread-free logic — the JSON parse adapter
/// (the useSafetyHistory read with polymorphic ADAS fields), the safetyEnum.ts port (clean + active),
/// the first-match classification, the subtitle builder, the 30-day total / stable most-common /
/// 30-vs-60-day trend stats, the compact one-liner, the newest-first feed cap, the result mapper, the
/// per-vehicle data source (primary resolution + the query-scoped safety read against
/// <c>get_api_v1_safety</c>), the registry metadata, the diagnostics, the Narrator names, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / error / stale / offline).
/// Mirrors the web spec (web/src/features/dashboard/widgets/SafetyHistoryWidget.tsx).
/// </summary>
public sealed class SafetyHistoryWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 8, 12, 0, 0, TimeSpan.Zero);

    private static string DaysAgo(double days) => Now.AddDays(-days).ToString("O", CultureInfo.InvariantCulture);

    private static SafetySnapshot Snap(
        string? createdAt = null,
        bool? aeb = null,
        bool? bsw = null,
        bool? elda = null,
        bool? pin = null,
        SafetyValue fcw = default,
        SafetyValue lane = default,
        SafetyValue speed = default,
        SafetyValue follow = default,
        long? id = null)
        => new(id, aeb, bsw, elda, pin, fcw, lane, speed, follow, createdAt);

    private static IReadOnlyList<SafetySnapshot> Snaps(params SafetySnapshot[] rows) => rows;

    private static SafetyHistoryDisplay Project(IReadOnlyList<SafetySnapshot> snapshots, int cols = 2, int rows = 4) =>
        SafetyHistoryProjection.Project(snapshots, new SafetyHistorySize(cols, rows), Localizer, Now);

    // ---- Parse adapter (web useSafetyHistory read) ---------------------------------

    [Fact]
    public void FromJson_reads_strict_bools_polymorphic_enums_and_timestamp()
    {
        using var doc = JsonDocument.Parse(
            """
            {
              "id": 7,
              "automatic_emergency_braking_off": true,
              "blind_spot_collision_warning": false,
              "forward_collision_warning": "ForwardCollisionSensitivityHigh",
              "cruise_follow_distance": 3,
              "pin_to_drive_enabled": true,
              "created_at": "2026-06-08T11:00:00Z"
            }
            """);

        var snap = SafetySnapshot.FromJson(doc.RootElement);

        Assert.Equal(7, snap.Id);
        Assert.True(snap.AutomaticEmergencyBrakingOff);
        Assert.False(snap.BlindSpotCollisionWarning);
        Assert.Equal(SafetyValueKind.Str, snap.ForwardCollisionWarning.Kind);
        Assert.Equal("ForwardCollisionSensitivityHigh", snap.ForwardCollisionWarning.StringValue);
        Assert.Equal(SafetyValueKind.Number, snap.CruiseFollowDistance.Kind);
        Assert.Equal(3, snap.CruiseFollowDistance.NumberValue);
        Assert.True(snap.PinToDriveEnabled);
        Assert.NotNull(snap.CreatedAtTime);
    }

    [Fact]
    public void FromJson_treats_missing_and_null_fields_as_absent()
    {
        using var doc = JsonDocument.Parse("""{"forward_collision_warning":null}""");

        var snap = SafetySnapshot.FromJson(doc.RootElement);

        Assert.Null(snap.Id);
        Assert.Null(snap.AutomaticEmergencyBrakingOff);
        Assert.Equal(SafetyValueKind.None, snap.ForwardCollisionWarning.Kind);
        Assert.False(snap.ForwardCollisionWarning.IsPresent);
        Assert.Null(snap.CreatedAt);
        Assert.Null(snap.CreatedAtTime);
    }

    [Fact]
    public void ParseList_reads_array_in_order_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse("""[{"id":1}, 7, {"id":2}]""");

        var list = SafetySnapshot.ParseList(doc.RootElement);

        Assert.Equal(2, list.Count);
        Assert.Equal(1, list[0].Id);
        Assert.Equal(2, list[1].Id);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("""{"id":1}""");
        Assert.Empty(SafetySnapshot.ParseList(doc.RootElement));
    }

    // ---- SafetyValue raw stringification (web String()) ----------------------------

    [Fact]
    public void SafetyValue_raw_string_mirrors_js_String_coercion()
    {
        Assert.Equal("true", SafetyValue.OfBool(true).AsRawString());
        Assert.Equal("false", SafetyValue.OfBool(false).AsRawString());
        Assert.Equal("3", SafetyValue.OfNumber(3).AsRawString());
        Assert.Equal("2.5", SafetyValue.OfNumber(2.5).AsRawString());
        Assert.Equal("FollowDistance2", SafetyValue.OfString("FollowDistance2").AsRawString());
    }

    // ---- safetyEnum.ts port: Clean -------------------------------------------------

    [Fact]
    public void Clean_renders_booleans_as_on_off()
    {
        Assert.Equal("On", SafetyEnums.Clean(SafetyValue.OfBool(true), SafetyEnumField.ForwardCollisionWarning, "On", "Off", "—"));
        Assert.Equal("Off", SafetyEnums.Clean(SafetyValue.OfBool(false), SafetyEnumField.ForwardCollisionWarning, "On", "Off", "—"));
    }

    [Fact]
    public void Clean_strips_the_field_prefix()
    {
        Assert.Equal(
            "High",
            SafetyEnums.Clean(SafetyValue.OfString("ForwardCollisionSensitivityHigh"), SafetyEnumField.ForwardCollisionWarning, "On", "Off", "—"));
        Assert.Equal(
            "2",
            SafetyEnums.Clean(SafetyValue.OfString("LaneAssistLevel2"), SafetyEnumField.LaneDepartureAvoidance, "On", "Off", "—"));
    }

    [Fact]
    public void Clean_maps_speed_assist_none_suffix_to_off()
    {
        Assert.Equal(
            "Off",
            SafetyEnums.Clean(SafetyValue.OfString("SpeedAssistLevelNone"), SafetyEnumField.SpeedLimitWarning, "On", "Off", "—"));
    }

    [Fact]
    public void Clean_passes_numbers_and_falls_back_for_absent()
    {
        Assert.Equal("3", SafetyEnums.Clean(SafetyValue.OfNumber(3), SafetyEnumField.CruiseFollowDistance, "On", "Off", "—"));
        Assert.Equal("—", SafetyEnums.Clean(SafetyValue.None, SafetyEnumField.ForwardCollisionWarning, "On", "Off", "—"));
    }

    // ---- safetyEnum.ts port: IsActive ----------------------------------------------

    [Theory]
    [InlineData("ForwardCollisionSensitivityHigh", true)]
    [InlineData("ForwardCollisionSensitivityOff", false)]
    [InlineData("None", false)]
    [InlineData("Disabled", false)]
    public void IsActive_classifies_strings(string raw, bool expected) =>
        Assert.Equal(expected, SafetyEnums.IsActive(SafetyValue.OfString(raw), SafetyEnumField.ForwardCollisionWarning));

    [Fact]
    public void IsActive_classifies_bools_and_numbers_and_absent()
    {
        Assert.True(SafetyEnums.IsActive(SafetyValue.OfBool(true), SafetyEnumField.ForwardCollisionWarning));
        Assert.False(SafetyEnums.IsActive(SafetyValue.OfBool(false), SafetyEnumField.ForwardCollisionWarning));
        Assert.True(SafetyEnums.IsActive(SafetyValue.OfNumber(3), SafetyEnumField.CruiseFollowDistance));
        Assert.False(SafetyEnums.IsActive(SafetyValue.OfNumber(0), SafetyEnumField.CruiseFollowDistance));
        Assert.False(SafetyEnums.IsActive(SafetyValue.None, SafetyEnumField.ForwardCollisionWarning));
    }

    // ---- Classification (web classifySnapshot, first match wins) -------------------

    [Fact]
    public void Classify_prefers_aeb_over_every_other_signal()
    {
        var snap = Snap(aeb: true, fcw: SafetyValue.OfString("ForwardCollisionSensitivityHigh"), bsw: true);
        Assert.Equal(SafetyEventKind.Aeb, SafetyHistoryProjection.Classify(snap));
    }

    [Fact]
    public void Classify_resolves_each_branch_in_order()
    {
        Assert.Equal(SafetyEventKind.Fcw, SafetyHistoryProjection.Classify(
            Snap(fcw: SafetyValue.OfString("ForwardCollisionSensitivityHigh"))));
        Assert.Equal(SafetyEventKind.Lane, SafetyHistoryProjection.Classify(
            Snap(lane: SafetyValue.OfString("LaneAssistLevel2"))));
        Assert.Equal(SafetyEventKind.Bsw, SafetyHistoryProjection.Classify(Snap(bsw: true)));
        Assert.Equal(SafetyEventKind.Elda, SafetyHistoryProjection.Classify(Snap(elda: true)));
        Assert.Equal(SafetyEventKind.General, SafetyHistoryProjection.Classify(Snap()));
    }

    [Fact]
    public void Classify_ignores_inactive_enum_values()
    {
        // A disabled FCW (string "...Off") falls through to General, never FCW.
        Assert.Equal(SafetyEventKind.General, SafetyHistoryProjection.Classify(
            Snap(fcw: SafetyValue.OfString("ForwardCollisionSensitivityOff"))));
    }

    [Fact]
    public void Presentation_maps_each_kind_to_a_glyph_and_brush()
    {
        Assert.Equal("TsColorDangerBrush", SafetyHistoryProjection.Presentation(SafetyEventKind.Aeb).AccentBrushKey);
        Assert.Equal("TsColorWarningBrush", SafetyHistoryProjection.Presentation(SafetyEventKind.Fcw).AccentBrushKey);
        Assert.Equal("TsColorInfoBrush", SafetyHistoryProjection.Presentation(SafetyEventKind.Lane).AccentBrushKey);
        Assert.Equal("TsColorWarningBrush", SafetyHistoryProjection.Presentation(SafetyEventKind.Bsw).AccentBrushKey);
        Assert.Equal("TsColorDangerBrush", SafetyHistoryProjection.Presentation(SafetyEventKind.Elda).AccentBrushKey);
        Assert.Equal("TsColorTextSecondaryBrush", SafetyHistoryProjection.Presentation(SafetyEventKind.General).AccentBrushKey);
        Assert.Equal(SeverityLevel.Critical, SafetyHistoryProjection.Presentation(SafetyEventKind.Aeb).Severity);
        Assert.Equal(SeverityLevel.Info, SafetyHistoryProjection.Presentation(SafetyEventKind.General).Severity);
    }

    // ---- Subtitle (web buildSubtitle) ----------------------------------------------

    [Fact]
    public void Subtitle_joins_present_parts_with_a_middle_dot()
    {
        var snap = Snap(
            speed: SafetyValue.OfNumber(3),
            follow: SafetyValue.OfString("FollowDistance2"),
            pin: true);

        Assert.Equal("Speed Limit: 3 \u00B7 Follow: FollowDistance2 \u00B7 PIN to Drive",
            SafetyHistoryProjection.Subtitle(snap, Localizer));
    }

    [Fact]
    public void Subtitle_omits_pin_when_false_and_em_dashes_when_empty()
    {
        Assert.Equal("Speed Limit: 5", SafetyHistoryProjection.Subtitle(Snap(speed: SafetyValue.OfNumber(5), pin: false), Localizer));
        Assert.Equal("\u2014", SafetyHistoryProjection.Subtitle(Snap(), Localizer));
    }

    [Fact]
    public void Subtitle_stringifies_raw_values_without_cleaning()
    {
        // Web parity: buildSubtitle uses String(value), so a boolean speed-limit renders "false".
        Assert.Equal("Speed Limit: false", SafetyHistoryProjection.Subtitle(Snap(speed: SafetyValue.OfBool(false)), Localizer));
    }

    // ---- Projection: 30-day total + trend ------------------------------------------

    [Fact]
    public void Project_counts_only_the_last_30_days_as_total()
    {
        var view = Project(Snaps(
            Snap(createdAt: DaysAgo(5)),
            Snap(createdAt: DaysAgo(20)),
            Snap(createdAt: DaysAgo(45)),   // prior window — not counted in total
            Snap(createdAt: DaysAgo(90)),   // older than 60 days — ignored
            Snap(createdAt: null)));        // unparseable — ignored

        Assert.Equal(2, view.TotalEvents);
    }

    [Fact]
    public void Project_trend_rises_falls_and_flattens_against_the_prior_window()
    {
        // recent=2 (5d,20d), prior=1 (45d) -> increasing.
        var up = Project(Snaps(Snap(createdAt: DaysAgo(5)), Snap(createdAt: DaysAgo(20)), Snap(createdAt: DaysAgo(45))));
        Assert.Equal(SafetyHistoryProjection.TrendUp, up.Trend);

        // recent=1 (5d), prior=2 (40d,50d) -> decreasing.
        var down = Project(Snaps(Snap(createdAt: DaysAgo(5)), Snap(createdAt: DaysAgo(40)), Snap(createdAt: DaysAgo(50))));
        Assert.Equal(SafetyHistoryProjection.TrendDown, down.Trend);

        // recent=1 (5d), prior=1 (45d) -> stable.
        var flat = Project(Snaps(Snap(createdAt: DaysAgo(5)), Snap(createdAt: DaysAgo(45))));
        Assert.Equal(SafetyHistoryProjection.TrendFlat, flat.Trend);
    }

    [Fact]
    public void Project_trend_is_em_dash_when_no_prior_window_data()
    {
        var view = Project(Snaps(Snap(createdAt: DaysAgo(5)), Snap(createdAt: DaysAgo(10))));
        Assert.Equal(SafetyHistoryProjection.TrendNone, view.Trend);
    }

    // ---- Projection: most-common (stable, first-appearance tie-break) --------------

    [Fact]
    public void Project_most_common_picks_the_highest_count()
    {
        var view = Project(Snaps(
            Snap(createdAt: DaysAgo(1), bsw: true),
            Snap(createdAt: DaysAgo(2), bsw: true),
            Snap(createdAt: DaysAgo(3), aeb: true)));

        // Blind-spot occurs twice, AEB once.
        Assert.Equal("Blind Spot", view.MostCommon);
    }

    [Fact]
    public void Project_most_common_breaks_ties_by_first_appearance()
    {
        var laneFirst = Project(Snaps(
            Snap(createdAt: DaysAgo(1), lane: SafetyValue.OfString("LaneAssistLevel2")),
            Snap(createdAt: DaysAgo(2), bsw: true),
            Snap(createdAt: DaysAgo(3), lane: SafetyValue.OfString("LaneAssistLevel2")),
            Snap(createdAt: DaysAgo(4), bsw: true)));

        // Lane and Blind-spot both occur twice; Lane appears first, so it wins.
        Assert.Equal("Lane Departure", laneFirst.MostCommon);
    }

    [Fact]
    public void Project_most_common_is_em_dash_without_recent_events()
    {
        var view = Project(Snaps(Snap(createdAt: DaysAgo(45))));
        Assert.Equal("\u2014", view.MostCommon);
        Assert.Equal(0, view.TotalEvents);
    }

    // ---- Projection: compact one-liner ---------------------------------------------

    [Fact]
    public void Project_compact_primary_summarises_the_count_when_there_are_recent_events()
    {
        // recent=2 (2d,3d), prior=2 (40d,50d) -> stable trend marker; most-common = Blind Spot.
        var view = Project(Snaps(
            Snap(createdAt: DaysAgo(2), bsw: true),
            Snap(createdAt: DaysAgo(3), bsw: true),
            Snap(createdAt: DaysAgo(40), bsw: true),
            Snap(createdAt: DaysAgo(50), bsw: true)), cols: 1);

        Assert.True(view.IsCompact);
        Assert.Equal("2 events (30d)", view.CompactPrimary);
        Assert.Equal("Blind Spot \u2192", view.CompactSecondary);
    }

    [Fact]
    public void Project_compact_primary_shows_no_events_when_30d_is_empty()
    {
        // A snapshot exists (list not empty) but it is outside the 30-day window.
        var view = Project(Snaps(Snap(createdAt: DaysAgo(45))), cols: 1);

        Assert.True(view.HasSnapshots);
        Assert.Equal("No safety events", view.CompactPrimary);
        Assert.Null(view.CompactSecondary);
    }

    [Fact]
    public void Project_has_snapshots_tracks_the_source_list()
    {
        Assert.False(Project(Snaps()).HasSnapshots);
        Assert.True(Project(Snaps(Snap(createdAt: DaysAgo(1)))).HasSnapshots);
    }

    [Fact]
    public void Project_is_compact_tracks_single_column()
    {
        Assert.True(Project(Snaps(Snap(createdAt: DaysAgo(1))), cols: 1).IsCompact);
        Assert.False(Project(Snaps(Snap(createdAt: DaysAgo(1))), cols: 2).IsCompact);
    }

    // ---- Projection: standard stat cards -------------------------------------------

    [Fact]
    public void Project_builds_three_stat_cards_with_localized_labels()
    {
        var view = Project(Snaps(
            Snap(createdAt: DaysAgo(2), bsw: true),
            Snap(createdAt: DaysAgo(40))));

        Assert.Equal(3, view.Stats.Count);
        Assert.Equal("Events (30d)", view.Stats[0].Label);
        Assert.Equal("1", view.Stats[0].Value);
        Assert.Equal("Most Common", view.Stats[1].Label);
        Assert.Equal("Blind Spot", view.Stats[1].Value);
        Assert.Equal("Trend", view.Stats[2].Label);
        // recent=1, prior=1 -> stable.
        Assert.Equal(SafetyHistoryProjection.TrendFlat, view.Stats[2].Value);
        Assert.Equal("Stable", view.Stats[2].Sublabel);
    }

    [Fact]
    public void Project_trend_sublabel_tracks_the_marker()
    {
        var up = Project(Snaps(Snap(createdAt: DaysAgo(1)), Snap(createdAt: DaysAgo(2)), Snap(createdAt: DaysAgo(45))));
        Assert.Equal("Increasing", up.Stats[2].Sublabel);

        var down = Project(Snaps(Snap(createdAt: DaysAgo(1)), Snap(createdAt: DaysAgo(40)), Snap(createdAt: DaysAgo(50))));
        Assert.Equal("Decreasing", down.Stats[2].Sublabel);
    }

    // ---- Projection: event feed (newest first, capped, classified) -----------------

    [Fact]
    public void Project_feed_sorts_newest_first()
    {
        var view = Project(Snaps(
            Snap(createdAt: DaysAgo(3), aeb: true),
            Snap(createdAt: DaysAgo(1), bsw: true),
            Snap(createdAt: DaysAgo(2), elda: true)));

        Assert.Equal(SafetyEventKind.Bsw, view.Rows[0].Kind);
        Assert.Equal(SafetyEventKind.Elda, view.Rows[1].Kind);
        Assert.Equal(SafetyEventKind.Aeb, view.Rows[2].Kind);
    }

    [Fact]
    public void Project_feed_caps_at_ten_rows()
    {
        var rows = new SafetySnapshot[15];
        for (int i = 0; i < rows.Length; i++)
        {
            rows[i] = Snap(createdAt: DaysAgo(i + 1), bsw: true);
        }

        Assert.Equal(SafetyHistoryProjection.FeedMaxItems, Project(rows).Rows.Count);
    }

    [Fact]
    public void Project_feed_titles_and_subtitles_are_localized()
    {
        var view = Project(Snaps(Snap(
            createdAt: DaysAgo(1),
            fcw: SafetyValue.OfString("ForwardCollisionSensitivityHigh"),
            speed: SafetyValue.OfNumber(2))));

        var row = Assert.Single(view.Rows);
        Assert.Equal("FCW: High", row.Title);
        Assert.Equal("Speed Limit: 2", row.Subtitle);
        Assert.Equal(SafetyHistoryProjection.ShieldGlyph, row.Glyph);
    }

    // ---- Accessibility (Narrator names) --------------------------------------------

    [Fact]
    public void Project_rows_and_stats_and_compact_carry_automation_names()
    {
        var standard = Project(Snaps(Snap(createdAt: DaysAgo(1), bsw: true)));
        Assert.All(standard.Rows, row => Assert.False(string.IsNullOrWhiteSpace(row.AutomationName)));
        Assert.All(standard.Stats, stat => Assert.False(string.IsNullOrWhiteSpace(stat.AutomationName)));

        var compact = Project(Snaps(Snap(createdAt: DaysAgo(1), bsw: true)), cols: 1);
        Assert.False(string.IsNullOrWhiteSpace(compact.CompactAutomationName));
        Assert.Contains(compact.CompactPrimary, compact.CompactAutomationName, StringComparison.Ordinal);
    }

    // ---- Result mapper (parse + preserve status) -----------------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_rows()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"automatic_emergency_braking_off":true}]""");

        var cached = SafetyHistoryResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(1, Assert.Single(cached.Value!).Id);

        var offline = SafetyHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void Mapper_maps_loaded_and_empty_and_failure()
    {
        using var doc = JsonDocument.Parse("""[{"id":1}]""");

        Assert.Equal(LoadStatus.Loaded, SafetyHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Empty, SafetyHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now)).Status);

        Assert.Equal(LoadStatus.Error, SafetyHistoryResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SafetySnapshot>>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SafetyHistoryState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_stats_and_feed()
    {
        using var vm = NewViewModel(Loaded(Snaps(
            Snap(createdAt: DaysAgo(1), bsw: true),
            Snap(createdAt: DaysAgo(2), bsw: true))));
        await vm.LoadAsync();

        Assert.Equal(SafetyHistoryState.Loaded, vm.State);
        Assert.True(vm.Display.HasSnapshots);
        Assert.Equal(2, vm.Display.TotalEvents);
        Assert.Equal(2, vm.Display.Rows.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_with_no_recent_events_stays_loaded()
    {
        // The list is non-empty (web list.length > 0) even though nothing falls in the 30-day window.
        using var vm = NewViewModel(Loaded(Snaps(Snap(createdAt: DaysAgo(45), bsw: true))));
        await vm.LoadAsync();

        Assert.Equal(SafetyHistoryState.Loaded, vm.State);
        Assert.True(vm.Display.HasSnapshots);
        Assert.Equal(0, vm.Display.TotalEvents);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SafetySnapshot>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SafetyHistoryState.Empty, vm.State);
        Assert.False(vm.Display.HasSnapshots);
        Assert.Equal("No safety events recorded", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_loaded_empty_list_renders_empty()
    {
        using var vm = NewViewModel(Loaded(Snaps()));
        await vm.LoadAsync();

        Assert.Equal(SafetyHistoryState.Empty, vm.State);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<SafetySnapshot>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SafetyHistoryState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<SafetySnapshot>>.Cached(Snaps(Snap(createdAt: DaysAgo(1), bsw: true)), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SafetyHistoryState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.Display.HasSnapshots);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SafetySnapshot>>.OfflineCached(
            Snaps(Snap(createdAt: DaysAgo(1), bsw: true)), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SafetyHistoryState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<IReadOnlyList<SafetySnapshot>>.Loading(),
            RepositoryResult<IReadOnlyList<SafetySnapshot>>.Cached(Snaps(Snap(createdAt: DaysAgo(2), bsw: true)), Now, stale: false),
            RepositoryResult<IReadOnlyList<SafetySnapshot>>.Loaded(Snaps(Snap(createdAt: DaysAgo(1), bsw: true), Snap(createdAt: DaysAgo(2), bsw: true)), Now));
        await vm.LoadAsync();

        Assert.Equal(SafetyHistoryState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.TotalEvents);
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(new SafetyHistorySize(2, 4), Loaded(Snaps(Snap(createdAt: DaysAgo(1), bsw: true))));
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new SafetyHistorySize(1, 4);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(SafetyHistoryState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<IReadOnlyList<SafetySnapshot>>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal("Safety History", vm.Title);
        Assert.Equal("No safety events recorded", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Snaps(Snap(createdAt: DaysAgo(1), bsw: true))));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SafetyHistoryViewModel.State), changed);
        Assert.Contains(nameof(SafetyHistoryViewModel.Display), changed);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("safety-history", SafetyHistoryRegistration.Id);
        Assert.Equal("security", SafetyHistoryRegistration.Category);
        Assert.Equal("SafetyHistoryWidget", SafetyHistoryRegistration.Slug);
        Assert.Equal(new SafetyHistorySize(2, 4), SafetyHistoryRegistration.DefaultSize);
        Assert.Equal(new SafetyHistorySize(2, 4), SafetyHistoryRegistration.MinSize);
        Assert.Equal(new SafetyHistorySize(4, 40), SafetyHistoryRegistration.MaxSize);
        Assert.Equal("Safety History", SafetyHistoryRegistration.Name(Localizer));
        Assert.Equal(
            "ADAS event timeline: collision warnings, AEB, lane departures, disengagements",
            SafetyHistoryRegistration.Description(Localizer));
    }

    [Theory]
    [InlineData(2, 4, true)]    // min
    [InlineData(4, 40, true)]   // max
    [InlineData(3, 10, true)]   // inside
    [InlineData(1, 4, false)]   // below min cols
    [InlineData(5, 40, false)]  // above max cols
    [InlineData(2, 3, false)]   // below min rows
    [InlineData(2, 41, false)]  // above max rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, SafetyHistoryRegistration.IsWithinBounds(new SafetyHistorySize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new SafetyHistorySize(2, 4), SafetyHistoryRegistration.Clamp(new SafetyHistorySize(0, 0)));
        Assert.Equal(new SafetyHistorySize(4, 40), SafetyHistoryRegistration.Clamp(new SafetyHistorySize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SafetyHistoryDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SafetyHistoryWidget", Assert.Single(lines));
    }

    // ---- Source (per-vehicle adapter) ----------------------------------------------

    [Fact]
    public void Source_operation_resolves_against_generated_endpoint_table()
    {
        Assert.Contains(GeneratedApi.ApiEndpoints.All, e => e.OperationId == "get_api_v1_safety");
    }

    [Fact]
    public async Task Source_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new SafetyHistorySource(
            new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_resolves_primary_vehicle_then_reads_safety()
    {
        using var doc = JsonDocument.Parse(
            """[{"id":1,"created_at":"2026-06-08T11:00:00Z","blind_spot_collision_warning":true}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new SafetyHistorySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions(), vehicleId: null);

        var results = await Drain(source);

        var terminal = results[^1];
        Assert.Equal(LoadStatus.Loaded, terminal.Status);
        Assert.Single(terminal.Value!);

        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_safety", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.True(request.PathParams is null || request.PathParams.Count == 0);
    }

    [Fact]
    public async Task Source_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"created_at":"2026-06-08T11:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new SafetyHistorySource(
            new FakeWidgetVehicleSource(null),
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await Drain(source);

        Assert.Equal(42L, Convert.ToInt64(api.Requests[^1].Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
    }

    [Fact]
    public async Task Source_empty_array_body_collapses_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new SafetyHistorySource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 3 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await Drain(source);

        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<SafetySnapshot>>>> Drain(ISafetyHistorySource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<SafetySnapshot>>>();
        await foreach (var result in source.StreamAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static RepositoryResult<IReadOnlyList<SafetySnapshot>> Loaded(IReadOnlyList<SafetySnapshot> snapshots) =>
        RepositoryResult<IReadOnlyList<SafetySnapshot>>.Loaded(snapshots, Now);

    private static SafetyHistoryViewModel NewViewModel(params RepositoryResult<IReadOnlyList<SafetySnapshot>>[] emissions) =>
        NewViewModel(SafetyHistorySize.Default, emissions);

    private static SafetyHistoryViewModel NewViewModel(
        SafetyHistorySize size,
        params RepositoryResult<IReadOnlyList<SafetySnapshot>>[] emissions) =>
        new(new FakeSafetyHistorySource(emissions), Localizer, size, () => Now);

    private sealed class FakeSafetyHistorySource(params RepositoryResult<IReadOnlyList<SafetySnapshot>>[] emissions) : ISafetyHistorySource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SafetySnapshot>>> StreamAsync(
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

    private sealed class FakeWidgetVehicleSource(WidgetVehicleSnapshot? primary) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(primary);
    }
}
