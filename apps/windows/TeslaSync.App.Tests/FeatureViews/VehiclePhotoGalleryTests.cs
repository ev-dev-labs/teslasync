using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>VehiclePhotoGallery</c> feature surface's UI-thread-free logic — the empty /
/// populated branch selection (the web <c>photos.length === 0</c> guard), the verbatim photo src / alt passthrough,
/// the <c>HasImage</c> fallback flag, the interpolated "Open photo {n} of {total}" thumbnail labels, the named /
/// generic gallery label (with vehicle-name trimming), the localized empty-state copy and lightbox close label, the
/// composed surface Narrator name, the stable registration slug and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/vehicles/components/VehiclePhotoGallery.tsx). The component is display-only (no fetch lifecycle),
/// so the only states are empty and populated; the WinUI view itself (VehiclePhotoGallery.cs) — the TsEmptyState
/// empty card and the responsive thumbnail grid that opens the shared TsLightbox — is exercised by the app build.
/// </summary>
public sealed class VehiclePhotoGalleryTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static VehiclePhotoGalleryPhoto Photo(string src = "https://cdn.example.com/p.jpg", string alt = "A photo") =>
        new(src, alt);

    private static VehiclePhotoGalleryModel Model(
        IReadOnlyList<VehiclePhotoGalleryPhoto>? photos = null,
        string? vehicleName = null) =>
        new(photos ?? new[] { Photo() }, vehicleName);

    private static VehiclePhotoGalleryDisplay Project(VehiclePhotoGalleryModel model) =>
        VehiclePhotoGalleryProjection.Project(model, Localizer);

    // ── Branch selection: empty (no photos) vs populated (web `photos.length === 0`) ───────────────────────

    [Fact]
    public void Empty_when_there_are_no_photos() =>
        Assert.True(Project(Model(Array.Empty<VehiclePhotoGalleryPhoto>())).IsEmpty);

    [Fact]
    public void Empty_when_photos_collection_is_null() =>
        Assert.True(VehiclePhotoGalleryProjection.Project(new VehiclePhotoGalleryModel(null!), Localizer).IsEmpty);

    [Fact]
    public void Empty_model_factory_projects_to_empty() =>
        Assert.True(Project(VehiclePhotoGalleryModel.Empty).IsEmpty);

    [Fact]
    public void Populated_when_at_least_one_photo() =>
        Assert.False(Project(Model(new[] { Photo() })).IsEmpty);

    [Fact]
    public void Empty_projection_has_no_items() =>
        Assert.Empty(Project(Model(Array.Empty<VehiclePhotoGalleryPhoto>())).Items);

    [Fact]
    public void Item_count_matches_photo_count()
    {
        VehiclePhotoGalleryDisplay display = Project(Model(new[] { Photo(), Photo(), Photo() }));
        Assert.Equal(3, display.Items.Count);
    }

    // ── Thumbnails: verbatim src / alt passthrough + fallback flag ─────────────────────────────────────────

    [Fact]
    public void Item_src_and_alt_are_passed_through_verbatim()
    {
        VehiclePhotoGalleryDisplay display = Project(Model(new[] { Photo("https://x/y.png", "Front quarter") }));

        VehiclePhotoGalleryItem item = Assert.Single(display.Items);
        Assert.Equal("https://x/y.png", item.Src);
        Assert.Equal("Front quarter", item.Alt);
        Assert.Equal(0, item.Index);
    }

    [Fact]
    public void Item_indices_are_zero_based_and_in_order()
    {
        VehiclePhotoGalleryDisplay display = Project(Model(new[] { Photo(), Photo(), Photo() }));
        Assert.Equal(new[] { 0, 1, 2 }, display.Items.Select(i => i.Index).ToArray());
    }

    [Theory]
    [InlineData("https://cdn/p.jpg", true)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    public void Has_image_reflects_a_non_blank_source(string src, bool expected) =>
        Assert.Equal(expected, Assert.Single(Project(Model(new[] { Photo(src) })).Items).HasImage);

    [Fact]
    public void Null_src_and_alt_are_normalized_to_empty_strings()
    {
        VehiclePhotoGalleryDisplay display = Project(Model(new[] { new VehiclePhotoGalleryPhoto(null!, null!) }));

        VehiclePhotoGalleryItem item = Assert.Single(display.Items);
        Assert.Equal(string.Empty, item.Src);
        Assert.Equal(string.Empty, item.Alt);
        Assert.False(item.HasImage);
    }

    // ── Open-photo label: "Open photo {n} of {total}" (web vehicles.photos.openAt) ─────────────────────────

    [Fact]
    public void Open_label_interpolates_one_based_index_and_total()
    {
        VehiclePhotoGalleryDisplay display = Project(Model(new[] { Photo(), Photo(), Photo() }));

        Assert.Equal("Open photo 1 of 3", display.Items[0].OpenLabel);
        Assert.Equal("Open photo 2 of 3", display.Items[1].OpenLabel);
        Assert.Equal("Open photo 3 of 3", display.Items[2].OpenLabel);
    }

    [Fact]
    public void Open_label_resolves_through_the_i18n_facade_key()
    {
        VehiclePhotoGalleryDisplay display =
            VehiclePhotoGalleryProjection.Project(Model(new[] { Photo() }), new KeyEchoLocalizer());

        Assert.Equal("vehicles.photos.openAt", Assert.Single(display.Items).OpenLabel);
    }

    // ── Gallery label: named vs generic (web vehicles.photos.galleryNamed / gallery) ───────────────────────

    [Fact]
    public void Gallery_label_is_generic_without_a_vehicle_name() =>
        Assert.Equal("Photo gallery", Project(Model(vehicleName: null)).GalleryLabel);

    [Fact]
    public void Gallery_label_is_generic_for_a_blank_vehicle_name() =>
        Assert.Equal("Photo gallery", Project(Model(vehicleName: "   ")).GalleryLabel);

    [Fact]
    public void Gallery_label_is_named_when_a_vehicle_name_is_present() =>
        Assert.Equal("Model 3 Performance photo gallery", Project(Model(vehicleName: "Model 3 Performance")).GalleryLabel);

    [Fact]
    public void Gallery_label_trims_the_vehicle_name() =>
        Assert.Equal("Model Y photo gallery", Project(Model(vehicleName: "  Model Y  ")).GalleryLabel);

    [Fact]
    public void Gallery_label_uses_the_named_facade_key_when_named()
    {
        VehiclePhotoGalleryDisplay display =
            VehiclePhotoGalleryProjection.Project(Model(vehicleName: "Roadster"), new KeyEchoLocalizer());

        Assert.Equal("vehicles.photos.galleryNamed", display.GalleryLabel);
    }

    [Fact]
    public void Gallery_label_uses_the_generic_facade_key_when_unnamed()
    {
        VehiclePhotoGalleryDisplay display =
            VehiclePhotoGalleryProjection.Project(Model(vehicleName: null), new KeyEchoLocalizer());

        Assert.Equal("vehicles.photos.gallery", display.GalleryLabel);
    }

    // ── Empty-state copy + lightbox close label: resolved through the facade, never hardcoded inline ───────

    [Fact]
    public void Empty_copy_uses_the_english_fallbacks_through_the_passthrough_localizer()
    {
        VehiclePhotoGalleryDisplay display = Project(Model(Array.Empty<VehiclePhotoGalleryPhoto>()));

        Assert.Equal("No photos uploaded yet.", display.EmptyTitle);
        Assert.Equal("Photos uploaded for this vehicle will appear here.", display.EmptyHelp);
    }

    [Fact]
    public void Empty_copy_resolves_through_the_i18n_facade_keys()
    {
        VehiclePhotoGalleryDisplay display =
            VehiclePhotoGalleryProjection.Project(Model(Array.Empty<VehiclePhotoGalleryPhoto>()), new KeyEchoLocalizer());

        Assert.Equal("vehicles.photos.empty", display.EmptyTitle);
        Assert.Equal("vehicles.photos.emptyHelp", display.EmptyHelp);
    }

    [Fact]
    public void Close_label_uses_the_shared_lightbox_facade_key()
    {
        VehiclePhotoGalleryDisplay display =
            VehiclePhotoGalleryProjection.Project(Model(new[] { Photo() }), new KeyEchoLocalizer());

        Assert.Equal("lightbox.close", display.CloseLabel);
    }

    [Fact]
    public void Close_label_uses_the_english_fallback_through_the_passthrough_localizer() =>
        Assert.Equal("Close image viewer", Project(Model(new[] { Photo() })).CloseLabel);

    // ── Accessibility: the surface always exposes a meaningful Narrator name ───────────────────────────────

    [Fact]
    public void Automation_name_is_the_empty_title_when_empty() =>
        Assert.Equal("No photos uploaded yet.", Project(Model(Array.Empty<VehiclePhotoGalleryPhoto>())).AutomationName);

    [Fact]
    public void Automation_name_is_the_gallery_label_when_populated() =>
        Assert.Equal("Cybertruck photo gallery", Project(Model(new[] { Photo() }, "Cybertruck")).AutomationName);

    [Fact]
    public void Every_projection_exposes_a_non_empty_automation_name_and_thumbnail_labels()
    {
        VehiclePhotoGalleryDisplay[] displays =
        {
            Project(Model(Array.Empty<VehiclePhotoGalleryPhoto>())),
            Project(Model(new[] { Photo() })),
            Project(Model(new[] { Photo(), Photo() }, "Model S")),
        };

        Assert.All(displays, display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
        Assert.All(
            displays.SelectMany(d => d.Items),
            item => Assert.False(string.IsNullOrWhiteSpace(item.OpenLabel)));
    }

    // ── i18n key contract: keys match the web source verbatim ──────────────────────────────────────────────

    [Fact]
    public void I18n_keys_match_the_web_source()
    {
        Assert.Equal("vehicles.photos.empty", VehiclePhotoGalleryProjection.EmptyKey);
        Assert.Equal("vehicles.photos.emptyHelp", VehiclePhotoGalleryProjection.EmptyHelpKey);
        Assert.Equal("vehicles.photos.gallery", VehiclePhotoGalleryProjection.GalleryKey);
        Assert.Equal("vehicles.photos.galleryNamed", VehiclePhotoGalleryProjection.GalleryNamedKey);
        Assert.Equal("vehicles.photos.openAt", VehiclePhotoGalleryProjection.OpenAtKey);
        Assert.Equal("lightbox.close", VehiclePhotoGalleryProjection.CloseKey);
    }

    // ── Diagnostics (P1/S11): view.opened slug=VehiclePhotoGallery, PII-safe ───────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new VehiclePhotoGalleryDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=VehiclePhotoGallery", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_photo_or_vehicle_data()
    {
        var captured = new List<string>();
        var diagnostics = new VehiclePhotoGalleryDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        string line = Assert.Single(captured);
        Assert.Equal("view.opened slug=VehiclePhotoGallery", line);
        Assert.DoesNotContain("cdn.example.com", line, StringComparison.Ordinal);
        Assert.DoesNotContain("photo", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("VehiclePhotoGallery", VehiclePhotoGalleryRegistration.Slug);

    // ── Argument validation ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => VehiclePhotoGalleryProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => VehiclePhotoGalleryProjection.Project(Model(), null!));

    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key;
    }
}
