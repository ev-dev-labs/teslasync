using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.InputSurface;

/// <summary>
/// The state holder an <c>Input</c> view binds to — the native analogue of the web component's derived render
/// state (web/src/components/ui/Input.tsx). The web input is purely prop-driven and has no hook / data source
/// of its own (it derives its id straight from its <c>id</c> / <c>label</c> props rather than from
/// <c>useId</c>), so this holder owns no seam: it simply caches the current <see cref="Model"/> and re-derives
/// the render-ready <see cref="Display"/> from it on demand. It is <see cref="INotifyPropertyChanged"/> so the
/// WinUI surface refreshes when the model changes (the web re-render on a prop change). The view performs no
/// projection of its own; it binds to this holder, keeping the surface free of any direct data access.
/// </summary>
public sealed class InputViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private InputModel _model;

    /// <summary>Creates the holder over the i18n facade and an initial model.</summary>
    /// <param name="localizer">The i18n facade the required word and help accessible name resolve through (P1/S10).</param>
    /// <param name="model">The initial render model; defaults to <see cref="InputModel.Empty"/>.</param>
    public InputViewModel(ILocalizer localizer, InputModel? model = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? InputModel.Empty;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The render model; reassigning re-projects and notifies (the web prop change re-render).</summary>
    public InputModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (_model == value)
            {
                return;
            }

            _model = value;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Model)));
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Display)));
        }
    }

    /// <summary>The render-ready projection of the current model (web's derived id / a11y / rows).</summary>
    public InputDisplay Display => InputProjection.Project(_model, _localizer);
}
