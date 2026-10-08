import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe.js';
import {
  DayOfMonthSchema,
  LabelSchema,
  NonNegativeCentsSchema,
  YearMonthSchema,
} from '../../../shared/presentation/schemas.js';
import type { AuthUser } from '../../auth/domain/user.js';
import { CurrentUser } from '../../auth/presentation/decorators.js';
import { WalletsService } from '../application/wallets.service.js';
import { WALLET_TYPES } from '../domain/wallet.js';

const Last4Schema = z.string().regex(/^\d{4}$/, 'Informe os 4 últimos dígitos.').nullable();

const CardSchema = z.strictObject({
  limitCents: NonNegativeCentsSchema,
  closingDay: DayOfMonthSchema,
  dueDay: DayOfMonthSchema,
  payFromWalletId: z.uuid().nullable().optional(),
});

const CreateWalletSchema = z.strictObject({
  type: z.enum(WALLET_TYPES),
  name: LabelSchema(60),
  institution: LabelSchema(60).nullable().optional(),
  last4: Last4Schema.optional(),
  openingCents: z.number().int().min(-1e13).max(1e13).optional(),
  card: CardSchema.optional(),
});

const UpdateWalletSchema = z.strictObject({
  name: LabelSchema(60).optional(),
  institution: LabelSchema(60).nullable().optional(),
  last4: Last4Schema.optional(),
  card: CardSchema.partial().optional(),
});

const uuid = new ParseUUIDPipe();
const refMonthPipe = new ZodValidationPipe(YearMonthSchema);

@Controller('wallets')
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateWalletSchema)) body: z.infer<typeof CreateWalletSchema>,
  ) {
    return { wallet: await this.wallets.create(user.id, body) };
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return { wallets: await this.wallets.list(user.id) };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return { wallet: await this.wallets.get(user.id, id) };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(UpdateWalletSchema)) body: z.infer<typeof UpdateWalletSchema>,
  ) {
    return { wallet: await this.wallets.update(user.id, id, body) };
  }

  @Delete(':id')
  @HttpCode(204)
  async archive(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    await this.wallets.archive(user.id, id);
  }

  @Get(':id/invoices')
  async invoices(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return { invoices: await this.wallets.listInvoices(user.id, id) };
  }

  /** Ex.: GET /api/wallets/:id/invoices/2026-11 */
  @Get(':id/invoices/:month')
  async invoice(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('month', refMonthPipe) month: string,
  ) {
    return { invoice: await this.wallets.getInvoice(user.id, id, `${month}-01`) };
  }
}

