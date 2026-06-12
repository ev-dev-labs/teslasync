using System.Threading.Tasks;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Windows.ApplicationModel.DataTransfer;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The native WinUI 3 copy-link surface — a parity port of the web <c>CopyLinkButton</c>
/// (web/src/components/layout/CopyLinkButton.tsx). It renders a single ghost button that copies the current
/// view's shareable deep-link (web <c>window.location.href</c>) to the clipboard, swaps its icon + label to a
/// "Copied" confirmation for two seconds, and announces the outcome on the shared toast queue. The button is a
/// <see cref="TsButton"/> (the web <c>Button variant="ghost" size="sm"</c> primitive) with a leading link icon
/// that becomes a check on success; its accessible name is the constant "Copy link to this view"
/// (web <c>aria-label</c>), independent of the visible label. All state flows through the shared
/// <see cref="CopyLinkButtonViewModel"/>; the view performs only the platform clipboard write (through
/// <see cref="SystemClipboardWriter"/>) and the two-second revert timer (web
/// <c>setTimeout(() =&gt; setCopied(false), 2000)</c>). Every label resolves through the i18n facade.
///
/// <para>
/// State coverage: the web source is a presentational control with no data fetch — it issues no query, so it has
/// no loading / empty / error / stale / offline chrome to reproduce. The states it actually has are reproduced in
/// full: idle ("Copy link" + link icon), copied ("Copied" + check icon for two seconds, then auto-revert), and
/// the two click outcomes (success → success toast + confirmation; failure → error toast, stays idle).
/// </para>
/// </summary>
public sealed partial class CopyLinkButton : ContentControl, IDisposable
{
    private const string LinkGlyph = "\uE71B";    // Segoe Fluent "Link" — the web Link2 idle icon.
    private const string CopiedGlyph = "\uE73E";  // Segoe Fluent "CheckMark" — the web Check confirmation icon.
    private const double IconSize = 14;           // web h-3.5 w-3.5.

    private readonly CopyLinkButtonViewModel _viewModel;
    private readonly CopyLinkButtonDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsButton _button;
    private readonly DispatcherTimer _revertTimer;

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a gallery-safe surface bound to the inert link seam, the platform clipboard, a fresh headless toast
    /// queue and the passthrough localizer — the native analogue of mounting the web component in an isolated host.
    /// Production callers use the seam constructor.
    /// </summary>
    public CopyLinkButton()
        : this(
            NoOpCurrentLinkProvider.Instance,
            SystemClipboardWriter.Instance,
            new ToastController(),
            PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its link + clipboard seams, the shared toast queue, localizer and diagnostics.</summary>
    /// <param name="link">The current-view-link seam (web <c>window.location.href</c>).</param>
    /// <param name="clipboard">The clipboard-write seam (web <c>navigator.clipboard.writeText</c>).</param>
    /// <param name="toast">The shared toast queue (web <c>useToast()</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public CopyLinkButton(
        ICurrentLinkProvider link,
        IClipboardWriter clipboard,
        IToastController toast,
        ILocalizer localizer,
        CopyLinkButtonDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(link);
        ArgumentNullException.ThrowIfNull(clipboard);
        ArgumentNullException.ThrowIfNull(toast);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new CopyLinkButtonDiagnostics();
        _viewModel = new CopyLinkButtonViewModel(link, clipboard, toast, localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        _button = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            FontSize = IconSize,
        };
        _button.Click += OnButtonClick;

        _revertTimer = new DispatcherTimer { Interval = CopyLinkButtonRegistration.RevertDelay };
        _revertTimer.Tick += OnRevertTick;

        IsTabStop = false;

        // Transparent structural wrapper: the web root is the button itself, so the surface hides itself from
        // Narrator and lets the button carry the accessible semantics.
        AutomationProperties.SetAccessibilityView(this, AccessibilityView.Raw);

        Content = _button;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>CopyLinkButton</c>).</summary>
    public static string Slug => CopyLinkButtonRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public CopyLinkButtonViewModel ViewModel => _viewModel;

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _revertTimer.Stop();
        _revertTimer.Tick -= OnRevertTick;
        _button.Click -= OnButtonClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new CopyLinkButtonAutomationPeer(this);

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

    private void OnButtonClick(object sender, RoutedEventArgs e) => _viewModel.Copy();

    private void OnRevertTick(object? sender, object e)
    {
        // web: setTimeout(() => setCopied(false), 2000) — one-shot revert back to the idle label/icon.
        _revertTimer.Stop();
        _viewModel.ResetCopied();
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher && !dispatcher.HasThreadAccess)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        _button.IconGlyph = _viewModel.ShowCheckIcon ? CopiedGlyph : LinkGlyph;
        _button.Text = _viewModel.Label;

        // The visible label changes ("Copy link" / "Copied") but the accessible name is the constant web
        // aria-label; set it after the Text so it wins over TsButton's text-derived default name.
        AutomationProperties.SetName(_button, _viewModel.AccessibleLabel);

        // Arm the one-shot revert timer when the confirmation state is entered (web setTimeout on setCopied(true)).
        if (_viewModel.IsCopied)
        {
            _revertTimer.Stop();
            _revertTimer.Start();
        }
        else
        {
            _revertTimer.Stop();
        }
    }

    private sealed class CopyLinkButtonAutomationPeer : FrameworkElementAutomationPeer
    {
        public CopyLinkButtonAutomationPeer(CopyLinkButton owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            var name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((CopyLinkButton)Owner).ViewModel.AccessibleLabel
                : name;
        }
    }
}

/// <summary>
/// The production <see cref="IClipboardWriter"/> — the WinUI host's clipboard binding (the native analogue of the
/// web <c>navigator.clipboard.writeText</c> primary path). It packages the text and calls
/// <see cref="Clipboard.SetContent(DataPackage)"/>, returning <see langword="true"/> on success and swallowing any
/// platform failure (e.g. the clipboard being locked by another process) as <see langword="false"/> so the
/// view-model raises the error toast — reproducing the web component's <c>try</c> / <c>catch</c>. The synchronous
/// WinRT call is wrapped in a completed task so the seam stays awaitable.
/// </summary>
public sealed class SystemClipboardWriter : IClipboardWriter
{
    /// <summary>The shared writer instance.</summary>
    public static SystemClipboardWriter Instance { get; } = new();

    private SystemClipboardWriter()
    {
    }

    /// <inheritdoc />
    public Task<bool> WriteTextAsync(string text)
    {
        try
        {
            var package = new DataPackage();
            package.SetText(text ?? string.Empty);
            Clipboard.SetContent(package);
            return Task.FromResult(true);
        }
        catch (Exception)
        {
            // web catch path: navigator.clipboard.writeText rejected (e.g. clipboard locked / unavailable) — the
            // view-model maps a failed write to the error toast.
            return Task.FromResult(false);
        }
    }
}
