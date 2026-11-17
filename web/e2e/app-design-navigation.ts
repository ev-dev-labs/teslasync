import type { Page } from '@playwright/test';

type NavigationWindow = Window & {
  __teslasyncNavigateAfterReads?: (destination: string | null) => Promise<void>;
};

function installRequestTracker() {
  const pending = new Set<Promise<ArrayBuffer>>();
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const result = originalFetch.call(window, input, init);
    const completed = result.then(response => response.clone().arrayBuffer());
    pending.add(completed);
    const finish = () => { pending.delete(completed); };
    void completed.then(finish, finish);
    return result;
  };
  (window as NavigationWindow).__teslasyncNavigateAfterReads = async destination => {
    while (pending.size) await Promise.allSettled([...pending]);
    // Keep the idle check and trusted beforeunload in the same browser turn.
    if (destination === null) window.location.reload();
    else window.location.assign(destination);
  };
}

export async function installAppDesignNavigation(page: Page): Promise<void> {
  await page.addInitScript(installRequestTracker);
  await page.evaluate(installRequestTracker);
}

export async function navigateAppDesignDocument(page: Page, destination: string | null): Promise<void> {
  await Promise.all([
    page.waitForEvent('domcontentloaded'),
    page.evaluate(destination => {
      const navigate = (window as NavigationWindow).__teslasyncNavigateAfterReads;
      if (!navigate) throw new Error('Application navigation tracker is missing');
      setTimeout(() => { void navigate(destination); }, 0);
    }, destination),
  ]);
  await page.waitForLoadState('load');
}
