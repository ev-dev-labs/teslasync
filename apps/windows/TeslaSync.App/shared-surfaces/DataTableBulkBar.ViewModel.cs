using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="DataTableBulkBar"/> view — the native port of the
/// web component body (web/src/components/ui/DataTableBulkBar.tsx). It mirrors the web source exactly: the bar
/// is shown only while at least one row is selected (<see cref="IsVisible"/> = web <c>count &lt;= 0 ? null</c>);
/// the polite count caption (<see cref="CountLabel"/> = web <c>t('table.bulkActions.selected', { count })</c>);
/// the region accessible name (<see cref="RegionLabel"/> = web <c>aria-label={t('table.bulkActions.region')}</c>);
/// and the clear-selection button label (<see cref="ClearLabel"/> = web <c>t('table.bulkActions.clear')</c>).
/// <see cref="RequestClear"/> raises <see cref="ClearRequested"/> (web <c>onClear</c>). The view binds the
/// projected labels + visibility and never performs I/O. Drive it from one confinement (the UI thread); it is
/// not internally synchronised.
/// </summary>
public sealed class DataTableBulkBarViewModel : INotifyPropertyChanged
{
    private static readonly PropertyChangedEventArgs AllProperties = new(string.Empty);

    private readonly ILocalizer _localizer;
    private int _count;

    /// <summary>Creates the holder over the i18n facade every label resolves through (P1/S10).</summary>
    public DataTableBulkBarViewModel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the user activates the clear button (web <c>onClear</c>); the host clears its selection.</summary>
    public event EventHandler? ClearRequested;

    /// <summary>The number of selected rows (web <c>count</c>).</summary>
    public int Count => _count;

    /// <summary>Whether the bar is shown — true only while something is selected (web <c>count &lt;= 0 ? null</c>).</summary>
    public bool IsVisible => _count > 0;

    /// <summary>The region accessible name (web <c>aria-label={t('table.bulkActions.region', 'Bulk actions')}</c>).</summary>
    public string RegionLabel =>
        _localizer.GetString(DataTableBulkBarRegistration.RegionKey, DataTableBulkBarRegistration.RegionFallback);

    /// <summary>The polite count caption (web <c>t('table.bulkActions.selected', '{{count}} selected', { count })</c>).</summary>
    public string CountLabel => DataTableBulkBarRegistration.FormatSelected(
        _localizer.GetString(DataTableBulkBarRegistration.SelectedKey, DataTableBulkBarRegistration.SelectedFallback),
        _count);

    /// <summary>The clear-selection button label (web <c>t('table.bulkActions.clear', 'Clear selection')</c>).</summary>
    public string ClearLabel =>
        _localizer.GetString(DataTableBulkBarRegistration.ClearKey, DataTableBulkBarRegistration.ClearFallback);

    /// <summary>Set the current selection count, re-rendering the bar (web <c>count</c> prop change).</summary>
    public void SetCount(int count)
    {
        if (_count == count)
        {
            return;
        }

        _count = count;
        PropertyChanged?.Invoke(this, AllProperties);
    }

    /// <summary>Request a clear of the selection (web clear button <c>onClick={onClear}</c>).</summary>
    public void RequestClear() => ClearRequested?.Invoke(this, EventArgs.Empty);
}
