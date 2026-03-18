import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { ProductGroupsService } from './product-groups.service';
import {
  CreateProductGroupDto,
  UpdateProductGroupDto,
} from './dto/product-group.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';

@Controller('product-groups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductGroupsController {
  constructor(private readonly productGroupsService: ProductGroupsService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() createProductGroupDto: CreateProductGroupDto) {
    return this.productGroupsService.create(createProductGroupDto);
  }

  @Get()
  findAll() {
    return this.productGroupsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productGroupsService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('id') id: string,
    @Body() updateProductGroupDto: UpdateProductGroupDto,
  ) {
    return this.productGroupsService.update(id, updateProductGroupDto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.productGroupsService.remove(id);
  }
}
