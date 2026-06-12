using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <see cref="DataTableColumnsMenu"/> view — the native port
/// of the web <c>DataTableColumnsMenu</c> component body (web/src/components/ui/DataTableColumnsMenu.tsx). It
/// mirrors the web source exactly: the controlled <see cref="IsOpen"/> popover state (web
/// <c>useState(false)</c>) the trigger toggles and click-outside / Escape close; the
/// <see cref="DataTableColumnsMenuProjection.Project"/> projection of the bound
/// <see cref="IDataTableColumnsSource"/> (the P1/S8 seam carrying the columns + visible keys) into a
/// render-ready <see cref="Display"/>; and the <see cref="Toggle"/> / <see cref="ShowAll"/> commands that
/// reproduce the web <c>toggle</c> / <c>showAll</c> handlers and report the new visible-key set back through
/// the seam's <c>Apply</c> (web <c>onChange</c>). It carries no view-framework dependency so it is verified
/// headlessly; the WinUI view marshals its notifications onto the dispatcher.
/// </summary>
public sealed class DataTableColumnsMenuViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDataTableColumnsSource _source;
    private readonly ILocalizer _localizer;
    private DataTableColumnsMenuDisplay _display;
    private bool _isOpen;
    private bool _disposed;

    /// <summary>Creates the holder over its data seam and localizer, projecting the initial frame.</summary>
    /// <param name="source">The column / visible-key seam (web <c>columns</c> / <c>visibleKeys</c> / <c>onChange</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through (P1/S10).</param>
    public DataTableColumnsMenuViewModel(IDataTableColumnsSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _display = Project();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The diagnostics slug this surface registers under (<c>DataTableColumnsMenu</c>).</summary>
    public static string Slug => DataTableColumnsMenuRegistration.Slug;

    /// <summary>The render-ready projection of the current columns + visible keys.</summary>
    public DataTableColumnsMenuDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            PropertyChanged?.Invoke(this, DisplayChangedArgs);
            PropertyChanged?.Invoke(this, RowsChangedArgs);
            PropertyChanged?.Invoke(this, IsEmptyChangedArgs);
        }
    }

    /// <summary>
    /// Whether the popover is open (web <c>open</c> state). The view keeps this in sync with the native flyout's
    /// open / close (which supplies the web click-outside + Escape dismiss).
    /// </summary>
    public bool IsOpen
    {
        get => _isOpen;
        private set
        {
            if (_isOpen == value)
            {
                return;
            }

            _isOpen = value;
            PropertyChanged?.Invoke(this, IsOpenChangedArgs);
        }
    }

    /// <summary>One checkbox row per column, in column order (web <c>columns.map(...)</c>).</summary>
    public IReadOnlyList<DataTableColumnRow> Rows => _display.Rows;

    /// <summary>True when there are no columns to choose from.</summary>
    public bool IsEmpty => _display.IsEmpty;

    /// <summary>Open the popover (web <c>setOpen(true)</c>).</summary>
    public void OpenMenu() => IsOpen = true;

    /// <summary>Close the popover (web click-outside / Escape / action close).</summary>
    public void CloseMenu() => IsOpen = false;

    /// <summary>Toggle the popover (web trigger <c>onClick={() =&gt; setOpen((v) =&gt; !v)}</c>).</summary>
    public void ToggleMenu() => IsOpen = !_isOpen;

    /// <summary>
    /// Toggle a column's visibility (web <c>toggle(key)</c>): hides it unless it is the last visible column (a
    /// no-op), otherwise shows it — reporting the new visible-key set through the seam's <c>Apply</c>
    /// (web <c>onChange</c>). A null / empty key is ignored.
    /// </summary>
    public void Toggle(string key)
    {
        if (string.IsNullOrEmpty(key))
        {
            return;
        }

        IReadOnlyList<string>? next = DataTableColumnsMenuProjection.ComputeToggle(_source.Columns, _source.VisibleKeys, key);
        if (next is null)
        {
            // Web early return: the last visible column cannot be hidden.
            return;
        }

        _source.Apply(next);
    }

    /// <summary>Show every column (web <c>showAll</c>): reports the full key set through the seam's <c>Apply</c>.</summary>
    public void ShowAll() => _source.Apply(DataTableColumnsMenuProjection.ComputeShowAll(_source.Columns));

    /// <summary>Detach from the data seam (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Changed -= OnSourceChanged;
        GC.SuppressFinalize(this);
    }

    private void OnSourceChanged(object? sender, EventArgs e) => Display = Project();

    private DataTableColumnsMenuDisplay Project() =>
        DataTableColumnsMenuProjection.Project(_source.Columns, _source.VisibleKeys, _localizer);

    private static readonly PropertyChangedEventArgs DisplayChangedArgs = new(nameof(Display));
    private static readonly PropertyChangedEventArgs RowsChangedArgs = new(nameof(Rows));
    private static readonly PropertyChangedEventArgs IsEmptyChangedArgs = new(nameof(IsEmpty));
    private static readonly PropertyChangedEventArgs IsOpenChangedArgs = new(nameof(IsOpen));
}
