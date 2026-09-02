import { Controller, Get, Param, Res, UseGuards, Req, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Response } from 'express';
import { PdfService } from './pdf.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { OrdersService } from '../orders/orders.service';

@Controller('pdf')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PdfController {
  constructor(
    private readonly pdfService: PdfService,
    private readonly usersService: UsersService,
    private readonly ordersService: OrdersService,
  ) {}

  @Get('certificate')
  async downloadCertificate(@Req() req: any, @Res() res: Response) {
    const user = await this.usersService.findOne(req.user.id);
    if (!user) throw new NotFoundException('User not found');
    if (!user.isCertified) throw new ForbiddenException('Shop is not certified yet');

    const buffer = await this.pdfService.generateCertificate(user);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=SkyGloss_Certificate_${user.firstName}_${user.lastName}.pdf`,
      'Content-Length': buffer.length,
    });

    res.end(buffer);
  }

  @Get('order/:id')
  @Roles(UserRole.ADMIN)
  async downloadOrderDetails(@Param('id') id: string, @Res() res: Response) {
    const order = await this.ordersService.getOrderById(id);
    if (!order) throw new NotFoundException('Order not found');

    const buffer = await this.pdfService.generateOrderDetails(order);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=Order_${order.orderNumber}.pdf`,
      'Content-Length': buffer.length,
    });

    res.end(buffer);
  }

  @Get('duplicate-invoice/:invoiceId')
  @Roles(UserRole.ADMIN, UserRole.PARTNER)
  async downloadDuplicateInvoice(
    @Param('invoiceId') invoiceId: string,
    @Res() res: Response,
  ) {
    const duplicate = await this.ordersService.getDuplicateInvoiceById(invoiceId);
    const order = duplicate.orderId as any;
    if (!order) throw new NotFoundException('Order not found');

    const snapshot = {
      ...(order.toObject ? order.toObject() : order),
      items: duplicate.items,
      totalAmount: duplicate.totalAmount,
      shippingFee: duplicate.shippingFee,
      discount: duplicate.discount,
      orderNumber: duplicate.invoiceNumber,
    };

    const buffer = await this.pdfService.generateOrderDetails(snapshot, {
      headerTitle: 'Invoice',
      displayOrderNumber: duplicate.invoiceNumber,
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=Invoice_${duplicate.invoiceNumber}.pdf`,
      'Content-Length': buffer.length,
    });

    res.end(buffer);
  }
}
