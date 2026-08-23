import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { ApiRequest } from "../common/http-types.js";

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<ApiRequest>().user,
);
