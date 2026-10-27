// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SVGtoPDF = require('svg-to-pdfkit');
import * as fs from 'fs';
import * as path from 'path';

/**
 * Commission payout invoice (withdrawal approved by Admin).
 * Same letterhead and Mulish font as the order invoice (PdfService), built
 * here so PayoutsModule does not depend on PdfModule (PdfModule → Orders →
 * Payouts would be circular).
 */
export type PayoutInvoiceData = {
  requestNumber: string;
  requestedAt?: Date | string | null;
  approvedAt?: Date | string | null;
  amount: number;
  currency?: string;
  payee: {
    name: string;
    companyName?: string;
    partnerCode?: string;
    role?: string;
    email?: string;
    address?: string;
    city?: string;
    country?: string;
  };
  hubPartnerCode?: string;
  lines: Array<{
    orderNumber: string;
    earningType: string;
    percentage?: number;
    amount: number;
  }>;
  wise?: {
    reference?: string;
    fee?: number;
    /** Wise fee is charged in the source currency (USD by default). */
    feeCurrency?: string;
    targetAmount?: number;
    targetCurrency?: string;
  };
};

function resolveAsset(fileName: string, folder: string): string | null {
  const candidates = [
    path.join(process.cwd(), 'src', 'assets', folder, fileName),
    path.join(process.cwd(), 'dist', 'assets', folder, fileName),
    path.join(process.cwd(), 'assets', folder, fileName),
    path.join(__dirname, '..', 'assets', folder, fileName),
    path.join(__dirname, 'assets', folder, fileName),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function formatDate(value?: Date | string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function money(amount: number, currency = 'USD'): string {
  const value = Number.isFinite(amount) ? amount : 0;
  const fixed = value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency.toUpperCase() === 'USD' ? `$${fixed}` : `${currency.toUpperCase()} ${fixed}`;
}

function earningTypeLabel(earningType?: string): string {
  const type = String(earningType || '').replace(/\s*\(partial[^)]*\)\s*$/i, '').trim();
  if (type === 'Partner Development') return 'Partner Intro';
  if (type === 'Shop Introduction') return 'Shop Intro';
  return type || 'Shop Intro';
}

export function buildPayoutInvoicePdf(data: PayoutInvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margins: { top: 78, bottom: 118, left: 50, right: 50 },
        bufferPages: true,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const regular = resolveAsset('Mulish-Regular.ttf', 'fonts');
      const bold = resolveAsset('Mulish-Bold.ttf', 'fonts');
      const fontRegular = regular ? 'InvoiceSans' : 'Helvetica';
      const fontBold = bold ? 'InvoiceSans-Bold' : 'Helvetica-Bold';
      if (regular) doc.registerFont(fontRegular, regular);
      if (bold) doc.registerFont(fontBold, bold);

      const letterhead =
        resolveAsset('invoice-letterhead-page.svg', '') ||
        resolveAsset('invoice-letterhead.png', '');
      const drawLetterhead = () => {
        if (!letterhead) return;
        const savedX = doc.x;
        const savedY = doc.y;
        if (letterhead.toLowerCase().endsWith('.svg')) {
          const svg = fs
            .readFileSync(letterhead, 'utf8')
            .replace(/font-family:\s*Poppins-Regular,\s*Poppins/g, 'font-family: Helvetica');
          SVGtoPDF(doc, svg, 0, 0, {
            width: doc.page.width,
            height: doc.page.height,
            preserveAspectRatio: 'none',
          });
        } else {
          doc.image(letterhead, 0, 0, { width: doc.page.width, height: doc.page.height });
        }
        doc.x = savedX;
        doc.y = savedY;
      };
      doc.on('pageAdded', drawLetterhead);
      drawLetterhead();

      const currency = (data.currency || 'USD').toUpperCase();
      const left = doc.page.margins.left;
      const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const right = left + contentWidth;
      const ensureSpace = (needed: number) => {
        if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
      };

      // Title
      doc.fillColor('#0EA0DC').font(fontBold).fontSize(24).text('Commission Payout Invoice', {
        align: 'center',
      });
      doc.moveDown();

      // Invoice details (left) and payee (right)
      const columnGap = 16;
      const half = (contentWidth - columnGap) / 2;
      const rightX = left + half + columnGap;
      const topY = doc.y;
      const drawLines = (
        x: number,
        y: number,
        lines: Array<{ text: string; bold?: boolean; size?: number }>,
      ) => {
        let cursor = y;
        for (const line of lines) {
          doc
            .font(line.bold ? fontBold : fontRegular)
            .fontSize(line.size || 11)
            .fillColor('#272727');
          const h = doc.heightOfString(line.text, { width: half });
          doc.text(line.text, x, cursor, { width: half });
          cursor += h + 3;
        }
        return cursor;
      };

      const leftEnd = drawLines(left, topY, [
        { text: `Invoice Number: ${data.requestNumber}`, bold: true, size: 13 },
        { text: `Requested: ${formatDate(data.requestedAt)}` },
        { text: `Approved: ${formatDate(data.approvedAt)}` },
        { text: `Currency: ${currency}` },
        ...(data.hubPartnerCode ? [{ text: `Hub: ${data.hubPartnerCode}` }] : []),
        ...(data.wise?.reference ? [{ text: `Wise reference: ${data.wise.reference}` }] : []),
      ]);

      const payee = data.payee;
      const location = [payee.city, payee.country].filter(Boolean).join(', ');
      const rightEnd = drawLines(rightX, topY, [
        { text: 'Paid To:', bold: true, size: 13 },
        { text: `Name: ${payee.name}` },
        ...(payee.companyName ? [{ text: `Company: ${payee.companyName}` }] : []),
        ...(payee.partnerCode
          ? [{ text: `Partner ID: ${payee.partnerCode}${payee.role ? ` (${payee.role})` : ''}` }]
          : []),
        ...(payee.email ? [{ text: `Email: ${payee.email}` }] : []),
        ...(payee.address ? [{ text: `Address: ${payee.address}` }] : []),
        ...(location ? [{ text: location }] : []),
      ]);

      doc.x = left;
      doc.y = Math.max(leftEnd, rightEnd) + 14;

      // Commission lines
      doc.font(fontBold).fontSize(14).fillColor('#272727').text('Commission Included:', left);
      doc.moveDown(0.5);

      const cols = {
        order: { x: left, w: 190, align: 'left' as const },
        type: { x: left + 200, w: 150, align: 'left' as const },
        rate: { x: left + 360, w: 50, align: 'center' as const },
        amount: { x: left + 420, w: contentWidth - 420, align: 'right' as const },
      };
      const drawRow = (
        values: Record<keyof typeof cols, string>,
        font: string,
        size: number,
      ) => {
        doc.font(font).fontSize(size);
        const height = Math.max(
          ...(Object.keys(cols) as Array<keyof typeof cols>).map((k) =>
            doc.heightOfString(values[k] || ' ', { width: cols[k].w }),
          ),
          14,
        );
        ensureSpace(height + 6);
        const y = doc.y;
        (Object.keys(cols) as Array<keyof typeof cols>).forEach((k) => {
          doc.text(values[k] || ' ', cols[k].x, y, {
            width: cols[k].w,
            height,
            align: cols[k].align,
          });
        });
        doc.x = left;
        doc.y = y + height + 4;
      };

      drawRow({ order: 'Order', type: 'Commission type', rate: 'Rate', amount: 'Amount' }, fontBold, 10);
      doc.lineWidth(1).moveTo(left, doc.y).lineTo(right, doc.y).stroke();
      doc.moveDown(0.4);

      if (data.lines.length === 0) {
        drawRow(
          { order: 'Commission payout', type: '—', rate: '', amount: money(data.amount, currency) },
          fontRegular,
          10,
        );
      } else {
        for (const line of data.lines) {
          drawRow(
            {
              order: line.orderNumber || '—',
              type: earningTypeLabel(line.earningType),
              rate: line.percentage ? `${line.percentage}%` : '',
              amount: money(line.amount, currency),
            },
            fontRegular,
            10,
          );
        }
      }

      ensureSpace(110);
      doc.moveDown(0.2);
      doc.lineWidth(1).moveTo(left, doc.y).lineTo(right, doc.y).stroke();
      doc.moveDown(0.5);

      const totalLine = (label: string, value: string, font: string, size: number) => {
        ensureSpace(size + 14);
        const y = doc.y;
        doc.font(font).fontSize(size).fillColor('#272727');
        doc.text(label, left, y, { width: 380, align: 'right', lineBreak: false });
        doc.text(value, left + 380, y, { width: contentWidth - 380, align: 'right', lineBreak: false });
        doc.x = left;
        doc.y = y + size + 10;
      };

      totalLine('Approved Amount', money(data.amount, currency), fontBold, 16);
      if (data.wise?.fee && data.wise.fee > 0) {
        totalLine('Wise transfer fee', `-${money(data.wise.fee, data.wise.feeCurrency || currency)}`, fontRegular, 11);
      }
      if (data.wise?.targetAmount && data.wise.targetCurrency) {
        totalLine(
          'Amount sent to your bank',
          money(data.wise.targetAmount, data.wise.targetCurrency),
          fontRegular,
          11,
        );
      }

      doc.moveDown(0.8);
      ensureSpace(40);
      doc
        .font(fontRegular)
        .fontSize(9)
        .fillColor('#666666')
        .text(
          'Paid by SkyGloss via Wise. Transfer fees and any applicable taxes are deducted from the approved amount. Arrival time depends on the receiving bank.',
          left,
          doc.y,
          { width: contentWidth },
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
