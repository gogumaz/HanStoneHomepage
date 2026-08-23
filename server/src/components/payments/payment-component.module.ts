import { type DynamicModule, type FactoryProvider, Module } from "@nestjs/common";
import { PAYMENT_PROVIDER, type PaymentProvider } from "./payment-provider.js";
import { PortOneV1PaymentProvider, type PortOneV1Options } from "./portone-v1.provider.js";

export type PaymentComponentOptions = {
  provider: "portone-v1";
  portoneV1: PortOneV1Options;
};

export type PaymentComponentAsyncOptions = {
  imports?: DynamicModule["imports"];
  inject?: FactoryProvider["inject"];
  useFactory: (...dependencies: unknown[]) => PaymentComponentOptions | Promise<PaymentComponentOptions>;
};

function createProvider(options: PaymentComponentOptions): PaymentProvider {
  if (options.provider === "portone-v1") return new PortOneV1PaymentProvider(options.portoneV1);
  throw new Error(`Unsupported payment provider: ${String(options.provider)}`);
}

@Module({})
export class PaymentComponentModule {
  static register(options: PaymentComponentOptions): DynamicModule {
    return {
      module: PaymentComponentModule,
      providers: [{ provide: PAYMENT_PROVIDER, useValue: createProvider(options) }],
      exports: [PAYMENT_PROVIDER],
    };
  }

  static registerAsync(options: PaymentComponentAsyncOptions): DynamicModule {
    return {
      module: PaymentComponentModule,
      imports: options.imports ?? [],
      providers: [{
        provide: PAYMENT_PROVIDER,
        inject: options.inject ?? [],
        useFactory: async (...dependencies: unknown[]) => createProvider(await options.useFactory(...dependencies)),
      }],
      exports: [PAYMENT_PROVIDER],
    };
  }
}
