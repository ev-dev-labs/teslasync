using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the LegacyAlertsRedirect surface's UI-thread-free logic — the query-aware
/// redirect resolver (web <c>TAB_TO_ROUTE</c> + <c>URLSearchParams</c> forwarding), the
/// <c>application/x-www-form-urlencoded</c> parse/serialize round-trip, the location state-holder adapter
/// (<c>useLocation</c>), the state-holder view-model's synchronous resolve + live re-resolve, the i18n key +
/// fallback contract, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/notifications/components/LegacyAlertsRedirect.tsx). The WinUI view itself
/// (LegacyAlertsRedirect.cs) is exercised by the app build. A cross-check confirms each resolved target is a
/// real route in the native RouteTable.
/// </summary>
public sealed class LegacyAlertsRedirectTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── Resolver: TAB_TO_ROUTE mapping + default + fallback (web parity) ─────────────────────────────────

    [Theory]
    [InlineData("?tab=alerts", "/notifications/alerts")]
    [InlineData("?tab=history", "/notifications/inbox")]
    [InlineData("?tab=preferences", "/notifications/quiet-hours")]
    public void Resolve_maps_each_known_tab_to_its_new_route(string search, string expectedPath) =>
        Assert.Equal(expectedPath, LegacyAlertsRedirectResolver.Resolve(search).Path);

    [Theory]
    [InlineData("")]
    [InlineData("?")]
    [InlineData("?filter=active")]
    public void Resolve_defaults_to_alerts_when_tab_is_absent(string search)
    {
        var target = LegacyAlertsRedirectResolver.Resolve(search);

        Assert.Equal("alerts", target.Tab);
        Assert.Equal("/notifications/alerts", target.Path);
    }

    [Theory]
    [InlineData("?tab=unknown")]
    [InlineData("?tab=")]
    [InlineData("?tab")]
    public void Resolve_falls_back_to_alerts_for_an_unknown_or_empty_tab(string search) =>
        Assert.Equal("/notifications/alerts", LegacyAlertsRedirectResolver.Resolve(search).Path);

    [Fact]
    public void Resolve_handles_a_null_search_as_the_default_alerts_route()
    {
        var target = LegacyAlertsRedirectResolver.Resolve(null);

        Assert.Equal("/notifications/alerts", target.Path);
        Assert.False(target.HasQuery);
        Assert.Equal("/notifications/alerts", target.Location);
    }

    // ── Resolver: forwards every other param, drops tab, preserves order (web parity) ────────────────────

    [Fact]
    public void Resolve_strips_the_tab_param_and_forwards_the_rest()
    {
        var target = LegacyAlertsRedirectResolver.Resolve("?tab=alerts&filter=active&severity=high");

        Assert.Equal("/notifications/alerts", target.Path);
        Assert.Equal("filter=active&severity=high", target.Query);
        Assert.Equal("/notifications/alerts?filter=active&severity=high", target.Location);
    }

    [Fact]
    public void Resolve_forwards_params_when_there_is_no_tab()
    {
        var target = LegacyAlertsRedirectResolver.Resolve("?filter=active&vehicle_id=3");

        Assert.Equal("/notifications/alerts?filter=active&vehicle_id=3", target.Location);
    }

    [Fact]
    public void Resolve_preserves_the_original_param_order()
    {
        var target = LegacyAlertsRedirectResolver.Resolve("?z=1&a=2&tab=history&m=3");

        Assert.Equal("/notifications/inbox", target.Path);
        Assert.Equal("z=1&a=2&m=3", target.Query);
    }

    [Fact]
    public void Resolve_uses_the_first_tab_and_removes_every_tab_entry()
    {
        var target = LegacyAlertsRedirectResolver.Resolve("?tab=history&tab=preferences&q=x");

        // web URLSearchParams.get returns the first value; delete removes all entries.
        Assert.Equal("history", target.Tab);
        Assert.Equal("/notifications/inbox", target.Path);
        Assert.Equal("q=x", target.Query);
    }

    [Fact]
    public void Resolve_normalizes_forwarded_encoding_like_url_search_params()
    {
        // %20 and a raw space both serialize back as '+'; a reserved char re-encodes as %XX.
        var target = LegacyAlertsRedirectResolver.Resolve("?tab=history&q=hello%20world&rule_id=a%2Fb");

        Assert.Equal("q=hello+world&rule_id=a%2Fb", target.Query);
        Assert.Equal("/notifications/inbox?q=hello+world&rule_id=a%2Fb", target.Location);
    }

    [Fact]
    public void Resolve_tolerates_a_search_string_without_a_leading_question_mark()
    {
        var target = LegacyAlertsRedirectResolver.Resolve("tab=preferences&page=2");

        Assert.Equal("/notifications/quiet-hours", target.Path);
        Assert.Equal("page=2", target.Query);
    }

    // ── RouteForTab table ───────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("alerts", "/notifications/alerts")]
    [InlineData("history", "/notifications/inbox")]
    [InlineData("preferences", "/notifications/quiet-hours")]
    [InlineData("nope", "/notifications/alerts")]
    [InlineData("", "/notifications/alerts")]
    public void RouteForTab_maps_known_tabs_and_falls_back_to_alerts(string tab, string expected) =>
        Assert.Equal(expected, LegacyAlertsRedirectResolver.RouteForTab(tab));

    [Fact]
    public void RouteForTab_treats_null_as_the_alerts_fallback() =>
        Assert.Equal("/notifications/alerts", LegacyAlertsRedirectResolver.RouteForTab(null));

    // ── Target value object ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Target_without_query_has_no_question_mark()
    {
        var target = new LegacyAlertsRedirectTarget("alerts", "/notifications/alerts", string.Empty);

        Assert.False(target.HasQuery);
        Assert.Equal("/notifications/alerts", target.Location);
    }

    [Fact]
    public void Target_with_query_appends_it_after_a_question_mark()
    {
        var target = new LegacyAlertsRedirectTarget("alerts", "/notifications/alerts", "filter=x");

        Assert.True(target.HasQuery);
        Assert.Equal("/notifications/alerts?filter=x", target.Location);
    }

    // ── ParseQuery (URLSearchParams parity) ─────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("?")]
    public void ParseQuery_returns_no_pairs_for_empty_input(string? search) =>
        Assert.Empty(LegacyAlertsRedirectResolver.ParseQuery(search));

    [Fact]
    public void ParseQuery_splits_pairs_and_strips_a_leading_question_mark()
    {
        var pairs = LegacyAlertsRedirectResolver.ParseQuery("?a=1&b=2");

        Assert.Collection(
            pairs,
            p => Assert.Equal(new LegacyQueryParameter("a", "1"), p),
            p => Assert.Equal(new LegacyQueryParameter("b", "2"), p));
    }

    [Fact]
    public void ParseQuery_treats_a_keyless_token_as_an_empty_value()
    {
        var pair = Assert.Single(LegacyAlertsRedirectResolver.ParseQuery("?flag"));

        Assert.Equal(new LegacyQueryParameter("flag", string.Empty), pair);
    }

    [Fact]
    public void ParseQuery_skips_empty_tokens()
    {
        var pairs = LegacyAlertsRedirectResolver.ParseQuery("?a=1&&b=2");

        Assert.Equal(2, pairs.Count);
    }

    [Fact]
    public void ParseQuery_decodes_plus_and_percent_escapes()
    {
        Assert.Equal("a b", Assert.Single(LegacyAlertsRedirectResolver.ParseQuery("?q=a+b")).Value);
        Assert.Equal("a b", Assert.Single(LegacyAlertsRedirectResolver.ParseQuery("?q=a%20b")).Value);
    }

    [Fact]
    public void ParseQuery_splits_only_on_the_first_equals()
    {
        Assert.Equal("v=x", Assert.Single(LegacyAlertsRedirectResolver.ParseQuery("?k=v=x")).Value);
    }

    // ── SerializeQuery (URLSearchParams.toString parity) ────────────────────────────────────────────────

    [Fact]
    public void SerializeQuery_of_nothing_is_empty() =>
        Assert.Equal(string.Empty, LegacyAlertsRedirectResolver.SerializeQuery(Array.Empty<LegacyQueryParameter>()));

    [Fact]
    public void SerializeQuery_encodes_space_as_plus_and_reserved_chars_as_percent()
    {
        var query = LegacyAlertsRedirectResolver.SerializeQuery(
        [
            new LegacyQueryParameter("q", "a b"),
            new LegacyQueryParameter("rule_id", "a/b"),
        ]);

        Assert.Equal("q=a+b&rule_id=a%2Fb", query);
    }

    [Fact]
    public void Parse_then_serialize_is_a_normalizing_round_trip()
    {
        var query = LegacyAlertsRedirectResolver.SerializeQuery(
            LegacyAlertsRedirectResolver.ParseQuery("?q=a%20b&x=1"));

        Assert.Equal("q=a+b&x=1", query);
    }

    // ── Location source adapter (useLocation parity) ────────────────────────────────────────────────────

    [Fact]
    public void Source_from_search_keeps_the_raw_query()
    {
        var source = LegacyAlertsLocationSource.FromSearch("?tab=history");

        Assert.Equal("/alerts", source.Current.Path);
        Assert.Equal("?tab=history", source.Current.Search);
    }

    [Fact]
    public void Source_from_null_search_is_empty() =>
        Assert.Equal(string.Empty, LegacyAlertsLocationSource.FromSearch(null).Current.Search);

    [Fact]
    public void Source_from_location_splits_path_and_query()
    {
        var source = LegacyAlertsLocationSource.FromLocation("/alerts?tab=history&q=x");

        Assert.Equal("/alerts", source.Current.Path);
        Assert.Equal("?tab=history&q=x", source.Current.Search);
    }

    [Fact]
    public void Source_from_location_without_query_has_an_empty_search()
    {
        var source = LegacyAlertsLocationSource.FromLocation("/alerts");

        Assert.Equal("/alerts", source.Current.Path);
        Assert.Equal(string.Empty, source.Current.Search);
    }

    [Theory]
    [InlineData("teslasync://app/alerts?tab=history&filter=x", "?tab=history&filter=x")]
    [InlineData("https://host/alerts?tab=preferences", "?tab=preferences")]
    [InlineData("teslasync://app/alerts", "")]
    public void Source_from_uri_takes_the_query_from_the_activation(string uri, string expectedSearch)
    {
        var source = LegacyAlertsLocationSource.FromUri(new Uri(uri));

        Assert.Equal("/alerts", source.Current.Path);
        Assert.Equal(expectedSearch, source.Current.Search);
    }

    [Fact]
    public void Source_set_updates_current_and_raises_changed()
    {
        var source = LegacyAlertsLocationSource.FromSearch("?tab=alerts");
        int changes = 0;
        source.Changed += (_, _) => changes++;

        source.Set(new LegacyAlertsLocation("/alerts", "?tab=history"));

        Assert.Equal(1, changes);
        Assert.Equal("?tab=history", source.Current.Search);
    }

    // ── View-model: single state, synchronous resolve, live re-resolve ──────────────────────────────────

    [Fact]
    public void ViewModel_state_is_always_redirecting()
    {
        using var vm = new LegacyAlertsRedirectViewModel(LegacyAlertsLocationSource.FromSearch("?tab=history"), Localizer);

        Assert.Equal(LegacyAlertsRedirectState.Redirecting, vm.State);
    }

    [Fact]
    public void ViewModel_resolves_the_destination_from_the_source()
    {
        using var vm = new LegacyAlertsRedirectViewModel(
            LegacyAlertsLocationSource.FromSearch("?tab=preferences&page=2"),
            Localizer);

        Assert.Equal("/notifications/quiet-hours", vm.Target.Path);
        Assert.Equal("/notifications/quiet-hours?page=2", vm.Target.Location);
        Assert.Equal(vm.Target.Location, vm.DestinationLocation);
    }

    [Fact]
    public void ViewModel_re_resolves_live_when_the_location_changes()
    {
        var source = LegacyAlertsLocationSource.FromSearch("?tab=history");
        using var vm = new LegacyAlertsRedirectViewModel(source, Localizer);
        Assert.Equal("/notifications/inbox", vm.Target.Path);

        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        source.Set(new LegacyAlertsLocation("/alerts", "?tab=preferences"));

        Assert.Equal("/notifications/quiet-hours", vm.Target.Path);
        Assert.Contains(nameof(LegacyAlertsRedirectViewModel.Target), raised);
        Assert.Contains(nameof(LegacyAlertsRedirectViewModel.DestinationLocation), raised);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_source()
    {
        var source = LegacyAlertsLocationSource.FromSearch("?tab=history");
        var vm = new LegacyAlertsRedirectViewModel(source, Localizer);
        vm.Dispose();

        source.Set(new LegacyAlertsLocation("/alerts", "?tab=preferences"));

        // After dispose the surface no longer reacts to location changes.
        Assert.Equal("/notifications/inbox", vm.Target.Path);
    }

    // ── i18n: the status string flows through the facade ────────────────────────────────────────────────

    [Fact]
    public void ViewModel_status_resolves_through_the_localizer()
    {
        using var vm = new LegacyAlertsRedirectViewModel(LegacyAlertsLocationSource.FromSearch(""), new PrefixLocalizer());

        Assert.Equal("L:notifications.legacyRedirect.status", vm.StatusMessage);
        Assert.Equal(vm.StatusMessage, vm.AutomationName);
    }

    [Fact]
    public void ViewModel_status_requests_the_web_key_and_fallback()
    {
        var recording = new RecordingLocalizer();
        using var vm = new LegacyAlertsRedirectViewModel(LegacyAlertsLocationSource.FromSearch(""), recording);

        _ = vm.StatusMessage;

        Assert.Equal("Redirecting…", recording.Fallback("notifications.legacyRedirect.status"));
        Assert.False(string.IsNullOrWhiteSpace(vm.AutomationName));
    }

    // ── Diagnostics (view.opened, PII-safe) ─────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new LegacyAlertsRedirectDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LegacyAlertsRedirect", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_leak_user_data_in_the_slug() =>
        Assert.Equal("LegacyAlertsRedirect", LegacyAlertsRedirectRegistration.Slug);

    // ── Cross-check: every resolved target is a real native route ───────────────────────────────────────

    [Theory]
    [InlineData("?tab=alerts", "NotificationsAlerts")]
    [InlineData("?tab=history", "NotificationsInbox")]
    [InlineData("?tab=preferences", "NotificationsQuietHours")]
    public void Resolved_targets_match_a_real_route_in_the_native_table(string search, string expectedRouteName)
    {
        var registry = new RouteRegistry();
        var target = LegacyAlertsRedirectResolver.Resolve(search);

        var match = registry.Match(target.Path);

        Assert.False(match.IsCatchAll);
        Assert.Equal(expectedRouteName, match.Route.Name);
    }

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
