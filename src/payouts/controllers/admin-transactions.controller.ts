import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../users/entities/user.entity';
import { AdminTransactionsService } from '../services/admin-transactions.service';

@Controller('admin/transactions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminTransactionsController {
  constructor(
    private readonly adminTransactionsService: AdminTransactionsService,
  ) {}

  @Get('summary')
  getSummary() {
    return this.adminTransactionsService.getSummary();
  }

  @Get()
  listTransactions(
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.adminTransactionsService.listTransactions({
      category,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 30,
      search,
    });
  }

  @Get('wallet-movements')
  listWalletMovements(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminTransactionsService.listWalletMovements({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 30,
    });
  }
}
