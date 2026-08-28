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

  public static connect(url: string): Promise<MqttPublisher> {
    return new Promise((resolve, reject) => {
      const client = mqtt.connect(url, {
        clientId: `mes-simulator-${process.pid}`,
        reconnectPeriod: 1000,
      });
      const onConnect = () => {
        client.removeListener("error", onError);
        resolve(new MqttPublisher(client));
      };
      const onError = (error: Error) => {
        client.end(true);
        reject(error);
      };
      client.once("connect", onConnect);
      client.once("error", onError);
    });
  }

  public publish(message: SimulationMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.publish(message.topic, JSON.stringify(message.payload), { qos: 0 }, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  public subscribe(topic: string, handler: CommandHandler): Promise<void> {
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
