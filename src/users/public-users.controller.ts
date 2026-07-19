import { Controller, Get, Param } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument, UserRole } from './entities/user.entity';
import { formatRoleLabel } from '../common/role-labels';
import { GLOBAL_HUB_PARTNER_CODE, LEGACY_GLOBAL_HUB_PARTNER_CODE } from '../common/global-hub';
import {
  PARTNER_CODE_MAX_LENGTH,
  PARTNER_CODE_MIN_LENGTH,
  PARTNER_CODE_REGEX,
} from '../common/partner-code';

@Controller('public')
export class PublicUsersController {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  @Get('validate-network-id/:code')
  async validateNetworkId(@Param('code') code: string) {
    const partnerCode = code?.trim().toUpperCase();

    if (!partnerCode || !PARTNER_CODE_REGEX.test(partnerCode)) {
      return {
        valid: false,
        message: `Hub, Distributor, Representative, or Promoter ID must be ${PARTNER_CODE_MIN_LENGTH}-${PARTNER_CODE_MAX_LENGTH} alphanumeric characters`,
      };
    }

    const partner = await this.userModel
      .findOne({
        partnerCode,
        role: {
          $in: [
            UserRole.MASTER_PARTNER,
            UserRole.REGIONAL_PARTNER,
            // UserRole.SUB_PROMOTER, // removed
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
    const globalHubCodes = [GLOBAL_HUB_PARTNER_CODE, LEGACY_GLOBAL_HUB_PARTNER_CODE];

    const users = await this.userModel.find({
      latitude: { $ne: null },
      longitude: { $ne: null },
      $or: [
        {
          role: UserRole.CERTIFIED_SHOP,
          status: 'active',
          isCertified: true,
          isVisibleOnMap: true,
        },
        {
          role: {
            $in: [
              UserRole.MASTER_PARTNER,
              UserRole.REGIONAL_PARTNER,
              // UserRole.SUB_PROMOTER, // removed
              UserRole.DISTRIBUTOR,
            ],
          },
          status: 'active',
          isVisibleOnMap: true,
        },
        {
          role: UserRole.PARTNER,
          partnerCode: { $in: globalHubCodes },
          status: 'active',
          isVisibleOnMap: true,
        },
      ],
    }).select(
      'firstName lastName shopName companyName country city address latitude longitude role partnerCode phoneNumber email profileImage ' +
      'facebook instagram linkedin youtube tiktok website'
    ).lean();

    return users.map((user: any) => ({
      name: user.companyName || user.shopName || `${user.firstName} ${user.lastName}`,
      country: user.country || 'Unknown',
      city: user.city || '',
      lat: user.latitude,
      lng: user.longitude,
      type: user.role === UserRole.CERTIFIED_SHOP ? 'shop' : 'networkPartner',
      role: user.role,
      partnerCode: user.partnerCode,
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
