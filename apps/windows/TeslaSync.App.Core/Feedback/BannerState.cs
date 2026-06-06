using System.ComponentModel;

namespace TeslaSync.App.Core.Feedback;

/// <summary>
/// UI-thread-free visibility/dismiss model shared by the conditional banner
/// family (offline, stale-data, re-auth, rate-limit, maintenance, …). A banner
/// is shown only while its triggering <see cref="Condition"/> holds AND the user
/// has not dismissed it. Re-arming (condition flips false then true again) clears
/// a non-sticky dismissal so a fresh occurrence is announced again.
/// </summary>
public sealed class BannerState : INotifyPropertyChanged
{
    private readonly bool _sticky;
    private bool _condition;
    private bool _dismissed;

    /// <param name="sticky">
    /// When true a dismissal persists across condition re-arming (e.g. a cookie
    /// consent the user already answered). When false a dismissal is cleared the
    /// next time the condition re-arms.
    /// </param>
    public BannerState(bool sticky = false) => _sticky = sticky;

    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Whether the triggering condition currently holds.</summary>
    public bool Condition
    {
        get => _condition;
        set
        {
            if (_condition == value)
            {
                return;
            }

            // Re-arming a non-sticky banner clears a stale dismissal.
            if (value && !_condition && !_sticky && _dismissed)
            {
                _dismissed = false;
                Raise(nameof(IsDismissed));
            }

            _condition = value;
            Raise(nameof(Condition));
            Raise(nameof(IsVisible));
        }
    }

    /// <summary>Whether the user has dismissed the banner.</summary>
    public bool IsDismissed
    {
        get => _dismissed;
        private set
        {
            if (_dismissed == value)
            {
                return;
            }

            _dismissed = value;
            Raise(nameof(IsDismissed));
            Raise(nameof(IsVisible));
        }
    }

    /// <summary>The banner is visible only while triggered and not dismissed.</summary>
    public bool IsVisible => _condition && !_dismissed;

    /// <summary>Dismiss the banner (hides it until the condition re-arms, unless sticky).</summary>
    public void Dismiss() => IsDismissed = true;

    /// <summary>Clear a dismissal so the banner can show again.</summary>
    public void Reset() => IsDismissed = false;

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
