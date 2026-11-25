# Fiber Pay-to-Unlock: Decentralized Digital Asset Storefront

A seller encrypts a digital product (a report, an API key, any text), prices it in CKB, and hands the buyer a locked offer. The buyer pays over the **Fiber Network** (Nervos CKB Layer 2). The payment itself reveals the decryption key, so there is no escrow and no trusted third party.

---

## How it works

### The core trick: the payment preimage is the decryption key

1. **Seller encrypts.** The app generates a random 32-byte key and encrypts the content with **AES-256-GCM** (`lib/crypto.ts`).
2. **Seller locks the key into an invoice.** The same 32 bytes are used as the Fiber invoice's *payment preimage* (`lib/offer.ts`). Fiber invoices are identified by `sha256(preimage)`, the *payment hash*, so the invoice is public but the preimage (the key) is secret.
3. **Seller shares an offer.** The offer is a JSON blob containing: the ciphertext, the IV, the invoice, the payment hash, the price, the title and a route hint to the seller. It contains **no key**.
4. **Buyer validates.** The buyer's node parses the invoice and checks that currency, amount and payment hash match the offer, and that the invoice is not expired (`lib/payment.ts`). A tampered offer is rejected before any money moves.
5. **Buyer pays.** Fiber routes the payment through the hub ("Bottle"). The seller only claims the funds by revealing the preimage, and that same preimage comes back to the buyer as proof of payment.
6. **Buyer decrypts.** The revealed preimage *is* the AES key, so the buyer unlocks the content. Payment and key release are atomic: either both happen or neither does.

```
Seller C ──(channel)── Bottle ──(channel)── Buyer A
   encrypt + invoice(preimage = key)  ──offer JSON──►  validate → pay
   ◄────────── payment settles, preimage revealed ───────────┘ → decrypt
```

### Selling the same product many times

One invoice carries one key, so it can only be sold once. The **catalog** (`lib/catalog.ts`) handles this:

- A **Product** is what you list: title, price and secret content.
- Every time you click **Issue offer for a buyer**, the app creates a *fresh key and a fresh invoice*, recorded as a **Sale** with its own payment hash.
- **Check payments** asks your node for each open invoice's status and marks the sale `paid`, `expired` or `cancelled`. The stats show units sold, CKB earned and open offers.
- Delisting a product keeps its sales history, so revenue stays correct.

> **Note:** the catalog (including the plaintext you sell) is stored in this browser's `localStorage` so you can re-issue offers. Use a browser profile you trust. Everything is on Fiber **testnet**, so amounts are test CKB.

### The buyer only sees the offer

Price, item title, the Pay button label and the receipt all come from the pasted offer (checked against its invoice). They never come from the seller's form.

### Safety rails around payment

- The payment attempt is saved *before* it is submitted, and a storage failure blocks the payment.
- A reload restores the attempt and checks its status instead of paying again.
- A failed payment can only be retried explicitly.
- The buyer must first try **Decrypt without key** and see it fail, which demonstrates the lock before paying.

---

## The UI

| Section | What you do |
| --- | --- |
| **Step 1: Nodes & channels** | Start the Buyer A and Seller C nodes, fund them from the faucet, open a channel to Bottle, and move 5 CKB so the seller has inbound capacity. |
| **Step 2: Seller storefront** | Fill in title, price and secret. **Save as product** to put it in the catalog, then **Issue offer for a buyer**. **One-off offer** skips the catalog. |
| **Step 3: Buyer checkout** | Paste the offer, **Validate**, try to decrypt without the key (fails), **Pay**, then **Decrypt with revealed key**. |

A progress bar at the top tracks the four milestones: channels open, product listed, buyer paid, content unlocked.

---

## Demo walkthrough: screenshots to take

Save these in a `screenshots/` folder, in this order. Each one proves a step of the flow.

| # | File | What it must show |
| --- | --- | --- |
| 1 | `01-channels-ready.png` | Step 1 with **both** Buyer A and Seller C showing a green `CHANNEL_READY` pill and their balances. The progress bar's first step should be ticked. |
| 2 | `02-catalog-product.png` | The seller form filled in (title, price, secret) next to the **Catalog & sales** card with the saved product listed at the correct price. |
| 3 | `03-offer-issued.png` | After **Issue offer for a buyer**: the status banner confirming the offer was issued, and an `issued` sale row in the Sales list with Open offers = 1. |
| 4 | `04-offer-validated.png` | Buyer card with the pasted offer, the **"You are buying"** panel showing the item title and a price that **matches the catalog price**. |
| 5 | `05-decrypt-rejected.png` | After **Try decrypting without key**: the banner `Decryption rejected: key unavailable.` This proves the content is locked before payment. |
| 6 | `06-payment-settled.png` | The **Payment receipt** (price, routing fee, total, payment hash) with the `Settled` pill, plus the updated channel balances in Step 1. |
| 7 | `07-decrypted-result.png` | The **Unlocked content** panel showing the revealed plaintext and the **Copy decrypted content** button. |
| 8 | `08-sale-recorded.png` | Back on the seller side after **Check payments**: the sale is `paid`, Sold = 1 and CKB earned equals the price. |

**Tips for clean shots:** capture the whole page width, keep the browser at `localhost`, and take shots 4 to 7 in one continuous run on the same offer so the payment hash matches across them. For a bonus shot, issue a second offer for the same product and show two separate payment hashes. This demonstrates that every buyer gets their own key.

---

## Run locally

### Prerequisites
- Node.js 22.18 or newer
- npm

### Steps

```sh
git clone https://github.com/Horllydreycz/encrypted-data-payment.git
cd encrypted-data-payment
npm install
npm run dev
```

Open [http://localhost:3001](http://localhost:3001). It must be `localhost`, because the Fiber WASM node needs `SharedArrayBuffer` and cross-origin isolation.

---

## Testing

```sh
npm test          # unit tests: payment safety + seller catalog
npm run typecheck # TypeScript
npm run build     # Next.js production build
```

## Project layout

| Path | Purpose |
| --- | --- |
| `app/page.tsx` | The UI and the orchestration of node, channel, offer and payment actions |
| `app/globals.css` | Styling |
| `lib/crypto.ts` | AES-256-GCM encrypt/decrypt |
| `lib/offer.ts` | Build and parse the encrypted offer; create the Fiber invoice |
| `lib/payment.ts`, `lib/payment-submission.ts` | Offer validation and safe, non-duplicating payment submission |
| `lib/catalog.ts` | Seller products, sales ledger, revenue summary, storage |
| `lib/fiber.ts`, `lib/node-session.ts`, `lib/channel-funding.ts` | Fiber node and channel plumbing |
| `lib/progress.ts` | Session progress and saved node identity |
