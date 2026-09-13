import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { Roles } from "../auth/roles.decorator.js";
import { RolesGuard } from "../auth/roles.guard.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import type { CurrentUser as CurrentUserValue } from "../auth/auth.types.js";
import type { ApiRequest } from "../common/http-types.js";
import { RateLimit, RateLimitGuard } from "../common/rate-limit.guard.js";
import { ClassAssignmentService } from "./class-assignment.service.js";

type CsvResponse = {
  setHeader(name: string, value: string): void;
  send(body: string): void;
};

const ASSIGNMENT_WRITE_LIMIT = {
  name: "class-assignment-write",
  limit: 120,
  windowMs: 60 * 60_000,
  errorCode: "CLASS_ASSIGNMENT_RATE_LIMITED",
  errorMessage: "과제 변경 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
} as const;

@Controller()
@UseGuards(SessionAuthGuard)
export class ClassAssignmentController {
  constructor(private readonly assignments: ClassAssignmentService) {}

  @Get("teacher/classes/:classId/assignment-options")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  @UseGuards(RolesGuard)
  @Roles("instructor")
  options(@CurrentUser() user: CurrentUserValue, @Param("classId") classId: string) {
    return this.assignments.getOptions(user, classId);
  }

  @Get("teacher/classes/:classId/assignments")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  @UseGuards(RolesGuard)
  @Roles("instructor")
  list(@CurrentUser() user: CurrentUserValue, @Param("classId") classId: string) {
    return this.assignments.listForClass(user, classId);
  }

  @Post("teacher/classes/:classId/assignments")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RolesGuard, RateLimitGuard)
  @RateLimit(ASSIGNMENT_WRITE_LIMIT)
  @Roles("instructor")
  create(
    @CurrentUser() user: CurrentUserValue,
    @Param("classId") classId: string,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.assignments.create(user, classId, body, request.requestId);
  }

  @Get("teacher/assignments/:assignmentId")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  @UseGuards(RolesGuard)
  @Roles("instructor")
  getTeacher(@CurrentUser() user: CurrentUserValue, @Param("assignmentId") assignmentId: string) {
    return this.assignments.getTeacher(user, assignmentId);
  }

  @Put("teacher/assignments/:assignmentId")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RolesGuard, RateLimitGuard)
  @RateLimit(ASSIGNMENT_WRITE_LIMIT)
  @Roles("instructor")
  update(
    @CurrentUser() user: CurrentUserValue,
    @Param("assignmentId") assignmentId: string,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.assignments.update(user, assignmentId, body, request.requestId);
  }

  @Post("teacher/assignments/:assignmentId/publish")
  @Header("Cache-Control", "private, no-store")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard, RateLimitGuard)
  @RateLimit(ASSIGNMENT_WRITE_LIMIT)
  @Roles("instructor")
  publish(
    @CurrentUser() user: CurrentUserValue,
    @Param("assignmentId") assignmentId: string,
    @Req() request: ApiRequest,
  ) {
    return this.assignments.publish(user, assignmentId, request.requestId);
  }

  @Post("teacher/assignments/:assignmentId/cancel")
  @Header("Cache-Control", "private, no-store")
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard, RateLimitGuard)
  @RateLimit(ASSIGNMENT_WRITE_LIMIT)
  @Roles("instructor")
  cancel(
    @CurrentUser() user: CurrentUserValue,
    @Param("assignmentId") assignmentId: string,
    @Req() request: ApiRequest,
  ) {
    return this.assignments.cancel(user, assignmentId, request.requestId);
  }

  @Get("teacher/assignments/:assignmentId/results")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  @UseGuards(RolesGuard)
  @Roles("instructor")
  results(
    @CurrentUser() user: CurrentUserValue,
    @Param("assignmentId") assignmentId: string,
    @Req() request: ApiRequest,
  ) {
    return this.assignments.getResults(user, assignmentId, request.requestId);
  }

  @Get("teacher/assignments/:assignmentId/results.csv")
  @UseGuards(RolesGuard)
  @Roles("instructor")
  async resultsCsv(
    @CurrentUser() user: CurrentUserValue,
    @Param("assignmentId") assignmentId: string,
    @Req() request: ApiRequest,
    @Res() response: CsvResponse,
  ): Promise<void> {
    const file = await this.assignments.exportResultsCsv(user, assignmentId, request.requestId);
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    response.send(file.content);
  }

  @Patch("teacher/assignments/:assignmentId/students/:studentId/comment")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RolesGuard, RateLimitGuard)
  @RateLimit(ASSIGNMENT_WRITE_LIMIT)
  @Roles("instructor")
  comment(
    @CurrentUser() user: CurrentUserValue,
    @Param("assignmentId") assignmentId: string,
    @Param("studentId") studentId: string,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.assignments.comment(user, assignmentId, studentId, body, request.requestId);
  }

  @Post("teacher/assignments/:assignmentId/reassign")
  @Header("Cache-Control", "private, no-store")
  @UseGuards(RolesGuard, RateLimitGuard)
  @RateLimit(ASSIGNMENT_WRITE_LIMIT)
  @Roles("instructor")
  reassign(
    @CurrentUser() user: CurrentUserValue,
    @Param("assignmentId") assignmentId: string,
    @Body() body: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.assignments.reassign(user, assignmentId, body, request.requestId);
  }

  @Get("me/assignments")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  @UseGuards(RolesGuard)
  @Roles("student")
  listMine(@CurrentUser() user: CurrentUserValue) {
    return this.assignments.listMine(user);
  }

  @Get("me/assignments/:assignmentId")
  @Header("Cache-Control", "private, no-store")
  @Header("Vary", "Cookie")
  @UseGuards(RolesGuard)
  @Roles("student")
  getMine(@CurrentUser() user: CurrentUserValue, @Param("assignmentId") assignmentId: string) {
    return this.assignments.getMine(user, assignmentId);
  }
}
