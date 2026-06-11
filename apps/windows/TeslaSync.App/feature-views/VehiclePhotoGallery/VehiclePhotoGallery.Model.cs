using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// One vehicle photo the gallery renders — the native analogue of a web <c>LightboxImage</c>
/// (web/src/components/ui/Lightbox.tsx: <c>{ src, alt }</c>). Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Src">The image source URL (web <c>LightboxImage.src</c>).</param>
/// <param name="Alt">The accessible alternative text (web <c>LightboxImage.alt</c>; empty string allowed).</param>
public sealed record VehiclePhotoGalleryPhoto(string Src, string Alt);

/// <summary>
/// The render-time data model the <c>VehiclePhotoGallery</c> view binds to — the native analogue of the web
/// <c>VehiclePhotoGalleryProps</c> (web/src/features/vehicles/components/VehiclePhotoGallery.tsx). The web source is a
/// display-only "thin wrapper" around the shared lightbox: it takes an already-resolved <c>photos</c> array plus an
/// optional <c>vehicleName</c> (used only to compose accessible labels) and performs no fetching, so — like the web
/// component — there is no loading / error / stale / offline branch to model; the only states are <em>empty</em>
/// (no photos) and <em>populated</em> (a grid of thumbnails that open the lightbox). The web <c>className</c> prop is
/// a styling pass-through with no data meaning and so is not part of this model. Pure data — no WinUI types — so the
/// projection is asserted headlessly.
/// </summary>
/// <param name="Photos">The vehicle photos to render (web <c>photos</c>, default empty).</param>
/// <param name="VehicleName">Optional vehicle display name used to compose the gallery's accessible label
/// (web <c>vehicleName</c>), or null.</param>
public sealed record VehiclePhotoGalleryModel(
    IReadOnlyList<VehiclePhotoGalleryPhoto> Photos,
    string? VehicleName = null)
{
    /// <summary>The empty model — no photos (the gallery shows its friendly empty state, never a blank box).</summary>
    public static VehiclePhotoGalleryModel Empty { get; } = new(Array.Empty<VehiclePhotoGalleryPhoto>());
}

/// <summary>
/// The fully projected, render-ready view of one thumbnail in the populated gallery grid — the native analogue of a
/// web <c>&lt;li&gt;&lt;button&gt;&lt;img/&gt;&lt;/button&gt;&lt;/li&gt;</c> cell. Holds the zero-based
/// <see cref="Index"/>, the verbatim <see cref="Src"/> + <see cref="Alt"/> (with <see cref="HasImage"/> so an absent
/// source renders a fallback tile rather than a broken image), and the composed
/// "Open photo {n} of {total}" Narrator label. Pure data so every field is asserted headlessly.
/// </summary>
/// <param name="Index">The zero-based position of the photo in the gallery.</param>
/// <param name="Src">The image source URL, rendered verbatim (web <c>photo.src</c>).</param>
/// <param name="Alt">The image alternative text, rendered verbatim (web <c>photo.alt</c>).</param>
/// <param name="HasImage">Whether a non-empty source is present (false renders a fallback tile).</param>
/// <param name="OpenLabel">The composed Narrator label for the thumbnail button (web <c>vehicles.photos.openAt</c>).</param>
public sealed record VehiclePhotoGalleryItem(
    int Index,
    string Src,
    string Alt,
    bool HasImage,
    string OpenLabel);

/// <summary>
/// The fully projected, render-ready view of one <see cref="VehiclePhotoGalleryModel"/> — everything the web
/// component resolves before returning JSX. Carries the <see cref="IsEmpty"/> branch selector, the empty-state copy
/// (<see cref="EmptyTitle"/> + <see cref="EmptyHelp"/>), the gallery's accessible <see cref="GalleryLabel"/>, the
/// per-thumbnail <see cref="Items"/>, the shared lightbox's <see cref="CloseLabel"/>, and the surface
/// <see cref="AutomationName"/>. Pure data so every field is asserted without a UI host.
/// </summary>
/// <param name="IsEmpty">True when there are no photos (render the empty state).</param>
/// <param name="EmptyTitle">The empty-state heading (web <c>vehicles.photos.empty</c>).</param>
/// <param name="EmptyHelp">The empty-state helper line (web <c>vehicles.photos.emptyHelp</c>).</param>
/// <param name="GalleryLabel">The gallery list's accessible name (web <c>vehicles.photos.gallery[Named]</c>).</param>
/// <param name="Items">The projected thumbnails, in order (empty when <see cref="IsEmpty"/>).</param>
/// <param name="CloseLabel">The shared lightbox close affordance label (web <c>lightbox.close</c>).</param>
/// <param name="AutomationName">The surface Narrator name (the empty title when empty, else the gallery label).</param>
public sealed record VehiclePhotoGalleryDisplay(
    bool IsEmpty,
    string EmptyTitle,
    string EmptyHelp,
    string GalleryLabel,
    IReadOnlyList<VehiclePhotoGalleryItem> Items,
    string CloseLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="VehiclePhotoGalleryModel"/> to its <see cref="VehiclePhotoGalleryDisplay"/> — the
/// native port of web/src/features/vehicles/components/VehiclePhotoGallery.tsx. Reproduces both of the web source's
/// conditional render branches: an <em>empty</em> state (icon + "No photos uploaded yet." + helper line) when
/// <c>photos.length === 0</c>, and a <em>populated</em> grid of thumbnails otherwise. Every label resolves through the
/// i18n facade — the gallery name uses the named copy ("{name} photo gallery") when a vehicle name is present and the
/// generic copy ("Photo gallery") otherwise, and each thumbnail carries the interpolated "Open photo {n} of {total}"
/// label (the web <c>t('vehicles.photos.openAt', …, { index: i + 1, total })</c>). No WinUI types — unit-tested
/// without a UI host.
/// </summary>
public static class VehiclePhotoGalleryProjection
{
    /// <summary>i18n key for the empty-state heading (web <c>t('vehicles.photos.empty', …)</c>).</summary>
    public const string EmptyKey = "vehicles.photos.empty";

    /// <summary>English fallback for <see cref="EmptyKey"/>.</summary>
    public const string EmptyFallback = "No photos uploaded yet.";

    /// <summary>i18n key for the empty-state helper line (web <c>t('vehicles.photos.emptyHelp', …)</c>).</summary>
    public const string EmptyHelpKey = "vehicles.photos.emptyHelp";

    /// <summary>English fallback for <see cref="EmptyHelpKey"/>.</summary>
    public const string EmptyHelpFallback = "Photos uploaded for this vehicle will appear here.";

    /// <summary>i18n key for the generic gallery label (web <c>t('vehicles.photos.gallery', …)</c>).</summary>
    public const string GalleryKey = "vehicles.photos.gallery";

    /// <summary>English fallback for <see cref="GalleryKey"/>.</summary>
    public const string GalleryFallback = "Photo gallery";

    /// <summary>i18n key for the named gallery label (web <c>t('vehicles.photos.galleryNamed', …)</c>).</summary>
    public const string GalleryNamedKey = "vehicles.photos.galleryNamed";

    /// <summary>English fallback for <see cref="GalleryNamedKey"/> ("{0}" is the vehicle name).</summary>
    public const string GalleryNamedFallback = "{0} photo gallery";

    /// <summary>i18n key for a thumbnail's open label (web <c>t('vehicles.photos.openAt', …)</c>).</summary>
    public const string OpenAtKey = "vehicles.photos.openAt";

    /// <summary>English fallback for <see cref="OpenAtKey"/> ("{0}" is the 1-based index, "{1}" the total).</summary>
    public const string OpenAtFallback = "Open photo {0} of {1}";

    /// <summary>i18n key for the shared lightbox close affordance (web <c>t('lightbox.close', …)</c>).</summary>
    public const string CloseKey = "lightbox.close";

    /// <summary>English fallback for <see cref="CloseKey"/>.</summary>
    public const string CloseFallback = "Close image viewer";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props minus the styling pass-through).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static VehiclePhotoGalleryDisplay Project(VehiclePhotoGalleryModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        IReadOnlyList<VehiclePhotoGalleryPhoto> photos = model.Photos ?? Array.Empty<VehiclePhotoGalleryPhoto>();
        bool isEmpty = photos.Count == 0;

        string emptyTitle = localizer.GetString(EmptyKey, EmptyFallback);
        string emptyHelp = localizer.GetString(EmptyHelpKey, EmptyHelpFallback);
        string galleryLabel = BuildGalleryLabel(model.VehicleName, localizer);
        string closeLabel = localizer.GetString(CloseKey, CloseFallback);

        var items = new List<VehiclePhotoGalleryItem>(photos.Count);
        for (int i = 0; i < photos.Count; i++)
        {
            VehiclePhotoGalleryPhoto photo = photos[i];
            string src = photo?.Src ?? string.Empty;
            string alt = photo?.Alt ?? string.Empty;
            string openLabel = string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(OpenAtKey, OpenAtFallback),
                i + 1,
                photos.Count);

            items.Add(new VehiclePhotoGalleryItem(
                Index: i,
                Src: src,
                Alt: alt,
                HasImage: !string.IsNullOrWhiteSpace(src),
                OpenLabel: openLabel));
        }

        return new VehiclePhotoGalleryDisplay(
            IsEmpty: isEmpty,
            EmptyTitle: emptyTitle,
            EmptyHelp: emptyHelp,
            GalleryLabel: galleryLabel,
            Items: items,
            CloseLabel: closeLabel,
            AutomationName: isEmpty ? emptyTitle : galleryLabel);
    }

    private static string BuildGalleryLabel(string? vehicleName, ILocalizer localizer)
    {
        // Web parity: a present vehicle name composes the named label ("{name} photo gallery"); otherwise the
        // generic "Photo gallery" label is used. The name is trimmed so stray whitespace never leaks into Narrator.
        if (string.IsNullOrWhiteSpace(vehicleName))
        {
            return localizer.GetString(GalleryKey, GalleryFallback);
        }

        return string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString(GalleryNamedKey, GalleryNamedFallback),
            vehicleName.Trim());
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>VehiclePhotoGallery</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a photo URL, alt text or vehicle name — so a
/// diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class VehiclePhotoGalleryDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public VehiclePhotoGalleryDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VehiclePhotoGallery</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={VehiclePhotoGalleryRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>VehiclePhotoGallery</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/vehicles/components/VehiclePhotoGallery.tsx</c>. Holds the diagnostics slug emitted with the
/// <c>view.opened</c> event. UI-free so the metadata is asserted in tests.
/// </summary>
public static class VehiclePhotoGalleryRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "VehiclePhotoGallery";
}
