using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="UserCell"/> view — the native port of the web
/// component body (web/src/components/data-display/UserCell.tsx). The web component is stateless: it derives
/// the display name and the render branch synchronously from its props and <c>useTranslation</c>, with no
/// fetch and no internal state. This holder mirrors that exactly — it projects the render decisions once
/// through <see cref="UserCellProjection.Project"/> from the props and the i18n facade, exposes the projected
/// <see cref="Projection"/> the view binds, and re-projects (raising <see cref="PropertyChanged"/>) on
/// <see cref="Reload"/> — the native analogue of react-i18next re-rendering after the active language changes,
/// so the localized "Unknown user" fallback re-resolves. The view performs no I/O of its own. Drive it from
/// one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class UserCellViewModel : INotifyPropertyChanged
{
    private readonly UserCellProps _props;
    private readonly ILocalizer _localizer;
    private UserCellProjection _projection;

    /// <summary>Creates the holder over the cell props and the i18n facade (P1/S10).</summary>
    /// <param name="props">The cell render inputs (web props).</param>
    /// <param name="localizer">The i18n facade the unknown-user fallback name resolves through (web <c>useTranslation</c>).</param>
    public UserCellViewModel(UserCellProps props, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(props);
        ArgumentNullException.ThrowIfNull(localizer);

        _props = props;
        _localizer = localizer;
        _projection = UserCellProjection.Project(props, localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>UserCell</c>).</summary>
    public static string Slug => UserCellRegistration.Slug;

    /// <summary>The props this holder projects from.</summary>
    public UserCellProps Props => _props;

    /// <summary>The current render projection (content branch, display name, email line, avatar props).</summary>
    public UserCellProjection Projection => _projection;

    /// <summary>The cell's accessible name — the display name (with email when shown), or the em-dash when empty.</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>
    /// Re-resolve the labels and re-project the current props — the native analogue of react-i18next
    /// re-rendering after the active language changes (the localized "Unknown user" fallback re-resolves).
    /// Raises <see cref="PropertyChanged"/> for <see cref="Projection"/> only when the projection actually
    /// changes, so an unrelated culture change is a no-op for the view.
    /// </summary>
    public void Reload()
    {
        UserCellProjection next = UserCellProjection.Project(_props, _localizer);
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}
