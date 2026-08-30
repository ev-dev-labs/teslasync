import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { VisuallyHidden } from '@/components/a11y';

interface StatusBarContextValue {
  openId: string | null;
  setOpenId: Dispatch<SetStateAction<string | null>>;
  announce: (message: string) => void;
}

const StatusBarContext = createContext<StatusBarContextValue | null>(null);

interface StatusBarProviderProps {
  children: ReactNode;
  announcementLabel: string;
}

export function StatusBarProvider({
  children,
  announcementLabel,
}: StatusBarProviderProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const announcementSequence = useRef(0);

  const announce = useCallback((message: string) => {
    announcementSequence.current += 1;
    const repeatMarker = '\u200B'.repeat((announcementSequence.current % 2) + 1);
    setAnnouncement(`${message}${repeatMarker}`);
  }, []);

  const value = useMemo(
    () => ({ openId, setOpenId, announce }),
    [announce, openId],
  );

  return (
    <StatusBarContext.Provider value={value}>
      {children}
      <VisuallyHidden
        as="div"
        liveRegion
        aria-label={announcementLabel}
        data-testid="status-bar-live-region"
      >
        {announcement}
      </VisuallyHidden>
    </StatusBarContext.Provider>
  );
}

export function useStatusBarPopover(id: string) {
  const context = useContext(StatusBarContext);
  const [localOpen, setLocalOpen] = useState(false);
  const coordinatedOpenId = context?.openId;
  const setCoordinatedOpenId = context?.setOpenId;
  const open = context ? coordinatedOpenId === id : localOpen;

  useEffect(
    () => () => {
      setCoordinatedOpenId?.((current) => (current === id ? null : current));
    },
    [id, setCoordinatedOpenId],
  );

  const setOpen = useCallback(
    (next: boolean) => {
      if (setCoordinatedOpenId) {
        setCoordinatedOpenId((current) => {
          if (next) return id;
          return current === id ? null : current;
        });
      } else {
        setLocalOpen(next);
      }
    },
    [id, setCoordinatedOpenId],
  );

  const toggle = useCallback(() => setOpen(!open), [open, setOpen]);
  const close = useCallback(() => setOpen(false), [setOpen]);

  return { open, setOpen, toggle, close };
}

export function useStatusBarAnnouncer() {
  return useContext(StatusBarContext)?.announce;
}
