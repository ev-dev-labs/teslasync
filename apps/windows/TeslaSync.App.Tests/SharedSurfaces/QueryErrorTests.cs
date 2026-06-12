using TeslaSync.App.Core.Lifecycle;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the QueryError shared surface's UI-thread-free logic — the registration metadata
/// (slug, the card / action automation ids, the ARIA role/live contract, the login route, the per-branch Segoe
/// glyphs incl. the waiting Clock, the rose tint recipe and the i18n keys + fallbacks the projection references),
/// the pure transient-waiting/status-&gt;kind and offline classification, the per-state
/// <see cref="QueryErrorProjection"/> (waiting / 404 / 401 / 403 / 5xx / unreachable / offline, incl. the CTA
/// presence + enabled + navigation target + reconnect-auto-retry arming + accessible-name contract), the
/// <see cref="QueryErrorViewModel"/> state holder (initial hidden state, reprojection on error + connectivity
/// change, CTA dispatch to the retry callback / navigator, the connection-restored auto-retry, clear, subscription
/// cleanup), the static / network connectivity seams, the recording / delegate navigators, and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/components/feedback/QueryError.tsx + _ErrorState.tsx). The WinUI view
/// itself (shared-surfaces/QueryError.cs) is exercised by the app build.
/// </summary>
public sealed class QueryErrorTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static QueryErrorProjection Project(
        int? status,
        bool transientWaiting = false,
        bool isOnline = true,
        bool canRetry = false,
        string? resourceName = null,
        string? listHref = null) =>
        QueryErrorProjection.Project(
            QueryErrorRequest.ForError(transientWaiting, status, canRetry, resourceName, listHref),
            isOnline,
            Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("QueryError", QueryErrorRegistration.Slug);

    [Fact]
    public void Automation_ids_are_stable()
    {
        Assert.Equal("query-error", QueryErrorRegistration.CardAutomationId);
        Assert.Equal("query-error-action", QueryErrorRegistration.ActionAutomationId);
    }

    [Fact]
    public void Role_and_live_constants_match_the_web_aria_contract()
    {
        Assert.Equal("alert", QueryErrorRegistration.RoleAlert);
        Assert.Equal("status", QueryErrorRegistration.RoleStatus);
        Assert.Equal("assertive", QueryErrorRegistration.LiveAssertive);
        Assert.Equal("polite", QueryErrorRegistration.LivePolite);
    }

    [Fact]
    public void Login_route_matches_the_web_redirect() =>
        Assert.Equal("/login", QueryErrorRegistration.LoginRoute);

    [Fact]
    public void Glyphs_match_the_shared_fluent_stand_ins()
    {
        Assert.Equal("\uE121", QueryErrorRegistration.WaitingGlyph);
        Assert.Equal("\uE897", QueryErrorRegistration.NotFoundGlyph);
        Assert.Equal("\uE72E", QueryErrorRegistration.UnauthorizedGlyph);
        Assert.Equal("\uE968", QueryErrorRegistration.ServerErrorGlyph);
        Assert.Equal("\uE783", QueryErrorRegistration.NetworkErrorGlyph);
        Assert.Equal("\uEB5E", QueryErrorRegistration.NetworkOfflineGlyph);
    }

    [Fact]
    public void Card_tint_recipe_matches_the_web_rose_alphas()
    {
        Assert.Equal("TsColorDangerColor", QueryErrorRegistration.DangerColorKey);
        Assert.Equal("TsColorDangerBrush", QueryErrorRegistration.DangerBrushKey);
        Assert.Equal(0.05, QueryErrorRegistration.CardBackgroundOpacity);
        Assert.Equal(0.20, QueryErrorRegistration.CardBorderOpacity);
        Assert.Equal(0.10, QueryErrorRegistration.IconChipOpacity);
        Assert.Equal(0.70, QueryErrorRegistration.MessageForegroundOpacity);
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        Assert.Equal("translation.error.waiting.title", QueryErrorRegistration.WaitingTitleKey);
        Assert.Equal("Waiting for upstream", QueryErrorRegistration.WaitingTitleFallback);
        Assert.Equal("translation.error.waiting.message", QueryErrorRegistration.WaitingMessageKey);
        Assert.Equal("We're pausing requests briefly. Data will refresh automatically.", QueryErrorRegistration.WaitingMessageFallback);

        Assert.Equal("translation.error.notFound.title", QueryErrorRegistration.NotFoundTitleKey);
        Assert.Equal("{0} not found", QueryErrorRegistration.NotFoundTitleFallback);
        Assert.Equal("translation.error.notFound.message", QueryErrorRegistration.NotFoundMessageKey);
        Assert.Equal("It may have been deleted or the link is wrong.", QueryErrorRegistration.NotFoundMessageFallback);
        Assert.Equal("translation.error.notFound.thingDefault", QueryErrorRegistration.NotFoundThingDefaultKey);
        Assert.Equal("Resource", QueryErrorRegistration.NotFoundThingDefaultFallback);
        Assert.Equal("translation.error.notFound.cta", QueryErrorRegistration.NotFoundCtaKey);
        Assert.Equal("Back to list", QueryErrorRegistration.NotFoundCtaFallback);

        Assert.Equal("translation.error.unauthorized.title", QueryErrorRegistration.UnauthorizedTitleKey);
        Assert.Equal("Sign in required", QueryErrorRegistration.UnauthorizedTitleFallback);
        Assert.Equal("translation.error.unauthorized.message", QueryErrorRegistration.UnauthorizedMessageKey);
        Assert.Equal("Your session has expired. Please sign in again.", QueryErrorRegistration.UnauthorizedMessageFallback);
        Assert.Equal("translation.error.unauthorized.cta", QueryErrorRegistration.UnauthorizedCtaKey);
        Assert.Equal("Sign in", QueryErrorRegistration.UnauthorizedCtaFallback);

        Assert.Equal("translation.error.serverError.title", QueryErrorRegistration.ServerErrorTitleKey);
        Assert.Equal("Server error", QueryErrorRegistration.ServerErrorTitleFallback);
        Assert.Equal("translation.error.serverError.message", QueryErrorRegistration.ServerErrorMessageKey);
        Assert.Equal("Something went wrong on our end. Please try again.", QueryErrorRegistration.ServerErrorMessageFallback);

        Assert.Equal("translation.error.network.offlineTitle", QueryErrorRegistration.NetworkOfflineTitleKey);
        Assert.Equal("You're offline", QueryErrorRegistration.NetworkOfflineTitleFallback);
        Assert.Equal("translation.error.network.title", QueryErrorRegistration.NetworkTitleKey);
        Assert.Equal("Can't reach server", QueryErrorRegistration.NetworkTitleFallback);
        Assert.Equal("translation.error.network.offlineDetail", QueryErrorRegistration.NetworkOfflineDetailKey);
        Assert.Equal("We'll retry automatically when your connection returns.", QueryErrorRegistration.NetworkOfflineDetailFallback);
        Assert.Equal("translation.error.network.message", QueryErrorRegistration.NetworkMessageKey);
        Assert.Equal("Check your internet connection and try again.", QueryErrorRegistration.NetworkMessageFallback);
        Assert.Equal("translation.error.network.retryWhenOnline", QueryErrorRegistration.NetworkRetryWhenOnlineKey);
        Assert.Equal("Retry when online", QueryErrorRegistration.NetworkRetryWhenOnlineFallback);

        Assert.Equal("translation.error.retry", QueryErrorRegistration.RetryKey);
        Assert.Equal("Retry", QueryErrorRegistration.RetryFallback);
    }

    // ── transient-waiting / status classification ─────────────────────────────────────────────────────────

    [Theory]
    [InlineData(404, QueryErrorKind.NotFound)]
    [InlineData(401, QueryErrorKind.Unauthorized)]
    [InlineData(403, QueryErrorKind.Unauthorized)]
    [InlineData(500, QueryErrorKind.ServerError)]
    [InlineData(503, QueryErrorKind.ServerError)]
    [InlineData(599, QueryErrorKind.ServerError)]
    [InlineData(429, QueryErrorKind.Network)]
    [InlineData(400, QueryErrorKind.Network)]
    [InlineData(418, QueryErrorKind.Network)]
    [InlineData(0, QueryErrorKind.Network)]
    [InlineData(null, QueryErrorKind.Network)]
    public void ClassifyKind_without_waiting_matches_the_web_status_ladder(int? status, QueryErrorKind expected) =>
        Assert.Equal(expected, QueryErrorRegistration.ClassifyKind(transientWaiting: false, status));

    [Theory]
    [InlineData(429)]
    [InlineData(503)]
    [InlineData(404)]
    [InlineData(500)]
    [InlineData(null)]
    public void ClassifyKind_with_waiting_wins_over_every_status(int? status) =>
        Assert.Equal(QueryErrorKind.Waiting, QueryErrorRegistration.ClassifyKind(transientWaiting: true, status));

    [Theory]
    [InlineData(200, true, false)]
    [InlineData(200, false, true)]
    [InlineData(0, true, true)]
    [InlineData(0, false, true)]
    [InlineData(null, true, false)]
    [InlineData(null, false, true)]
    public void IsOffline_matches_the_web_offline_predicate(int? status, bool isOnline, bool expected) =>
        Assert.Equal(expected, QueryErrorRegistration.IsOffline(status, isOnline));

    [Theory]
    [InlineData(QueryErrorKind.Waiting, false, "\uE121")]
    [InlineData(QueryErrorKind.NotFound, false, "\uE897")]
    [InlineData(QueryErrorKind.Unauthorized, false, "\uE72E")]
    [InlineData(QueryErrorKind.ServerError, false, "\uE968")]
    [InlineData(QueryErrorKind.Network, false, "\uE783")]
    [InlineData(QueryErrorKind.Network, true, "\uEB5E")]
    public void GlyphFor_maps_each_branch_to_its_glyph(QueryErrorKind kind, bool offline, string expected) =>
        Assert.Equal(expected, QueryErrorRegistration.GlyphFor(kind, offline));

    // ── projection: hidden ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_is_hidden_when_no_error()
    {
        var projection = QueryErrorProjection.Project(QueryErrorRequest.None, isOnline: true, Localizer);

        Assert.False(projection.IsVisible);
        Assert.False(projection.HasAction);
        Assert.False(projection.AutoRetryEligible);
    }

    [Fact]
    public void Projection_throws_when_request_is_null() =>
        Assert.Throws<ArgumentNullException>(() => QueryErrorProjection.Project(null!, true, Localizer));

    [Fact]
    public void Projection_throws_when_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(() => QueryErrorProjection.Project(QueryErrorRequest.None, true, null!));

    // ── projection: waiting (transient) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Waiting_renders_the_calm_status_card_without_an_action()
    {
        var projection = Project(status: 429, transientWaiting: true, canRetry: true);

        Assert.True(projection.IsVisible);
        Assert.Equal(QueryErrorKind.Waiting, projection.Kind);
        Assert.Equal("\uE121", projection.IconGlyph);
        Assert.Equal("Waiting for upstream", projection.Title);
        Assert.Equal("We're pausing requests briefly. Data will refresh automatically.", projection.Message);
        Assert.Equal(QueryErrorActionKind.None, projection.ActionKind);
        Assert.False(projection.HasAction);
        Assert.Equal("status", projection.Role);
        Assert.Equal("polite", projection.LiveSetting);
    }

    [Theory]
    [InlineData(503)]
    [InlineData(404)]
    [InlineData(500)]
    public void Waiting_wins_over_the_status_ladder(int status)
    {
        var projection = Project(status: status, transientWaiting: true);

        Assert.Equal(QueryErrorKind.Waiting, projection.Kind);
        Assert.Equal("Waiting for upstream", projection.Title);
        Assert.False(projection.HasAction);
    }

    [Fact]
    public void Waiting_with_a_status_does_not_arm_the_reconnect_auto_retry()
    {
        // web reconnect guard requires status === undefined; a rate-limit (429) / breaker (503) wait carries one.
        var projection = Project(status: 503, transientWaiting: true, isOnline: false, canRetry: true);

        Assert.Equal(QueryErrorKind.Waiting, projection.Kind);
        Assert.False(projection.AutoRetryEligible);
    }

    // ── projection: 404 not found ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void NotFound_with_resource_name_and_list_href_renders_back_to_list()
    {
        var projection = Project(404, resourceName: "Vehicle", listHref: "/vehicles");

        Assert.True(projection.IsVisible);
        Assert.Equal(QueryErrorKind.NotFound, projection.Kind);
        Assert.Equal("\uE897", projection.IconGlyph);
        Assert.Equal("Vehicle not found", projection.Title);
        Assert.Equal("It may have been deleted or the link is wrong.", projection.Message);
        Assert.Equal(QueryErrorActionKind.BackToList, projection.ActionKind);
        Assert.Equal("Back to list", projection.ActionLabel);
        Assert.True(projection.ActionEnabled);
        Assert.Equal("/vehicles", projection.NavigationTarget);
        Assert.Equal("alert", projection.Role);
        Assert.Equal("assertive", projection.LiveSetting);
    }

    [Fact]
    public void NotFound_without_resource_name_uses_the_default_noun()
    {
        var projection = Project(404, listHref: "/vehicles");

        Assert.Equal("Resource not found", projection.Title);
    }

    [Fact]
    public void NotFound_without_list_href_has_no_action()
    {
        var projection = Project(404, resourceName: "Drive");

        Assert.True(projection.IsVisible);
        Assert.Equal("Drive not found", projection.Title);
        Assert.Equal(QueryErrorActionKind.None, projection.ActionKind);
        Assert.False(projection.HasAction);
        Assert.Equal(string.Empty, projection.NavigationTarget);
    }

    // ── projection: 401 / 403 unauthorized ────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(401)]
    [InlineData(403)]
    public void Unauthorized_renders_sign_in_targeting_login(int status)
    {
        var projection = Project(status);

        Assert.Equal(QueryErrorKind.Unauthorized, projection.Kind);
        Assert.Equal("\uE72E", projection.IconGlyph);
        Assert.Equal("Sign in required", projection.Title);
        Assert.Equal("Your session has expired. Please sign in again.", projection.Message);
        Assert.Equal(QueryErrorActionKind.SignIn, projection.ActionKind);
        Assert.Equal("Sign in", projection.ActionLabel);
        Assert.True(projection.ActionEnabled);
        Assert.Equal("/login", projection.NavigationTarget);
        Assert.Equal("alert", projection.Role);
        Assert.Equal("assertive", projection.LiveSetting);
    }

    // ── projection: 5xx server error ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void ServerError_with_retry_renders_retry()
    {
        var projection = Project(500, canRetry: true);

        Assert.Equal(QueryErrorKind.ServerError, projection.Kind);
        Assert.Equal("\uE968", projection.IconGlyph);
        Assert.Equal("Server error", projection.Title);
        Assert.Equal("Something went wrong on our end. Please try again.", projection.Message);
        Assert.Equal(QueryErrorActionKind.Retry, projection.ActionKind);
        Assert.Equal("Retry", projection.ActionLabel);
        Assert.True(projection.ActionEnabled);
        Assert.Equal("alert", projection.Role);
    }

    [Fact]
    public void ServerError_without_retry_has_no_action()
    {
        var projection = Project(503);

        Assert.Equal("Server error", projection.Title);
        Assert.Equal(QueryErrorActionKind.None, projection.ActionKind);
        Assert.False(projection.HasAction);
    }

    // ── projection: network (unreachable / offline) ───────────────────────────────────────────────────────

    [Fact]
    public void Network_online_renders_unreachable_with_enabled_retry()
    {
        var projection = Project(null, isOnline: true, canRetry: true);

        Assert.Equal(QueryErrorKind.Network, projection.Kind);
        Assert.False(projection.IsOffline);
        Assert.Equal("\uE783", projection.IconGlyph);
        Assert.Equal("Can't reach server", projection.Title);
        Assert.Equal("Check your internet connection and try again.", projection.Message);
        Assert.Equal(QueryErrorActionKind.Retry, projection.ActionKind);
        Assert.Equal("Retry", projection.ActionLabel);
        Assert.True(projection.ActionEnabled);
        Assert.False(projection.AutoRetryEligible);
        Assert.Equal("alert", projection.Role);
        Assert.Equal("assertive", projection.LiveSetting);
    }

    [Fact]
    public void Network_offline_renders_offline_with_disabled_retry_when_online()
    {
        var projection = Project(null, isOnline: false, canRetry: true);

        Assert.Equal(QueryErrorKind.Network, projection.Kind);
        Assert.True(projection.IsOffline);
        Assert.Equal("\uEB5E", projection.IconGlyph);
        Assert.Equal("You're offline", projection.Title);
        Assert.Equal("We'll retry automatically when your connection returns.", projection.Message);
        Assert.Equal(QueryErrorActionKind.RetryWhenOnline, projection.ActionKind);
        Assert.Equal("Retry when online", projection.ActionLabel);
        Assert.False(projection.ActionEnabled);
        Assert.True(projection.AutoRetryEligible);
        Assert.Equal("status", projection.Role);
        Assert.Equal("polite", projection.LiveSetting);
    }

    [Fact]
    public void Network_offline_without_retry_still_renders_offline_copy_without_action_or_auto_retry()
    {
        var projection = Project(null, isOnline: false);

        Assert.True(projection.IsOffline);
        Assert.Equal("You're offline", projection.Title);
        Assert.Equal(QueryErrorActionKind.None, projection.ActionKind);
        Assert.False(projection.HasAction);
        Assert.False(projection.AutoRetryEligible);
    }

    [Fact]
    public void Network_status_zero_is_offline_but_does_not_arm_auto_retry()
    {
        // web: status === 0 is offline, but the reconnect guard (status !== undefined) excludes it from auto-retry.
        var projection = Project(0, isOnline: true, canRetry: true);

        Assert.True(projection.IsOffline);
        Assert.Equal("\uEB5E", projection.IconGlyph);
        Assert.Equal(QueryErrorActionKind.RetryWhenOnline, projection.ActionKind);
        Assert.False(projection.AutoRetryEligible);
    }

    // ── projection: reconnect auto-retry arming ───────────────────────────────────────────────────────────

    [Fact]
    public void Auto_retry_is_armed_only_for_an_offline_non_api_error_with_retry()
    {
        Assert.True(Project(null, isOnline: false, canRetry: true).AutoRetryEligible);
        Assert.False(Project(null, isOnline: true, canRetry: true).AutoRetryEligible);   // online
        Assert.False(Project(null, isOnline: false).AutoRetryEligible);                  // no retry
        Assert.False(Project(0, isOnline: false, canRetry: true).AutoRetryEligible);     // status-bearing
        Assert.False(Project(500, isOnline: false, canRetry: true).AutoRetryEligible);   // status-bearing
    }

    // ── projection: accessibility ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Accessible_name_is_the_title_and_message_together()
    {
        var projection = Project(500, canRetry: true);

        Assert.Equal("Server error Something went wrong on our end. Please try again.", projection.AccessibleName);
    }

    [Fact]
    public void Every_visible_branch_has_a_non_empty_accessible_name()
    {
        // a11y: a screen reader always has something to announce in every state, action or not.
        QueryErrorProjection[] branches =
        [
            Project(429, transientWaiting: true),
            Project(404, listHref: "/x"),
            Project(401),
            Project(500, canRetry: true),
            Project(null, isOnline: true, canRetry: true),
            Project(null, isOnline: false, canRetry: true),
        ];

        foreach (var projection in branches)
        {
            Assert.True(projection.IsVisible);
            Assert.False(string.IsNullOrWhiteSpace(projection.AccessibleName));
        }
    }

    [Fact]
    public void Every_actionable_branch_carries_a_labelled_action()
    {
        QueryErrorProjection[] actionable =
        [
            Project(404, listHref: "/x"),
            Project(401),
            Project(500, canRetry: true),
            Project(null, isOnline: true, canRetry: true),
            Project(null, isOnline: false, canRetry: true),
        ];

        foreach (var projection in actionable)
        {
            Assert.True(projection.HasAction);
            Assert.False(string.IsNullOrWhiteSpace(projection.ActionLabel));
        }
    }

    // ── view-model ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void View_model_starts_hidden()
    {
        using var vm = new QueryErrorViewModel(Localizer, new StaticQueryErrorConnectivitySource(), new RecordingQueryErrorNavigator());

        Assert.False(vm.IsVisible);
        Assert.False(vm.Projection.HasAction);
    }

    [Fact]
    public void View_model_projects_an_error_and_raises_change()
    {
        using var vm = new QueryErrorViewModel(Localizer, new StaticQueryErrorConnectivitySource(), new RecordingQueryErrorNavigator());
        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        vm.SetError(transientWaiting: false, status: 404, resourceName: "Vehicle", listHref: "/vehicles");

        Assert.True(vm.IsVisible);
        Assert.Equal("Vehicle not found", vm.Projection.Title);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void View_model_projects_the_waiting_card()
    {
        using var vm = new QueryErrorViewModel(Localizer, new StaticQueryErrorConnectivitySource(), new RecordingQueryErrorNavigator());

        vm.SetError(transientWaiting: true, status: 429, onRetry: () => { });

        Assert.Equal(QueryErrorKind.Waiting, vm.Projection.Kind);
        Assert.Equal("Waiting for upstream", vm.Projection.Title);
        Assert.False(vm.Projection.HasAction);
    }

    [Fact]
    public void View_model_reprojects_when_connectivity_changes_for_the_network_branch()
    {
        var connectivity = new StaticQueryErrorConnectivitySource(isOnline: true);
        using var vm = new QueryErrorViewModel(Localizer, connectivity, new RecordingQueryErrorNavigator());
        vm.SetError(transientWaiting: false, status: null, onRetry: () => { });
        Assert.False(vm.Projection.IsOffline);
        Assert.Equal("Can't reach server", vm.Projection.Title);

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;
        connectivity.Set(false);

        Assert.True(vm.Projection.IsOffline);
        Assert.Equal("You're offline", vm.Projection.Title);
        Assert.Equal(QueryErrorActionKind.RetryWhenOnline, vm.Projection.ActionKind);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void View_model_back_to_list_navigates_to_the_list_route()
    {
        var navigator = new RecordingQueryErrorNavigator();
        using var vm = new QueryErrorViewModel(Localizer, new StaticQueryErrorConnectivitySource(), navigator);
        vm.SetError(transientWaiting: false, status: 404, resourceName: "Drive", listHref: "/drives");

        vm.InvokeAction();

        Assert.Equal(new[] { "/drives" }, navigator.ListNavigations);
        Assert.Equal(0, navigator.SignInCount);
    }

    [Fact]
    public void View_model_sign_in_invokes_the_navigator()
    {
        var navigator = new RecordingQueryErrorNavigator();
        using var vm = new QueryErrorViewModel(Localizer, new StaticQueryErrorConnectivitySource(), navigator);
        vm.SetError(transientWaiting: false, status: 401);

        vm.InvokeAction();

        Assert.Equal(1, navigator.SignInCount);
        Assert.Empty(navigator.ListNavigations);
    }

    [Fact]
    public void View_model_retry_invokes_the_handler_when_enabled()
    {
        var retried = 0;
        using var vm = new QueryErrorViewModel(Localizer, new StaticQueryErrorConnectivitySource(), new RecordingQueryErrorNavigator());
        vm.SetError(transientWaiting: false, status: 500, onRetry: () => retried++);

        vm.InvokeAction();

        Assert.Equal(1, retried);
    }

    [Fact]
    public void View_model_offline_retry_is_disabled_and_does_not_invoke_the_handler()
    {
        var retried = 0;
        using var vm = new QueryErrorViewModel(Localizer, new StaticQueryErrorConnectivitySource(isOnline: false), new RecordingQueryErrorNavigator());
        vm.SetError(transientWaiting: false, status: null, onRetry: () => retried++);
        Assert.Equal(QueryErrorActionKind.RetryWhenOnline, vm.Projection.ActionKind);
        Assert.False(vm.Projection.ActionEnabled);

        vm.InvokeAction();

        Assert.Equal(0, retried);
    }

    [Fact]
    public void View_model_auto_retries_once_when_the_connection_returns()
    {
        var connectivity = new StaticQueryErrorConnectivitySource(isOnline: false);
        var retried = 0;
        using var vm = new QueryErrorViewModel(Localizer, connectivity, new RecordingQueryErrorNavigator());
        vm.SetError(transientWaiting: false, status: null, onRetry: () => retried++);
        Assert.True(vm.Projection.AutoRetryEligible);

        connectivity.Set(true);

        Assert.Equal(1, retried);
        Assert.False(vm.Projection.AutoRetryEligible);
        Assert.Equal("Can't reach server", vm.Projection.Title);
    }

    [Fact]
    public void View_model_auto_retry_re_arms_for_each_offline_to_online_cycle()
    {
        var connectivity = new StaticQueryErrorConnectivitySource(isOnline: false);
        var retried = 0;
        using var vm = new QueryErrorViewModel(Localizer, connectivity, new RecordingQueryErrorNavigator());
        vm.SetError(transientWaiting: false, status: null, onRetry: () => retried++);

        connectivity.Set(true);   // first reconnect → fires
        connectivity.Set(false);  // back offline → re-arms
        connectivity.Set(true);   // second reconnect → fires again

        Assert.Equal(2, retried);
    }

    [Fact]
    public void View_model_does_not_auto_retry_for_a_status_bearing_offline_error()
    {
        // web reconnect guard excludes any error carrying a status (incl. status 0 / 5xx).
        var connectivity = new StaticQueryErrorConnectivitySource(isOnline: false);
        var retried = 0;
        using var vm = new QueryErrorViewModel(Localizer, connectivity, new RecordingQueryErrorNavigator());
        vm.SetError(transientWaiting: false, status: 0, onRetry: () => retried++);
        Assert.False(vm.Projection.AutoRetryEligible);

        connectivity.Set(true);

        Assert.Equal(0, retried);
    }

    [Fact]
    public void View_model_does_not_auto_retry_without_a_handler()
    {
        var connectivity = new StaticQueryErrorConnectivitySource(isOnline: false);
        using var vm = new QueryErrorViewModel(Localizer, connectivity, new RecordingQueryErrorNavigator());
        vm.SetError(transientWaiting: false, status: null);
        Assert.False(vm.Projection.AutoRetryEligible);

        // No handler and no throw when the connection returns.
        connectivity.Set(true);

        Assert.False(vm.Projection.IsOffline);
    }

    [Fact]
    public void View_model_clear_hides_the_surface()
    {
        using var vm = new QueryErrorViewModel(Localizer, new StaticQueryErrorConnectivitySource(), new RecordingQueryErrorNavigator());
        vm.SetError(transientWaiting: false, status: 500, onRetry: () => { });
        Assert.True(vm.IsVisible);

        vm.Clear();

        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void View_model_unsubscribes_on_dispose()
    {
        var connectivity = new StaticQueryErrorConnectivitySource(isOnline: true);
        var vm = new QueryErrorViewModel(Localizer, connectivity, new RecordingQueryErrorNavigator());
        vm.SetError(transientWaiting: false, status: null, onRetry: () => { });
        vm.Dispose();

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;
        connectivity.Set(false);

        Assert.Equal(0, raised);
    }

    // ── sources ───────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Static_connectivity_source_raises_only_on_change()
    {
        var source = new StaticQueryErrorConnectivitySource(isOnline: true);
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.Set(true);
        Assert.Equal(0, raised);

        source.Set(false);
        Assert.False(source.IsOnline);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void Network_connectivity_source_tracks_availability()
    {
        var availability = new FakeNetworkAvailability(online: true);
        using var source = new NetworkQueryErrorConnectivitySource(availability);
        Assert.True(source.IsOnline);

        var raised = 0;
        source.Changed += (_, _) => raised++;
        availability.Set(false);

        Assert.False(source.IsOnline);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void Network_connectivity_source_detaches_on_dispose()
    {
        var availability = new FakeNetworkAvailability(online: true);
        var source = new NetworkQueryErrorConnectivitySource(availability);
        source.Dispose();

        var raised = 0;
        source.Changed += (_, _) => raised++;
        availability.Set(false);

        Assert.Equal(0, raised);
    }

    // ── navigators ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Recording_navigator_records_each_request()
    {
        var navigator = new RecordingQueryErrorNavigator();

        navigator.NavigateToList("/a");
        navigator.NavigateToList("/b");
        navigator.NavigateToSignIn();

        Assert.Equal(new[] { "/a", "/b" }, navigator.ListNavigations);
        Assert.Equal(1, navigator.SignInCount);
    }

    [Fact]
    public void Delegate_navigator_forwards_to_the_supplied_delegates()
    {
        string? listed = null;
        var signedIn = 0;
        var navigator = new DelegateQueryErrorNavigator(r => listed = r, () => signedIn++);

        navigator.NavigateToList("/vehicles");
        navigator.NavigateToSignIn();

        Assert.Equal("/vehicles", listed);
        Assert.Equal(1, signedIn);
    }

    [Fact]
    public void Delegate_navigator_validates_its_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => new DelegateQueryErrorNavigator(null!, () => { }));
        Assert.Throws<ArgumentNullException>(() => new DelegateQueryErrorNavigator(_ => { }, null!));

        var navigator = new DelegateQueryErrorNavigator(_ => { }, () => { });
        Assert.Throws<ArgumentException>(() => navigator.NavigateToList(string.Empty));
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_only_the_view_opened_event_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new QueryErrorDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(new[] { "view.opened slug=QueryError", "view.opened slug=QueryError" }, lines);
    }

    private sealed class FakeNetworkAvailability : INetworkAvailability
    {
        private bool _online;

        public FakeNetworkAvailability(bool online) => _online = online;

        public event Action<bool>? AvailabilityChanged;

        public bool IsOnline => _online;

        public void Set(bool online)
        {
            _online = online;
            AvailabilityChanged?.Invoke(online);
        }
    }
}
