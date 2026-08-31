import { DeviceProfilePersistenceService } from '../src/device-profiles/device-profile-persistence.service';
import { DeviceProfilesService } from '../src/device-profiles/device-profiles.service';
import { PrismaService } from '../src/database/prisma.service';

describe('device profile PostgreSQL persistence', () => {
  it('seeds the declarative profile catalog when PostgreSQL is enabled', async () => {
    const profiles = new DeviceProfilesService();
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      enabled: true,
      ensureConnection: jest.fn().mockResolvedValue(undefined),
      isReady: jest.fn().mockReturnValue(true),
      $transaction: jest.fn().mockResolvedValue([]),
      deviceProfile: {
        upsert,
        findMany: jest.fn().mockResolvedValue([{ payload: profiles.list()[0] }]),
      },
    } as unknown as PrismaService;

    const result = await new DeviceProfilePersistenceService(prisma).restoreOrSeed(profiles.list());

    expect(upsert).toHaveBeenCalledTimes(4);
    expect(result).toEqual([profiles.list()[0]]);
  });

  it('does not silently fall back when enabled PostgreSQL is unavailable', async () => {
    const prisma = {
      enabled: true,
      ensureConnection: jest.fn().mockResolvedValue(undefined),
      isReady: jest.fn().mockReturnValue(false),
    } as unknown as PrismaService;

    await expect(new DeviceProfilePersistenceService(prisma).restoreOrSeed([]))
      .rejects.toThrow('PostgreSQL is enabled but unavailable');
  });
});
