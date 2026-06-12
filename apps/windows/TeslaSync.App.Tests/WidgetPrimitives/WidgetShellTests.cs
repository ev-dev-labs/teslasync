using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.WidgetPrimitives;
using Xunit;

namespace TeslaSync.App.Tests.WidgetPrimitives;

/// <summary>
/// Headless verification of the WidgetShell primitive's UI-thread-free logic — the registration metadata (slug,
/// automation id, the help accessible-name key + fallback and the layout metrics), the pure
/// <see cref="WidgetShellProjection"/> adapter (the loading / error / shell branch precedence, the title vs
/// title-less layout, the uppercase title + accessible name, the help-text / learn-more resolution, the freshness
/// gating + compact rule, the title-scoped pin gating and the content padding pass-through), the
/// <see cref="WidgetShellViewModel"/> state holder (initial projection, prop pushes via the source, subscription
/// cleanup) and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/dashboard/widgets/WidgetShell.tsx). The WinUI view (widget-primitives/WidgetShell.cs) — which
/// composes the live skeleton, query-error, help tooltip, freshness chip, pin toggle and the pulse animation — is
/// exercised by the app build. The reproduced render branches asserted here are loading, error, the default
/// (empty-content) shell, the titled shell, the title-less shell and the four freshness states (fresh, fetching,
/// stale and the offline-cached error).
/// </summary>
public sealed class WidgetShellTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static WidgetShellDisplay Project(WidgetShellInput input) =>
        WidgetShellProjection.Project(input, Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("WidgetShell", WidgetShellRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_the_native_stable_hook() =>
        Assert.Equal("widget-shell", WidgetShellRegistration.RootAutomationId);

    [Fact]
    public void Help_accessible_name_key_and_fallback_match_the_catalogue()
    {
        // web aria-label "More info about {title}" is reproduced through the existing translation.a11y.helpFor key.
        Assert.Equal("translation.a11y.helpFor", WidgetShellRegistration.HelpAccessibleNameKey);
        Assert.Equal("Help for {0}", WidgetShellRegistration.HelpAccessibleNameFallback);
        Assert.Equal("Help for Battery", WidgetShellRegistration.ResolveHelpAccessibleName(Localizer, "Battery"));
    }

    [Fact]
    public void Resolve_help_accessible_name_throws_when_the_localizer_is_null() =>
        Assert.Throws<ArgumentNullException>(
            () => WidgetShellRegistration.ResolveHelpAccessibleName(localizer: null!, "Battery"));

    [Fact]
    public void Layout_metrics_match_the_web_tailwind_classes()
    {
        Assert.Equal(16, WidgetShellRegistration.HeaderPaddingLeft);     // px-4
        Assert.Equal(12, WidgetShellRegistration.HeaderPaddingTop);      // pt-3
        Assert.Equal(16, WidgetShellRegistration.HeaderPaddingRight);    // px-4
        Assert.Equal(4, WidgetShellRegistration.HeaderPaddingBottom);    // pb-1
        Assert.Equal(16, WidgetShellRegistration.ContentPaddingLeft);    // px-4
        Assert.Equal(16, WidgetShellRegistration.ContentPaddingRight);   // px-4
        Assert.Equal(12, WidgetShellRegistration.ContentPaddingBottom);  // pb-3
        Assert.Equal(11, WidgetShellRegistration.TitleFontSize);         // text-[11px]
        Assert.Equal(500, WidgetShellRegistration.TitleFontWeight);      // font-medium
        Assert.Equal(50, WidgetShellRegistration.TitleCharacterSpacing); // tracking-wider (0.05em)
        Assert.Equal(6, WidgetShellRegistration.IconTitleGap);           // gap-1.5
        Assert.Equal(8, WidgetShellRegistration.HeaderActionsGap);       // gap-2
        Assert.Equal(6, WidgetShellRegistration.FreshnessOverlayTop);    // top-1.5
        Assert.Equal(6, WidgetShellRegistration.FreshnessOverlayRight);  // right-1.5
        Assert.Equal(1500, WidgetShellRegistration.PulseDurationMs);     // setTimeout(…, 1500)
        Assert.Equal(12, WidgetShellRegistration.PulseGlowBlurRadius);   // shadow blur 12px
    }

    // ── loading / error branch precedence (web early returns) ─────────────────────────────────────────────

    [Fact]
    public void Projection_loading_shows_the_skeleton_branch()
    {
        var display = Project(new WidgetShellInput { Loading = true, Title = "Battery" });

        // web L82: if (loading) return <Skeleton …/>.
        Assert.True(display.ShowSkeleton);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void Projection_error_shows_the_query_error_branch()
    {
        var display = Project(new WidgetShellInput { ErrorMessage = "Boom" });

        // web L83: if (error) return <QueryError …/>.
        Assert.False(display.ShowSkeleton);
        Assert.True(display.ShowError);
        Assert.Equal("Boom", display.ErrorMessage);
    }

    [Fact]
    public void Projection_loading_wins_over_error()
    {
        var display = Project(new WidgetShellInput { Loading = true, ErrorMessage = "Boom" });

        // web returns the skeleton first, so a simultaneous error never reaches its branch.
        Assert.True(display.ShowSkeleton);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void Projection_blank_error_message_is_not_an_error()
    {
        // web `if (error)` treats an empty string as falsy.
        Assert.False(Project(new WidgetShellInput { ErrorMessage = string.Empty }).ShowError);
        Assert.False(Project(new WidgetShellInput { ErrorMessage = null }).ShowError);
    }

    [Fact]
    public void Projection_default_shell_shows_neither_skeleton_nor_error()
    {
        // The "empty" shell: no loading, no error — the content region is always rendered (never a hidden surface).
        var display = Project(new WidgetShellInput());

        Assert.False(display.ShowSkeleton);
        Assert.False(display.ShowError);
        Assert.False(display.HasTitle);
    }

    // ── title row (web `title ?`) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_title_drives_the_title_row_and_uppercase_display()
    {
        var display = Project(new WidgetShellInput { Title = "Battery Health" });

        Assert.True(display.HasTitle);
        Assert.Equal("Battery Health", display.Title);
        // web `uppercase` — display is uppercased while the accessible name keeps the original casing.
        Assert.Equal("Battery Health".ToUpper(CultureInfo.CurrentCulture), display.TitleDisplay);
        Assert.Equal("Battery Health", display.AccessibleName);
    }

    [Fact]
    public void Projection_titleless_has_no_title_and_an_empty_accessible_name()
    {
        var display = Project(new WidgetShellInput());

        Assert.False(display.HasTitle);
        Assert.Equal(string.Empty, display.Title);
        Assert.Equal(string.Empty, display.TitleDisplay);
        Assert.Equal(string.Empty, display.AccessibleName);
    }

    // ── help affordance (web `help && …` inside the title row) ────────────────────────────────────────────

    [Fact]
    public void Projection_help_shows_only_when_a_title_is_present()
    {
        var withTitle = Project(new WidgetShellInput
        {
            Title = "Battery",
            Help = new WidgetHelpInfo { Text = "State of health" },
        });
        var withoutTitle = Project(new WidgetShellInput
        {
            Help = new WidgetHelpInfo { Text = "State of health" },
        });

        // web nests the help affordance inside the `title ? (...)` branch.
        Assert.True(withTitle.ShowHelp);
        Assert.False(withoutTitle.ShowHelp);
    }

    [Fact]
    public void Projection_help_prefers_the_i18n_key_over_static_text()
    {
        var display = Project(new WidgetShellInput
        {
            Title = "Battery",
            Help = new WidgetHelpInfo { I18nKey = "translation.widget.help.body", DefaultValue = "Translated body", Text = "Ignored static" },
        });

        // PassthroughLocalizer returns the defaultValue fallback for the key.
        Assert.Equal("Translated body", display.HelpTooltipText);
    }

    [Fact]
    public void Projection_help_falls_back_to_static_text_without_a_key()
    {
        var display = Project(new WidgetShellInput
        {
            Title = "Battery",
            Help = new WidgetHelpInfo { Text = "State of health" },
        });

        Assert.Equal("State of health", display.HelpTooltipText);
    }

    [Fact]
    public void Projection_help_appends_the_learn_more_reference()
    {
        var display = Project(new WidgetShellInput
        {
            Title = "Battery",
            Help = new WidgetHelpInfo
            {
                Text = "State of health",
                LearnMoreUrl = "https://example.com/soh",
                LearnMoreLabel = "Learn more",
            },
        });

        Assert.True(display.HasLearnMore);
        Assert.Equal("https://example.com/soh", display.LearnMoreUrl);
        Assert.Equal("Learn more", display.LearnMoreLabel);
        Assert.Equal("State of health\nLearn more", display.HelpTooltipText);
    }

    [Fact]
    public void Projection_help_learn_more_uses_the_url_when_no_label()
    {
        var display = Project(new WidgetShellInput
        {
            Title = "Battery",
            Help = new WidgetHelpInfo { Text = "Body", LearnMoreUrl = "https://example.com" },
        });

        Assert.Equal("Body\nhttps://example.com", display.HelpTooltipText);
    }

    [Fact]
    public void Projection_help_accessible_name_is_help_for_title()
    {
        var display = Project(new WidgetShellInput
        {
            Title = "Battery",
            Help = new WidgetHelpInfo { Text = "Body" },
        });

        Assert.Equal("Help for Battery", display.HelpAccessibleName);
    }

    // ── freshness (web showFreshness + freshnessCompact) ──────────────────────────────────────────────────

    [Fact]
    public void Projection_freshness_hidden_when_not_requested()
    {
        var display = Project(new WidgetShellInput { Title = "Battery" });

        Assert.False(display.ShowFreshness);
    }

    [Fact]
    public void Projection_freshness_is_full_with_a_title_and_compact_without()
    {
        var titled = Project(new WidgetShellInput { Title = "Battery", HasFreshness = true });
        var titleless = Project(new WidgetShellInput { HasFreshness = true });

        // web freshnessCompact = !title.
        Assert.True(titled.ShowFreshness);
        Assert.False(titled.FreshnessCompact);
        Assert.True(titleless.ShowFreshness);
        Assert.True(titleless.FreshnessCompact);
    }

    [Fact]
    public void Projection_freshness_passes_through_the_four_primitives()
    {
        var updatedAt = new DateTimeOffset(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);
        var display = Project(new WidgetShellInput
        {
            Title = "Battery",
            HasFreshness = true,
            UpdatedAt = updatedAt,
            IsFetching = true,
            IsStale = true,
            IsError = false,
            FreshnessCanRefresh = true,
        });

        Assert.Equal(updatedAt, display.UpdatedAt);
        Assert.True(display.IsFetching);
        Assert.True(display.IsStale);
        Assert.False(display.IsError);
        Assert.True(display.FreshnessCanRefresh);
        Assert.Equal(updatedAt, display.EffectiveUpdatedAt);
    }

    [Theory]
    [InlineData(false, false, false)] // fresh
    [InlineData(true, false, false)]  // fetching
    [InlineData(false, true, false)]  // stale
    [InlineData(false, false, true)]  // error / offline-cached
    public void Projection_freshness_states_all_render_the_chip(bool fetching, bool stale, bool error)
    {
        var display = Project(new WidgetShellInput
        {
            Title = "Battery",
            HasFreshness = true,
            UpdatedAt = DateTimeOffset.UnixEpoch,
            IsFetching = fetching,
            IsStale = stale,
            IsError = error,
        });

        Assert.True(display.ShowFreshness);
        Assert.Equal(fetching, display.IsFetching);
        Assert.Equal(stale, display.IsStale);
        Assert.Equal(error, display.IsError);
    }

    [Fact]
    public void Projection_effective_updated_at_is_null_without_freshness()
    {
        // web effectiveUpdatedAt is undefined when neither updatedAt nor query is supplied, so no pulse fires.
        var display = Project(new WidgetShellInput { Title = "Battery", UpdatedAt = DateTimeOffset.UnixEpoch });

        Assert.True(display.HasTitle);
        Assert.Null(display.EffectiveUpdatedAt);
    }

    // ── pin toggle (web widgetId && dashboardId, inside the title row) ────────────────────────────────────

    [Fact]
    public void Projection_pin_requires_a_title_and_both_ids()
    {
        var ok = Project(new WidgetShellInput { Title = "Battery", WidgetId = "w1", DashboardId = "d1" });
        var noTitle = Project(new WidgetShellInput { WidgetId = "w1", DashboardId = "d1" });
        var noDashboard = Project(new WidgetShellInput { Title = "Battery", WidgetId = "w1" });
        var noWidget = Project(new WidgetShellInput { Title = "Battery", DashboardId = "d1" });

        Assert.True(ok.ShowPin);
        Assert.Equal("w1", ok.PinWidgetId);
        Assert.Equal("d1", ok.PinDashboardId);
        Assert.False(noTitle.ShowPin);
        Assert.False(noDashboard.ShowPin);
        Assert.False(noWidget.ShowPin);
    }

    // ── content padding (web noPadding) ───────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Projection_no_padding_passes_through(bool noPadding)
    {
        var display = Project(new WidgetShellInput { NoPadding = noPadding });

        Assert.Equal(noPadding, display.NoPadding);
    }

    [Fact]
    public void Projection_throws_when_inputs_or_localizer_are_null()
    {
        Assert.Throws<ArgumentNullException>(() => WidgetShellProjection.Project(input: null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => WidgetShellProjection.Project(new WidgetShellInput(), localizer: null!));
    }

    // ── per-state snapshots (the reproduced render branches) ──────────────────────────────────────────────

    [Fact]
    public void Snapshot_loading_state()
    {
        var display = Project(new WidgetShellInput { Loading = true });

        Assert.True(display.ShowSkeleton);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void Snapshot_error_state()
    {
        var display = Project(new WidgetShellInput { ErrorMessage = "Failed to load" });

        Assert.True(display.ShowError);
        Assert.Equal("Failed to load", display.ErrorMessage);
    }

    [Fact]
    public void Snapshot_titled_shell_with_everything()
    {
        var display = Project(new WidgetShellInput
        {
            Title = "Battery",
            Help = new WidgetHelpInfo { Text = "State of health" },
            HasFreshness = true,
            UpdatedAt = DateTimeOffset.UnixEpoch,
            FreshnessCanRefresh = true,
            WidgetId = "w1",
            DashboardId = "d1",
        });

        Assert.False(display.ShowSkeleton);
        Assert.False(display.ShowError);
        Assert.True(display.HasTitle);
        Assert.True(display.ShowHelp);
        Assert.True(display.ShowFreshness);
        Assert.False(display.FreshnessCompact);
        Assert.True(display.ShowPin);
    }

    [Fact]
    public void Snapshot_titleless_shell_with_overlay_freshness()
    {
        var display = Project(new WidgetShellInput { HasFreshness = true, NoPadding = true });

        Assert.False(display.HasTitle);
        Assert.True(display.ShowFreshness);
        Assert.True(display.FreshnessCompact);
        Assert.False(display.ShowHelp);
        Assert.False(display.ShowPin);
        Assert.True(display.NoPadding);
    }

    // ── view-model (state holder) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("WidgetShell", WidgetShellViewModel.Slug);

    [Fact]
    public void ViewModel_exposes_the_localizer_for_child_surface_composition()
    {
        using var viewModel = new WidgetShellViewModel(Localizer, new StaticWidgetShellSource());

        Assert.Same(Localizer, viewModel.Localizer);
    }

    [Fact]
    public void ViewModel_default_projects_the_empty_shell()
    {
        using var viewModel = new WidgetShellViewModel(Localizer, new StaticWidgetShellSource());

        Assert.False(viewModel.ShowSkeleton);
        Assert.False(viewModel.ShowError);
        Assert.False(viewModel.HasTitle);
        Assert.False(viewModel.ShowFreshness);
        Assert.False(viewModel.ShowPin);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_source_toggles_loading()
    {
        var source = new StaticWidgetShellSource();
        using var viewModel = new WidgetShellViewModel(Localizer, source);
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        source.SetLoading(true);

        Assert.True(viewModel.ShowSkeleton);
        Assert.Contains(nameof(WidgetShellViewModel.Display), changed);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_source_sets_an_error()
    {
        var source = new StaticWidgetShellSource();
        using var viewModel = new WidgetShellViewModel(Localizer, source);

        source.SetError("Boom");

        Assert.True(viewModel.ShowError);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_source_sets_freshness()
    {
        var source = new StaticWidgetShellSource();
        using var viewModel = new WidgetShellViewModel(Localizer, source);

        source.SetFreshness(DateTimeOffset.UnixEpoch, isFetching: false, isStale: true, isError: false, canRefresh: true);

        Assert.True(viewModel.ShowFreshness);
        Assert.True(viewModel.Display.IsStale);
        Assert.True(viewModel.Display.FreshnessCanRefresh);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_source_replaces_the_whole_input()
    {
        var source = new StaticWidgetShellSource();
        using var viewModel = new WidgetShellViewModel(Localizer, source);

        source.Set(new WidgetShellInput { Title = "Battery", WidgetId = "w1", DashboardId = "d1" });

        Assert.True(viewModel.HasTitle);
        Assert.True(viewModel.ShowPin);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_source()
    {
        var source = new CountingSource();
        var viewModel = new WidgetShellViewModel(Localizer, source);
        Assert.Equal(1, source.ObserverCount);

        viewModel.Dispose();

        Assert.Equal(0, source.ObserverCount);

        // After dispose a late change must not move the projection.
        source.PushLoading();
        Assert.False(viewModel.ShowSkeleton);
    }

    [Fact]
    public void ViewModel_throws_for_null_seams()
    {
        Assert.Throws<ArgumentNullException>(
            () => new WidgetShellViewModel(localizer: null!, new StaticWidgetShellSource()));
        Assert.Throws<ArgumentNullException>(
            () => new WidgetShellViewModel(Localizer, source: null!));
    }

    // ── source seam ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Source_null_assignments_fall_back_to_a_safe_default()
    {
        var source = new StaticWidgetShellSource(current: null!);
        Assert.NotNull(source.Current);

        source.Set(null!);
        Assert.NotNull(source.Current);
    }

    [Fact]
    public void Source_set_freshness_marks_has_freshness()
    {
        var source = new StaticWidgetShellSource();
        source.SetFreshness(DateTimeOffset.UnixEpoch, isFetching: true, isStale: false, isError: false);

        Assert.True(source.Current.HasFreshness);
        Assert.True(source.Current.IsFetching);
    }

    // ── diagnostics (view.opened, PII-safe — only the slug) ───────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new WidgetShellDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WidgetShell", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new WidgetShellDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    /// <summary>A props seam that counts live observers so dispose-cleanup is asserted.</summary>
    private sealed class CountingSource : IWidgetShellSource
    {
        private WidgetShellInput _current = new();

        public event EventHandler? Changed;

        public WidgetShellInput Current => _current;

        public int ObserverCount => Changed?.GetInvocationList().Length ?? 0;

        public void PushLoading()
        {
            _current = _current with { Loading = true };
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }
}
