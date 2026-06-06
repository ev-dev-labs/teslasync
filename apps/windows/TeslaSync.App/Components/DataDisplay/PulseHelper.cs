using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media.Animation;

namespace TeslaSync.App.Components.DataDisplay;

/// <summary>
/// Attaches a gentle, infinitely-repeating opacity pulse to an element (used by the
/// live / fetching indicators). Callers gate this on a reduce-motion check, so the
/// helper itself stays motion-unconditional and trivially testable by inspection.
/// </summary>
internal static class PulseHelper
{
    /// <summary>Start a looping fade pulse on <paramref name="target"/>.</summary>
    public static void Attach(FrameworkElement target)
    {
        var animation = new DoubleAnimation
        {
            From = 1.0,
            To = 0.35,
            Duration = new Duration(TimeSpan.FromMilliseconds(900)),
            AutoReverse = true,
            RepeatBehavior = RepeatBehavior.Forever,
            EnableDependentAnimation = true,
        };

        Storyboard.SetTarget(animation, target);
        Storyboard.SetTargetProperty(animation, "Opacity");

        var storyboard = new Storyboard();
        storyboard.Children.Add(animation);

        if (target.IsLoaded)
        {
            storyboard.Begin();
        }
        else
        {
            target.Loaded += (_, _) => storyboard.Begin();
        }
    }
}
