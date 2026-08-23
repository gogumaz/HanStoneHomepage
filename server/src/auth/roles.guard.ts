import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiError } from "../common/api-error.js";
import type { ApiRequest } from "../common/http-types.js";
import { ROLES_KEY } from "./roles.decorator.js";
import type { PublicRole } from "./auth.types.js";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<PublicRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed?.length) return true;

    const user = context.switchToHttp().getRequest<ApiRequest>().user;
    if (!user) {
      throw new ApiError("AUTH_REQUIRED", "로그인이 필요합니다.", HttpStatus.UNAUTHORIZED);
    }
    if (!allowed.some((role) => user.roles.includes(role))) {
      throw new ApiError("ROLE_FORBIDDEN", "이 작업을 수행할 권한이 없습니다.", HttpStatus.FORBIDDEN);
    }
    return true;
  }
}
