import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ENV } from '../../../config/config.module.js';
import type { Env } from '../../../config/env.schema.js';
import { UsersAdminService } from './users-admin.service.js';

/**
 * Com BOOTSTRAP_ADMIN_EMAIL definido e nenhum administrador no banco, cria o primeiro admin
 * ao subir e escreve a senha provisória no log do container (útil em NAS, sem terminal).
 */
@Injectable()
export class BootstrapAdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger('PrimeiroAcesso');

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly usersAdmin: UsersAdminService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.env.BOOTSTRAP_ADMIN_EMAIL;
    if (!email) return;
    try {
      const created = await this.usersAdmin.bootstrapFirstAdmin(email, this.env.BOOTSTRAP_ADMIN_NAME);
      if (!created) return; // já existe administrador: não faz nada
      this.logger.warn(
        [
          '',
          '==================== PRIMEIRO ACESSO ====================',
          `  E-mail:            ${created.user.email}`,
          `  Senha provisória:  ${created.temporaryPassword}`,
          '  No 1º login o sistema pede uma senha nova e o app autenticador.',
          '=========================================================',
        ].join('\n'),
      );
    } catch (err) {
      this.logger.error(`Não foi possível criar o primeiro administrador: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
