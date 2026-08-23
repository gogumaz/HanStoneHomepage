import { HttpException, HttpStatus } from "@nestjs/common";

export class ApiError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus,
  ) {
    super(message, status);
  }
}
