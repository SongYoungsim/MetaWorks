export function actionDisplayNumbers(year: number, firstSequence: number, count: number): string[] {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new RangeError("올바르지 않은 연도입니다.");
  if (!Number.isInteger(firstSequence) || firstSequence < 1) throw new RangeError("올바르지 않은 시작 순번입니다.");
  if (!Number.isInteger(count) || count < 1 || count > 200) throw new RangeError("올바르지 않은 건수입니다.");
  return Array.from({ length: count }, (_, index) =>
    `AC-${year}-${String(firstSequence + index).padStart(4, "0")}`);
}
