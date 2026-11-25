import assert from 'node:assert/strict';
import test from 'node:test';
import { addProduct, emptyCatalog, readCatalog, recordSale, removeProduct, saleStatusFromInvoice, summarize, updateSaleStatus, writeCatalog } from './lib/catalog.ts';

const h1 = `0x${'a'.repeat(64)}`;
const h2 = `0x${'b'.repeat(64)}`;
const base = () => addProduct(emptyCatalog(), { title: 'Report', priceCkb: 2, secret: 's3cret' });

test('products need a title, positive price and secret', () => {
  for (const bad of [{ title: ' ', priceCkb: 1, secret: 'x' }, { title: 'a', priceCkb: 0, secret: 'x' }, { title: 'a', priceCkb: NaN, secret: 'x' }, { title: 'a', priceCkb: 1, secret: ' ' }]) {
    assert.throws(() => addProduct(emptyCatalog(), bad));
  }
});
test('one product can be sold repeatedly, once per payment hash', () => {
  let c = base();
  const id = c.products[0].id;
  c = recordSale(c, { productId: id, paymentHash: h1, priceCkb: 2, offer: '{}' });
  c = recordSale(c, { productId: id, paymentHash: h2, priceCkb: 2, offer: '{}' });
  assert.throws(() => recordSale(c, { productId: id, paymentHash: h1, priceCkb: 2, offer: '{}' }), /already exists/);
  assert.throws(() => recordSale(c, { productId: 'nope', paymentHash: `0x${'c'.repeat(64)}`, priceCkb: 2, offer: '{}' }), /Unknown/);
});
test('revenue counts only paid sales and survives delisting', () => {
  let c = base();
  const id = c.products[0].id;
  c = recordSale(c, { productId: id, paymentHash: h1, priceCkb: 2, offer: '{}' });
  c = recordSale(c, { productId: id, paymentHash: h2, priceCkb: 2, offer: '{}' });
  c = updateSaleStatus(c, h1, saleStatusFromInvoice('Paid'));
  c = updateSaleStatus(c, h2, saleStatusFromInvoice('Received'));
  let s = summarize(c);
  assert.equal(s.totalRevenueCkb, 2); assert.equal(s.openOffers, 1);
  assert.deepEqual(s.byProduct.get(id), { sold: 1, revenueCkb: 2, open: 1 });
  c = removeProduct(c, id);
  assert.equal(summarize(c).totalRevenueCkb, 2);
});
test('catalog round-trips storage and bad data yields an empty catalog', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const c = base();
  writeCatalog(storage, c);
  assert.deepEqual(readCatalog(storage), c);
  mem.set('fiber-docs:seller-catalog-v1', '{bad');
  assert.deepEqual(readCatalog(storage), emptyCatalog());
});
