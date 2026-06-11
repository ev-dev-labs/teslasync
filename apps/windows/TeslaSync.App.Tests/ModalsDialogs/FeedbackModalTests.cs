using System.Net.Http;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Push;
using TeslaSync.App.ModalsDialogs;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the FeedbackModal surface's UI-thread-free logic — the category wire mapping, the
/// option / zod title-body validation / console-tail slicing / payload projections, the contract-client-backed
/// submit source's request shape and error classification (the web <c>useSubmitFeedback</c> adapter), the
/// auto-attached-context source + in-memory diagnostics ring (the web <c>useLocation</c> + <c>errorReporter</c>
/// adapter), the state-holder view-model's per-state flows (idle / context-capture / validation / submitting /
/// success-and-close / failure, plus the toast + close contract that mirrors <c>useSubmitFeedback</c> +
/// <c>onClose</c>), the i18n key + fallback contract that doubles as the Narrator-label source, and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/components/feedback/FeedbackModal.tsx +
/// web/src/api/hooks/useFeedback.ts). The WinUI view itself (FeedbackModal.cs) is exercised by the app build.
/// </summary>
public sealed class FeedbackModalTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── Wire mapping (web category union) ────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(FeedbackCategory.Bug, "bug")]
    [InlineData(FeedbackCategory.Feature, "feature")]
    [InlineData(FeedbackCategory.Other, "other")]
    public void Category_round_trips_through_wire(FeedbackCategory category, string wire)
    {
        Assert.Equal(wire, FeedbackCategories.ToWire(category));
        Assert.True(FeedbackCategories.TryFromWire(wire, out var parsed));
        Assert.Equal(category, parsed);
    }

    [Fact]
    public void Wire_from_unknown_token_is_false_and_defaults()
    {
        Assert.False(FeedbackCategories.TryFromWire("nope", out var category));
        Assert.Equal(FeedbackCategory.Bug, category);
    }

    // ── Projection: options ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void CategoryOptions_are_the_three_values_in_web_order_with_labels()
    {
        var options = FeedbackModalProjection.CategoryOptions(Localizer);

        Assert.Equal(
            [FeedbackCategory.Bug, FeedbackCategory.Feature, FeedbackCategory.Other],
            options.Select(o => o.Value).ToArray());
        Assert.Equal(
            ["Bug report", "Feature request", "Other / question"],
            options.Select(o => o.Label).ToArray());
    }

    // ── Projection: validation (web zod [5,120] / [20,4000]) ─────────────────────────────────────────────

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData("abcd", false)]
    [InlineData("  abcd  ", false)]
    [InlineData("abcde", true)]
    [InlineData("  abcde  ", true)]
    public void IsTitleValid_enforces_the_five_char_minimum(string? title, bool valid) =>
        Assert.Equal(valid, FeedbackModalProjection.IsTitleValid(title));

    [Fact]
    public void IsTitleValid_enforces_the_120_char_maximum()
    {
        Assert.True(FeedbackModalProjection.IsTitleValid(new string('a', 120)));
        Assert.False(FeedbackModalProjection.IsTitleValid(new string('a', 121)));
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("nineteen chars long", false)]
    [InlineData("twenty characters ok", true)]
    public void IsBodyValid_enforces_the_twenty_char_minimum(string? body, bool valid) =>
        Assert.Equal(valid, FeedbackModalProjection.IsBodyValid(body));

    [Fact]
    public void IsBodyValid_enforces_the_4000_char_maximum()
    {
        Assert.True(FeedbackModalProjection.IsBodyValid(new string('b', 4000)));
        Assert.False(FeedbackModalProjection.IsBodyValid(new string('b', 4001)));
    }

    [Fact]
    public void IsValid_requires_both_title_and_body()
    {
        Assert.False(FeedbackModalProjection.IsValid("hello", "too short"));
        Assert.False(FeedbackModalProjection.IsValid("hi", "this body is long enough to pass"));
        Assert.True(FeedbackModalProjection.IsValid("hello", "this body is long enough to pass"));
    }

    // ── Projection: console-tail slicing (web getConsoleTail) ────────────────────────────────────────────

    [Fact]
    public void TruncateConsoleTail_returns_short_input_unchanged() =>
        Assert.Equal("a short tail", FeedbackModalProjection.TruncateConsoleTail("a short tail"));

    [Fact]
    public void TruncateConsoleTail_keeps_the_last_4000_chars_newest_last()
    {
        string tail = new string('x', 3000) + new string('y', 2000);
        string sliced = FeedbackModalProjection.TruncateConsoleTail(tail);

        Assert.Equal(4000, sliced.Length);
        Assert.EndsWith(new string('y', 2000), sliced, StringComparison.Ordinal);
        Assert.Equal(2000, sliced.TakeWhile(c => c == 'x').Count());
    }

    // ── Projection: payload assembly (web submit.mutateAsync object) ─────────────────────────────────────

    [Fact]
    public void BuildRequest_trims_title_body_and_maps_context()
    {
        var context = new FeedbackContext("/battery", "1.2.3.0", "windows \u00B7 en-US", Array.Empty<FeedbackErrorReport>(), string.Empty);

        var request = FeedbackModalProjection.BuildRequest(
            FeedbackCategory.Bug, "  Battery NaN  ", "  Steps to reproduce the NaN here  ", context, true, false);

        Assert.Equal("bug", request.Category);
        Assert.Equal("Battery NaN", request.Title);
        Assert.Equal("Steps to reproduce the NaN here", request.Body);
        Assert.Equal("/battery", request.PageRoute);
        Assert.Equal("windows \u00B7 en-US", request.UserAgent);
        Assert.Equal("1.2.3.0", request.AppVersion);
        Assert.Null(request.RecentErrors);
        Assert.Null(request.ConsoleTail);
    }

    [Fact]
    public void BuildRequest_includes_recent_errors_only_when_toggled_and_non_empty()
    {
        var report = new FeedbackErrorReport("TypeError", "x is undefined", "/battery", "2026-01-01T00:00:00Z", "app");
        var withErrors = new FeedbackContext("/", "1.0", "rt", [report], string.Empty);
        var noErrors = new FeedbackContext("/", "1.0", "rt", Array.Empty<FeedbackErrorReport>(), string.Empty);

        Assert.NotNull(FeedbackModalProjection.BuildRequest(FeedbackCategory.Bug, "title", new string('b', 20), withErrors, true, false).RecentErrors);
        Assert.Null(FeedbackModalProjection.BuildRequest(FeedbackCategory.Bug, "title", new string('b', 20), withErrors, false, false).RecentErrors);
        Assert.Null(FeedbackModalProjection.BuildRequest(FeedbackCategory.Bug, "title", new string('b', 20), noErrors, true, false).RecentErrors);
    }

    [Fact]
    public void BuildRequest_includes_console_tail_only_when_toggled_and_non_empty()
    {
        var withTail = new FeedbackContext("/", "1.0", "rt", Array.Empty<FeedbackErrorReport>(), "[log] hi");
        var noTail = new FeedbackContext("/", "1.0", "rt", Array.Empty<FeedbackErrorReport>(), string.Empty);

        Assert.Equal("[log] hi", FeedbackModalProjection.BuildRequest(FeedbackCategory.Bug, "title", new string('b', 20), withTail, false, true).ConsoleTail);
        Assert.Null(FeedbackModalProjection.BuildRequest(FeedbackCategory.Bug, "title", new string('b', 20), withTail, false, false).ConsoleTail);
        Assert.Null(FeedbackModalProjection.BuildRequest(FeedbackCategory.Bug, "title", new string('b', 20), noTail, false, true).ConsoleTail);
    }

    [Fact]
    public void Request_serializes_to_the_web_wire_shape_without_optionals()
    {
        var context = new FeedbackContext("/dashboard", "1.2.3.0", "windows", Array.Empty<FeedbackErrorReport>(), string.Empty);
        var request = FeedbackModalProjection.BuildRequest(
            FeedbackCategory.Bug, "Battery widget shows NaN", "Steps: load /battery, scroll, value flips to NaN.", context, true, false);

        Assert.Equal(
            "{\"category\":\"bug\",\"title\":\"Battery widget shows NaN\",\"body\":\"Steps: load /battery, scroll, value flips to NaN.\"," +
            "\"page_route\":\"/dashboard\",\"user_agent\":\"windows\",\"app_version\":\"1.2.3.0\"}",
            Serialize(request));
    }

    [Fact]
    public void Request_serializes_recent_errors_and_console_tail_when_present()
    {
        var report = new FeedbackErrorReport("TypeError", "x is undefined", "/battery", "2026-01-01T00:00:00Z", "app");
        var context = new FeedbackContext("/battery", "1.0", "rt", [report], "[log] boom");
        var request = FeedbackModalProjection.BuildRequest(
            FeedbackCategory.Bug, "Crash report", new string('b', 25), context, true, true);

        using var doc = JsonDocument.Parse(Serialize(request));
        var root = doc.RootElement;
        Assert.True(root.TryGetProperty("recent_errors", out var errors));
        Assert.Equal(JsonValueKind.Array, errors.ValueKind);
        Assert.Equal("TypeError", errors[0].GetProperty("name").GetString());
        Assert.False(errors[0].TryGetProperty("stack", out _)); // stack omitted when null
        Assert.Equal("[log] boom", root.GetProperty("console_tail").GetString());
    }

    // ── Adapter: POST /feedback request shape + classification (web useSubmitFeedback) ───────────────────

    [Fact]
    public async Task SubmitAsync_posts_the_feedback_operation_and_body()
    {
        var api = new FakeApiClient { Response = "{\"id\":42}" };
        var source = new FeedbackSubmitSource(api);
        var request = SampleRequest();

        var outcome = await source.SubmitAsync(request);

        Assert.True(outcome.Success);
        Assert.Null(outcome.Error);
        Assert.NotNull(api.Last);
        Assert.Equal("post_api_v1_feedback", api.Last!.OperationId);
        Assert.Same(request, api.Last.Body);
    }

    [Fact]
    public async Task SubmitAsync_classifies_an_api_fault_without_throwing()
    {
        var api = new FakeApiClient { Failure = new ApiException("bad request", statusCode: 400) };
        var source = new FeedbackSubmitSource(api);

        var outcome = await source.SubmitAsync(SampleRequest());

        Assert.False(outcome.Success);
        Assert.NotNull(outcome.Error);
        Assert.Equal(400, outcome.Error!.StatusCode);
    }

    [Fact]
    public async Task SubmitAsync_classifies_a_network_fault_as_network()
    {
        var api = new FakeApiClient { Failure = new HttpRequestException("offline") };
        var source = new FeedbackSubmitSource(api);

        var outcome = await source.SubmitAsync(SampleRequest());

        Assert.False(outcome.Success);
        Assert.Equal(RepositoryErrorKind.Network, outcome.Error!.Kind);
    }

    [Fact]
    public async Task SubmitAsync_rejects_a_null_request() =>
        await Assert.ThrowsAsync<ArgumentNullException>(() => new FeedbackSubmitSource(new FakeApiClient()).SubmitAsync(null!));

    // ── Adapter: context source composition (web useLocation + reporter ring) ────────────────────────────

    [Fact]
    public void ContextSource_composes_route_version_runtime_and_diagnostics()
    {
        var env = new StaticPushEnvironment("9.9.9.0", "en-GB", "device-1", platform: "windows");
        var log = new InMemoryFeedbackDiagnosticsLog();
        log.RecordError("TypeError", "boom", "/battery", "app");
        log.RecordConsoleLine("[log] line one");
        var source = new FeedbackContextSource(env, () => "/charging", log);

        var context = source.Capture();

        Assert.Equal("/charging", context.PageRoute);
        Assert.Equal("9.9.9.0", context.AppVersion);
        Assert.Equal("windows \u00B7 en-GB", context.Runtime);
        Assert.Equal(1, context.RecentErrorCount);
        Assert.Equal("[log] line one", context.ConsoleTail);
    }

    [Theory]
    [InlineData("windows", "en-US", "windows \u00B7 en-US")]
    [InlineData("windows", "", "windows")]
    [InlineData("", "en-US", "en-US")]
    [InlineData("", "", "")]
    public void BuildRuntimeDescriptor_joins_platform_and_locale(string platform, string locale, string expected) =>
        Assert.Equal(expected, FeedbackContextSource.BuildRuntimeDescriptor(new FixedEnvironment(platform, locale)));

    [Fact]
    public void ContextSource_defaults_a_missing_route_to_root()
    {
        var env = new StaticPushEnvironment("1.0", "en-US", "dev", platform: "windows");
        var source = new FeedbackContextSource(env, () => null, new InMemoryFeedbackDiagnosticsLog());

        Assert.Equal("/", source.Capture().PageRoute);
    }

    // ── Adapter: diagnostics ring (web errorReporter ring + console buffer) ──────────────────────────────

    [Fact]
    public void DiagnosticsLog_caps_recent_errors_at_the_ring_size_dropping_oldest()
    {
        var log = new InMemoryFeedbackDiagnosticsLog();
        for (int i = 0; i < InMemoryFeedbackDiagnosticsLog.RingSize + 5; i++)
        {
            log.RecordError($"E{i}", "m", "/", "app");
        }

        var errors = log.RecentErrors();
        Assert.Equal(InMemoryFeedbackDiagnosticsLog.RingSize, errors.Count);
        Assert.Equal("E5", errors[0].Name); // oldest five dropped
        Assert.Equal("E14", errors[^1].Name);
    }

    [Fact]
    public void DiagnosticsLog_caps_console_lines_and_joins_newest_last()
    {
        var log = new InMemoryFeedbackDiagnosticsLog();
        for (int i = 0; i < InMemoryFeedbackDiagnosticsLog.ConsoleLineMax + 3; i++)
        {
            log.RecordConsoleLine($"line{i}");
        }

        string tail = log.ConsoleTail();
        var lines = tail.Split('\n');
        Assert.Equal(InMemoryFeedbackDiagnosticsLog.ConsoleLineMax, lines.Length);
        Assert.Equal("line3", lines[0]);
        Assert.EndsWith("line52", tail, StringComparison.Ordinal);
    }

    [Fact]
    public void DiagnosticsLog_empty_state_is_empty()
    {
        var log = new InMemoryFeedbackDiagnosticsLog();
        Assert.Empty(log.RecentErrors());
        Assert.Equal(string.Empty, log.ConsoleTail());
    }

    // ── View-model: initial (idle) state ─────────────────────────────────────────────────────────────────

    [Fact]
    public void Initial_state_matches_web_defaults()
    {
        var vm = NewViewModel();

        Assert.Equal(FeedbackCategory.Bug, vm.Category);
        Assert.Equal(string.Empty, vm.Title);
        Assert.Equal(string.Empty, vm.Body);
        Assert.True(vm.IncludeRecentErrors);
        Assert.False(vm.IncludeConsoleTail);
        Assert.False(vm.IsSubmitting);
        Assert.False(vm.SubmitFailed);
        Assert.False(vm.CanSubmit);
        Assert.False(vm.HasTitleError);
        Assert.False(vm.HasBodyError);
        Assert.Equal(3, vm.CategoryOptions.Count);
        Assert.Equal("Send feedback", vm.SubmitLabel);
        Assert.Equal(5, FeedbackModalRegistration.TitleMinLength);
        Assert.Equal(120, FeedbackModalRegistration.TitleMaxLength);
        Assert.Equal(20, FeedbackModalRegistration.BodyMinLength);
        Assert.Equal(4000, FeedbackModalRegistration.BodyMaxLength);
    }

    // ── View-model: context capture (web mount reads) ────────────────────────────────────────────────────

    [Fact]
    public void NotifyOpened_captures_context_and_shows_unknown_placeholders_when_absent()
    {
        var vm = NewViewModel(); // empty context

        vm.NotifyOpened();

        Assert.Equal("/", vm.PageRouteDisplay);
        Assert.Equal("unknown", vm.AppVersionDisplay);
        Assert.Equal("unknown", vm.RuntimeDisplay);
        Assert.Equal(0, vm.RecentErrorCount);
        Assert.Equal("Attach recent errors (0)", vm.IncludeErrorsLabel);
    }

    [Fact]
    public void NotifyOpened_projects_a_populated_context()
    {
        var report = new FeedbackErrorReport("TypeError", "boom", "/battery", "2026-01-01T00:00:00Z", "app");
        var context = new FeedbackContext("/dashboard", "1.2.3.0", "windows \u00B7 en-US", [report, report], "[log] x");
        var vm = NewViewModel(context: new StaticFeedbackContextSource(context));

        vm.NotifyOpened();

        Assert.Equal("/dashboard", vm.PageRouteDisplay);
        Assert.Equal("1.2.3.0", vm.AppVersionDisplay);
        Assert.Equal("windows \u00B7 en-US", vm.RuntimeDisplay);
        Assert.Equal(2, vm.RecentErrorCount);
        Assert.Equal("Attach recent errors (2)", vm.IncludeErrorsLabel);
    }

    // ── View-model: validation state ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void CanSubmit_becomes_true_once_title_and_body_are_valid()
    {
        var vm = NewViewModel();
        Assert.False(vm.CanSubmit);

        vm.Title = "Battery widget shows NaN";
        Assert.False(vm.CanSubmit); // body still too short

        vm.Body = "Steps: load /battery, scroll, value flips to NaN.";
        Assert.True(vm.CanSubmit);
    }

    [Fact]
    public void Touching_a_short_title_surfaces_the_field_error()
    {
        var vm = NewViewModel();
        vm.Title = "abc";

        vm.MarkTitleTouched();

        Assert.True(vm.HasTitleError);
        Assert.Equal("Title must be 5\u2013120 characters.", vm.TitleError);
    }

    [Fact]
    public void Touching_a_short_body_surfaces_the_field_error()
    {
        var vm = NewViewModel();
        vm.Body = "too short";

        vm.MarkBodyTouched();

        Assert.True(vm.HasBodyError);
        Assert.Equal("Details must be 20\u20134000 characters.", vm.BodyError);
    }

    [Fact]
    public void Editing_a_field_to_valid_clears_its_error()
    {
        var vm = NewViewModel();
        vm.Title = "ab";
        vm.MarkTitleTouched();
        Assert.True(vm.HasTitleError);

        vm.Title = "now long enough";

        Assert.False(vm.HasTitleError);
        Assert.Null(vm.TitleError);
    }

    [Fact]
    public async Task Submit_with_invalid_form_surfaces_errors_and_does_not_call_the_source()
    {
        var submit = new FakeSubmitSource();
        var vm = NewViewModel(submit: submit);
        vm.Title = "abc"; // too short; body empty

        bool submitted = await vm.SubmitAsync();

        Assert.False(submitted);
        Assert.Equal(0, submit.Calls);
        Assert.True(vm.HasTitleError);
        Assert.True(vm.HasBodyError);
    }

    // ── View-model: success → close ──────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Submit_success_records_raises_success_toast_and_closes()
    {
        var report = new FeedbackErrorReport("TypeError", "boom", "/battery", "2026-01-01T00:00:00Z", "app");
        var context = new FeedbackContext("/dashboard", "1.2.3.0", "windows \u00B7 en-US", [report], "[log] tail");
        var submit = new FakeSubmitSource { Outcome = FeedbackSubmitOutcome.Ok() };
        var diag = new FeedbackModalDiagnostics();
        var vm = NewViewModel(submit: submit, context: new StaticFeedbackContextSource(context), diagnostics: diag);
        var toasts = new List<FeedbackModalToast>();
        int closes = 0;
        vm.ToastRequested += (_, t) => toasts.Add(t);
        vm.CloseRequested += (_, _) => closes++;
        vm.NotifyOpened();
        vm.Category = FeedbackCategory.Feature;
        vm.Title = "Add a dark map theme";
        vm.Body = "Please add a dark theme for the trip map view, thanks.";
        vm.IncludeConsoleTail = true;

        bool submitted = await vm.SubmitAsync();

        Assert.True(submitted);
        Assert.Equal(1, submit.Calls);
        Assert.NotNull(submit.LastRequest);
        Assert.Equal("feature", submit.LastRequest!.Category);
        Assert.Equal("Add a dark map theme", submit.LastRequest.Title);
        Assert.Equal("Please add a dark theme for the trip map view, thanks.", submit.LastRequest.Body);
        Assert.Equal("/dashboard", submit.LastRequest.PageRoute);
        Assert.Equal("windows \u00B7 en-US", submit.LastRequest.UserAgent);
        Assert.Equal("1.2.3.0", submit.LastRequest.AppVersion);
        Assert.NotNull(submit.LastRequest.RecentErrors); // default-on toggle + captured error
        Assert.Equal("[log] tail", submit.LastRequest.ConsoleTail); // console toggle on
        var toast = Assert.Single(toasts);
        Assert.False(toast.IsError);
        Assert.Equal("Thanks \u2014 feedback submitted", toast.Message);
        Assert.Equal(1, closes);
        Assert.Equal(1, diag.FeedbackSubmitted);
        Assert.False(vm.IsSubmitting);
        Assert.False(vm.SubmitFailed);
    }

    [Fact]
    public async Task Submit_omits_recent_errors_when_the_toggle_is_off()
    {
        var report = new FeedbackErrorReport("TypeError", "boom", "/battery", "2026-01-01T00:00:00Z", "app");
        var context = new FeedbackContext("/dashboard", "1.0", "rt", [report], string.Empty);
        var submit = new FakeSubmitSource();
        var vm = NewViewModel(submit: submit, context: new StaticFeedbackContextSource(context));
        vm.NotifyOpened();
        vm.Title = "Valid title here";
        vm.Body = "A sufficiently long body to pass validation.";
        vm.IncludeRecentErrors = false;

        await vm.SubmitAsync();

        Assert.Null(submit.LastRequest!.RecentErrors);
    }

    // ── View-model: failure keeps the modal open ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Submit_failure_raises_inline_alert_error_toast_and_keeps_open()
    {
        var submit = new FakeSubmitSource
        {
            Outcome = FeedbackSubmitOutcome.Fail(new RepositoryError(RepositoryErrorKind.Server, "boom")),
        };
        var vm = NewViewModel(submit: submit);
        var toasts = new List<FeedbackModalToast>();
        int closes = 0;
        vm.ToastRequested += (_, t) => toasts.Add(t);
        vm.CloseRequested += (_, _) => closes++;
        vm.Title = "Valid title here";
        vm.Body = "A sufficiently long body to pass validation.";

        bool submitted = await vm.SubmitAsync();

        Assert.False(submitted);
        Assert.Equal(1, submit.Calls);
        Assert.True(vm.SubmitFailed);
        var toast = Assert.Single(toasts);
        Assert.True(toast.IsError);
        Assert.Equal("Failed to submit feedback. Please try again.", toast.Message);
        Assert.Equal(0, closes);
        Assert.False(vm.IsSubmitting);
    }

    // ── View-model: submitting (busy) state ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task SubmitLabel_and_CanSubmit_reflect_the_in_flight_state()
    {
        var gate = new TaskCompletionSource<FeedbackSubmitOutcome>();
        var submit = new FakeSubmitSource { Gate = gate.Task };
        var vm = NewViewModel(submit: submit);
        vm.Title = "Valid title here";
        vm.Body = "A sufficiently long body to pass validation.";

        var task = vm.SubmitAsync();

        Assert.True(vm.IsSubmitting);
        Assert.Equal("Submitting\u2026", vm.SubmitLabel);
        Assert.False(vm.CanSubmit);

        gate.SetResult(FeedbackSubmitOutcome.Ok());
        Assert.True(await task);
        Assert.False(vm.IsSubmitting);
        Assert.Equal("Send feedback", vm.SubmitLabel);
    }

    [Fact]
    public async Task Submit_is_ignored_while_already_submitting()
    {
        var gate = new TaskCompletionSource<FeedbackSubmitOutcome>();
        var submit = new FakeSubmitSource { Gate = gate.Task };
        var vm = NewViewModel(submit: submit);
        vm.Title = "Valid title here";
        vm.Body = "A sufficiently long body to pass validation.";

        var first = vm.SubmitAsync();
        bool second = await vm.SubmitAsync();

        Assert.False(second);
        gate.SetResult(FeedbackSubmitOutcome.Ok());
        Assert.True(await first);
        Assert.Equal(1, submit.Calls);
    }

    // ── View-model: cancel / close ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void RequestClose_raises_close()
    {
        var vm = NewViewModel();
        int closes = 0;
        vm.CloseRequested += (_, _) => closes++;

        vm.RequestClose();

        Assert.Equal(1, closes);
    }

    [Fact]
    public async Task RequestClose_is_ignored_while_submitting()
    {
        var gate = new TaskCompletionSource<FeedbackSubmitOutcome>();
        var submit = new FakeSubmitSource { Gate = gate.Task };
        var vm = NewViewModel(submit: submit);
        int closes = 0;
        vm.CloseRequested += (_, _) => closes++;
        vm.Title = "Valid title here";
        vm.Body = "A sufficiently long body to pass validation.";
        var task = vm.SubmitAsync();

        vm.RequestClose();

        Assert.Equal(0, closes);
        gate.SetResult(FeedbackSubmitOutcome.Ok());
        await task;
        Assert.Equal(1, closes); // the success path itself raised exactly one close
    }

    // ── Diagnostics (PII-safe, P1/S11) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void NotifyOpened_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diag = new FeedbackModalDiagnostics(lines.Add);
        var vm = NewViewModel(diagnostics: diag);

        vm.NotifyOpened();

        Assert.Equal(1, diag.ViewsOpened);
        Assert.Equal("view.opened slug=FeedbackModal", Assert.Single(lines));
    }

    [Fact]
    public void RecordFeedbackSubmitted_emits_slug_without_content()
    {
        var lines = new List<string>();
        var diag = new FeedbackModalDiagnostics(lines.Add);

        diag.RecordFeedbackSubmitted();

        Assert.Equal(1, diag.FeedbackSubmitted);
        Assert.Equal("feedback.submitted slug=FeedbackModal", Assert.Single(lines));
    }

    // ── i18n key + fallback contract (the Narrator-label source / a11y labels) ───────────────────────────

    [Fact]
    public void Every_label_routes_through_a_feedback_or_shared_key()
    {
        var recorder = new RecordingLocalizer();

        ReadAllLabels(recorder);

        Assert.NotEmpty(recorder.Keys);
        Assert.All(recorder.Keys, key => Assert.True(
            key.StartsWith("feedback.", StringComparison.Ordinal)
            || key.StartsWith("common.", StringComparison.Ordinal)
            || key.StartsWith("toast.feedback.", StringComparison.Ordinal),
            $"unexpected i18n key: {key}"));
    }

    [Fact]
    public void Every_interactive_element_has_a_non_empty_accessible_label()
    {
        // The Narrator name of each control is its i18n label; none may be blank.
        Assert.All(
            new[]
            {
                FeedbackModalRegistration.ModalTitle(Localizer),
                FeedbackModalRegistration.CategoryLabel(Localizer),
                FeedbackModalRegistration.TitleLabel(Localizer),
                FeedbackModalRegistration.BodyLabel(Localizer),
                FeedbackModalRegistration.IncludeErrorsLabel(Localizer, 0),
                FeedbackModalRegistration.IncludeConsoleLabel(Localizer),
                FeedbackModalRegistration.SubmitLabel(Localizer),
                FeedbackModalRegistration.CancelLabel(Localizer),
            },
            label => Assert.False(string.IsNullOrWhiteSpace(label)));
    }

    [Fact]
    public void English_fallbacks_match_the_web_literals()
    {
        Assert.Equal("Report a bug / Send feedback", FeedbackModalRegistration.ModalTitle(Localizer));
        Assert.Equal("What kind of feedback?", FeedbackModalRegistration.CategoryLabel(Localizer));
        Assert.Equal("Bug report", FeedbackModalRegistration.CategoryLabelFor(FeedbackCategory.Bug, Localizer));
        Assert.Equal("Feature request", FeedbackModalRegistration.CategoryLabelFor(FeedbackCategory.Feature, Localizer));
        Assert.Equal("Other / question", FeedbackModalRegistration.CategoryLabelFor(FeedbackCategory.Other, Localizer));
        Assert.Equal("Title", FeedbackModalRegistration.TitleLabel(Localizer));
        Assert.Equal("Details", FeedbackModalRegistration.BodyLabel(Localizer));
        Assert.Equal("Auto-attached context", FeedbackModalRegistration.ContextTitle(Localizer));
        Assert.Equal("Page", FeedbackModalRegistration.ContextPageLabel(Localizer));
        Assert.Equal("App version", FeedbackModalRegistration.ContextAppVersionLabel(Localizer));
        Assert.Equal("unknown", FeedbackModalRegistration.ContextUnknown(Localizer));
        Assert.Equal("Attach recent errors (3)", FeedbackModalRegistration.IncludeErrorsLabel(Localizer, 3));
        Assert.Equal("Failed to submit feedback. Please try again.", FeedbackModalRegistration.SubmitError(Localizer));
        Assert.Equal("Failed to submit feedback", FeedbackModalRegistration.SubmitErrorToast(Localizer));
        Assert.Equal("Cancel", FeedbackModalRegistration.CancelLabel(Localizer));
        Assert.Equal("Send feedback", FeedbackModalRegistration.SubmitLabel(Localizer));
        Assert.Equal("Submitting\u2026", FeedbackModalRegistration.SubmittingLabel(Localizer));
        Assert.Equal("Thanks \u2014 feedback submitted", FeedbackModalRegistration.SuccessMessage(Localizer));
    }

    [Fact]
    public void Browser_specific_labels_are_adapted_to_the_windows_idiom()
    {
        // The web "Browser" / "console" labels keep their i18n key but read natively on Windows.
        Assert.Equal("System", FeedbackModalRegistration.ContextRuntimeLabel(Localizer));
        Assert.Equal("Attach recent log messages", FeedbackModalRegistration.IncludeConsoleLabel(Localizer));
    }

    // ── Helpers + fakes ──────────────────────────────────────────────────────────────────────────────────

    private static FeedbackModalViewModel NewViewModel(
        IFeedbackSubmitSource? submit = null,
        IFeedbackContextSource? context = null,
        FeedbackModalDiagnostics? diagnostics = null) =>
        new(submit ?? new FakeSubmitSource(), context ?? new StaticFeedbackContextSource(), Localizer, diagnostics);

    private static FeedbackSubmitRequest SampleRequest() =>
        FeedbackModalProjection.BuildRequest(
            FeedbackCategory.Bug, "Sample title", new string('b', 25), FeedbackContext.Empty, false, false);

    private static void ReadAllLabels(ILocalizer localizer)
    {
        _ = FeedbackModalRegistration.ModalTitle(localizer);
        _ = FeedbackModalRegistration.CategoryLabel(localizer);
        _ = FeedbackModalRegistration.TitleLabel(localizer);
        _ = FeedbackModalRegistration.TitlePrompt(localizer);
        _ = FeedbackModalRegistration.BodyLabel(localizer);
        _ = FeedbackModalRegistration.BodyPrompt(localizer);
        _ = FeedbackModalRegistration.ContextTitle(localizer);
        _ = FeedbackModalRegistration.ContextPageLabel(localizer);
        _ = FeedbackModalRegistration.ContextAppVersionLabel(localizer);
        _ = FeedbackModalRegistration.ContextRuntimeLabel(localizer);
        _ = FeedbackModalRegistration.ContextUnknown(localizer);
        _ = FeedbackModalRegistration.IncludeErrorsLabel(localizer, 0);
        _ = FeedbackModalRegistration.IncludeErrorsHint(localizer);
        _ = FeedbackModalRegistration.IncludeConsoleLabel(localizer);
        _ = FeedbackModalRegistration.IncludeConsoleHint(localizer);
        _ = FeedbackModalRegistration.TitleErrorMessage(localizer);
        _ = FeedbackModalRegistration.BodyErrorMessage(localizer);
        _ = FeedbackModalRegistration.SubmitError(localizer);
        _ = FeedbackModalRegistration.SubmitErrorToast(localizer);
        _ = FeedbackModalRegistration.CancelLabel(localizer);
        _ = FeedbackModalRegistration.SubmitLabel(localizer);
        _ = FeedbackModalRegistration.SubmittingLabel(localizer);
        _ = FeedbackModalRegistration.SuccessMessage(localizer);
        _ = FeedbackModalProjection.CategoryOptions(localizer);
    }

    private static string Serialize(object? body)
    {
        Assert.NotNull(body);
        return JsonSerializer.Serialize(body, body!.GetType());
    }

    private sealed class FakeSubmitSource : IFeedbackSubmitSource
    {
        public int Calls { get; private set; }

        public FeedbackSubmitRequest? LastRequest { get; private set; }

        public FeedbackSubmitOutcome Outcome { get; set; } = FeedbackSubmitOutcome.Ok();

        public Task<FeedbackSubmitOutcome>? Gate { get; set; }

        public async Task<FeedbackSubmitOutcome> SubmitAsync(
            FeedbackSubmitRequest request,
            CancellationToken cancellationToken = default)
        {
            Calls++;
            LastRequest = request;
            if (Gate is { } gate)
            {
                return await gate.ConfigureAwait(false);
            }

            return Outcome;
        }
    }

    private sealed class FakeApiClient : IApiClient
    {
        public ApiRequest? Last { get; private set; }

        public string Response { get; set; } = "{}";

        public Exception? Failure { get; set; }

        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            throw new NotSupportedException();

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
        {
            Last = request;
            if (Failure is { } error)
            {
                return Task.FromException<T>(error);
            }

            using var doc = JsonDocument.Parse(Response);
            object element = doc.RootElement.Clone();
            return Task.FromResult((T)element);
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    // A minimal IPushEnvironment that lets BuildRuntimeDescriptor's empty-token branches be exercised directly.
    private sealed class FixedEnvironment : IPushEnvironment
    {
        public FixedEnvironment(string platform, string locale)
        {
            Platform = platform;
            Locale = locale;
        }

        public string Platform { get; }

        public string PushProvider => "wns";

        public string AppVersion => "1.0";

        public string Locale { get; }

        public string StableDeviceId => "device";

        public IReadOnlyList<string> Capabilities => Array.Empty<string>();
    }
}
