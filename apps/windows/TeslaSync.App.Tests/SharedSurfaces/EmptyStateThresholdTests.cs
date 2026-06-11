using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the EmptyStateThreshold shared surface's UI-thread-free logic — the registration
/// metadata (slug, automation id, status role, the check/info glyphs + icon sizes, and the two i18n keys with
/// their verbatim web English fallbacks), the pure <see cref="EmptyStateThresholdProjection"/> (the default count
/// message composition, the <c>message ?? defaultMessage</c> override, the <c>itemNoun ?? t(defaultItem)</c>
/// noun, the description / action guards, the composed status accessible name and the localizer routing), the
/// <see cref="StaticEmptyStateThresholdSource"/> seam (P1/S8), the <see cref="EmptyStateThresholdViewModel"/>
/// state holder (initial projection, source reprojection, subscription cleanup) and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/components/feedback/EmptyStateThreshold.tsx). The WinUI view itself
/// (shared-surfaces/EmptyStateThreshold/EmptyStateThreshold.cs) is exercised by the app build.
/// </summary>
public sealed class EmptyStateThresholdTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private const string DefaultMessage30Items12 =
        "Need at least 30 items to show meaningful patterns. You have 12 so far.";

    private static EmptyStateThresholdDisplay Project(EmptyStateThresholdInput input, ILocalizer? localizer = null) =>
        EmptyStateThresholdProjection.Project(input, localizer ?? Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("EmptyStateThreshold", EmptyStateThresholdRegistration.Slug);

    [Fact]
    public void Root_automation_id_is_stable() =>
        Assert.Equal("empty-state-threshold", EmptyStateThresholdRegistration.RootAutomationId);

    [Fact]
    public void Status_role_is_a_polite_status_region() =>
        Assert.Equal("status", EmptyStateThresholdRegistration.StatusRole);

    [Fact]
    public void Icon_sizes_match_the_web_lucide_icons()
    {
        // web: CheckCircle2 h-5 w-5 (20) and Info h-3 w-3 (12).
        Assert.Equal(20, EmptyStateThresholdRegistration.CheckIconSize);
        Assert.Equal(12, EmptyStateThresholdRegistration.InfoIconSize);
        Assert.False(string.IsNullOrEmpty(EmptyStateThresholdRegistration.CheckGlyph));
        Assert.False(string.IsNullOrEmpty(EmptyStateThresholdRegistration.InfoGlyph));
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        Assert.Equal("translation.emptyState.threshold.defaultItem", EmptyStateThresholdRegistration.DefaultItemKey);
        Assert.Equal("items", EmptyStateThresholdRegistration.DefaultItemFallback);
        Assert.Equal("translation.emptyState.threshold.message", EmptyStateThresholdRegistration.MessageKey);
        Assert.Equal(
            "Need at least {{threshold}} {{noun}} to show meaningful patterns. You have {{current}} so far.",
            EmptyStateThresholdRegistration.MessageFallback);
    }

    // ── projection: default message + noun resolution ──────────────────────────────────────────────────────

    [Fact]
    public void Projection_default_message_uses_the_default_item_noun()
    {
        var display = Project(new EmptyStateThresholdInput
        {
            CurrentCount = 12,
            Threshold = 30,
            SectionLabel = "Cost Heatmap",
        });

        Assert.Equal("items", display.Noun);
        Assert.Equal(DefaultMessage30Items12, display.Message);
        Assert.Equal("Cost Heatmap", display.Title);
    }

    [Fact]
    public void Projection_default_message_uses_a_supplied_noun()
    {
        var display = Project(new EmptyStateThresholdInput
        {
            CurrentCount = 5,
            Threshold = 30,
            ItemNoun = "sessions",
            SectionLabel = "Cost Heatmap",
        });

        Assert.Equal("sessions", display.Noun);
        Assert.Equal(
            "Need at least 30 sessions to show meaningful patterns. You have 5 so far.",
            display.Message);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Projection_blank_noun_falls_back_to_the_default(string? noun)
    {
        var display = Project(new EmptyStateThresholdInput { Threshold = 10, ItemNoun = noun });
        Assert.Equal("items", display.Noun);
    }

    [Fact]
    public void Projection_substitutes_all_three_count_tokens()
    {
        var display = Project(new EmptyStateThresholdInput
        {
            CurrentCount = 3,
            Threshold = 50,
            ItemNoun = "drives",
        });

        Assert.DoesNotContain("{{", display.Message, StringComparison.Ordinal);
        Assert.Contains("50 drives", display.Message, StringComparison.Ordinal);
        Assert.Contains("3 so far", display.Message, StringComparison.Ordinal);
    }

    // ── projection: message override (web message ?? defaultMessage) ─────────────────────────────────────────

    [Fact]
    public void Projection_custom_message_overrides_the_default()
    {
        var display = Project(new EmptyStateThresholdInput
        {
            CurrentCount = 1,
            Threshold = 30,
            Message = "Almost there — keep driving!",
        });

        Assert.Equal("Almost there — keep driving!", display.Message);
    }

    [Fact]
    public void Projection_null_message_uses_the_default()
    {
        var display = Project(new EmptyStateThresholdInput { CurrentCount = 12, Threshold = 30, Message = null });
        Assert.Equal(DefaultMessage30Items12, display.Message);
    }

    [Fact]
    public void Projection_empty_message_is_honoured_not_defaulted()
    {
        // web: message ?? defaultMessage — only null (not "") falls back, so an explicit empty override stays empty.
        var display = Project(new EmptyStateThresholdInput { CurrentCount = 12, Threshold = 30, Message = string.Empty });
        Assert.Equal(string.Empty, display.Message);
    }

    // ── projection: description guard (web description && …) ─────────────────────────────────────────────────

    [Fact]
    public void Projection_with_description_shows_it()
    {
        var display = Project(new EmptyStateThresholdInput
        {
            Threshold = 30,
            SectionLabel = "Cost Heatmap",
            Description = "Unlocks deeper patterns at scale.",
        });

        Assert.True(display.HasDescription);
        Assert.Equal("Unlocks deeper patterns at scale.", display.Description);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Projection_without_description_hides_it(string? description)
    {
        var display = Project(new EmptyStateThresholdInput { Threshold = 30, Description = description });

        Assert.False(display.HasDescription);
        Assert.Equal(string.Empty, display.Description);
    }

    // ── projection: action guard (web action && …) ───────────────────────────────────────────────────────────

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Projection_reflects_the_action_slot(bool hasAction)
    {
        var display = Project(new EmptyStateThresholdInput { Threshold = 30, HasAction = hasAction });
        Assert.Equal(hasAction, display.HasAction);
    }

    // ── projection: accessible status text (web role="status") ───────────────────────────────────────────────

    [Fact]
    public void Projection_accessible_name_composes_title_description_and_message()
    {
        var display = Project(new EmptyStateThresholdInput
        {
            CurrentCount = 12,
            Threshold = 30,
            SectionLabel = "Cost Heatmap",
            Description = "Unlocks at scale.",
        });

        Assert.Equal($"Cost Heatmap Unlocks at scale. {DefaultMessage30Items12}", display.AccessibleName);
    }

    [Fact]
    public void Projection_accessible_name_omits_absent_parts()
    {
        var display = Project(new EmptyStateThresholdInput { CurrentCount = 12, Threshold = 30 });

        // No section label, no description → the status text is just the count message.
        Assert.Equal(DefaultMessage30Items12, display.AccessibleName);
    }

    // ── projection: localizer routing, equality, guards ──────────────────────────────────────────────────────

    [Fact]
    public void Projection_resolves_strings_through_the_localizer()
    {
        var localizer = new StubLocalizer(new Dictionary<string, string>
        {
            [EmptyStateThresholdRegistration.DefaultItemKey] = "éléments",
            [EmptyStateThresholdRegistration.MessageKey] =
                "Au moins {{threshold}} {{noun}} requis. Vous en avez {{current}}.",
        });

        var display = Project(new EmptyStateThresholdInput { CurrentCount = 5, Threshold = 30 }, localizer);

        Assert.Equal("éléments", display.Noun);
        Assert.Equal("Au moins 30 éléments requis. Vous en avez 5.", display.Message);
    }

    [Fact]
    public void Projection_value_equality_makes_identical_states_equal()
    {
        var a = Project(new EmptyStateThresholdInput { CurrentCount = 12, Threshold = 30, SectionLabel = "Cost Heatmap" });
        var b = Project(new EmptyStateThresholdInput { CurrentCount = 12, Threshold = 30, SectionLabel = "Cost Heatmap" });
        var different = Project(new EmptyStateThresholdInput { CurrentCount = 13, Threshold = 30, SectionLabel = "Cost Heatmap" });

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    [Fact]
    public void Project_throws_when_dependencies_are_null()
    {
        Assert.Throws<ArgumentNullException>(() => EmptyStateThresholdProjection.Project(null!, Localizer));
        Assert.Throws<ArgumentNullException>(
            () => EmptyStateThresholdProjection.Project(new EmptyStateThresholdInput(), null!));
    }

    // ── source (P1/S8 seam) ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void StaticSource_set_raises_changed_and_updates_current()
    {
        var source = new StaticEmptyStateThresholdSource();
        var changes = 0;
        source.Changed += (_, _) => changes++;

        source.Set(new EmptyStateThresholdInput { SectionLabel = "Optimizer", Threshold = 7 });

        Assert.Equal("Optimizer", source.Current.SectionLabel);
        Assert.Equal(7, source.Current.Threshold);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void StaticSource_set_counts_keeps_the_other_inputs()
    {
        var source = new StaticEmptyStateThresholdSource(new EmptyStateThresholdInput
        {
            SectionLabel = "Cost Heatmap",
            ItemNoun = "sessions",
            CurrentCount = 1,
            Threshold = 30,
        });

        source.SetCounts(12, 30);

        Assert.Equal(12, source.Current.CurrentCount);
        Assert.Equal("Cost Heatmap", source.Current.SectionLabel);
        Assert.Equal("sessions", source.Current.ItemNoun);
    }

    [Fact]
    public void StaticSource_null_input_falls_back_to_a_safe_default()
    {
        var source = new StaticEmptyStateThresholdSource(null!);
        Assert.Equal(0, source.Current.Threshold);

        source.Set(null!);
        Assert.NotNull(source.Current);
        Assert.Equal(string.Empty, source.Current.SectionLabel);
    }

    // ── view-model (state holder) ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("EmptyStateThreshold", EmptyStateThresholdViewModel.Slug);

    [Fact]
    public void ViewModel_starts_from_the_source_input()
    {
        var source = new StaticEmptyStateThresholdSource(new EmptyStateThresholdInput
        {
            CurrentCount = 12,
            Threshold = 30,
            SectionLabel = "Cost Heatmap",
        });
        using var viewModel = new EmptyStateThresholdViewModel(Localizer, source);

        Assert.Equal("Cost Heatmap", viewModel.Title);
        Assert.Equal(DefaultMessage30Items12, viewModel.Message);
        Assert.False(viewModel.HasDescription);
        Assert.False(viewModel.HasAction);
        Assert.Contains("Cost Heatmap", viewModel.AccessibleName, StringComparison.Ordinal);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_input_changes()
    {
        var source = new StaticEmptyStateThresholdSource(new EmptyStateThresholdInput { Threshold = 30, CurrentCount = 1 });
        using var viewModel = new EmptyStateThresholdViewModel(Localizer, source);
        var changes = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changes.Add(e.PropertyName);

        source.SetCounts(12, 30);

        Assert.Contains("12 so far", viewModel.Message, StringComparison.Ordinal);
        Assert.Contains(nameof(EmptyStateThresholdViewModel.Display), changes);
    }

    [Fact]
    public void ViewModel_does_not_renotify_for_an_identical_projection()
    {
        var source = new StaticEmptyStateThresholdSource(new EmptyStateThresholdInput { Threshold = 30, CurrentCount = 12 });
        using var viewModel = new EmptyStateThresholdViewModel(Localizer, source);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        source.Set(new EmptyStateThresholdInput { Threshold = 30, CurrentCount = 12 });

        Assert.Equal(0, changes);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_source()
    {
        var source = new StaticEmptyStateThresholdSource(new EmptyStateThresholdInput { Threshold = 30, CurrentCount = 1 });
        var viewModel = new EmptyStateThresholdViewModel(Localizer, source);

        viewModel.Dispose();

        var raised = false;
        viewModel.PropertyChanged += (_, _) => raised = true;
        source.SetCounts(99, 30);

        Assert.False(raised);
    }

    [Fact]
    public void ViewModel_throws_when_dependencies_are_null()
    {
        var source = new StaticEmptyStateThresholdSource();
        Assert.Throws<ArgumentNullException>(() => new EmptyStateThresholdViewModel(null!, source));
        Assert.Throws<ArgumentNullException>(() => new EmptyStateThresholdViewModel(Localizer, null!));
    }

    // ── diagnostics (view.opened, PII-safe — only the slug) ──────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new EmptyStateThresholdDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=EmptyStateThreshold", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new EmptyStateThresholdDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    private sealed class StubLocalizer : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string> _map;

        public StubLocalizer(IReadOnlyDictionary<string, string> map) => _map = map;

        public string GetString(string key, string fallback) =>
            _map.TryGetValue(key, out var value) ? value : fallback;
    }
}
