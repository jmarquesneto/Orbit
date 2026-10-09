/**
 * Erros de domínio: o caso de uso diz O QUE aconteceu; a camada HTTP decide o status.
 * As mensagens são seguras para o cliente — nunca incluem dados internos.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  readonly code = 'validation_failed';
  constructor(
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

/** Login, refresh ou token inválido. Mensagem única para não revelar qual parte falhou. */
export class InvalidCredentialsError extends DomainError {
  readonly code = 'invalid_credentials';
  constructor() {
    super('E-mail ou senha inválidos.');
  }
}

export class UnauthenticatedError extends DomainError {
  readonly code = 'unauthenticated';
  constructor() {
    super('Sessão ausente ou expirada.');
  }
}

export class ForbiddenError extends DomainError {
  readonly code = 'forbidden';
  constructor(message = 'Você não tem permissão para esta ação.') {
    super(message);
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'not_found';
  constructor(message = 'Recurso não encontrado.') {
    super(message);
  }
}

export class ConflictError extends DomainError {
  readonly code = 'conflict';
}

/** Convite inexistente, expirado, usado ou revogado — sempre a mesma resposta neutra. */
export class InvalidInvitationError extends DomainError {
  readonly code = 'invalid_invitation';
  constructor() {
    super('Este convite não é válido. Peça um novo convite ao administrador.');
  }
}

export class RateLimitedError extends DomainError {
  readonly code = 'rate_limited';
  constructor(readonly retryAfterSeconds: number) {
    super('Muitas tentativas. Aguarde um pouco e tente novamente.');
  }
}

/** Código de MFA (TOTP ou de recuperação) errado, expirado ou já usado. */
export class InvalidMfaCodeError extends DomainError {
  readonly code = 'invalid_mfa_code';
  constructor() {
    super('Código inválido. Confira o app autenticador e tente de novo.');
  }
}

/** A instalação exige MFA e este usuário ainda não configurou. */
export class MfaSetupRequiredError extends DomainError {
  readonly code = 'mfa_setup_required';
  constructor() {
    super('Configure a verificação em duas etapas para continuar.');
  }
}

/** Ação sensível: confirme o código do MFA de novo. */
export class MfaReauthRequiredError extends DomainError {
  readonly code = 'mfa_reauth_required';
  constructor() {
    super('Confirme o código do seu app autenticador para continuar.');
  }
}

/** Senha provisória definida pelo admin: troque antes de continuar. */
export class PasswordChangeRequiredError extends DomainError {
  readonly code = 'password_change_required';
  constructor() {
    super('Defina uma nova senha para continuar.');
  }
}
