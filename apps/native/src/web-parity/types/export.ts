export interface ExportJob {
  id: string;
  format: string;
  vehicleId: string;
  fsmState: string;
  filePath?: string;
  fileSize?: number;
  failedReason?: string;
  createdAt: string;
  completedAt?: string;
}
