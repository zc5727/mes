import { NetworkSimulationOptions, SimulationMessage } from "../types";

interface PendingMessage {
  deliverAtMs: number;
  sequence: number;
  message: SimulationMessage;
}

/** Deterministic in-memory network impairment layer for replay and resilience tests. */
export class NetworkSimulator {
  private readonly latencyMs: number;
  private readonly duplicateRate: number;
  private readonly dropRate: number;
  private random: () => number;
  private readonly seed?: number;
  private readonly pending: PendingMessage[] = [];
  private sequence = 0;

  public constructor(options: NetworkSimulationOptions = {}, random: () => number = Math.random) {
    this.latencyMs = validateRateOrLatency(options.latencyMs ?? 0, "latencyMs", false);
    this.duplicateRate = validateRateOrLatency(options.duplicateRate ?? 0, "duplicateRate", true);
    this.dropRate = validateRateOrLatency(options.dropRate ?? 0, "dropRate", true);
    this.random = random;
    this.seed = options.seed;
  }

  public enqueue(messages: SimulationMessage[], timestamp: Date): SimulationMessage[] {
    const nowMs = timestamp.getTime();
    messages.forEach((message) => {
      if (this.random() < this.dropRate) return;
      this.add(message, nowMs + this.latencyMs);
      if (this.random() < this.duplicateRate) this.add(message, nowMs + this.latencyMs);
    });
    return this.drain(new Date(nowMs));
  }

  public drain(timestamp: Date): SimulationMessage[] {
    const nowMs = timestamp.getTime();
    this.pending.sort((left, right) => left.deliverAtMs - right.deliverAtMs || left.sequence - right.sequence);
    const ready: SimulationMessage[] = [];
    while (this.pending[0]?.deliverAtMs <= nowMs) {
      ready.push(this.pending.shift()!.message);
    }
    return ready;
  }

  public pendingCount(): number {
    return this.pending.length;
  }

  public reset(): void {
    this.pending.length = 0;
    this.sequence = 0;
    if (this.seed !== undefined) this.random = createSeededRandom(this.seed);
  }

  private add(message: SimulationMessage, deliverAtMs: number): void {
    this.pending.push({
      deliverAtMs,
      sequence: this.sequence++,
      message: cloneMessage(message),
    });
  }
}

function validateRateOrLatency(value: number, field: string, rate: boolean): number {
  const valid = Number.isFinite(value) && value >= 0 && (!rate || value <= 1);
  if (!valid) throw new Error(`${field} must be ${rate ? "between 0 and 1" : "a non-negative number"}`);
  return value;
}

function cloneMessage(message: SimulationMessage): SimulationMessage {
  return JSON.parse(JSON.stringify(message)) as SimulationMessage;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
