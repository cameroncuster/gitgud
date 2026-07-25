export function initialProblemVisibleCount(rowBatchSize: number | null): number {
  return rowBatchSize && rowBatchSize > 0 ? rowBatchSize : Number.POSITIVE_INFINITY;
}

export function nextProblemVisibleCount(
  currentCount: number,
  totalCount: number,
  rowBatchSize: number
): number {
  return Math.min(currentCount + rowBatchSize, totalCount);
}

export function nextProblemBatchCount(
  currentCount: number,
  totalCount: number,
  rowBatchSize: number
): number {
  return Math.min(rowBatchSize, Math.max(totalCount - currentCount, 0));
}
