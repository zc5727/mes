import { validate } from 'class-validator';
import { AlarmQueryDto } from '../src/alarms/dto/alarm-query.dto';

describe('AlarmQueryDto', () => {
  it('accepts supported filters', async () => {
    const dto = Object.assign(new AlarmQueryDto(), {
      level: 'critical',
      lineId: 'line-cnc',
      deviceId: 'cnc-01',
      status: 'active',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects unsupported enum values and blank identifiers', async () => {
    const dto = Object.assign(new AlarmQueryDto(), {
      level: 'urgent',
      lineId: '',
      status: 'open',
    });

    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['level', 'lineId', 'status']));
  });
});
