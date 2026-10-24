import { Format } from '@/client/format';

export function StatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  return <span className={`badge ${Format.tone(status)}`}>{label ?? Format.status(status)}</span>;
}
