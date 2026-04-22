import { Injectable } from '@nestjs/common';
const PDFDocument = require('pdfkit');
import { User } from '../users/entities/user.entity';
import { Order } from '../orders/entities/order.entity';

@Injectable()
export class PdfService {
  async generateCertificate(user: User): Promise<Buffer> {
    return new Promise((resolve) => {
      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margin: 50,
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      // Border
      doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40).lineWidth(5).stroke('#0EA0DC');
      doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60).lineWidth(1).stroke('#0EA0DC');

      // Title
      doc.fontSize(45).fillColor('#0EA0DC').font('Helvetica-Bold').text('CERTIFICATE OF COMPLETION', 0, 100, { align: 'center' });
      
      doc.moveDown(1);
      doc.fontSize(22).fillColor('#272727').font('Helvetica').text('This is to certify that', { align: 'center' });
      
      doc.moveDown(0.5);
      doc.fontSize(36).fillColor('#0EA0DC').font('Helvetica-Bold').text(`${user.firstName} ${user.lastName}`, { align: 'center' });
      
      doc.moveDown(0.5);
      doc.fontSize(20).fillColor('#272727').font('Helvetica').text('of', { align: 'center' });
      
      doc.moveDown(0.5);
      doc.fontSize(28).fillColor('#272727').font('Helvetica-Bold').text(user.shopName || user.companyName || 'SkyGloss Authorized Shop', { align: 'center' });
      
      doc.moveDown(1);
      doc.fontSize(18).font('Helvetica').text('has successfully completed the professional training program and is now a', { align: 'center' });
      
      doc.moveDown(0.5);
      doc.fontSize(26).fillColor('#0EA0DC').font('Helvetica-Bold').text('CERTIFIED SKYGLOSS INSTALLER', { align: 'center' });
      
      doc.moveDown(2);
      doc.fontSize(14).fillColor('#999999').text(`Certificate ID: SG-${(user as any)._id.toString().substring(0, 8).toUpperCase()}`, { align: 'center' });
      doc.text(`Issued Date: ${new Date().toLocaleDateString()}`, { align: 'center' });

      // Footer Logo Text
      doc.moveDown(2);
      doc.fontSize(24).fillColor('#0EA0DC').font('Helvetica-Bold').text('SKYGLOSS', { align: 'center' });

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
