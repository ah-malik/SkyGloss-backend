import { Injectable } from '@nestjs/common';
const PDFDocument = require('pdfkit');
import { User } from '../users/entities/user.entity';
import { Order } from '../orders/entities/order.entity';
import {
  getDiscountDisplayLabel,
  getOrderTotalsBreakdown,
  isRegistrationOrder,
} from '../common/order-totals';
import { formatOrderItemTypeLabel } from '../common/order-type';
import axios from 'axios';

@Injectable()
export class PdfService {

  async generateCertificate(user: User): Promise<Buffer> {
    return new Promise(async (resolve) => {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: 0,
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      // ✅ Background
      const bgUrl = 'https://res.cloudinary.com/dxhmopbei/image/upload/v1782826882/i76ou1myhdphtsxs2rc3.jpg';
      // const bgUrl = 'https://res.cloudinary.com/dxhmopbei/image/upload/v1777377593/ikbhkmhdwj6t0rsghffz.jpg';
      const bg = await axios.get(bgUrl, { responseType: 'arraybuffer' });

      doc.image(Buffer.from(bg.data), 0, 40, {
        width: doc.page.width,
        height: doc.page.height,
      });

      // ✅ Small Signature(LEFT)
      const signUrl = 'https://res.cloudinary.com/dxhmopbei/image/upload/v1778551478/bmitulyne2fueroz5fyg.png';
      const sign = await axios.get(signUrl, { responseType: 'arraybuffer' });

      doc.image(Buffer.from(sign.data), 60, 70, {
        width: 200,
      });

      // ✅ TEXT (perfect positioning)
      const storeName = user.shopName || user.companyName || `${user.firstName} ${user.lastName}`;

      // Main Title
      doc.fontSize(42)
        .fillColor('#111')
        .text(storeName || 'Car Care Melbourne', 0, 20, {
          align: 'center',
        });

      // Subtitle
      doc.fontSize(16)
        .text('SKYGLOSS CERTIFIED', 0, 65, { align: 'center' });

      // Left block
      // doc.fontSize(12).text('Jonas Svirtautas', 80, 100);
      doc.moveTo(80, 120).lineTo(280, 120).stroke();
      doc.text('SkyGloss Inc.', 80, 130);
      // "CERTIFICATE NUMBER" label START
      doc.fontSize(11)
        .fillColor('#222222')
        .font('Helvetica-Bold')
        .text('CERTIFICATE', 80, 200);
      doc.moveTo(80, 190).lineTo(200, 190).stroke();

      const certNo = (user as any).certificateNumber || '14943212';
      doc.fontSize(15)
        .fillColor('#222222')
        .font('Helvetica-Bold')
        .text(certNo.toString(), 80, 165);
      //       // "CERTIFICATE NUMBER" label END
      // doc.text('12831154', 80, 165);
      // doc.moveTo(80, 195).lineTo(200, 195).stroke();
      // doc.text('Certification No', 80, 205);

      // Date (right)
      const date = new Date().toLocaleDateString();
      doc.text(date, 225, 165);
      doc.moveTo(225, 190).lineTo(300, 190).stroke();
      doc.fontSize(11).text('DATE', 225, 200);

      doc.end();
    });
  }
  //   async generateCertificate(user: User): Promise<Buffer> {
  //     return new Promise(async (resolve) => {
  //       const doc = new PDFDocument({
  //         size: 'A4',
  //         layout: 'landscape',
  //         margin: 0,
  //       });
  // d
  //       const chunks: Buffer[] = [];
  //       doc.on('data', (chunk) => chunks.push(chunk));
  //       doc.on('end', () => resolve(Buffer.concat(chunks)));

  //       const pageWidth = doc.page.width;   // 842
  //       const pageHeight = doc.page.height; // 595

  //       // ── SECTION 1: Blue Header Banner Image ──
  //       const headerUrl = 'https://res.cloudinary.com/dxhmopbei/image/upload/v1777952451/u0a7gcyy9mpis8e0opwz.png';
  //       const headerImg = await axios.get(headerUrl, { responseType: 'arraybuffer' });
  //       const headerHeight = 280;
  //       doc.image(Buffer.from(headerImg.data), 0, 0, {
  //         width: pageWidth,
  //         height: headerHeight,
  //       });

  //       // ── SECTION 2: White Content Area ──
  //       const contentY = headerHeight + 30;
  //       const leftMargin = 60;
  //       const midX = pageWidth * 0.52;
  //       const rightX = pageWidth * 0.78;

  //       // "MASTER DISTRIBUTOR" label
  //       doc.fontSize(11)
  //         .fillColor('#222222')
  //         .font('Helvetica-Bold')
  //         .text('MASTER DISTRIBUTOR', leftMargin, contentY);

  //       // "CERTIFICATE NUMBER" label START
  //       doc.fontSize(11)
  //         .fillColor('#222222')
  //         .font('Helvetica-Bold')
  //         .text('CERTIFICATE NUMBER:', leftMargin, contentY + 22);

  //       const certNo = (user as any).certificateNumber || '14943212';
  //       doc.fontSize(15)
  //         .fillColor('#222222')
  //         .font('Helvetica-Bold')
  //         .text(certNo.toString(), leftMargin + 135, contentY + 20);
  //       // "CERTIFICATE NUMBER" label END

  //       // ── Signature Image (center area) ──
  //       const signUrl = 'https://res.cloudinary.com/dxhmopbei/image/upload/v1778551478/bmitulyne2fueroz5fyg.png';
  //       const signImg = await axios.get(signUrl, { responseType: 'arraybuffer' });
  //       const signWidth = 150;
  //       const signY = contentY - 15;
  //       doc.image(Buffer.from(signImg.data), midX, signY, {
  //         width: signWidth,
  //       });

  //       // Line under signature
  //       const signLineY = signY + 50;
  //       doc.lineWidth(0.5)
  //         .strokeColor('#333333')
  //         .moveTo(midX, signLineY)
  //         .lineTo(midX + signWidth + 10, signLineY)
  //         .stroke();

  //       // "Skygloss Inc." label under signature
  //       doc.fontSize(9)
  //         .fillColor('#555555')
  //         .font('Helvetica')
  //         .text('Skygloss Inc.', midX, signLineY + 5);

  //       // ── Date (right side) ──
  //       const months = ['January', 'February', 'March', 'April', 'May', 'June',
  //         'July', 'August', 'September', 'October', 'November', 'December'];
  //       const now = new Date();
  //       const day = now.getDate();
  //       const suffix = day === 1 || day === 21 || day === 31 ? 'st' : day === 2 || day === 22 ? 'nd' : day === 3 || day === 23 ? 'rd' : 'th';
  //       const dateStr = `${day}${suffix} ${months[now.getMonth()]} ${now.getFullYear()}`;

  //       doc.fontSize(11)
  //         .fillColor('#222222')
  //         .font('Helvetica-Bold')
  //         .text(dateStr, rightX, contentY + 20);

  //       // Line under date
  //       const dateLine = contentY + 35;
  //       doc.lineWidth(0.5)
  //         .strokeColor('#333333')
  //         .moveTo(rightX, dateLine)
  //         .lineTo(rightX + 130, dateLine)
  //         .stroke();

  //       // "Date" label
  //       doc.fontSize(9)
  //         .fillColor('#555555')
  //         .font('Helvetica')
  //         .text('Date', rightX, dateLine + 5);

  //       // ── Store Name (large, left side) ──
  //       const storeName = user.shopName || user.companyName || `${user.firstName} ${user.lastName}`;
  //       const storeNameY = contentY + 55;
  //       doc.fontSize(36)
  //         .fillColor('#111111')
  //         .font('Helvetica-Bold')
  //         .text(storeName, leftMargin, storeNameY, {
  //           width: pageWidth * 0.45,
  //         });

  //       // ── Territory (right side, aligned with store name) ──
  //       const territoryY = storeNameY + 15;
  //       doc.fontSize(10)
  //         .fillColor('#555555')
  //         .font('Helvetica')
  //         .text('Territory:', midX, territoryY);

  //       // Territory line
  //       const territoryLineY = territoryY + 15;
  //       doc.lineWidth(0.5)
  //         .strokeColor('#333333')
  //         .moveTo(midX + 55, territoryLineY)
  //         .lineTo(pageWidth - 60, territoryLineY)
  //         .stroke();

  //       // Territory value (country)
  //       if (user.country) {
  //         doc.fontSize(10)
  //           .fillColor('#222222')
  //           .font('Helvetica')
  //           .text(user.country, midX + 60, territoryY);
  //       }

  //       doc.end();
  //     });
  //   }

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
        item: { x: 50, w: 165, align: 'left' as const },
        size: { x: 225, w: 75, align: 'left' as const },
        type: { x: 310, w: 55, align: 'center' as const },
        qty: { x: 375, w: 45, align: 'center' as const },
        price: { x: 430, w: 55, align: 'right' as const },
        total: { x: 495, w: 55, align: 'right' as const },
      };
      const tableLineGap = 3;
      const tableRowPadding = 10;

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
          item: item.name.toUpperCase(),
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
          14,
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
