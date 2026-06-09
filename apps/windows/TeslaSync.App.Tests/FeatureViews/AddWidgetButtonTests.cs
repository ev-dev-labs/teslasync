using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AddWidgetButton</c> feature surface's UI-thread-free logic — the
/// edit-mode visibility guard (web <c>if (isEditing) return null</c>), the single i18n label resolution
/// (web <c>t('dashboard.addWidget', 'Add Widget')</c>) reused for the tooltip and the accessible name, the
/// composed Narrator name, the PII-safe diagnostics and the registration metadata. Mirrors the web spec
/// (web/src/features/dashboard/components/AddWidgetButton.tsx). The WinUI view itself
/// (feature-views\AddWidgetButton\AddWidgetButton.cs) is exercised by the app build.
/// </summary>
public sealed class AddWidgetButtonTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static AddWidgetButtonDisplay Project(bool isEditing, ILocalizer? localizer = null) =>
        AddWidgetButtonProjection.Project(new AddWidgetButtonModel(isEditing), localizer ?? Localizer);

    // ── Visibility (web `if (isEditing) return null`) ────────────────────────────────────────────────

    [Fact]
    public void Not_editing_shows_the_fab()
    {
        Assert.True(Project(isEditing: false).IsVisible);
    }

    [Fact]
    public void Editing_hides_the_fab()
    {
        Assert.False(Project(isEditing: true).IsVisible);
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public void Visibility_is_the_inverse_of_edit_mode(bool isEditing, bool expectedVisible)
    {
        Assert.Equal(expectedVisible, Project(isEditing).IsVisible);
    }

    // ── Per-state "snapshot": each state renders a complete, distinct display ─────────────────────────

    [Fact]
    public void Visible_state_renders_a_complete_display()
    {
        var d = Project(isEditing: false);

        Assert.True(d.IsVisible);
        Assert.Equal("Add Widget", d.Label);
        Assert.Equal("Add Widget", d.AutomationName);
        Assert.Equal("Add Widget", d.TooltipHint);
    }

    [Fact]
    public void Editing_state_hides_the_surface_while_keeping_resolved_copy()
    {
        var d = Project(isEditing: true);

        Assert.False(d.IsVisible);
        Assert.Equal("Add Widget", d.Label);
        Assert.Equal("Add Widget", d.TooltipHint);
    }

    // ── Model defaults ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Model_named_instances_match_their_edit_flag()
    {
        Assert.False(AddWidgetButtonModel.Visible.IsEditing);
        Assert.True(AddWidgetButtonModel.Editing.IsEditing);
    }

    // ── i18n: the single label resolves through the dashboard.addWidget key ───────────────────────────

    [Fact]
    public void Label_resolves_through_the_dashboard_addWidget_key()
    {
        var fake = new RecordingLocalizer();

        var d = AddWidgetButtonProjection.Project(AddWidgetButtonModel.Visible, fake);

        Assert.Equal("dashboard.addWidget", fake.LastKey);
        Assert.Equal("Add Widget", fake.LastFallback);
        Assert.Equal("__dashboard.addWidget__", d.Label);
    }

    [Fact]
    public void Label_flows_through_the_localizer_verbatim_with_no_hardcoded_english()
    {
        // A non-ASCII translation must pass through to every label slot, proving the surface contributes no
        // hardcoded English of its own — the only copy is the keyed dashboard.addWidget string.
        const string localized = "ウィジェットを追加";
        var fake = new RecordingLocalizer(localized);

        var d = AddWidgetButtonProjection.Project(AddWidgetButtonModel.Visible, fake);

        Assert.Equal(localized, d.Label);
        Assert.Equal(localized, d.AutomationName);
        Assert.Equal(localized, d.TooltipHint);
    }

    // ── Accessibility (Narrator name == the localized label, web `aria-label`) ────────────────────────

    [Fact]
    public void AutomationName_is_the_localized_label()
    {
        var d = Project(isEditing: false);

        Assert.Equal(d.Label, d.AutomationName);
        Assert.False(string.IsNullOrWhiteSpace(d.AutomationName));
    }

    // ── Null-argument guards ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model()
    {
        Assert.Throws<ArgumentNullException>(() =>
            AddWidgetButtonProjection.Project(null!, Localizer));
    }

    [Fact]
    public void Project_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() =>
            AddWidgetButtonProjection.Project(AddWidgetButtonModel.Visible, null!));
    }

    [Fact]
    public void Label_rejects_a_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => AddWidgetButtonRegistration.Label(null!));
    }

    // ── Diagnostics (P1/S11): view.opened + activation, PII-safe ──────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new AddWidgetButtonDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AddWidgetButton", captured[0]);
        Assert.Equal("view.opened slug=AddWidgetButton", captured[1]);
    }

    [Fact]
    public void Diagnostics_records_activation_without_leaking_state()
    {
        var captured = new List<string>();
        var diagnostics = new AddWidgetButtonDiagnostics(captured.Add);

        diagnostics.RecordActivated();

        Assert.Equal(1, diagnostics.Activations);
        Assert.Equal("add-widget.activated slug=AddWidgetButton", captured[0]);
    }

    // ── Registration metadata ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_the_slug_key_fallback_and_glyph()
    {
        Assert.Equal("AddWidgetButton", AddWidgetButtonRegistration.Slug);
        Assert.Equal("dashboard.addWidget", AddWidgetButtonRegistration.LabelKey);
        Assert.Equal("Add Widget", AddWidgetButtonRegistration.LabelFallback);
        Assert.Equal("\uE710", AddWidgetButtonRegistration.AddGlyph);
        Assert.Equal("Add Widget", AddWidgetButtonRegistration.Label(Localizer));
    }

    /// <summary>An <see cref="ILocalizer"/> test double that records the last key/fallback and returns either
    /// a configured translation or a per-key sentinel so the keyed call site is asserted headlessly.</summary>
    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly string? _override;

        public RecordingLocalizer(string? translation = null) => _override = translation;

        public string? LastKey { get; private set; }

        public string? LastFallback { get; private set; }

        public string GetString(string key, string fallback)
        {
            LastKey = key;
            LastFallback = fallback;
            return _override ?? $"__{key}__";
        }
    }
}
