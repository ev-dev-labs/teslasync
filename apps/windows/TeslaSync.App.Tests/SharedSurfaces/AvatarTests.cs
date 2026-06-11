using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the Avatar surface's UI-thread-free logic — the registration slug + automation
/// ids + i18n keys (<see cref="AvatarRegistration"/>), the pixel metrics (<see cref="AvatarMetrics"/>), the
/// pure <see cref="AvatarProjection"/> adapter (content branch, deterministic colour/initials via the shared
/// <see cref="AvatarLogic"/>, attributed-vs-anonymous background, accessible name / tooltip and the localized
/// presence label + token), the image seams (<see cref="StaticAvatarImageSource"/> /
/// <see cref="MutableAvatarImageSource"/>), the <see cref="AvatarViewModel"/> state holder (initial projection,
/// image-failure re-project, subscription cleanup) and the PII-safe diagnostics. Mirrors the web spec
/// one-for-one (web/src/components/data-display/Avatar.tsx). The WinUI view (shared-surfaces/Avatar.cs, which
/// composes a Border + Image/TextBlock/glyph + presence Ellipse) is exercised by the app build.
/// </summary>
public sealed class AvatarTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── registration ─────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("Avatar", AvatarRegistration.Slug);

    [Fact]
    public void Automation_ids_match_the_web_test_ids()
    {
        Assert.Equal("avatar", AvatarRegistration.RootAutomationId);
        Assert.Equal("avatar-image", AvatarRegistration.ImageAutomationId);
        Assert.Equal("avatar-initials", AvatarRegistration.InitialsAutomationId);
        Assert.Equal("avatar-glyph", AvatarRegistration.GlyphAutomationId);
        Assert.Equal("avatar-status", AvatarRegistration.StatusAutomationId);
    }

    [Fact]
    public void I18n_keys_and_fallbacks_match_the_web_source()
    {
        // web: t('avatar.unknown', 'Unknown user') and the three status labels — translation-namespaced keys,
        // verbatim English fallbacks. These keys exist in Strings/{en,he,ar}/Resources.resw.
        Assert.Equal("translation.avatar.unknown", AvatarRegistration.UnknownKey);
        Assert.Equal("Unknown user", AvatarRegistration.UnknownFallback);
        Assert.Equal("translation.avatar.statusOnline", AvatarRegistration.StatusOnlineKey);
        Assert.Equal("Online", AvatarRegistration.StatusOnlineFallback);
        Assert.Equal("translation.avatar.statusIdle", AvatarRegistration.StatusIdleKey);
        Assert.Equal("Idle", AvatarRegistration.StatusIdleFallback);
        Assert.Equal("translation.avatar.statusOffline", AvatarRegistration.StatusOfflineKey);
        Assert.Equal("Offline", AvatarRegistration.StatusOfflineFallback);
    }

    // ── metrics (web SIZE_PX, text sizes, dot sizes, glyph = round(sizePx * 0.6), rounded-lg corner) ──────

    [Theory]
    [InlineData(AvatarSize.Xs, 16, 8, 6, 10)]
    [InlineData(AvatarSize.Sm, 24, 10, 8, 14)]
    [InlineData(AvatarSize.Md, 32, 12, 10, 19)]
    [InlineData(AvatarSize.Lg, 48, 14, 12, 29)]
    public void Metrics_match_the_web_sizes(AvatarSize size, double sizePx, double fontPx, double dotPx, double glyphPx)
    {
        Assert.Equal(sizePx, AvatarMetrics.SizePx(size));
        Assert.Equal(fontPx, AvatarMetrics.FontPx(size));
        Assert.Equal(dotPx, AvatarMetrics.DotPx(size));
        Assert.Equal(glyphPx, AvatarMetrics.GlyphPx(size));
    }

    [Fact]
    public void Circle_corner_radius_is_half_the_diameter()
    {
        Assert.Equal(12, AvatarMetrics.CornerRadiusPx(AvatarSize.Sm, AvatarShape.Circle));
        Assert.Equal(24, AvatarMetrics.CornerRadiusPx(AvatarSize.Lg, AvatarShape.Circle));
    }

    [Fact]
    public void Rounded_corner_radius_is_the_tailwind_rounded_lg_token()
    {
        // web rounded-lg = 0.5rem = 8px, regardless of size.
        Assert.Equal(8, AvatarMetrics.CornerRadiusPx(AvatarSize.Sm, AvatarShape.Rounded));
        Assert.Equal(8, AvatarMetrics.CornerRadiusPx(AvatarSize.Lg, AvatarShape.Rounded));
    }

    // ── projection: content branch (image → initials → glyph) ─────────────────────────────────────────────

    [Fact]
    public void Image_present_renders_the_image_branch()
    {
        var props = new AvatarProps(Name: "John Doe", Src: "https://example.test/a.png");
        var projection = AvatarProjection.Project(props, Localizer, hasImage: true);

        Assert.Equal(AvatarContentMode.Image, projection.ContentMode);
        Assert.Equal(AvatarBackgroundKind.Image, projection.BackgroundKind);
        Assert.Equal("https://example.test/a.png", projection.ImageSource);
    }

    [Fact]
    public void Image_takes_priority_over_name_initials()
    {
        var props = new AvatarProps(Name: "John Doe", Src: "https://example.test/a.png");
        var projection = AvatarProjection.Project(props, Localizer, hasImage: true);

        // web priority order: src image wins even when a name would yield initials.
        Assert.Equal(AvatarContentMode.Image, projection.ContentMode);
    }

    [Fact]
    public void Image_failure_falls_back_to_initials()
    {
        var props = new AvatarProps(Name: "John Doe", Src: "https://example.test/a.png");

        // web onError flips imageFailed → showImage false → the initials fallback.
        var projection = AvatarProjection.Project(props, Localizer, hasImage: false);

        Assert.Equal(AvatarContentMode.Initials, projection.ContentMode);
        Assert.Equal("JD", projection.Initials);
    }

    [Fact]
    public void Name_only_renders_initials_on_the_hashed_colour()
    {
        var props = new AvatarProps(Name: "Cher");
        var projection = AvatarProjection.Project(props, Localizer, hasImage: false);

        Assert.Equal(AvatarContentMode.Initials, projection.ContentMode);
        Assert.Equal("CH", projection.Initials);
        Assert.True(projection.IsAttributed);
        Assert.Equal(AvatarBackgroundKind.Color, projection.BackgroundKind);
        Assert.Equal(AvatarLogic.ColorFor("Cher"), projection.SeedColorHex);
    }

    [Fact]
    public void UserId_without_name_renders_the_person_glyph_on_a_colour()
    {
        var props = new AvatarProps(UserId: "user-42");
        var projection = AvatarProjection.Project(props, Localizer, hasImage: false);

        // No name → no initials → glyph; userId makes it attributed → coloured background.
        Assert.Equal(AvatarContentMode.Glyph, projection.ContentMode);
        Assert.Equal(AvatarGlyphKind.Person, projection.GlyphKind);
        Assert.True(projection.IsAttributed);
        Assert.Equal(AvatarBackgroundKind.Color, projection.BackgroundKind);
        Assert.Equal("?", projection.Initials);
        Assert.Equal(AvatarLogic.ColorFor("user-42"), projection.SeedColorHex);
    }

    [Fact]
    public void Anonymous_user_renders_the_person_glyph_on_a_neutral_surface()
    {
        var props = new AvatarProps();
        var projection = AvatarProjection.Project(props, Localizer, hasImage: false);

        Assert.Equal(AvatarContentMode.Glyph, projection.ContentMode);
        Assert.Equal(AvatarGlyphKind.Person, projection.GlyphKind);
        Assert.False(projection.IsAttributed);
        Assert.Equal(AvatarBackgroundKind.Neutral, projection.BackgroundKind);
    }

    [Fact]
    public void Anonymous_bot_renders_the_helix_glyph_on_a_neutral_surface()
    {
        var props = new AvatarProps(Kind: AvatarKind.Bot);
        var projection = AvatarProjection.Project(props, Localizer, hasImage: false);

        Assert.Equal(AvatarContentMode.Glyph, projection.ContentMode);
        Assert.Equal(AvatarGlyphKind.Helix, projection.GlyphKind);
        Assert.Equal(AvatarBackgroundKind.Neutral, projection.BackgroundKind);
    }

    // ── projection: seed precedence, attribution, accessible name ─────────────────────────────────────────

    [Fact]
    public void Seed_prefers_user_id_over_name_for_the_colour()
    {
        var withId = AvatarProjection.Project(new AvatarProps(UserId: "u1", Name: "John Doe"), Localizer, hasImage: false);
        var nameOnly = AvatarProjection.Project(new AvatarProps(Name: "John Doe"), Localizer, hasImage: false);

        // web: seed = userId when present, else trimmed name.
        Assert.Equal(AvatarLogic.ColorFor("u1"), withId.SeedColorHex);
        Assert.Equal(AvatarLogic.ColorFor("John Doe"), nameOnly.SeedColorHex);
    }

    [Fact]
    public void Accessible_name_is_the_display_name_when_known()
    {
        var projection = AvatarProjection.Project(new AvatarProps(Name: "  John Doe  "), Localizer, hasImage: false);

        // web tooltipLabel: trimmed name when present.
        Assert.Equal("John Doe", projection.AccessibleName);
        Assert.Equal("John Doe", projection.TooltipLabel);
    }

    [Fact]
    public void Accessible_name_falls_back_to_the_localized_unknown_label()
    {
        var projection = AvatarProjection.Project(new AvatarProps(UserId: "u1"), Localizer, hasImage: false);

        // web tooltipLabel: t('avatar.unknown', 'Unknown user') when there is no name.
        Assert.Equal("Unknown user", projection.AccessibleName);
    }

    [Fact]
    public void Unknown_label_resolves_through_the_localizer()
    {
        var localizer = new StubLocalizer(new Dictionary<string, string>
        {
            [AvatarRegistration.UnknownKey] = "Utilisateur inconnu",
        });

        var projection = AvatarProjection.Project(new AvatarProps(), localizer, hasImage: false);

        Assert.Equal("Utilisateur inconnu", projection.AccessibleName);
    }

    [Fact]
    public void Show_tooltip_flag_passes_through()
    {
        Assert.True(AvatarProjection.Project(new AvatarProps(ShowTooltip: true), Localizer, hasImage: false).ShowTooltip);
        Assert.False(AvatarProjection.Project(new AvatarProps(ShowTooltip: false), Localizer, hasImage: false).ShowTooltip);
    }

    // ── projection: presence dot ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public void No_status_renders_no_dot()
    {
        var projection = AvatarProjection.Project(new AvatarProps(), Localizer, hasImage: false);

        Assert.False(projection.HasStatus);
        Assert.Null(projection.Status);
        Assert.Equal(string.Empty, projection.StatusLabel);
        Assert.Equal(string.Empty, projection.StatusBrushKey);
    }

    [Theory]
    [InlineData(AvatarStatus.Online, "Online", "TsColorSuccessBrush")]
    [InlineData(AvatarStatus.Idle, "Idle", "TsColorWarningBrush")]
    [InlineData(AvatarStatus.Offline, "Offline", "TsColorTextMutedBrush")]
    public void Status_projects_label_and_semantic_token(AvatarStatus status, string label, string brushKey)
    {
        var projection = AvatarProjection.Project(new AvatarProps(Status: status), Localizer, hasImage: false);

        Assert.True(projection.HasStatus);
        Assert.Equal(status, projection.Status);
        Assert.Equal(label, projection.StatusLabel);
        Assert.Equal(brushKey, projection.StatusBrushKey);
    }

    [Fact]
    public void Status_brush_key_map_matches_the_web_status_classes()
    {
        // web STATUS_CLASSES: online → emerald, idle → amber, offline → grey → success / warning / muted tokens.
        Assert.Equal("TsColorSuccessBrush", AvatarProjection.StatusBrushKeyFor(AvatarStatus.Online));
        Assert.Equal("TsColorWarningBrush", AvatarProjection.StatusBrushKeyFor(AvatarStatus.Idle));
        Assert.Equal("TsColorTextMutedBrush", AvatarProjection.StatusBrushKeyFor(AvatarStatus.Offline));
    }

    [Fact]
    public void Status_label_routes_through_the_localizer()
    {
        var localizer = new StubLocalizer(new Dictionary<string, string>
        {
            [AvatarRegistration.StatusOnlineKey] = "En ligne",
        });

        Assert.Equal("En ligne", AvatarProjection.StatusLabelFor(AvatarStatus.Online, localizer));
        // Unmapped keys fall back to the verbatim English value.
        Assert.Equal("Idle", AvatarProjection.StatusLabelFor(AvatarStatus.Idle, localizer));
    }

    // ── projection: metrics carried + value equality (per-state snapshot) ─────────────────────────────────

    [Fact]
    public void Projection_carries_the_metrics_for_its_size_and_shape()
    {
        var projection = AvatarProjection.Project(
            new AvatarProps(Name: "John Doe", Size: AvatarSize.Lg, Shape: AvatarShape.Rounded),
            Localizer,
            hasImage: false);

        Assert.Equal(AvatarSize.Lg, projection.Size);
        Assert.Equal(AvatarShape.Rounded, projection.Shape);
        Assert.Equal(48, projection.SizePx);
        Assert.Equal(8, projection.CornerRadiusPx);
        Assert.Equal(14, projection.FontPx);
        Assert.Equal(29, projection.GlyphPx);
        Assert.Equal(12, projection.DotPx);
    }

    [Fact]
    public void Projection_value_equality_makes_identical_states_equal()
    {
        var a = AvatarProjection.Project(new AvatarProps(Name: "John Doe", Status: AvatarStatus.Online), Localizer, hasImage: false);
        var b = AvatarProjection.Project(new AvatarProps(Name: "John Doe", Status: AvatarStatus.Online), Localizer, hasImage: false);
        var different = AvatarProjection.Project(new AvatarProps(Name: "John Doe", Status: AvatarStatus.Offline), Localizer, hasImage: false);

        Assert.Equal(a, b);
        Assert.NotEqual(a, different);
    }

    [Fact]
    public void Project_throws_when_dependencies_are_null()
    {
        Assert.Throws<ArgumentNullException>(() => AvatarProjection.Project(null!, Localizer, hasImage: false));
        Assert.Throws<ArgumentNullException>(() => AvatarProjection.Project(new AvatarProps(), null!, hasImage: false));
    }

    // ── image seams ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Static_image_source_reports_its_fixed_state()
    {
        Assert.True(StaticAvatarImageSource.Present.HasImage);
        Assert.False(StaticAvatarImageSource.None.HasImage);
    }

    [Fact]
    public void Mutable_image_source_marks_failed_once_and_notifies()
    {
        var source = new MutableAvatarImageSource(hasImage: true);
        var notifications = 0;
        using (source.Observe(() => notifications++))
        {
            Assert.True(source.HasImage);

            source.MarkFailed();
            Assert.False(source.HasImage);
            Assert.Equal(1, notifications);

            // A second failure is a no-op (web onError fires once per load).
            source.MarkFailed();
            Assert.Equal(1, notifications);
        }
    }

    [Fact]
    public void Mutable_image_source_dispose_removes_the_observer()
    {
        var source = new MutableAvatarImageSource(hasImage: true);
        IDisposable subscription = source.Observe(() => { });
        Assert.Equal(1, source.ObserverCount);

        subscription.Dispose();
        Assert.Equal(0, source.ObserverCount);
    }

    // ── view-model (state holder) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_exposes_the_slug() =>
        Assert.Equal("Avatar", AvatarViewModel.Slug);

    [Fact]
    public void ViewModel_starts_with_the_projection_from_the_props_and_image_seam()
    {
        var props = new AvatarProps(Name: "John Doe", Src: "https://example.test/a.png");
        using var viewModel = new AvatarViewModel(props, Localizer, StaticAvatarImageSource.Present);

        Assert.Equal(AvatarContentMode.Image, viewModel.Projection.ContentMode);
        Assert.Equal("John Doe", viewModel.AccessibleName);
        Assert.Same(props, viewModel.Props);
    }

    [Fact]
    public void ViewModel_re_projects_to_the_fallback_when_the_image_fails()
    {
        var props = new AvatarProps(Name: "John Doe", Src: "https://example.test/a.png");
        var source = new MutableAvatarImageSource(hasImage: true);
        using var viewModel = new AvatarViewModel(props, Localizer, source);
        Assert.Equal(AvatarContentMode.Image, viewModel.Projection.ContentMode);

        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        source.MarkFailed();

        // web onError: the avatar drops the image and shows the initials fallback.
        Assert.Equal(AvatarContentMode.Initials, viewModel.Projection.ContentMode);
        Assert.Equal("JD", viewModel.Projection.Initials);
        Assert.Contains(nameof(AvatarViewModel.Projection), changed);
    }

    [Fact]
    public void ViewModel_does_not_raise_when_the_projection_is_unchanged()
    {
        // No image to begin with → MarkFailed cannot change anything.
        var props = new AvatarProps(Name: "John Doe");
        var source = new MutableAvatarImageSource(hasImage: false);
        using var viewModel = new AvatarViewModel(props, Localizer, source);
        var changes = 0;
        viewModel.PropertyChanged += (_, _) => changes++;

        source.MarkFailed();

        Assert.Equal(0, changes);
        Assert.Equal(AvatarContentMode.Initials, viewModel.Projection.ContentMode);
    }

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_the_image_seam()
    {
        var props = new AvatarProps(Name: "John Doe", Src: "https://example.test/a.png");
        var source = new MutableAvatarImageSource(hasImage: true);
        var viewModel = new AvatarViewModel(props, Localizer, source);
        Assert.Equal(1, source.ObserverCount);

        viewModel.Dispose();

        Assert.Equal(0, source.ObserverCount);

        // After dispose a late failure must not move the projection.
        source.MarkFailed();
        Assert.Equal(AvatarContentMode.Image, viewModel.Projection.ContentMode);
    }

    [Fact]
    public void ViewModel_throws_when_dependencies_are_null()
    {
        Assert.Throws<ArgumentNullException>(
            () => new AvatarViewModel(null!, Localizer, StaticAvatarImageSource.None));
        Assert.Throws<ArgumentNullException>(
            () => new AvatarViewModel(new AvatarProps(), null!, StaticAvatarImageSource.None));
        Assert.Throws<ArgumentNullException>(
            () => new AvatarViewModel(new AvatarProps(), Localizer, null!));
    }

    // ── accessibility: the resolved name is the surface's accessible identity ─────────────────────────────

    [Fact]
    public void Accessible_name_is_the_view_models_projected_name()
    {
        // The view sets AutomationProperties.Name to ViewModel.AccessibleName and gives the presence dot its
        // own localized name (see Avatar.cs), so the projected values ARE the accessible names Narrator reads.
        using var named = new AvatarViewModel(
            new AvatarProps(Name: "Ada Lovelace"), Localizer, StaticAvatarImageSource.None);
        Assert.Equal("Ada Lovelace", named.AccessibleName);

        using var anonymous = new AvatarViewModel(
            new AvatarProps(), Localizer, StaticAvatarImageSource.None);
        Assert.Equal("Unknown user", anonymous.AccessibleName);
    }

    [Fact]
    public void Status_dot_has_a_localized_accessible_label()
    {
        var projection = AvatarProjection.Project(new AvatarProps(Status: AvatarStatus.Idle), Localizer, hasImage: false);

        // The view sets AutomationProperties.Name on the presence badge to this label.
        Assert.Equal("Idle", projection.StatusLabel);
    }

    // ── diagnostics (view.opened, PII-safe — only the slug, never name / id / image) ──────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AvatarDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=Avatar", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new AvatarDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_emit_only_the_operational_slug_line()
    {
        var lines = new List<string>();
        var diagnostics = new AvatarDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(lines);
        Assert.StartsWith("view.opened slug=", line, StringComparison.Ordinal);
        Assert.EndsWith(AvatarRegistration.Slug, line, StringComparison.Ordinal);
    }

    private sealed class StubLocalizer : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string> _map;

        public StubLocalizer(IReadOnlyDictionary<string, string> map) => _map = map;

        public string GetString(string key, string fallback) =>
            _map.TryGetValue(key, out var value) ? value : fallback;
    }
}
