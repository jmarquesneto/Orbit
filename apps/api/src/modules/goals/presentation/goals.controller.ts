import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe.js';
import { CentsSchema, IsoDateSchema, LabelSchema } from '../../../shared/presentation/schemas.js';
import type { AuthUser } from '../../auth/domain/user.js';
import { CurrentUser } from '../../auth/presentation/decorators.js';
import { GoalsService } from '../application/goals.service.js';

const CreateGoalSchema = z.strictObject({
  name: LabelSchema(60),
  targetCents: CentsSchema,
  targetDate: IsoDateSchema.nullable().optional(),
});
const UpdateGoalSchema = CreateGoalSchema.partial();

const MovementSchema = z.strictObject({
  walletId: z.uuid(),
  kind: z.enum(['deposit', 'withdraw']),
  amountCents: CentsSchema,
  occurredOn: IsoDateSchema,
});

const uuid = new ParseUUIDPipe();

@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateGoalSchema)) body: z.infer<typeof CreateGoalSchema>,
  ) {
    return { goal: await this.goals.create(user.id, body) };
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return { goals: await this.goals.list(user.id) };
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return { goal: await this.goals.get(user.id, id) };
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(UpdateGoalSchema)) body: z.infer<typeof UpdateGoalSchema>,
  ) {
    return { goal: await this.goals.update(user.id, id, body) };
  }

  @Delete(':id')
  @HttpCode(204)
  async archive(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    await this.goals.archive(user.id, id);
  }

  @Post(':id/movements')
  move(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(MovementSchema)) body: z.infer<typeof MovementSchema>,
  ) {
    return this.goals.move(user.id, id, body);
  }

  @Get(':id/movements')
  async movements(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return { movements: await this.goals.listMovements(user.id, id) };
  }
}
