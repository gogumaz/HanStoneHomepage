const TOSS_PAYMENTS_SDK_URL = 'https://js.tosspayments.com/v2/standard';

type TossPaymentsFactory = NonNullable<Window['TossPayments']>;

let sdkPromise: Promise<TossPaymentsFactory> | null = null;

function currentFactory(): TossPaymentsFactory | null {
  return typeof window.TossPayments === 'function' ? window.TossPayments : null;
}

export async function loadTossPaymentsSdk(): Promise<TossPaymentsFactory> {
  const loaded = currentFactory();
  if (loaded) return loaded;
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<TossPaymentsFactory>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TOSS_PAYMENTS_SDK_URL}"]`);
    const script = existing ?? document.createElement('script');

    const handleLoad = () => {
      const factory = currentFactory();
      if (factory) resolve(factory);
      else reject(new Error('TOSS_PAYMENTS_SDK_INVALID'));
    };
    const handleError = () => reject(new Error('TOSS_PAYMENTS_SDK_LOAD_FAILED'));

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    if (!existing) {
      script.src = TOSS_PAYMENTS_SDK_URL;
      script.async = true;
      script.dataset.tossPaymentsSdk = 'true';
      document.head.append(script);
    }
  });

  try {
    return await sdkPromise;
  } catch (error) {
    sdkPromise = null;
    throw error;
  }
}
