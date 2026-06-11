using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.A11y;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 announcer mount point — a parity port of the web <c>AnnouncerRegion</c>
/// (web/src/components/a11y/AnnouncerRegion.tsx). Mount exactly once per app (the native analogue of the
/// single web mount in <c>Layout.tsx</c>). Like the web component it renders only the two visually-hidden
/// live regions that the announcer writes into — one polite, one assertive — and adds no visible chrome of
/// its own. The two regions are siblings so each keeps a static urgency (some screen readers ignore an
/// <c>aria-live</c> / live-setting change after the first announcement), exactly as the web component splits
/// the polite and assertive regions for the same reason.
/// </summary>
/// <remarks>
/// The surface owns an <see cref="AnnouncerRegionViewModel"/> bound to the shared <see cref="AnnouncerBus"/>
/// (the P1/S8 seam): the holder subscribes to the bus and raises <see cref="AnnouncerRegionViewModel.Announced"/>
/// on each fan-out, which this view marshals onto its captured <see cref="DispatcherQueue"/> before voicing
/// the message on the matching <see cref="TsAnnouncerRegion"/> (an announcement may be fired from a
/// background live/MQTT callback). It is transparent to Narrator as a container (the two regions carry the
/// live semantics) and emits the <c>view.opened</c> diagnostic once on <see cref="FrameworkElement.Loaded"/>,
/// mirroring the web component mount.
/// </remarks>
public sealed partial class AnnouncerRegion : ContentControl, IDisposable
{
    /// <summary>Automation id of the polite region (the web <c>data-testid="announcer-polite"</c>).</summary>
    public const string PoliteAutomationId = "announcer-polite";

    /// <summary>Automation id of the assertive region (the web <c>data-testid="announcer-assertive"</c>).</summary>
    public const string AssertiveAutomationId = "announcer-assertive";

    private readonly AnnouncerRegionViewModel _viewModel;
    private readonly AnnouncerDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;
    private readonly TsAnnouncerRegion _polite = new() { Assertive = false };
    private readonly TsAnnouncerRegion _assertive = new() { Assertive = true };
    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the mount point over the process-wide shared announcer bus.</summary>
    public AnnouncerRegion()
        : this(AnnouncerBus.Shared, diagnostics: null)
    {
    }

    /// <summary>
    /// Creates the mount point over an explicit announcer seam (tests / headless hosts) and an optional
    /// diagnostics collector.
    /// </summary>
    public AnnouncerRegion(IAnnouncerBus bus, AnnouncerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(bus);

        _dispatcher = DispatcherQueue.GetForCurrentThread();
        _diagnostics = diagnostics ?? new AnnouncerDiagnostics();
        _viewModel = new AnnouncerRegionViewModel(bus);

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        // Pin each region's urgency up front. The assertive region's setting is wired by its Assertive=true
        // initializer; the polite region keeps its default Assertive=false (which never fires the atomic's
        // change handler), so set its live-setting explicitly to guarantee the polite region is a live region.
        AutomationProperties.SetLiveSetting(_polite, AutomationLiveSetting.Polite);
        AutomationProperties.SetLiveSetting(_assertive, AutomationLiveSetting.Assertive);
        AutomationProperties.SetAutomationId(_polite, PoliteAutomationId);
        AutomationProperties.SetAutomationId(_assertive, AssertiveAutomationId);

        var host = new Grid();
        host.Children.Add(_polite);
        host.Children.Add(_assertive);
        Content = host;

        // Transparent container: the web fragment contributes no accessible node of its own, so hide the
        // wrapper from Narrator and let the two regions carry the live semantics.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        _viewModel.Announced += OnAnnounced;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
    }

    /// <summary>The diagnostics slug this surface registers under (<c>AnnouncerRegion</c>).</summary>
    public static string Slug => AnnouncerRegionRegistration.Slug;

    /// <summary>The most recent polite-region text voiced (for UI-automation assertions).</summary>
    public string LastPoliteMessage => _polite.LastMessage;

    /// <summary>The most recent assertive-region text voiced (for UI-automation assertions).</summary>
    public string LastAssertiveMessage => _assertive.LastMessage;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.Announced -= OnAnnounced;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnAnnounced(object? sender, AnnouncerMessageEventArgs e)
    {
        void Voice()
        {
            var region = e.Priority == AnnouncerPriority.Assertive ? _assertive : _polite;
            region.Announce(e.Message);
        }

        // An announcement can be fired from a background live/MQTT callback; voice it on the UI thread.
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(Voice);
        }
        else
        {
            Voice();
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_opened)
        {
            return;
        }

        _opened = true;

        // Mirror the web component mounting: emit the view.opened diagnostic exactly once.
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();
}
