using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="HealthRow"/> view — the native port of the web
/// <c>HealthRow</c> body (web/src/components/status/HealthRow.tsx L45-107). It holds the current
/// <see cref="HealthRowModel"/>, recomputes the pure <see cref="HealthRowProjection"/> whenever the model is set
/// (the web re-render on prop change), and raises <see cref="PropertyChanged"/> so the view re-renders. It binds
/// the <see cref="IHealthRowNavigator"/> seam (P1/S8) the link branches route through and the optional click
/// handler the command branch invokes; <see cref="Activate"/> dispatches to whichever the resolved
/// <see cref="HealthRowInteraction"/> selects (the web link click / button <c>onClick</c>). The view performs no
/// navigation of its own and reads no data itself.
/// </summary>
public sealed class HealthRowViewModel : INotifyPropertyChanged
{
    private readonly IHealthRowNavigator _navigator;
    private readonly Action? _onActivated;
    private HealthRowModel _model;
    private HealthRowProjection _projection;

    /// <summary>Creates the holder over its prop set, the navigation seam and an optional click handler.</summary>
    /// <param name="model">The initial prop set (web props).</param>
    /// <param name="navigator">The navigation seam link activations route through; defaults to inert.</param>
    /// <param name="onActivated">The click handler invoked for the command branch (web <c>onClick</c>); supply when the model is <see cref="HealthRowModel.Interactive"/>.</param>
    public HealthRowViewModel(HealthRowModel model, IHealthRowNavigator? navigator = null, Action? onActivated = null)
    {
        ArgumentNullException.ThrowIfNull(model);

        _model = model;
        _navigator = navigator ?? NullHealthRowNavigator.Instance;
        _onActivated = onActivated;
        _projection = HealthRowProjection.Project(model);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>HealthRow</c>).</summary>
    public static string Slug => HealthRowRegistration.Slug;

    /// <summary>The current prop set (web props).</summary>
    public HealthRowModel Model => _model;

    /// <summary>The current render projection (tint, text, icon, interaction, accessible name).</summary>
    public HealthRowProjection Projection => _projection;

    /// <summary>
    /// Replace the prop set and reproject (the web re-render on prop change); raises <see cref="PropertyChanged"/>
    /// only when the projection actually moves, so an identical update is a no-op.
    /// </summary>
    /// <param name="model">The new prop set.</param>
    public void SetModel(HealthRowModel model)
    {
        ArgumentNullException.ThrowIfNull(model);

        if (_model == model)
        {
            return;
        }

        _model = model;

        var next = HealthRowProjection.Project(model);
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }

    /// <summary>
    /// Activate the row, dispatching by the resolved <see cref="HealthRowInteraction"/> (web link click /
    /// button <c>onClick</c>): a link routes its target through the navigator (with the external flag), a command
    /// invokes the click handler, and a non-interactive row does nothing.
    /// </summary>
    public void Activate()
    {
        switch (_projection.Interaction)
        {
            case HealthRowInteraction.InternalLink:
            case HealthRowInteraction.ExternalLink:
                if (!string.IsNullOrEmpty(_projection.Target))
                {
                    _navigator.Navigate(_projection.Target, _projection.External);
                }

                break;

            case HealthRowInteraction.Command:
                _onActivated?.Invoke();
                break;
        }
    }
}
