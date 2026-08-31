import { DigitalTwinRealtimeService } from '../src/digital-twin/digital-twin-realtime.service';
import { DigitalTwinService } from '../src/digital-twin/digital-twin.service';
import { MqttIngestionService } from '../src/mqtt/mqtt-ingestion.service';

describe('digital twin SSE stream', () => {
  it('emits an initial snapshot and a new snapshot after MQTT projection changes', () => {
    let listener: ((tenantId: string) => void) | undefined;
    const snapshot = { tenantId: 'tenant-demo', snapshotVersion: 'tenant-demo-000001' } as never;
    const digitalTwin = { getSnapshot: jest.fn().mockReturnValue(snapshot) } as unknown as DigitalTwinService;
    const mqtt = { onProjection: jest.fn((callback: (tenantId: string) => void) => { listener = callback; return () => { listener = undefined; }; }) } as unknown as MqttIngestionService;
    const received: unknown[] = [];
    const subscription = new DigitalTwinRealtimeService(digitalTwin, mqtt).stream('tenant-demo').subscribe((message) => received.push(message));

    expect(received).toHaveLength(1);
    listener?.('tenant-demo');
    expect(received).toHaveLength(2);
    listener?.('tenant-other');
    expect(received).toHaveLength(2);
    subscription.unsubscribe();
  });
});
