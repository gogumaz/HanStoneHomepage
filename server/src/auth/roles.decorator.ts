import { SetMetadata } from "@nestjs/common";
import type { PublicRole } from "./auth.types.js";

export const ROLES_KEY = "allowed_roles";
export const Roles = (...roles: PublicRole[]) => SetMetadata(ROLES_KEY, roles);
