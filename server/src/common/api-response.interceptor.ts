import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { map, type Observable } from "rxjs";

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data: unknown) => ({ data })));
  }
}
