import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  DeviceConnection,
  DeviceConnectionStatusEvent,
} from './device-connection.types';

export interface DeviceConnectionPersistenceSnapshot {
  connections: DeviceConnection[];
  statusEvents: DeviceConnectionStatusEvent[];
}

/**
 * PostgreSQL boundary for connection configuration and lifecycle events.
 * Memory mode is explicit: it is used only when DATABASE_ENABLED=false.
 */
@Injectable()
export class DeviceConnectionPersistenceService {
  constructor(private readonly prisma: PrismaService) {}

  async restore(): Promise<DeviceConnectionPersistenceSnapshot> {
    if (!(await this.ensureDatabase())) return { connections: [], statusEvents: [] };

    try {
      const [connections, statusEvents] = await Promise.all([
        this.prisma.deviceConnection.findMany(),
        this.prisma.deviceConnectionStatusEvent.findMany({ orderBy: { eventTime: 'asc' } }),
      ]);
      return {
        connections: connections.map((row) => this.connection(row)),
        statusEvents: statusEvents.map((row) => this.statusEvent(row)),
      };
    } catch (error: unknown) {
      throw this.databaseError('restore device connections', error);
    }
  }

  async save(
    connection: DeviceConnection,
    statusEvent?: DeviceConnectionStatusEvent,
  ): Promise<void> {
    if (!(await this.ensureDatabase())) return;

    try {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.deviceConnection.upsert({
          where: { id: connection.id },
          create: this.connectionCreateData(connection),
          update: this.connectionUpdateData(connection),
        });
        if (statusEvent) {
          await transaction.deviceConnectionStatusEvent.create({
            data: this.statusEventCreateData(statusEvent),
          });
        }
      });
    } catch (error: unknown) {
      throw this.databaseError(`persist device connection ${connection.id}`, error);
    }
  }

  private async ensureDatabase(): Promise<boolean> {
    await this.prisma.ensureConnection();
    if (!this.prisma.enabled) return false;
    if (!this.prisma.isReady()) {
      throw new Error(
        'PostgreSQL is enabled but unavailable; device connection state was not persisted',
      );
    }
    return true;
  }

  private connectionCreateData(connection: DeviceConnection) {
    return {
      id: connection.id,
      tenantId: connection.tenantId,
      deviceId: connection.deviceId,
      name: connection.name,
      type: connection.type,
      profileKey: connection.profileKey,
      driverVerification: connection.driverVerification,
      endpoint: connection.endpoint,
      config: connection.config as Prisma.InputJsonValue,
      capabilities: connection.capabilities as Prisma.InputJsonValue,
      enabled: connection.enabled,
      status: connection.status,
      health: connection.health as unknown as Prisma.InputJsonValue,
      lastError: connection.lastError,
      lastErrorCode: connection.lastErrorCode,
      lastEventAt: this.dateOrNull(connection.lastEventAt),
      lastHeartbeatAt: this.dateOrNull(connection.lastHeartbeatAt),
      startedAt: this.dateOrNull(connection.startedAt),
      createdAt: new Date(connection.createdAt),
      updatedAt: new Date(connection.updatedAt),
    };
  }

  private connectionUpdateData(connection: DeviceConnection) {
    const { id: _id, tenantId: _tenantId, createdAt: _createdAt, ...data } = this.connectionCreateData(connection);
    return data;
  }

  private statusEventCreateData(event: DeviceConnectionStatusEvent) {
    return {
      id: event.id,
      tenantId: event.tenantId,
      connectionId: event.connectionId,
      status: event.status,
      eventTime: new Date(event.eventTime),
      errorCode: event.errorCode,
      details: event.details as Prisma.InputJsonValue,
    };
  }

  private connection(row: any): DeviceConnection {
    return {
      ...row,
      config: row.config as Record<string, unknown>,
      capabilities: row.capabilities as string[],
      health: row.health as DeviceConnection['health'],
      lastEventAt: row.lastEventAt?.toISOString() ?? null,
      lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
      startedAt: row.startedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private statusEvent(row: any): DeviceConnectionStatusEvent {
    return {
      ...row,
      errorCode: row.errorCode ?? null,
      details: row.details as Record<string, unknown>,
      eventTime: row.eventTime.toISOString(),
    };
  }

  private dateOrNull(value: string | null): Date | null {
    return value ? new Date(value) : null;
  }

  private databaseError(operation: string, error: unknown): Error {
    const detail = error instanceof Error ? error.message : String(error);
    return new Error(`PostgreSQL ${operation} failed; state was not persisted: ${detail}`);
  }
}
