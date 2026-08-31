import mqtt, { MqttClient } from "mqtt";
import { SimulationMessage } from "../types";

export type CommandHandler = (payload: string) => Promise<void>;

export interface MessagePublisher {
  publish(message: SimulationMessage): Promise<void>;
  subscribe(topic: string, handler: CommandHandler): Promise<void>;
  close(): Promise<void>;
}

export class ConsolePublisher implements MessagePublisher {
  public async publish(message: SimulationMessage): Promise<void> {
    console.log(JSON.stringify({ topic: message.topic, ...message.payload }));
  }

  public async close(): Promise<void> {
    return Promise.resolve();
  }

  public async subscribe(): Promise<void> {
    return Promise.resolve();
  }
}

export class MqttPublisher implements MessagePublisher {
  private constructor(private readonly client: MqttClient) {}

  public static connect(url: string, timeoutMs = 2_000): Promise<MqttPublisher> {
    parseMqttUrl(url);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error("MQTT timeoutMs must be from 100 to 30000");
    return new Promise((resolve, reject) => {
      const client = mqtt.connect(url, {
        clientId: `mes-simulator-${process.pid}`,
        reconnectPeriod: 1000,
      });
      const timer = setTimeout(() => {
        client.end(true);
        reject(new Error(`MQTT connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const onConnect = () => {
        clearTimeout(timer);
        client.removeListener("error", onError);
        resolve(new MqttPublisher(client));
      };
      const onError = (error: Error) => {
        clearTimeout(timer);
        client.end(true);
        reject(error);
      };
      client.once("connect", onConnect);
      client.once("error", onError);
    });
  }

  public publish(message: SimulationMessage): Promise<void> {
    if (!this.client.connected) return Promise.reject(new Error("MQTT client is not connected"));
    return new Promise((resolve, reject) => {
      this.client.publish(message.topic, JSON.stringify(message.payload), { qos: 0 }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  public subscribe(topic: string, handler: CommandHandler): Promise<void> {
    if (!this.client.connected) return Promise.reject(new Error("MQTT client is not connected"));
    return new Promise((resolve, reject) => {
      this.client.subscribe(topic, (error) => {
        if (error) {
          reject(error);
          return;
        }
        this.client.on("message", (receivedTopic, payload) => {
          if (receivedTopic === topic) void handler(payload.toString());
        });
        resolve();
      });
    });
  }

  public close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.end(false, {}, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

/** Accept only MQTT URL schemes supported by the simulator's MQTT adapter. */
export function parseMqttUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("MQTT URL must be a valid URL");
  }
  if (parsed.protocol !== "mqtt:" && parsed.protocol !== "mqtts:") throw new Error("MQTT URL must use mqtt:// or mqtts://");
  if (!parsed.hostname) throw new Error("MQTT URL host is required");
  return url;
}
