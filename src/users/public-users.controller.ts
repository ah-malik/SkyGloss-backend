import { Controller, Get, Param } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument, UserRole } from './entities/user.entity';
import { formatRoleLabel } from '../common/role-labels';

@Controller('public')
export class PublicUsersController {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  @Get('validate-network-id/:code')
  async validateNetworkId(@Param('code') code: string) {
    const partnerCode = code?.trim().toUpperCase();

    if (!partnerCode || !/^[A-Z0-9]{4,10}$/.test(partnerCode)) {
      return {
        valid: false,
        message: 'Hub, Distributor, Representative, Promoter, or Sub-Promoter ID must be 4-10 alphanumeric characters',
      };
    }

    const partner = await this.userModel
      .findOne({
        partnerCode,
        role: {
          $in: [
            UserRole.MASTER_PARTNER,
            UserRole.REGIONAL_PARTNER,
            UserRole.SUB_PROMOTER,
            UserRole.DISTRIBUTOR,
            UserRole.PARTNER,
          ],
        },
        status: 'active',
      })
      .select('partnerCode role firstName lastName')
      .lean();

    if (!partner) {
      return {
        valid: false,
        message: 'This ID was not found. Enter a valid Partner ID.',
      };
    }

    return {
      valid: true,
      partnerCode: partner.partnerCode,
      role: partner.role,
      roleLabel: formatRoleLabel(partner.role),
      name: `${partner.firstName} ${partner.lastName}`.trim(),
    };
  }

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
          isVisibleOnMap: true,
        },
        // Approved Partners: Must be ACTIVE
        {
          role: { $in: [UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER, UserRole.DISTRIBUTOR, UserRole.PARTNER] },
          status: 'active',
        },
      ],


    }).select(
      'firstName lastName shopName companyName country city address latitude longitude role phoneNumber email profileImage ' +
      'facebook instagram linkedin youtube tiktok website'
    ).lean();

    return users.map((user: any) => ({
      name: user.companyName || user.shopName || `${user.firstName} ${user.lastName}`,
      country: user.country || 'Unknown',
      city: user.city || '',
      lat: user.latitude,
      lng: user.longitude,
      type: [UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER, UserRole.DISTRIBUTOR, UserRole.PARTNER].includes(user.role) ? 'Partner' : 'shop',
      role: user.role,
      address: user.address || '',
      phoneNumber: user.phoneNumber || '',
      email: user.email || '',
      profileImage: user.profileImage || null,
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
