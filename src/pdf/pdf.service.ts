import { Injectable } from '@nestjs/common';
const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');
import * as fs from 'fs';
import * as path from 'path';
import { User, UserRole } from '../users/entities/user.entity';
import { Order } from '../orders/entities/order.entity';
import {
  getDiscountDisplayLabel,
  getOrderTotalsBreakdown,
  isRegistrationOrder,
} from '../common/order-totals';
import { formatOrderItemDisplayName, formatOrderItemTypeLabel } from '../common/order-type';
import { isEuropeCountryName } from '../payouts/stripe-wise-payouts.logic';
import axios from 'axios';

export interface OrderPdfOptions {
  headerTitle?: string;
  displayOrderNumber?: string;
  referenceOrderNumber?: string;
  items?: Order['items'];
  totalAmount?: number;
  shippingFee?: number;
  discount?: number;
}

export interface PartnerCertificateData {
  /** Role line above the name, e.g. "REPRESENTATIVE". */
  title: string;
  /** Certificate holder (person or company). */
  name: string;
  /** Country / countries printed on the Territory line. */
  territory: string;
  /** Partner ID (user.partnerCode) printed on the Partner ID line. */
  partnerId: string;
  /** Activation date printed next to the signature. */
  date: Date;
}

@Injectable()
export class PdfService {

  private toOrderPdfSnapshot(order: Order | any, options?: OrderPdfOptions) {
    const orderPlain =
      typeof order?.toObject === 'function'
        ? order.toObject({ virtuals: true })
        : { ...(order || {}) };

    return {
      ...orderPlain,
      user: orderPlain.user ?? order?.user,
      shippingAddress: orderPlain.shippingAddress ?? order?.shippingAddress,
      items: options?.items ?? orderPlain.items ?? order?.items ?? [],
      totalAmount:
        options?.totalAmount ?? orderPlain.totalAmount ?? order?.totalAmount,
      shippingFee:
        options?.shippingFee ?? orderPlain.shippingFee ?? order?.shippingFee,
      discount: options?.discount ?? orderPlain.discount ?? order?.discount,
      orderNumber: orderPlain.orderNumber ?? order?.orderNumber,
      status: orderPlain.status ?? order?.status,
      createdAt: orderPlain.createdAt ?? order?.createdAt,
      currency: orderPlain.currency ?? order?.currency,
      amountPaid: orderPlain.amountPaid ?? order?.amountPaid,
    };
  }

  private withCloudinaryQuality(url: string, transforms: string): string {
    if (!url.includes('/upload/')) return url;
    if (url.includes('/upload/' + transforms + '/')) return url;
    return url.replace('/upload/', `/upload/${transforms}/`);
  }

  private async fetchImageBuffer(url: string): Promise<Buffer> {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: { Accept: 'image/*' },
    });
    return Buffer.from(response.data);
  }

  private formatCertificateDate(date: Date): string {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const day = date.getDate();
    const suffix =
      day % 10 === 1 && day !== 11
        ? 'st'
        : day % 10 === 2 && day !== 12
          ? 'nd'
          : day % 10 === 3 && day !== 13
            ? 'rd'
            : 'th';
    return `${months[date.getMonth()]} ${day}${suffix}, ${date.getFullYear()}`;
  }

  private resolveSignatureFontPath(): string | null {
    const candidates = [
      path.join(process.cwd(), 'src', 'assets', 'fonts', 'GreatVibes-Regular.ttf'),
      path.join(process.cwd(), 'assets', 'fonts', 'GreatVibes-Regular.ttf'),
      path.join(process.cwd(), 'dist', 'assets', 'fonts', 'GreatVibes-Regular.ttf'),
      path.join(__dirname, '..', 'assets', 'fonts', 'GreatVibes-Regular.ttf'),
      path.join(__dirname, 'assets', 'fonts', 'GreatVibes-Regular.ttf'),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  }

  private resolveAssetPath(fileName: string, folder: string): string | null {
    const candidates = [
      path.join(process.cwd(), 'src', 'assets', folder, fileName),
      path.join(process.cwd(), 'dist', 'assets', folder, fileName),
      path.join(process.cwd(), 'assets', folder, fileName),
      path.join(__dirname, '..', 'assets', folder, fileName),
      path.join(__dirname, 'assets', folder, fileName),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  }

  /** Full-page SkyGloss letterhead used as the invoice background. */
  private resolveLetterheadPath(): string | null {
    return (
      this.resolveAssetPath('invoice-letterhead-page.svg', '') ||
      this.resolveAssetPath('invoice-letterhead.png', '')
    );
  }

  /**
   * Invoice body font is Mulish (SkyGloss standard).
   * DejaVu remains only if the Mulish files are missing, so ₹ / € still render.
   */
  private resolveInvoiceFonts(): { regular: string; bold: string } | null {
    const regular = this.resolveAssetPath('Mulish-Regular.ttf', 'fonts');
    const bold = this.resolveAssetPath('Mulish-Bold.ttf', 'fonts');
    if (regular && bold) return { regular, bold };
    return this.resolveUnicodeFonts();
  }

  /**
   * Helvetica (PDF built-in) cannot render ₹ / many Unicode currency glyphs.
   * Prefer DejaVu Sans so invoice symbols match the admin UI.
   */
  private resolveUnicodeFonts(): { regular: string; bold: string } | null {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const regular = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bold = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf');
      if (fs.existsSync(regular) && fs.existsSync(bold)) {
        return { regular, bold };
      }
    } catch {
      // package missing — try system fallbacks below
    }

    const systemPairs: Array<{ regular: string; bold: string }> = [
      {
        regular: 'C:\\Windows\\Fonts\\arial.ttf',
        bold: 'C:\\Windows\\Fonts\\arialbd.ttf',
      },
      {
        regular: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        bold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      },
    ];

    for (const pair of systemPairs) {
      if (fs.existsSync(pair.regular) && fs.existsSync(pair.bold)) {
        return pair;
      }
    }
    return null;
  }

  private getOrderCurrencyCode(order: Order | any): string {
    const raw =
      order?.originalCurrency ||
      order?.currency ||
      order?.baseCurrency ||
      'USD';
    return String(raw).trim().toUpperCase();
  }

  private getCurrencySymbol(currency?: string): string {
    const symbols: Record<string, string> = {
      USD: '$',
      EUR: '€',
      GBP: '£',
      AUD: 'A$',
      CAD: 'C$',
      NZD: 'NZ$',
      INR: '₹',
      PKR: 'Rs',
      AED: 'AED ',
      SAR: 'SAR ',
      JPY: '¥',
      CNY: '¥',
    };
    const key = currency?.toUpperCase();
    return (key && symbols[key]) || (currency ? `${currency} ` : '$');
  }

  private formatMoney(amount: number, currencySymbol: string): string {
    const value = Number.isFinite(amount) ? amount : 0;
    // Keep space when symbol is a code prefix (e.g. "AED ")
    const needsSpace =
      currencySymbol.endsWith(' ') || /^[A-Z]{2,}/.test(currencySymbol);
    const prefix = needsSpace
      ? currencySymbol.trimEnd() + ' '
      : currencySymbol;
    return `${prefix}${value.toFixed(2)}`;
  }

  async generateCertificate(user: User): Promise<Buffer> {
    return new Promise(async (resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          layout: 'landscape',
          margin: 0,
          compress: false,
          pdfVersion: '1.7',
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;

        // Full-bleed certificate template; nudge down so large watermark clears the title
        const bgUrl = this.withCloudinaryQuality(
          'https://res.cloudinary.com/dxhmopbei/image/upload/v1782826882/i76ou1myhdphtsxs2rc3.jpg',
          'q_100,w_4200,c_limit,f_jpg,fl_progressive',
        );
        const bg = await this.fetchImageBuffer(bgUrl);
        const bgOffsetY = 150;
        doc.image(bg, 0, bgOffsetY, {
          width: pageWidth,
          height: pageHeight - bgOffsetY,
        });

        const storeName =
          user.shopName ||
          user.companyName ||
          `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
          'SkyGloss Certified Shop';

        // ── Top: shop name + certified label (matches reference layout) ──
        const titleSize =
          storeName.length > 32 ? 30 : storeName.length > 22 ? 34 : 40;
        doc
          .font('Helvetica')
          .fontSize(titleSize)
          .fillColor('#111111')
          .text(storeName, 50, 36, {
            width: pageWidth - 100,
            align: 'center',
            lineBreak: false,
          });

        doc
          .font('Helvetica')
          .fontSize(11)
          .fillColor('#111111')
          .text('SKYGLOSS CERTIFIED', 50, 82, {
            width: pageWidth - 100,
            align: 'center',
          });

        // ── Left: previous Factory Forever signature image (smaller) + Skygloss Inc. ──
        const signUrl = this.withCloudinaryQuality(
          'https://res.cloudinary.com/dxhmopbei/image/upload/v1778551478/bmitulyne2fueroz5fyg.png',
          'q_100,w_900,f_png',
        );
        const sign = await this.fetchImageBuffer(signUrl);
        const signWidth = 110;
        const signX = 68;
        const signY = 112;
        doc.image(sign, signX, signY, { width: signWidth });

        const signLineY = signY + 48;
        doc
          .strokeColor('#111111')
          .lineWidth(0.75)
          .moveTo(signX, signLineY)
          .lineTo(signX + 180, signLineY)
          .stroke();

        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('#333333')
          .text('SkyGloss Inc.', signX, signLineY + 6);

        // ── Mid-right: date (same row as signature) ──
        const certifiedAt =
          (user as any).certifiedAt ||
          (user as any).updatedAt ||
          (user as any).createdAt ||
          new Date();
        const dateStr = this.formatCertificateDate(new Date(certifiedAt));
        const dateX = 310;

        doc
          .font('Helvetica')
          .fontSize(12)
          .fillColor('#111111')
          .text(dateStr, dateX, signY + 18, { width: 200, align: 'left' });

        doc
          .strokeColor('#111111')
          .lineWidth(0.75)
          .moveTo(dateX, signLineY)
          .lineTo(dateX + 170, signLineY)
          .stroke();

        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('#333333')
          .text('Date', dateX, signLineY + 6);

        // ── Below signature: certification number ──
        const certNo = (user as any).certificateNumber || '14943212';
        const certY = signLineY + 36;
        doc
          .font('Helvetica')
          .fontSize(13)
          .fillColor('#111111')
          .text(String(certNo), signX, certY, { width: 160, align: 'left' });

        doc
          .strokeColor('#111111')
          .lineWidth(0.75)
          .moveTo(signX, certY + 20)
          .lineTo(signX + 130, certY + 20)
          .stroke();

        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('#333333')
          .text('Certification No', signX, certY + 26);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Partner certificate (Assets → Your certificate)
  // Layout matches the "Master Distributor Certificate" design (A4 landscape):
  // navy header with the Factory Forever signature (vector SVG), role title,
  // partner name, Skygloss Inc. signature + date, and a Territory line.
  // ───────────────────────────────────────────────────────────────────────────

  private resolvePartnerCertificateHeaderSvg(): string | null {
    const file = this.resolveAssetPath('partner-certificate-header.svg', '');
    if (!file) return null;
    return fs.readFileSync(file, 'utf8');
  }

  /** Day with ordinal + month + year, e.g. "27th May 2025" (certificate design). */
  private formatPartnerCertificateDate(date: Date): string {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const day = date.getDate();
    const suffix =
      day % 10 === 1 && day !== 11
        ? 'st'
        : day % 10 === 2 && day !== 12
          ? 'nd'
          : day % 10 === 3 && day !== 13
            ? 'rd'
            : 'th';
    return `${day}${suffix} ${months[date.getMonth()]} ${date.getFullYear()}`;
  }

  /** Certificate title / holder name / territory derived from the user record. */
  getPartnerCertificateData(user: User | any): PartnerCertificateData {
    const role = String(user?.role || '');
    const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
    const company = String(user?.companyName || '').trim();
    const isCompanyRole =
      role === UserRole.DISTRIBUTOR || role === UserRole.PARTNER;

    const title =
      role === UserRole.MASTER_PARTNER
        ? 'REPRESENTATIVE'
        : role === UserRole.REGIONAL_PARTNER
          ? 'PROMOTER'
          : role === UserRole.DISTRIBUTOR
            ? 'DISTRIBUTOR'
            : role === UserRole.PARTNER
              ? 'HUB'
              : 'SKYGLOSS PARTNER';

    const name =
      (isCompanyRole ? company || fullName : fullName || company) ||
      'SkyGloss Partner';

    const countries: string[] = Array.isArray(user?.countries)
      ? user.countries.filter(Boolean)
      : [];
    const territory =
      (role === UserRole.PARTNER && countries.length > 0
        ? countries.join(', ')
        : String(user?.country || '').trim()) || '';

    const activatedAt =
      user?.accountActivatedAt ||
      (role === UserRole.PARTNER ? user?.createdAt : null) ||
      user?.updatedAt ||
      new Date();

    const partnerId = String(user?.partnerCode || '').trim();

    return { title, name, territory, partnerId, date: new Date(activatedAt) };
  }

  async generatePartnerCertificate(data: PartnerCertificateData): Promise<Buffer> {
    const headerSvg = this.resolvePartnerCertificateHeaderSvg();
    const regularPath = this.resolveAssetPath('Mulish-Regular.ttf', 'fonts');
    const boldPath = this.resolveAssetPath('Mulish-Bold.ttf', 'fonts');
    const semiBoldPath =
      this.resolveAssetPath('Mulish-SemiBold.ttf', 'fonts') || boldPath;
    const signaturePath = this.resolveAssetPath('factory-forever.png', '');

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          layout: 'landscape',
          margin: 0,
          pdfVersion: '1.7',
          info: { Title: `SkyGloss ${data.title} Certificate` },
        });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const pageW = doc.page.width; // 841.89
        const pageH = doc.page.height; // 595.28
        const INK = '#030404';
        const GREY = '#221f20';
        const NAVY = '#282b71';
        const RULE = '#333131';

        const FONT_REG = regularPath ? 'Mulish' : 'Helvetica';
        const FONT_SEMI = semiBoldPath ? 'Mulish-SemiBold' : 'Helvetica-Bold';
        const FONT_BOLD = boldPath ? 'Mulish-Bold' : 'Helvetica-Bold';
        if (regularPath) doc.registerFont('Mulish', regularPath);
        if (semiBoldPath) doc.registerFont('Mulish-SemiBold', semiBoldPath);
        if (boldPath) doc.registerFont('Mulish-Bold', boldPath);

        // Draw text with its baseline at `baseline` (design coordinates are baselines).
        const textAt = (
          str: string,
          x: number,
          baseline: number,
          font: string,
          size: number,
          color: string,
          opts: { characterSpacing?: number } = {},
        ) => {
          doc.font(font).fontSize(size).fillColor(color);
          const ascender = ((doc as any)._font?.ascender ?? 1000) / 1000;
          doc.text(str, x, baseline - ascender * size, {
            lineBreak: false,
            characterSpacing: opts.characterSpacing ?? 0,
          });
        };
        const rule = (x1: number, x2: number, y: number) => {
          doc.strokeColor(RULE).lineWidth(0.3).moveTo(x1, y).lineTo(x2, y).stroke();
        };

        // ── Header: navy band + Factory Forever signature + SKYGLOSS logo (vector) ──
        if (headerSvg) {
          SVGtoPDF(doc, headerSvg, 0, 0, {
            width: pageW,
            height: pageH,
            preserveAspectRatio: 'none',
            assumePt: true,
          });
        } else {
          doc.rect(0, 0, pageW, 345).fill(NAVY);
        }
        // "BORN IN THE USA" sits inside the navy pill on the header line.
        textAt('BORN IN THE USA', 633.3, 277.2, FONT_BOLD, 12, '#ffffff', {
          characterSpacing: 1,
        });

        // ── Left: role title + holder name ──
        textAt(data.title, 101.26, 425, FONT_BOLD, 12, INK, {
          characterSpacing: 1.2,
        });

        // Name: design size 56.41pt on one line; long names shrink, then wrap
        // onto two lines so they never run into the signature column (x ≥ 472).
        const nameMaxWidth = 352;
        const nameBaseline = 518.32;
        const fits = (lines: string[], size: number) => {
          doc.font(FONT_SEMI).fontSize(size);
          return lines.every((l) => doc.widthOfString(l) <= nameMaxWidth);
        };
        const wrapTwo = (text: string, size: number): string[] | null => {
          const words = text.split(/\s+/).filter(Boolean);
          if (words.length < 2) return null;
          doc.font(FONT_SEMI).fontSize(size);
          // Best split: both lines fit, first line as long as possible.
          for (let i = words.length - 1; i >= 1; i -= 1) {
            const a = words.slice(0, i).join(' ');
            const b = words.slice(i).join(' ');
            if (
              doc.widthOfString(a) <= nameMaxWidth &&
              doc.widthOfString(b) <= nameMaxWidth
            ) {
              return [a, b];
            }
          }
          return null;
        };
        let nameLines = [data.name];
        let nameSize = 56.41;
        while (nameSize > 30 && !fits(nameLines, nameSize)) nameSize -= 1;
        if (!fits(nameLines, nameSize)) {
          let wrapped: string[] | null = null;
          nameSize = 34;
          while (nameSize > 16 && !(wrapped = wrapTwo(data.name, nameSize))) {
            nameSize -= 1;
          }
          if (wrapped) {
            nameLines = wrapped;
          } else {
            // Single very long word: keep shrinking on one line.
            while (nameSize > 12 && !fits(nameLines, nameSize)) nameSize -= 1;
          }
        }
        nameLines.forEach((line, idx) => {
          const fromBottom = nameLines.length - 1 - idx;
          textAt(line, 101.26, nameBaseline - fromBottom * nameSize * 1.12, FONT_SEMI, nameSize, INK);
        });

        // ── Right: Skygloss Inc. signature + date ──
        if (signaturePath) {
          const sigW = 132;
          const sigH = sigW * (182 / 520); // factory-forever.png aspect
          doc.image(signaturePath, 479, 417 - sigH / 2, { width: sigW });
        }
        rule(471.92, 667.04, 427.74);
        textAt('Skygloss Inc.', 471.8, 443.06, FONT_REG, 10, GREY);

        textAt(
          this.formatPartnerCertificateDate(data.date),
          681.68,
          419.06,
          FONT_SEMI,
          10,
          GREY,
        );
        rule(681.68, 776.72, 427.74);
        textAt('Date', 681.68, 443.06, FONT_REG, 10, GREY);

        // ── Partner ID + Territory (rules/values share one start so they align) ──
        const fieldLine = (label: string, value: string, baseline: number) => {
          textAt(label, 471.8, baseline, FONT_REG, 10, GREY);
          rule(531, 776.72, baseline - 1.27);
          if (!value) return;
          let size = 10;
          doc.font(FONT_SEMI).fontSize(size);
          while (size > 7 && doc.widthOfString(value) > 237) {
            size -= 0.5;
            doc.fontSize(size);
          }
          textAt(value, 536.6, baseline - 4.32, FONT_SEMI, size, GREY);
        };
        fieldLine('Partner ID:', data.partnerId, 480.69);
        fieldLine('Territory:', data.territory, 518.32);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Count leaf pages in a PDF buffer (`/Type /Page`, not `/Pages`).
   * Used by tests and local verification of invoice pagination.
   */
  countPdfPages(buffer: Buffer): number {
    const text = buffer.toString('latin1');
    const matches = text.match(/\/Type\s*\/Page(?!\s*s)\b/g);
    return matches?.length ?? 0;
  }

  async generateOrderDetails(
    order: Order,
    options?: OrderPdfOptions,
  ): Promise<Buffer> {
    return new Promise((resolve) => {
      const snapshot = this.toOrderPdfSnapshot(order, options);

      const doc = new PDFDocument({
        margins: { top: 78, bottom: 118, left: 50, right: 50 },
        bufferPages: true,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const registrationOrder = isRegistrationOrder(snapshot);

      // Mulish is the SkyGloss invoice font. Fallback still covers ₹ / € / £.
      const invoiceFonts = this.resolveInvoiceFonts();
      const fontRegular = invoiceFonts ? 'InvoiceSans' : 'Helvetica';
      const fontBold = invoiceFonts ? 'InvoiceSans-Bold' : 'Helvetica-Bold';
      if (invoiceFonts) {
        doc.registerFont(fontRegular, invoiceFonts.regular);
        doc.registerFont(fontBold, invoiceFonts.bold);
      }

      const letterheadPath = this.resolveLetterheadPath();
      const drawLetterhead = () => {
        if (!letterheadPath) return;
        const savedX = doc.x;
        const savedY = doc.y;
        if (letterheadPath.toLowerCase().endsWith('.svg')) {
          const svg = fs
            .readFileSync(letterheadPath, 'utf8')
            .replace(
              /font-family:\s*Poppins-Regular,\s*Poppins/g,
              'font-family: Helvetica',
            );
          SVGtoPDF(doc, svg, 0, 0, {
            width: doc.page.width,
            height: doc.page.height,
            preserveAspectRatio: 'none',
          });
        } else {
          doc.image(letterheadPath, 0, 0, {
            width: doc.page.width,
            height: doc.page.height,
          });
        }
        doc.x = savedX;
        doc.y = savedY;
      };
      doc.on('pageAdded', drawLetterhead);
      drawLetterhead();

      const currencyCode = this.getOrderCurrencyCode(snapshot);
      const currencySymbol = this.getCurrencySymbol(currencyCode);

      /**
       * PDFKit page-breaks mid-row when absolute-Y `text()` overflows the bottom.
       * That leaves each table cell on its own page. Always reserve space for the
       * full row (or totals block) before drawing any column.
       */
      const ensureVerticalSpace = (neededHeight: number) => {
        const bottom = doc.page.height - doc.page.margins.bottom;
        if (doc.y + neededHeight > bottom) {
          doc.addPage();
        }
      };

      // Header
      doc.fontSize(24).fillColor('#0EA0DC').font(fontBold).text(
        options?.headerTitle ||
          (registrationOrder ? 'Registration Invoice' : 'Order Invoice'),
        { align: 'center' },
      );
      doc.moveDown();

      doc.fillColor('#272727');
      const displayOrderNumber =
        options?.displayOrderNumber || snapshot.orderNumber;
      const user = snapshot.user as any;
      const shippingPreview = snapshot.shippingAddress || {};
      const clean = (value: unknown) => {
        const text = String(value ?? '').trim();
        if (!text || text === 'undefined' || text === 'null') return '';
        return text;
      };
      const customerName =
        [clean(user?.firstName), clean(user?.lastName)].filter(Boolean).join(' ') ||
        [clean(shippingPreview.firstName), clean(shippingPreview.lastName)]
          .filter(Boolean)
          .join(' ') ||
        'N/A';
      const customerEmail =
        clean(user?.email) || clean(shippingPreview.email) || 'N/A';
      const addressLine2 = clean(shippingPreview.address2);
      const businessName = [
        user?.companyName,
        user?.shopName,
        // Pickup orders store the Hub's name here, not the customer's business.
        snapshot.isPickup ? '' : shippingPreview.companyName,
        snapshot.isPickup ? '' : addressLine2,
      ]
        .map((value) => clean(value))
        .find(Boolean);
      const addressLine2IsBusinessName =
        !!addressLine2 && businessName === addressLine2;

      const contentLeft = doc.page.margins.left;
      const contentWidth =
        doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const columnGap = 16;
      const halfWidth = (contentWidth - columnGap) / 2;
      const rightX = contentLeft + halfWidth + columnGap;
      const columnsY = doc.y;

      const drawColumn = (
        x: number,
        width: number,
        y: number,
        lines: Array<{ text: string; fontName: string; fontSize: number }>,
      ) => {
        let cursor = y;
        lines.forEach((line) => {
          doc.font(line.fontName).fontSize(line.fontSize).fillColor('#272727');
          const height = doc.heightOfString(line.text, { width });
          doc.text(line.text, x, cursor, { width, height });
          cursor += height + 3;
        });
        return cursor;
      };

      const orderLines: Array<{ text: string; fontName: string; fontSize: number }> = [
        {
          text: `Order Number: ${displayOrderNumber}`,
          fontName: fontBold,
          fontSize: 14,
        },
      ];
      if (options?.referenceOrderNumber) {
        orderLines.push({
          text: `Original Order: ${options.referenceOrderNumber}`,
          fontName: fontRegular,
          fontSize: 12,
        });
      }
      orderLines.push(
        {
          text: `Date: ${new Date((snapshot as any).createdAt).toLocaleString()}`,
          fontName: fontRegular,
          fontSize: 12,
        },
        {
          text: `Status: ${String(snapshot.status || 'PENDING').toUpperCase()}`,
          fontName: fontRegular,
          fontSize: 12,
        },
        {
          text: `Currency: ${currencyCode}`,
          fontName: fontRegular,
          fontSize: 12,
        },
      );

      const customerLines: Array<{ text: string; fontName: string; fontSize: number }> = [
        { text: 'Customer Information:', fontName: fontBold, fontSize: 14 },
        { text: `Name: ${customerName}`, fontName: fontRegular, fontSize: 12 },
      ];
      if (businessName) {
        customerLines.push({
          text: `Business Name: ${businessName}`,
          fontName: fontRegular,
          fontSize: 12,
        });
      }
      customerLines.push({
        text: `Email: ${customerEmail}`,
        fontName: fontRegular,
        fontSize: 12,
      });
      // Pickup orders show the Hub below, so the customer's phone / tax ID live here.
      if (snapshot.isPickup && clean(shippingPreview.phoneNumber)) {
        customerLines.push({
          text: `Phone: ${clean(shippingPreview.phoneNumber)}`,
          fontName: fontRegular,
          fontSize: 12,
        });
      }
      if (snapshot.isPickup && clean(shippingPreview.taxId)) {
        const taxLabel = isEuropeCountryName(shippingPreview.country)
          ? 'VAT Number'
          : 'Tax ID';
        customerLines.push({
          text: `${taxLabel}: ${clean(shippingPreview.taxId)}`,
          fontName: fontRegular,
          fontSize: 12,
        });
      }

      const leftEnd = drawColumn(contentLeft, halfWidth, columnsY, orderLines);
      const rightEnd = drawColumn(rightX, halfWidth, columnsY, customerLines);
      doc.x = contentLeft;
      doc.y = Math.max(leftEnd, rightEnd) + 10;

      // Shipping Info
      const shipping = snapshot.shippingAddress || {};
      if (snapshot.isPickup) {
        // shippingAddress holds the Hub's address; skip placeholders saved for missing fields.
        const hubValue = (value: unknown) => {
          const text = clean(value);
          return text.toUpperCase() === 'N/A' ? '' : text;
        };
        doc.fontSize(14).font(fontBold).text('Pickup Location (Hub):');
        doc.fontSize(12).font(fontRegular);
        doc.text('Customer will collect this order from the Hub (no shipping).');
        const hubLines: Array<[string, unknown]> = [
          ['Hub', shipping.companyName],
          ['Address', shipping.address],
          ['Address Line 2', shipping.address2],
          ['City', shipping.city],
          ['State', shipping.state],
          ['Zip Code', shipping.zipCode],
          ['Country', shipping.country],
          ['Hub Phone', (snapshot as any).pickupHubPhone],
        ];
        for (const [label, value] of hubLines) {
          const text = hubValue(value);
          if (text) doc.text(`${label}: ${text}`);
        }
        doc.moveDown();
      } else {
        doc.fontSize(14).font(fontBold).text('Shipping Address:');
        doc.fontSize(12).font(fontRegular);
        doc.text(
          `Name: ${[shipping.firstName, shipping.lastName].filter(Boolean).join(' ') || 'N/A'}`,
        );
        doc.text(`Email: ${shipping.email || 'N/A'}`);
        if (shipping.companyName) {
          doc.text(`Company: ${shipping.companyName}`);
        }
        doc.text(`Address: ${shipping.address || 'N/A'}`);
        if (shipping.address2 && !addressLine2IsBusinessName) {
          doc.text(`Address Line 2: ${shipping.address2}`);
        }
        doc.text(`City: ${shipping.city || 'N/A'}`);
        doc.text(`State: ${shipping.state || 'N/A'}`);
        doc.text(`Zip Code: ${shipping.zipCode || 'N/A'}`);
        doc.text(`Country: ${shipping.country || 'N/A'}`);
        doc.text(`Phone: ${shipping.phoneNumber || 'N/A'}`);
        if (shipping.taxId) {
          const taxLabel = isEuropeCountryName(shipping.country)
            ? 'VAT Number'
            : 'Tax ID';
          doc.text(`${taxLabel}: ${shipping.taxId}`);
        }
        doc.moveDown();
      }

      // Items Table
      doc.fontSize(14).font(fontBold).text('Order Items:');
      doc.moveDown(0.5);

      const itemColumns = {
        item: { x: 50, w: 155, align: 'left' as const },
        size: { x: 215, w: 95, align: 'left' as const },
        type: { x: 320, w: 50, align: 'center' as const },
        qty: { x: 380, w: 40, align: 'center' as const },
        price: { x: 430, w: 55, align: 'right' as const },
        total: { x: 495, w: 55, align: 'right' as const },
      };
      const tableLineGap = 2;
      const tableRowPadding = 4;

      const measureCellHeight = (text: string, width: number) =>
        doc.heightOfString(text || ' ', { width, lineGap: tableLineGap });

      const drawItemRow = (
        y: number,
        values: Record<keyof typeof itemColumns, string>,
        fontName: string,
        fontSize: number,
        rowHeight: number,
      ) => {
        doc.fontSize(fontSize).font(fontName);
        (Object.keys(itemColumns) as Array<keyof typeof itemColumns>).forEach((key) => {
          const col = itemColumns[key];
          // Explicit height keeps PDFKit from flowing a single cell onto a new page.
          doc.text(values[key] || ' ', col.x, y, {
            width: col.w,
            height: rowHeight,
            align: col.align,
            lineGap: tableLineGap,
            ellipsis: true,
          });
        });
        // Absolute-positioned text still advances doc.y — pin it after the row.
        doc.x = doc.page.margins.left;
        doc.y = y + rowHeight;
      };

      const headerRowHeight = 16;
      ensureVerticalSpace(headerRowHeight + 28);
      const headerY = doc.y;
      drawItemRow(
        headerY,
        {
          item: 'Item',
          size: 'Size',
          type: 'Type',
          qty: 'Qty',
          price: 'Price',
          total: 'Total',
        },
        fontBold,
        10,
        headerRowHeight,
      );
      doc.moveDown(0.35);
      doc.lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);

      console.log(
        `[PdfService] Generating PDF for order ${displayOrderNumber}. currency=${snapshot.currency} originalCurrency=${(snapshot as any).originalCurrency} resolved=${currencyCode} symbol=${currencySymbol} invoiceFont=${!!invoiceFonts}`,
      );

      doc.font(fontRegular);
      snapshot.items.forEach((item) => {
        const lineTotal = item.price * item.quantity;
        const rowValues = {
          item: formatOrderItemDisplayName(item).toUpperCase(),
          size: item.size || '',
          type: formatOrderItemTypeLabel(item.orderType),
          qty: item.quantity.toString(),
          price: this.formatMoney(item.price, currencySymbol),
          total: this.formatMoney(lineTotal, currencySymbol),
        };

        doc.fontSize(10).font(fontRegular);
        const rowHeight = Math.max(
          ...(Object.keys(itemColumns) as Array<keyof typeof itemColumns>).map((key) =>
            measureCellHeight(rowValues[key], itemColumns[key].w),
          ),
          14,
        );

        ensureVerticalSpace(rowHeight + tableRowPadding);
        const rowY = doc.y;
        drawItemRow(rowY, rowValues, fontRegular, 10, rowHeight);
        doc.y = rowY + rowHeight + tableRowPadding;
      });

      // Reserve room for divider + subtotal/shipping/total (3–4 lines).
      ensureVerticalSpace(78);
      doc.moveDown(0.15);
      doc.lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);

      const userCountry = (snapshot.user as any)?.country;
      const { subtotal, shippingFee, discount, vatAmount, vatRate, total } =
        getOrderTotalsBreakdown(snapshot as any, userCountry);

      const drawTotalsLine = (
        label: string,
        value: string,
        fontName: string,
        fontSize: number,
      ) => {
        ensureVerticalSpace(fontSize + 14);
        const y = doc.y;
        doc.fontSize(fontSize).font(fontName);
        doc.text(label, 50, y, { width: 380, align: 'right', lineBreak: false });
        doc.text(value, 430, y, { width: 115, align: 'right', lineBreak: false });
        doc.x = doc.page.margins.left;
        doc.y = y + fontSize + 10;
      };

      drawTotalsLine(
        'Subtotal',
        this.formatMoney(subtotal, currencySymbol),
        fontRegular,
        12,
      );

      if (discount > 0.01) {
        const discountLabel = getDiscountDisplayLabel(snapshot as any);
        drawTotalsLine(
          discountLabel,
          `-${this.formatMoney(discount, currencySymbol)}`,
          fontRegular,
          12,
        );
      }

      if (!registrationOrder) {
        drawTotalsLine(
          'Shipping',
          shippingFee > 0.01
            ? this.formatMoney(shippingFee, currencySymbol)
            : 'FREE',
          fontRegular,
          12,
        );
      }

      if (vatAmount > 0.01) {
        drawTotalsLine(
          vatRate > 0 ? `VAT (${vatRate}%)` : 'VAT',
          this.formatMoney(vatAmount, currencySymbol),
          fontRegular,
          12,
        );
      }

      drawTotalsLine(
        'Total Amount',
        this.formatMoney(total, currencySymbol),
        fontBold,
        16,
      );

      const amountPaid = Number((snapshot as any).amountPaid) || 0;
      if (amountPaid > 0.01) {
        const remaining = Math.max(0, total - amountPaid);
        drawTotalsLine(
          'Paid',
          this.formatMoney(amountPaid, currencySymbol),
          fontRegular,
          12,
        );
        drawTotalsLine(
          'Remaining',
          this.formatMoney(remaining, currencySymbol),
          fontRegular,
          12,
        );
      }

      doc.end();
    });
  }

  /**
   * Portrait business card (55×85mm).
   * Front matches the shared SkyGloss card: name, role, company, email, phone,
   * social block, and the factory forever signature on a cyan bar.
   * Back is the same logo card for every user.
   */
  async generateBusinessCard(user: User): Promise<Buffer> {
    const mm = 72 / 25.4;
    const width = 55 * mm;
    const height = 85 * mm;
    const cyan = '#0EA0DC';
    const ink = '#111111';

    const fullName = (
      `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'SkyGloss'
    ).toUpperCase();
    const title = this.businessCardTitle(user.role);
    const phone = String(user.phoneNumber || '').trim();
    const email = String(user.email || '').trim().toUpperCase();

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: [width, height],
          margin: 0,
          autoFirstPage: false,
        });
        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const page = { size: [width, height] as [number, number], margin: 0 };
        const padX = 16;

        doc.addPage(page);
        doc.rect(0, 0, width, height).fill('#ffffff');

        let y = 22;
        doc.font('Times-Bold').fillColor(ink);
        let nameSize = 15;
        doc.fontSize(nameSize);
        while (nameSize > 9 && doc.widthOfString(fullName) > width - padX * 2) {
          nameSize -= 0.5;
          doc.fontSize(nameSize);
        }
        doc.text(fullName, padX, y, { lineBreak: false });
        y += nameSize + 3;

        if (title) {
          doc.font('Times-Roman').fontSize(9).fillColor(ink);
          doc.text(title, padX, y, {
            width: width - padX * 2,
            lineBreak: false,
          });
          y += 12;
        }

        doc.font('Times-Bold').fontSize(9).fillColor(ink);
        doc.text('SkyGloss Global', padX, y, { lineBreak: false });
        y += 18;

        if (email) {
          doc.font('Helvetica').fillColor(ink);
          let emailSize = 7.5;
          doc.fontSize(emailSize);
          while (emailSize > 5 && doc.widthOfString(email) > width - padX * 2) {
            emailSize -= 0.25;
            doc.fontSize(emailSize);
          }
          doc.text(email, padX, y, { lineBreak: false });
          y += emailSize + 4;
        }
        if (phone) {
          doc.font('Helvetica').fontSize(7.5).fillColor(ink);
          doc.text(phone, padX, y, { lineBreak: false });
          y += 16;
        } else {
          y += 8;
        }

        const badgeSize = 24;
        const badgePath = this.resolveAssetPath('social-badge.svg', '');
        if (badgePath) {
          const savedX = doc.x;
          const savedY = doc.y;
          SVGtoPDF(doc, fs.readFileSync(badgePath, 'utf8'), padX, y, {
            width: badgeSize,
            height: badgeSize,
            assumePt: true,
            preserveAspectRatio: 'xMinYMin meet',
          });
          doc.x = savedX;
          doc.y = savedY;
        }
        const socialX = padX + badgeSize + 7;
        doc.font('Helvetica-Bold').fontSize(7).fillColor(ink);
        doc.text('SKYGLOSS.COM', socialX, y + 5, { lineBreak: false });
        doc.font('Helvetica-Bold').fontSize(7).fillColor(ink);
        doc.text('@SKYGLOSS.SERVICES', socialX, y + 15, { lineBreak: false });

        const barInset = 14;
        const barH = height * 0.18;
        const barY = height - barH;
        doc.save();
        doc.rect(barInset, barY, width - barInset * 2, barH).fill(cyan);
        doc.restore();

        const signPath = this.resolveAssetPath('factory-forever.png', '');
        if (signPath) {
          const signW = width * 0.58;
          const signH = signW * (171 / 509);
          const signX = width - signW - 12;
          const signY = barY - signH * 0.55;
          doc.image(signPath, signX, signY, { width: signW, height: signH });
        }

        doc.addPage(page);
        doc.rect(0, 0, width, height).fill('#ffffff');
        const bandH = height * 0.3;
        doc.rect(0, height - bandH, width, bandH).fill(cyan);

        const logoPath = this.resolveAssetPath('skygloss-logo.png', '');
        if (logoPath) {
          const logoW = width * 0.72;
          const logoH = logoW * (32 / 169);
          const whiteH = height - bandH;
          doc.image(logoPath, (width - logoW) / 2, (whiteH - logoH) / 2, {
            width: logoW,
            height: logoH,
          });
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  private businessCardTitle(role?: string): string {
    switch (role) {
      case 'partner':
        return 'Hub';
      case 'distributor':
        return 'Distributor';
      case 'master_partner':
        return 'Representative';
      case 'regional_partner':
        return 'Promoter';
      case 'sub_promoter':
        return 'Sub-Promoter';
      case 'certified_shop':
        return 'Certified Shop';
      case 'admin':
        return 'Admin';
      default:
        return '';
    }
  }
}
