import { useLayoutEffect, type ReactNode } from 'react';
import { useDateFormat } from '@/hooks/useDateFormat';
import { setWorkspaceDisplayTimezone } from '@/lib/dateFormat';
import { WorkspaceDateFormatContext } from './WorkspaceDateFormatContext';

export function WorkspaceDateFormatProvider({ children }: { children: ReactNode }) {
  const { opts, tz } = useDateFormat();
  useLayoutEffect(() => {
    setWorkspaceDisplayTimezone(tz);
    return () => setWorkspaceDisplayTimezone();
  }, [tz]);

  return <WorkspaceDateFormatContext.Provider value={opts}>{children}</WorkspaceDateFormatContext.Provider>;
}
