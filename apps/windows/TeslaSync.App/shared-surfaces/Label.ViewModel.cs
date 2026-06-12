using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.LabelSurface;

/// <summary>
/// The state holder bound to the i18n facade (P1/S8 / P1/S10) — the native port of the web <c>Label</c>
/// component's only data dependency, <c>const { t } = useTranslation()</c> (web/src/components/ui/Label.tsx). It
/// holds the current <see cref="LabelModel"/> (the web props) and re-derives the render-ready
/// <see cref="LabelDisplay"/> from it on demand through the WinUI-free <see cref="LabelProjection"/>, resolving
/// the required word through the injected <see cref="ILocalizer"/>. It is <see cref="INotifyPropertyChanged"/> so
/// the WinUI surface refreshes when the model changes (the web re-render on a prop change). The view performs no
/// projection or string resolution of its own; it binds to this holder.
/// </summary>
public sealed class LabelViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private LabelModel _model;

    /// <summary>Creates the holder over the i18n facade and an initial model.</summary>
    /// <param name="localizer">The i18n facade the required word resolves through (P1/S10).</param>
    /// <param name="model">The initial render model; defaults to <see cref="LabelModel.Empty"/>.</param>
    public LabelViewModel(ILocalizer localizer, LabelModel? model = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _model = model ?? LabelModel.Empty;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The render model; reassigning re-projects and notifies (the web prop change re-render).</summary>
    public LabelModel Model
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

    /// <summary>The render-ready projection of the current model (web's returned JSX, resolved).</summary>
    public LabelDisplay Display => LabelProjection.Project(_model, _localizer);

    /// <summary>The composed accessible name the label exposes (web label accessible name); convenience for the view's automation peer.</summary>
    public string AccessibleName => Display.AccessibleName;
}
