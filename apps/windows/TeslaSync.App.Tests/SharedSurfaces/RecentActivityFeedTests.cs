using System;
using System.Collections.Generic;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces.RecentActivityFeedSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>RecentActivityFeed</c> shared surface's UI-thread-free logic — the pure
/// projection (the empty-vs-loading-vs-populated decision, the empty-message fallback, the per-row glyph / i18n
/// title / subtitle / route composition, the accessible-name fallback), the action -> visual resolver
/// (web <c>getActivityVisual</c>), the entity -> route resolver (web <c>entityHref</c>), the cached-JSON adapter,
/// the data seam's change notifications, the view-model's state projection, the PII-safe diagnostics and the
/// registration metadata. The composition cases mirror the web source
/// (web/src/components/data-display/RecentActivityFeed.tsx). The WinUI view itself (the timeline rows, the empty
/// state, the loading skeleton, the link peers) is exercised by the app build.
/// </summary>
public sealed class RecentActivityFeedTests
{
    private static readonly ILocalizer L = PassthroughLocalizer.Instance;

    private static RecentActivityEntry Entry(
        string action = "vehicle.command.wake",
        string? entityType = null,
        string? entityId = null,
        string? detail = null,
        DateTimeOffset? timestamp = null,
        long id = 1) =>
        new(id, timestamp, action, entityType, entityId, detail);

    private static RecentActivityFeedDisplay Project(RecentActivityFeedInput input) =>
        RecentActivityFeedProjection.Project(input, L);

    private sealed class CapturingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    // ── Empty branch (web entries.length === 0, RecentActivityFeed.tsx L62-L70) ───────────────────────────

    [Fact]
    public void No_entries_resolves_to_the_empty_state()
    {
        var d = Project(new RecentActivityFeedInput());

        Assert.True(d.ShowEmptyState);
        Assert.False(d.ShowTimeline);
        Assert.False(d.ShowLoading);
        Assert.Equal(RecentActivityFeedPhase.Empty, d.Phase);
        Assert.Empty(d.Rows);
    }

    [Fact]
    public void Empty_list_is_treated_as_absent()
    {
        var d = Project(new RecentActivityFeedInput { Entries = Array.Empty<RecentActivityEntry>() });

        Assert.True(d.ShowEmptyState);
    }

    [Fact]
    public void Empty_message_defaults_to_the_web_key_when_not_overridden()
    {
        var d = Project(new RecentActivityFeedInput());

        Assert.Equal("No recent activity in this window.", d.EmptyMessage);
    }

    [Fact]
    public void Empty_message_override_is_used_verbatim()
    {
        var d = Project(new RecentActivityFeedInput { EmptyMessage = "Nothing in the last 24h" });

        Assert.Equal("Nothing in the last 24h", d.EmptyMessage);
    }

    [Fact]
    public void Empty_message_uses_the_history_glyph()
    {
        var d = Project(new RecentActivityFeedInput());

        Assert.Equal("\uE81C", d.EmptyGlyph);
        Assert.Equal(RecentActivityFeedRegistration.EmptyGlyph, d.EmptyGlyph);
    }

    // ── Loading branch (host first fetch in flight — skeleton, not a premature empty notice) ──────────────

    [Fact]
    public void Loading_with_no_entries_shows_the_skeleton()
    {
        var d = Project(new RecentActivityFeedInput { IsLoading = true });

        Assert.Equal(RecentActivityFeedPhase.Loading, d.Phase);
        Assert.True(d.ShowLoading);
        Assert.False(d.ShowEmptyState);
        Assert.False(d.ShowTimeline);
        Assert.Empty(d.Rows);
    }

    [Fact]
    public void Loading_with_entries_still_renders_the_timeline()
    {
        var d = Project(new RecentActivityFeedInput { IsLoading = true, Entries = new[] { Entry() } });

        Assert.Equal(RecentActivityFeedPhase.Populated, d.Phase);
        Assert.True(d.ShowTimeline);
        Assert.False(d.ShowLoading);
    }

    // ── Populated branch (web entries.map, RecentActivityFeed.tsx L72-L115) ───────────────────────────────

    [Fact]
    public void Single_entry_projects_one_row()
    {
        var d = Project(new RecentActivityFeedInput { Entries = new[] { Entry() } });

        Assert.Equal(RecentActivityFeedPhase.Populated, d.Phase);
        Assert.True(d.ShowTimeline);
        Assert.False(d.ShowEmptyState);
        var row = Assert.Single(d.Rows);
        Assert.Equal("Wake vehicle", row.Title);
        Assert.Equal("activity.action.vehicleCommandWake", row.TitleI18nKey);
        Assert.Equal("\uE7E8", row.Glyph);
        Assert.Null(row.Subtitle);
        Assert.Null(row.Route);
        Assert.False(row.HasRoute);
    }

    [Fact]
    public void Multiple_entries_round_trip_in_order()
    {
        var d = Project(new RecentActivityFeedInput
        {
            Entries = new[] { Entry(action: "auth.login", id: 1), Entry(action: "auth.logout", id: 2) },
        });

        Assert.Equal(2, d.Rows.Count);
        Assert.Equal("Signed in", d.Rows[0].Title);
        Assert.Equal("Signed out", d.Rows[1].Title);
    }

    [Fact]
    public void Row_with_entity_composes_subtitle_and_route()
    {
        var d = Project(new RecentActivityFeedInput
        {
            Entries = new[] { Entry(action: "vehicle.command.lock", entityType: "vehicle", entityId: "5") },
        });

        var row = Assert.Single(d.Rows);
        Assert.Equal("vehicle \u00b7 5", row.Subtitle);
        Assert.Equal("/vehicles/5", row.Route);
        Assert.True(row.HasRoute);
    }

    [Theory]
    [InlineData("vehicle", "7", "Note here", "vehicle \u00b7 7 \u2014 Note here")]
    [InlineData("vehicle", "7", null, "vehicle \u00b7 7")]
    [InlineData("vehicle", null, null, "vehicle")]
    [InlineData(null, null, "Only detail", "Only detail")]
    public void Subtitle_composition_mirrors_the_web_join(string? type, string? id, string? detail, string expected)
    {
        var d = Project(new RecentActivityFeedInput { Entries = new[] { Entry(entityType: type, entityId: id, detail: detail) } });

        Assert.Equal(expected, Assert.Single(d.Rows).Subtitle);
    }

    [Fact]
    public void Row_without_entity_or_detail_has_no_subtitle()
    {
        var d = Project(new RecentActivityFeedInput { Entries = new[] { Entry(entityType: null, entityId: null, detail: null) } });

        Assert.Null(Assert.Single(d.Rows).Subtitle);
    }

    [Fact]
    public void Row_accessible_name_appends_the_subtitle()
    {
        var withSub = Project(new RecentActivityFeedInput
        {
            Entries = new[] { Entry(action: "vehicle.command.lock", entityType: "vehicle", entityId: "5") },
        }).Rows[0];
        var withoutSub = Project(new RecentActivityFeedInput { Entries = new[] { Entry() } }).Rows[0];

        Assert.Equal("Lock vehicle, vehicle \u00b7 5", withSub.AccessibleName);
        Assert.Equal("Wake vehicle", withoutSub.AccessibleName);
    }

    [Fact]
    public void Display_accessible_name_is_the_first_row_when_populated()
    {
        var d = Project(new RecentActivityFeedInput { Entries = new[] { Entry(action: "auth.login"), Entry(action: "auth.logout") } });

        Assert.Equal("Signed in", d.AccessibleName);
    }

    [Fact]
    public void Display_accessible_name_is_the_empty_message_when_empty()
    {
        var d = Project(new RecentActivityFeedInput { EmptyMessage = "Nothing here" });

        Assert.Equal("Nothing here", d.AccessibleName);
    }

    [Fact]
    public void Every_populated_row_exposes_a_non_empty_accessible_name()
    {
        var d = Project(new RecentActivityFeedInput
        {
            Entries = new[]
            {
                Entry(action: "vehicle.command.wake"),
                Entry(action: "api_key.create", entityType: "api_key", entityId: "9"),
                Entry(action: "totally.unknown.action"),
            },
        });

        Assert.All(d.Rows, r => Assert.False(string.IsNullOrWhiteSpace(r.AccessibleName)));
    }

    // ── Projection argument validation ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_input() =>
        Assert.Throws<ArgumentNullException>(() => RecentActivityFeedProjection.Project(null!, L));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => RecentActivityFeedProjection.Project(new RecentActivityFeedInput(), null!));

    // ── Visuals resolver (web getActivityVisual, activityIcons.ts) ───────────────────────────────────────

    [Fact]
    public void Visuals_exact_match_resolves_the_descriptor()
    {
        var v = RecentActivityVisuals.Resolve("vehicle.command.wake");

        Assert.Equal("activity.action.vehicleCommandWake", v.I18nKey);
        Assert.Equal("Wake vehicle", v.Fallback);
        Assert.Equal("\uE7E8", v.Glyph);
    }

    [Fact]
    public void Visuals_walk_shrinking_prefixes()
    {
        // vehicle.command.steer is not registered → falls back to vehicle.command.
        var v = RecentActivityVisuals.Resolve("vehicle.command.steer");

        Assert.Equal("activity.action.vehicleCommand", v.I18nKey);
        Assert.Equal("Vehicle command", v.Fallback);
    }

    [Fact]
    public void Visuals_unknown_domain_resolves_the_generic_fallback()
    {
        var v = RecentActivityVisuals.Resolve("vehicle.unmapped");

        Assert.Equal("activity.action.unknown", v.I18nKey);
        Assert.Equal("Activity", v.Fallback);
        Assert.Equal("\uE81C", v.Glyph);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Visuals_blank_action_resolves_the_fallback(string? action)
    {
        var v = RecentActivityVisuals.Resolve(action);

        Assert.Equal("activity.action.unknown", v.I18nKey);
    }

    [Fact]
    public void Visuals_trims_the_action()
    {
        var v = RecentActivityVisuals.Resolve("  auth.login  ");

        Assert.Equal("activity.action.authLogin", v.I18nKey);
        Assert.Equal("Signed in", v.Fallback);
    }

    [Theory]
    [InlineData("vehicle.command.honk", "activity.action.vehicleCommandHonk", "Honk horn")]
    [InlineData("vehicle.command.unlock", "activity.action.vehicleCommandUnlock", "Unlock vehicle")]
    [InlineData("settings.update", "activity.action.settingsUpdate", "Settings updated")]
    [InlineData("alert.rule.delete", "activity.action.alertRuleDelete", "Alert rule deleted")]
    [InlineData("automation.create", "activity.action.automationCreate", "Automation created")]
    [InlineData("dashboard.layout.save", "activity.action.dashboardLayoutSave", "Dashboard layout saved")]
    [InlineData("data_export.create", "activity.action.dataExportCreate", "Data export requested")]
    [InlineData("api_key.delete", "activity.action.apiKeyDelete", "API key revoked")]
    [InlineData("auth.logout", "activity.action.authLogout", "Signed out")]
    public void Visuals_registry_entries_resolve(string action, string key, string fallback)
    {
        var v = RecentActivityVisuals.Resolve(action);

        Assert.Equal(key, v.I18nKey);
        Assert.Equal(fallback, v.Fallback);
        Assert.False(string.IsNullOrEmpty(v.Glyph));
    }

    // ── Route resolver (web entityHref, RecentActivityFeed.tsx L33-L57) ──────────────────────────────────

    [Theory]
    [InlineData("vehicle", "5", "/vehicles/5")]
    [InlineData("drive", "9", "/drives/9")]
    [InlineData("charging_session", "3", "/charging/3")]
    [InlineData("charge", "3", "/charging/3")]
    [InlineData("alert_rule", "7", "/notifications/alerts")]
    [InlineData("automation", "2", "/automations")]
    [InlineData("geofence", "1", "/geofences")]
    [InlineData("data_export", "4", "/data-export")]
    [InlineData("export", "4", "/data-export")]
    [InlineData("api_key", "8", "/api-keys")]
    public void Route_maps_known_entities(string type, string id, string expected) =>
        Assert.Equal(expected, RecentActivityRoute.For(type, id));

    [Theory]
    [InlineData("unknown", "5")]
    [InlineData(null, "5")]
    [InlineData("vehicle", null)]
    [InlineData("", "5")]
    [InlineData("vehicle", "")]
    public void Route_returns_null_for_unmapped_or_missing(string? type, string? id) =>
        Assert.Null(RecentActivityRoute.For(type, id));

    [Fact]
    public void Route_percent_encodes_the_id()
    {
        Assert.Equal("/vehicles/a%20b", RecentActivityRoute.For("vehicle", "a b"));
        Assert.Equal("/drives/x%2Fy", RecentActivityRoute.For("drive", "x/y"));
    }

    // ── Cached-JSON adapter (web GET /users/me/activity → entries) ────────────────────────────────────────

    [Fact]
    public void FromArray_parses_snake_case_rows()
    {
        using var doc = JsonDocument.Parse(
            "[{\"id\":42,\"ts\":\"2026-01-02T03:04:05Z\",\"action\":\"vehicle.command.wake\"," +
            "\"entity_type\":\"vehicle\",\"entity_id\":\"5\",\"detail\":\"manual\"}]");

        var rows = RecentActivityEntry.FromArray(doc.RootElement);

        var row = Assert.Single(rows);
        Assert.Equal(42, row.Id);
        Assert.Equal("vehicle.command.wake", row.Action);
        Assert.Equal("vehicle", row.EntityType);
        Assert.Equal("5", row.EntityId);
        Assert.Equal("manual", row.Detail);
        Assert.Equal(DateTimeOffset.Parse("2026-01-02T03:04:05Z"), row.Timestamp);
    }

    [Fact]
    public void FromArray_tolerates_camel_case_and_missing_fields()
    {
        using var doc = JsonDocument.Parse("[{\"action\":\"auth.login\",\"entityType\":\"vehicle\",\"entityId\":\"7\"}]");

        var row = Assert.Single(RecentActivityEntry.FromArray(doc.RootElement));

        Assert.Equal("auth.login", row.Action);
        Assert.Equal("vehicle", row.EntityType);
        Assert.Equal("7", row.EntityId);
        Assert.Null(row.Detail);
        Assert.Null(row.Timestamp);
    }

    [Fact]
    public void FromArray_returns_empty_for_a_non_array_body()
    {
        using var doc = JsonDocument.Parse("{\"error\":\"nope\"}");

        Assert.Empty(RecentActivityEntry.FromArray(doc.RootElement));
    }

    // ── Data seam (P1/S8) ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Source_starts_with_a_default_empty_input()
    {
        var source = new RecentActivityFeedSource();

        Assert.Null(source.Input.Entries);
        Assert.Null(source.Input.EmptyMessage);
        Assert.False(source.Input.IsLoading);
    }

    [Fact]
    public void Source_null_input_falls_back_to_default()
    {
        var source = new RecentActivityFeedSource(null!);

        Assert.Null(source.Input.Entries);
    }

    [Fact]
    public void Source_set_input_replaces_and_notifies()
    {
        var source = new RecentActivityFeedSource();
        int changes = 0;
        source.Changed += (_, _) => changes++;

        source.SetInput(new RecentActivityFeedInput { Entries = new[] { Entry() } });

        Assert.Equal(1, changes);
        Assert.NotNull(source.Input.Entries);
    }

    [Fact]
    public void Source_set_input_null_falls_back_to_default()
    {
        var source = new RecentActivityFeedSource(new RecentActivityFeedInput { Entries = new[] { Entry() } });

        source.SetInput(null!);

        Assert.Null(source.Input.Entries);
    }

    [Fact]
    public void Source_focused_mutators_update_one_facet_and_notify()
    {
        var source = new RecentActivityFeedSource();
        int changes = 0;
        source.Changed += (_, _) => changes++;

        source.SetEntries(new[] { Entry() });
        source.SetEmptyMessage("none");
        source.SetLoading(true);

        Assert.Equal(3, changes);
        Assert.Single(source.Input.Entries!);
        Assert.Equal("none", source.Input.EmptyMessage);
        Assert.True(source.Input.IsLoading);
    }

    [Fact]
    public void Source_set_entries_clears_the_loading_flag()
    {
        var source = new RecentActivityFeedSource(new RecentActivityFeedInput { IsLoading = true });

        source.SetEntries(new[] { Entry() });

        Assert.False(source.Input.IsLoading);
        Assert.Single(source.Input.Entries!);
    }

    [Fact]
    public void Source_load_from_json_hydrates_entries_and_clears_loading()
    {
        var source = new RecentActivityFeedSource(new RecentActivityFeedInput { IsLoading = true });
        int changes = 0;
        source.Changed += (_, _) => changes++;
        using var doc = JsonDocument.Parse("[{\"id\":1,\"action\":\"auth.login\"}]");

        source.LoadFromJson(doc.RootElement);

        Assert.Equal(1, changes);
        Assert.False(source.Input.IsLoading);
        Assert.Single(source.Input.Entries!);
        Assert.Equal("auth.login", source.Input.Entries![0].Action);
    }

    // ── View-model (state holder) ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_projects_the_initial_source_frame()
    {
        using var vm = new RecentActivityFeedViewModel(new RecentActivityFeedSource(), L);

        Assert.True(vm.ShowEmptyState);
        Assert.True(vm.Display.ShowEmptyState);
    }

    [Fact]
    public void ViewModel_reprojects_and_notifies_when_the_input_changes()
    {
        var source = new RecentActivityFeedSource();
        using var vm = new RecentActivityFeedViewModel(source, L);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        Assert.True(vm.ShowEmptyState);

        source.SetEntries(new[] { Entry() });

        Assert.False(vm.ShowEmptyState);
        Assert.True(vm.Display.ShowTimeline);
        Assert.Contains(nameof(RecentActivityFeedViewModel.Display), changed);
        Assert.Contains(nameof(RecentActivityFeedViewModel.ShowEmptyState), changed);
    }

    [Fact]
    public void Disposed_view_model_stops_reprojecting()
    {
        var source = new RecentActivityFeedSource(new RecentActivityFeedInput { Entries = new[] { Entry() } });
        var vm = new RecentActivityFeedViewModel(source, L);

        vm.Dispose();
        source.SetEntries(null);

        Assert.True(vm.Display.ShowTimeline);
    }

    [Fact]
    public void View_model_dispose_is_idempotent()
    {
        var vm = new RecentActivityFeedViewModel(new RecentActivityFeedSource(), L);

        vm.Dispose();
        var ex = Record.Exception(vm.Dispose);

        Assert.Null(ex);
    }

    [Fact]
    public void ViewModel_rejects_a_null_source() =>
        Assert.Throws<ArgumentNullException>(() => new RecentActivityFeedViewModel(null!, L));

    [Fact]
    public void ViewModel_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => new RecentActivityFeedViewModel(new RecentActivityFeedSource(), null!));

    // ── Diagnostics (P1/S11) ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_and_emits_the_slug()
    {
        var events = new List<string>();
        var diagnostics = new RecentActivityFeedDiagnostics(events.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(2, events.Count);
        Assert.All(events, e => Assert.Equal("view.opened slug=RecentActivityFeed", e));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_counts()
    {
        var diagnostics = new RecentActivityFeedDiagnostics();

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    // ── Registration metadata + i18n bridge ──────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_canonical_slug_and_glyph()
    {
        Assert.Equal("RecentActivityFeed", RecentActivityFeedRegistration.Slug);
        Assert.Equal("RecentActivityFeed", RecentActivityFeedViewModel.Slug);
        Assert.Equal("\uE81C", RecentActivityFeedRegistration.EmptyGlyph);
    }

    [Fact]
    public void Localize_prepends_the_catalog_namespace()
    {
        var capturing = new CapturingLocalizer();

        string value = RecentActivityFeedRegistration.Localize(capturing, "activity.myActivity.empty", "fallback");

        Assert.Equal("fallback", value);
        Assert.Contains("translation.activity.myActivity.empty", capturing.Keys);
    }

    [Fact]
    public void Projection_resolves_every_label_through_the_catalog_namespace()
    {
        var capturing = new CapturingLocalizer();

        RecentActivityFeedProjection.Project(
            new RecentActivityFeedInput { Entries = new[] { Entry(action: "auth.login") } },
            capturing);

        Assert.Contains("translation.activity.action.authLogin", capturing.Keys);
    }

    [Fact]
    public void Localize_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => RecentActivityFeedRegistration.Localize(null!, "k", "f"));
}
