import { Injectable } from '@nestjs/common';
const PDFDocument = require('pdfkit');
import * as fs from 'fs';
import * as path from 'path';
import { User } from '../users/entities/user.entity';
import { Order } from '../orders/entities/order.entity';
import {
  getDiscountDisplayLabel,
  getOrderTotalsBreakdown,
  isRegistrationOrder,
} from '../common/order-totals';
import { formatOrderItemDisplayName, formatOrderItemTypeLabel } from '../common/order-type';
import axios from 'axios';

@Injectable()
export class PdfService {

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

  async generateOrderDetails(order: Order): Promise<Buffer> {
    return new Promise((resolve) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const registrationOrder = isRegistrationOrder(order);

      // Header
      doc.fontSize(24).fillColor('#0EA0DC').font('Helvetica-Bold').text(
        registrationOrder ? 'Registration Invoice' : 'Order Invoice',
        { align: 'center' },
      );
      doc.moveDown();

      doc.fontSize(12).fillColor('#272727').font('Helvetica');
      doc.text(`Order Number: ${order.orderNumber}`);
      doc.text(`Date: ${new Date((order as any).createdAt).toLocaleString()}`);
      doc.text(`Status: ${order.status.toUpperCase()}`);
      doc.moveDown();

      // Customer Info
      doc.fontSize(14).font('Helvetica-Bold').text('Customer Information:');
      doc.fontSize(12).font('Helvetica');
      const user = order.user as any;
      doc.text(`Name: ${user?.firstName} ${user?.lastName}`);
      doc.text(`Email: ${user?.email}`);
      doc.moveDown();

      // Shipping Info
      const shipping = order.shippingAddress;
      doc.fontSize(14).font('Helvetica-Bold').text('Shipping Address:');
      doc.fontSize(12).font('Helvetica');
      doc.text(
        `Name: ${[shipping.firstName, shipping.lastName].filter(Boolean).join(' ') || 'N/A'}`,
      );
      doc.text(`Email: ${shipping.email || 'N/A'}`);
      if (shipping.companyName) {
        doc.text(`Company: ${shipping.companyName}`);
      }
      doc.text(`Address: ${shipping.address || 'N/A'}`);
      if (shipping.address2) {
        doc.text(`Address Line 2: ${shipping.address2}`);
      }
      doc.text(`City: ${shipping.city || 'N/A'}`);
      doc.text(`State: ${shipping.state || 'N/A'}`);
      doc.text(`Zip Code: ${shipping.zipCode || 'N/A'}`);
      doc.text(`Country: ${shipping.country || 'N/A'}`);
      doc.text(`Phone: ${shipping.phoneNumber || 'N/A'}`);
      if (shipping.taxId) {
        doc.text(`Tax ID: ${shipping.taxId}`);
      }
      doc.moveDown();

      // Items Table
      doc.fontSize(14).font('Helvetica-Bold').text('Order Items:', { underline: true });
      doc.moveDown(0.5);

      const itemColumns = {
        item: { x: 50, w: 155, align: 'left' as const },
        size: { x: 215, w: 95, align: 'left' as const },
        type: { x: 320, w: 50, align: 'center' as const },
        qty: { x: 380, w: 40, align: 'center' as const },
        price: { x: 430, w: 55, align: 'right' as const },
        total: { x: 495, w: 55, align: 'right' as const },
      };
      const tableLineGap = 8;
      const tableRowPadding = 12;

      const measureCellHeight = (text: string, width: number) =>
        doc.heightOfString(text || ' ', { width, lineGap: tableLineGap });

      const drawItemRow = (
        y: number,
        values: Record<keyof typeof itemColumns, string>,
        fontName: string,
        fontSize: number,
      ) => {
        doc.fontSize(fontSize).font(fontName);
        (Object.keys(itemColumns) as Array<keyof typeof itemColumns>).forEach((key) => {
          const col = itemColumns[key];
          doc.text(values[key], col.x, y, {
            width: col.w,
            align: col.align,
            lineGap: tableLineGap,
          });
        });
      };

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
        'Helvetica-Bold',
        10,
      );
      doc.y = headerY + 18;
      doc.moveDown(0.75);
      doc.lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.75);

      const getCurrencySymbol = (currency?: string) => {
        const symbols: Record<string, string> = {
          'USD': '$',
          'EUR': '€',
          'GBP': '£',
          'AUD': '$',
          'CAD': '$',
          'INR': '₹',
          'AED': 'AED '
        };
        const key = currency?.toUpperCase();
        return (key && symbols[key]) || (currency ? (currency + ' ') : '??? ');
      };

      console.log(`[PdfService] Generating PDF for order ${order.orderNumber}. Currency in object: ${order.currency}`);
      const currencySymbol = getCurrencySymbol(order.currency);
      console.log(`[PdfService] Resolved symbol: ${currencySymbol}`);

      doc.font('Helvetica');
      order.items.forEach((item) => {
        const rowY = doc.y;
        const lineTotal = item.price * item.quantity;
        const rowValues = {
          item: formatOrderItemDisplayName(item).toUpperCase(),
          size: item.size || '',
          type: formatOrderItemTypeLabel(item.orderType),
          qty: item.quantity.toString(),
          price: `${currencySymbol}${item.price.toFixed(2)}`,
          total: `${currencySymbol}${lineTotal.toFixed(2)}`,
        };

        doc.fontSize(10).font('Helvetica');
        const rowHeight = Math.max(
          ...(Object.keys(itemColumns) as Array<keyof typeof itemColumns>).map((key) =>
            measureCellHeight(rowValues[key], itemColumns[key].w),
          ),
          16,
        );

        drawItemRow(rowY, rowValues, 'Helvetica', 10);
        doc.y = rowY + rowHeight + tableRowPadding;
      });

      doc.moveDown();
      doc.lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();

      const userCountry = (order.user as any)?.country;
      const { subtotal, shippingFee, discount, total } = getOrderTotalsBreakdown(
        order as any,
        userCountry,
      );

      const totalsY = doc.y;
      doc.fontSize(12).font('Helvetica');
      doc.text('Subtotal', 50, totalsY, { width: 380, align: 'right' });
      doc.text(`${currencySymbol}${subtotal.toFixed(2)}`, 430, totalsY, {
        width: 115,
        align: 'right',
      });
      doc.moveDown(0.75);

      if (discount > 0.01) {
        const discountY = doc.y;
        const discountLabel = getDiscountDisplayLabel(order as any);
        doc.text(discountLabel, 50, discountY, { width: 380, align: 'right' });
        doc.text(`-${currencySymbol}${discount.toFixed(2)}`, 430, discountY, {
          width: 115,
          align: 'right',
        });
        doc.moveDown(0.75);
      }

      if (!registrationOrder) {
        const shippingY = doc.y;
        if (shippingFee > 0.01) {
          doc.text('Shipping', 50, shippingY, { width: 380, align: 'right' });
          doc.text(`${currencySymbol}${shippingFee.toFixed(2)}`, 430, shippingY, {
            width: 115,
            align: 'right',
          });
        } else {
          doc.text('Shipping', 50, shippingY, { width: 380, align: 'right' });
          doc.text('FREE', 430, shippingY, { width: 115, align: 'right' });
        }
        doc.moveDown(0.75);
      }

      const totalY = doc.y;
      doc.fontSize(16).font('Helvetica-Bold');
      doc.text('Total Amount', 50, totalY, { width: 380, align: 'right' });
      doc.text(`${currencySymbol}${total.toFixed(2)}`, 430, totalY, {
        width: 115,
        align: 'right',
      });

      doc.end();
    });
  }
}
