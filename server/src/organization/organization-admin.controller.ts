import { Controller, Get, Header, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import { OrganizationAccessService } from "./organization-access.service.js";

@Controller("organization-admin")
export class OrganizationAdminController {
  constructor(private readonly access: OrganizationAccessService) {}

  @Get("organizations")
  @UseGuards(SessionAuthGuard, RolesGuard)
  @Roles("organization_admin")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  listOrganizations(@CurrentUser() user: CurrentUserValue) {
    return this.access.listAdminOrganizations(user);
  }
}
