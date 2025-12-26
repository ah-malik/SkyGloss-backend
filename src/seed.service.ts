import { Injectable, OnModuleInit } from '@nestjs/common';
import { UsersService } from './users/users.service';
import { AccessCodesService } from './access-codes/access-codes.service';
import { ProductsService } from './products/products.service';
import { UserRole, UserStatus } from './users/entities/user.entity';

@Injectable()
export class SeedService implements OnModuleInit {
  constructor(
    private readonly usersService: UsersService,
    private readonly accessCodesService: AccessCodesService,
    private readonly productsService: ProductsService,
  ) { }

  async onModuleInit() {
    console.log('[SeedService] Starting auto-seed...');
    try {
      // 0. Migrate existing product statuses
      await this.productsService.migrateStatuses();
      console.log('[SeedService] Product statuses migrated to new enum');

      // 1. Seed Admin
      const adminEmail = 'admin@example.com';
      let admin = await this.usersService.findByEmail(adminEmail);
      if (!admin) {
        admin = await this.usersService.create({
          email: adminEmail,
          password: 'adminpassword123',
          role: UserRole.ADMIN,
          firstName: 'System',
          lastName: 'Admin',
          status: UserStatus.ACTIVE,
          phoneNumber: '0000000000',
        });
        console.log('[SeedService] Admin created');
      }

      // 2. Seed Distributor
      const distEmail = 'distributor@example.com';
      let distributor = await this.usersService.findByEmail(distEmail);
      if (!distributor) {
        distributor = await this.usersService.create({
          email: distEmail,
          password: 'distpassword123',
          role: UserRole.DISTRIBUTOR,
          firstName: 'Global',
          lastName: 'Distributor',
          status: UserStatus.ACTIVE,
          phoneNumber: '1112223333',
          companyName: 'SkyGloss Distribution Co.',
        });
        console.log('[SeedService] Distributor created');
      }

      // 3. Seed Static Access Code
      const staticCode = '12345678';
      const existingCode = await (
        this.accessCodesService as any
      ).accessCodeModel.findOne({ code: staticCode });
      if (!existingCode) {
        await (this.accessCodesService as any).accessCodeModel.create({
          code: staticCode,
          targetRole: UserRole.TECHNICIAN,
          generatedBy: admin._id,
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
          isUsed: false,
        });
        console.log('[SeedService] Static test code 12345678 created');
      }

      // 4. Seed Products
      const productCount = await this.productsService.findAll();
      if (productCount.length === 0) {
        const initialProducts = [
          {
            name: 'FUSION',
            description: 'Complete dual-layer coating system combining Element base coat and Aether top coat. Professional-grade formula delivering unmatched durability, gloss enhancement, and protection.',
            category: 'protection',
            images: ['https://placehold.co/600x400?text=FUSION'],
            features: [
              'Dual-layer hybrid coating system',
              'Self-healing top layer',
              'Hydrophobic water beading',
              '24-month durability',
            ],
            specifications: [
              { label: 'System', value: 'Element (Base) + Aether (Top)' },
              { label: 'Total Cure Time', value: '10 hours' },
            ],
            applicationGuide: [
              'Step 1: Clean surface',
              'Step 2: Apply Element',
              'Step 3: Apply Aether',
            ],
            sizes: [
              { size: '100ml', price: 169.98 },
              { size: '250ml', price: 318.98 },
            ],
            status: 'published',
          },
          {
            name: 'RESIN FILM',
            description: 'Advanced resin & film coating technology providing superior protection and durability.',
            category: 'protection',
            images: ['https://placehold.co/600x400?text=RESIN+FILM'],
            features: [
              'Resin & film technology',
              'Enhanced durability',
              'Self-healing properties',
            ],
            specifications: [{ label: 'Volume', value: '60ml' }],
            applicationGuide: ['Prepare surface', 'Apply thin layer', 'Level coating'],
            sizes: [{ size: '60ml', price: 160.99 }],
            status: 'published',
          },
          {
            name: 'EDGE BLADE',
            description: 'Professional tungsten carbide blade designed for precise clear coating application and leveling.',
            category: 'tools',
            images: ['https://placehold.co/600x400?text=EDGE+BLADE'],
            features: ['Tungsten carbide construction', 'Ultra-precise edge'],
            specifications: [{ label: 'Material', value: 'Tungsten Carbide' }],
            applicationGuide: ['Hold at 45-degree angle', 'Clean frequently'],
            sizes: [{ size: '1pc', price: 39.99 }],
            status: 'published',
          },
        ];

        for (const prod of initialProducts) {
          await this.productsService.create(prod as any);
        }
        console.log('[SeedService] Initial products seeded');
      }

      console.log('[SeedService] Auto-seed completed');
    } catch (error) {
      console.error('[SeedService] Seeding error:', error.message);
    }
  }
}
