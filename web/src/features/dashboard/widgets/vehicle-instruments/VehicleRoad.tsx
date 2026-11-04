import { useId, type RefObject } from 'react';
import { cn } from '@/lib/cn';
import { useVehicleStudioGeometry } from './useVehicleStudioGeometry';

interface VehicleRoadProps {
  studioRef: RefObject<HTMLDivElement>;
  driving: boolean;
  lightsOn: boolean;
}

export default function VehicleRoad({ studioRef, driving, lightsOn }: VehicleRoadProps) {
  const id = useId().replace(/:/g, '');
  const asphalt = `road-asphalt-${id}`;
  const grain = `road-grain-${id}`;
  const clip = `road-clip-${id}`;
  const headlight = `road-headlight-${id}`;
  const taillight = `road-taillight-${id}`;
  const geometry = useVehicleStudioGeometry(studioRef);

  return (
    <svg viewBox="0 0 560 200" preserveAspectRatio="none" aria-hidden="true"
      className="widget-road-strip pointer-events-none absolute inset-0 h-full w-full">
      <defs>
        <linearGradient id={asphalt} gradientUnits="userSpaceOnUse" x1="0" y1="136" x2="0" y2="200">
          <stop className="widget-road-asphalt-stop" offset="0" stopOpacity="0" />
          <stop className="widget-road-asphalt-stop" offset=".28" stopOpacity=".5" />
          <stop className="widget-road-asphalt-stop" offset=".72" stopOpacity=".85" />
          <stop className="widget-road-asphalt-stop" offset="1" stopOpacity="0" />
        </linearGradient>
        <pattern id={grain} width="48" height="16" patternUnits="userSpaceOnUse">
          <path d="M4 3h1 M16 12h2 M31 6h1 M43 14h1 M24 1h1" stroke="currentColor" strokeWidth=".7" />
        </pattern>
        <clipPath id={clip}><path d="M48 136H512L564 210H-4Z" /></clipPath>
        <radialGradient id={headlight}>
          <stop className="widget-road-headlight-stop" offset="0" stopOpacity=".36" />
          <stop className="widget-road-headlight-stop" offset=".4" stopOpacity=".16" />
          <stop className="widget-road-headlight-stop" offset="1" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={taillight}>
          <stop className="widget-road-taillight-stop" offset="0" stopOpacity=".42" />
          <stop className="widget-road-taillight-stop" offset=".45" stopOpacity=".16" />
          <stop className="widget-road-taillight-stop" offset="1" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g transform={`translate(0 ${geometry.ground - 177})`}>
        <path data-vehicle-road-surface="" d="M48 136H512L564 210H-4Z" fill={`url(#${asphalt})`} />
        <g clipPath={`url(#${clip})`}>
          <g className={cn('widget-road-grain', driving && 'widget-state-motion widget-road-grain-motion')}>
            <rect x="-48" y="136" width="656" height="74" fill={`url(#${grain})`} />
          </g>
        </g>
        <path className="widget-road-edge" d="M34 145H526" fill="none" />
        {driving && (
          <>
            <path data-testid="vehicle-road-far-motion"
              className="widget-state-motion widget-road-motion widget-road-far-motion"
              d="M536 153H24" stroke="currentColor" strokeWidth="1" strokeDasharray="16 40" fill="none" />
            <path data-testid="vehicle-road-motion"
              className="widget-state-motion widget-road-motion widget-road-near-motion"
              d="M536 196H24" stroke="currentColor" strokeWidth="3" strokeDasharray="48 64" strokeLinecap="round" fill="none" />
          </>
        )}
        {driving && lightsOn && (
          <g data-vehicle-road-lighting="">
            <ellipse className="widget-road-headlight-pool" cx={geometry.front} cy="175"
              rx={105 * geometry.unitX} ry={17 * geometry.unitY} fill={`url(#${headlight})`} />
            <ellipse className="widget-road-taillight-pool" cx={geometry.rear} cy="177"
              rx={38 * geometry.unitX} ry={8 * geometry.unitY} fill={`url(#${taillight})`} />
          </g>
        )}
      </g>
    </svg>
  );
}
