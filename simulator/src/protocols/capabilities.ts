export type ProtocolCapabilityStatus = "IMPLEMENTED" | "SYNTHETIC_CONTRACT" | "CONTRACT_ADAPTER_ONLY" | "NOT_IMPLEMENTED";

export interface ProtocolCapability {
  status: ProtocolCapabilityStatus;
  read: boolean;
  write: boolean;
  subscribe: boolean;
  notes: string;
}

/** Runtime capability registry. Unknown transports must not be silently downgraded. */
export const PROTOCOL_CAPABILITIES: Readonly<Record<string, ProtocolCapability>> = {
  mqtt: { status: "IMPLEMENTED", read: true, write: true, subscribe: true, notes: "Existing MessagePublisher and simulator control topics." },
  http: { status: "CONTRACT_ADAPTER_ONLY", read: true, write: false, subscribe: false, notes: "Canonical event adapter only; no HTTP server is opened by simulator." },
  websocket: { status: "NOT_IMPLEMENTED", read: false, write: false, subscribe: false, notes: "No WebSocket endpoint or adapter in simulator." },
  "modbus-tcp": { status: "SYNTHETIC_CONTRACT", read: true, write: false, subscribe: false, notes: "Synthetic FC03 holding-register endpoint." },
  "opc-ua": { status: "SYNTHETIC_CONTRACT", read: true, write: false, subscribe: false, notes: "Synthetic read-only nodes; no vendor namespace or methods." },
  mtconnect: { status: "SYNTHETIC_CONTRACT", read: true, write: false, subscribe: false, notes: "Synthetic /probe, /current and /sample documents." },
  focas: { status: "NOT_IMPLEMENTED", read: false, write: false, subscribe: false, notes: "Requires Windows, FANUC SDK and vendor validation." },
};

export function getProtocolCapability(protocol: string): ProtocolCapability {
  const capability = PROTOCOL_CAPABILITIES[protocol.toLowerCase()];
  if (!capability) throw new Error(`Unsupported protocol '${protocol}'`);
  return capability;
}
