# @hevn/dapi-sdk

Node.js SDK for the HEVN whitelabel API (`/dapi/v1`). It covers developer-key login, acting for a
client, and the prepare → **verify** → sign → confirm loop behind every payout, swap and escrow
action. Before anything is signed, the SDK checks that what HEVN asks you to sign is the payment you
asked for.

It is the reference client from the
[HTTP client](https://github.com/hevn-inc/docs/blob/main/whitelabel/reference/client.mdx) page, with
the verification layer the guides describe in prose turned into code.

Requires Node ≥ 22.18. Node runs the TypeScript sources directly, so there is no build step. The one
runtime dependency is `@noble/hashes`, for keccak-256.

## Documentation

| Topic | Link |
| --- | --- |
| Overview | [whitelabel/overview](https://github.com/hevn-inc/docs/blob/main/whitelabel/overview.mdx) |
| Quickstart, from an empty sandbox account to money on chain | [whitelabel/quickstart](https://github.com/hevn-inc/docs/blob/main/whitelabel/quickstart.mdx) |
| Developer key: P-256, scopes, IP allowlist, rotation | [whitelabel/developer-key](https://github.com/hevn-inc/docs/blob/main/whitelabel/developer-key.mdx) |
| Sessions: challenge, token, refresh, `X-Hevn-Account` | [whitelabel/sessions](https://github.com/hevn-inc/docs/blob/main/whitelabel/sessions.mdx) |
| Signing: what you sign, what HEVN verifies, the confirm retry policy | [whitelabel/signing](https://github.com/hevn-inc/docs/blob/main/whitelabel/signing.mdx) |
| Conventions: money, ids, idempotency, pagination | [whitelabel/conventions](https://github.com/hevn-inc/docs/blob/main/whitelabel/conventions.mdx) |
| Payouts | [whitelabel/payouts](https://github.com/hevn-inc/docs/blob/main/whitelabel/payouts.mdx) |
| Swaps | [whitelabel/swaps](https://github.com/hevn-inc/docs/blob/main/whitelabel/swaps.mdx) |
| Escrow and escrow actions | [whitelabel/escrow](https://github.com/hevn-inc/docs/blob/main/whitelabel/escrow.mdx), [whitelabel/escrow-actions](https://github.com/hevn-inc/docs/blob/main/whitelabel/escrow-actions.mdx) |
| Clients, payins, virtual accounts, balances | [whitelabel/clients](https://github.com/hevn-inc/docs/blob/main/whitelabel/clients.mdx), [whitelabel/payins](https://github.com/hevn-inc/docs/blob/main/whitelabel/payins.mdx), [whitelabel/virtual-accounts](https://github.com/hevn-inc/docs/blob/main/whitelabel/virtual-accounts.mdx), [whitelabel/balances-and-transactions](https://github.com/hevn-inc/docs/blob/main/whitelabel/balances-and-transactions.mdx) |
| Sandbox | [whitelabel/sandbox](https://github.com/hevn-inc/docs/blob/main/whitelabel/sandbox.mdx) |
| Errors and limits | [reference/errors](https://github.com/hevn-inc/docs/blob/main/whitelabel/reference/errors.mdx), [reference/limits](https://github.com/hevn-inc/docs/blob/main/whitelabel/reference/limits.mdx) |
| Live OpenAPI, served by the API itself | [sandbox `/dapi/v1/docs`](https://sandbox-api.hevn.finance/dapi/v1/docs), [`/dapi/v1/openapi.json`](https://sandbox-api.hevn.finance/dapi/v1/openapi.json) |

Developer keys are created in the app under **Settings → Partner program → Developer keys**:
[sandbox.gethevn.com](https://sandbox.gethevn.com) for the sandbox, [app.gethevn.com](https://app.gethevn.com)
for production.

## Install

```bash
npm install github:hevn-inc/dapi-sdk
```

## Usage

```ts
import { DeveloperKey, Hevn } from '@hevn/dapi-sdk';

const key = DeveloperKey.fromEnv();                        // HEVN_KEY_PEM → P-256 PKCS#8 PEM file
const hevn = Hevn.connect({ key, email: process.env.HEVN_EMAIL!, environment: 'sandbox' });

const northwind = hevn.actingAs('cl_7YQ2Kf3mN8');           // sends X-Hevn-Account
const { prepared, receipt } = await northwind.payouts.send(
  { contactId: 'ct_3K9…', amount: '5.00' },
  { debit: { token: 'USDC', amount: '5.00', address: '0x8f3b…' }, intent: 'client' },
  { idempotencyKey: 'order-1187' },
);
console.log(prepared.id, receipt.status, receipt.transactionHash);
```

If any check fails, `send` throws `IntentRefused`, which carries a `code` and `details`. Nothing is
signed and the confirm route is never called.

```ts
const deal = await hevn.escrow.open({ senderClientId, receiverClientId, token: 'USDC', maxAmount: '100' });
await hevn.escrow.run(deal.deal.id, { action: 'authorize', amount: '100' });
await hevn.escrow.run(deal.deal.id, { action: 'capture', amount: '40', feeBps: 250 });
```

The low-level pieces are exported too. You can call `payouts.create` / `payouts.verify` / `payouts.confirm`
yourself, or use `IntentVerifier` and `DeveloperKey` with your own HTTP stack.

## What is verified before anything is signed

**The payload**, in `AuthorizationPayload.decode`:
- It is strict padded base64 of UTF-8 JSON, and the bytes are **canonical**: sorted keys and no
  whitespace, exactly what HEVN produces. This rules out duplicate-key tricks, where the SDK and Privy
  would read different hashes.
- It is exactly `{version: 1, method: "POST", url, headers, body}`, and `url` is
  `https://api.privy.io/v1/wallets/<walletId>/rpc`.
- Only the headers `privy-app-id`, `privy-request-expiry` and `privy-idempotency-key` are signed.
- The body is a single RPC: `secp256k1_sign {hash}` or `personal_sign {message, encoding: "utf-8"}`.

**The approval**, in `IntentVerifier.approval`:
- `privy-app-id` must be the environment's app, so a sandbox signature can never execute in
  production.
- `privy-request-expiry` must equal `approval.expiresAt`, be in the future, and fall within the
  documented window: 120 s for payouts and swaps, 60 s for escrow.

**Login**, in `IntentVerifier.login`: the challenge must be `personal_sign` of
`I am the owner of {email} {nonce}`, with your `requestExpiry` and an idempotency key bound to your
nonce. A challenge that asks for anything else, such as a hash, is refused.

**Payouts and swaps**, in `IntentVerifier.coSign`:

| `authorization` | Checked against your expectation |
| --- | --- |
| `debit` | `chainId` is the environment's chain. `token` matches. `amount` and `amountAtomic` agree with each other at the token's decimals and with your amount. `address` is your recipient, when you pass one. HEVN does not return the UserOperation, so the `userOpHash` cannot be recomputed and `debit` is the echo to check ([why](https://github.com/hevn-inc/docs/blob/main/whitelabel/signing.mdx#what-the-hash-is)). |
| `intent` | `params.hash` is the Coinbase Smart Wallet replay-safe hash of `intent.digest` for **your** client's smart wallet on the environment's chain. It must never equal the raw digest. Passing `'client'` reads the wallet from `GET /client` `baseSmartWallet`. You can also pin it yourself. |

A response is refused when its `authorization` kind has no expectation. You can also pin the `quote`:
`fromAmount`, `toAmount`, the currencies, `minToAmount` and `maxFeeAmount`.

**Escrow**, in `IntentVerifier.escrow`: the verb, `idempotencyKey`, `amount`, `feeBps` and status
`awaitingSignature` are checked, plus a 60 s `secp256k1_sign` approval.

## Confirm policy

`confirmUntilSettled` implements the table in
[Signing → Retrying a confirm](https://github.com/hevn-inc/docs/blob/main/whitelabel/signing.mdx#retrying-a-confirm):
- `202`, network errors, `funding_in_progress` and `bundler_*`: confirm again, with backoff.
- `already_funded`: success.
- `funding_attempt_expired`, or `200 failed`: re-open with the **same** `Idempotency-Key` and verify
  the fresh approval again. `reopenAttempts` controls how many times (default 2).

Escrow prepares the action again on `410 approval_expired` and `409 approval_consumed`. It then calls
`sync` on the deal until the action leaves `signing` / `submitted`.

## Layout

| File | Contents |
| --- | --- |
| `src/key.ts` | `DeveloperKey`: load, generate, sign as DER base64, fingerprint. `PublicKeys`: parse SPKI and verify. `Signatures`: wire-format check and P1363 → DER |
| `src/payload.ts` | `AuthorizationPayload.decode`, `IntentRefused` |
| `src/verify.ts` | `IntentVerifier`: login, approval, debit, intent, quote, escrow |
| `src/http.ts` | `Http` (429 / `Retry-After`), `Session` (challenge → token → refresh), `HevnApiError`, `pollUntil` |
| `src/client.ts` | `Hevn`: `actingAs`, `confirmUntilSettled`, the `payouts` / `swaps` / `escrow` flows, and thin wrappers for every other `/dapi/v1` route |
| `src/intents.ts` | Wire types: `Payout`, `Swap`, `EscrowActionResult`, `Approval`, `Debit`, `Intent`, `Expected*` |
| `src/environment.ts` | `sandbox` / `production`: API base URL, chain id, Privy app id, and USDC / EURC on Base |

## Examples and tests

```bash
export HEVN_KEY_PEM=./hevn-sandbox.pem HEVN_EMAIL=integrator@example.com   # HEVN_ENV=production for prod
# HEVN_API_URL=http://localhost:8010/dapi/v1 HEVN_PRIVY_APP_ID=<its Privy app> point everything at a local backend
node examples/login.ts
node examples/payout.ts cl_7YQ2Kf3mN8 ct_3K9… 0.50 0x8f3b…
node examples/escrow.ts cl_sender cl_receiver 0.10
node examples/sandbox-transfer.ts cl_a cl_b 0.10   # a sandbox faucet credit to A, then a transfer A → B

npm test
npm run typecheck
npm run test:e2e                             # runs every example against the live sandbox
```

`npm run test:e2e` runs the examples as they are, as child processes, and checks balances through the
SDK afterwards. The harness lives in `_tests/e2e/harness.ts`. It reads `HEVN_EMAIL` and `HEVN_KEY_PEM`
from the environment or `./.env`, and `HEVN_KEY_PEM` there may also hold the PEM inline. It runs on the
first two ready clients of `GET /clients` and moves `0.10` USDC per step, inside the sandbox limits: at most 1
per payout or escrow, and a faucet that only tops up a wallet holding less than 1.

The payload and hash vectors in `_tests/fixtures.ts` come from HEVN's own server-side encoder, so a
change on either side shows up as a failing test.
