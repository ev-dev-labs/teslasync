import { useCurrentPersonalDevice } from '@/api/hooks/usePersonalDelivery';
import type { PrivateVehicleReviewScope } from '@/components/vehicles';
import { useDataState } from '@/hooks/useDataState';
import { usePersonalBrowser } from '@/hooks/usePersonalBrowser';

export function useReminderBrowser(scope: PrivateVehicleReviewScope['scope']) {
  const browser = usePersonalBrowser();
  const device = useCurrentPersonalDevice(scope, browser.subscription?.endpoint ?? null, browser.generation, true);
  const state = useDataState(device);
  const id = browser.status === 'ready' && state.status === 'ok' && !device.isFetching && device.data?.verified
    ? device.data.id : null;
  return { browser, device, state, id };
}
