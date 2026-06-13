using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using TeslaSync.App.SharedSurfaces;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the ImpersonationBanner shared surface's UI-thread-free logic — the registration metadata
/// (slug, the banner / countdown / end automation ids, the ARIA role + polite-live contract, the amber warning token
/// keys + admin glyph, the tint alphas, and the i18n keys + fallbacks the projection references), the pure
/// <see cref="ImpersonationBannerRegistration.FormatRemaining"/> countdown formatter, the pure
/// <see cref="ImpersonationBannerProjection"/> (the active-only visibility gate, the localized copy, the countdown
/// derivation, the busy-aware end label, and the accessible-name contract), the
/// <see cref="ImpersonationBannerViewModel"/> state holder (active → visible, every non-active result → hidden, the
/// active cached freshness states, the 1-second countdown tick, the end mutation success/failure flow, and the busy
/// gate), the repository <see cref="ImpersonationBannerSource"/> adapter (the status read + end mutation request
/// shapes, the open-access signal, and the 204 end body), and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/components/feedback/ImpersonationBanner.tsx). The web banner returns <c>null</c> for every non-active
/// status, so the generic loading / empty / error / inactive / open-mode data-lifecycle states deliberately collapse
/// to the hidden state; only the hidden / visible states the web actually has are reproduced, plus the freshness
/// chip the query-backed surface reaches over an active cached claim. The WinUI view itself
/// (shared-surfaces/ImpersonationBanner.cs) is exercised by the app build.
/// </summary>
public sealed class ImpersonationBannerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);
    private const string Subject = "proxy-subject-7f3a";

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("ImpersonationBanner", ImpersonationBannerRegistration.Slug);

    [Fact]
    public void Automation_ids_are_stable()
    {
        // web data-testid="impersonation-banner" plus stable ids for the countdown line and end control.
        Assert.Equal("impersonation-banner", ImpersonationBannerRegistration.BannerAutomationId);
        Assert.Equal("impersonation-banner-countdown", ImpersonationBannerRegistration.CountdownAutomationId);
        Assert.Equal("impersonation-banner-end", ImpersonationBannerRegistration.EndAutomationId);
    }

    [Fact]
    public void Role_and_live_setting_describe_a_polite_alert_region()
    {
        // web wrapper div: role="alert" aria-live="polite".
        Assert.Equal("alert", ImpersonationBannerRegistration.AlertRole);
        Assert.Equal("polite", ImpersonationBannerRegistration.LiveSetting);
    }

    [Fact]
    public void Warning_token_keys_glyph_and_tints_match_the_web_amber_accent()
    {
        Assert.Equal("TsColorWarningColor", ImpersonationBannerRegistration.WarningColorKey);
        Assert.Equal("TsColorWarningBrush", ImpersonationBannerRegistration.WarningBrushKey);
        Assert.Equal("\uE7EF", ImpersonationBannerRegistration.IdentityGlyph);
        Assert.Equal(0.12, ImpersonationBannerRegistration.BannerBackgroundOpacity);
        Assert.Equal(0.40, ImpersonationBannerRegistration.BannerBorderOpacity);
        Assert.Equal(0.20, ImpersonationBannerRegistration.IconChipOpacity);
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        Assert.Equal("translation.impersonation.banner.title", ImpersonationBannerRegistration.TitleKey);
        Assert.Equal("Impersonating {0}", ImpersonationBannerRegistration.TitleFallback);
        Assert.Equal("translation.impersonation.banner.body", ImpersonationBannerRegistration.BodyKey);
        Assert.Equal(
            "You are viewing TeslaSync as another subject. End impersonation to restore your session.",
            ImpersonationBannerRegistration.BodyFallback);
        Assert.Equal("translation.impersonation.banner.endsIn", ImpersonationBannerRegistration.EndsInKey);
        Assert.Equal("Expires in {0}", ImpersonationBannerRegistration.EndsInFallback);
        Assert.Equal("translation.impersonation.banner.expired", ImpersonationBannerRegistration.ExpiredKey);
        Assert.Equal("Session expired", ImpersonationBannerRegistration.ExpiredFallback);
        Assert.Equal("translation.impersonation.banner.ending", ImpersonationBannerRegistration.EndingKey);
        Assert.Equal("Ending\u2026", ImpersonationBannerRegistration.EndingFallback);
        Assert.Equal("translation.impersonation.banner.end", ImpersonationBannerRegistration.EndKey);
        Assert.Equal("End impersonation", ImpersonationBannerRegistration.EndFallback);
    }

    [Fact]
    public void Resolve_helpers_flow_through_the_localizer_and_interpolate()
    {
        Assert.Equal("Impersonating alice", ImpersonationBannerRegistration.ResolveTitle(Localizer, "alice"));
        Assert.Equal(
            "You are viewing TeslaSync as another subject. End impersonation to restore your session.",
            ImpersonationBannerRegistration.ResolveBody(Localizer));
        Assert.Equal("Expires in 5m 00s", ImpersonationBannerRegistration.ResolveEndsIn(Localizer, "5m 00s"));
        Assert.Equal("Session expired", ImpersonationBannerRegistration.ResolveExpired(Localizer));
        Assert.Equal("End impersonation", ImpersonationBannerRegistration.ResolveEndLabel(Localizer, isEnding: false));
        Assert.Equal("Ending\u2026", ImpersonationBannerRegistration.ResolveEndLabel(Localizer, isEnding: true));
    }

    // ── countdown formatter (web formatRemaining) ─────────────────────────────────────────────────────────

    [Theory]
    [InlineData(45, "45s")]
    [InlineData(0, "0s")]
    [InlineData(90, "1m 30s")]
    [InlineData(125, "2m 05s")]
    [InlineData(3600, "1h 00m")]
    [InlineData(3661, "1h 01m")]
    [InlineData(7320, "2h 02m")]
    public void FormatRemaining_matches_the_web_helper(int seconds, string expected) =>
        Assert.Equal(expected, ImpersonationBannerRegistration.FormatRemaining(TimeSpan.FromSeconds(seconds)));

    [Fact]
    public void FormatRemaining_floors_negative_spans_to_zero() =>
        Assert.Equal("0s", ImpersonationBannerRegistration.FormatRemaining(TimeSpan.FromSeconds(-10)));

    // ── projection (per-state) ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_is_hidden_for_a_non_active_claim()
    {
        // web: if (!isImpersonationActive(data)) return null.
        foreach (var mode in new[] { ImpersonationMode.Unknown, ImpersonationMode.Inactive })
        {
            var projection = ImpersonationBannerProjection.Project(Snapshot(mode), Now, isEnding: false, Localizer);
            Assert.False(projection.IsVisible);
        }
    }

    [Fact]
    public void Projection_is_shown_with_title_body_and_countdown_for_an_active_claim()
    {
        var snapshot = Active("alice", Now.AddMinutes(5));

        var projection = ImpersonationBannerProjection.Project(snapshot, Now, isEnding: false, Localizer);

        Assert.True(projection.IsVisible);
        Assert.Equal("alice", projection.Target);
        Assert.Equal("Impersonating alice", projection.Title);
        Assert.Equal(
            "You are viewing TeslaSync as another subject. End impersonation to restore your session.",
            projection.Body);
        Assert.True(projection.HasCountdown);
        Assert.Equal("Expires in 5m 00s", projection.Countdown);
        Assert.Equal("End impersonation", projection.EndLabel);
        Assert.Equal("polite", projection.LiveSetting);
    }

    [Fact]
    public void Projection_countdown_collapses_to_expired_at_or_below_one_second()
    {
        var atExpiry = ImpersonationBannerProjection.Project(
            Active("alice", Now.AddSeconds(1)), Now, isEnding: false, Localizer);
        Assert.True(atExpiry.HasCountdown);
        Assert.Equal("Session expired", atExpiry.Countdown);

        var pastExpiry = ImpersonationBannerProjection.Project(
            Active("alice", Now.AddSeconds(-30)), Now, isEnding: false, Localizer);
        Assert.True(pastExpiry.HasCountdown);
        Assert.Equal("Session expired", pastExpiry.Countdown);
    }

    [Fact]
    public void Projection_has_no_countdown_line_when_the_claim_has_no_parseable_expiry()
    {
        var snapshot = new ImpersonationStatusSnapshot(ImpersonationMode.Active, "root", "alice", null);

        var projection = ImpersonationBannerProjection.Project(snapshot, Now, isEnding: false, Localizer);

        Assert.True(projection.IsVisible);
        Assert.False(projection.HasCountdown);
        Assert.Equal(string.Empty, projection.Countdown);
    }

    [Fact]
    public void Projection_end_label_reflects_the_in_flight_mutation()
    {
        var snapshot = Active("alice", Now.AddMinutes(5));

        Assert.Equal(
            "End impersonation",
            ImpersonationBannerProjection.Project(snapshot, Now, isEnding: false, Localizer).EndLabel);
        Assert.Equal(
            "Ending\u2026",
            ImpersonationBannerProjection.Project(snapshot, Now, isEnding: true, Localizer).EndLabel);
    }

    [Fact]
    public void Projection_accessible_name_announces_title_body_and_countdown()
    {
        var withCountdown = ImpersonationBannerProjection.Project(
            Active("alice", Now.AddMinutes(5)), Now, isEnding: false, Localizer);
        Assert.Equal(
            "Impersonating alice. You are viewing TeslaSync as another subject. "
            + "End impersonation to restore your session. Expires in 5m 00s",
            withCountdown.AccessibleName);

        var withoutCountdown = ImpersonationBannerProjection.Project(
            new ImpersonationStatusSnapshot(ImpersonationMode.Active, "root", "alice", null),
            Now,
            isEnding: false,
            Localizer);
        Assert.Equal(
            "Impersonating alice. You are viewing TeslaSync as another subject. "
            + "End impersonation to restore your session.",
            withoutCountdown.AccessibleName);
    }

    // ── view-model (status stream → visibility) ───────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_shows_the_banner_for_an_active_claim()
    {
        using var vm = NewViewModel(Loaded(Active("alice", Now.AddMinutes(10))));

        await vm.LoadAsync();

        Assert.True(vm.IsVisible);
        Assert.Equal("Impersonating alice", vm.Title);
        Assert.True(vm.IsEndEnabled);
        Assert.True(vm.IsCountingDown);
    }

    [Theory]
    [InlineData(ImpersonationMode.Inactive)]
    [InlineData(ImpersonationMode.Unknown)]
    public async Task ViewModel_hides_the_banner_for_a_loaded_non_active_claim(ImpersonationMode mode)
    {
        using var vm = NewViewModel(Loaded(Snapshot(mode)));

        await vm.LoadAsync();

        Assert.False(vm.IsVisible);
        Assert.False(vm.IsEndEnabled);
    }

    [Fact]
    public async Task ViewModel_hides_the_banner_on_a_hard_status_failure()
    {
        using var vm = NewViewModel(
            RepositoryResult<ImpersonationStatusSnapshot>.Failure(
                new RepositoryError(RepositoryErrorKind.Server, "boom")));

        await vm.LoadAsync();

        Assert.False(vm.IsVisible);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_hides_the_banner_for_the_open_access_signal_without_flagging_error()
    {
        using var vm = NewViewModel(
            RepositoryResult<ImpersonationStatusSnapshot>.Failure(
                new RepositoryError(RepositoryErrorKind.Unknown, "open", 501, "AUTH_MODE_OPEN")));

        await vm.LoadAsync();

        Assert.False(vm.IsVisible);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_hides_the_banner_for_an_empty_body()
    {
        using var vm = NewViewModel(RepositoryResult<ImpersonationStatusSnapshot>.Empty(Now));

        await vm.LoadAsync();

        Assert.False(vm.IsVisible);
    }

    [Fact]
    public async Task ViewModel_keeps_an_active_cached_claim_visible_when_stale()
    {
        using var vm = NewViewModel(
            RepositoryResult<ImpersonationStatusSnapshot>.Cached(Active("alice", Now.AddMinutes(5)), Now, stale: true));

        await vm.LoadAsync();

        Assert.True(vm.IsVisible);
        Assert.True(vm.IsStale);
    }

    [Fact]
    public async Task ViewModel_keeps_an_active_cached_claim_visible_when_offline()
    {
        using var vm = NewViewModel(
            RepositoryResult<ImpersonationStatusSnapshot>.OfflineCached(
                Active("alice", Now.AddMinutes(5)),
                Now,
                new RepositoryError(RepositoryErrorKind.Network, "offline")));

        await vm.LoadAsync();

        Assert.True(vm.IsVisible);
        Assert.True(vm.IsOffline);
        Assert.True(vm.IsStale);
    }

    // ── view-model (countdown tick) ───────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_tick_advances_the_countdown_toward_expired()
    {
        var now = Now;
        var source = new FakeImpersonationBannerSource(Loaded(Active("alice", Now.AddSeconds(90))));
        using var vm = new ImpersonationBannerViewModel(source, Localizer, clock: () => now);

        await vm.LoadAsync();
        Assert.Equal("Expires in 1m 30s", vm.Countdown);

        now = Now.AddSeconds(60);
        vm.Tick();
        Assert.Equal("Expires in 30s", vm.Countdown);

        now = Now.AddSeconds(91);
        vm.Tick();
        Assert.Equal("Session expired", vm.Countdown);
    }

    [Fact]
    public async Task ViewModel_tick_raises_change_notification_only_when_the_countdown_changes()
    {
        var now = Now;
        var source = new FakeImpersonationBannerSource(Loaded(Active("alice", Now.AddSeconds(90))));
        using var vm = new ImpersonationBannerViewModel(source, Localizer, clock: () => now);
        await vm.LoadAsync();

        var changes = 0;
        vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(ImpersonationBannerViewModel.Countdown))
            {
                changes++;
            }
        };

        vm.Tick();                 // same second → no change
        Assert.Equal(0, changes);

        now = Now.AddSeconds(1);
        vm.Tick();                 // crossed a second → one change
        Assert.Equal(1, changes);
    }

    // ── view-model (end mutation) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_end_success_clears_the_claim_and_hides_the_banner()
    {
        var source = new FakeImpersonationBannerSource(
            endAsync: () => Task.FromResult(ImpersonationEndOutcome.Ok()),
            Loaded(Active("alice", Now.AddMinutes(5))));
        using var vm = NewViewModel(source);
        await vm.LoadAsync();
        Assert.True(vm.IsVisible);

        await vm.EndImpersonationAsync();

        Assert.Equal(1, source.EndCount);
        Assert.False(vm.IsVisible);
        Assert.False(vm.IsEnding);
    }

    [Fact]
    public async Task ViewModel_end_failure_keeps_the_banner_visible_and_re_enables_the_button()
    {
        var source = new FakeImpersonationBannerSource(
            endAsync: () => Task.FromResult(
                ImpersonationEndOutcome.Fail(new RepositoryError(RepositoryErrorKind.Server, "boom"))),
            Loaded(Active("alice", Now.AddMinutes(5))));
        using var vm = NewViewModel(source);
        await vm.LoadAsync();

        await vm.EndImpersonationAsync();

        Assert.True(vm.IsVisible);
        Assert.False(vm.IsEnding);
        Assert.True(vm.IsEndEnabled);
    }

    [Fact]
    public async Task ViewModel_marks_the_button_busy_while_the_end_mutation_runs()
    {
        var gate = new TaskCompletionSource();
        var source = new FakeImpersonationBannerSource(
            endAsync: async () =>
            {
                await gate.Task;
                return ImpersonationEndOutcome.Ok();
            },
            Loaded(Active("alice", Now.AddMinutes(5))));
        using var vm = NewViewModel(source);
        await vm.LoadAsync();

        var ending = vm.EndImpersonationAsync();
        Assert.True(vm.IsEnding);
        Assert.Equal("Ending\u2026", vm.EndLabel);
        Assert.False(vm.IsEndEnabled);

        gate.SetResult();
        await ending;

        Assert.False(vm.IsEnding);
        Assert.False(vm.IsVisible);
    }

    [Fact]
    public async Task ViewModel_end_is_a_no_op_when_no_active_claim_is_shown()
    {
        var source = new FakeImpersonationBannerSource(
            endAsync: () => Task.FromResult(ImpersonationEndOutcome.Ok()),
            Loaded(Snapshot(ImpersonationMode.Inactive)));
        using var vm = NewViewModel(source);
        await vm.LoadAsync();

        await vm.EndImpersonationAsync();

        Assert.Equal(0, source.EndCount);
    }

    // ── source adapter (cache-then-network + end) ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Source_streams_status_and_targets_the_generated_operation()
    {
        using var doc = JsonDocument.Parse(
            """{"mode":"active","target":"alice","expires_at":"2026-06-06T12:15:00Z"}""");
        var client = new FakeApiClient().ReturnsValue(doc.RootElement.Clone());
        var source = NewSource(client);

        var emissions = await Collect(source.StreamStatusAsync());

        Assert.Equal(LoadStatus.Loading, emissions[0].Status);
        Assert.Equal(LoadStatus.Loaded, emissions[^1].Status);
        Assert.Equal(ImpersonationMode.Active, emissions[^1].Value!.Mode);
        Assert.Equal("alice", emissions[^1].Value!.Target);
        Assert.Equal("get_api_v1_admin_impersonate", client.Requests[^1].OperationId);
        Assert.Equal(ImpersonationBannerSource.StatusOperation, client.Requests[^1].OperationId);
        Assert.Null(client.Requests[^1].Body);
    }

    [Fact]
    public async Task Source_open_access_501_streams_error_with_code()
    {
        var client = new FakeApiClient().Throws(new ApiException("open", 501, null, "AUTH_MODE_OPEN"));
        var source = NewSource(client);

        var emissions = await Collect(source.StreamStatusAsync());

        Assert.Equal(LoadStatus.Error, emissions[^1].Status);
        Assert.Equal("AUTH_MODE_OPEN", emissions[^1].Error!.Code);
        Assert.True(ImpersonationStatusResultMapper.IsOpenMode(emissions[^1].Error));
    }

    [Fact]
    public async Task Source_end_posts_to_the_generated_end_operation_with_no_body()
    {
        var client = new FakeApiClient().ReturnsValue<JsonNode?>(null);
        var source = NewSource(client);

        var outcome = await source.EndAsync();

        Assert.True(outcome.Success);
        Assert.Null(outcome.Error);
        var request = Assert.Single(client.Requests);
        Assert.Equal("post_api_v1_admin_impersonate_end", request.OperationId);
        Assert.Equal(ImpersonationBannerSource.EndOperation, request.OperationId);
        Assert.Null(request.Body);
    }

    [Fact]
    public async Task Source_end_failure_is_classified_not_thrown()
    {
        var client = new FakeApiClient().Throws(new ApiException("denied", 403, null, "FORBIDDEN"));
        var source = NewSource(client);

        var outcome = await source.EndAsync();

        Assert.False(outcome.Success);
        Assert.Equal(RepositoryErrorKind.Unauthorized, outcome.Error!.Kind);
    }

    // ── diagnostics (P1/S11, PII-safe) ────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_view_opened_emits_the_surface_slug()
    {
        var sink = new List<string>();
        var diagnostics = new ImpersonationBannerDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Contains("view.opened slug=ImpersonationBanner", sink);
    }

    [Fact]
    public async Task Diagnostics_record_end_resolution_without_leaking_the_subject()
    {
        var sink = new List<string>();
        var diagnostics = new ImpersonationBannerDiagnostics(sink.Add);
        var source = new FakeImpersonationBannerSource(
            endAsync: () => Task.FromResult(ImpersonationEndOutcome.Ok()),
            Loaded(Active(Subject, Now.AddMinutes(5))));
        using var vm = new ImpersonationBannerViewModel(source, Localizer, diagnostics, () => Now);
        await vm.LoadAsync();

        await vm.EndImpersonationAsync();

        Assert.Equal(1, diagnostics.EndsRequested);
        Assert.Equal(1, diagnostics.EndsSucceeded);
        Assert.Equal(0, diagnostics.EndsFailed);
        Assert.Contains("impersonation.end.requested slug=ImpersonationBanner", sink);
        Assert.Contains("impersonation.end.resolved slug=ImpersonationBanner success=true", sink);
        Assert.DoesNotContain(sink, line => line.Contains(Subject, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Diagnostics_record_a_failed_end_resolution()
    {
        var diagnostics = new ImpersonationBannerDiagnostics();
        var source = new FakeImpersonationBannerSource(
            endAsync: () => Task.FromResult(
                ImpersonationEndOutcome.Fail(new RepositoryError(RepositoryErrorKind.Server, "boom"))),
            Loaded(Active("alice", Now.AddMinutes(5))));
        using var vm = new ImpersonationBannerViewModel(source, Localizer, diagnostics, () => Now);
        await vm.LoadAsync();

        await vm.EndImpersonationAsync();

        Assert.Equal(1, diagnostics.EndsRequested);
        Assert.Equal(0, diagnostics.EndsSucceeded);
        Assert.Equal(1, diagnostics.EndsFailed);
    }

    // ── helpers ───────────────────────────────────────────────────────────────────────────────────────────

    private static ImpersonationBannerViewModel NewViewModel(
        params RepositoryResult<ImpersonationStatusSnapshot>[] status) =>
        new(new FakeImpersonationBannerSource(status), Localizer, clock: () => Now);

    private static ImpersonationBannerViewModel NewViewModel(FakeImpersonationBannerSource source) =>
        new(source, Localizer, clock: () => Now);

    private static ImpersonationBannerSource NewSource(IApiClient client)
    {
        var engine = new CacheThenNetworkEngine(new InMemoryCacheStore(), () => Now);
        var options = new ApiClientOptions { BaseAddress = new Uri("http://localhost") };
        return new ImpersonationBannerSource(client, engine, options);
    }

    private static RepositoryResult<ImpersonationStatusSnapshot> Loaded(ImpersonationStatusSnapshot snapshot) =>
        RepositoryResult<ImpersonationStatusSnapshot>.Loaded(snapshot, Now);

    private static ImpersonationStatusSnapshot Snapshot(ImpersonationMode mode) =>
        new(mode, null, null, null);

    private static ImpersonationStatusSnapshot Active(string target, DateTimeOffset expiresAt) =>
        new(ImpersonationMode.Active, "root", target, expiresAt.ToString("O"));

    private static async Task<IReadOnlyList<RepositoryResult<ImpersonationStatusSnapshot>>> Collect(
        IAsyncEnumerable<RepositoryResult<ImpersonationStatusSnapshot>> stream)
    {
        var list = new List<RepositoryResult<ImpersonationStatusSnapshot>>();
        await foreach (var item in stream)
        {
            list.Add(item);
        }

        return list;
    }

    private sealed class FakeImpersonationBannerSource : IImpersonationBannerSource
    {
        private readonly IReadOnlyList<RepositoryResult<ImpersonationStatusSnapshot>> _status;
        private readonly Func<Task<ImpersonationEndOutcome>>? _endAsync;

        public FakeImpersonationBannerSource(params RepositoryResult<ImpersonationStatusSnapshot>[] status)
            : this(endAsync: null, status)
        {
        }

        public FakeImpersonationBannerSource(
            Func<Task<ImpersonationEndOutcome>>? endAsync,
            params RepositoryResult<ImpersonationStatusSnapshot>[] status)
        {
            _status = status;
            _endAsync = endAsync;
        }

        public int EndCount { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<ImpersonationStatusSnapshot>> StreamStatusAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var result in _status)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return result;
                await Task.Yield();
            }
        }

        public Task<ImpersonationEndOutcome> EndAsync(CancellationToken cancellationToken = default)
        {
            EndCount++;
            return _endAsync?.Invoke() ?? Task.FromResult(ImpersonationEndOutcome.Ok());
        }
    }
}
