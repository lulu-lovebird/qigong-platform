import { createHmac } from 'node:crypto';
export const signMiniapp = (
  botToken: string,
  subject = 123456,
  authDate = Math.floor(Date.now() / 1000),
  extra: Record<string, string> = {}
) => {
  const p = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify({ id: subject, first_name: 'Synthetic learner' }),
    query_id: 'sample-query',
    ...extra
  });
  const check = [...p]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => k + '=' + v)
    .join('\n');
  const key = createHmac('sha256', 'WebAppData').update(botToken).digest();
  p.set('hash', createHmac('sha256', key).update(check).digest('hex'));
  return p.toString();
};
