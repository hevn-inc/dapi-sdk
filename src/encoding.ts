export class Base64 {
  static readonly STANDARD = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

  static isStrict(value: string): boolean {
    return typeof value === 'string' && value.length > 0 && Base64.STANDARD.test(value);
  }

  static decode(value: string, what: string): Buffer {
    if (!Base64.isStrict(value)) throw new TypeError(`${what} is not padded standard base64`);
    return Buffer.from(value, 'base64');
  }

  static encode(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('base64');
  }
}

export class CanonicalJson {
  static stringify(value: unknown): string {
    return JSON.stringify(CanonicalJson.sorted(value));
  }

  static bytes(value: unknown): Buffer {
    return Buffer.from(CanonicalJson.stringify(value), 'utf8');
  }

  private static sorted(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => CanonicalJson.sorted(item));
    if (value === null || typeof value !== 'object') return value;
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, CanonicalJson.sorted((value as Record<string, unknown>)[key])] as const);
    return Object.fromEntries(entries);
  }
}

export class Decimal {
  static readonly PATTERN = /^-?\d+(?:\.\d+)?$/;

  static normalize(value: string | number): string {
    const text = String(value).trim();
    if (!Decimal.PATTERN.test(text)) throw new TypeError(`${text} is not a decimal amount`);
    const negative = text.startsWith('-');
    const [whole, fraction = ''] = text.replace('-', '').split('.');
    const integer = whole.replace(/^0+(?=\d)/, '');
    const decimals = fraction.replace(/0+$/, '');
    const body = decimals ? `${integer}.${decimals}` : integer;
    return negative && body !== '0' ? `-${body}` : body;
  }

  static equal(left: string | number, right: string | number): boolean {
    return Decimal.normalize(left) === Decimal.normalize(right);
  }

  static toUnits(value: string | number, decimals: number): bigint {
    const text = Decimal.normalize(value);
    const negative = text.startsWith('-');
    const [whole, fraction = ''] = text.replace('-', '').split('.');
    if (fraction.length > decimals) throw new RangeError(`${text} has more than ${decimals} decimals`);
    const units = BigInt(whole + fraction.padEnd(decimals, '0'));
    return negative ? -units : units;
  }

  static compare(left: string | number, right: string | number): number {
    const scale = 36;
    const a = Decimal.toUnits(left, scale);
    const b = Decimal.toUnits(right, scale);
    if (a === b) return 0;
    return a > b ? 1 : -1;
  }
}

export class HexCheck {
  static readonly HASH = /^0x[0-9a-fA-F]{64}$/;
  static readonly ADDRESS = /^0x[0-9a-fA-F]{40}$/;

  static isHash(value: unknown): value is `0x${string}` {
    return typeof value === 'string' && HexCheck.HASH.test(value);
  }

  static isAddress(value: unknown): value is `0x${string}` {
    return typeof value === 'string' && HexCheck.ADDRESS.test(value);
  }

  static same(left: string | null | undefined, right: string | null | undefined): boolean {
    return typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase();
  }
}
