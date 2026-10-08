import { readFileSync } from 'node:fs';
import { ValidationError } from '../../../shared/domain/errors.js';
import { MAX_OFX_BYTES, WorkerOfxParser } from './worker-ofx-parser.js';

const fixture = (name: string) => readFileSync(new URL(`../../../../test/fixtures/${name}`, import.meta.url));
const parser = new WorkerOfxParser();

describe('WorkerOfxParser (biblioteca ofx-js em worker isolada)', () => {
  it('extrato SGML (OFX 1.x, Windows-1252, vírgula decimal) vira o JSON padronizado', async () => {
    const s = await parser.parse(fixture('extrato-sgml.ofx'));
    expect(s).toMatchObject({
      kind: 'bank',
      bankId: '0341',
      accountMask: '6789',
      currency: 'BRL',
      period: { start: '2026-10-01', end: '2026-10-07' },
      ledgerBalance: { amountCents: 481_233, date: '2026-10-07' },
    });
    expect(s.transactions).toHaveLength(5);
    expect(s.transactions[1]).toEqual({
      fitId: '2026100301',
      postedAt: '2026-10-03',
      amountCents: 980_000,
      type: 'CREDIT',
      memo: 'PIX REC EMPRESA XYZ · Salário',
    });
    expect(JSON.stringify(s)).not.toMatch(/<|script/);
    expect(JSON.stringify(s)).not.toContain('12345');
  });

  it('extrato OFX 2.x (XML) também é aceito', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><?OFX OFXHEADER="200" VERSION="211"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF>
<BANKACCTFROM><BANKID>260</BANKID><ACCTID>99887766</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001</DTSTART><DTEND>20261031</DTEND>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261015</DTPOSTED><TRNAMT>-25.00</TRNAMT><FITID>abc</FITID><MEMO>Padaria</MEMO></STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>100.00</BALAMT><DTASOF>20261031</DTASOF></LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const s = await parser.parse(Buffer.from(xml));
    expect(s.transactions).toEqual([
      { fitId: 'abc', postedAt: '2026-10-15', amountCents: -2_500, type: 'DEBIT', memo: 'Padaria' },
    ]);
  });

  it.each([
    ['vazio', Buffer.alloc(0)],
    ['grande demais', Buffer.alloc(MAX_OFX_BYTES + 1, 'a')],
    ['não é OFX', Buffer.from('nome,valor\nmercado,10')],
    ['tenta XXE', Buffer.from('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><OFX>&e;</OFX>')],
    ['OFX quebrado', Buffer.from('<OFX><BANKMSGSRSV1><STMTTRNRS>')],
  ])('recusa arquivo %s com erro de validação', async (_label, bytes) => {
    await expect(parser.parse(bytes)).rejects.toBeInstanceOf(ValidationError);
  });

  it('a worker não enxerga as variáveis de ambiente (segredos)', async () => {
    process.env.SEGREDO_DE_TESTE = 'nao-pode-vazar';
    const { Worker } = await import('node:worker_threads');
    const seen = await new Promise((resolve) => {
      const w = new Worker('require("node:worker_threads").parentPort.postMessage(process.env.SEGREDO_DE_TESTE ?? null)', {
        eval: true,
        env: {},
      });
      w.once('message', (m) => {
        void w.terminate();
        resolve(m);
      });
    });
    expect(seen).toBeNull();
    delete process.env.SEGREDO_DE_TESTE;
  });
});
