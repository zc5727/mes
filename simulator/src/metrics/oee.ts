import { OeeMetrics } from "../types";

export interface OeeInput {
  plannedTimeSeconds: number;
  operatingTimeSeconds: number;
  idealCycleTimeSeconds: number;
  totalCount: number;
  goodCount: number;
}

const clamp = (value: number): number => Math.min(1, Math.max(0, value));
const round = (value: number): number => Number(value.toFixed(6));

export function calculateOee(input: OeeInput): OeeMetrics {
  const defectCount = Math.max(0, input.totalCount - input.goodCount);
  const availability = input.plannedTimeSeconds <= 0
    ? 0
    : clamp(input.operatingTimeSeconds / input.plannedTimeSeconds);
  const performance = input.operatingTimeSeconds <= 0
    ? 0
    : clamp((input.idealCycleTimeSeconds * input.totalCount) / input.operatingTimeSeconds);
  const quality = input.totalCount <= 0 ? 1 : clamp(input.goodCount / input.totalCount);

  return {
    availability: round(availability),
    performance: round(performance),
    quality: round(quality),
    oee: round(availability * performance * quality),
    plannedTimeSeconds: input.plannedTimeSeconds,
    operatingTimeSeconds: input.operatingTimeSeconds,
    totalCount: input.totalCount,
    goodCount: input.goodCount,
    defectCount,
  };
}
