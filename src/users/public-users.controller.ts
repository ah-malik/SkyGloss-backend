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
        // Active & certified shops OR shops manually marked as visible
        {
          role: UserRole.CERTIFIED_SHOP,
          status: 'active',
          $or: [
            { isCertified: true },
            { isVisibleOnMap: true },
          ],
        },
        // Active Partners
        {
          role: { $in: [UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER, UserRole.PARTNER] },
          status: 'active',
        },
      ],

    }).select(
      'firstName lastName shopName companyName country city address latitude longitude role ' +
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
