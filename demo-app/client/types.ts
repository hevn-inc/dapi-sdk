export interface Me {
  id: string;
  email: string | null;
  name: string | null;
  status: string;
  environment: string;
}

export interface AccountBalance {
  account: string;
  balance: string;
  usdValue: string;
}

export interface Balance {
  clientId: string;
  baseSmartWallet: string | null;
  accounts: AccountBalance[];
  totalUsd: string;
}

export interface Kyb {
  status: string;
  missing?: string[];
  ready?: boolean;
}

export interface Holder {
  type?: string;
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
}

export interface Requisites {
  fields: Record<string, string | null>;
  holder: Holder;
  bankName: string | null;
  paymentReference: string | null;
  state: string;
}

export interface Rail {
  rail: string;
  currency: string;
  railCurrency: string;
  method: string;
  opened: boolean;
  status: string | null;
  feeBps: number;
  destinationAccount: string | null;
  minimumDeposit: string | null;
  id: string | null;
  requisites: Requisites | null;
}

export interface RailList {
  rails: Rail[];
}

export interface Blocker {
  code: string;
  field: string;
  message: string;
}

export interface Requirements {
  rail: string;
  available: boolean;
  blockers: Blocker[];
  kybStatus: string;
  kycStatus: string;
}

export interface Payout {
  id: string;
  status: string;
  authorization?: string | null;
  transactionHash?: string | null;
  quote?: { fromAmount: string; fromCurrency: string; toAmount: string; toCurrency: string } | null;
  contact?: { name?: string | null; address?: string | null } | null;
  failure?: { code: string } | null;
}

export interface CreatedPayout {
  payout: Payout;
  url: string;
}

export interface TransactionSide {
  amount: string;
  currency: string;
}

export interface Transaction {
  id: string | null;
  type: string;
  status: string;
  isIncome: boolean;
  from?: TransactionSide | null;
  to?: TransactionSide | null;
  counterparty: string | null;
  paymentReference: string | null;
  txHash: string | null;
  createdAt: string;
}

export interface TransactionPage {
  items: Transaction[];
}
