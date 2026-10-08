import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe.js';
import {
  HexColorSchema,
  LabelSchema,
  NonNegativeCentsSchema,
  YearMonthSchema,
} from '../../../shared/presentation/schemas.js';
import type { AuthUser } from '../../auth/domain/user.js';
import { CurrentUser } from '../../auth/presentation/decorators.js';
import { BudgetsService } from '../application/budgets.service.js';
import { CATEGORY_KINDS } from '../domain/budget.js';

const CreateBudgetSchema = z.strictObject({
  name: LabelSchema(60),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  periodStartDay: z.number().int().min(1).max(28).optional(),
});
const UpdateBudgetSchema = CreateBudgetSchema.omit({ currency: true }).partial();

const CreateCategorySchema = z.strictObject({
  name: LabelSchema(60),
  kind: z.enum(CATEGORY_KINDS),
  plannedCents: NonNegativeCentsSchema.optional(),
  color: HexColorSchema.nullable().optional(),
  parentId: z.uuid().nullable().optional(),
});
const UpdateCategorySchema = CreateCategorySchema.pick({ name: true, plannedCents: true, color: true }).partial();

const SummaryQuery = z.strictObject({ month: YearMonthSchema });
const uuid = new ParseUUIDPipe();

@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateBudgetSchema)) body: z.infer<typeof CreateBudgetSchema>,
  ) {
    return { budget: await this.budgets.create(user.id, body) };
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return { budgets: await this.budgets.list(user.id) };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return { budget: await this.budgets.get(user.id, id) };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(UpdateBudgetSchema)) body: z.infer<typeof UpdateBudgetSchema>,
  ) {
    return { budget: await this.budgets.update(user.id, id, body) };
  }

  @Delete(':id')
  @HttpCode(204)
  async archive(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    await this.budgets.archive(user.id, id);
  }

  /** Ex.: GET /api/budgets/:id/summary?month=2026-10 */
  @Get(':id/summary')
  async summary(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(SummaryQuery)) q: z.infer<typeof SummaryQuery>,
  ) {
    return { summary: await this.budgets.summary(user.id, id, q.month) };
  }

  @Post(':id/categories')
  async createCategory(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(CreateCategorySchema)) body: z.infer<typeof CreateCategorySchema>,
  ) {
    return { category: await this.budgets.createCategory(user.id, id, body) };
  }

  @Get(':id/categories')
  async listCategories(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return { categories: await this.budgets.listCategories(user.id, id) };
  }

  @Patch(':id/categories/:categoryId')
  async updateCategory(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('categoryId', uuid) categoryId: string,
    @Body(new ZodValidationPipe(UpdateCategorySchema)) body: z.infer<typeof UpdateCategorySchema>,
  ) {
    return { category: await this.budgets.updateCategory(user.id, id, categoryId, body) };
  }

  @Delete(':id/categories/:categoryId')
  @HttpCode(204)
  async deleteCategory(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('categoryId', uuid) categoryId: string,
  ) {
    await this.budgets.deleteCategory(user.id, id, categoryId);
  }
}
