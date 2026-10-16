export type Hex = `0x${string}`;
export type MoneyAmount = string;
export type ClientId = `cl_${string}`;
export type AccountKey = 'USDC' | 'EURC' | 'FDIC_USD' | (string & {});

export type AuthorizationKind = 'debit' | 'intent';
export type SettlementMode = 'message_signature' | 'order_signature';

export interface Approval {
  id: string;
  payload: string;
  expiresAt: string;
}

export interface Debit {
  address: Hex;
  amount: MoneyAmount;
  amountAtomic: string;
  token: string;
  chainId: number;
}

export interface Intent {
  digest: Hex;
  settles: SettlementMode | (string & {});
}

export interface SecpSignRpc {
  method: 'secp256k1_sign';
  params: { hash: Hex };
}

export interface PersonalSignRpc {
  method: 'personal_sign';
  params: { message: string; encoding: 'utf-8' };
}

export type WalletRpc = SecpSignRpc | PersonalSignRpc;

export interface AuthorizationHeaders {
  'privy-app-id': string;
  'privy-request-expiry': string;
  'privy-idempotency-key'?: string;
}

export interface AuthorizationRequest<Body extends WalletRpc = WalletRpc> {
  version: 1;
  method: 'POST';
  url: string;
  headers: AuthorizationHeaders;
  body: Body;
}

export interface Quote {
  fromAmount: MoneyAmount;
  fromCurrency: string;
  toAmount: MoneyAmount;
  toCurrency: string;
  rate?: MoneyAmount | null;
  feeAmount?: MoneyAmount | null;
  feeCurrency?: string | null;
  expiresAt?: string | null;
}

export interface PayoutQuote extends Quote {
  fromChainId?: string | null;
  toChainId?: string | null;
}

export interface SwapQuote extends Quote {
  rate: MoneyAmount;
  feeAmount: MoneyAmount;
  feeCurrency: string;
  minimumToAmount?: MoneyAmount | null;
  estimated: boolean;
  etaHours?: number | null;
}

export type PayoutStatus = 'awaitingSignature' | 'submitted' | 'settled' | 'failed' | 'refunded';
export type SwapStatus = 'awaitingSignature' | 'submitted' | 'settled' | 'failed';

export interface CoSignable {
  id: string;
  authorization: AuthorizationKind;
  approval: Approval | null;
  debit: Debit | null;
  intent: Intent | null;
  quote: Quote | null;
}

export interface PayoutContact {
  contactId?: string | null;
  name?: string | null;
  address?: string | null;
  chainId?: string | null;
  token?: string | null;
}

export interface PayoutCreateInput {
  contactId: string;
  amount?: MoneyAmount;
  amountTo?: MoneyAmount;
  paymentReference?: string;
  purpose?: string;
  documentIds?: string[];
  bankId?: string;
  sourceAccount?: AccountKey;
}

export interface Payout extends CoSignable {
  kind: 'fiat' | 'onchain';
  status: PayoutStatus;
  idempotencyKey: string;
  quote: PayoutQuote | null;
  contact: PayoutContact | null;
}

export interface Receipt {
  id: string;
  status: PayoutStatus | SwapStatus;
  transactionHash?: string | null;
  transactionId?: string | null;
  pollUrl?: string | null;
  failure?: { code: string } | null;
}

export interface SwapCreateInput {
  sourceAccount: AccountKey;
  destinationAccount: AccountKey;
  amount?: MoneyAmount;
  amountTo?: MoneyAmount;
}

export interface Swap extends CoSignable {
  status: SwapStatus;
  idempotencyKey: string;
  sourceAccount: AccountKey;
  destinationAccount: AccountKey;
  quote: SwapQuote;
  approval: Approval;
}

export type EscrowVerb = 'authorize' | 'charge' | 'capture' | 'void' | 'refund' | 'reclaim';
export type EscrowAction = EscrowVerb | 'approve' | 'reject';
export type EscrowActionStatus =
  | 'awaitingSignature'
  | 'signing'
  | 'submitted'
  | 'confirmed'
  | 'reverted'
  | 'failed'
  | 'superseded'
  | 'dropped';

export interface EscrowCreateInput {
  senderClientId: ClientId;
  receiverClientId: ClientId;
  token: string;
  maxAmount: MoneyAmount;
  approveWithin?: string;
  holdFor?: string;
  refundableFor?: string;
  feeBps?: number;
  reference?: Record<string, unknown>;
  description?: string;
  completionConditions?: string;
}

export interface EscrowActionInput {
  action: EscrowVerb;
  amount?: MoneyAmount;
  feeBps?: number;
}

export interface EscrowActionView {
  action: EscrowAction;
  idempotencyKey: string;
  status: EscrowActionStatus;
  amount?: MoneyAmount | null;
  feeBps?: number | null;
  transactionHash?: string | null;
  approval?: Approval | null;
}

export interface EscrowDeal {
  id: string;
  status: string;
  availableActions: EscrowAction[];
  sender: { clientId: ClientId };
  receiver: { clientId: ClientId };
  token: string;
  maxAmount: MoneyAmount;
  authorizedAmount: MoneyAmount;
  capturableAmount: MoneyAmount;
  refundableAmount: MoneyAmount;
  windows: { approveBy: string; holdUntil: string; refundableUntil: string };
  action?: EscrowActionView | null;
  consistent?: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface EscrowActionResult {
  deal: EscrowDeal;
  action: EscrowActionView;
  events: { name: string; transactionHash: string; blockNumber: number; amount?: MoneyAmount | null }[];
  pollUrl?: string | null;
}

export interface LoginChallenge {
  challengeId: string;
  payload: string;
  expiresAt: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  userId: ClientId;
}

export interface Client {
  id: ClientId;
  status: string;
  email?: string | null;
  baseSmartWallet?: Hex | null;
  [field: string]: unknown;
}

export interface Page<Item> {
  items: Item[];
  nextCursor?: string | null;
  [field: string]: unknown;
}

export interface ExpectedDebit {
  token: string;
  amount: MoneyAmount;
  address?: Hex;
}

export interface ExpectedQuote {
  fromAmount?: MoneyAmount;
  fromCurrency?: string;
  toAmount?: MoneyAmount;
  toCurrency?: string;
  minToAmount?: MoneyAmount;
  maxFeeAmount?: MoneyAmount;
}

export interface ExpectedIntent {
  smartWallet: Hex;
  settles?: SettlementMode;
}

export interface CoSignExpectation {
  debit?: ExpectedDebit;
  intent?: ExpectedIntent;
  quote?: ExpectedQuote;
  allow?: AuthorizationKind[];
}

export interface ExpectedEscrowAction {
  action: EscrowAction;
  amount?: MoneyAmount;
  feeBps?: number;
  idempotencyKey?: string;
}
