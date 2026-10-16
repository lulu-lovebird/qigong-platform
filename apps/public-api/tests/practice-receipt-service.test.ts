import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
describe('Dedicated practice receipt service isolation', () => {
  it('uses the restricted notifier identity and continuous entry, preserving explicit activation and the old timer', async () => {
    const unit = await readFile(
      new URL('../../../docs/operations/qigong-practice-receipts.service', import.meta.url),
      'utf8'
    );
    for (const line of [
      'Type=simple',
      'User=qigong-notifier',
      'Group=qigong-notifier',
      'EnvironmentFile=/etc/qigong-platform/notification-worker.env',
      'ExecStart=/usr/bin/node apps/public-api/dist/practice-receipt-worker.js',
      'Restart=on-failure',
      'TimeoutStopSec=90',
      'MemoryMax=192M',
      'CPUQuota=50%',
      'NoNewPrivileges=true',
      'ProtectSystem=strict',
      'ProtectHome=true',
      'PrivateTmp=true'
    ])
      expect(unit).toContain(line);
    expect(unit).not.toContain('PRACTICE_RECEIPTS_REALTIME_ENABLED=true');
    expect(unit).not.toContain('User=root');
    const timer = await readFile(
      new URL('../../../docs/operations/qigong-notification-worker.timer', import.meta.url),
      'utf8'
    );
    expect(timer).toContain('OnUnitActiveSec=1m');
  });
});
