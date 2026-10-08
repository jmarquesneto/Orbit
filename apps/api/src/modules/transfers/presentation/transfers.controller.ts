import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { RequestContext } from '../../../shared/application/ports.js';
import { ReqContext } from '../../../shared/presentation/request-context.js';
import { CentsSchema, IsoDateSchema, LabelSchema } from '../../../shared/presentation/schemas.js';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe.js';
import type { AuthUser } from '../../auth/domain/user.js';
import { CurrentUser } from '../../auth/presentation/decorators.js';
import { TransfersService } from '../application/transfers.service.js';

const CreateTransferSchema = z.strictObject({
  fromWalletId: z.uuid(),
  toWalletId: z.uuid(),
  amountCents: CentsSchema,
  occurredOn: IsoDateSchema,
  description: LabelSchema(120).nullable().optional(),
});

const ListQuerySchema = z.object({
  walletId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateTransferSchema)) body: z.infer<typeof CreateTransferSchema>,
    @ReqContext() ctx: RequestContext,
  ) {
    return { transfer: await this.transfers.create(user.id, body, ctx.ip) };
  }

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>,
  ) {
    return { transfers: await this.transfers.list(user.id, query) };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @ReqContext() ctx: RequestContext,
  ) {
    await this.transfers.remove(user.id, id, ctx.ip);
  }
}
