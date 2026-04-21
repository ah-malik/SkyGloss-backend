import { Injectable, BadRequestException, OnModuleInit, Logger, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, UserRole, UserStatus } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import axios from 'axios';

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) { }

  async onModuleInit() {
    // One-time cleanup to remove null emails that cause duplicate key errors with sparse index
    try {
      // Sync indexes to ensure unique: true, sparse: true is correctly applied
      await this.userModel.syncIndexes();
      console.log('[UsersService] Indexes synchronized.');

      const result = await this.userModel.updateMany(
        { email: null },
        { $unset: { email: '' } },
      );
      if (result.modifiedCount > 0) {
        console.log(
          `[UsersService] Cleaned up ${result.modifiedCount} users with null emails.`,
        );
      }

      // Ensure Global Partner exists
      const globalPartnerCode = 'GLOBAL77';
      const existingGlobal = await this.userModel.findOne({ partnerCode: globalPartnerCode });
      if (!existingGlobal) {
        console.log(`[UsersService] Creating Global Partner (${globalPartnerCode})...`);
        const hashedPass = await bcrypt.hash('SkyGlossGlobal77!', 10);
        await this.userModel.create({
          firstName: 'Global',
          lastName: 'Partner',
          email: 'certified@skygloss.com',
          password: hashedPass,
          role: UserRole.MASTER_PARTNER,
          status: 'active',
          country: 'United States',
          address: 'Main Office',
          city: 'Global',
          partnerCode: globalPartnerCode,
          isSelfRegistered: false,
        });
        console.log('[UsersService] Global Partner created successfully.');
      }
    } catch (err) {
      console.error('[UsersService] Database initialization failed:', err);
    }
  }

  private async fetchCoordinates(address: string, city: string, country: string): Promise<{ latitude: number, longitude: number } | null> {
    const fetchWithQuery = async (query: string) => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
        const res = await axios.get(url, {
          headers: {
            'User-Agent': 'SkyGloss-Backend',
          },
        });
        const data = res.data;
        if (data && data[0]) {
          return {
            latitude: parseFloat(data[0].lat),
            longitude: parseFloat(data[0].lon),
          };
        }
      } catch (err) {
        console.error(`[Geocoding] Failed for query "${query}":`, err);
      }
      return null;
    };

    // Try 1: Full Address
    let coords = await fetchWithQuery(`${address}, ${city}, ${country}`);

    // Try 2: City and Country fallback (if address search fails)
    if (!coords && (city || country)) {
      coords = await fetchWithQuery(`${city}, ${country}`);
    }

    return coords;
  }

  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
    console.log(
      '[UsersService] Creating user with DTO:',
      JSON.stringify(createUserDto, null, 2),
    );
    if (createUserDto.email) {
      const existingUser = await this.userModel.findOne({
        email: createUserDto.email,
      });
      if (existingUser) {
        throw new BadRequestException('User already exists (email)');
      }
    }

    if (createUserDto.username) {
      const existingUser = await this.userModel.findOne({
        username: createUserDto.username,
      });
      if (existingUser) {
        throw new BadRequestException('User already exists (username)');
      }
    }

    const hashedPassword = createUserDto.password
      ? await bcrypt.hash(createUserDto.password, 10)
      : undefined;

    const userData: any = {
      ...createUserDto,
      password: hashedPassword,
    };

    // Validate Partner Code for partner roles
    const partnerRoles = [
      UserRole.MASTER_PARTNER,
      UserRole.REGIONAL_PARTNER,
      UserRole.PARTNER,
    ];

    if (partnerRoles.includes(userData.role)) {
      if (!userData.partnerCode) {
        throw new BadRequestException('Partner Code is required for this role');
      }

      if (!/^[a-zA-Z0-9]{4,10}$/.test(userData.partnerCode)) {
        throw new BadRequestException('Partner Code must be 4-10 alphanumeric characters');
      }

      const existingCode = await this.userModel.findOne({
        partnerCode: userData.partnerCode,
      });
      if (existingCode) {
        throw new BadRequestException('Partner Code already exists');
      }
    } else {
      // Clear partnerCode if NOT a partner role (optional but consistency is good)
      delete userData.partnerCode;
    }

    // Auto-geocode if coordinates are missing
    if (!userData.latitude || !userData.longitude) {
      if (userData.address && userData.city && userData.country) {
        const coords = await this.fetchCoordinates(userData.address, userData.city, userData.country);
        if (coords) {
          userData.latitude = coords.latitude;
          userData.longitude = coords.longitude;
          console.log(`[Geocoding] Automatically detected coordinates for ${userData.email}:`, coords);
        }
      }
    }

    // Remove email if it's null/undefined to avoid duplicate key errors with sparse index
    if (!userData.email) {
      delete userData.email;
    }

    if (userData.productGroup === '') {
      delete userData.productGroup;
    }

    const createdUser = new this.userModel(userData);
    return createdUser.save();
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find().exec();
  }

  async findOne(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email }).exec();
  }

  async findByUsernameOrEmail(
    identifier: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findOne({
        $or: [{ email: identifier }, { username: identifier }],
      })
      .exec();
  }

  async findByAccessCode(accessCode: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ accessCode }).exec();
  }

  async findByPartnerCode(partnerCode: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ partnerCode }).exec();
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    currentUser: UserDocument,
  ): Promise<UserDocument | null> {
    console.log(
      `[UsersService] Updating user ${id} by ${currentUser.email} with DTO:`,
      JSON.stringify(updateUserDto, null, 2),
    );

    // Permission check: Non-admins can only update shops they referred
    if (currentUser.role !== UserRole.ADMIN) {
      const targetUser = await this.userModel.findById(id);
      if (!targetUser) throw new BadRequestException('User not found');

      // Check if this is a shop referred by the current partner
      if (targetUser.referredByPartnerCode !== currentUser.partnerCode) {
        throw new ForbiddenException('You do not have permission to update this user');
      }

      // Optional: Restrict what fields a Partner can update
      // For now, let's just proceed since we trust the DTO validation for other roles
    }

    const updatePayload: any = { ...updateUserDto };

    // partnerCode cleanup to avoid duplicate key errors on empty strings (sparse index only allows one "")
    if (updatePayload.partnerCode) {
      updatePayload.partnerCode = updatePayload.partnerCode.toString().trim();
      if (updatePayload.partnerCode === '') delete updatePayload.partnerCode;
    } else if (updatePayload.partnerCode === '') {
      delete updatePayload.partnerCode;
    }

    // Clean up other unique fields if they are empty strings
    if (updatePayload.email === '') delete updatePayload.email;
    if (updatePayload.username === '') delete updatePayload.username;

    if (updatePayload.password) {
      updatePayload.password = await bcrypt.hash(updatePayload.password, 10);
    }
    if (updatePayload.productGroup === '') {
      updatePayload.productGroup = null;
    }

    // Explicitly sync isPartnerPaid to its DB name isDistributorPaid to ensure persistence during raw updates
    if (updatePayload.isPartnerPaid !== undefined) {
      updatePayload.isDistributorPaid = updatePayload.isPartnerPaid;
    }

    console.log(`[UsersService] Final Update Payload for ${id}:`, JSON.stringify(updatePayload, null, 2));

    // Capture location related fields to see if geocoding is needed
    const { address, city, country, latitude, longitude } = updatePayload;

    // If address changed and coordinates are NOT manually provided in this update, re-geocode
    if ((address || city || country) && (!latitude && !longitude)) {
      // Get current user data to merge with update for geocoding query
      const currentUser = await this.userModel.findById(id);
      if (currentUser) {
        const qAddress = address || currentUser.address;
        const qCity = city || currentUser.city;
        const qCountry = country || currentUser.country;

        if (qAddress && qCity && qCountry) {
          const coords = await this.fetchCoordinates(qAddress, qCity, qCountry);
          if (coords) {
            updatePayload.latitude = coords.latitude;
            updatePayload.longitude = coords.longitude;
            console.log(`[Geocoding] Updated coordinates for ${currentUser.email}:`, coords);
          }
        }
      }
    }

    const updatedUser = await this.userModel
      .findByIdAndUpdate(id, updatePayload, { new: true })
      .exec();

    // IF this was a partner role update AND productGroup was changed, sync to all their shops
    const partnerRoles = [UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER, UserRole.PARTNER];
    if (updatedUser && partnerRoles.includes(updatedUser.role) && updatePayload.productGroup !== undefined) {
      console.log(`[UsersService] Syncing productGroup ${updatePayload.productGroup} to all shops referred by ${updatedUser.partnerCode}`);
      await this.userModel.updateMany(
        { referredByPartnerCode: updatedUser.partnerCode, role: UserRole.CERTIFIED_SHOP },
        { productGroup: updatePayload.productGroup }
      ).exec();
    }

    return updatedUser;
  }

  async remove(id: string): Promise<UserDocument | null> {
    const user = await this.userModel.findById(id);
    // Role-based deletion blocks removed per user request to allow full management of all accounts
    return this.userModel.findByIdAndDelete(id).exec();
    return this.userModel.findByIdAndDelete(id).exec();
  }

  async getStats() {
    const total = await this.userModel.countDocuments();
    const admin = await this.userModel.countDocuments({ role: UserRole.ADMIN });
    const master_partner = await this.userModel.countDocuments({
      role: UserRole.MASTER_PARTNER,
    });
    const regional_partner = await this.userModel.countDocuments({
      role: UserRole.REGIONAL_PARTNER,
    });
    const partner = await this.userModel.countDocuments({
      role: UserRole.PARTNER,
    });
    const certified_shop = await this.userModel.countDocuments({
      role: UserRole.CERTIFIED_SHOP,
    });

    return {
      total,
      admin,
      master_partner,
      regional_partner,
      partner,
      certified_shop,
    };
  }

  async completeCourse(
    userId: string,
    courseName: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        { $addToSet: { completedCourses: courseName } },
        { new: true },
      )
      .exec();
  }
  async updateCourseProgress(
    userId: string,
    courseName: string,
    stepId: string,
  ): Promise<UserDocument | null> {
    const update: any = {};
    update[`courseProgress.${courseName}`] = stepId;

    return this.userModel
      .findByIdAndUpdate(userId, { $addToSet: update }, { new: true })
      .exec();
  }

  async updateCertificationVideoUrl(
    userId: string,
    videoUrl: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        { certificationVideoUrl: videoUrl },
        { new: true },
      )
      .exec();
  }

  async findReferredShops(partnerCode: string): Promise<{ shops: UserDocument[], partners: any[] }> {
    if (!partnerCode) return { shops: [], partners: [] };

    const query: any = {
      role: UserRole.CERTIFIED_SHOP,
      isPartnerPaid: true,
    };

    // If it's NOT the Global Partner, filter by their specific code
    const isGlobal = partnerCode === 'GLOBAL77';

    if (!isGlobal) {
      query.referredByPartnerCode = partnerCode;
    }

    const shops = await this.userModel.find(query).exec();

    // Include partners list if it's the Global Partner
    let partners: any[] = [];
    if (isGlobal) {
      partners = await this.findAllPartners();
    }

    return { shops, partners };
  }

  async updateShopVisibility(shopId: string, isVisibleOnMap: boolean, partnerCode: string): Promise<UserDocument | null> {
    const query: any = {
      _id: shopId,
      role: UserRole.CERTIFIED_SHOP
    };

    if (partnerCode !== 'GLOBAL77') {
      query.referredByPartnerCode = partnerCode;
    }

    const shop = await this.userModel.findOne(query);

    if (!shop) return null;

    const updatePayload: any = { isVisibleOnMap };

    // If making visible and coordinates are missing, attempt geocoding
    if (isVisibleOnMap && (!shop.latitude || !shop.longitude)) {
      if (shop.address && shop.city && shop.country) {
        const coords = await this.fetchCoordinates(shop.address, shop.city, shop.country);
        if (coords) {
          updatePayload.latitude = coords.latitude;
          updatePayload.longitude = coords.longitude;
          console.log(`[Geocoding] Success during visibility toggle for shop ${shop.email}:`, coords);
        } else {
          console.warn(`[Geocoding] Failed during visibility toggle for shop ${shop.email}. Shop may not appear on map.`);
        }
      }
    }

    return this.userModel.findByIdAndUpdate(
      shopId,
      updatePayload,
      { new: true },
    ).exec();
  }

  async findAllPartners() {
    this.logger.log('Fetching all partners for list...');
    const partners = await this.userModel.find({
      role: { $in: [UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER, UserRole.PARTNER] },
    }).select('firstName lastName partnerCode email status').sort({ firstName: 1 });
    this.logger.log(`Found ${partners.length} partners.`);
    return partners;
  }

  async assignPartner(shopId: string, partnerCode: string) {
    // 1. Verify Partner exists
    const partner = await this.userModel.findOne({
      partnerCode,
      role: { $in: [UserRole.MASTER_PARTNER, UserRole.REGIONAL_PARTNER, UserRole.PARTNER] }
    });
    if (!partner) throw new BadRequestException('Invalid Partner Code');

    // 2. Update Shop with partner's code and inherit their productGroup
    const shop = await this.userModel.findByIdAndUpdate(
      shopId,
      {
        referredByPartnerCode: partnerCode,
        productGroup: partner.productGroup || undefined
      },
      { new: true }
    );
    if (!shop) throw new BadRequestException('Shop not found');

    return shop;
  }
}

