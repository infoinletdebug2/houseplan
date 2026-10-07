import { Platform } from 'react-native';
import type { Purchase, PurchaseIOS, PurchaseAndroid } from 'react-native-iap';
import { api } from '../api/client';
import type { Entitlement } from '../types';
import { IS_EXPO_GO, PRODUCT_IDS } from '../config';
import { purchaseCompleted } from '../lib/analytics';

/**
 * react-native-iap is loaded LAZILY, and that is not an optimisation.
 *
 * The module reaches for the native bridge at import time. A plain
 * `import * as IAP` therefore throws `__fbBatchedBridgeConfig is not set`
 * anywhere the native side is absent — the web build, and Expo Go — and it
 * throws while the module graph is being evaluated, so it takes down the
 * whole route rather than the one call that needed a store. The paywall then
 * renders as a blank screen with no error anybody can see.
 *
 * Behind `await import()` the failure lands where it belongs: inside
 * `isAvailable()`, which already answers false for "there is no store here",
 * and which every caller already handles.
 */
type IapModule = typeof import('react-native-iap');

let iapPromise: Promise<IapModule | null> | undefined;

function loadIap(): Promise<IapModule | null> {
  // Not even attempted in Expo Go. The import cannot succeed there, and the
  // attempt paints a red error screen over the paywall on its way to being
  // caught. See IS_EXPO_GO in config.ts.
  if (IS_EXPO_GO) return Promise.resolve(null);
  // Cached as the PROMISE, not the module: two callers racing on first launch
  // would otherwise both start an import, and on a slow device that is two
  // evaluations of a large native module.
  iapPromise ??= import('react-native-iap').then(
    (module) => module,
    () => null,
  );
  return iapPromise;
}

/**
 * Buying HousePlan (BRD §2.2, §5.3: hard paywall, no free trial).
 *
 * ## The division of labour, and why it is not negotiable
 *
 *   - the **device** completes the purchase and gets back a transaction id
 *     (iOS) or a purchase token (Android);
 *   - the **server** decides whether it is real and what it grants.
 *
 * Nothing here writes an entitlement. `POST /billing/reconcile`
 * returns the entitlement, and that return value is the only thing the app believes. An app that
 * unlocks on the store callback alone unlocks for anybody who can fake one.
 *
 * ## The library's API is event-based, and this module is not
 *
 * react-native-iap v16 is OpenIAP: `requestPurchase()` returns nothing useful
 * and the result arrives later on `purchaseUpdatedListener`. That is a fine
 * shape for an app that buys things from many screens and a bad one for a
 * paywall with a single button, so `purchase()` bridges it back into a promise
 * — listeners attached BEFORE the request, both resolved and torn down once,
 * and a timeout so a store that never answers fails visibly instead of leaving
 * a spinner running for the rest of the session.
 *
 * ## None of this runs in Expo Go
 *
 * StoreKit and Play Billing are native. In Expo Go `initConnection` throws, so
 * `isAvailable()` answers honestly and the paywall says so rather than
 * offering a button that cannot work.
 */

export { PRODUCT_IDS };

export type PlanPeriod = 'monthly' | 'yearly';

/** One purchasable plan, with the store's own localised price string. */
export interface StorePlan {
  productId: string;
  period: PlanPeriod;
  /** Exactly as the store formats it — "$9.99", "৳499". Never re-formatted. */
  price: string;
  title: string;
  /** The store's own number and currency, for per-month framing only. */
  amount: number | null;
  currency: string | null;
}

/** The person dismissed the store sheet. Not an error. */
export class PurchaseCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'PurchaseCancelled';
  }
}

let connected = false;

/**
 * Open the store connection, once.
 *
 * Returns false rather than throwing when there is no store — Expo Go, a
 * simulator without a sandbox account, a device missing Play Services. Every
 * caller has a sensible thing to do with false and nothing sensible to do with
 * an exception.
 */
/**
 * Harness only (web build, never a phone): `localStorage['houseplan.harnessStore']
 * = '1'` makes the store answer with sample prices so the paywall and the
 * welcome offer can be screenshotted and tapped through. Purchases still fail.
 */
function harnessStore(): boolean {
  if (Platform.OS !== 'web') return false;
  try {
    return globalThis.localStorage?.getItem('houseplan.harnessStore') === '1';
  } catch {
    return false;
  }
}

const HARNESS_PRICES: Record<string, { price: string; amount: number }> = {
  [PRODUCT_IDS.monthly]: { price: '$14.99', amount: 14.99 },
  [PRODUCT_IDS.yearly]: { price: '$99.99', amount: 99.99 },
};

export async function isAvailable(): Promise<boolean> {
  if (harnessStore()) return true;
  if (connected) return true;
  const IAP = await loadIap();
  if (!IAP) return false;
  try {
    await IAP.initConnection();
    connected = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * The plans this store will sell, priced by the store itself.
 *
 * **Prices always come from here, never from the server.** They are localised
 * per storefront and change with currency and region; a price rendered from a
 * server constant is the wrong number for most of the world and a store
 * rejection for the rest.
 */
export async function loadPlans(): Promise<StorePlan[]> {
  const ids = PRODUCT_IDS;
  if (harnessStore()) {
    return (['monthly', 'yearly'] as const).map((period) => ({
      productId: ids[period],
      period,
      price: HARNESS_PRICES[ids[period]]!.price,
      title: period === 'yearly' ? 'Yearly' : 'Monthly',
      amount: HARNESS_PRICES[ids[period]]!.amount,
      currency: 'USD',
    }));
  }
  if (!(await isAvailable())) return [];
  const IAP = await loadIap();
  if (!IAP) return [];

  const wanted: Array<{ productId: string; period: PlanPeriod }> = [
    { productId: ids.monthly, period: 'monthly' },
    { productId: ids.yearly, period: 'yearly' },
  ];

  const found = await IAP.fetchProducts({
    skus: wanted.map((entry) => entry.productId),
    type: 'subs',
  }).catch(() => null);

  const products = found ?? [];

  return wanted.flatMap((entry) => {
    const product = products.find((candidate) => candidate?.id === entry.productId);
    // A product the store does not return is one that is not configured, not
    // approved yet, or not available in this storefront. Dropping it shows a
    // paywall with one plan instead of one with a blank price.
    if (!product) return [];
    return [
      {
        productId: entry.productId,
        period: entry.period,
        price: product.displayPrice ?? '',
        title: product.title ?? (entry.period === 'yearly' ? 'Yearly' : 'Monthly'),
        amount: typeof (product as { price?: unknown }).price === 'number' ? (product as { price: number }).price : null,
        currency: typeof (product as { currency?: unknown }).currency === 'string' ? (product as { currency: string }).currency : null,
      },
    ];
  });
}

/** How long to wait for the store before calling it a failure. */
const PURCHASE_TIMEOUT_MS = 120_000;

/**
 * Buy one, and return the plan the server granted for it.
 *
 * `finishTransaction` runs only AFTER the server has answered. Finishing first
 * tells the store the purchase is handled while this app has not recorded it —
 * and iOS then stops redelivering the transaction, so a failure at exactly
 * that moment loses the purchase permanently.
 */
export async function purchase(productId: string): Promise<Entitlement> {
  if (!(await isAvailable())) {
    throw new Error('Purchases are not available in this build.');
  }
  const IAP = await loadIap();
  if (!IAP) throw new Error('Purchases are not available in this build.');

  const result = await new Promise<Purchase>((resolve, reject) => {
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      updated.remove();
      failed.remove();
      fn();
    };

    // Attached BEFORE the request. A store that answers instantly — a cached
    // sandbox purchase does — would otherwise emit before anything is
    // listening, and the promise would hang on a purchase that worked.
    const updated = IAP.purchaseUpdatedListener((event) => {
      if (event.productId !== productId) return;
      finish(() => resolve(event));
    });

    const failed = IAP.purchaseErrorListener((error) => {
      finish(() =>
        reject(
          error?.code === IAP.ErrorCode.UserCancelled
            ? new PurchaseCancelled()
            : new Error(error?.message ?? 'The purchase did not complete.'),
        ),
      );
    });

    const timer = setTimeout(() => {
      finish(() => reject(new Error('The store did not respond. Try again.')));
    }, PURCHASE_TIMEOUT_MS);

    IAP.requestPurchase({
      type: 'subs',
      request: {
        apple: { sku: productId },
        google: { skus: [productId] },
      },
    }).catch((failure: unknown) => {
      finish(() =>
        reject(
          (failure as { code?: string })?.code === IAP.ErrorCode.UserCancelled
            ? new PurchaseCancelled()
            : failure,
        ),
      );
    });
  });

  const plan = await verify(result, 'purchase');
  await IAP.finishTransaction({ purchase: result, isConsumable: false }).catch(() => undefined);
  const period = productId === PRODUCT_IDS.yearly ? 'yearly' : 'monthly';
  const eventId = Platform.OS === 'ios' ? ((result as PurchaseIOS).transactionId ?? result.id) : ((result as PurchaseAndroid).purchaseToken ?? result.id).slice(0, 64);
  purchaseCompleted(productId, period, String(eventId));
  return plan;
}

/** Hand one purchase to the server and take back the plan it grants. */
async function verify(result: Purchase, reason: 'purchase' | 'restore'): Promise<Entitlement> {
  const path = '/billing/reconcile';
  if (Platform.OS === 'ios') {
    const ios = result as PurchaseIOS;
    return api.post<Entitlement>(path, {
      reason,
      platform: 'apple',
      transaction_id: ios.transactionId ?? ios.id,
    });
  }
  const android = result as PurchaseAndroid;
  return api.post<Entitlement>(path, {
    reason,
    platform: 'google',
    product_id: android.productId,
    purchase_token: android.purchaseToken,
  });
}

/**
 * Restore. Apple requires this button on any paywall it reviews.
 *
 * The two stores need different work. Apple can answer for the whole customer
 * from any one chain id, so the newest owned purchase is enough. Play has no
 * such call, so every owned purchase is replayed through `/verify` — which is
 * idempotent on the chain id, so replaying costs nothing.
 *
 * `null` means "nothing to restore", which is a normal answer and not a
 * failure: it is what somebody who never subscribed will get.
 */
export async function restore(): Promise<Entitlement | null> {
  if (!(await isAvailable())) return null;
  const IAP = await loadIap();
  if (!IAP) return null;

  const owned = await IAP.getAvailablePurchases().catch(() => []);
  const list = owned ?? [];
  if (list.length === 0) return null;

  if (Platform.OS === 'ios') {
    const newest = list[list.length - 1] as PurchaseIOS | undefined;
    if (!newest) return null;
    const chain = newest.originalTransactionIdentifierIOS ?? newest.transactionId ?? newest.id;
    if (!chain) return null;
    return api.post<Entitlement>('/billing/reconcile', { reason: 'restore', platform: 'apple', original_transaction_id: chain });
  }

  const purchases = list.map((p) => ({ product_id: (p as PurchaseAndroid).productId, purchase_token: (p as PurchaseAndroid).purchaseToken })).filter((p) => p.purchase_token);
  if (purchases.length === 0) return null;
  return api.post<Entitlement>('/billing/reconcile', { reason: 'restore', platform: 'google', purchases });
}

/** Close the connection. Called when the paywall unmounts. */
export async function disconnect(): Promise<void> {
  if (!connected) return;
  connected = false;
  const IAP = await loadIap();
  await IAP?.endConnection().catch(() => undefined);
}
