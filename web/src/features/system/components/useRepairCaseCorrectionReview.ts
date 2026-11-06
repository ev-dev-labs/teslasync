import { useEffect, useRef, useState } from 'react';
import {
  useApplyRepairCaseCorrection,
  useRepairCaseCorrectionPreview,
  type RepairCase,
  type RepairCaseCorrectionChoice,
  type RepairCaseCorrectionInput,
  type RepairCaseCorrectionPreview,
} from '@/api/hooks/useDataRepair';

interface ReviewedCorrection {
  input: RepairCaseCorrectionInput;
  preview: RepairCaseCorrectionPreview;
  revision: number;
}

export function useRepairCaseCorrectionReview(repairCase: RepairCase, canWrite: boolean) {
  const [review, setReview] = useState<ReviewedCorrection | null>(null);
  const preview = useRepairCaseCorrectionPreview();
  const apply = useApplyRepairCaseCorrection();
  const requestId = useRef(0);
  const inFlight = useRef(false);
  const contextKey = JSON.stringify(repairCase);
  const context = useRef({ key: contextKey, revision: 0, canWrite });
  if (context.current.key !== contextKey) {
    context.current.key = contextKey;
    context.current.revision += 1;
  }
  context.current.canWrite = canWrite;
  useEffect(() => () => { requestId.current += 1; }, []);

  const closeReview = () => {
    requestId.current += 1;
    setReview(null);
    preview.reset();
    apply.reset();
  };
  const requestPreview = (choice: RepairCaseCorrectionChoice) => {
    if (!canWrite || preview.isPending || apply.isPending || inFlight.current) return;
    const input: RepairCaseCorrectionInput = {
      ...choice, case_id: repairCase.id, expected_updated_at: repairCase.updated_at,
    };
    const request = ++requestId.current;
    const revision = context.current.revision;
    preview.reset();
    preview.mutate(input, {
      onSuccess: (result) => {
        if (request !== requestId.current || revision !== context.current.revision || !context.current.canWrite) return;
        setReview({ input: structuredClone(input), preview: structuredClone(result), revision });
      },
    });
  };
  const reviewCurrent = review?.revision === context.current.revision;
  const confirm = () => {
    if (!review || !reviewCurrent || !canWrite || apply.isPending || inFlight.current) return;
    inFlight.current = true;
    apply.mutate(
      { ...review.input, expected_source_hash: review.preview.source_hash },
      { onSuccess: closeReview, onSettled: () => { inFlight.current = false; } },
    );
  };
  return {
    preview: review?.preview ?? null,
    previewPending: preview.isPending,
    previewError: preview.error instanceof Error ? preview.error.message : null,
    applyPending: apply.isPending,
    applyError: apply.error instanceof Error ? apply.error.message : undefined,
    canConfirm: Boolean(canWrite && reviewCurrent),
    requestPreview, confirm, closeReview,
  };
}
