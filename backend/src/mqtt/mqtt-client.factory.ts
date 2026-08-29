import { MqttClientFactory, MqttClientLike } from './mqtt.types';

interface MqttLibrary {
  connect(url: string, options: { clientId: string; reconnectPeriod: number }): RawMqttClient;
}

interface RawMqttClient {
  on(event: 'connect' | 'reconnect' | 'close' | 'offline', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'message', listener: (topic: string, payload: Uint8Array) => void): this;
  publish(topic: string, payload: string, callback: (error?: Error) => void): this;
  subscribe(topic: string, callback: (error?: Error) => void): this;
  end(force: boolean, options: Record<string, never>, callback: (error?: Error) => void): this;
}

export const createDefaultMqttClient: MqttClientFactory = (url, options) => {
  const mqtt = loadMqttLibrary();
  return new MqttClientAdapter(mqtt.connect(url, options));
};

class MqttClientAdapter implements MqttClientLike {
  public constructor(private readonly client: RawMqttClient) {}

  public on(event: 'connect' | 'reconnect' | 'close' | 'offline', listener: () => void): this;
  public on(event: 'error', listener: (error: Error) => void): this;
  public on(event: 'message', listener: (topic: string, payload: Uint8Array) => void): this;
  public on(event: string, listener: (...args: never[]) => void): this {
    this.client.on(event as never, listener as never);
    return this;
  }

  public subscribe(topic: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.subscribe(topic, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  public publish(topic: string, payload: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.publish(topic, payload, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  public end(force = true): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.end(force, {}, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

function loadMqttLibrary(): MqttLibrary {
  // Keep MQTT optional at module load time so unit tests and HTTP-only deployments
  // can boot without opening a broker connection or bundling the client.
  const loaded: unknown = require('mqtt');
  if (!isMqttLibrary(loaded)) {
    throw new Error('The installed mqtt package does not expose connect()');
  }
  return loaded;
}

function isMqttLibrary(value: unknown): value is MqttLibrary {
  return typeof value === 'object'
    && value !== null
    && 'connect' in value
    && typeof value.connect === 'function';
}
