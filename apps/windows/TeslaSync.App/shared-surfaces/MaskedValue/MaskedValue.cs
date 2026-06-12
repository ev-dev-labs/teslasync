using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces.MaskedValueSurface;

/// <summary>
/// The native WinUI 3 masked-value surface — a parity port of the web <c>MaskedValue</c>
/// (web/src/components/ui/MaskedValue.tsx). It renders a sensitive value in masked form by default inside a
/// monospace code run, with a ghost eye toggle that reveals the cleartext (and re-masks on a second press),
/// an opt-in copy affordance (<see cref="Copyable"/>) that always copies the cleartext regardless of the mask
/// state, and a 30-second auto-hide after a reveal. All state flows through the shared
/// <see cref="MaskedValueViewModel"/>; the view performs only the platform concerns — the one-shot auto-hide
/// timer (web <c>setTimeout(() =&gt; setRevealed(false), autoHideMs)</c>) and the composition of the toggle
/// (<see cref="TsButton"/>, the web <c>Button variant="ghost" size="sm"</c>) and the embedded
/// <see cref="CopyButton"/> surface (web <c>&lt;CopyButton iconOnly /&gt;</c>). Every label resolves through
/// the i18n facade and tints come from the shared design tokens.
///
/// <para>
/// State coverage: the web source is a presentational privacy primitive with no data fetch — it issues no
/// query, so it has no loading / error / stale / offline chrome to reproduce. The states it actually has are
/// reproduced in full: masked (initial render, the masked projection in the secondary text tint), revealed
/// (the cleartext in the accent tint, the toggle showing the hide icon, the auto-hide timer armed) and empty
/// (a muted em-dash with no toggle and no copy affordance — the web <c>raw.length === 0</c> branch).
/// </para>
/// </summary>
public sealed partial class MaskedValue : ContentControl, IDisposable
{
    private const string EyeGlyph = "\uE7B3";   // Segoe Fluent "RedEye" — the reveal affordance (web Eye icon).
    private const string HideGlyph = "\uED1A";  // Segoe Fluent "Hide" — the hide affordance (web EyeOff icon).
    private const double IconSize = 14;          // web h-3.5 w-3.5.

    private readonly MaskedValueViewModel _viewModel;
    private readonly MaskedValueDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root;
    private readonly TextBlock _code;
    private readonly TsButton _toggle;
    private readonly DispatcherTimer _autoHideTimer;
    private CopyButton? _copy;

    private bool _opened;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>
    /// Creates a gallery-safe surface bound to the inert reveal-audit sink and the passthrough localizer — the
    /// native analogue of mounting the web component in an isolated host. Production callers use the seam
    /// constructor to wire a real audit endpoint and localizer.
    /// </summary>
    public MaskedValue()
        : this(NoOpRevealAuditSink.Instance, PassthroughLocalizer.Instance)
    {
    }

    /// <summary>Creates the surface over its reveal-audit seam, the i18n facade and diagnostics.</summary>
    /// <param name="audit">The reveal-audit seam (web <c>postRevealAudit</c>); inert by default.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public MaskedValue(IRevealAuditSink audit, ILocalizer localizer, MaskedValueDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(audit);
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new MaskedValueDiagnostics();
        _viewModel = new MaskedValueViewModel(audit, localizer, _diagnostics);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        // web: the masked text is wrapped in <code> so monospace rendering is consistent across all variants.
        _code = new TextBlock
        {
            VerticalAlignment = VerticalAlignment.Center,
            FontFamily = new FontFamily("Consolas"),
            TextWrapping = TextWrapping.Wrap,
        };

        _toggle = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            FontSize = IconSize,
        };
        _toggle.Click += OnToggleClick;

        _root = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 6,
            VerticalAlignment = VerticalAlignment.Center,
        };
        _root.Children.Add(_code);
        _root.Children.Add(_toggle);

        _autoHideTimer = new DispatcherTimer();
        _autoHideTimer.Tick += OnAutoHideTick;

        IsTabStop = false;
        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;

        Render();
    }

    /// <summary>The canonical surface slug (<c>MaskedValue</c>).</summary>
    public static string Slug => MaskedValueRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics / tests).</summary>
    public MaskedValueViewModel ViewModel => _viewModel;

    /// <summary>The raw value to mask (web <c>value</c>); empty renders a muted em-dash with no toggle.</summary>
    public string? Value
    {
        get => _viewModel.Value;
        set => _viewModel.Value = value;
    }

    /// <summary>The masking strategy (web <c>variant</c>).</summary>
    public MaskedValueVariant Variant
    {
        get => _viewModel.Variant;
        set => _viewModel.Variant = value;
    }

    /// <summary>Optional override of the variant's default visible-suffix length (web <c>showLast</c>).</summary>
    public int? ShowLast
    {
        get => _viewModel.ShowLast;
        set => _viewModel.ShowLast = value;
    }

    /// <summary>Whether a copy affordance that copies the cleartext is shown (web <c>copyable</c>).</summary>
    public bool Copyable
    {
        get => _viewModel.Copyable;
        set => _viewModel.Copyable = value;
    }

    /// <summary>Whether each reveal posts the best-effort reveal audit (web <c>auditOnReveal</c>).</summary>
    public bool AuditOnReveal
    {
        get => _viewModel.AuditOnReveal;
        set => _viewModel.AuditOnReveal = value;
    }

    /// <summary>The human-readable accessible name for the surface (web required <c>ariaLabel</c>).</summary>
    public string AriaLabel
    {
        get => _viewModel.AriaLabel;
        set => _viewModel.AriaLabel = value;
    }

    /// <summary>The auto-hide lifetime in milliseconds (web <c>autoHideMs</c>); 0 or less disables auto-hide.</summary>
    public int AutoHideMs
    {
        get => _viewModel.AutoHideMs;
        set => _viewModel.AutoHideMs = value;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _autoHideTimer.Stop();
        _autoHideTimer.Tick -= OnAutoHideTick;
        _toggle.Click -= OnToggleClick;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _copy?.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc />
    protected override AutomationPeer OnCreateAutomationPeer() => new MaskedValueAutomationPeer(this);

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

    private void OnToggleClick(object sender, RoutedEventArgs e) => _viewModel.Toggle();

    private void OnAutoHideTick(object? sender, object e)
    {
        // web: setTimeout(() => setRevealed(false), autoHideMs) — one-shot re-mask.
        _autoHideTimer.Stop();
        _viewModel.Hide();
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
        bool empty = _viewModel.IsEmpty;

        _code.Text = _viewModel.DisplayText;
        _code.Foreground = empty
            ? DisplayTokens.TextMuted
            : (_viewModel.IsRevealed ? DisplayTokens.Accent : DisplayTokens.TextSecondary);

        // web: the empty branch renders no toggle (there is nothing to reveal).
        _toggle.Visibility = _viewModel.ShowToggle ? Visibility.Visible : Visibility.Collapsed;
        _toggle.IconGlyph = _viewModel.ShowEyeOffIcon ? HideGlyph : EyeGlyph;
        AutomationProperties.SetName(_toggle, _viewModel.ToggleLabel);
        ToolTipService.SetToolTip(_toggle, _viewModel.ToggleLabel);

        UpdateCopyButton();

        // web: the wrapping span carries the semantic aria-label so screen readers describe the value without
        // blurting the cleartext.
        AutomationProperties.SetName(this, _viewModel.AriaLabel);

        // web: on reveal, when autoHideMs > 0, a one-shot timer re-masks after the lifetime; a manual hide (or
        // re-mask) clears it.
        if (_viewModel.IsRevealed && _viewModel.AutoHideMs > 0)
        {
            _autoHideTimer.Stop();
            _autoHideTimer.Interval = _viewModel.AutoHide;
            _autoHideTimer.Start();
        }
        else
        {
            _autoHideTimer.Stop();
        }
    }

    private void UpdateCopyButton()
    {
        if (_viewModel.ShowCopy)
        {
            // web: <CopyButton text={raw} iconOnly ariaLabel={t('mask.copy')} /> — copies the cleartext
            // regardless of the mask state, with an accessible name and no visible label.
            if (_copy is null)
            {
                _copy = new CopyButton { IconOnly = true };
                _root.Children.Add(_copy);
            }

            _copy.Text = _viewModel.Raw;
            _copy.AriaLabel = _viewModel.CopyLabel;
            _copy.Visibility = Visibility.Visible;
        }
        else if (_copy is not null)
        {
            _copy.Visibility = Visibility.Collapsed;
        }
    }

    private sealed class MaskedValueAutomationPeer : FrameworkElementAutomationPeer
    {
        public MaskedValueAutomationPeer(MaskedValue owner)
            : base(owner)
        {
        }

        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            if (!string.IsNullOrEmpty(name))
            {
                return name;
            }

            return ((MaskedValue)Owner).ViewModel.AriaLabel;
        }
    }
}
