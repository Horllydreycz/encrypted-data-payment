'use client';

import { channelFundingGuidance } from '../lib/channel-funding';
import { useEffect, useRef, useState } from 'react';
import { scriptToAddress, type Channel, type FiberBrowserNode, type GetPaymentResult } from '@fiber-pay/sdk/browser';
import { decryptResult, toHex } from '../lib/crypto';
import { bottle, channelFundingCkb, connectAndOpenChannel, readChannel, ready, startRole } from '../lib/fiber';
import { createOffer, parseOffer, type EncryptedOffer } from '../lib/offer';
import { payForOffer, validateOffer } from '../lib/payment';
import { addProduct, emptyCatalog, readCatalog, recordSale, removeProduct, saleStatusFromInvoice, summarize, updateSaleStatus, writeCatalog, type Catalog, type Product } from '../lib/catalog';
import { createBrowserNodeSession } from '../lib/node-session';
import { encryptedSessionKey, encryptedBuyerProfile, encryptedSellerProfile, savedNodeIdentifier, readEncryptedProgress, type EncryptedLessonProgress } from '../lib/progress';

type Role = 'buyer' | 'seller';
const ckb = (value: string) => `${Number(BigInt(value)) / 100_000_000}`;
const sample = '=== CONFIDENTIAL ALPHA INTELLIGENCE REPORT ===\n\nAsset: Nervos CKB & Fiber Network L2\nTarget: High-speed micro-settlements & atomic data swap\nSecret API Key: fbr_live_948a27b1c3e04\nStatus: Verified on-chain - Ready for deployment.\n==============================================';

export default function Page() {
  const nodes = useRef<Partial<Record<Role, FiberBrowserNode>>>({});
  const sessions = useRef<Partial<Record<Role, ReturnType<typeof createBrowserNodeSession>>>>({});
  const progress = useRef<EncryptedLessonProgress | null>(null);
  const locked = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addresses, setAddresses] = useState<Partial<Record<Role, string>>>({});
  const [connected, setConnected] = useState<Partial<Record<Role, boolean>>>({});
  const [channels, setChannels] = useState<Partial<Record<Role, Channel>>>({});
  const [plaintext, setPlaintext] = useState('');
  const [itemTitle, setItemTitle] = useState('');
  const [priceCkb, setPriceCkb] = useState('2');
  const [generated, setGenerated] = useState('');
  const [received, setReceived] = useState('');
  const [offer, setOffer] = useState<EncryptedOffer | null>(null);
  const [attempt, setAttempt] = useState('');
  const [tested, setTested] = useState(false);
  const [payment, setPayment] = useState<GetPaymentResult | null>(null);
  const [key, setKey] = useState('');
  const [decrypted, setDecrypted] = useState('');
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog());
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const saved = readEncryptedProgress(sessionStorage, localStorage);
        progress.current = saved;
        setCatalog(readCatalog(localStorage));
        if (saved) {
          setGenerated(saved.generatedOffer);
          setReceived(saved.buyerOfferText);
          setAttempt(saved.attemptedPaymentHash);
          setTested(saved.triedWithoutKey);
        }
      }
    } catch (e) {
      console.warn('Storage read warning:', e);
    } finally {
      setLoaded(true);
    }
    const owned = sessions.current;
    const stop = () => { for (const session of Object.values(owned)) void session.stop().catch(() => {}); };
    window.addEventListener('pagehide', stop);
    return () => { window.removeEventListener('pagehide', stop); stop(); nodes.current = {}; sessions.current = {}; };
  }, []);

  function save(update: Partial<EncryptedLessonProgress>) {
    const buyerId = savedNodeIdentifier(localStorage, encryptedBuyerProfile);
    const sellerId = savedNodeIdentifier(localStorage, encryptedSellerProfile);
    if (!buyerId || !sellerId) throw new Error('Start both saved nodes before continuing.');
    const next = { version: 1 as const, buyerId, sellerId, generatedOffer: '', buyerOfferText: '', attemptedPaymentHash: '', triedWithoutKey: false, ...progress.current, ...update };
    sessionStorage.setItem(encryptedSessionKey, JSON.stringify(next));
    progress.current = next;
  }

  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Action failed. Check status before retrying a transfer.'); }
    finally { locked.current = false; setBusy(false); }
  }

  async function refresh(role: Role) {
    const node = nodes.current[role];
    if (!node) return;
    const channel = await readChannel(node);
    const { peers } = await node.listPeers();
    setConnected((previous) => ({ ...previous, [role]: peers.some(peer => peer.pubkey.replace(/^0x/i, '').toLowerCase() === bottle.pubkey.slice(2)) }));
    setChannels((previous) => ({ ...previous, [role]: channel }));
  }

  async function start(role: Role) {
    if (nodes.current[role]) return;
    const session = sessions.current[role] ??= createBrowserNodeSession();
    let started: FiberBrowserNode | undefined;
    await session.start(role === 'buyer' ? encryptedBuyerProfile : encryptedSellerProfile, async (track) => {
      started = await startRole(role, track);
    });
    if (!started) return;
    nodes.current[role] = started;
    const info = await started.nodeInfo();
    setAddresses((previous) => ({ ...previous, [role]: scriptToAddress(info.default_funding_lock_script, 'testnet') }));
    if (await readChannel(started)) await started.connectPeer(bottle);
    await refresh(role);
  }

  async function open(role: Role) {
    const node = nodes.current[role];
    if (!node) return;
    const channel = await connectAndOpenChannel(node);
    setChannels((previous) => ({ ...previous, [role]: channel }));
    await refresh(role);
    setStatus(channel && ready(channel) ? 'Channel ready.' : 'Opening submitted. Check channel status after confirmation.');
  }

  async function moveLiquidity() {
    const node = nodes.current.seller;
    if (!node) return;
    const id = savedNodeIdentifier(localStorage, encryptedSellerProfile);
    const storageKey = `fiber-docs:encrypted-inbound:${id}`;
    const existing = sessionStorage.getItem(storageKey);
    if (existing === 'submitting') throw new Error('Transfer outcome unknown. Review payment history before sending again.');
    let result: GetPaymentResult;
    if (existing) result = await node.getPayment({ payment_hash: existing as `0x${string}` });
    else {
      sessionStorage.setItem(storageKey, 'submitting');
      result = await node.sendPayment({ target_pubkey: bottle.pubkey, amount: '0x1dcd65000', keysend: true });
      sessionStorage.setItem(storageKey, result.payment_hash);
    }
    if (!['Success', 'Failed'].includes(result.status)) result = await node.waitForPayment(result.payment_hash, { timeout: 60_000, interval: 1_000 });
    if (result.status === 'Failed') sessionStorage.removeItem(storageKey);
    setStatus(`Liquidity transfer: ${result.status}`);
    await refresh('seller');
  }

  async function makeOffer() {
    setError('');
    if (!plaintext.trim()) {
      setError('Please type some secret text into the "Secret Content to Encrypt" box first.');
      return;
    }
    if (!nodes.current.seller) {
      setError('Please click "Start node" under Seller C first.');
      return;
    }
    if (!channels.seller || !ready(channels.seller)) {
      setError('Seller C channel is not ready. Please open the channel and wait for its status to reach CHANNEL_READY.');
      return;
    }
    const numericPrice = parseFloat(priceCkb);
    if (isNaN(numericPrice) || numericPrice <= 0) {
      setError('Please enter a valid price greater than 0 CKB.');
      return;
    }
    const title = itemTitle.trim() || 'Encrypted Digital Product';
    const value = await createOffer(
      nodes.current.seller,
      channels.seller,
      plaintext,
      numericPrice,
      title,
    );
    save({ generatedOffer: value });
    setGenerated(value);
    setStatus(`Invoice created for ${numericPrice} CKB. Copy the offer below and paste it into Buyer.`);
  }

  function commit(next: Catalog) { writeCatalog(localStorage, next); setCatalog(next); }

  function saveProduct() {
    const numericPrice = parseFloat(priceCkb);
    commit(addProduct(catalog, { title: itemTitle || 'Encrypted Digital Product', priceCkb: numericPrice, secret: plaintext }));
    setStatus('Product saved to your catalog. Issue an offer for each buyer below.');
  }

  async function issueOffer(product: Product) {
    const seller = nodes.current.seller;
    if (!seller || !channels.seller || !ready(channels.seller)) throw new Error('Start Seller C and wait for CHANNEL_READY first.');
    const value = await createOffer(seller, channels.seller, product.secret, product.priceCkb, product.title);
    const { paymentHash } = JSON.parse(value) as { paymentHash: `0x${string}` };
    commit(recordSale(catalog, { productId: product.id, paymentHash, priceCkb: product.priceCkb, offer: value }));
    await navigator.clipboard.writeText(value).catch(() => {});
    setStatus(`Offer for "${product.title}" issued (one buyer) and copied. Send it to the buyer.`);
  }

  async function checkSales() {
    const seller = nodes.current.seller;
    if (!seller) throw new Error('Start Seller C first.');
    let next = catalog;
    for (const sale of catalog.sales.filter((x) => x.status === 'issued')) {
      const { status: invoiceStatus } = await seller.getInvoice({ payment_hash: sale.paymentHash });
      next = updateSaleStatus(next, sale.paymentHash, saleStatusFromInvoice(invoiceStatus));
    }
    commit(next);
    setStatus('Sales updated from invoice status.');
  }

  async function validate() {
    if (!nodes.current.buyer) return;
    const parsed = parseOffer(received);
    const invoice = await validateOffer(nodes.current.buyer, parsed);
    if (invoice.amount) {
      parsed.amount = invoice.amount as `0x${string}`;
    }
    if (attempt && parsed.paymentHash.toLowerCase() !== attempt.toLowerCase()) throw new Error('Restore the offer for the previous payment.');
    save({ buyerOfferText: received }); setOffer(parsed); setStatus('Offer validated.');
  }

  async function testLock() {
    if (!offer) return;
    try { await decryptResult(offer, toHex(crypto.getRandomValues(new Uint8Array(32)))); }
    catch { save({ triedWithoutKey: true }); setTested(true); setStatus('Decryption rejected: key unavailable.'); }
  }

  async function pay() {
    if (!nodes.current.buyer || !offer || !tested) return;
    if (!channels.buyer || !ready(channels.buyer)) {
      setError('Buyer A channel must reach CHANNEL_READY before paying.');
      return;
    }
    const result = await payForOffer(nodes.current.buyer, offer, attempt, (hash) => {
      save({ attemptedPaymentHash: hash }); setAttempt(hash);
    }, payment?.status === 'Failed');
    acceptPayment(result);
    await Promise.all([refresh('buyer'), refresh('seller')]);
  }

  function acceptPayment(result: GetPaymentResult) {
    setPayment(result); setStatus(`Payment: ${result.status}`);
    if (result.status === 'Failed') setError(result.failed_error ?? 'Payment failed. Check channel liquidity before retrying.');
    if (result.status === 'Success' && result.payment_preimage) setKey(result.payment_preimage);
  }

  async function checkPayment() {
    if (!nodes.current.buyer || !offer || !attempt) return;
    await validateOffer(nodes.current.buyer, offer);
    acceptPayment(await nodes.current.buyer.getPayment({ payment_hash: attempt as `0x${string}` }));
  }

    function startAnotherOffer() {
      if (busy) return;
      save({ generatedOffer: '', buyerOfferText: '', attemptedPaymentHash: '', triedWithoutKey: false, completedSteps: [] });
      setGenerated(''); setReceived(''); setOffer(null); setAttempt(''); setTested(false);
      setPayment(null); setKey(''); setDecrypted(''); setError(''); setPlaintext(''); setItemTitle('');
      setStatus('Ready to create a fresh encrypted offer.');
    }

  // Buyer figures come only from the validated offer, never from the seller form or a default.
  const offerAmount = offer?.amount ? BigInt(offer.amount) : null;
  const routeReady = Boolean(
    offerAmount !== null && connected.buyer && connected.seller && channels.buyer && ready(channels.buyer)
    && BigInt(channels.buyer.local_balance) >= offerAmount
    && channels.seller && ready(channels.seller)
    && BigInt(channels.seller.remote_balance) >= offerAmount,
  );
  const canSubmit = Boolean(offer && tested && !key && (!attempt || payment?.status === 'Failed'));

  const sum = summarize(catalog);
  const bothReady = Boolean(channels.buyer && ready(channels.buyer) && channels.seller && ready(channels.seller));
  const stepDone = [bothReady, catalog.products.length > 0 || Boolean(generated), payment?.status === 'Success', Boolean(decrypted)];
  const stepNow = stepDone.findIndex((d) => !d);
  const tone = (state: string) => state === 'CHANNEL_READY' ? 'ok' : /CLOSED|FAIL/i.test(state) ? 'bad' : 'warn';
  const saleTone = (st: string) => st === 'paid' ? 'ok' : st === 'issued' ? 'warn' : 'bad';

  return <main>
    <header className="hero">
      <p className="eyebrow">Nervos CKB · Fiber testnet</p>
      <h1>Sell data. Get paid.<br />Unlock on payment.</h1>
      <p className="lede">Encrypt anything, price it in CKB, and hand the buyer a locked offer. Their payment is the only thing that reveals the key. There is no escrow and no middleman.</p>
    </header>
    <ol className="flow" aria-label="Progress">
      {['Open channels', 'List a product', 'Buyer pays', 'Unlock content'].map((label, n) =>
        <li key={label} className={stepDone[n] ? 'done' : n === stepNow ? 'now' : ''}>{label}</li>)}
    </ol>
    {status && <p className="banner ok" role="status">{status}</p>}
    {error && <p className="banner err" role="alert">{error}</p>}

    <div className="section-title"><span>Step 1</span><h2>Set up nodes &amp; channels</h2></div>
    <div className="grid">{(['buyer', 'seller'] as const).map((role) => <section className="card" key={role}>
      <header><h2>{role === 'buyer' ? 'Buyer A' : 'Seller C'}</h2>
        {channels[role] ? <span className={`pill ${tone(channels[role].state.state_name)}`}>{channels[role].state.state_name}</span> : <span className="pill">{addresses[role] ? 'No channel' : 'Not started'}</span>}</header>
      {!addresses[role] && <button className="primary" disabled={busy} onClick={() => void run(() => start(role))}>Start node</button>}
      {addresses[role] && <>
        <code className="addr">{addresses[role]}</code>
        <a className="btn" href="https://faucet.nervos.org" target="_blank" rel="noreferrer">Get testnet CKB ↗</a>
        {!channels[role] && <p className="sub">{channelFundingGuidance}</p>}
        <div className="actions">
          <button className={channels[role] ? '' : 'primary'} disabled={busy} onClick={() => void run(() => open(role))}>{channels[role] ? 'Reconnect / check channel' : `Open ${channelFundingCkb} CKB channel`}</button>
          <button className="ghost" disabled={busy} onClick={() => void run(() => refresh(role))}>Refresh</button>
        </div>
      </>}
      {channels[role] && <p className="sub">{role === 'buyer' ? 'Buyer' : 'Seller'}: <b>{ckb(channels[role].local_balance)} CKB</b> · Bottle: <b>{ckb(channels[role].remote_balance)} CKB</b></p>}
    </section>)}</div>
    <section className="card">
      <header><h2>Liquidity</h2></header>
      <p className="sub">Move 5 CKB to Bottle so the seller has inbound capacity to receive payments.</p>
      <div className="actions"><button disabled={busy || !channels.seller || !ready(channels.seller) || BigInt(channels.seller.local_balance) < 500_000_000n} onClick={() => void run(moveLiquidity)}>Send / check 5 CKB transfer</button></div>
    </section>

    <div className="section-title"><span>Step 2</span><h2>Seller storefront</h2></div>
    <div className="grid">
      <section className="card">
        <header><h2>New product</h2><span className="pill">AES-256-GCM</span></header>
        <label className="field"><span>Product title</span>
          <input type="text" placeholder="e.g. Alpha report, VIP API key" disabled={busy} value={itemTitle} onChange={e => setItemTitle(e.target.value)} /></label>
        <label className="field"><span>Price (CKB)</span>
          <input type="number" min="0.1" step="0.5" placeholder="2" disabled={busy} value={priceCkb} onChange={e => setPriceCkb(e.target.value)} /></label>
        <label className="field"><span>Secret content</span>
          <textarea aria-label="Seller result" placeholder="The text, report or key you want to sell…" disabled={busy} value={plaintext} onChange={e => setPlaintext(e.target.value)} /></label>
        <div className="actions">
          <button className="primary" disabled={busy} onClick={() => void run(async () => saveProduct())}>Save as product</button>
          <button disabled={busy} onClick={() => void run(makeOffer)}>{`One-off offer · ${priceCkb || '1'} CKB`}</button>
        </div>
        {generated && <>
          <label className="field"><span>Generated offer</span><textarea aria-label="Generated offer" readOnly value={generated} /></label>
          <button disabled={busy} onClick={() => void run(async () => { await navigator.clipboard.writeText(generated); setStatus('Offer copied to clipboard. Now paste it into the Buyer section.'); })}>Copy offer</button>
        </>}
      </section>
      <section className="card">
        <header><h2>Catalog &amp; sales</h2></header>
        <div className="stats">
          <div className="stat"><b>{sum.totalSold}</b><small>Sold</small></div>
          <div className="stat"><b>{sum.totalRevenueCkb}</b><small>CKB earned</small></div>
          <div className="stat"><b>{sum.openOffers}</b><small>Open offers</small></div>
        </div>
        {catalog.products.length === 0 && <p className="empty">No products yet. Fill in the form and click “Save as product”.</p>}
        {catalog.products.map((product) => { const row = sum.byProduct.get(product.id); return <div className="item" key={product.id}>
          <div><h3>{product.title}</h3><p className="sub">{product.priceCkb} CKB · sold {row?.sold ?? 0} · open {row?.open ?? 0}</p></div>
          <div className="actions">
            <button className="primary" disabled={busy} onClick={() => void run(() => issueOffer(product))}>Issue offer for a buyer</button>
            <button className="ghost danger" disabled={busy} onClick={() => commit(removeProduct(catalog, product.id))}>Delist</button>
          </div>
        </div>; })}
        {catalog.sales.length > 0 && <div>
          <div className="actions" style={{ marginBottom: 6 }}><button disabled={busy || !addresses.seller} onClick={() => void run(checkSales)}>Check payments</button></div>
          {catalog.sales.map((sale) => <div className="sale" key={sale.id}>
            <code>{sale.paymentHash.slice(0, 14)}…</code><span>{sale.priceCkb} CKB</span><span className={`pill ${saleTone(sale.status)}`}>{sale.status}</span></div>)}
        </div>}
      </section>
    </div>

    <div className="section-title"><span>Step 3</span><h2>Buyer checkout</h2></div>
    <section className="card">
      {offer && <div className="offer-card">
        <div><p className="sub">You are buying</p><h2>{offer.itemTitle || 'Encrypted item'}</h2></div>
        <div className="price">{offerAmount !== null ? `${ckb(offer.amount!)} CKB` : 'Unknown price'}</div>
      </div>}
      <label className="field"><span>Offer from seller</span>
        <textarea aria-label="Received offer" placeholder="Paste the copied offer JSON here…" disabled={busy || (Boolean(attempt) && payment?.status !== 'Failed')} value={received}
          onChange={e => { setReceived(e.target.value); setOffer(null); setTested(false); setPayment(null); setKey(''); setDecrypted(''); }} /></label>
      <div className="actions">
        <button className={offer ? '' : 'primary'} disabled={busy || !received.trim() || !addresses.buyer || Boolean(offer)} onClick={() => void run(validate)}>Validate offer</button>
        {offer && !tested && <button className="primary" disabled={busy} onClick={() => void run(testLock)}>Try decrypting without key</button>}
        {canSubmit && offerAmount !== null && <button className="primary" disabled={busy} onClick={() => void run(pay)}>{attempt ? 'Retry failed payment' : `Pay ${ckb(offer!.amount!)} CKB`}</button>}
        {attempt && !key && <button disabled={busy || !offer || !addresses.buyer} onClick={() => void run(checkPayment)}>Check payment status</button>}
        <button className={key && !decrypted ? 'primary' : ''} disabled={busy || !offer || !key || Boolean(decrypted)} onClick={() => void run(async () => { setDecrypted(await decryptResult(offer!, key)); })}>Decrypt with revealed key</button>
      </div>
    </section>
    {payment?.status === 'Success' && <section className="card">
      <header><h2>Payment receipt</h2><span className="pill ok">Settled</span></header>
      <div className="receipt">
        <div className="stat"><small>Item</small><b style={{ fontSize: 16 }}>{offer?.itemTitle || 'Encrypted item'}</b></div>
        <div className="stat"><small>Price</small><b>{offerAmount !== null ? ckb(offerAmount.toString()) : '?'} CKB</b></div>
        <div className="stat"><small>Routing fee</small><b>{ckb(payment.fee)} CKB</b></div>
        <div className="stat"><small>Total</small><b>{offerAmount !== null ? ckb(`0x${(offerAmount + BigInt(payment.fee)).toString(16)}`) : '?'} CKB</b></div>
      </div>
      <code>{payment.payment_hash}</code>
    </section>}
    {decrypted && <section className="result">
      <header className="actions" style={{ justifyContent: 'space-between' }}><h2>Unlocked content</h2><span className="pill ok">Decrypted</span></header>
      <pre>{decrypted}</pre>
      <div className="actions"><button className="primary" onClick={() => void run(async () => { await navigator.clipboard.writeText(decrypted); setStatus('Decrypted content copied to clipboard.'); })}>Copy decrypted content</button></div>
    </section>}
    {(generated || received) && <div className="actions"><button className="ghost" disabled={busy} onClick={() => void run(async () => startAnotherOffer())}>Reset / start another offer</button></div>}
  </main>;
}
