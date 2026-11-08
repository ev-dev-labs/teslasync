import { domAnimation, LazyMotion } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';

export function MotionProvider({ children }: { children: ReactNode }) {
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  const [features, setFeatures] = useState(domAnimation);

  useEffect(() => {
    let active = true;
    void import('./features')
      .then(({ domMax }) => { if (active) setFeatures(domMax); })
      .catch(error => { if (active) setFailure({ error }); });
    return () => { active = false; };
  }, []);

  if (failure) throw failure.error;

  return <LazyMotion features={features}>{children}</LazyMotion>;
}
