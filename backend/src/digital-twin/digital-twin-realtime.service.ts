import { Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { DigitalTwinService } from './digital-twin.service';
import { MqttIngestionService } from '../mqtt/mqtt-ingestion.service';

export interface DigitalTwinSseMessage {
  data: { type: 'snapshot'; payload: ReturnType<DigitalTwinService['getSnapshot']> };
}

/** Pushes snapshots only after the backend projection changes; heartbeat keeps proxies aware of liveness. */
@Injectable()
export class DigitalTwinRealtimeService {
  constructor(private readonly digitalTwin: DigitalTwinService, private readonly mqtt: MqttIngestionService) {}

  stream(tenantId: string): Observable<DigitalTwinSseMessage> {
    return new Observable((subscriber) => {
      let closed = false;
      const emit = () => {
        if (!closed) subscriber.next({ data: { type: 'snapshot', payload: this.digitalTwin.getSnapshot(tenantId) } });
      };
      emit();
      const unsubscribe = this.mqtt.onProjection((changedTenant) => {
        if (changedTenant === tenantId) emit();
      });
      const heartbeat = setInterval(emit, 15_000);
      return () => {
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
      };
    });
  }
}
