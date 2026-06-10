using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>LegacyAlertRulesRedirect</c> feature surface's UI-thread-free logic — the
/// query-preserving redirect projection (the web <c>`/notifications/rules${search}`</c> + <c>replace</c>), the
/// render-ready display copy, the bound current-location state holder, the one-shot navigation dispatch and the
/// PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/notifications/components/LegacyAlertRulesRedirect.tsx). The WinUI view itself is exercised by
/// the app build.
/// </summary>
public sealed class LegacyAlertRulesRedirectTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── NormalizeSearch: the web search (already "?…" or empty) plus hardening for bare / lone-"?" inputs ──

    [Theory]
    [InlineData(null, "")]
    [InlineData("", "")]
    [InlineData("   ", "")]
    [InlineData("?", "")]
    [InlineData("?vehicle_id=3", "?vehicle_id=3")]
    [InlineData("?vehicle_id=3&tab=history", "?vehicle_id=3&tab=history")]
    [InlineData("vehicle_id=3", "?vehicle_id=3")]
    [InlineData("  ?vehicle_id=3  ", "?vehicle_id=3")]
    public void NormalizeSearch_yields_single_leading_question_mark_or_empty(string? input, string expected) =>
        Assert.Equal(expected, LegacyAlertRulesRedirectProjection.NormalizeSearch(input));

    // ── Resolve: the redirect intent (RoutePath / Search / Href / Replace) ───────────────────────────────

    [Fact]
    public void Resolve_targets_the_notifications_rules_route_with_replace()
    {
        var target = LegacyAlertRulesRedirectProjection.Resolve(null);

        Assert.Equal("notifications/rules", target.RoutePath);
        Assert.True(target.Replace);
        Assert.Equal(string.Empty, target.Search);
        Assert.False(target.HasSearch);
    }

    [Fact]
    public void Resolve_preserves_the_query_string()
    {
        var target = LegacyAlertRulesRedirectProjection.Resolve("?vehicle_id=3&severity=high");

        Assert.Equal("notifications/rules", target.RoutePath);
        Assert.Equal("?vehicle_id=3&severity=high", target.Search);
        Assert.True(target.HasSearch);
    }

    [Theory]
    [InlineData("", "/notifications/rules")]
    [InlineData("?q=brakes", "/notifications/rules?q=brakes")]
    public void Resolve_href_matches_the_web_navigate_target(string search, string expectedHref)
    {
        // Web parity: `/notifications/rules${search}` for canonical react-router search values.
        var target = LegacyAlertRulesRedirectProjection.Resolve(search);

        Assert.Equal(expectedHref, target.Href);
        Assert.Equal(LegacyAlertRulesRedirectRegistration.TargetHrefPrefix + target.Search, target.Href);
    }

    // ── ProjectDisplay: localized copy + accessible name (every state renders a non-blank surface) ───────

    [Fact]
    public void Display_resolves_the_localized_title_and_message()
    {
        var display = LegacyAlertRulesRedirectProjection.ProjectDisplay("?a=b", Localizer);

        Assert.Equal("Redirecting\u2026", display.Title);
        Assert.Equal("Taking you to Alert Rules", display.Message);
        Assert.Equal("?a=b", display.Target.Search);
    }

    [Fact]
    public void Display_composes_a_non_empty_automation_name_from_title_and_message()
    {
        var display = LegacyAlertRulesRedirectProjection.ProjectDisplay(null, Localizer);

        Assert.False(string.IsNullOrWhiteSpace(display.AutomationName));
        Assert.Equal("Redirecting\u2026. Taking you to Alert Rules", display.AutomationName);
    }

    [Fact]
    public void Display_copy_flows_through_the_registration_i18n_keys()
    {
        var localizer = new KeyCapturingLocalizer();

        LegacyAlertRulesRedirectProjection.ProjectDisplay(null, localizer);

        Assert.Contains(LegacyAlertRulesRedirectRegistration.TitleKey, localizer.RequestedKeys);
        Assert.Contains(LegacyAlertRulesRedirectRegistration.MessageKey, localizer.RequestedKeys);
    }

    // ── ViewModel: binds the location state holder, dispatches the redirect once ──────────────────────────

    [Fact]
    public void ViewModel_reads_the_query_from_the_bound_location_state_holder()
    {
        var vm = new LegacyAlertRulesRedirectViewModel(
            new FakeLocation("?rule_id=42"), new RecordingNavigator(), Localizer);

        Assert.Equal("?rule_id=42", vm.Target.Search);
        Assert.Equal("/notifications/rules?rule_id=42", vm.Display.Target.Href);
    }

    [Fact]
    public void Run_dispatches_the_resolved_target_to_the_navigator()
    {
        var navigator = new RecordingNavigator();
        var vm = new LegacyAlertRulesRedirectViewModel(new FakeLocation("?tab=history"), navigator, Localizer);

        vm.Run();

        var target = Assert.Single(navigator.Requests);
        Assert.Equal("notifications/rules", target.RoutePath);
        Assert.Equal("?tab=history", target.Search);
        Assert.True(target.Replace);
        Assert.True(vm.HasRedirected);
    }

    [Fact]
    public void Run_is_idempotent_and_navigates_exactly_once()
    {
        var navigator = new RecordingNavigator();
        var captured = new List<string>();
        var vm = new LegacyAlertRulesRedirectViewModel(
            new FakeLocation(string.Empty),
            navigator,
            Localizer,
            new LegacyAlertRulesRedirectDiagnostics(captured.Add));

        vm.Run();
        vm.Run();
        vm.Run();

        Assert.Single(navigator.Requests);
        Assert.Single(captured);
    }

    // ── Diagnostics (P1/S11): view.opened slug=LegacyAlertRulesRedirect, never the query ─────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new LegacyAlertRulesRedirectDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LegacyAlertRulesRedirect", Assert.Single(captured));
    }

    [Fact]
    public void Run_never_leaks_the_query_string_to_diagnostics()
    {
        var captured = new List<string>();
        var vm = new LegacyAlertRulesRedirectViewModel(
            new FakeLocation("?vehicle_id=7&token=secret"),
            new RecordingNavigator(),
            Localizer,
            new LegacyAlertRulesRedirectDiagnostics(captured.Add));

        vm.Run();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=LegacyAlertRulesRedirect", line);
        Assert.DoesNotContain("vehicle_id", line, StringComparison.Ordinal);
        Assert.DoesNotContain("token", line, StringComparison.Ordinal);
        Assert.DoesNotContain("secret", line, StringComparison.Ordinal);
    }

    // ── Registration metadata is stable ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_constants_are_stable()
    {
        Assert.Equal("LegacyAlertRulesRedirect", LegacyAlertRulesRedirectRegistration.Slug);
        Assert.Equal("alert-rules", LegacyAlertRulesRedirectRegistration.SourcePath);
        Assert.Equal("notifications/rules", LegacyAlertRulesRedirectRegistration.TargetRoutePath);
        Assert.Equal("/notifications/rules", LegacyAlertRulesRedirectRegistration.TargetHrefPrefix);
    }

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ProjectDisplay_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => LegacyAlertRulesRedirectProjection.ProjectDisplay(null, null!));

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() =>
            new LegacyAlertRulesRedirectViewModel(null!, new RecordingNavigator(), Localizer));
        Assert.Throws<ArgumentNullException>(() =>
            new LegacyAlertRulesRedirectViewModel(new FakeLocation(string.Empty), null!, Localizer));
        Assert.Throws<ArgumentNullException>(() =>
            new LegacyAlertRulesRedirectViewModel(new FakeLocation(string.Empty), new RecordingNavigator(), null!));
    }

    // ── Test doubles ─────────────────────────────────────────────────────────────────────────────────────

    private sealed class FakeLocation(string search) : ILegacyAlertRulesRedirectLocation
    {
        public string Search { get; } = search;
    }

    private sealed class RecordingNavigator : ILegacyAlertRulesRedirectNavigator
    {
        public List<RedirectTarget> Requests { get; } = [];

        public void Redirect(RedirectTarget target) => Requests.Add(target);
    }

    private sealed class KeyCapturingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = [];

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }
}
