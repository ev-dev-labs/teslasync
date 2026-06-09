using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="KioskOverlay"/> view — the native port of the web
/// <see cref="KioskOverlay"/> component's local state (web/src/features/dashboard/components/KioskOverlay.tsx).
/// The web component binds two hooks (<c>useTranslation</c>, <c>useDateFormat</c>) and reacts to its props plus
/// a per-second clock tick; this holder mirrors that by projecting the current <see cref="Inputs"/> at the
/// injected clock's instant through <see cref="KioskOverlayProjection"/> into the immutable
/// <see cref="Presentation"/>. The prop setters (<see cref="Update"/>, <see cref="SetDimmed"/>, …) re-project
/// on change; <see cref="Tick"/> re-projects the clock readout; <see cref="Reload"/> re-resolves every label
/// after the active language changes (the native analogue of react-i18next re-rendering). Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class KioskOverlayViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private KioskOverlayInputs _inputs;
    private KioskOverlayPresentation _presentation;

    /// <summary>
    /// Creates the holder over its localizer, an optional initial input snapshot (defaults to the idle
    /// baseline) and an optional clock (defaults to <see cref="DateTimeOffset.Now"/>).
    /// </summary>
    public KioskOverlayViewModel(
        ILocalizer localizer,
        KioskOverlayInputs? inputs = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _inputs = inputs ?? KioskOverlayInputs.Default;
        _presentation = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current input snapshot (web props).</summary>
    public KioskOverlayInputs Inputs => _inputs;

    /// <summary>The current render-ready presentation snapshot.</summary>
    public KioskOverlayPresentation Presentation
    {
        get => _presentation;
        private set
        {
            _presentation = value;
            Raise(nameof(Presentation));
            Raise(nameof(ExitAriaLabel));
            Raise(nameof(ExitButtonLabel));
            Raise(nameof(RegionName));
        }
    }

    /// <summary>The localized Narrator label for the exit affordance.</summary>
    public string ExitAriaLabel => _presentation.ExitAriaLabel;

    /// <summary>The localized visible label for the exit affordance.</summary>
    public string ExitButtonLabel => _presentation.ExitButtonLabel;

    /// <summary>The localized accessibility landmark name for the whole overlay.</summary>
    public string RegionName => _presentation.RegionName;

    /// <summary>Replace the whole input snapshot (web props change) and re-project.</summary>
    public void Update(KioskOverlayInputs inputs)
    {
        ArgumentNullException.ThrowIfNull(inputs);
        if (_inputs == inputs)
        {
            return;
        }

        _inputs = inputs;
        Presentation = Project();
    }

    /// <summary>Replace the active configuration (web <c>config</c> prop) and re-project.</summary>
    public void SetConfig(KioskOverlayConfig config)
    {
        ArgumentNullException.ThrowIfNull(config);
        Update(_inputs with { Config = config });
    }

    /// <summary>Set the burn-in dim flag (web <c>isDimmed</c> prop) and re-project.</summary>
    public void SetDimmed(bool isDimmed) => Update(_inputs with { IsDimmed = isDimmed });

    /// <summary>Set the cursor-auto-hide flag (web <c>isCursorHidden</c> prop) and re-project.</summary>
    public void SetCursorHidden(bool isCursorHidden) => Update(_inputs with { IsCursorHidden = isCursorHidden });

    /// <summary>Set the dashboard rotation position (web <c>dashboardCount</c> / <c>currentIndex</c>) and re-project.</summary>
    public void SetRotation(int dashboardCount, int currentIndex) =>
        Update(_inputs with { DashboardCount = dashboardCount, CurrentIndex = currentIndex });

    /// <summary>
    /// Re-project at the current clock instant — the native analogue of the web 1-second clock tick. Always
    /// raises a change for the clock readout so the view repaints the time.
    /// </summary>
    public void Tick() => Presentation = Project();

    /// <summary>
    /// Re-resolve every label from the localizer and re-project — the native analogue of react-i18next
    /// re-rendering after the active language changes. Raises change notifications so the view re-renders
    /// without being reconstructed.
    /// </summary>
    public void Reload() => Presentation = Project();

    private KioskOverlayPresentation Project() =>
        KioskOverlayProjection.Project(_inputs, _clock(), _localizer);

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
