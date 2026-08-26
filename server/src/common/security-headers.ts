import type { HelmetOptions } from "helmet";
import type { AppConfig } from "../config/app-config.js";

export function apiSecurityHeaders(nodeEnv: AppConfig["nodeEnv"]): HelmetOptions {
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        connectSrc: ["'none'"],
        fontSrc: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
        frameSrc: ["'none'"],
        imgSrc: ["'none'"],
        manifestSrc: ["'none'"],
        mediaSrc: ["'none'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'none'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'none'"],
        workerSrc: ["'none'"],
        upgradeInsecureRequests: nodeEnv === "production" ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "no-referrer" },
    strictTransportSecurity: nodeEnv === "production"
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
      : false,
  };
}
