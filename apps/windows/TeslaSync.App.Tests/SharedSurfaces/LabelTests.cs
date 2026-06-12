using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces.LabelSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>Label</c> shared surface's UI-thread-free logic — the projection's render
/// branches (the always-present label text, and the optional required marker: the decorative aria-hidden glyph
/// plus the visually-hidden "required" word), the i18n-resolved required word, the composed accessible name (web
/// label accessible-name computation), the <c>htmlFor</c> pass-through, the state holder's change notification,
/// the registration metadata and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (<c>web/src/components/ui/Label.tsx</c>). The WinUI view itself (Label.cs) is exercised by the app build.
/// </summary>
public sealed class LabelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static LabelDisplay Project(LabelModel model) => LabelProjection.Project(model, Localizer);

    // ── registration (diagnostics slug) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("Label", LabelRegistration.Slug);

    // ── bare branch: label text only (not required) ──────────────────────────────────────────────────────

    [Fact]
    public void Bare_label_shows_only_the_text()
    {
        LabelDisplay d = Project(new LabelModel("Email"));

        Assert.Equal("Email", d.Text);
        Assert.False(d.ShowRequired);
        Assert.Null(d.RequiredText);
        Assert.Equal("Email", d.AccessibleName);
    }

    [Fact]
    public void Caller_supplied_text_is_passed_through_verbatim()
    {
        // children is an already-localized caller string (web passes t(...) results), so it is surfaced verbatim;
        // only the required word is keyed by this surface.
        LabelDisplay d = Project(new LabelModel("Drive efficiency"));

        Assert.Equal("Drive efficiency", d.Text);
    }

    [Fact]
    public void Empty_label_text_is_allowed()
    {
        LabelDisplay d = Project(new LabelModel(string.Empty));

        Assert.Equal(string.Empty, d.Text);
        Assert.Equal(string.Empty, d.AccessibleName);
    }

    // ── required marker (web required ? <* aria-hidden> + <VisuallyHidden>required</VisuallyHidden> : null) ─

    [Fact]
    public void Required_marker_is_hidden_by_default()
    {
        LabelDisplay d = Project(new LabelModel("Email"));

        Assert.False(d.ShowRequired);
        Assert.Null(d.RequiredText);
    }

    [Fact]
    public void Required_shows_the_decorative_glyph_and_the_hidden_word()
    {
        LabelDisplay d = Project(new LabelModel("Email", required: true));

        Assert.True(d.ShowRequired);

        // The visible glyph is the decorative aria-hidden "*", distinct from the voiced word — Narrator hears
        // "required", never "asterisk".
        Assert.Equal("*", d.RequiredGlyph);
        Assert.Equal("required", d.RequiredText);
    }

    [Fact]
    public void Required_glyph_constant_is_an_asterisk() =>
        Assert.Equal("*", LabelProjection.RequiredGlyph);

    // ── composed accessible name (web label accessible name: text + visually-hidden word, glyph excluded) ──

    [Fact]
    public void Accessible_name_appends_the_required_word_to_the_label()
    {
        // web doc-comment: the accessible name of the paired control becomes e.g. "Email required".
        LabelDisplay d = Project(new LabelModel("Email", required: true));

        Assert.Equal("Email required", d.AccessibleName);
    }

    [Fact]
    public void Accessible_name_is_just_the_text_when_not_required()
    {
        LabelDisplay d = Project(new LabelModel("Email"));

        Assert.Equal("Email", d.AccessibleName);
    }

    [Fact]
    public void Accessible_name_collapses_to_the_required_word_when_text_is_empty()
    {
        // web: empty children + " required" -> the browser trims the leading separator, leaving "required".
        LabelDisplay d = Project(new LabelModel(string.Empty, required: true));

        Assert.Equal("required", d.AccessibleName);
    }

    // ── i18n: required word resolves through the facade (web t('form.required', 'required')) ───────────────

    [Fact]
    public void Required_word_resolves_through_the_i18n_facade()
    {
        var keys = new List<string>();
        ILocalizer recording = new RecordingLocalizer(keys);

        LabelDisplay d = LabelProjection.Project(new LabelModel("Email", required: true), recording);

        Assert.Equal(LabelProjection.RequiredKey, Assert.Single(keys));
        Assert.Equal("form.required", LabelProjection.RequiredKey);
        Assert.Equal("required", LabelProjection.RequiredFallback);
        Assert.Equal("required", d.RequiredText);
    }

    [Fact]
    public void Required_word_is_not_keyed_when_not_required()
    {
        var keys = new List<string>();
        ILocalizer recording = new RecordingLocalizer(keys);

        LabelProjection.Project(new LabelModel("Email"), recording);

        Assert.Empty(keys);
    }

    [Fact]
    public void Required_word_uses_the_localized_value()
    {
        // A non-English localization is reflected in both the voiced word and the composed accessible name.
        ILocalizer german = new FixedLocalizer("erforderlich");

        LabelDisplay d = LabelProjection.Project(new LabelModel("E-Mail", required: true), german);

        Assert.Equal("erforderlich", d.RequiredText);
        Assert.Equal("E-Mail erforderlich", d.AccessibleName);
    }

    // ── htmlFor pass-through (web htmlFor attribute) ──────────────────────────────────────────────────────

    [Fact]
    public void Html_for_defaults_to_null()
    {
        LabelDisplay d = Project(new LabelModel("Email"));

        Assert.Null(d.HtmlFor);
    }

    [Fact]
    public void Html_for_is_passed_through()
    {
        LabelDisplay d = Project(new LabelModel("Email", htmlFor: "email-input"));

        Assert.Equal("email-input", d.HtmlFor);
    }

    // ── view-model (state holder): default, projection, change notification ───────────────────────────────

    [Fact]
    public void ViewModel_defaults_to_the_empty_model()
    {
        var viewModel = new LabelViewModel(Localizer);

        Assert.Same(LabelModel.Empty, viewModel.Model);
        Assert.Equal(string.Empty, viewModel.Display.Text);
        Assert.Equal(string.Empty, viewModel.AccessibleName);
    }

    [Fact]
    public void ViewModel_projects_the_current_model()
    {
        var viewModel = new LabelViewModel(Localizer, new LabelModel("Email", required: true));

        Assert.Equal("Email required", viewModel.Display.AccessibleName);
        Assert.Equal("Email required", viewModel.AccessibleName);
    }

    [Fact]
    public void ViewModel_raises_change_for_model_and_display_on_assignment()
    {
        var viewModel = new LabelViewModel(Localizer, new LabelModel("Email"));
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        viewModel.Model = new LabelModel("Email", required: true);

        Assert.Contains(nameof(LabelViewModel.Model), changed);
        Assert.Contains(nameof(LabelViewModel.Display), changed);
    }

    [Fact]
    public void ViewModel_does_not_raise_for_an_equal_model()
    {
        var viewModel = new LabelViewModel(Localizer, new LabelModel("Email"));
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        // LabelModel is a record (value equality) — assigning an equal model is a no-op render.
        viewModel.Model = new LabelModel("Email");

        Assert.Empty(changed);
    }

    // ── diagnostics (view.opened, PII-safe — never the label text) ────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new LabelDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=Label", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new LabelDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── argument guards ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Model_rejects_a_null_text() =>
        Assert.Throws<System.ArgumentNullException>(() => new LabelModel(null!));

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<System.ArgumentNullException>(() => LabelProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(() => LabelProjection.Project(LabelModel.Empty, null!));

    [Fact]
    public void ViewModel_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(() => new LabelViewModel(null!));

    [Fact]
    public void ViewModel_rejects_a_null_model_assignment()
    {
        var viewModel = new LabelViewModel(Localizer);

        Assert.Throws<System.ArgumentNullException>(() => viewModel.Model = null!);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly List<string> _keys;

        public RecordingLocalizer(List<string> keys) => _keys = keys;

        public string GetString(string key, string fallback)
        {
            _keys.Add(key);
            return fallback;
        }
    }

    private sealed class FixedLocalizer : ILocalizer
    {
        private readonly string _value;

        public FixedLocalizer(string value) => _value = value;

        public string GetString(string key, string fallback) => _value;
    }
}
