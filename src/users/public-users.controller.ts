import { Controller, Get } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument, UserRole } from './entities/user.entity';

@Controller('public')
export class PublicUsersController {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  @Get('map-locations')
  async getMapLocations() {
    const users = await this.userModel.find({
      latitude: { $ne: null },
      longitude: { $ne: null },
      $or: [
        // Approved Shops: Must be ACTIVE and CERTIFIED
        {
          role: UserRole.CERTIFIED_SHOP,
          status: 'active',
          isCertified: true,
        },
        // Approved Partners: Must be ACTIVE
        {
          role: { $in: [UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER, UserRole.PARTNER] },
          status: 'active',
        },
      ],


    }).select(
      'firstName lastName shopName companyName country city address latitude longitude role phoneNumber email ' +
      'facebook instagram linkedin youtube tiktok website'
    ).lean();

    return users.map((user: any) => ({
      name: user.companyName || user.shopName || `${user.firstName} ${user.lastName}`,
      country: user.country || 'Unknown',
      city: user.city || '',
      lat: user.latitude,
      lng: user.longitude,
      type: [UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER, UserRole.PARTNER].includes(user.role) ? 'Partner' : 'shop',
      role: user.role,
      address: user.address || '',
      phoneNumber: user.phoneNumber || '',
      email: user.email || '',
      socials: {
        facebook: user.facebook,
        instagram: user.instagram,
        linkedin: user.linkedin,
        youtube: user.youtube,
        tiktok: user.tiktok,
        website: user.website,
      },
    }));
  }
}
