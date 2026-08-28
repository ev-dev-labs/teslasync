import { useTaskOnboarding } from '../hooks/useTaskOnboarding'
import { TaskOnboardingHint } from './TaskOnboardingHint'

/**
 * Mount point for task-specific onboarding (HELP-01).
 *
 * Renders at most one hint, anchored to the bottom of the viewport and out of
 * the document flow so it cannot reflow the page a user is already reading.
 * `pointer-events-none` on the positioner with `pointer-events-auto` on the
 * card keeps the rest of the page fully clickable around it — the hint is
 * additive, never a modal.
 *
 * Renders nothing (no wrapper, no spacer) when there is no eligible task,
 * which is the common case for every established install.
 */
export function TaskOnboardingHost() {
  const { task, complete, dismiss, optOut } = useTaskOnboarding()
  if (!task) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4"
      data-testid="task-onboarding-host"
    >
      <TaskOnboardingHint
        task={task}
        onComplete={complete}
        onDismiss={dismiss}
        onOptOut={optOut}
        className="pointer-events-auto w-full max-w-xl shadow-e2 backdrop-blur-md"
      />
    </div>
  )
}
