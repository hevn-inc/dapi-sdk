export type Tone = 'good' | 'wait' | 'bad' | 'plain';

export class Format {
  static readonly GOOD = new Set(['approved', 'active', 'settled', 'completed', 'success']);
  static readonly WAIT = new Set(['pending', 'preparing', 'awaitingSignature', 'submitted', 'rfi', 'processing', 'in_review', 'working']);
  static readonly BAD = new Set(['rejected', 'failed', 'closed', 'suspended', 'refunded', 'cancelled']);
  static readonly STATUS: Record<string, string> = {
    awaitingSignature: 'Waiting for your approval',
    submitted: 'On its way',
    settled: 'Delivered',
    failed: 'Failed',
    refunded: 'Returned',
    notStarted: 'Not started',
    draft: 'Not filed',
    pending: 'In review',
    approved: 'Verified',
    rfi: 'More information needed',
    rejected: 'Rejected',
    preparing: 'Preparing',
    active: 'Active',
    suspended: 'Suspended',
    closed: 'Closed',
    working: 'Working',
  };

  static tone(status: string | null | undefined): Tone {
    if (!status) return 'plain';
    if (Format.GOOD.has(status)) return 'good';
    if (Format.WAIT.has(status)) return 'wait';
    if (Format.BAD.has(status)) return 'bad';
    return 'plain';
  }

  static status(status: string | null | undefined): string {
    if (!status) return 'Unknown';
    return Format.STATUS[status] ?? Format.label(status);
  }

  static money(value: string | number | null | undefined, digits = 2): string {
    const number = Number(value ?? 0);
    return number.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 6) });
  }

  static usd(value: string | number | null | undefined): string {
    return Number(value ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }

  static label(key: string): string {
    const spaced = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
  }

  static short(value: string | null | undefined, head = 6, tail = 4): string {
    if (!value) return '';
    return value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
  }

  static date(value: string): string {
    return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  static token(account: string): string {
    return account.split('_')[0] ?? account;
  }
}
