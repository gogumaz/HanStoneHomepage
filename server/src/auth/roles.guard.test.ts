import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../common/api-error.js';
import type { ApiRequest } from '../common/http-types.js';
import type { CurrentUser, PublicRole } from './auth.types.js';
import { RolesGuard } from './roles.guard.js';

function user(...roles: PublicRole[]): CurrentUser {
  return {
    id: 'user-1',
    email: 'user@example.test',
    emailVerified: true,
    displayName: '테스트 사용자',
    roles,
  };
}

function guardFor(allowed: PublicRole[] | undefined) {
  const reflector = {
    getAllAndOverride: () => allowed,
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

function contextFor(currentUser?: CurrentUser): ExecutionContext {
  const request = { user: currentUser } as ApiRequest;
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows endpoints without role metadata', () => {
    expect(guardFor(undefined).canActivate(contextFor())).toBe(true);
  });

  it('returns an authentication error when a protected endpoint has no user', () => {
    expect(() => guardFor(['student']).canActivate(contextFor())).toThrowError(
      expect.objectContaining({ code: 'AUTH_REQUIRED', status: 401 }) as ApiError,
    );
  });

  it('allows every declared role only when the user has a matching role', () => {
    const matrix: Array<[PublicRole, PublicRole[]]> = [
      ['student', ['student']],
      ['guardian', ['guardian']],
      ['instructor', ['instructor', 'operator', 'admin']],
      ['operator', ['operator', 'admin']],
    ];

    for (const [role, allowed] of matrix) {
      expect(guardFor(allowed).canActivate(contextFor(user(role)))).toBe(true);
    }
  });

  it('returns a forbidden error when an authenticated role is not declared', () => {
    expect(() => guardFor(['operator', 'admin']).canActivate(contextFor(user('student')))).toThrowError(
      expect.objectContaining({ code: 'ROLE_FORBIDDEN', status: 403 }) as ApiError,
    );
  });
});
