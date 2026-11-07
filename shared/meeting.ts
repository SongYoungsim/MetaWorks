export const ISO_DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export function canDeleteMeeting(input: {
  status: "draft" | "published";
  clerkId: number;
  userId: number;
  isClerk: boolean;
  isAdmin: boolean;
  linkedActionCount: number;
}): boolean {
  if (input.linkedActionCount > 0) return false;
  return input.status === "draft"
    ? input.isClerk && input.clerkId === input.userId
    : input.isAdmin;
}

/** 등록된 회의록 번호(MT-YYYYMMDD-NN)의 다음 값을 계산한다. */
export function nextMeetingDisplayNo(meetingDate: string, existing: Array<string | null>): string {
  const prefix = "MT-" + meetingDate.replaceAll("-", "");
  const sequence = existing.reduce((max, displayNo) => {
    if (!displayNo?.startsWith(prefix + "-")) return max;
    const value = Number(displayNo.slice(prefix.length + 1));
    return Number.isInteger(value) && value > 0 ? Math.max(max, value) : max;
  }, 0) + 1;
  return prefix + "-" + String(sequence).padStart(2, "0");
}
