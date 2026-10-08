import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { ValidationError } from '../../../shared/domain/errors.js';
import { LabelSchema } from '../../../shared/presentation/schemas.js';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe.js';
import type { AuthUser } from '../../auth/domain/user.js';
import { CurrentUser } from '../../auth/presentation/decorators.js';
import { OfxService } from '../application/ofx.service.js';
import { MAX_OFX_BYTES } from '../infrastructure/worker-ofx-parser.js';

/**
 * Upload só em memória (sem `dest`, nada toca o disco), um arquivo, no máximo 5 MB,
 * extensão .ofx/.qfx.
 */
const upload = FileInterceptor('file', {
  limits: { fileSize: MAX_OFX_BYTES, files: 1, fields: 4, parts: 6 },
  fileFilter: (_req, file, cb) => {
    if (/\.(ofx|qfx)$/i.test(file.originalname)) cb(null, true);
    else cb(new ValidationError('Envie um arquivo .ofx exportado pelo seu banco.'), false);
  },
});

type UploadedOfx = { originalname: string; buffer: Buffer } | undefined;

function requireFile(file: UploadedOfx): { name: string; bytes: Buffer } {
  if (!file) throw new ValidationError('Selecione um arquivo .ofx.');
  return { name: file.originalname, bytes: file.buffer };
}

const ImportBody = z.strictObject({ walletId: z.uuid() });
const ConfirmBody = z.strictObject({ transactionId: z.uuid().optional() });
const CreateBody = z.strictObject({
  budgetId: z.uuid(),
  categoryId: z.uuid().nullable().optional(),
  description: LabelSchema(120).optional(),
});

const uuid = new ParseUUIDPipe();

@Controller('ofx')
export class OfxController {
  constructor(private readonly ofx: OfxService) {}

  /** Só converte o arquivo no JSON padronizado (nada é gravado). */
  @Post('parse')
  @HttpCode(200)
  @UseInterceptors(upload)
  async parse(@UploadedFile() file: UploadedOfx) {
    return { statement: await this.ofx.parse(requireFile(file).bytes) };
  }

  @Post('imports')
  @UseInterceptors(upload)
  importFile(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedOfx,
    @Body(new ZodValidationPipe(ImportBody)) body: z.infer<typeof ImportBody>,
  ) {
    return this.ofx.importFile(user.id, body.walletId, requireFile(file));
  }

  @Get('imports')
  async list(@CurrentUser() user: AuthUser) {
    return { imports: await this.ofx.list(user.id) };
  }

  @Get('imports/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.ofx.get(user.id, id);
  }

  @Post('imports/:id/entries/:entryId/confirm')
  @HttpCode(200)
  confirm(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('entryId', uuid) entryId: string,
    @Body(new ZodValidationPipe(ConfirmBody)) body: z.infer<typeof ConfirmBody>,
  ) {
    return this.ofx.confirm(user.id, id, entryId, body.transactionId);
  }

  @Post('imports/:id/entries/:entryId/create')
  @HttpCode(200)
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', uuid) id: string,
    @Param('entryId', uuid) entryId: string,
    @Body(new ZodValidationPipe(CreateBody)) body: z.infer<typeof CreateBody>,
  ) {
    return this.ofx.createFromEntry(user.id, id, entryId, body);
  }

  @Post('imports/:id/entries/:entryId/ignore')
  @HttpCode(200)
  ignore(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Param('entryId', uuid) entryId: string) {
    return this.ofx.ignore(user.id, id, entryId);
  }

  @Post('imports/:id/entries/:entryId/undo')
  @HttpCode(200)
  undo(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Param('entryId', uuid) entryId: string) {
    return this.ofx.undo(user.id, id, entryId);
  }

  @Post('imports/:id/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.ofx.complete(user.id, id);
  }
}
