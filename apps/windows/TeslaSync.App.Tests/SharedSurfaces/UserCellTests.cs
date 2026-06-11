using System.Collections.Generic;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the UserCell surface's UI-thread-free logic — the registration slug + automation
/// ids + em-dash marker + i18n key (<see cref="UserCellRegistration"/>), the layout metrics
/// (<see cref="UserCellMetrics"/>), the pure <see cref="UserCellProjection"/> adapter (the empty vs populated
/// branch, the name → email-local-part → id → localized "Unknown user" display-name priority chain, the
/// optional email line, the composed <see cref="AvatarProps"/> mapping and the accessible name), the
/// <see cref="UserCellViewModel"/> state holder (initial projection, language-change re-projection, no-op
/// guard) and the PII-safe diagnostics. Mirrors the web spec one-for-one
/// (web/src/components/data-display/UserCell.tsx). The WinUI view (shared-surfaces/UserCell/UserCell.cs, which
/// composes the Avatar surface + a name/email text column or the em-dash) is exercised by the app build.
/// </summary>
public sealed class UserCellTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("UserCell", UserCellRegistration.Slug);

    [Fact]
    public void Automation_ids_match_the_web_test_ids()
    {
        Assert.Equal("user-cell", UserCellRegistration.RootAutomationId);
        Assert.Equal("user-cell-empty", UserCellRegistration.EmptyAutomationId);
        Assert.Equal("user-cell-name", UserCellRegistration.NameAutomationId);
        Assert.Equal("user-cell-email", UserCellRegistration.EmailAutomationId);
    }

    [Fact]
    public void Empty_marker_is_the_em_dash_the_web_renders()
    {
        // web: the empty cell is a literal em-dash (—, U+2014).
        Assert.Equal("\u2014", UserCellRegistration.EmptyMarker);
    }

    [Fact]
    public void Unknown_user_key_reuses_the_shared_avatar_catalog_key()
    {
        // web: t('avatar.unknown', 'Unknown user') — the same key the composed Avatar resolves, so the copy is
        // shared and exists once in Strings/{en,he,ar}/Resources.resw.
        Assert.Equal("translation.avatar.unknown", UserCellRegistration.UnknownUserKey);
        Assert.Equal("Unknown user", UserCellRegistration.UnknownUserFallback);
        Assert.Equal(AvatarRegistration.UnknownKey, UserCellRegistration.UnknownUserKey);
        Assert.Equal(AvatarRegistration.UnknownFallback, UserCellRegistration.UnknownUserFallback);
    }

    // ── metrics (web gap-2 = 8, text-sm = 14, text-xs = 12) ───────────────────────────────────────────────

    [Fact]
    public void Metrics_match_the_web_tailwind_sizes()
    {
        Assert.Equal(8, UserCellMetrics.RowSpacing);
        Assert.Equal(14, UserCellMetrics.NameFontPx);
        Assert.Equal(12, UserCellMetrics.EmailFontPx);
    }

    // ── projection: empty branch (no usable user signal) ──────────────────────────────────────────────────

    [Fact]
    public void Null_user_renders_the_empty_em_dash_cell()
    {
        var projection = UserCellProjection.Project(new UserCellProps(User: null), Localizer);

        Assert.Equal(UserCellContentMode.Empty, projection.ContentMode);
        Assert.Equal("\u2014", projection.AccessibleName);
        Assert.Equal(string.Empty, projection.DisplayName);
        Assert.False(projection.ShowEmailLine);
    }

    [Fact]
    public void User_with_no_name_email_or_id_renders_the_empty_cell()
    {
        // web: !user.name && !user.email && !user.id — a falsy (null/empty) value for all three.
        var allEmpty = UserCellProjection.Project(
            new UserCellProps(new UserCellUser(Id: "", Name: "", Email: "")), Localizer);
        Assert.Equal(UserCellContentMode.Empty, allEmpty.ContentMode);

        var allNull = UserCellProjection.Project(new UserCellProps(new UserCellUser()), Localizer);
        Assert.Equal(UserCellContentMode.Empty, allNull.ContentMode);
    }

    [Fact]
    public void Whitespace_only_name_is_not_empty_and_falls_through_to_unknown()
    {
        // web: a whitespace-only name is truthy (not empty-guarded), but name?.trim() is "" so the display name
        // falls through the || chain to the localized "Unknown user" label.
        var projection = UserCellProjection.Project(
            new UserCellProps(new UserCellUser(Name: "   ")), Localizer);

        Assert.Equal(UserCellContentMode.Populated, projection.ContentMode);
        Assert.Equal("Unknown user", projection.DisplayName);
    }

    // ── projection: display-name priority (name → email local-part → id → unknown) ────────────────────────

    [Fact]
    public void Display_name_prefers_the_trimmed_name()
    {
        var projection = UserCellProjection.Project(
            new UserCellProps(new UserCellUser(Id: "u1", Name: "  John Doe  ", Email: "j@x.com")), Localizer);

        Assert.Equal(UserCellContentMode.Populated, projection.ContentMode);
        Assert.Equal("John Doe", projection.DisplayName);
    }

    [Fact]
    public void Display_name_falls_back_to_the_email_local_part()
    {
        var projection = UserCellProjection.Project(
            new UserCellProps(new UserCellUser(Id: "u1", Email: "jane.doe@example.com")), Localizer);

        // web: user.email?.split('@')[0].
        Assert.Equal("jane.doe", projection.DisplayName);
    }

    [Fact]
    public void Display_name_falls_back_to_the_id()
    {
        var projection = UserCellProjection.Project(
            new UserCellProps(new UserCellUser(Id: "forward-auth-subject-42")), Localizer);

        Assert.Equal("forward-auth-subject-42", projection.DisplayName);
    }

    [Fact]
    public void Display_name_falls_back_to_the_localized_unknown_label()
    {
        // An empty email local-part ("@host".split('@')[0] === "") is falsy, so with no name and no id the chain
        // reaches the unknown-user label.
        var projection = UserCellProjection.Project(
            new UserCellProps(new UserCellUser(Email: "@host")), Localizer);

        Assert.Equal(UserCellContentMode.Populated, projection.ContentMode);
        Assert.Equal("Unknown user", projection.DisplayName);
    }

    [Fact]
    public void Empty_email_local_part_falls_through_to_the_id()
    {
        var projection = UserCellProjection.Project(
            new UserCellProps(new UserCellUser(Id: "u-7", Email: "@host")), Localizer);

        Assert.Equal("u-7", projection.DisplayName);
    }

    // ── projection: optional email line (web showEmail && user.email) ─────────────────────────────────────

    [Fact]
    public void Email_line_shows_when_requested_and_present()
    {
        var projection = UserCellProjection.Project(
            new UserCellProps(new UserCellUser(Name: "John Doe", Email: "john@x.com"), ShowEmail: true), Localizer);

        Assert.True(projection.ShowEmailLine);
        Assert.Equal("john@x.com", projection.Email);
    }

    [Fact]
    public void Email_line_hidden_when_not_requested()
    {
        var projection = UserCellProjection.Project(
            new UserCellProps(new UserCellUser(Name: "John Doe", Email: "john@x.com"), ShowEmail: false), Localizer);

        Assert.False(projection.ShowEmailLine);
    }

    [Fact]
    public void Email_line_hidden_when_requested_but_absent()
    {
        var projection = UserCellProjection.Project(
            new UserCellProps(new UserCellUser(Name: "John Doe"), ShowEmail: true), Localizer);

        Assert.False(projection.ShowEmailLine);
        Assert.Equal(string.Empty, projection.Email);
    }

    // ── projection: the composed avatar props (web <Avatar userId name src size showTooltip />) ────────────

    [Fact]
    public void Avatar_props_mirror_the_web_avatar_invocation()
    {
        var projection = UserCellProjection.Project(
            new UserCellProps(
                new UserCellUser(Id: "u1", Name: "John Doe", Email: "j@x.com", AvatarUrl: "https://example.test/a.png"),
                Size: AvatarSize.Md),
            Localizer);

        AvatarProps avatar = projection.AvatarProps;
        Assert.Equal("u1", avatar.UserId);
        Assert.Equal("John Doe", avatar.Name);
        Assert.Equal("https://example.test/a.png", avatar.Src);
        Assert.Equal(AvatarSize.Md, avatar.Size);
        Assert.True(avatar.ShowTooltip);
    }

    [Theory]
    [InlineData(AvatarSize.Xs)]
    [InlineData(AvatarSize.Sm)]
    [InlineData(AvatarSize.Md)]
    [InlineData(AvatarSize.Lg)]
    public void Avatar_size_passes_through(AvatarSize size)
    {
        var projection = UserCellProjection.Project(
            new UserCellProps(new UserCellUser(Name: "John Doe"), Size: size), Localizer);

        Assert.Equal(size, projection.AvatarProps.Size);
    }

    [Fact]
    public void Avatar_is_named_by_the_resolved_display_name()
    {
        // web: name={displayName} — so the avatar initials derive from the resolved display name, not the raw name.
        var projection = UserCellProjection.Project(
            new UserCellProps(new UserCellUser(Id: "u1", Email: "jane@example.com")), Localizer);

        Assert.Equal("jane", projection.DisplayName);
        Assert.Equal("jane", projection.AvatarProps.Name);
        Assert.Equal("u1", projection.AvatarProps.UserId);
    }

    // ── projection / accessibility: the cell's single accessible name ─────────────────────────────────────

    [Fact]
    public void Accessible_name_is_the_display_name_without_an_email_line()
    {
        var projection = UserCellProjection.Project(
            new UserCellProps(new UserCellUser(Name: "Ada Lovelace", Email: "ada@x.com")), Localizer);

        Assert.Equal("Ada Lovelace", projection.AccessibleName);
    }

    [Fact]
    public void Accessible_name_appends_the_email_when_the_line_shows()
    {
        var projection = UserCellProjection.Project(
            new UserCellProps(new UserCellUser(Name: "Ada Lovelace", Email: "ada@x.com"), ShowEmail: true), Localizer);

        Assert.Equal("Ada Lovelace, ada@x.com", projection.AccessibleName);
    }

    [Fact]
    public void Accessible_name_is_the_em_dash_for_the_empty_cell()
    {
        var projection = UserCellProjection.Project(new UserCellProps(User: null), Localizer);

        Assert.Equal("\u2014", projection.AccessibleName);
    }

    [Fact]
    public void Unknown_label_resolves_through_the_localizer()
    {
        var localizer = new StubLocalizer(new Dictionary<string, string>
        {
            [UserCellRegistration.UnknownUserKey] = "Utilisateur inconnu",
        });

        var projection = UserCellProjection.Project(
            new UserCellProps(new UserCellUser(Name: "   ")), localizer);

        Assert.Equal("Utilisateur inconnu", projection.DisplayName);
    }

    [Fact]
    public void Project_throws_when_dependencies_are_null()
    {
        Assert.Throws<ArgumentNullException>(() => UserCellProjection.Project(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => UserCellProjection.Project(new UserCellProps(), null!));
    }

    // ── view-model (initial projection, language-change re-projection, no-op guard) ───────────────────────

    [Fact]
    public void ViewModel_projects_its_props_on_construction()
    {
        var props = new UserCellProps(new UserCellUser(Name: "John Doe", Email: "j@x.com"), ShowEmail: true);
        var viewModel = new UserCellViewModel(props, Localizer);

        Assert.Equal("UserCell", UserCellViewModel.Slug);
        Assert.Same(props, viewModel.Props);
        Assert.Equal(UserCellContentMode.Populated, viewModel.Projection.ContentMode);
        Assert.Equal("John Doe", viewModel.Projection.DisplayName);
        Assert.Equal("John Doe, j@x.com", viewModel.AccessibleName);
    }

    [Fact]
    public void ViewModel_reload_re_projects_after_a_language_change()
    {
        var localizer = new MutableLocalizer();
        // A whitespace-only name resolves the display name from the localized unknown label.
        var viewModel = new UserCellViewModel(new UserCellProps(new UserCellUser(Name: "   ")), localizer);
        Assert.Equal("Unknown user", viewModel.Projection.DisplayName);

        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        localizer.UnknownValue = "Utilisateur inconnu";
        viewModel.Reload();

        Assert.Equal("Utilisateur inconnu", viewModel.Projection.DisplayName);
        Assert.Contains(nameof(UserCellViewModel.Projection), changed);
    }

    [Fact]
    public void ViewModel_reload_does_not_raise_when_the_projection_is_unchanged()
    {
        var viewModel = new UserCellViewModel(new UserCellProps(new UserCellUser(Name: "John Doe")), Localizer);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        viewModel.Reload();

        Assert.Equal(0, changes);
        Assert.Equal("John Doe", viewModel.Projection.DisplayName);
    }

    [Fact]
    public void ViewModel_throws_when_dependencies_are_null()
    {
        Assert.Throws<ArgumentNullException>(() => new UserCellViewModel(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => new UserCellViewModel(new UserCellProps(), null!));
    }

    // ── diagnostics (view.opened, PII-safe — only the slug, never name / email / id) ──────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new UserCellDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=UserCell", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new UserCellDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_emit_only_the_operational_slug_line()
    {
        var lines = new List<string>();
        var diagnostics = new UserCellDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(lines);
        Assert.StartsWith("view.opened slug=", line, StringComparison.Ordinal);
        Assert.EndsWith(UserCellRegistration.Slug, line, StringComparison.Ordinal);
    }

    private sealed class StubLocalizer : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string> _map;

        public StubLocalizer(IReadOnlyDictionary<string, string> map) => _map = map;

        public string GetString(string key, string fallback) =>
            _map.TryGetValue(key, out var value) ? value : fallback;
    }

    private sealed class MutableLocalizer : ILocalizer
    {
        public string UnknownValue { get; set; } = UserCellRegistration.UnknownUserFallback;

        public string GetString(string key, string fallback) =>
            key == UserCellRegistration.UnknownUserKey ? UnknownValue : fallback;
    }
}
