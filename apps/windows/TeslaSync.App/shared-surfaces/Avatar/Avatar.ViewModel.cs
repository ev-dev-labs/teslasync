using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="Avatar"/> view — the native port of the web
/// component body (web/src/components/data-display/Avatar.tsx). The web component is stateless apart from the
/// resolved projection and the single <c>imageFailed</c> flag; this holder mirrors that exactly: it projects
/// the render decisions once through <see cref="AvatarProjection.Project"/> from the props, the i18n facade
/// and the image seam, and re-projects (raising <see cref="PropertyChanged"/>) when the
/// <see cref="IAvatarImageSource"/> reports the image failed to load, so the view drops the image and shows
/// the initials/glyph fallback — the web <c>onError =&gt; setImageFailed(true)</c> re-render. The view binds
/// the projected <see cref="Projection"/> and performs no I/O of its own. <see cref="Dispose"/> unsubscribes
/// from the image seam (the web effect cleanup). Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class AvatarViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly AvatarProps _props;
    private readonly ILocalizer _localizer;
    private readonly IAvatarImageSource _imageSource;
    private readonly IDisposable _imageSubscription;
    private AvatarProjection _projection;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over the avatar props, the i18n facade (P1/S10) and the image seam (P1/S8).
    /// </summary>
    /// <param name="props">The avatar render inputs (web props).</param>
    /// <param name="localizer">The i18n facade the unknown-user and presence labels resolve through.</param>
    /// <param name="imageSource">
    /// The image seam — its <see cref="IAvatarImageSource.HasImage"/> decides the image vs fallback branch and
    /// notifies on a load failure.
    /// </param>
    public AvatarViewModel(AvatarProps props, ILocalizer localizer, IAvatarImageSource imageSource)
    {
        ArgumentNullException.ThrowIfNull(props);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(imageSource);

        _props = props;
        _localizer = localizer;
        _imageSource = imageSource;
        _projection = AvatarProjection.Project(props, localizer, imageSource.HasImage);
        _imageSubscription = imageSource.Observe(OnImageChanged);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>Avatar</c>).</summary>
    public static string Slug => AvatarRegistration.Slug;

    /// <summary>The props this holder projects from.</summary>
    public AvatarProps Props => _props;

    /// <summary>The current render projection (content branch, colours, labels, metrics).</summary>
    public AvatarProjection Projection => _projection;

    /// <summary>The avatar's accessible name — the display name or the localized unknown-user label.</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>Stop listening to the image seam (the web effect cleanup); idempotent.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _imageSubscription.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnImageChanged()
    {
        AvatarProjection next = AvatarProjection.Project(_props, _localizer, _imageSource.HasImage);
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}
