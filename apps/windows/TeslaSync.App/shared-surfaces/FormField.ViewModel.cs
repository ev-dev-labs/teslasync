using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.FormFieldSurface;

/// <summary>
/// The state holder bound to the field-id seam (P1/S8) — the native port of the web <c>FormField</c>
/// component's derived state (web/src/components/forms/FormField.tsx). It calls the
/// <see cref="IFieldIdProvider"/> exactly once at construction (the web <c>const autoId = useId()</c>, which
/// runs once per instance and is stable across re-renders) and caches the value, then re-derives the
/// render-ready <see cref="Display"/> from the current <see cref="Model"/> on demand. It is
/// <see cref="INotifyPropertyChanged"/> so the WinUI surface refreshes when the model changes (the web
/// re-render on a prop change). The view performs no id generation or projection of its own; it binds to
/// this holder, which keeps the surface's only "data source" — the stable id — off the view.
/// </summary>
public sealed class FormFieldViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly string _autoId;
    private FormFieldModel _model;

    /// <summary>Creates the holder, resolving the stable field id once from the seam (the web mount <c>useId()</c>).</summary>
    /// <param name="localizer">The i18n facade the required marker resolves through (P1/S10).</param>
    /// <param name="model">The initial render model; defaults to <see cref="FormFieldModel.Empty"/>.</param>
    /// <param name="idProvider">The field-id seam; defaults to the process-wide <see cref="FieldIdProvider.Shared"/>.</param>
    public FormFieldViewModel(ILocalizer localizer, FormFieldModel? model = null, IFieldIdProvider? idProvider = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _autoId = (idProvider ?? FieldIdProvider.Shared).NextId();
        _model = model ?? FormFieldModel.Empty;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The render model; reassigning re-projects and notifies (the web prop change re-render).</summary>
    public FormFieldModel Model
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

    /// <summary>The cached, process-stable generated id (the web <c>autoId</c> from <c>useId()</c>).</summary>
    public string AutoId => _autoId;

    /// <summary>The render-ready projection of the current model (web's derived <c>fieldId</c> / ids / rows).</summary>
    public FormFieldDisplay Display => FormFieldProjection.Project(_model, _localizer, _autoId);
}
