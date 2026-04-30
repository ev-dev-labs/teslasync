import { useState, useCallback, useMemo } from 'react';
import type { DataAnnotation, AnnotationCategory } from '@/types/annotations';

const STORAGE_KEY = 'teslasync-annotations';

function loadAnnotations(): DataAnnotation[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveAnnotations(annotations: DataAnnotation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(annotations));
  } catch {
    // localStorage quota exceeded or unavailable — silently ignore
  }
}

export function useAnnotations(context: string, vehicleId?: number | null) {
  const [allAnnotations, setAllAnnotations] = useState<DataAnnotation[]>(loadAnnotations);

  const annotations = useMemo(
    () =>
      allAnnotations.filter(
        (a) =>
          a.context === context &&
          (vehicleId == null || a.vehicleId === vehicleId),
      ),
    [allAnnotations, context, vehicleId],
  );

  const addAnnotation = useCallback(
    (
      timestamp: string,
      label: string,
      category: AnnotationCategory = 'milestone',
      description?: string,
    ): DataAnnotation => {
      const annotation: DataAnnotation = {
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp,
        label,
        description,
        category,
        context,
        vehicleId: vehicleId ?? undefined,
        createdAt: new Date().toISOString(),
      };
      setAllAnnotations((prev) => {
        const updated = [...prev, annotation];
        saveAnnotations(updated);
        return updated;
      });
      return annotation;
    },
    [context, vehicleId],
  );

  const removeAnnotation = useCallback((id: string) => {
    setAllAnnotations((prev) => {
      const updated = prev.filter((a) => a.id !== id);
      saveAnnotations(updated);
      return updated;
    });
  }, []);

  const updateAnnotation = useCallback(
    (
      id: string,
      updates: Partial<Pick<DataAnnotation, 'label' | 'description' | 'category'>>,
    ) => {
      setAllAnnotations((prev) => {
        const updated = prev.map((a) =>
          a.id === id ? { ...a, ...updates } : a,
        );
        saveAnnotations(updated);
        return updated;
      });
    },
    [],
  );

  return { annotations, addAnnotation, removeAnnotation, updateAnnotation };
}
