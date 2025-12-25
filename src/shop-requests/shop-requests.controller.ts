import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Request,
} from '@nestjs/common';
import { ShopRequestsService } from './shop-requests.service';
import { CreateShopRequestDto } from './dto/create-shop-request.dto';
import { RejectShopRequestDto } from './dto/reject-shop-request.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@Controller('shop-requests')
export class ShopRequestsController {
  constructor(private readonly shopRequestsService: ShopRequestsService) {}

  @Post()
  create(@Body() createShopRequestDto: CreateShopRequestDto) {
    return this.shopRequestsService.create(createShopRequestDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.shopRequestsService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  findOne(@Param('id') id: string) {
    return this.shopRequestsService.findOne(id);
  }

  @Post(':id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  approve(@Param('id') id: string, @Request() req) {
    return this.shopRequestsService.approve(id, req.user.sub);
  }

  @Post(':id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  reject(@Param('id') id: string) {
    return this.shopRequestsService.reject(id);
  }
}
