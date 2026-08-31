import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { DeviceProfile } from './device-profile.types';

/** Persists the declarative profile catalog without claiming vendor verification. */
@Injectable()
export class DeviceProfilePersistenceService {
  constructor(private readonly prisma: PrismaService) {}

  async restoreOrSeed(defaults: DeviceProfile[]): Promise<DeviceProfile[]> {
    if (!(await this.ensureDatabase())) return defaults;

    try {
      await this.prisma.$transaction(
        defaults.map((profile) => this.prisma.deviceProfile.upsert({
          where: { key: profile.key },
          create: this.profileData(profile),
          update: this.profileUpdateData(profile),
        })),
      );
      const rows = await this.prisma.deviceProfile.findMany({ orderBy: { key: 'asc' } });
      return rows.map((row) => row.payload as unknown as DeviceProfile);
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`PostgreSQL device profile persistence failed; state was not persisted: ${detail}`);
    }
  }

  private async ensureDatabase(): Promise<boolean> {
    await this.prisma.ensureConnection();
    if (!this.prisma.enabled) return false;
    if (!this.prisma.isReady()) {
      throw new Error(
        'PostgreSQL is enabled but unavailable; device profile catalog was not persisted',
      );
    }
    return true;
  }

  private profileData(profile: DeviceProfile) {
    return {
      key: profile.key,
      name: profile.name,
      protocol: profile.protocol,
      verified: profile.verified,
      payload: profile as unknown as Prisma.InputJsonValue,
    };
  }

  private profileUpdateData(profile: DeviceProfile) {
    return {
      name: profile.name,
      protocol: profile.protocol,
      verified: profile.verified,
      payload: profile as unknown as Prisma.InputJsonValue,
    };
  }
}
