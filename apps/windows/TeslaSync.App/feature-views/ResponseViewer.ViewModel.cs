using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ResponseViewer"/> view — the native port of the
/// web <c>ResponseViewer</c> component (web/src/features/admin/components/ResponseViewer.tsx). It projects the
/// current <see cref="IResponseViewerSource"/> input through <see cref="ResponseViewerProjection"/> and exposes
/// the resulting <see cref="Display"/> plus the mutually-exclusive <see cref="State"/> so the view is a thin
/// renderer. The surface is presentational — there is no asynchronous load — so projection is synchronous;
/// <see cref="Update(ResponseViewerInput)"/> re-projects for new props (the web re-render) and
/// <see cref="Refresh"/> re-pulls the seam. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class ResponseViewerViewModel : INotifyPropertyChanged
{
    private readonly IResponseViewerSource _source;
    private readonly ILocalizer _localizer;

    private ResponseViewerInput _input;
    private ResponseViewerDisplay _display;

    /// <summary>Creates the holder over its input seam and the i18n facade.</summary>
    /// <param name="source">The input seam (the latest props the host fed the surface).</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    public ResponseViewerViewModel(IResponseViewerSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _input = source.GetInput();
        _display = ResponseViewerProjection.Project(_input, localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, render-ready display for the current inputs.</summary>
    public ResponseViewerDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(State));
            Raise(nameof(HasResponse));
            Raise(nameof(HasHistory));
        }
    }

    /// <summary>The current mutually-exclusive response-panel state.</summary>
    public ResponseViewerState State => _display.State;

    /// <summary>True when a response has resolved (web <c>response</c> branch).</summary>
    public bool HasResponse => _display.HasResponse;

    /// <summary>True when the history strip has at least one entry (web <c>history.length &gt; 0</c>).</summary>
    public bool HasHistory => _display.HasHistory;

    /// <summary>Re-project for a new set of props (the web re-render with new <c>{ response, loading, history }</c>).</summary>
    /// <param name="input">The latest inputs.</param>
    public void Update(ResponseViewerInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        _input = input;
        Display = ResponseViewerProjection.Project(_input, _localizer);
    }

    /// <summary>Re-pull the current input from the seam and re-project (e.g. after the host swaps the source value).</summary>
    public void Refresh() => Update(_source.GetInput());

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
