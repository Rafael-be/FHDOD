export const HOSPITAL_TIME_ZONE = "America/Sao_Paulo";

const weekdayByName: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export type HospitalShiftTime = {
  dayOfWeek: number;
  previousDayOfWeek: number;
  localTime: string;
};

export function hospitalShiftTime(now: Date, timeZone = HOSPITAL_TIME_ZONE): HospitalShiftTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = weekdayByName[parts.find((part) => part.type === "weekday")?.value ?? ""];
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (!weekday || !hour || !minute) throw new Error("Não foi possível determinar o horário local hospitalar.");
  return {
    dayOfWeek: weekday,
    previousDayOfWeek: weekday === 1 ? 7 : weekday - 1,
    localTime: `${hour}:${minute}`,
  };
}
