using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Windows.Storage;

namespace TeslaSync.App.MiscSurfaces;

/// <summary>
/// The canonical Windows <see cref="ISelectedVehicleStorage"/> — it persists the selected-vehicle id as a
/// string under <see cref="SelectedVehicleRegistration.StorageKey"/> in <c>ApplicationData.LocalSettings</c>
/// (the native analogue of the web store's <c>localStorage</c> slot) and bridges
/// <c>ApplicationData.DataChanged</c> to <see cref="ExternalChanged"/> as the cross-instance equivalent of
/// the web cross-tab <c>'storage'</c> event. Every access is guarded so an unpackaged / identity-less dev
/// run degrades to "no selection" rather than throwing, mirroring the web store's try/catch around
/// <c>localStorage</c>. The <c>DataChanged</c> callback (raised off the UI thread) is marshalled onto the
/// captured <see cref="DispatcherQueue"/> so the bound store mutates on the UI thread.
/// </summary>
public sealed class LocalSettingsSelectedVehicleStorage : ISelectedVehicleStorage, IDisposable
{
    private readonly DispatcherQueue? _dispatcher;
    private bool _subscribed;
    private bool _disposed;

    /// <summary>Creates the store, capturing the current <see cref="DispatcherQueue"/> for change marshalling.</summary>
    public LocalSettingsSelectedVehicleStorage()
    {
        _dispatcher = DispatcherQueue.GetForCurrentThread();
        TrySubscribeDataChanged();
    }

    /// <inheritdoc />
    public event EventHandler<SelectedVehicleExternalChangedEventArgs>? ExternalChanged;

    /// <inheritdoc />
    public long? Load() => SelectedVehicleId.Parse(ReadRaw());

    /// <inheritdoc />
    public void Persist(long? id)
    {
        try
        {
            var values = ApplicationData.Current.LocalSettings.Values;
            var raw = SelectedVehicleId.Format(id);
            if (raw is null)
            {
                values.Remove(SelectedVehicleRegistration.StorageKey);
            }
            else
            {
                values[SelectedVehicleRegistration.StorageKey] = raw;
            }
        }
        catch (Exception)
        {
            // No package identity / unwritable store — persistence is best-effort, like the web store's
            // try/catch: the in-memory selection still holds for the session, it just won't survive a restart.
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (!_subscribed)
        {
            return;
        }

        try
        {
            ApplicationData.Current.DataChanged -= OnDataChanged;
        }
        catch (Exception)
        {
            // Best-effort unsubscribe.
        }
    }

    private static string? ReadRaw()
    {
        try
        {
            return ApplicationData.Current.LocalSettings.Values.TryGetValue(
                SelectedVehicleRegistration.StorageKey, out var value) && value is string raw
                ? raw
                : null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    private void TrySubscribeDataChanged()
    {
        try
        {
            ApplicationData.Current.DataChanged += OnDataChanged;
            _subscribed = true;
        }
        catch (Exception)
        {
            // No package identity — cross-instance sync is unavailable; read / persist still degrade safely.
        }
    }

    private void OnDataChanged(ApplicationData sender, object args)
    {
        var raw = ReadRaw();
        void Raise() => ExternalChanged?.Invoke(this, new SelectedVehicleExternalChangedEventArgs(raw));

        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(Raise);
        }
        else
        {
            Raise();
        }
    }
}

/// <summary>
/// The native WinUI 3 selected-vehicle provider — a parity port of the web <c>SelectedVehicleProvider</c>
/// (web/src/store/selectedVehicle.tsx). Like the web Context provider it renders its
/// <see cref="ContentControl.Content"/> (the <c>children</c>) unchanged and adds no visual chrome of its
/// own; its job is to own the persistent <see cref="SelectedVehicleStore"/> and expose it as
/// <see cref="Scope"/> so the shell and descendant surfaces read &amp; write the focused vehicle through one
/// process-wide source of truth. The store is backed by <see cref="LocalSettingsSelectedVehicleStorage"/> so
/// the selection survives restart (web reload) and reflects cross-instance writes (web cross-tab sync). The
/// provider emits the <c>view.opened</c> diagnostic once on <see cref="FrameworkElement.Loaded"/> (the web
/// mount) and is transparent to Narrator (no accessible node of its own, matching the web provider), so
/// descendant accessibility is unaffected.
/// </summary>
public sealed partial class SelectedVehicleProvider : ContentControl, IDisposable
{
    private readonly SelectedVehicleStore _store;
    private readonly IDisposable? _ownedStorage;
    private readonly SelectedVehicleDiagnostics _diagnostics;
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the provider over the canonical <c>LocalSettings</c>-backed store.</summary>
    public SelectedVehicleProvider()
        : this(new LocalSettingsSelectedVehicleStorage(), ownsStorage: true, diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the provider over an explicit storage seam (tests / headless hosts). When
    /// <paramref name="ownsStorage"/> is set and the seam is <see cref="IDisposable"/>, the provider disposes
    /// it alongside the store.
    /// </summary>
    public SelectedVehicleProvider(
        ISelectedVehicleStorage storage,
        bool ownsStorage = false,
        SelectedVehicleDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(storage);

        _store = new SelectedVehicleStore(storage);
        _ownedStorage = ownsStorage ? storage as IDisposable : null;
        _diagnostics = diagnostics ?? new SelectedVehicleDiagnostics();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        // Transparent structural wrapper: the web Context.Provider contributes no accessible node, so the
        // provider hides itself from Narrator and lets the hosted content carry its own accessibility.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The persistent selection scope descendants read &amp; write (the web context value).</summary>
    public ISelectedVehicleScope Scope => _store;

    /// <summary>The diagnostics slug this surface registers under (<c>selectedVehicle</c>).</summary>
    public static string Slug => SelectedVehicleRegistration.Slug;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _store.Dispose();
        _ownedStorage?.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirrors the web provider mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();
}
