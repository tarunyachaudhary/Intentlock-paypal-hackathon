# IntentLock

**A spending-permission layer between AI agents and your money, built with PayPal.**

IntentLock lets a person describe what an AI shopping agent may buy, then checks each proposed purchase against those rules. The agent can suggest a product, but it cannot approve or pay for it. A person must approve the purchase in IntentLock and complete the payment through PayPal Sandbox.

This is a working prototype of the permission and payment flow, not an autonomous shopping agent. Product proposals come from the demo catalogue and are initiated in the web app.

> **Prototype:** This project was built for the PayPal AI Hackathon. It uses PayPal Sandbox, a small USD demo catalogue, and simulated merchant verification. It is not connected to real merchants or real-money payments.

## How it works

1. **Set a spending policy.** Enter an instruction such as “Buy a wireless keyboard under $100. Only from trusted sellers. Ask me before paying.”
2. **Convert the instruction into rules.** The backend uses Gemini when configured, then validates its response with Zod. If Gemini is unavailable or no key is configured, a rule-based parser is used.
3. **Show eligible products.** The catalogue endpoint returns products that pass the active policy. Each proposed product is checked again by the deterministic policy engine.
4. **Ask for human approval.** An eligible proposal receives a short-lived, HMAC-signed authorization record. The user can approve or decline it in the app.
5. **Recheck before payment.** The backend checks the current catalogue price again before creating a PayPal order. The user then completes the Sandbox payment, and the backend verifies the capture status, amount, and currency.
6. **Record the outcome.** Purchase history and a hash-linked audit trail are available in the app.

```text
Plain-language instruction
          ↓
 Gemini (optional) or rules parser
          ↓
 Validated policy → eligible products
          ↓
 Deterministic policy and risk checks
     ┌────┴────┐
  BLOCKED   ELIGIBLE
                ↓
      Signed, expiring authorization
                ↓
      Person approves in IntentLock
                ↓
      Price recheck → PayPal Sandbox
                ↓
      Capture validation → audit trail
```

## Safety features

| Feature | What it does |
| --- | --- |
| Deterministic policy checks | Checks category, USD currency, budget, seller allowlist, demo verification status, and listing integrity. Money comparisons use integer cents. |
| Human approval | Purchases cannot move to the approved state without the user approving them in the app. |
| Signed authorization | Binds the user, policy, product, merchant, amount, currency, and expiry. The backend verifies the signature and purchase details before approval and capture. |
| Listing-injection check | Known prompt-injection patterns in product descriptions are hard-blocked. Listing text is not sent to the decision explainer. |
| Price recheck | Checks the server catalogue again immediately before creating a PayPal order. A changed price blocks the order. |
| Server-side prices | The client submits a product ID; the backend looks up its price in the controlled catalogue. |
| Payment state and capture checks | Uses guarded state transitions and PayPal request IDs, then checks that PayPal's captured amount and currency match the approved purchase. |
| Audit chain | Each audit entry includes the prior entry's hash. The app reports whether the chain verifies. |

The risk score is advisory and heuristic. It is not fraud detection. Merchant verification is demo data and does not represent real-world checks.

## Project layout

```text
.
├── client/       React and Vite web app
├── server/       Express API, MongoDB models, policy and payment services
├── render.yaml   Render deployment configuration
└── README.md
```

## Requirements

- Node.js 20 or newer
- MongoDB, local or hosted
- PayPal Sandbox REST app credentials
- Optional: Gemini API key for AI-assisted policy parsing and explanations

## Run locally

Run commands from the repository root.

### 1. Configure and start the API

Create `server/.env` with your own values:

```dotenv
PORT=5050
MONGO_URI=mongodb://127.0.0.1:27017/intentlock
JWT_SECRET=replace-with-a-random-secret-at-least-16-characters
MANDATE_SECRET=replace-with-a-different-random-secret-at-least-16-characters
CLIENT_URL=http://localhost:5173
PAYPAL_CLIENT_ID=your_paypal_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_paypal_sandbox_client_secret
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
DEMO_MODE=true
```

`MANDATE_SECRET` is optional; if omitted, the API uses `JWT_SECRET`. `GEMINI_API_KEY` is optional; without it, policy parsing and explanations use the local fallback. Keep `.env` files private and never commit credentials.

Then install dependencies and start the API:

```bash
cd server
npm install
npm run dev
```

The API listens on port `5050` by default. Check that it is running at <http://localhost:5050/health>.

### 2. Configure and start the web app

Create `client/.env`:

```dotenv
VITE_API_URL=http://localhost:5050/api
VITE_PAYPAL_CLIENT_ID=your_paypal_sandbox_client_id
```

Use the same PayPal Sandbox client ID as the API. Then start Vite:

```bash
cd client
npm install
npm run dev
```

Open the local URL printed by Vite (usually <http://localhost:5173>). Create an account, set a policy, and choose from the eligible products shown.

### Run the backend checks

```bash
cd server
npm test
```

The Node test suite covers policy decisions, injection detection, price changes, mandates, and audit-chain integrity.

## Try the demo

1. Create an account and set: “Buy a wireless keyboard under $100. Only from trusted sellers. Ask me before paying.”
2. Choose **Keystone K3 Wireless Keyboard ($79.99)**. Review the checks, approve it in IntentLock, and complete the PayPal Sandbox checkout with a Sandbox buyer account.
3. Try **Apex Pro Mechanical Keyboard ($149)**: it exceeds the $100 budget and will not be offered as eligible by the app. The backend's evaluation endpoint also blocks it if called with its product ID.
4. The **Typist Mini** listing contains an instruction aimed at AI agents. The policy engine hard-blocks it; it is excluded from the eligible catalogue.
5. For the price-change demonstration, approve an eligible product, click **Demo: raise this price by $5 and try again**, then start checkout. The backend rechecks the catalogue and blocks order creation when the price no longer matches the approved amount.
6. Review purchase history and the audit-chain status at the bottom of the app.

The price-change helper is available only when `DEMO_MODE=true`. The in-memory demo catalogue resets when the API restarts.

## API reference

All routes except `/health`, registration, and login require a bearer token unless stated otherwise. API routes are prefixed with `/api`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | API health check; no authentication required. |
| POST | `/api/auth/register` | Create an account and return a token. |
| POST | `/api/auth/login` | Sign in and return a token. |
| GET | `/api/products` | List products eligible under the current active policy. |
| POST | `/api/policies` | Parse and save a new spending instruction; it replaces the active policy. |
| GET | `/api/policies/active` | Get the current active policy. |
| POST | `/api/agent/evaluate` | Evaluate a product ID and create a blocked or pending-approval purchase record. |
| POST | `/api/purchases/:id/approve` | Verify the authorization and approve a pending purchase. |
| POST | `/api/purchases/:id/reject` | Decline a pending or approved purchase. |
| POST | `/api/payments/create-order` | Recheck the purchase and create a PayPal order. |
| POST | `/api/payments/capture-order` | Capture the matching PayPal order and verify the result. |
| GET | `/api/payments/history` | List the latest 50 purchases. |
| GET | `/api/audit` | Return recent audit entries and chain verification. |
| POST | `/api/demo/bump-price` | Increase a demo product price; only available when `DEMO_MODE=true`. |

## Deployment

[`render.yaml`](render.yaml) defines an API web service and a static web app. Configure its unsynced environment variables in Render. Set `VITE_API_URL` to the deployed API URL plus `/api`, and set `CLIENT_URL` on the API to the deployed web app origin. Use a MongoDB connection string and PayPal Sandbox credentials. Keep secrets in the hosting provider's environment settings, not in source control.

## Limitations

- PayPal Sandbox only; USD only; no real merchant integration.
- Catalogue products, prices, and merchant verification are demo data.
- The risk score and injection detection use simple heuristics and patterns. They are not comprehensive security or fraud systems.
- The demo catalogue, including price changes, is held in memory and resets when the API restarts.
- The audit hash chain makes edits detectable, but it is stored in the same database and is not an external immutable ledger.

## License

MIT. See [LICENSE](LICENSE).
