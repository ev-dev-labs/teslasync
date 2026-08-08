import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDashcamDb } from './useDashcamDb';
import { useMutationToast } from '@/api/hooks/_toastHelpers';
import { buildClipId, detectSourceFromPath, parseClipFilename, parseEventSidecar } from '../lib/clipParsing';
import { probeVideoDuration } from '../lib/clipMetadata';
import { deriveMetadataCandidates, mergeEventCandidates } from '../lib/eventDetection';
import type { ClipRecord, DashcamSettings } from '../lib/types';

export const dashcamKeys = {
  clips: ['dashcam', 'clips'] as const,
};

/** Lists every locally-cataloged clip, newest first. */
export function useClipCatalog() {
  const { db } = useDashcamDb();
  return useQuery({
    queryKey: dashcamKeys.clips,
    queryFn: () => db.listClips(),
    staleTime: Infinity,
  });
}

export interface ImportClipsInput {
  files: File[];
  /** Optional Tesla `event.json` sidecar applied to every clip in this import batch. */
  sidecarFile: File | null;
  vehicleId: number | null;
  settings: DashcamSettings;
}

async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text);
}

async function buildClipRecord(file: File, sidecarRaw: unknown, vehicleId: number | null, settings: DashcamSettings): Promise<ClipRecord> {
  const parsedName = parseClipFilename(file.name);
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || null;
  const source = detectSourceFromPath(relativePath);
  const eventSidecar = parseEventSidecar(sidecarRaw);
  const id = buildClipId(file.name, file.size, file.lastModified);

  const objectUrl = URL.createObjectURL(file);
  let durationSeconds: number | null = null;
  try {
    durationSeconds = await probeVideoDuration(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  const nowIso = new Date().toISOString();
  const eventCandidates = settings.autoDetectMetadataEvents
    ? mergeEventCandidates(deriveMetadataCandidates({ source, eventSidecar }))
    : [];

  return {
    id,
    fileName: file.name,
    cameraPosition: parsedName.camera,
    cameraRaw: parsedName.cameraRaw,
    source,
    capturedAtRaw: parsedName.capturedAtRaw,
    durationSeconds,
    sizeBytes: file.size,
    mimeType: file.type || 'video/mp4',
    blob: file,
    eventSidecar,
    motion: { status: 'not_run' },
    eventCandidates,
    redactions: [],
    vehicleId,
    notes: '',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/** Imports one or more clip files (+ optional shared event.json) into the local catalog. */
export function useImportClips() {
  const { db } = useDashcamDb();
  const qc = useQueryClient();
  const { success, error } = useMutationToast();

  return useMutation({
    mutationFn: async (input: ImportClipsInput): Promise<ClipRecord[]> => {
      const sidecarRaw = input.sidecarFile ? await readJsonFile(input.sidecarFile) : null;
      const records: ClipRecord[] = [];
      for (const file of input.files) {
        const record = await buildClipRecord(file, sidecarRaw, input.vehicleId, input.settings);
        await db.putClip(record);
        records.push(record);
      }
      return records;
    },
    onSuccess: (records) => {
      qc.invalidateQueries({ queryKey: dashcamKeys.clips });
      success(
        'dashcam.import.success',
        '{{count}} clip(s) imported locally',
        { count: records.length },
      );
    },
    onError: (e) => error(e, 'dashcam.import.error', 'Failed to import clips'),
  });
}

/** Persists an updated clip record (redactions, notes, event candidates, motion score, ...). */
export function useUpdateClip() {
  const { db } = useDashcamDb();
  const qc = useQueryClient();
  const { error } = useMutationToast();

  return useMutation({
    mutationFn: async (clip: ClipRecord) => {
      const updated: ClipRecord = { ...clip, updatedAt: new Date().toISOString() };
      await db.putClip(updated);
      return updated;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: dashcamKeys.clips }),
    onError: (e) => error(e, 'dashcam.update.error', 'Failed to save clip changes'),
  });
}

/** Removes a clip (and its blob, redactions, and event data) from the local catalog. */
export function useDeleteClip() {
  const { db } = useDashcamDb();
  const qc = useQueryClient();
  const { success, error } = useMutationToast();

  return useMutation({
    mutationFn: (id: string) => db.deleteClip(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: dashcamKeys.clips });
      success('dashcam.delete.success', 'Clip deleted');
    },
    onError: (e) => error(e, 'dashcam.delete.error', 'Failed to delete clip'),
  });
}
