import { useEffect, useState, type RefObject } from 'react';

const INITIAL_GEOMETRY = { ground: 177, front: 90, rear: 480, unitX: 1, unitY: 1 };

export function useVehicleStudioGeometry(studioRef: RefObject<HTMLDivElement>) {
  const [geometry, setGeometry] = useState(INITIAL_GEOMETRY);

  useEffect(() => {
    const studio = studioRef.current;
    const twin = studio?.querySelector<HTMLElement>('[data-vehicle-twin]');
    if (!studio || !twin) return;
    const measure = () => {
      const frame = studio.getBoundingClientRect();
      const car = twin.getBoundingClientRect();
      if (frame.width <= 0 || frame.height <= 0 || car.width <= 0) return;
      const unit = car.width / 560;
      const unitX = unit * 560 / frame.width;
      const unitY = unit * 200 / frame.height;
      const next = {
        ground: (car.top - frame.top + 211 * unit) * 200 / frame.height,
        front: (car.left - frame.left + (43 - 42) * unit) * 560 / frame.width,
        rear: (car.left - frame.left + (556 + 12) * unit) * 560 / frame.width,
        unitX,
        unitY,
      };
      setGeometry(previous => Object.keys(next).every(key =>
        previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(studio);
    observer.observe(twin);
    return () => observer.disconnect();
  }, [studioRef]);

  return geometry;
}
