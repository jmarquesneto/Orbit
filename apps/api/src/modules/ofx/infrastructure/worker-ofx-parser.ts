import { Injectable } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import { ValidationError } from '../../../shared/domain/errors.js';
import type { OfxParser } from '../application/ports.js';
import { normalizeStatement, OfxFormatError, type OfxStatement } from '../domain/statement.js';

export const MAX_OFX_BYTES = 5 * 1024 * 1024;
const PARSE_TIMEOUT_MS = 5_000;

/**
 * Código da worker: só importa a biblioteca e devolve a árvore crua. Nada de rede, disco
 * ou segredos — a worker nasce com `env: {}` e limites de memória e pilha.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
import(workerData.libUrl)
  .then(({ parseSync }) => {
    const result = parseSync(workerData.text);
    parentPort.postMessage({ ok: true, ofx: result.OFX ?? null });
  })
  .catch((e) => parentPort.postMessage({ ok: false, error: String((e && e.message) || e).slice(0, 200) }));
`;

/** Arquivos OFX 1.x costumam vir em Windows-1252; os 2.x, em UTF-8. */
export function decodeOfx(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

@Injectable()
export class WorkerOfxParser implements OfxParser {
  private readonly libUrl = import.meta.resolve('ofx-js');

  async parse(bytes: Buffer): Promise<OfxStatement> {
    if (bytes.length === 0) throw new ValidationError('Arquivo vazio.');
    if (bytes.length > MAX_OFX_BYTES) throw new ValidationError('Arquivo acima de 5 MB.');
    const text = decodeOfx(bytes);
    if (!/<OFX>/i.test(text)) throw new ValidationError('Este arquivo não parece ser um extrato OFX.');
    // Barreira extra contra XXE: OFX legítimo não declara DTD nem entidades.
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new ValidationError('Arquivo OFX com declarações não permitidas.');

    const tree = await this.runIsolated(text);
    try {
      return normalizeStatement(tree);
    } catch (err) {
      if (err instanceof OfxFormatError) throw new ValidationError(`Extrato inválido: ${err.message}`);
      throw err;
    }
  }

  private runIsolated(text: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { text, libUrl: this.libUrl },
        env: {},
        resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 8 },
      });
      const fail = (message: string) => {
        void worker.terminate();
        reject(new ValidationError(message));
      };
      const timer = setTimeout(() => fail('O arquivo demorou demais para ser lido.'), PARSE_TIMEOUT_MS);
      worker.once('message', (msg: { ok: boolean; ofx?: Record<string, unknown> | null; error?: string }) => {
        clearTimeout(timer);
        void worker.terminate();
        if (msg.ok && msg.ofx) resolve(msg.ofx);
        else reject(new ValidationError('Não foi possível ler o extrato OFX.'));
      });
      worker.once('error', () => {
        clearTimeout(timer);
        fail('Não foi possível ler o extrato OFX.');
      });
    });
  }
}
