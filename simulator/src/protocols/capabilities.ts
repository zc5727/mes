export type ProtocolCapabilityStatus = "IMPLEMENTED" | "SYNTHETIC_CONTRACT" | "CONTRACT_ADAPTER_ONLY" | "NOT_IMPLEMENTED";

export interface ProtocolCapability {
  status: ProtocolCapabilityStatus;
  read: boolean;
  write: boolean;
  subscribe: boolean;
  security: ProtocolSecurityCapability;
  notes: string;
}

export interface ProtocolSecurityCapability {
  tls: "URL_SCHEME_SUPPORTED" | "NOT_IMPLEMENTED" | "NOT_APPLICABLE";
  authentication: "URL_CREDENTIALS_SUPPORTED" | "NONE_OR_BEARER" | "ANONYMOUS_ONLY" | "NOT_IMPLEMENTED" | "NOT_APPLICABLE";
  certificates: "NOT_EXPOSED" | "NOT_IMPLEMENTED" | "NOT_APPLICABLE";
  permissions: "BROKER_DEFINED" | "TELEMETRY_INGEST_ONLY" | "READ_ONLY" | "NOT_IMPLEMENTED";
}

/** Runtime capability registry. Unknown transports must not be silently downgraded. */
export const PROTOCOL_CAPABILITIES: Readonly<Record<string, ProtocolCapability>> = {
  mqtt: { status: "IMPLEMENTED", read: true, write: true, subscribe: true, security: { tls: "URL_SCHEME_SUPPORTED", authentication: "URL_CREDENTIALS_SUPPORTED", certificates: "NOT_EXPOSED", permissions: "BROKER_DEFINED" }, notes: "Existing MessagePublisher and simulator control topics; mqtts URL is supported, but custom certificate files are not exposed by this CLI." },
  http: { status: "SYNTHETIC_CONTRACT", read: true, write: false, subscribe: false, security: { tls: "NOT_IMPLEMENTED", authentication: "NONE_OR_BEARER", certificates: "NOT_IMPLEMENTED", permissions: "TELEMETRY_INGEST_ONLY" }, notes: "Strict local POST /events ingest; no control writes, HTTPS or vendor compatibility." },
  websocket: { status: "NOT_IMPLEMENTED", read: false, write: false, subscribe: false, security: { tls: "NOT_IMPLEMENTED", authentication: "NOT_IMPLEMENTED", certificates: "NOT_IMPLEMENTED", permissions: "NOT_IMPLEMENTED" }, notes: "No WebSocket endpoint or adapter in simulator." },
  "modbus-tcp": { status: "SYNTHETIC_CONTRACT", read: true, write: false, subscribe: false, security: { tls: "NOT_APPLICABLE", authentication: "NOT_IMPLEMENTED", certificates: "NOT_APPLICABLE", permissions: "READ_ONLY" }, notes: "Synthetic FC03 holding-register endpoint; plain TCP and no authentication or TLS." },
  "opc-ua": { status: "SYNTHETIC_CONTRACT", read: true, write: false, subscribe: false, security: { tls: "NOT_IMPLEMENTED", authentication: "ANONYMOUS_ONLY", certificates: "NOT_IMPLEMENTED", permissions: "READ_ONLY" }, notes: "Synthetic read-only nodes; security mode/policy None, anonymous only, no vendor namespace or methods." },
  mtconnect: { status: "SYNTHETIC_CONTRACT", read: true, write: false, subscribe: false, security: { tls: "NOT_IMPLEMENTED", authentication: "NOT_IMPLEMENTED", certificates: "NOT_IMPLEMENTED", permissions: "READ_ONLY" }, notes: "Synthetic /probe, /current and /sample documents over plain HTTP; no auth or control writes." },
  focas: { status: "NOT_IMPLEMENTED", read: false, write: false, subscribe: false, security: { tls: "NOT_APPLICABLE", authentication: "NOT_IMPLEMENTED", certificates: "NOT_IMPLEMENTED", permissions: "NOT_IMPLEMENTED" }, notes: "Requires Windows, FANUC SDK and vendor validation." },
};

export function getProtocolCapability(protocol: string): ProtocolCapability {
  const capability = PROTOCOL_CAPABILITIES[protocol.toLowerCase()];
  if (!capability) throw new Error(`Unsupported protocol '${protocol}'`);
  return capability;
}
