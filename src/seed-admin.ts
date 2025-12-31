import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { UsersService } from './users/users.service';
import { UserRole } from './users/entities/user.entity';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const usersService = app.get(UsersService);

    const adminEmail = 'admin@skygloss.com';
    const adminPassword = 'admin123';

    const existingAdmin = await usersService.findByEmail(adminEmail);
    if (!existingAdmin) {
        await usersService.create({
            email: adminEmail,
            password: adminPassword,
            firstName: 'System',
            lastName: 'Admin',
            role: UserRole.ADMIN,
            status: 'active',
        } as any);
        console.log(`Admin user created: ${adminEmail} / ${adminPassword}`);
    } else {
        console.log(`Admin user already exists: ${adminEmail}`);
    }

    await app.close();
}

bootstrap();
