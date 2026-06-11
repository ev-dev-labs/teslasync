using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="HistoryListRow"/> view — the native port of the web
/// component body (<c>web/src/components/data-display/HistoryListRow.tsx</c>). The web row is stateless apart
/// from the render decisions derived from its props; this holder mirrors that by projecting the structural
/// inputs once through <see cref="HistoryListRowProjection.Project"/> and re-projecting (raising
/// <see cref="PropertyChanged"/>) whenever the host pushes a new configuration through
/// <see cref="UpdateProps(HistoryListRowProps)"/> (a slot becoming populated/empty, the selection toggling, the
/// glow changing, …). It also owns the navigation seam: <see cref="Activate"/> drives the web row's
/// mutually-exclusive <c>href</c> / <c>onClick</c> behaviour — a navigable row calls
/// <see cref="IHistoryListRowNavigator.Navigate(string)"/> (the react-router <c>&lt;Link&gt;</c>), an
/// invoke-only row is left for the view to raise its activation event. The view binds the projected
/// <see cref="Projection"/> and performs no I/O of its own. Drive it from one confinement (the UI thread); it is
/// not internally synchronised.
/// </summary>
public sealed class HistoryListRowViewModel : INotifyPropertyChanged
{
    private readonly IHistoryListRowNavigator? _navigator;
    private HistoryListRowProps _props;
    private HistoryListRowProjection _projection;

    /// <summary>Creates a holder over the row's structural props and an optional navigation seam.</summary>
    /// <param name="props">The initial structural render inputs.</param>
    /// <param name="navigator">The navigation seam a navigable row drives; null leaves navigation inert.</param>
    public HistoryListRowViewModel(HistoryListRowProps props, IHistoryListRowNavigator? navigator = null)
    {
        ArgumentNullException.ThrowIfNull(props);

        _navigator = navigator;
        _props = props;
        _projection = HistoryListRowProjection.Project(props);
    }

    /// <summary>Creates a holder with the default props (an empty, non-interactive cyan-glow row).</summary>
    /// <param name="navigator">The navigation seam a navigable row drives; null leaves navigation inert.</param>
    public HistoryListRowViewModel(IHistoryListRowNavigator? navigator = null)
        : this(new HistoryListRowProps(), navigator)
    {
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>HistoryListRow</c>).</summary>
    public static string Slug => HistoryListRowRegistration.Slug;

    /// <summary>The structural props this holder projects from.</summary>
    public HistoryListRowProps Props => _props;

    /// <summary>The current render projection (slot visibility, glow, activation, automation ids).</summary>
    public HistoryListRowProjection Projection => _projection;

    /// <summary>The mutually-exclusive activation behaviour the row performs when activated.</summary>
    public HistoryListRowActivation Activation => _projection.Activation;

    /// <summary>True when the row is activatable (navigable or has a click handler).</summary>
    public bool IsInteractive => _projection.IsInteractive;

    /// <summary>
    /// Push a new structural configuration (a web prop change). Re-projects and raises
    /// <see cref="PropertyChanged"/> for <see cref="Projection"/> when the render decisions change; a no-op when
    /// the configuration projects identically (value equality on the projection).
    /// </summary>
    /// <param name="props">The new structural render inputs.</param>
    public void UpdateProps(HistoryListRowProps props)
    {
        ArgumentNullException.ThrowIfNull(props);

        _props = props;
        HistoryListRowProjection next = HistoryListRowProjection.Project(props);
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }

    /// <summary>Replace the selected tint (web <c>selected</c> prop change); a no-op when unchanged.</summary>
    /// <param name="selected">Whether the row is selected.</param>
    public void SetSelected(bool selected)
    {
        if (_props.Selected != selected)
        {
            UpdateProps(_props with { Selected = selected });
        }
    }

    /// <summary>Replace the hover glow accent (web <c>glow</c> prop change); a no-op when unchanged.</summary>
    /// <param name="glow">The new glow accent.</param>
    public void SetGlow(HistoryListRowGlow glow)
    {
        if (_props.Glow != glow)
        {
            UpdateProps(_props with { Glow = glow });
        }
    }

    /// <summary>Replace the navigation target (web <c>href</c> prop change); a no-op when unchanged.</summary>
    /// <param name="href">The new navigation target, or null to make the row non-navigable.</param>
    public void SetHref(string? href)
    {
        if (!string.Equals(_props.Href, href, StringComparison.Ordinal))
        {
            UpdateProps(_props with { Href = href });
        }
    }

    /// <summary>
    /// Activate the row, reproducing the web row's mutually-exclusive behaviour: a navigable row
    /// (<see cref="HistoryListRowActivation.Navigate"/>) calls the navigation seam with its
    /// <see cref="HistoryListRowProjection.Href"/>; an invoke-only row
    /// (<see cref="HistoryListRowActivation.Invoke"/>) performs no navigation and leaves the host's click handler
    /// to the view's activation event; an inert row does nothing.
    /// </summary>
    /// <returns>The activation behaviour that was performed.</returns>
    public HistoryListRowActivation Activate()
    {
        if (_projection.Activation == HistoryListRowActivation.Navigate && _projection.Href.Length > 0)
        {
            _navigator?.Navigate(_projection.Href);
        }

        return _projection.Activation;
    }
}
