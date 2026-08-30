/** Maps common gateway point names to the canonical simulator/MES names. */
const POINT_ALIASES: Record<string, string> = {
  temp: 'temperatureCelsius',
  temperature: 'temperatureCelsius',
  temperature_c: 'temperatureCelsius',
  cycle_time: 'cycleTimeSeconds',
  cycle: 'cycleTimeSeconds',
  total_count: 'totalCount',
  good_count: 'goodCount',
  defect_count: 'defectCount',
  status_code: 'status',
};

export function mapGatewayPoints(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.entries(payload).reduce<Record<string, unknown>>((mapped, [key, value]) => {
    mapped[POINT_ALIASES[key] ?? key] = value;
    return mapped;
  }, {});
}
