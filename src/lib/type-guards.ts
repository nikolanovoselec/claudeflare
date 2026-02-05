export function isAdminRequest(data: unknown): data is { doId: string } {
  return typeof data === 'object' && data !== null &&
         'doId' in data && typeof (data as any).doId === 'string';
}

export function isBucketNameResponse(data: unknown): data is { bucketName: string | null } {
  return typeof data === 'object' && data !== null && 'bucketName' in data;
}
