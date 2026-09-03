import type { CurrentUser } from "../auth/auth.types.js";

export type ApiRequest = {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  originalUrl?: string;
  url?: string;
  requestId?: string;
  user?: CurrentUser;
};

export type ApiResponse = {
  setHeader(name: string, value: string): void;
  status(statusCode: number): ApiResponse;
  json(body: unknown): void;
};

export type NextFunction = () => void;
