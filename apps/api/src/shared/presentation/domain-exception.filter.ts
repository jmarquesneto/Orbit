import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  InvalidCredentialsError,
  InvalidInvitationError,
  InvalidMfaCodeError,
  MfaReauthRequiredError,
  MfaSetupRequiredError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
} from '../domain/errors.js';

const STATUS: [new (...args: never[]) => DomainError, number][] = [
  [ValidationError, HttpStatus.BAD_REQUEST],
  [InvalidInvitationError, HttpStatus.BAD_REQUEST],
  [InvalidMfaCodeError, HttpStatus.BAD_REQUEST],
  [MfaSetupRequiredError, HttpStatus.FORBIDDEN],
  [MfaReauthRequiredError, HttpStatus.FORBIDDEN],
  [InvalidCredentialsError, HttpStatus.UNAUTHORIZED],
  [UnauthenticatedError, HttpStatus.UNAUTHORIZED],
  [ForbiddenError, HttpStatus.FORBIDDEN],
  [NotFoundError, HttpStatus.NOT_FOUND],
  [ConflictError, HttpStatus.CONFLICT],
  [RateLimitedError, HttpStatus.TOO_MANY_REQUESTS],
];

/**
 * Traduz erros para HTTP com corpo uniforme { error: { code, message } }.
 * Erros inesperados viram 500 genérico: stack e detalhes ficam só no log do servidor.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainError) {
      const status = STATUS.find(([type]) => exception instanceof type)?.[1] ?? 400;
      if (exception instanceof RateLimitedError) {
        res.setHeader('Retry-After', String(exception.retryAfterSeconds));
      }
      res.status(status).json({
        error: {
          code: exception.code,
          message: exception.message,
          ...(exception instanceof ValidationError && exception.issues.length
            ? { issues: exception.issues }
            : {}),
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res.status(status).json(
        typeof body === 'object' && body !== null && 'status' in body
          ? body // relatórios de health check (ver HealthController)
          : { error: { code: `http_${status}`, message: exception.message } },
      );
      return;
    }

    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : exception);
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ error: { code: 'internal_error', message: 'Erro interno. Tente novamente.' } });
  }
}
