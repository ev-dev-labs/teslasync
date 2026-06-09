using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="UnixPermissionTool"/> view — the native port of
/// the web <c>UnixPermissionTool</c>'s hook composition
/// (web/src/features/admin/components/devtools/tools/UnixPermissionTool.tsx). It owns the single piece of
/// local state the web component keeps with <c>useState</c> (<see cref="Octal"/> ← <c>octal</c>),
/// recomputes the permission breakdown through the pure <see cref="UnixPermissionProjection"/> adapter on
/// every edit (web <c>useMemo([octal])</c>), and exposes the mutually-exclusive <see cref="State"/>
/// (empty ↔ resolved) the view renders. Every one of the component's strings resolves through the i18n
/// facade (web <c>t(...)</c>): the card title / description (web <c>t('Unix Perm')</c> /
/// <c>t('Unix Perm Desc')</c>), the two field labels (web <c>t('Octal Perm')</c> / <c>t('Presets')</c>),
/// the three column headers (web <c>t('Owner')</c> / <c>t('Group')</c> / <c>t('Other')</c>) and the copy
/// affordance, plus the native-only empty-state and screen-reader summary strings the platform's "never a
/// blank box" + accessibility contract requires. The view is a thin renderer over these properties; it
/// raises <see cref="PropertyChanged"/> synchronously from the edit that triggered it. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class UnixPermissionToolViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;

    private string _octal;
    private PermissionBreakdown? _breakdown;

    /// <summary>Creates the holder over its localizer, seeded with the default octal mode ("755").</summary>
    /// <param name="localizer">The i18n facade resolving every label (web <c>useTranslation</c>).</param>
    public UnixPermissionToolViewModel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _octal = UnixPermissionPresets.Default;
        Recompute();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The typed octal mode (web <c>octal</c> state, default "755"). Setting it recomputes the breakdown.</summary>
    public string Octal
    {
        get => _octal;
        set
        {
            string next = value ?? string.Empty;
            if (string.Equals(_octal, next, StringComparison.Ordinal))
            {
                return;
            }

            _octal = next;
            Raise();
            Recompute();
        }
    }

    /// <summary>The resolved owner / group / other breakdown, or <c>null</c> when the octal is invalid (web <c>symbolic</c>).</summary>
    public PermissionBreakdown? Breakdown => _breakdown;

    /// <summary>The current mutually-exclusive surface state (empty ↔ resolved).</summary>
    public UnixPermissionState State =>
        _breakdown is null ? UnixPermissionState.Empty : UnixPermissionState.Resolved;

    /// <summary>True once a valid octal has produced a breakdown (the grid + symbolic row are shown).</summary>
    public bool HasBreakdown => _breakdown is not null;

    /// <summary>True when there is no valid octal yet (the friendly empty hint is shown instead of the grid).</summary>
    public bool IsEmpty => _breakdown is null;

    /// <summary>
    /// True when the field holds text that is not a valid three-digit octal — a non-blocking validity
    /// affordance the view surfaces to Narrator (via the input's error state). The web folds empty and
    /// malformed input into the same "no grid" branch; this only distinguishes them for assistive tech and
    /// never blocks input.
    /// </summary>
    public bool IsInvalidInput => _breakdown is null && _octal.Trim().Length > 0;

    /// <summary>The full nine-character symbolic string used by the code row + clipboard (web <c>symbolic</c>); empty when unresolved.</summary>
    public string Symbolic => _breakdown?.Symbolic ?? string.Empty;

    /// <summary>The mode presets offered by the picker (web <c>presetOptions</c>).</summary>
    public IReadOnlyList<PermissionPreset> Presets { get; } = UnixPermissionPresets.All;

    /// <summary>
    /// The preset whose value equals the current octal, or <c>null</c> when the typed value matches no
    /// preset — the native mirror of the web controlled <c>&lt;Select value={octal}&gt;</c>.
    /// </summary>
    public PermissionPreset? SelectedPreset
    {
        get
        {
            foreach (PermissionPreset preset in UnixPermissionPresets.All)
            {
                if (string.Equals(preset.Value, _octal, StringComparison.Ordinal))
                {
                    return preset;
                }
            }

            return null;
        }
    }

    /// <summary>Localized card title (web <c>t('Unix Perm')</c>).</summary>
    public string Title => _localizer.GetString("translation.Unix Perm", "Unix Perm");

    /// <summary>Localized card description (web <c>t('Unix Perm Desc')</c>).</summary>
    public string Description => _localizer.GetString("translation.Unix Perm Desc", "Unix Perm Desc");

    /// <summary>Localized octal-field label (web <c>t('Octal Perm')</c>).</summary>
    public string OctalLabel => _localizer.GetString("translation.Octal Perm", "Octal Perm");

    /// <summary>Localized preset-field label (web <c>t('Presets')</c>).</summary>
    public string PresetsLabel => _localizer.GetString("translation.Presets", "Presets");

    /// <summary>Localized owner column header (web <c>t('Owner')</c>).</summary>
    public string OwnerLabel => _localizer.GetString("translation.Owner", "Owner");

    /// <summary>Localized group column header (web <c>t('Group')</c>).</summary>
    public string GroupLabel => _localizer.GetString("translation.Group", "Group");

    /// <summary>Localized other column header (web <c>t('Other')</c>).</summary>
    public string OtherLabel => _localizer.GetString("translation.Other", "Other");

    /// <summary>Localized copy-button idle label (web <c>CopyButton</c> default).</summary>
    public string CopyLabel => _localizer.GetString("common.copyButton.copy", "Copy");

    /// <summary>Localized copy-button confirmation label (web <c>CopyButton</c> copied state).</summary>
    public string CopiedLabel => _localizer.GetString("common.copyButton.copied", "Copied");

    /// <summary>The octal field's example text — a dimensionless sample, not localized (the web field's example "755").</summary>
    public string OctalHint { get; } = UnixPermissionPresets.Default;

    /// <summary>Localized empty-state heading shown in place of the grid before a valid octal is entered.</summary>
    public string EmptyTitle => _localizer.GetString("unixPerm.empty.title", "Enter an octal mode");

    /// <summary>Localized empty-state message shown in place of the grid (never a blank box).</summary>
    public string EmptyMessage =>
        _localizer.GetString(
            "unixPerm.empty.message",
            "Type a three-digit octal mode (each digit 0-7) or pick a preset to see the symbolic permissions.");

    /// <summary>
    /// A concise, localized live-region summary announced when the breakdown resolves (and cleared when
    /// empty), so a Narrator user hears the result of an edit without scrubbing every cell. Built from the
    /// octal mode and its symbolic string. Null while <see cref="IsEmpty"/>.
    /// </summary>
    public string? ResultAnnouncement
    {
        get
        {
            PermissionBreakdown? breakdown = _breakdown;
            if (breakdown is null)
            {
                return null;
            }

            return string.Format(
                CultureInfo.CurrentCulture,
                _localizer.GetString("unixPerm.summary", "{0} = {1}"),
                _octal.Trim(),
                breakdown.Symbolic);
        }
    }

    /// <summary>Narrator name for the octal text field.</summary>
    public string OctalAccessibleName => OctalLabel;

    /// <summary>Narrator name for the preset picker.</summary>
    public string PresetsAccessibleName => PresetsLabel;

    /// <summary>Narrator name for the copy-output button.</summary>
    public string CopyAccessibleName => CopyLabel;

    private void Recompute()
    {
        _breakdown = UnixPermissionProjection.Project(_octal);
        Raise(nameof(Breakdown));
        Raise(nameof(State));
        Raise(nameof(HasBreakdown));
        Raise(nameof(IsEmpty));
        Raise(nameof(IsInvalidInput));
        Raise(nameof(Symbolic));
        Raise(nameof(SelectedPreset));
        Raise(nameof(ResultAnnouncement));
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
