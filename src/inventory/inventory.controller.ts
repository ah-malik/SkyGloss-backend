import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { AdjustInventoryDto, UpdateInventoryDto } from './dto/update-inventory.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { GetUser } from '../common/decorators/get-user.decorator';
import { UserRole } from '../users/entities/user.entity';

const INVENTORY_ROLES = [UserRole.PARTNER, UserRole.DISTRIBUTOR] as const;

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('me')
  @Roles(...INVENTORY_ROLES)
  getMine(@GetUser('_id') userId: string) {
    return this.inventoryService.getMine(String(userId));
  }

  @Patch('me')
  @Roles(...INVENTORY_ROLES)
  updateMine(@GetUser('_id') userId: string, @Body() dto: UpdateInventoryDto) {
    return this.inventoryService.updateMine(String(userId), dto);
  }

  @Patch('me/adjust')
  @Roles(...INVENTORY_ROLES)
  adjustMine(@GetUser('_id') userId: string, @Body() dto: AdjustInventoryDto) {
    return this.inventoryService.adjustMine(String(userId), dto);
  }
}
