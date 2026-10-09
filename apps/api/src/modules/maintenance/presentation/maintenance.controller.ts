import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { RequestContext } from '../../../shared/application/ports.js';
import { ReqContext } from '../../../shared/presentation/request-context.js';
import { CentsSchema, IsoDateSchema, LabelSchema } from '../../../shared/presentation/schemas.js';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe.js';
import type { AuthUser } from '../../auth/domain/user.js';
import { CurrentUser } from '../../auth/presentation/decorators.js';
import { MaintenanceService } from '../application/maintenance.service.js';
import { FREQUENCIES } from '../domain/maintenance.js';

const ManualUrlSchema = z
  .url({ protocol: /^https$/, error: 'Use um endereço que comece com https://' })
  .max(2048)
  .nullable();

const CreateEquipmentSchema = z.strictObject({
  budgetId: z.uuid(),
  name: LabelSchema(80),
  location: LabelSchema(60),
  manualUrl: ManualUrlSchema.optional(),
});
const UpdateEquipmentSchema = z.strictObject({
  name: LabelSchema(80).optional(),
  location: LabelSchema(60).optional(),
  manualUrl: ManualUrlSchema.optional(),
});
const CreateTaskSchema = z.strictObject({
  name: LabelSchema(80),
  frequency: z.enum(FREQUENCIES),
  assigneeId: z.uuid(),
  firstDueOn: IsoDateSchema,
});
const UpdateTaskSchema = z.strictObject({
  version: z.number().int().positive(),
  name: LabelSchema(80).optional(),
  frequency: z.enum(FREQUENCIES).optional(),
  assigneeId: z.uuid().optional(),
  nextDueOn: IsoDateSchema.optional(),
});
const CompleteSchema = z.strictObject({
  completedOn: IsoDateSchema,
  version: z.number().int().positive(),
  idempotencyKey: z.uuid(),
  note: z.string().trim().max(500).nullable().optional(),
  cost: z
    .strictObject({ amountCents: CentsSchema, walletId: z.uuid(), budgetId: z.uuid() })
    .nullable()
    .optional(),
});
const OverviewQuery = z.object({
  assignee: z.union([z.literal('me'), z.uuid()]).optional(),
  budgetId: z.uuid().optional(),
});
const BudgetQuery = z.object({ budgetId: z.uuid().optional() });
const RequiredBudgetQuery = z.object({ budgetId: z.uuid() });
const VersionQuery = z.object({ version: z.coerce.number().int().positive() });

const uuid = new ParseUUIDPipe();

/** Manutenção residencial: painel, equipamentos, tarefas e histórico. */
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(OverviewQuery)) q: z.infer<typeof OverviewQuery>) {
    return this.maintenance.overview(user.id, q);
  }

  @Get('members')
  async members(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(RequiredBudgetQuery)) q: z.infer<typeof RequiredBudgetQuery>) {
    return { members: await this.maintenance.listMembers(user.id, q.budgetId) };
  }

  @Get('equipment')
  async listEquipment(@CurrentUser() user: AuthUser, @Query(new ZodValidationPipe(BudgetQuery)) q: z.infer<typeof BudgetQuery>) {
    return { equipment: await this.maintenance.listEquipment(user.id, q.budgetId) };
  }

  @Post('equipment')
  async createEquipment(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateEquipmentSchema)) body: z.infer<typeof CreateEquipmentSchema>,
    @ReqContext() ctx: RequestContext,
  ) {
    return { equipment: await this.maintenance.createEquipment(user.id, body, ctx.ip) };
  }

  @Get('equipment/:id')
  getEquipment(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.maintenance.getEquipment(user.id, id);
  }

  @Patch('equipment/:id')
  async updateEquipment(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(UpdateEquipmentSchema)) body: z.infer<typeof UpdateEquipmentSchema>,
    @ReqContext() ctx: RequestContext,
  ) {
    return { equipment: await this.maintenance.updateEquipment(user.id, id, body, ctx.ip) };
  }

  @Delete('equipment/:id')
  @HttpCode(204)
  async archiveEquipment(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @ReqContext() ctx: RequestContext) {
    await this.maintenance.archiveEquipment(user.id, id, ctx.ip);
  }

  @Post('equipment/:id/tasks')
  async createTask(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(CreateTaskSchema)) body: z.infer<typeof CreateTaskSchema>,
    @ReqContext() ctx: RequestContext,
  ) {
    return { task: await this.maintenance.createTask(user.id, id, body, ctx.ip) };
  }

  @Patch('tasks/:id')
  async updateTask(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(UpdateTaskSchema)) body: z.infer<typeof UpdateTaskSchema>,
    @ReqContext() ctx: RequestContext,
  ) {
    return { task: await this.maintenance.updateTask(user.id, id, body, ctx.ip) };
  }

  @Delete('tasks/:id')
  @HttpCode(204)
  async deactivateTask(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Query(new ZodValidationPipe(VersionQuery)) q: z.infer<typeof VersionQuery>,
    @ReqContext() ctx: RequestContext,
  ) {
    await this.maintenance.deactivateTask(user.id, id, q.version, ctx.ip);
  }

  @Post('tasks/:id/complete')
  @HttpCode(200)
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(CompleteSchema)) body: z.infer<typeof CompleteSchema>,
    @ReqContext() ctx: RequestContext,
  ) {
    return this.maintenance.completeTask(user.id, id, body, ctx.ip);
  }
}
