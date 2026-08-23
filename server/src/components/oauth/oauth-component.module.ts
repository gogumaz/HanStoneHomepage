import { type DynamicModule, type FactoryProvider, Module } from "@nestjs/common";
import { OAuthClient, OAUTH_COMPONENT_OPTIONS } from "./oauth-client.js";
import type { OAuthComponentOptions } from "./oauth-provider.js";

export type OAuthComponentAsyncOptions = {
  imports?: DynamicModule["imports"];
  inject?: FactoryProvider["inject"];
  useFactory: (...dependencies: unknown[]) => OAuthComponentOptions | Promise<OAuthComponentOptions>;
};

@Module({})
export class OAuthComponentModule {
  static register(options: OAuthComponentOptions): DynamicModule {
    return {
      module: OAuthComponentModule,
      providers: [
        { provide: OAUTH_COMPONENT_OPTIONS, useValue: options },
        OAuthClient,
      ],
      exports: [OAuthClient],
    };
  }

  static registerAsync(options: OAuthComponentAsyncOptions): DynamicModule {
    return {
      module: OAuthComponentModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: OAUTH_COMPONENT_OPTIONS,
          inject: options.inject ?? [],
          useFactory: options.useFactory,
        },
        OAuthClient,
      ],
      exports: [OAuthClient],
    };
  }
}
