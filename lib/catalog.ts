// Seller-side model: a Product you list once, and a Sale per buyer offer.
// One Fiber invoice = one preimage = one buyer. To sell a Product again you issue
// a NEW offer (fresh key + fresh invoice), recorded as a new Sale.

export const catalogStorageKey = 'fiber-docs:seller-catalog-v1';

export type Product = {
  id: string;
  title: string;
  description: string;
  priceCkb: number;
  secret: string; // plaintext you sell; kept only on this device
  createdAt: number;
};

export type SaleStatus = 'issued' | 'paid' | 'expired' | 'cancelled';

export type Sale = {
  id: string;
  productId: string;
  paymentHash: `0x${string}`;
  priceCkb: number;
  offer: string; // encrypted offer JSON to hand to the buyer
  status: SaleStatus;
  issuedAt: number;
  paidAt?: number;
};

export type Catalog = { version: 1; products: Product[]; sales: Sale[] };

export const emptyCatalog = (): Catalog => ({ version: 1, products: [], sales: [] });

const newId = () => crypto.randomUUID();

export function validateProductInput(input: { title: string; priceCkb: number; secret: string }) {
  if (!input.title.trim()) throw new Error('Product needs a title.');
  if (!Number.isFinite(input.priceCkb) || input.priceCkb <= 0) throw new Error('Price must be greater than 0 CKB.');
  if (!input.secret.trim()) throw new Error('Product needs secret content to sell.');
}

export function addProduct(
  catalog: Catalog,
  input: { title: string; description?: string; priceCkb: number; secret: string },
  now = Date.now(),
): Catalog {
  validateProductInput(input);
  const product: Product = {
    id: newId(), title: input.title.trim(), description: (input.description ?? '').trim(),
    priceCkb: input.priceCkb, secret: input.secret, createdAt: now,
  };
  return { ...catalog, products: [product, ...catalog.products] };
}

export function removeProduct(catalog: Catalog, productId: string): Catalog {
  // Sales history is kept so revenue stays accurate after a product is delisted.
  return { ...catalog, products: catalog.products.filter((p) => p.id !== productId) };
}

export function recordSale(
  catalog: Catalog,
  sale: { productId: string; paymentHash: `0x${string}`; priceCkb: number; offer: string },
  now = Date.now(),
): Catalog {
  if (!catalog.products.some((p) => p.id === sale.productId)) throw new Error('Unknown product.');
  if (catalog.sales.some((s) => s.paymentHash.toLowerCase() === sale.paymentHash.toLowerCase())) {
    throw new Error('A sale with this payment hash already exists.');
  }
  return { ...catalog, sales: [{ id: newId(), status: 'issued', issuedAt: now, ...sale }, ...catalog.sales] };
}

// Map a Fiber invoice status onto a sale status. 'Received' means the HTLC arrived
// but is not settled yet, so the sale is still open.
export function saleStatusFromInvoice(invoiceStatus: string): SaleStatus {
  switch (invoiceStatus) {
    case 'Paid': return 'paid';
    case 'Expired': return 'expired';
    case 'Cancelled': return 'cancelled';
    default: return 'issued';
  }
}

export function updateSaleStatus(catalog: Catalog, paymentHash: string, status: SaleStatus, now = Date.now()): Catalog {
  return {
    ...catalog,
    sales: catalog.sales.map((s) => s.paymentHash.toLowerCase() !== paymentHash.toLowerCase() || s.status === status
      ? s
      : { ...s, status, ...(status === 'paid' ? { paidAt: now } : {}) }),
  };
}

export function summarize(catalog: Catalog) {
  const paid = catalog.sales.filter((s) => s.status === 'paid');
  const byProduct = new Map<string, { sold: number; revenueCkb: number; open: number }>();
  for (const product of catalog.products) byProduct.set(product.id, { sold: 0, revenueCkb: 0, open: 0 });
  for (const sale of catalog.sales) {
    const row = byProduct.get(sale.productId);
    if (!row) continue;
    if (sale.status === 'paid') { row.sold += 1; row.revenueCkb += sale.priceCkb; }
    else if (sale.status === 'issued') row.open += 1;
  }
  return {
    totalSold: paid.length,
    totalRevenueCkb: paid.reduce((sum, s) => sum + s.priceCkb, 0),
    openOffers: catalog.sales.filter((s) => s.status === 'issued').length,
    byProduct,
  };
}

export function readCatalog(storage: Pick<Storage, 'getItem'>): Catalog {
  try {
    const value = JSON.parse(storage.getItem(catalogStorageKey) ?? 'null');
    if (value?.version === 1 && Array.isArray(value.products) && Array.isArray(value.sales)) return value as Catalog;
  } catch { /* fall through */ }
  return emptyCatalog();
}

export function writeCatalog(storage: Pick<Storage, 'setItem'>, catalog: Catalog) {
  storage.setItem(catalogStorageKey, JSON.stringify(catalog));
}
