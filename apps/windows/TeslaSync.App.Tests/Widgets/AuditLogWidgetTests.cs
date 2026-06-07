using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.DashboardWidgets;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the AuditLogWidget's UI-thread-free logic — the two JSON parse adapters
/// (audit-trail field tolerance + the security <see cref="SecurityFlag"/> JavaScript semantics), the
/// severity inference and security-title composition, the merged projection (combine / 24h stats /
/// newest-first sort / cap / subtitle / shield glyph / labels), the two cache-then-network result
/// mappers, the registry metadata, the diagnostics, the repository source's vehicle resolution + request
/// shapes, and the state-holder view-model's combined per-state transitions (loading / loaded / empty /
/// error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/widgets/AuditLogWidget.tsx).
/// </summary>
public sealed class AuditLogWidgetTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 5, 0, TimeSpan.Zero);
    private const string FiveMinAgo = "2026-06-06T12:00:00Z";

    // ---- Audit entry parse adapter -------------------------------------------------

    [Fact]
    public void AuditEntry_parses_real_api_fields_mapping_entity_type_detail_ts()
    {
        const string json = """
        [{"id":1,"ts":"2026-06-06T12:00:00Z","actor":"alice","action":"delete_api_key",
          "entity_type":"api_key","entity_id":9,"detail":"Removed key"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var entry = Assert.Single(AuditLogEntry.ParseList(doc.RootElement));

        Assert.Equal("1", entry.Id);
        Assert.Equal("delete_api_key", entry.Action);
        Assert.Equal("api_key", entry.Resource);  // resource ← entity_type
        Assert.Equal("Removed key", entry.Details); // details ← detail
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 12, 0, 0, TimeSpan.Zero), entry.CreatedAtTime); // createdAt ← ts
    }

    [Fact]
    public void AuditEntry_prefers_web_interface_names_when_present()
    {
        const string json = """
        [{"id":"x9","action":"login","resource":"session","details":"ok","created_at":"2026-06-06T12:00:00Z","ts":"1999-01-01T00:00:00Z"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var entry = Assert.Single(AuditLogEntry.ParseList(doc.RootElement));

        Assert.Equal("x9", entry.Id);
        Assert.Equal("session", entry.Resource);
        Assert.Equal("ok", entry.Details);
        Assert.Equal(new DateTimeOffset(2026, 6, 6, 12, 0, 0, TimeSpan.Zero), entry.CreatedAtTime); // created_at wins over ts
    }

    [Fact]
    public void AuditEntry_is_tolerant_of_missing_fields()
    {
        using var doc = JsonDocument.Parse("""[{"id":2}]""");

        var entry = Assert.Single(AuditLogEntry.ParseList(doc.RootElement));

        Assert.Equal("2", entry.Id);
        Assert.Equal(string.Empty, entry.Action);
        Assert.Null(entry.Resource);
        Assert.Null(entry.Details);
        Assert.Null(entry.CreatedAtTime);
    }

    [Fact]
    public void AuditEntry_parselist_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Empty(AuditLogEntry.ParseList(doc.RootElement));
    }

    // ---- SecurityFlag JavaScript semantics -----------------------------------------

    [Fact]
    public void SecurityFlag_models_bool_string_null_and_absent()
    {
        using var doc = JsonDocument.Parse("""{"t":true,"f":false,"s":"active","n":null}""");
        var obj = doc.RootElement;

        var t = SecurityFlag.From(obj, "t");
        Assert.True(t.IsTrue);
        Assert.True(t.IsTruthy);
        Assert.True(t.IsNotNull);
        Assert.False(t.IsFalse);

        var f = SecurityFlag.From(obj, "f");
        Assert.True(f.IsFalse);
        Assert.False(f.IsTruthy);
        Assert.True(f.IsNotNull);

        var s = SecurityFlag.From(obj, "s");
        Assert.True(s.IsWord);
        Assert.True(s.IsTruthy);
        Assert.True(s.Matches("active"));
        Assert.False(s.Matches("off"));

        var n = SecurityFlag.From(obj, "n");
        Assert.False(n.IsNotNull);  // explicit JSON null
        Assert.False(n.IsTruthy);

        var absent = SecurityFlag.From(obj, "missing");
        Assert.True(absent.IsNotNull); // JS: undefined !== null
        Assert.False(absent.IsTruthy);
    }

    [Fact]
    public void SecurityEvent_parses_security_fields()
    {
        const string json = """
        [{"id":3,"locked":false,"sentry_mode":"active","door_state":"open","guest_mode":true,
          "valet_mode_enabled":false,"created_at":"2026-06-06T12:00:00Z"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var ev = Assert.Single(SecurityEvent.ParseList(doc.RootElement));

        Assert.Equal("3", ev.Id);
        Assert.True(ev.Locked.IsFalse);
        Assert.True(ev.SentryMode.Matches("active"));
        Assert.True(ev.DoorState.Matches("open"));
        Assert.True(ev.GuestMode.IsTrue);
        Assert.True(ev.ValetModeEnabled.IsFalse);
        Assert.NotNull(ev.CreatedAtTime);
    }

    // ---- Severity inference (web inferAuditSeverity / inferSecuritySeverity) --------

    [Theory]
    [InlineData("delete_api_key", AuditSeverity.Critical)]
    [InlineData("REVOKE_TOKEN", AuditSeverity.Critical)]
    [InlineData("login_failed", AuditSeverity.Critical)]
    [InlineData("update_settings", AuditSeverity.Warning)]
    [InlineData("change_email", AuditSeverity.Warning)]
    [InlineData("modify_rule", AuditSeverity.Warning)]
    [InlineData("login", AuditSeverity.Info)]
    [InlineData("", AuditSeverity.Info)]
    public void InferAuditSeverity_matches_web(string action, AuditSeverity expected) =>
        Assert.Equal(expected, AuditLogProjection.InferAuditSeverity(action));

    [Fact]
    public void InferSecuritySeverity_matches_web()
    {
        Assert.Equal(AuditSeverity.Critical, AuditLogProjection.InferSecuritySeverity(Security(locked: SecurityFalse)));
        Assert.Equal(AuditSeverity.Warning, AuditLogProjection.InferSecuritySeverity(Security(sentry: SecurityWord("active"))));
        Assert.Equal(AuditSeverity.Warning, AuditLogProjection.InferSecuritySeverity(Security(sentry: SecurityTrue)));
        Assert.Equal(AuditSeverity.Info, AuditLogProjection.InferSecuritySeverity(Security()));
    }

    // ---- buildSecurityTitle precedence (locked -> sentry -> door -> guest -> valet) -

    [Fact]
    public void BuildSecurityTitle_prioritizes_locked()
    {
        Assert.Equal("Vehicle locked", AuditLogProjection.BuildSecurityTitle(Security(locked: SecurityTrue), Localizer));
        Assert.Equal("Vehicle unlocked", AuditLogProjection.BuildSecurityTitle(Security(locked: SecurityFalse), Localizer));
    }

    [Fact]
    public void BuildSecurityTitle_falls_through_to_sentry_then_door()
    {
        Assert.Equal("Sentry: active", AuditLogProjection.BuildSecurityTitle(
            Security(locked: SecurityNull, sentry: SecurityWord("active")), Localizer));
        Assert.Equal("Sentry: On", AuditLogProjection.BuildSecurityTitle(
            Security(locked: SecurityNull, sentry: SecurityTrue), Localizer));
        Assert.Equal("Door: open", AuditLogProjection.BuildSecurityTitle(
            Security(locked: SecurityNull, door: SecurityWord("open")), Localizer));
    }

    [Fact]
    public void BuildSecurityTitle_falls_through_to_guest_then_valet_then_fallback()
    {
        Assert.Equal("Guest mode on", AuditLogProjection.BuildSecurityTitle(
            Security(locked: SecurityNull, guest: SecurityTrue), Localizer));
        Assert.Equal("Valet mode off", AuditLogProjection.BuildSecurityTitle(
            Security(locked: SecurityNull, guest: SecurityNull, valet: SecurityFalse), Localizer));
        Assert.Equal("Security event", AuditLogProjection.BuildSecurityTitle(
            Security(locked: SecurityNull, sentry: SecurityNull, door: SecurityNull, guest: SecurityNull, valet: SecurityNull), Localizer));
    }

    [Fact]
    public void BuildSecurityTitle_absent_locked_reads_as_unlocked_matching_js_quirk()
    {
        // Web parity: `event.locked !== null` is true for an absent (undefined) value, and
        // `undefined ? 'locked' : 'unlocked'` yields the unlocked label.
        Assert.Equal("Vehicle unlocked", AuditLogProjection.BuildSecurityTitle(Security(), Localizer));
    }

    // ---- Projection: merge / sort / cap / subtitle / glyph / stats ------------------

    [Fact]
    public void Project_merges_audit_then_security_with_distinct_glyphs()
    {
        var display = AuditLogProjection.Project(
            new[] { Audit("1", "login", createdAt: FiveMinAgo) },
            new[] { Security("9", locked: SecurityFalse, createdAt: FiveMinAgo) },
            AuditLogSize.Default, Localizer, Now);

        Assert.True(display.HasItems);
        Assert.Equal(2, display.Items.Count);

        var auditRow = Assert.Single(display.Items, r => r.Id == "audit-1");
        Assert.Equal(SeverityLevels.Tokens(SeverityLevel.Info).IconGlyph, auditRow.Glyph);

        var secRow = Assert.Single(display.Items, r => r.Id == "sec-9");
        Assert.Equal(AuditLogProjection.SecurityGlyph, secRow.Glyph);
        Assert.Equal(AuditSeverity.Critical, secRow.Severity); // locked === false
    }

    [Fact]
    public void Project_sorts_newest_first_and_caps_to_max_feed_items()
    {
        var audits = new List<AuditLogEntry>();
        for (int i = 0; i < 20; i++)
        {
            var ts = new DateTimeOffset(2026, 6, 6, 10, i, 0, TimeSpan.Zero);
            audits.Add(Audit(i.ToString(CultureInfo.InvariantCulture), "login", createdAt: ts.ToString("o", CultureInfo.InvariantCulture)));
        }

        var display = AuditLogProjection.Project(audits, Array.Empty<SecurityEvent>(), AuditLogSize.Default, Localizer, Now);

        Assert.Equal(AuditLogRegistration.MaxFeedItems, display.Items.Count); // 15
        Assert.Equal("audit-19", display.Items[0].Id);                        // newest first
        Assert.Equal("audit-5", display.Items[^1].Id);                        // 15 newest of 0..19 -> 19..5
    }

    [Fact]
    public void Project_audit_subtitle_joins_resource_and_details_else_em_dash()
    {
        var withBoth = AuditLogProjection.Project(
            new[] { Audit("1", "x", resource: "api_key", details: "removed", createdAt: FiveMinAgo) },
            Array.Empty<SecurityEvent>(), AuditLogSize.Default, Localizer, Now);
        Assert.Equal("api_key \u00B7 removed", withBoth.Items[0].Subtitle);

        var withNone = AuditLogProjection.Project(
            new[] { Audit("1", "x", createdAt: FiveMinAgo) },
            Array.Empty<SecurityEvent>(), AuditLogSize.Default, Localizer, Now);
        Assert.Equal("\u2014", withNone.Items[0].Subtitle);
    }

    [Fact]
    public void Project_security_subtitle_is_security_event_label()
    {
        var display = AuditLogProjection.Project(
            Array.Empty<AuditLogEntry>(),
            new[] { Security("9", locked: SecurityTrue, createdAt: FiveMinAgo) },
            AuditLogSize.Default, Localizer, Now);

        Assert.Equal("Security event", display.Items[0].Subtitle);
        Assert.Equal("5m ago", display.Items[0].RelativeTime);
    }

    [Fact]
    public void Project_empty_title_falls_back_to_em_dash()
    {
        var display = AuditLogProjection.Project(
            new[] { Audit("1", "", createdAt: FiveMinAgo) },
            Array.Empty<SecurityEvent>(), AuditLogSize.Default, Localizer, Now);
        Assert.Equal("\u2014", display.Items[0].Title);
    }

    [Fact]
    public void Project_compact_stats_count_last_24h_and_worst_severity()
    {
        var recentCritical = Audit("1", "delete_x", createdAt: FiveMinAgo);          // 5m ago, critical
        var recentInfo = Audit("2", "login", createdAt: "2026-06-06T11:00:00Z");     // ~1h ago, info
        var old = Audit("3", "delete_y", createdAt: "2026-06-04T12:00:00Z");         // ~2d ago, excluded

        var display = AuditLogProjection.Project(
            new[] { recentCritical, recentInfo, old }, Array.Empty<SecurityEvent>(),
            new AuditLogSize(1, 2), Localizer, Now);

        Assert.True(display.IsCompact);
        Assert.Equal(2, display.TotalEvents24h);              // old excluded
        Assert.Equal("2", display.CountText);
        Assert.Equal(AuditSeverity.Critical, display.WorstSeverity);
        Assert.Equal(StatusKind.Danger, display.WorstBadgeStatus);
        Assert.Equal("Critical", display.WorstSeverityLabel);
        Assert.Contains("Events (24h)", display.CompactAutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_compact_worst_severity_warning_when_no_critical()
    {
        var display = AuditLogProjection.Project(
            new[] { Audit("1", "update_x", createdAt: FiveMinAgo), Audit("2", "login", createdAt: FiveMinAgo) },
            Array.Empty<SecurityEvent>(), new AuditLogSize(1, 2), Localizer, Now);

        Assert.Equal(AuditSeverity.Warning, display.WorstSeverity);
        Assert.Equal(StatusKind.Warning, display.WorstBadgeStatus);
    }

    [Fact]
    public void Project_empty_inputs_yield_no_items_zero_count_info_worst()
    {
        var display = AuditLogProjection.Project(
            Array.Empty<AuditLogEntry>(), Array.Empty<SecurityEvent>(), AuditLogSize.Default, Localizer, Now);

        Assert.False(display.HasItems);
        Assert.Equal(0, display.TotalEvents24h);
        Assert.Empty(display.Items);
        Assert.Equal(AuditSeverity.Info, display.WorstSeverity);
        Assert.Equal(StatusKind.Neutral, display.WorstBadgeStatus);
    }

    [Fact]
    public void Project_rows_have_non_empty_accessibility_names()
    {
        var display = AuditLogProjection.Project(
            new[] { Audit("1", "delete_x", resource: "api_key", createdAt: FiveMinAgo) },
            Array.Empty<SecurityEvent>(), AuditLogSize.Default, Localizer, Now);

        var row = Assert.Single(display.Items);
        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains("Critical", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("delete_x", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("5m ago", row.AutomationName, StringComparison.Ordinal);
    }

    // ---- Result mappers (cache-then-network preservation) ---------------------------

    [Fact]
    public void AuditMapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"action":"login","ts":"2026-06-06T12:00:00Z"}]""");

        var cached = AuditLogResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = AuditLogResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void AuditMapper_collapses_loaded_empty_array_to_empty_and_maps_failure()
    {
        using var empty = JsonDocument.Parse("[]");
        Assert.Equal(LoadStatus.Empty, AuditLogResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(empty.RootElement, Now)).Status);

        Assert.Equal(LoadStatus.Error, AuditLogResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))).Status);
    }

    [Fact]
    public void SecurityMapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"locked":false,"created_at":"2026-06-06T12:00:00Z"}]""");

        var loaded = SecurityEventResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.Single(loaded.Value!);

        using var empty = JsonDocument.Parse("[]");
        Assert.Equal(LoadStatus.Empty, SecurityEventResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(empty.RootElement, Now)).Status);
    }

    // ---- Size flag (web isCompact) -------------------------------------------------

    [Theory]
    [InlineData(1, 2, true)]
    [InlineData(2, 4, false)]
    [InlineData(4, 40, false)]
    public void Size_isCompact_matches_web(int cols, int rows, bool compact) =>
        Assert.Equal(compact, new AuditLogSize(cols, rows).IsCompact);

    // ---- View-model combined state matrix ------------------------------------------

    [Fact]
    public async Task ViewModel_stays_loading_until_both_sources_resolve()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<IReadOnlyList<AuditLogEntry>>.Loaded(new[] { Audit("1", "login", createdAt: FiveMinAgo) }, Now) },
            new[] { RepositoryResult<IReadOnlyList<SecurityEvent>>.Loading() }); // security never resolves
        await vm.LoadAsync();

        Assert.Equal(AuditLogState.Loading, vm.State); // web: auditLoading || secLoading
    }

    [Fact]
    public async Task ViewModel_loaded_merges_both_sources()
    {
        using var vm = NewViewModel(
            Audits(Audit("1", "login", createdAt: FiveMinAgo)),
            Securities(Security("9", locked: SecurityFalse, createdAt: FiveMinAgo)));
        await vm.LoadAsync();

        Assert.Equal(AuditLogState.Loaded, vm.State);
        Assert.True(vm.HasItems);
        Assert.Equal(2, vm.Display.Items.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_when_both_sources_empty()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<IReadOnlyList<AuditLogEntry>>.Empty(Now) },
            new[] { RepositoryResult<IReadOnlyList<SecurityEvent>>.Empty(Now) });
        await vm.LoadAsync();

        Assert.Equal(AuditLogState.Empty, vm.State);
        Assert.False(vm.HasItems);
        Assert.Equal("No audit events", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_error_when_a_source_fails_with_no_items()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<IReadOnlyList<AuditLogEntry>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")) },
            new[] { RepositoryResult<IReadOnlyList<SecurityEvent>>.Empty(Now) });
        await vm.LoadAsync();

        Assert.Equal(AuditLogState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(vm.HasItems);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_items()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<IReadOnlyList<AuditLogEntry>>.Cached(new[] { Audit("1", "login", createdAt: FiveMinAgo) }, Now, stale: true) },
            new[] { RepositoryResult<IReadOnlyList<SecurityEvent>>.Empty(Now) });
        await vm.LoadAsync();

        Assert.Equal(AuditLogState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasItems);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_items_and_error_chip()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<IReadOnlyList<AuditLogEntry>>.OfflineCached(new[] { Audit("1", "login", createdAt: FiveMinAgo) }, Now, new RepositoryError(RepositoryErrorKind.Network, "offline")) },
            new[] { RepositoryResult<IReadOnlyList<SecurityEvent>>.Empty(Now) });
        await vm.LoadAsync();

        Assert.Equal(AuditLogState.Offline, vm.State);
        Assert.True(vm.HasItems);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsError); // web: a failed refetch sets isError even with cached data
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            new[]
            {
                RepositoryResult<IReadOnlyList<AuditLogEntry>>.Loading(),
                RepositoryResult<IReadOnlyList<AuditLogEntry>>.Cached(new[] { Audit("1", "login", createdAt: FiveMinAgo) }, Now, stale: false),
                RepositoryResult<IReadOnlyList<AuditLogEntry>>.Loaded(new[] { Audit("1", "login", createdAt: FiveMinAgo), Audit("2", "logout", createdAt: FiveMinAgo) }, Now),
            },
            Securities(Security("9", locked: SecurityTrue, createdAt: FiveMinAgo)));
        await vm.LoadAsync();

        Assert.Equal(AuditLogState.Loaded, vm.State);
        Assert.Equal(3, vm.Display.Items.Count); // 2 audit + 1 security
    }

    [Fact]
    public async Task ViewModel_size_change_reprojects_compact()
    {
        using var vm = NewViewModel(
            AuditLogSize.Default,
            Audits(Audit("1", "login", createdAt: FiveMinAgo)),
            Securities());
        await vm.LoadAsync();
        Assert.False(vm.Display.IsCompact);

        vm.Size = new AuditLogSize(1, 2);
        Assert.True(vm.Display.IsCompact);
        Assert.Equal(AuditLogState.Loaded, vm.State);
    }

    [Fact]
    public async Task ViewModel_title_and_empty_resolve_through_i18n()
    {
        using var vm = NewViewModel(
            new[] { RepositoryResult<IReadOnlyList<AuditLogEntry>>.Empty(Now) },
            new[] { RepositoryResult<IReadOnlyList<SecurityEvent>>.Empty(Now) });
        await vm.LoadAsync();

        Assert.Equal("Audit Log", vm.Title);
        Assert.Equal("No audit events", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(
            Audits(Audit("1", "login", createdAt: FiveMinAgo)),
            Securities());
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(AuditLogViewModel.State), changed);
        Assert.Contains(nameof(AuditLogViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_retry_reruns_and_keeps_items()
    {
        using var vm = NewViewModel(
            Audits(Audit("1", "login", createdAt: FiveMinAgo)),
            Securities(Security("9", locked: SecurityTrue, createdAt: FiveMinAgo)));
        await vm.LoadAsync();
        Assert.Equal(2, vm.Display.Items.Count);

        await vm.RetryAsync();

        Assert.Equal(AuditLogState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Items.Count);
        Assert.True(vm.Attempts >= 2);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_registry()
    {
        Assert.Equal("audit-log", AuditLogRegistration.Id);
        Assert.Equal("system", AuditLogRegistration.Category);
        Assert.Equal("AuditLogWidget", AuditLogRegistration.Slug);
        Assert.Equal(15, AuditLogRegistration.MaxFeedItems);
        Assert.Equal(new AuditLogSize(2, 4), AuditLogRegistration.DefaultSize);
        Assert.Equal(new AuditLogSize(2, 4), AuditLogRegistration.MinSize);
        Assert.Equal(new AuditLogSize(4, 40), AuditLogRegistration.MaxSize);
        Assert.Equal("Audit Log", AuditLogRegistration.Name(Localizer));
        Assert.Contains("audit", AuditLogRegistration.Description(Localizer), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2, 4, true)]
    [InlineData(4, 40, true)]
    [InlineData(1, 4, false)]  // below min cols
    [InlineData(5, 40, false)] // above max cols
    [InlineData(2, 41, false)] // above max rows
    [InlineData(2, 3, false)]  // below min rows
    public void Registration_bounds_check(int cols, int rows, bool within) =>
        Assert.Equal(within, AuditLogRegistration.IsWithinBounds(new AuditLogSize(cols, rows)));

    [Fact]
    public void Registration_clamps_to_bounds()
    {
        Assert.Equal(new AuditLogSize(2, 4), AuditLogRegistration.Clamp(new AuditLogSize(1, 1)));
        Assert.Equal(new AuditLogSize(4, 40), AuditLogRegistration.Clamp(new AuditLogSize(9, 99)));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AuditLogDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AuditLogWidget", Assert.Single(lines));
    }

    // ---- Source: vehicle resolution + request shapes -------------------------------

    [Fact]
    public async Task Source_audit_stream_requests_system_audit_and_parses()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"action":"login","ts":"2026-06-06T12:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new AuditLogSource(new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await DrainAudit(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        Assert.Single(results[^1].Value!);
        Assert.Equal("get_api_v1_system_audit", Assert.Single(api.Requests).OperationId);
    }

    [Fact]
    public async Task Source_security_with_no_vehicle_yields_empty_without_requesting()
    {
        var api = new FakeApiClient();
        var source = new AuditLogSource(new FakeWidgetVehicleSource(null), api, NewEngine(), new ApiClientOptions());

        var results = await DrainSecurity(source);

        Assert.Equal(LoadStatus.Empty, Assert.Single(results).Status);
        Assert.Empty(api.Requests);
    }

    [Fact]
    public async Task Source_security_resolves_primary_vehicle_and_requests_with_vehicle_id()
    {
        using var doc = JsonDocument.Parse("""[{"id":1,"locked":false,"created_at":"2026-06-06T12:00:00Z"}]""");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new AuditLogSource(
            new FakeWidgetVehicleSource(new WidgetVehicleSnapshot { VehicleId = 7 }),
            api, NewEngine(), new ApiClientOptions());

        var results = await DrainSecurity(source);

        Assert.Equal(LoadStatus.Loaded, results[^1].Status);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_security", request.OperationId);
        Assert.Equal(7L, Convert.ToInt64(request.Query!["vehicle_id"], CultureInfo.InvariantCulture));
    }

    [Fact]
    public async Task Source_security_explicit_vehicle_id_wins_over_primary()
    {
        using var doc = JsonDocument.Parse("[]");
        var api = new FakeApiClient().ReturnsValue(doc.RootElement);
        var source = new AuditLogSource(
            new FakeWidgetVehicleSource(null), // primary not consulted when an explicit id is supplied
            api, NewEngine(), new ApiClientOptions(), vehicleId: 42);

        var results = await DrainSecurity(source);

        Assert.Equal(42L, Convert.ToInt64(Assert.Single(api.Requests).Query!["vehicle_id"], CultureInfo.InvariantCulture));
        Assert.Equal(LoadStatus.Empty, results[^1].Status);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static readonly SecurityFlag SecurityTrue = new(SecurityFlagKind.Flag, true, null);
    private static readonly SecurityFlag SecurityFalse = new(SecurityFlagKind.Flag, false, null);
    private static readonly SecurityFlag SecurityNull = new(SecurityFlagKind.JsonNull, false, null);

    private static SecurityFlag SecurityWord(string text) => new(SecurityFlagKind.Word, false, text);

    private static AuditLogEntry Audit(
        string id,
        string action,
        string? resource = null,
        string? details = null,
        string? createdAt = FiveMinAgo) =>
        new(id, action, resource, details, createdAt);

    private static SecurityEvent Security(
        string id = "1",
        SecurityFlag locked = default,
        SecurityFlag sentry = default,
        SecurityFlag door = default,
        SecurityFlag guest = default,
        SecurityFlag valet = default,
        string? createdAt = FiveMinAgo) =>
        new(id, locked, sentry, door, guest, valet, createdAt);

    private static CacheThenNetworkEngine NewEngine() => new(new InMemoryCacheStore(), () => Now);

    private static RepositoryResult<IReadOnlyList<AuditLogEntry>>[] Audits(params AuditLogEntry[] entries) =>
        new[] { RepositoryResult<IReadOnlyList<AuditLogEntry>>.Loaded(entries, Now) };

    private static RepositoryResult<IReadOnlyList<SecurityEvent>>[] Securities(params SecurityEvent[] events) =>
        events.Length == 0
            ? new[] { RepositoryResult<IReadOnlyList<SecurityEvent>>.Empty(Now) }
            : new[] { RepositoryResult<IReadOnlyList<SecurityEvent>>.Loaded(events, Now) };

    private static AuditLogViewModel NewViewModel(
        RepositoryResult<IReadOnlyList<AuditLogEntry>>[] audit,
        RepositoryResult<IReadOnlyList<SecurityEvent>>[] security) =>
        NewViewModel(AuditLogSize.Default, audit, security);

    private static AuditLogViewModel NewViewModel(
        AuditLogSize size,
        RepositoryResult<IReadOnlyList<AuditLogEntry>>[] audit,
        RepositoryResult<IReadOnlyList<SecurityEvent>>[] security) =>
        new(new FakeAuditLogSource(audit, security), Localizer, size, () => Now);

    private static async Task<List<RepositoryResult<IReadOnlyList<AuditLogEntry>>>> DrainAudit(IAuditLogSource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<AuditLogEntry>>>();
        await foreach (var result in source.StreamAuditLogsAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private static async Task<List<RepositoryResult<IReadOnlyList<SecurityEvent>>>> DrainSecurity(IAuditLogSource source)
    {
        var list = new List<RepositoryResult<IReadOnlyList<SecurityEvent>>>();
        await foreach (var result in source.StreamSecurityEventsAsync())
        {
            list.Add(result);
        }

        return list;
    }

    private sealed class FakeAuditLogSource(
        RepositoryResult<IReadOnlyList<AuditLogEntry>>[] audit,
        RepositoryResult<IReadOnlyList<SecurityEvent>>[] security) : IAuditLogSource
    {
        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<AuditLogEntry>>> StreamAuditLogsAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in audit)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SecurityEvent>>> StreamSecurityEventsAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in security)
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
