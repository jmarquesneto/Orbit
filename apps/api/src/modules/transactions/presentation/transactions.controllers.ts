import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe.js';
import {
  CentsSchema,
  IsoDateSchema,
  LabelSchema,
  YearMonthSchema,
} from '../../../shared/presentation/schemas.js';
import type { AuthUser } from '../../auth/domain/user.js';
import { CurrentUser } from '../../auth/presentation/decorators.js';
import { CardPurchasesService, MAX_INSTALLMENTS } from '../application/card-purchases.service.js';
import { TransactionsService } from '../application/transactions.service.js';

const CreateTransactionSchema = z.strictObject({
  walletId: z.uuid(),
  categoryId: z.uuid().nullable().optional(),
  description: LabelSchema(120),
  amountCents: CentsSchema,
  kind: z.enum(['income', 'expense']),
  dueDate: IsoDateSchema,
  paid: z.boolean().optional(),
});

const UpdateTransactionSchema = z.strictObject({
  version: z.number().int().positive(),
  description: LabelSchema(120).optional(),
  categoryId: z.uuid().nullable().optional(),
  amountCents: CentsSchema.optional(),
  dueDate: IsoDateSchema.optional(),
});

const PaySchema = z.strictObject({ paid: z.boolean(), version: z.number().int().positive() });
const MonthQuery = z.strictObject({ month: YearMonthSchema.optional() });

const PurchaseSchema = z.strictObject({
  budgetId: z.uuid(),
  categoryId: z.uuid().nullable().optional(),
  description: LabelSchema(120),
  totalCents: CentsSchema,
  installments: z.number().int().min(1).max(MAX_INSTALLMENTS).default(1),
  purchaseDate: IsoDateSchema,
  idempotencyKey: z.uuid(),
});

const PayInvoiceSchema = z.strictObject({ fromWalletId: z.uuid().nullable().optional() });

const uuid = new ParseUUIDPipe();
const monthPipe = new ZodValidationPipe(YearMonthSchema);

@Controller('budgets/:budgetId/transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Param('budgetId', uuid) budgetId: string,
    @Body(new ZodValidationPipe(CreateTransactionSchema)) body: z.infer<typeof CreateTransactionSchema>,
  ) {
    return { transaction: await this.transactions.create(user.id, budgetId, body) };
  }

  /** Ex.: GET /api/budgets/:id/transactions?month=2026-10 */
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Param('budgetId', uuid) budgetId: string,
    @Query(new ZodValidationPipe(MonthQuery)) q: z.infer<typeof MonthQuery>,
  ) {
    return { transactions: await this.transactions.list(user.id, budgetId, q.month) };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('budgetId', uuid) budgetId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(UpdateTransactionSchema)) body: z.infer<typeof UpdateTransactionSchema>,
  ) {
    return { transaction: await this.transactions.update(user.id, budgetId, id, body) };
  }

  @Post(':id/payment')
  @HttpCode(200)
  async setPaid(
    @CurrentUser() user: AuthUser,
    @Param('budgetId', uuid) budgetId: string,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(PaySchema)) body: z.infer<typeof PaySchema>,
  ) {
    return { transaction: await this.transactions.setPaid(user.id, budgetId, id, body) };
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(
    @CurrentUser() user: AuthUser,
    @Param('budgetId', uuid) budgetId: string,
    @Param('id', uuid) id: string,
  ) {
    await this.transactions.delete(user.id, budgetId, id);
  }
}

@Controller('wallets/:cardId')
export class CardPurchasesController {
  constructor(private readonly purchases: CardPurchasesService) {}

  /** Compra no cartão, à vista ou parcelada. Reenviar com a mesma idempotencyKey não duplica. */
  @Post('purchases')
  async purchase(
    @CurrentUser() user: AuthUser,
    @Param('cardId', uuid) cardId: string,
    @Body(new ZodValidationPipe(PurchaseSchema)) body: z.infer<typeof PurchaseSchema>,
  ) {
    return this.purchases.purchase(user.id, cardId, body);
  }

  @Delete('purchases/:planId')
  @HttpCode(204)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('cardId', uuid) cardId: string,
    @Param('planId', uuid) planId: string,
  ) {
    await this.purchases.cancel(user.id, cardId, planId);
  }

  @Post('invoices/:month/payment')
  @HttpCode(200)
  async payInvoice(
    @CurrentUser() user: AuthUser,
    @Param('cardId', uuid) cardId: string,
    @Param('month', monthPipe) month: string,
    @Body(new ZodValidationPipe(PayInvoiceSchema)) body: z.infer<typeof PayInvoiceSchema>,
  ) {
    return { invoice: await this.purchases.payInvoice(user.id, cardId, `${month}-01`, body) };
  }
}
