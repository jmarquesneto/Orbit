import { Module } from '@nestjs/common';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.schema.js';
import { AuthModule } from '../auth/auth.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { InvitationsService } from './application/invitations.service.js';
import {
  INVITATION_LINK_BUILDER,
  INVITATION_REPOSITORY,
  type InvitationLinkBuilder,
} from './application/ports.js';
import { DrizzleInvitationRepository } from './infrastructure/drizzle-invitation.repository.js';
import {
  AdminInvitationsController,
  PublicInvitationsController,
} from './presentation/invitations.controllers.js';

@Module({
  imports: [AuthModule, SettingsModule],
  controllers: [AdminInvitationsController, PublicInvitationsController],
  providers: [
    { provide: INVITATION_REPOSITORY, useClass: DrizzleInvitationRepository },
    {
      provide: INVITATION_LINK_BUILDER,
      inject: [ENV],
      // O token vai no fragmento (#): navegadores não o enviam ao servidor nem no Referer.
      useFactory: (env: Env): InvitationLinkBuilder => ({
        build: (token) => `${new URL(env.WEB_ORIGIN).origin}/convite#${token}`,
      }),
    },
    InvitationsService,
  ],
})
export class InvitationsModule {}
