import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    Query,
    UseGuards,
    UseInterceptors,
    UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { User, UserRole } from '../users/entities/user.entity';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { GetUser } from '../common/decorators/get-user.decorator';

@Controller('products')
export class ProductsController {
    constructor(
        private readonly productsService: ProductsService,
        private readonly cloudinaryService: CloudinaryService,
    ) { }

    @Post('upload')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @UseInterceptors(FilesInterceptor('images'))
    async uploadImages(@UploadedFiles() files: Express.Multer.File[]) {
        try {
            console.log(`[ProductsController] Uploading ${files?.length || 0} files...`);
            const urls = await this.cloudinaryService.uploadImages(files);
            return { urls };
        } catch (error) {
            console.error('[ProductsController] Image upload failed:', error);
            throw error;
        }
    }

    @Post()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    create(@Body() createProductDto: CreateProductDto) {
        return this.productsService.create(createProductDto);
    }

    @Get()
    @UseGuards(OptionalJwtAuthGuard)
    findAll(
        @Query('status') status?: string,
        @Query('targetAudience') targetAudience?: string,
        @GetUser() user?: User,
    ) {
        return this.productsService.findAll(status, targetAudience, user);
    }

    @Get(':id')
    @UseGuards(OptionalJwtAuthGuard)
    findOne(
        @Param('id') id: string,
        @GetUser() user?: User,
    ) {
        return this.productsService.findOne(id, user);
    }

    @Patch(':id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    update(@Param('id') id: string, @Body() updateProductDto: UpdateProductDto) {
        return this.productsService.update(id, updateProductDto);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    remove(@Param('id') id: string) {
        return this.productsService.remove(id);
    }
}
