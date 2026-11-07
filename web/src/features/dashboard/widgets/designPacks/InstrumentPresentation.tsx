import type { ReactNode } from 'react';
import { usePackModule, usePackPresentation } from './PackBoundary';
import { PACK_APPEARANCES } from './types';
import type { InstrumentPresentationProps } from './families/Instrument.types';

const loadInstrument = () => import('./families/InstrumentLayout');

interface InstrumentProps extends Omit<InstrumentPresentationProps, 'appearance'> {
  children: ReactNode;
}

export default function InstrumentPresentation({ children, ...props }: InstrumentProps) {
  const packId = usePackPresentation();
  const Presentation = usePackModule(packId, packId === 'classic' ? null : loadInstrument);
  return Presentation && packId !== 'classic'
    ? <Presentation {...props} appearance={PACK_APPEARANCES[packId]} />
    : children;
}
