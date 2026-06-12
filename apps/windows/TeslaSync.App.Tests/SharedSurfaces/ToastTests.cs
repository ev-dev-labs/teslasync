using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the Toast shared surface's UI-thread-free logic — the registration metadata (slug,
/// the overlay automation id, the five-toast cap + 4000 ms default + id prefix, the per-variant ARIA role
/// contract, the dismiss glyph + navigation suffix, the i18n keys + fallbacks), the variant → glyph / accent /
/// colour / role / slug maps (reused from the shared callout family), the <see cref="ToastActionModel"/>
/// navigation-vs-callback discrimination, the <see cref="ToastController"/> queue adapter (id assignment,
/// duration defaulting, the four tone shorthands, the drop-oldest cap, dismiss + Changed semantics, diagnostics
/// counters), the <see cref="ToastAccess"/> required / optional accessors (web <c>useToast</c> /
/// <c>useOptionalToast</c>), the <see cref="ToastMutationReporter"/> bridge (web <c>useMutationToast</c>), the
/// pure <see cref="ToastProjection"/> across the empty / per-tone / with-message / per-action branches, the
/// accessible-name contract, the <see cref="ToastViewModel"/> state holder, and the PII-safe diagnostics. Mirrors
/// the web spec (web/src/components/feedback/Toast.tsx + web/src/api/hooks/_toastHelpers.ts). The web source is a
/// transient, client-only feedback primitive with no data fetch, so — like the OfflineBanner surface — there is
/// deliberately no loading / stale / offline branch to reproduce; its authoritative branches are the empty
/// overlay, the four tones, the with / without-message and navigation / callback / no-action variants, all
/// exercised below. The WinUI view itself (shared-surfaces/Toast/Toast.cs) is exercised by the app build.
/// </summary>
public sealed class ToastTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("Toast", ToastRegistration.Slug);

    [Fact]
    public void Region_automation_id_is_stable() =>
        Assert.Equal("toast-region", ToastRegistration.RegionAutomationId);

    [Fact]
    public void Queue_policy_matches_the_web_provider()
    {
        // web: [...prev.slice(-4), next] (five visible) and const duration = opts.duration ?? 4000.
        Assert.Equal(5, ToastRegistration.MaxVisible);
        Assert.Equal(4000, ToastRegistration.DefaultDurationMs);
        Assert.Equal("toast-", ToastRegistration.IdPrefix);
    }

    [Fact]
    public void Dismiss_glyph_and_navigation_suffix_match_the_web_affordances()
    {
        Assert.Equal("\uE711", ToastRegistration.DismissGlyph);   // Segoe Fluent Cancel ↔ Lucide X
        Assert.Equal(" \u2192", ToastRegistration.NavigationActionSuffix); // web "{label} →"
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        // web Toast.tsx dismiss aria-label and _toastHelpers.ts default error key/fallback.
        Assert.Equal("translation.toast.dismiss", ToastRegistration.DismissLabelKey);
        Assert.Equal("Dismiss notification", ToastRegistration.DismissLabelFallback);
        Assert.Equal("translation.toast.common.error", ToastRegistration.MutationErrorKey);
        Assert.Equal("Something went wrong", ToastRegistration.MutationErrorFallback);
    }

    [Fact]
    public void Resolve_helpers_flow_through_the_localizer()
    {
        Assert.Equal("Dismiss notification", ToastRegistration.ResolveDismissLabel(Localizer));
        Assert.Equal("Something went wrong", ToastRegistration.ResolveMutationErrorTitle(Localizer));
    }

    [Theory]
    [InlineData(CalloutVariant.Success, "success")]
    [InlineData(CalloutVariant.Danger, "error")]
    [InlineData(CalloutVariant.Warning, "warning")]
    [InlineData(CalloutVariant.Info, "info")]
    public void Variant_slug_maps_to_the_web_toast_type(CalloutVariant variant, string expected) =>
        Assert.Equal(expected, ToastRegistration.VariantSlug(variant));

    [Theory]
    [InlineData(CalloutVariant.Success, "status")]
    [InlineData(CalloutVariant.Info, "status")]
    [InlineData(CalloutVariant.Warning, "status")]
    [InlineData(CalloutVariant.Danger, "alert")]
    public void Role_reproduces_the_web_aria_role_map(CalloutVariant variant, string expected) =>
        Assert.Equal(expected, ToastRegistration.Role(variant));

    [Theory]
    [InlineData(CalloutVariant.Success, "TsColorSuccessColor")]
    [InlineData(CalloutVariant.Warning, "TsColorWarningColor")]
    [InlineData(CalloutVariant.Danger, "TsColorDangerColor")]
    [InlineData(CalloutVariant.Info, "TsColorInfoColor")]
    public void Accent_colour_keys_pair_with_the_callout_brush(CalloutVariant variant, string expected)
    {
        Assert.Equal(expected, ToastColors.AccentColorKey(variant));
        // The brush key the colour pairs with comes from the shared callout family.
        Assert.Equal(CalloutVariants.AccentBrushKey(variant), CalloutVariants.AccentBrushKey(variant));
    }

    // ── action model ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Action_with_route_is_a_navigation_action_with_arrow_label()
    {
        var action = new ToastActionModel { Label = "View", Route = "/battery?vehicle_id=12" };

        Assert.True(action.IsNavigation);
        Assert.True(action.IsRenderable);
        Assert.Equal("View \u2192", action.DisplayLabel);
    }

    [Fact]
    public void Action_with_callback_is_a_button_action_with_bare_label()
    {
        var fired = 0;
        var action = new ToastActionModel { Label = "Undo", OnClick = () => fired++ };

        Assert.False(action.IsNavigation);
        Assert.True(action.IsRenderable);
        Assert.Equal("Undo", action.DisplayLabel);

        action.OnClick!();
        Assert.Equal(1, fired);
    }

    [Fact]
    public void Action_navigation_wins_when_both_route_and_callback_are_supplied()
    {
        // web: t.action.to ? <Link> : t.action.onClick ? <button> : null — the navigation form wins.
        var action = new ToastActionModel { Label = "Go", Route = "/x", OnClick = () => { } };

        Assert.True(action.IsNavigation);
        Assert.Equal("Go \u2192", action.DisplayLabel);
    }

    [Fact]
    public void Action_with_neither_route_nor_callback_does_not_render()
    {
        var action = new ToastActionModel { Label = "Nothing" };

        Assert.False(action.IsRenderable);
        Assert.False(action.IsNavigation);
    }

    // ── item defaults ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Item_auto_dismisses_only_for_a_positive_duration()
    {
        var transient = new ToastItem
        {
            Id = "toast-1",
            Variant = CalloutVariant.Success,
            Title = "Saved",
            Duration = TimeSpan.FromSeconds(4),
        };
        var persistent = transient with { Duration = TimeSpan.Zero };

        Assert.True(transient.AutoDismisses);
        Assert.False(persistent.AutoDismisses);
    }

    // ── controller (queue adapter) ────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Controller_assigns_sequential_ids_and_the_default_duration()
    {
        var controller = new ToastController();

        var first = controller.Show(new ToastRequest { Variant = CalloutVariant.Info, Title = "One" });
        var second = controller.Show(new ToastRequest { Variant = CalloutVariant.Info, Title = "Two" });

        Assert.Equal("toast-1", first);
        Assert.Equal("toast-2", second);
        Assert.Equal(
            TimeSpan.FromMilliseconds(ToastRegistration.DefaultDurationMs),
            controller.Snapshot[0].Duration);
    }

    [Fact]
    public void Controller_honours_an_explicit_duration()
    {
        var controller = new ToastController();
        controller.Show(new ToastRequest
        {
            Variant = CalloutVariant.Info,
            Title = "Sticky",
            Duration = TimeSpan.Zero,
        });

        Assert.Equal(TimeSpan.Zero, controller.Snapshot[0].Duration);
        Assert.False(controller.Snapshot[0].AutoDismisses);
    }

    [Theory]
    [InlineData("success", CalloutVariant.Success)]
    [InlineData("error", CalloutVariant.Danger)]
    [InlineData("info", CalloutVariant.Info)]
    [InlineData("warning", CalloutVariant.Warning)]
    public void Controller_shorthands_map_to_the_right_tone(string shorthand, CalloutVariant expected)
    {
        var controller = new ToastController();

        switch (shorthand)
        {
            case "success": controller.Success("t"); break;
            case "error": controller.Error("t"); break;
            case "info": controller.Info("t"); break;
            default: controller.Warning("t"); break;
        }

        Assert.Equal(expected, controller.Snapshot[0].Variant);
    }

    [Fact]
    public void Controller_carries_title_and_message_through()
    {
        var controller = new ToastController();
        controller.Success("Saved", "Your settings were saved");

        Assert.Equal("Saved", controller.Snapshot[0].Title);
        Assert.Equal("Your settings were saved", controller.Snapshot[0].Message);
    }

    [Fact]
    public void Controller_caps_at_five_dropping_the_oldest()
    {
        var controller = new ToastController();
        for (var i = 1; i <= 6; i++)
        {
            controller.Info($"toast number {i}");
        }

        var snapshot = controller.Snapshot;
        Assert.Equal(ToastRegistration.MaxVisible, snapshot.Count);
        // web slice(-4) + next: the first toast (toast-1) is dropped, toast-2..toast-6 remain in order.
        Assert.Equal("toast-2", snapshot[0].Id);
        Assert.Equal("toast-6", snapshot[^1].Id);
    }

    [Fact]
    public void Controller_dismiss_removes_the_matching_toast_and_raises_changed()
    {
        var controller = new ToastController();
        var first = controller.Show(new ToastRequest { Variant = CalloutVariant.Info, Title = "One" });
        controller.Show(new ToastRequest { Variant = CalloutVariant.Info, Title = "Two" });

        var raised = 0;
        controller.Changed += (_, _) => raised++;

        controller.Dismiss(first);

        Assert.Single(controller.Snapshot);
        Assert.Equal("Two", controller.Snapshot[0].Title);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void Controller_dismiss_of_an_unknown_id_is_a_no_op()
    {
        var controller = new ToastController();
        controller.Info("One");

        var raised = 0;
        controller.Changed += (_, _) => raised++;

        controller.Dismiss("toast-does-not-exist");

        Assert.Single(controller.Snapshot);
        Assert.Equal(0, raised);
    }

    [Fact]
    public void Controller_show_raises_changed_once_per_enqueue()
    {
        var controller = new ToastController();
        var raised = 0;
        controller.Changed += (_, _) => raised++;

        controller.Info("One");

        Assert.Equal(1, raised);
    }

    [Fact]
    public void Controller_snapshot_is_an_isolated_copy()
    {
        var controller = new ToastController();
        controller.Info("One");

        var snapshot = controller.Snapshot;
        controller.Info("Two");

        // The earlier snapshot is not mutated by the later enqueue.
        Assert.Single(snapshot);
        Assert.Equal(2, controller.Snapshot.Count);
    }

    // ── access (useToast / useOptionalToast) ──────────────────────────────────────────────────────────────

    [Fact]
    public void Require_returns_the_controller_when_present()
    {
        var controller = new ToastController();
        Assert.Same(controller, ToastAccess.Require(controller));
    }

    [Fact]
    public void Require_throws_the_web_message_when_absent()
    {
        var error = Assert.Throws<InvalidOperationException>(() => ToastAccess.Require(null));
        Assert.Equal("useToast must be used within ToastProvider", error.Message);
    }

    [Fact]
    public void Optional_returns_null_when_absent_and_the_controller_when_present()
    {
        Assert.Null(ToastAccess.Optional(null));
        var controller = new ToastController();
        Assert.Same(controller, ToastAccess.Optional(controller));
    }

    // ── mutation reporter (useMutationToast) ──────────────────────────────────────────────────────────────

    [Fact]
    public void Mutation_reporter_success_resolves_the_key_and_enqueues_a_success_toast()
    {
        var controller = new ToastController();
        var reporter = new ToastMutationReporter(controller, Localizer);

        reporter.Success("toast.foo.delete.success", "Item deleted");

        Assert.Equal(CalloutVariant.Success, controller.Snapshot[0].Variant);
        Assert.Equal("Item deleted", controller.Snapshot[0].Title);
    }

    [Fact]
    public void Mutation_reporter_error_uses_the_default_title_and_shows_the_error_detail()
    {
        var controller = new ToastController();
        var reporter = new ToastMutationReporter(controller, Localizer);

        reporter.Error(new InvalidOperationException("HTTP 500"));

        var toast = controller.Snapshot[0];
        Assert.Equal(CalloutVariant.Danger, toast.Variant);
        Assert.Equal("Something went wrong", toast.Title);  // web default 'toast.common.error'
        Assert.Equal("HTTP 500", toast.Message);            // web: err.message as secondary line
    }

    [Fact]
    public void Mutation_reporter_error_honours_a_custom_key_and_fallback()
    {
        var controller = new ToastController();
        var reporter = new ToastMutationReporter(controller, Localizer);

        reporter.Error("plain string error", "toast.save.error", "Failed to save");

        Assert.Equal("Failed to save", controller.Snapshot[0].Title);
        Assert.Equal("plain string error", controller.Snapshot[0].Message);
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("boom", "boom")]
    public void Mutation_reporter_describe_error_reproduces_the_web_coercion(string? input, string? expected) =>
        Assert.Equal(expected, ToastMutationReporter.DescribeError(input));

    [Fact]
    public void Mutation_reporter_describe_error_uses_the_exception_message() =>
        Assert.Equal("kaput", ToastMutationReporter.DescribeError(new Exception("kaput")));

    // ── projection (empty + per-state) ────────────────────────────────────────────────────────────────────

    [Fact]
    public void Empty_projection_has_no_toasts_but_resolves_the_dismiss_label()
    {
        var projection = ToastProjection.Empty(Localizer);

        Assert.False(projection.HasToasts);
        Assert.Equal(0, projection.Count);
        Assert.Empty(projection.Items);
        Assert.Equal("Dismiss notification", projection.DismissLabel);
    }

    [Fact]
    public void Projection_preserves_queue_order_oldest_first()
    {
        var controller = new ToastController();
        controller.Info("first");
        controller.Info("second");

        var projection = ToastProjection.Project(controller.Snapshot, Localizer);

        Assert.True(projection.HasToasts);
        Assert.Equal(2, projection.Count);
        Assert.Equal("first", projection.Items[0].Title);
        Assert.Equal("second", projection.Items[1].Title);
    }

    [Theory]
    [InlineData(CalloutVariant.Success, false)]
    [InlineData(CalloutVariant.Info, false)]
    [InlineData(CalloutVariant.Warning, false)]
    [InlineData(CalloutVariant.Danger, true)]
    public void Item_projection_exposes_the_tone_visuals_and_urgency(CalloutVariant variant, bool assertive)
    {
        var item = new ToastItem
        {
            Id = "toast-1",
            Variant = variant,
            Title = "Title",
            Duration = TimeSpan.FromSeconds(4),
        };

        var projection = ToastItemProjection.Project(item);

        Assert.Equal(CalloutVariants.Glyph(variant), projection.Glyph);
        Assert.Equal(CalloutVariants.AccentBrushKey(variant), projection.AccentBrushKey);
        Assert.Equal(ToastColors.AccentColorKey(variant), projection.AccentColorKey);
        Assert.Equal(ToastRegistration.Role(variant), projection.Role);
        Assert.Equal(assertive, projection.IsAssertive);
    }

    [Fact]
    public void Item_projection_flags_the_message_and_action_branches()
    {
        var bare = ToastItemProjection.Project(new ToastItem
        {
            Id = "toast-1",
            Variant = CalloutVariant.Info,
            Title = "Bare",
            Duration = TimeSpan.FromSeconds(4),
        });
        Assert.False(bare.HasMessage);
        Assert.False(bare.HasAction);

        var rich = ToastItemProjection.Project(new ToastItem
        {
            Id = "toast-2",
            Variant = CalloutVariant.Info,
            Title = "Rich",
            Message = "detail",
            Duration = TimeSpan.FromSeconds(4),
            Action = new ToastActionModel { Label = "View", Route = "/x" },
        });
        Assert.True(rich.HasMessage);
        Assert.True(rich.HasAction);
    }

    [Fact]
    public void Item_projection_ignores_an_empty_action()
    {
        var projection = ToastItemProjection.Project(new ToastItem
        {
            Id = "toast-1",
            Variant = CalloutVariant.Info,
            Title = "Title",
            Duration = TimeSpan.FromSeconds(4),
            Action = new ToastActionModel { Label = "Nothing" },
        });

        Assert.False(projection.HasAction);
    }

    // ── a11y label contract ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Accessible_name_is_just_the_title_when_there_is_no_message()
    {
        var projection = ToastItemProjection.Project(new ToastItem
        {
            Id = "toast-1",
            Variant = CalloutVariant.Success,
            Title = "Saved",
            Duration = TimeSpan.FromSeconds(4),
        });

        Assert.Equal("Saved", projection.AccessibleName);
    }

    [Fact]
    public void Accessible_name_folds_title_and_message_into_one_atomic_announcement()
    {
        // web toast div is aria-atomic: title + message are announced as a single utterance.
        var projection = ToastItemProjection.Project(new ToastItem
        {
            Id = "toast-1",
            Variant = CalloutVariant.Danger,
            Title = "Failed to save settings",
            Message = "HTTP 500",
            Duration = TimeSpan.FromSeconds(4),
        });

        Assert.Equal("Failed to save settings. HTTP 500", projection.AccessibleName);
    }

    // ── view-model ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void View_model_starts_empty()
    {
        var controller = new ToastController();
        using var vm = new ToastViewModel(Localizer, controller);

        Assert.False(vm.HasToasts);
        Assert.Equal(0, vm.Count);
        Assert.Equal("Dismiss notification", vm.DismissLabel);
    }

    [Fact]
    public void View_model_reprojects_when_a_toast_is_shown()
    {
        var controller = new ToastController();
        using var vm = new ToastViewModel(Localizer, controller);

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        controller.Success("Saved");

        Assert.True(vm.HasToasts);
        Assert.Equal(1, vm.Count);
        Assert.Equal("Saved", vm.Items[0].Title);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void View_model_dismiss_forwards_to_the_controller()
    {
        var controller = new ToastController();
        using var vm = new ToastViewModel(Localizer, controller);
        var id = controller.Show(new ToastRequest { Variant = CalloutVariant.Info, Title = "One" });

        vm.Dismiss(id);

        Assert.False(vm.HasToasts);
        Assert.Empty(controller.Snapshot);
    }

    [Fact]
    public void View_model_unsubscribes_on_dispose()
    {
        var controller = new ToastController();
        var vm = new ToastViewModel(Localizer, controller);
        vm.Dispose();

        var raised = 0;
        vm.PropertyChanged += (_, _) => raised++;
        controller.Info("after dispose");

        Assert.Equal(0, raised);
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_only_pii_free_operational_events()
    {
        var lines = new List<string>();
        var diagnostics = new ToastDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordToastShown(CalloutVariant.Danger);
        diagnostics.RecordToastDismissed();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.ToastsShown);
        Assert.Equal(1, diagnostics.ToastsDismissed);
        Assert.Equal(
            new[]
            {
                "view.opened slug=Toast",
                "toast.shown slug=Toast variant=error",
                "toast.dismissed slug=Toast",
            },
            lines);
    }

    [Fact]
    public void Controller_records_shown_and_dismissed_diagnostics()
    {
        var lines = new List<string>();
        var diagnostics = new ToastDiagnostics(lines.Add);
        var controller = new ToastController(diagnostics);

        var id = controller.Show(new ToastRequest { Variant = CalloutVariant.Success, Title = "Saved" });
        controller.Dismiss(id);

        Assert.Equal(1, diagnostics.ToastsShown);
        Assert.Equal(1, diagnostics.ToastsDismissed);
        Assert.Equal(
            new[] { "toast.shown slug=Toast variant=success", "toast.dismissed slug=Toast" },
            lines);
    }
}
