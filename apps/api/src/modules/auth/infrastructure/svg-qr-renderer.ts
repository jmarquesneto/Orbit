import { Injectable } from '@nestjs/common';
import QRCode from 'qrcode';
import type { QrRenderer } from '../application/ports.js';

/** QR code gerado no servidor (sem serviço externo: o segredo nunca sai da instalação). */
@Injectable()
export class SvgQrRenderer implements QrRenderer {
  async toDataUri(text: string): Promise<string> {
    const svg = await QRCode.toString(text, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      color: { dark: '#0B0E13', light: '#FFFFFF' },
    });
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }
}
