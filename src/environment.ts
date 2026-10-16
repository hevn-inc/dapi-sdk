export type EnvironmentName = 'sandbox' | 'production';

export interface Environment {
  name: EnvironmentName;
  apiUrl: string;
  chainId: number;
  privyAppId: string;
}

export const ENVIRONMENTS: Readonly<Record<EnvironmentName, Environment>> = {
  sandbox: {
    name: 'sandbox',
    apiUrl: 'https://sandbox-api.hevn.finance/dapi/v1',
    chainId: 84532,
    privyAppId: 'cmu4divcq000z0bjsr5c7kg35',
  },
  production: {
    name: 'production',
    apiUrl: 'https://api.hevn.finance/dapi/v1',
    chainId: 8453,
    privyAppId: 'cmnueil3100ix0djpyc86514h',
  },
};

export const API_SUFFIX = '/dapi/v1';

export function resolveEnvironment(env: EnvironmentName | Environment): Environment {
  const resolved = typeof env === 'string' ? ENVIRONMENTS[env] : env;
  if (!resolved) throw new Error(`Unknown HEVN environment: ${String(env)}`);
  const apiUrl = resolved.apiUrl.replace(/\/+$/, '');
  if (!apiUrl.endsWith(API_SUFFIX)) throw new Error(`HEVN apiUrl must end in ${API_SUFFIX}, got ${resolved.apiUrl}`);
  return { ...resolved, apiUrl };
}

export interface TokenSpec {
  symbol: string;
  decimals: number;
  addresses: Readonly<Record<number, `0x${string}`>>;
}

export const TOKENS: Readonly<Record<string, TokenSpec>> = {
  USDC: {
    symbol: 'USDC',
    decimals: 6,
    addresses: { 8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
  },
  EURC: {
    symbol: 'EURC',
    decimals: 6,
    addresses: { 8453: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', 84532: '0x808456652fdb597867f38412077A9182bf77359F' },
  },
};

export const ENTRY_POINT_V06 = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';

export const APPROVAL_WINDOW_MS = {
  payout: 120_000,
  swap: 120_000,
  escrow: 60_000,
  login: 300_000,
} as const;
