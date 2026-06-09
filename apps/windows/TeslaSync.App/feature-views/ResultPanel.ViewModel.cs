using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ResultPanel"/> view — the native port of the web
/// <c>ResultPanel</c> component (web/src/features/admin/components/devtools/ResultPanel.tsx). It projects the
/// current <see cref="IResultPanelSource"/> input through <see cref="ResultPanelProjection"/> and exposes the
/// resulting <see cref="Display"/> plus the mutually-exclusive <see cref="State"/> so the view is a thin
/// renderer. The surface is presentational — there is no asynchronous load — so projection is synchronous;
/// <see cref="Update(ResultPanelInput)"/> re-projects for new props (the web re-render) and
/// <see cref="Refresh"/> re-pulls the seam. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class ResultPanelViewModel : INotifyPropertyChanged
{
    private readonly IResultPanelSource _source;
    private readonly ILocalizer _localizer;

    private ResultPanelInput _input;
    private ResultPanelDisplay _display;

    /// <summary>Creates the holder over its input seam and the i18n facade.</summary>
    /// <param name="source">The input seam (the latest props the host fed the surface).</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    public ResultPanelViewModel(IResultPanelSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _input = source.GetInput();
        _display = ResultPanelProjection.Project(_input, localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, render-ready display for the current inputs.</summary>
    public ResultPanelDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(State));
            Raise(nameof(Title));
            Raise(nameof(HasCopyAction));
        }
    }

    /// <summary>The current mutually-exclusive surface state.</summary>
    public ResultPanelState State => _display.State;

    /// <summary>The header label shown verbatim (web title span).</summary>
    public string Title => _display.Title;

    /// <summary>True iff a payload resolved — drives the copy affordance (web <c>data != null</c>).</summary>
    public bool HasCopyAction => _display.HasCopyAction;

    /// <summary>Re-project for a new set of props (the web re-render with new <c>{ title, data, error }</c>).</summary>
    public void Update(ResultPanelInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        _input = input;
        Display = ResultPanelProjection.Project(_input, _localizer);
    }

    /// <summary>Re-pull the current input from the seam and re-project (e.g. after the host swaps the source value).</summary>
    public void Refresh() => Update(_source.GetInput());

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
