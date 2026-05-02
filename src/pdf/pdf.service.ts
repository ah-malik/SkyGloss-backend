import { Injectable } from '@nestjs/common';
const PDFDocument = require('pdfkit');
import { User } from '../users/entities/user.entity';
import { Order } from '../orders/entities/order.entity';
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
      const bgUrl = 'https://res.cloudinary.com/dxhmopbei/image/upload/v1777377593/ikbhkmhdwj6t0rsghffz.jpg';
      const bg = await axios.get(bgUrl, { responseType: 'arraybuffer' });

      doc.image(Buffer.from(bg.data), 0, 75, {
        width: doc.page.width,
        height: doc.page.height,
      });

      // ✅ Small Signature (LEFT)
      // const signUrl = 'https://res.cloudinary.com/dxhmopbei/image/upload/v1777378204/f8kav3aspmdyxpu7qtmo.jpg';
      // const sign = await axios.get(signUrl, { responseType: 'arraybuffer' });

      // doc.image(Buffer.from(sign.data), 10, 250, {
      //   width: 520,
      // });

      // ✅ TEXT (perfect positioning)

      // Main Title
      doc.fontSize(42)
        .fillColor('#111')
        .text(user.shopName || 'Car Care Melbourne', 0, 20, {
          align: 'center',
        });

      // Subtitle
      doc.fontSize(16)
        .text('SKYGLOSS CERTIFIED', 0, 65, { align: 'center' });

      // Left block
      doc.fontSize(12).text('Jonas Svirtautas', 80, 100);
      doc.moveTo(80, 120).lineTo(280, 120).stroke();
      doc.text('Skygloss Inc.', 80, 130);

      doc.text('12831154', 80, 165);
      doc.moveTo(80, 195).lineTo(200, 195).stroke();
      doc.text('Certification No', 80, 205);

      // Date (right)
      const date = new Date().toLocaleDateString();
      doc.text(date, 225, 165);
      doc.moveTo(225, 195).lineTo(300, 195).stroke();
      doc.text('Date', 225, 205);

      doc.end();
    });
  }

  async generateOrderDetails(order: Order): Promise<Buffer> {
    return new Promise((resolve) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      // Header
      doc.fontSize(24).fillColor('#0EA0DC').font('Helvetica-Bold').text('Order Details', { align: 'center' });
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
      doc.fontSize(14).font('Helvetica-Bold').text('Shipping Address:');
      doc.fontSize(12).font('Helvetica');
      doc.text(`${order.shippingAddress.firstName} ${order.shippingAddress.lastName}`);
      if (order.shippingAddress.companyName) doc.text(order.shippingAddress.companyName);
      doc.text(order.shippingAddress.address);
      doc.text(`${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.zipCode}`);
      doc.text(order.shippingAddress.country);
      doc.text(`Phone: ${order.shippingAddress.phoneNumber}`);
      doc.moveDown();

      // Items Table
      doc.fontSize(14).font('Helvetica-Bold').text('Order Items:', { underline: true });
      doc.moveDown(0.5);

      doc.fontSize(10).font('Helvetica-Bold');
      doc.text('Item', 50, doc.y, { width: 250 });
      doc.text('Size', 300, doc.y, { width: 100 });
      doc.text('Qty', 400, doc.y, { width: 50 });
      doc.text('Price', 450, doc.y, { width: 100 });
      doc.moveDown(0.5);
      doc.lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown(0.5);

      doc.font('Helvetica');
      order.items.forEach((item) => {
        const currentY = doc.y;
        doc.text(item.name, 50, currentY, { width: 250 });
        doc.text(item.size, 300, currentY, { width: 100 });
        doc.text(item.quantity.toString(), 400, currentY, { width: 50 });
        doc.text(`$${item.price.toFixed(2)}`, 450, currentY, { width: 100 });
        doc.moveDown();
      });

      doc.moveDown();
      doc.lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();

      doc.fontSize(16).font('Helvetica-Bold').text(`Total Amount: $${order.totalAmount.toFixed(2)}`, { align: 'right' });

      doc.end();
    });
  }
}
