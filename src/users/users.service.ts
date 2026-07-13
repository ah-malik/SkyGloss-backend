import { Injectable, BadRequestException, OnModuleInit, Logger, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument, UserRole, UserStatus } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import axios from 'axios';
import { ProductGroup, ProductGroupDocument } from '../product-groups/entities/product-group.entity';
import { getNetworkIdLabel, HUB_ID_LABEL } from '../common/role-labels';
import {
  normalizePartnerCode,
  validatePartnerCode,
} from '../common/partner-code';
import {
  canTraverseNetwork,
  canCertifyShops,
  getParentLinkLabel,
  requiresParentLink,
  validateParentRole,
} from '../common/user-hierarchy';
import {
  isCommissionEligibleRole,
  resolveShopCommissionChain,
  resolveShopEarningAssignments,
} from '../common/commission-distribution';
import {
  GLOBAL_HUB_PARTNER_CODE,
  isGlobalHubAccount,
  isGlobalHubPartnerCode,
} from '../common/global-hub';

export interface NetworkUsersResult {
  shops: UserDocument[];
  promoters: UserDocument[];
  subPromoters: UserDocument[];
  representatives: UserDocument[];
  /** @deprecated use representatives */
  represented: UserDocument[];
  distributors: UserDocument[];
  partners: UserDocument[];
  viewerRole: string;
}

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(ProductGroup.name) private productGroupModel: Model<ProductGroupDocument>,
  ) { }

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

      // Ensure Global Hub partner exists for unassigned shop registrations
      const existingGlobalHub = await this.userModel.findOne({
        partnerCode: GLOBAL_HUB_PARTNER_CODE,
      });
      if (!existingGlobalHub) {
        console.log(`[UsersService] Creating Global Hub (${GLOBAL_HUB_PARTNER_CODE})...`);
        const hashedPass = await bcrypt.hash('123456', 10);
        await this.userModel.create({
          firstName: 'GLOBALHUB',
          lastName: 'Hub',
          email: 'globalhub@skygloss.com',
          password: hashedPass,
          role: UserRole.PARTNER,
          status: 'active',
          country: 'United States',
          address: 'Main Office',
          city: 'Global',
          partnerCode: GLOBAL_HUB_PARTNER_CODE,
          isSelfRegistered: false,
        });
        console.log('[UsersService] Global Hub partner created successfully.');
      }

      const backfillResult = await this.userModel.updateMany(
        {
          role: UserRole.CERTIFIED_SHOP,
          $or: [
            { referredByPartnerCode: { $exists: false } },
            { referredByPartnerCode: null },
            { referredByPartnerCode: '' },
          ],
        },
        { $set: { referredByPartnerCode: GLOBAL_HUB_PARTNER_CODE } },
      );
      if (backfillResult.modifiedCount > 0) {
        console.log(
          `[UsersService] Assigned ${backfillResult.modifiedCount} shops without a parent link to ${GLOBAL_HUB_PARTNER_CODE}.`,
        );
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
      role: createUserDto.role,
    };

    if (userData.role === UserRole.PARTNER) {
      delete userData.referredByPartnerCode;
    } else {
      if (requiresParentLink(userData.role) && !userData.referredByPartnerCode?.trim()) {
        userData.referredByPartnerCode = GLOBAL_HUB_PARTNER_CODE;
      }
      await this.validateHierarchyLink(
        userData.role,
        userData.referredByPartnerCode,
      );
    }

    // Validate partner network code for network role users
    const partnerRoles = [
      UserRole.MASTER_PARTNER,
      UserRole.REGIONAL_PARTNER,
      UserRole.SUB_PROMOTER,
      UserRole.DISTRIBUTOR,
      UserRole.PARTNER,
    ];

    if (partnerRoles.includes(userData.role)) {
      // Auto-activate partners created by Admin
      userData.status = UserStatus.ACTIVE;

      const codeError = validatePartnerCode(userData.partnerCode, userData.role);
      if (codeError) {
        throw new BadRequestException(codeError);
      }

      userData.partnerCode = normalizePartnerCode(userData.partnerCode);

      const existingCode = await this.userModel.findOne({
        partnerCode: userData.partnerCode,
      });
      if (existingCode) {
        throw new BadRequestException(
          `${getNetworkIdLabel(userData.role)} already exists — choose a unique ID`,
        );
      }
    } else {
      // Clear partnerCode if NOT a partner role (optional but consistency is good)
      delete userData.partnerCode;
    }

    this.normalizeCustomCommissionRate(userData.role, userData);

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

    if (!userData.productGroup || userData.productGroup === '') {
      const defaultGroup = await this.productGroupModel.findOne({ isDefault: true }).exec();
      if (defaultGroup) {
        userData.productGroup = defaultGroup._id;
        console.log(`[UsersService] Assigned default product group ${defaultGroup.name} to new user.`);
      } else {
        delete userData.productGroup;
      }
    }

    const createdUser = new this.userModel(userData);
    const savedUser = await createdUser.save();

    if (savedUser.role === UserRole.CERTIFIED_SHOP) {
      await this.assignShopEarningRepresentatives(savedUser);
    }

    if (savedUser.role === UserRole.MASTER_PARTNER) {
      return this.assignRepresentativePartnerDevelopment(savedUser);
    }

    return savedUser;
  }

  /** Assign Shop Introduction / Partner Development / Operational Support reps (one-time, immutable per earning type). */
  async assignShopEarningRepresentatives(
    shop: UserDocument,
  ): Promise<UserDocument> {
    if (shop.role !== UserRole.CERTIFIED_SHOP) return shop;

    const assignments = await resolveShopEarningAssignments(
      shop,
      (code) => this.findByPartnerCode(code),
      (shopIntroCode) =>
        this.userModel
          .findOne({
            role: UserRole.MASTER_PARTNER,
            operationalRepresentativeCodes: normalizePartnerCode(shopIntroCode),
          })
          .exec(),
    );

    const updatePayload: Record<string, unknown> = {};

    if (
      !shop.shopIntroductionRepresentativeCode &&
      assignments.shopIntroductionRepresentativeCode
    ) {
      updatePayload.shopIntroductionRepresentativeId =
        assignments.shopIntroductionRepresentativeId;
      updatePayload.shopIntroductionRepresentativeCode =
        assignments.shopIntroductionRepresentativeCode;
    }

    if (
      !shop.partnerDevelopmentRepresentativeCode &&
      assignments.partnerDevelopmentRepresentativeCode
    ) {
      updatePayload.partnerDevelopmentRepresentativeId =
        assignments.partnerDevelopmentRepresentativeId;
      updatePayload.partnerDevelopmentRepresentativeCode =
        assignments.partnerDevelopmentRepresentativeCode;
    }

    if (
      !shop.operationalSupportRepresentativeCode &&
      assignments.operationalSupportRepresentativeCode
    ) {
      updatePayload.operationalSupportRepresentativeId =
        assignments.operationalSupportRepresentativeId;
      updatePayload.operationalSupportRepresentativeCode =
        assignments.operationalSupportRepresentativeCode;
    }

    if (!Object.keys(updatePayload).length) {
      return shop;
    }

    const updated = await this.userModel
      .findByIdAndUpdate(shop._id, updatePayload, { new: true })
      .exec();

    return updated || shop;
  }

  /** Lazily backfill a shop's Partner Development Representative if missing. */
  async ensureShopPartnerDevelopmentAssignment(
    shop: UserDocument,
  ): Promise<UserDocument> {
    if (shop.role !== UserRole.CERTIFIED_SHOP) return shop;
    if (shop.partnerDevelopmentRepresentativeCode) return shop;

    return this.assignShopEarningRepresentatives(shop);
  }

  /** When Rep 1 invites/adds Rep 2, Rep 1 becomes Rep 2's Partner Development Representative. */
  async assignRepresentativePartnerDevelopment(
    rep: UserDocument,
  ): Promise<UserDocument> {
    if (rep.role !== UserRole.MASTER_PARTNER) return rep;
    if (rep.partnerDevelopmentRepresentativeCode) return rep;

    const parentCode = normalizePartnerCode(rep.referredByPartnerCode);
    if (!parentCode) return rep;

    const parent = await this.findByPartnerCode(parentCode);
    if (!parent || parent.role !== UserRole.MASTER_PARTNER) return rep;

    const updated = await this.userModel
      .findByIdAndUpdate(
        rep._id,
        {
          partnerDevelopmentRepresentativeCode: normalizePartnerCode(
            parent.partnerCode,
          ),
        },
        { new: true },
      )
      .exec();

    return updated || rep;
  }

  /** Backfill Partner Development / Shop Introduction assignments on shops under a linked Representative. */
  async backfillShopEarningAssignmentsForRepresentative(
    representative: UserDocument,
  ): Promise<void> {
    if (representative.role !== UserRole.MASTER_PARTNER) return;

    const network = await this.findNetworkUsersForViewer(representative);
    const parentPdCode = normalizePartnerCode(
      representative.partnerDevelopmentRepresentativeCode,
    );

    for (const shop of network.shops) {
      let fullShop = await this.findOne(shop._id.toString());
      if (!fullShop) continue;

      fullShop = await this.assignShopEarningRepresentatives(fullShop);

      // Ensure each shop under Rep2 inherits Rep1 as Partner Development parent
      // so EVERY shop's first order pays 5% to Rep1 + 5% to Rep2.
      if (parentPdCode && !fullShop.partnerDevelopmentRepresentativeCode) {
        await this.userModel.findByIdAndUpdate(fullShop._id, {
          partnerDevelopmentRepresentativeCode: parentPdCode,
        });
      }
    }
  }

  async markPartnerDevelopmentCommissionPaid(shopId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(shopId, {
      partnerDevelopmentCommissionPaid: true,
    });
  }

  /**
   * Shops whose Partner Development commission is still owed to `parentCode`
   * (i.e. `partnerDevelopmentRepresentativeCode` matches and the shop-level
   * `partnerDevelopmentCommissionPaid` flag is not yet true). Partner
   * Development is paid once per SHOP's first successful order, not once
   * per child Representative.
   */
  async findShopsPendingPartnerDevelopment(
    parentCode: string,
  ): Promise<UserDocument[]> {
    const code = normalizePartnerCode(parentCode);
    if (!code) return [];
    return this.userModel
      .find({
        role: UserRole.CERTIFIED_SHOP,
        partnerDevelopmentRepresentativeCode: code,
        partnerDevelopmentCommissionPaid: { $ne: true },
      })
      .exec();
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find().populate('productGroup').populate('blockedBy', 'firstName lastName role').exec();
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

  /** Resolve the shop's assigned Representative (local point of contact). */
  async getLocalRepresentativeForShop(user: UserDocument) {
    if (user.role !== UserRole.CERTIFIED_SHOP) {
      return null;
    }

    const lookup = async (partnerCode: string) => {
      const match = await this.findByPartnerCode(partnerCode?.trim());
      if (!match) return null;
      return {
        _id: match._id,
        partnerCode: match.partnerCode,
        role: match.role,
        referredByPartnerCode: match.referredByPartnerCode,
        customCommissionRate: match.customCommissionRate,
      };
    };

    const chain = await resolveShopCommissionChain(
      { referredByPartnerCode: user.referredByPartnerCode },
      lookup,
    );

    const repCode = chain.represented?.partnerCode;
    if (!repCode) return null;

    const rep = await this.findByPartnerCode(repCode);
    if (!rep) return null;

    const fullName = [rep.firstName, rep.lastName].filter(Boolean).join(' ').trim();

    return {
      firstName: rep.firstName,
      lastName: rep.lastName,
      fullName: fullName || rep.partnerCode,
      email: rep.email || null,
      phoneNumber: rep.phoneNumber || null,
      partnerCode: rep.partnerCode,
      profileImage: rep.profileImage || null,
    };
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

    // Permission check: Non-admins can only update themselves or shops they referred
    if (currentUser.role !== UserRole.ADMIN) {
      const targetUser = await this.userModel.findById(id);
      if (!targetUser) throw new BadRequestException('User not found');

      // Allow self-update (e.g., training-complete)
      const isSelfUpdate = currentUser._id.toString() === targetUser._id.toString();

      const isGlobalPartner = isGlobalHubPartnerCode(currentUser.partnerCode);
      const inNetwork = await this.isUserInViewerNetwork(
        currentUser,
        targetUser._id.toString(),
      );

      if (!isSelfUpdate && !isGlobalPartner && !inNetwork) {
        throw new ForbiddenException('You do not have permission to update this user');
      }

      if (
        updateUserDto.isCertified === true &&
        !canCertifyShops(currentUser.role, currentUser.partnerCode)
      ) {
        throw new ForbiddenException(
          'You do not have permission to certify this shop.',
        );
      }

      // Optional: Restrict what fields a Partner can update
      // For now, let's just proceed since we trust the DTO validation for other roles
    }

    const updatePayload: any = { ...updateUserDto };
    const targetUserForHierarchy = await this.userModel.findById(id);
    if (!targetUserForHierarchy) {
      throw new BadRequestException('User not found');
    }

    // Handle Blocking/Unblocking Logic and Overrides
    if (updatePayload.status) {
      if (updatePayload.status === UserStatus.BLOCKED) {
        updatePayload.blockedBy = currentUser._id;
        // Always hide from map when blocked
        updatePayload.isVisibleOnMap = false;
      } else if (updatePayload.status === UserStatus.ACTIVE) {
        const targetUser = await this.userModel.findById(id);
        if (targetUser && targetUser.status === UserStatus.BLOCKED) {
           // If Admin is unblocking, it overrides anything
           if (currentUser.role === UserRole.ADMIN) {
             updatePayload.blockedBy = null;
             updatePayload.blockedReason = 'Unblocked by Admin';
           } else {
             // If Partner is unblocking, check if they were the one who blocked it
             // Actually, the request says Partner should be able to block/unblock their own shops
             // but Admin can override. 
             // If Admin blocked it, maybe Partner shouldn't be able to unblock?
             if (targetUser.blockedBy && targetUser.blockedBy.toString() !== currentUser._id.toString()) {
                const blocker = await this.userModel.findById(targetUser.blockedBy);
                if (blocker && (blocker.role as any) === UserRole.ADMIN && (currentUser.role as any) !== UserRole.ADMIN) {
                  throw new ForbiddenException('This user was blocked by an Admin and cannot be unblocked by a Partner.');
                }
             }
             updatePayload.blockedBy = null;
           }
        }
      }
    }

    const partnerRoles = [
      UserRole.MASTER_PARTNER,
      UserRole.REGIONAL_PARTNER,
      UserRole.SUB_PROMOTER,
      UserRole.DISTRIBUTOR,
      UserRole.PARTNER,
    ];

    // partnerCode cleanup to avoid duplicate key errors on empty strings (sparse index only allows one "")
    if (updatePayload.partnerCode) {
      updatePayload.partnerCode = updatePayload.partnerCode.toString().trim();
      if (updatePayload.partnerCode === '') delete updatePayload.partnerCode;
    } else if (updatePayload.partnerCode === '') {
      delete updatePayload.partnerCode;
    }

    const roleAfterUpdate =
      (updatePayload.role ?? targetUserForHierarchy.role) as UserRole;

    if (
      updatePayload.partnerCode !== undefined &&
      partnerRoles.includes(roleAfterUpdate)
    ) {
      const codeError = validatePartnerCode(
        updatePayload.partnerCode,
        roleAfterUpdate,
      );
      if (codeError) {
        throw new BadRequestException(codeError);
      }

      updatePayload.partnerCode = normalizePartnerCode(updatePayload.partnerCode);

      const duplicateCode = await this.userModel.findOne({
        partnerCode: updatePayload.partnerCode,
        _id: { $ne: id },
      });
      if (duplicateCode) {
        throw new BadRequestException(
          `${getNetworkIdLabel(roleAfterUpdate)} already exists — choose a unique ID`,
        );
      }
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
    if (updatePayload.referredByPartnerCode === '') {
      updatePayload.referredByPartnerCode = null;
    }

    if (updatePayload.customCommissionRate !== undefined) {
      if (currentUser.role !== UserRole.ADMIN) {
        delete updatePayload.customCommissionRate;
      } else {
        this.normalizeCustomCommissionRate(roleAfterUpdate, updatePayload);
      }
    }

    const hierarchyFieldsTouched =
      updatePayload.role !== undefined ||
      updatePayload.referredByPartnerCode !== undefined;

    if (hierarchyFieldsTouched) {
      const finalRole = (updatePayload.role ?? targetUserForHierarchy.role) as UserRole;
      const finalReferral =
        updatePayload.referredByPartnerCode !== undefined
          ? updatePayload.referredByPartnerCode
          : targetUserForHierarchy.referredByPartnerCode;

      if (finalRole === UserRole.PARTNER) {
        updatePayload.referredByPartnerCode = null;
      } else if (requiresParentLink(finalRole)) {
        await this.validateHierarchyLink(finalRole, finalReferral, id);
      }
    }

    // Auto-enable map visibility when a shop is certified
    if (updatePayload.isCertified === true) {
      updatePayload.isVisibleOnMap = true;
      
      // Assign certificate number if not already present
      const targetUser = await this.userModel.findById(id);
      if (targetUser && !targetUser.certificateNumber) {
        updatePayload.certificateNumber = await this.getNextCertificateNumber();
      }
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



    return updatedUser;
  }

  async remove(id: string): Promise<UserDocument | null> {
    const user = await this.userModel.findById(id);
    // Role-based deletion blocks removed per user request to allow full management of all accounts
    return this.userModel.findByIdAndDelete(id).exec();
    return this.userModel.findByIdAndDelete(id).exec();
  }

  async migratePartnerRolesToRepresented(): Promise<{
    partner: number;
    regional: number;
  }> {
    const hubResult = await this.userModel.updateMany(
      { role: UserRole.PARTNER },
      { $set: { role: UserRole.MASTER_PARTNER } },
    );
    const promoterResult = await this.userModel.updateMany(
      { role: UserRole.REGIONAL_PARTNER },
      { $set: { role: UserRole.MASTER_PARTNER } },
    );
    return {
      partner: hubResult.modifiedCount,
      regional: promoterResult.modifiedCount,
    };
  }

  async getStats() {
    const total = await this.userModel.countDocuments();
    const admin = await this.userModel.countDocuments({ role: UserRole.ADMIN });
    const master_partner = await this.userModel.countDocuments({
      role: UserRole.MASTER_PARTNER,
    });
    const distributor = await this.userModel.countDocuments({
      role: UserRole.DISTRIBUTOR,
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
    const sub_promoter = await this.userModel.countDocuments({
      role: UserRole.SUB_PROMOTER,
    });

    const recentUsers = await this.userModel
      .find({ role: { $ne: UserRole.ADMIN } })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('firstName lastName email role partnerCode shopName createdAt')
      .lean();

    return {
      total,
      admin,
      master_partner,
      distributor,
      regional_partner,
      partner,
      certified_shop,
      sub_promoter,
      recentUsers,
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

  async updateProfileImage(
    userId: string,
    imageUrl: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(userId, { profileImage: imageUrl }, { new: true })
      .exec();
  }

  /**
   * Returns users visible to the viewer based on hierarchy:
   * Hub → Distributor, Representative, Promoter, Shop (full subtree)
   * Distributor → Representative, Promoter, Shop (subtree)
   * Representative → Promoter, Shop (subtree)
   * Promoter → Shop (direct only)
   */
  async findSubPromoterByMain(mainPartnerCode: string): Promise<UserDocument | null> {
    const code = mainPartnerCode?.trim();
    if (!code) return null;
    return this.userModel
      .findOne({
        role: UserRole.SUB_PROMOTER,
        referredByPartnerCode: code,
      })
      .exec();
  }

  async findNetworkUsersForViewer(
    viewer: UserDocument,
  ): Promise<NetworkUsersResult> {
    const empty: NetworkUsersResult = {
      shops: [],
      promoters: [],
      subPromoters: [],
      representatives: [],
      represented: [],
      distributors: [],
      partners: [],
      viewerRole: viewer.role,
    };

    const partnerCode = viewer.partnerCode;
    if (!partnerCode) return empty;

    const isGlobal = isGlobalHubPartnerCode(partnerCode);

    if (isGlobal) {
      const shops = await this.userModel
        .find({ role: UserRole.CERTIFIED_SHOP })
        .exec();
      const partners = await this.findAllPartners();
      const distributors = partners.filter((p) => p.role === UserRole.DISTRIBUTOR);
      const representatives = partners.filter(
        (p) => p.role === UserRole.MASTER_PARTNER,
      );
      const promoters = partners.filter(
        (p) => p.role === UserRole.REGIONAL_PARTNER,
      );
      const subPromoters = partners.filter(
        (p) => p.role === UserRole.SUB_PROMOTER,
      );
      return {
        shops,
        distributors,
        representatives,
        represented: representatives,
        promoters,
        subPromoters,
        partners,
        viewerRole: viewer.role,
      };
    }

    if (viewer.role === UserRole.SUB_PROMOTER) {
      const shops = await this.userModel
        .find({
          role: UserRole.CERTIFIED_SHOP,
          referredByPartnerCode: partnerCode,
        })
        .exec();
      return { ...empty, shops };
    }

    if (viewer.role === UserRole.REGIONAL_PARTNER) {
      const subPromoters = await this.userModel
        .find({
          role: UserRole.SUB_PROMOTER,
          referredByPartnerCode: partnerCode,
        })
        .exec();
      const subCodes = subPromoters
        .map((u) => u.partnerCode)
        .filter(Boolean) as string[];
      const shopCodes = [partnerCode, ...subCodes];
      const shops = await this.userModel
        .find({
          role: UserRole.CERTIFIED_SHOP,
          referredByPartnerCode: { $in: shopCodes },
        })
        .exec();

      const collected: UserDocument[] = [];
      const seenIds = new Set<string>();
      const freshViewer = await this.userModel
        .findById(viewer._id)
        .select('operationalPromoterCodes partnerCode')
        .lean();
      const operationalPromoterCodes = (freshViewer?.operationalPromoterCodes || [])
        .map((code) => normalizePartnerCode(code))
        .filter(
          (code) => code && code !== normalizePartnerCode(partnerCode),
        );

      const linkedPromoters: UserDocument[] = [];
      for (const operationalCode of operationalPromoterCodes) {
        const linkedPromoter = await this.findByPartnerCode(operationalCode);
        if (
          linkedPromoter?.role === UserRole.REGIONAL_PARTNER &&
          !seenIds.has(linkedPromoter._id.toString())
        ) {
          seenIds.add(linkedPromoter._id.toString());
          linkedPromoters.push(linkedPromoter);
          collected.push(linkedPromoter);
        }
        await this.collectNetworkDescendants(
          [operationalCode],
          collected,
          seenIds,
        );
      }

      const linkedSubPromoters = collected.filter(
        (u) => u.role === UserRole.SUB_PROMOTER,
      );
      const linkedShops = collected.filter(
        (u) => u.role === UserRole.CERTIFIED_SHOP,
      );
      const linkedPromoterMembers = collected.filter(
        (u) => u.role === UserRole.REGIONAL_PARTNER,
      );

      const shopIds = new Set(shops.map((s) => s._id.toString()));
      const mergedShops = [
        ...shops,
        ...linkedShops.filter((s) => !shopIds.has(s._id.toString())),
      ];
      const subIds = new Set(subPromoters.map((s) => s._id.toString()));
      const mergedSubPromoters = [
        ...subPromoters,
        ...linkedSubPromoters.filter((s) => !subIds.has(s._id.toString())),
      ];

      const uniqueLinkedPromoters = [...linkedPromoters];
      for (const promoter of linkedPromoterMembers) {
        if (!uniqueLinkedPromoters.some((p) => p._id.toString() === promoter._id.toString())) {
          uniqueLinkedPromoters.push(promoter);
        }
      }

      return {
        ...empty,
        shops: mergedShops,
        subPromoters: mergedSubPromoters,
        promoters: uniqueLinkedPromoters,
        partners: [...uniqueLinkedPromoters, ...mergedSubPromoters],
      };
    }

    const collected: UserDocument[] = [];
    const seenIds = new Set<string>();
    await this.collectNetworkDescendants([partnerCode], collected, seenIds);

    if (viewer.role === UserRole.MASTER_PARTNER) {
      const freshViewer = await this.userModel
        .findById(viewer._id)
        .select('operationalRepresentativeCodes partnerCode')
        .lean();
      const operationalCodes = (freshViewer?.operationalRepresentativeCodes || [])
        .map((code) => normalizePartnerCode(code))
        .filter(
          (code) => code && code !== normalizePartnerCode(partnerCode),
        );

      for (const operationalCode of operationalCodes) {
        const linkedRep = await this.findByPartnerCode(operationalCode);
        if (
          linkedRep?.role === UserRole.MASTER_PARTNER &&
          !seenIds.has(linkedRep._id.toString())
        ) {
          seenIds.add(linkedRep._id.toString());
          collected.push(linkedRep);
        }
        await this.collectNetworkDescendants(
          [operationalCode],
          collected,
          seenIds,
        );
      }
    }

    const distributors = collected.filter((u) => u.role === UserRole.DISTRIBUTOR);
    const representatives = collected.filter(
      (u) => u.role === UserRole.MASTER_PARTNER,
    );
    const promoters = collected.filter((u) => u.role === UserRole.REGIONAL_PARTNER);
    const subPromoters = collected.filter((u) => u.role === UserRole.SUB_PROMOTER);
    const shops = collected.filter((u) => u.role === UserRole.CERTIFIED_SHOP);

    if (viewer.role === UserRole.PARTNER) {
      return {
        shops,
        promoters,
        subPromoters,
        distributors,
        representatives,
        represented: representatives,
        partners: [...distributors, ...representatives, ...promoters, ...subPromoters],
        viewerRole: viewer.role,
      };
    }

    if (viewer.role === UserRole.DISTRIBUTOR) {
      return {
        shops,
        promoters,
        subPromoters,
        distributors: [],
        representatives,
        represented: representatives,
        partners: [...representatives, ...promoters, ...subPromoters],
        viewerRole: viewer.role,
      };
    }

    if (viewer.role === UserRole.MASTER_PARTNER) {
      return {
        shops,
        promoters,
        subPromoters,
        distributors: [],
        representatives,
        represented: representatives,
        partners: [...representatives, ...promoters, ...subPromoters],
        viewerRole: viewer.role,
      };
    }

    return empty;
  }

  async isUserInViewerNetwork(
    viewer: UserDocument,
    targetUserId: string,
  ): Promise<boolean> {
    if (viewer._id.toString() === targetUserId) return true;
    if (isGlobalHubPartnerCode(viewer.partnerCode)) return true;

    const network = await this.findNetworkUsersForViewer(viewer);
    const all = [
      ...network.shops,
      ...network.promoters,
      ...network.subPromoters,
      ...network.representatives,
      ...network.represented,
      ...network.distributors,
    ];
    return all.some((u) => u._id.toString() === targetUserId);
  }

  /** @deprecated Use findNetworkUsersForViewer */
  async findReferredShops(partnerCode: string): Promise<{
    shops: UserDocument[];
    partners: any[];
  }> {
    const viewer = await this.findByPartnerCode(partnerCode);
    if (!viewer) return { shops: [], partners: [] };
    const network = await this.findNetworkUsersForViewer(viewer);
    return { shops: network.shops, partners: network.partners };
  }

  async updateShopVisibility(
    memberId: string,
    isVisibleOnMap: boolean,
    viewer: UserDocument,
  ): Promise<UserDocument | null> {
    const member = await this.userModel.findById(memberId);
    if (!member) return null;

    const isSelf = viewer._id.toString() === memberId;
    const isGlobalHubTarget = isGlobalHubPartnerCode(member.partnerCode);

    if (member.role === UserRole.PARTNER && !isGlobalHubTarget) {
      throw new BadRequestException('Hub accounts cannot be shown on the map.');
    }

    if (isGlobalHubTarget) {
      if (!isGlobalHubAccount(viewer)) {
        throw new ForbiddenException('Only the Global Hub account can update its map visibility.');
      }
    } else {
      const inNetwork = await this.isUserInViewerNetwork(viewer, memberId);
      if (!inNetwork && !isSelf) return null;
    }

    const updatePayload: any = { isVisibleOnMap };

    if (isVisibleOnMap && (!member.latitude || !member.longitude)) {
      if (member.address && member.city && member.country) {
        const coords = await this.fetchCoordinates(member.address, member.city, member.country);
        if (coords) {
          updatePayload.latitude = coords.latitude;
          updatePayload.longitude = coords.longitude;
        }
      }
    }

    return this.userModel.findByIdAndUpdate(
      memberId,
      updatePayload,
      { new: true },
    ).exec();
  }

  async findAllPartners() {
    this.logger.log('Fetching all partners for list...');
    const partners = await this.userModel.find({
      role: {
        $in: [
          UserRole.MASTER_PARTNER,
          UserRole.REGIONAL_PARTNER,
          UserRole.DISTRIBUTOR,
          UserRole.PARTNER,
        ],
      },
    }).select('firstName lastName partnerCode email status role isVisibleOnMap city country').sort({ firstName: 1 });
    this.logger.log(`Found ${partners.length} partners.`);
    return partners;
  }

  async getPartnerContactForShop(user: UserDocument | null | undefined) {
    if (!user?.referredByPartnerCode || user.role !== UserRole.CERTIFIED_SHOP) {
      return null;
    }
    if (isGlobalHubPartnerCode(user.referredByPartnerCode)) {
      return null;
    }
    const partner = await this.findByPartnerCode(user.referredByPartnerCode);
    if (!partner) return null;
    return {
      partnerCode: partner.partnerCode,
      email: partner.email,
      firstName: partner.firstName,
      lastName: partner.lastName,
    };
  }

  /**
   * Validates representative network linking:
   * - no self-assignment
   * - no circular parent/child relationships
   * - one parent only
   */
  private async assertRepresentativeNetworkLinkAllowed(
    target: UserDocument,
    owner: UserDocument,
  ): Promise<void> {
    const targetCode = normalizePartnerCode(target.partnerCode);
    const ownerCode = normalizePartnerCode(owner.partnerCode);
    if (!targetCode || !ownerCode) {
      throw new BadRequestException('Partner ID is required to link Representatives.');
    }

    if (
      target._id.toString() === owner._id.toString() ||
      targetCode === ownerCode
    ) {
      throw new BadRequestException(
        'A Representative cannot add themselves to their own network.',
      );
    }

    await this.assertRepresentativeHasSingleParent(target, owner);
    await this.assertNoCircularRepresentativeLink(target, owner);
  }

  /**
   * A Representative may only sit under one parent Representative network.
   * Checks both operational links and an existing Partner Development parent.
   */
  private async assertRepresentativeHasSingleParent(
    target: UserDocument,
    owner: UserDocument,
  ): Promise<void> {
    const targetCode = normalizePartnerCode(target.partnerCode);
    const ownerCode = normalizePartnerCode(owner.partnerCode);
    if (!targetCode || !ownerCode) {
      throw new BadRequestException('Partner ID is required to link Representatives.');
    }

    const operationalParents = await this.userModel
      .find({
        role: UserRole.MASTER_PARTNER,
        operationalRepresentativeCodes: targetCode,
        _id: { $ne: owner._id },
      })
      .select('firstName lastName partnerCode')
      .exec();

    if (operationalParents.length > 0) {
      const parent = operationalParents[0];
      const parentLabel = `${parent.firstName} ${parent.lastName}`.trim();
      throw new BadRequestException(
        `This Representative is already linked under ${parentLabel} (${parent.partnerCode}). A Representative can only belong to one parent Representative's network.`,
      );
    }

    const existingPdParent = normalizePartnerCode(
      target.partnerDevelopmentRepresentativeCode,
    );
    if (existingPdParent && existingPdParent !== ownerCode) {
      throw new BadRequestException(
        `This Representative is already assigned to parent ${existingPdParent}. A Representative can only belong to one parent Representative's network.`,
      );
    }
  }

  /**
   * Blocks cycles such as Rep1 → Rep2 then Rep2 → Rep1 (or longer chains).
   * Walks upward from the prospective parent (owner); if the target appears
   * as an ancestor, linking target under owner would create a circle.
   */
  private async assertNoCircularRepresentativeLink(
    target: UserDocument,
    owner: UserDocument,
  ): Promise<void> {
    const targetCode = normalizePartnerCode(target.partnerCode);
    const ownerCode = normalizePartnerCode(owner.partnerCode);
    if (!targetCode || !ownerCode) return;

    // Quick check: target already lists owner as an operational child
    const targetOperationalChildren = (target.operationalRepresentativeCodes || []).map(
      (code) => normalizePartnerCode(code),
    );
    if (targetOperationalChildren.includes(ownerCode)) {
      throw new BadRequestException(
        `Circular link not allowed. ${ownerCode} is already under ${targetCode}'s network, so ${targetCode} cannot be added under ${ownerCode}.`,
      );
    }

    const visited = new Set<string>();
    let currentCode: string | null = ownerCode;
    let depth = 0;
    const maxDepth = 50;

    while (currentCode && depth < maxDepth) {
      if (visited.has(currentCode)) break;
      visited.add(currentCode);

      if (currentCode === targetCode) {
        throw new BadRequestException(
          `Circular link not allowed. ${targetCode} is already an ancestor of ${ownerCode}, so ${ownerCode} cannot add ${targetCode} to their network.`,
        );
      }

      const currentUser = await this.userModel
        .findOne({
          role: UserRole.MASTER_PARTNER,
          partnerCode: currentCode,
        })
        .select('partnerCode partnerDevelopmentRepresentativeCode')
        .exec();

      if (!currentUser) break;

      const pdParent = normalizePartnerCode(
        currentUser.partnerDevelopmentRepresentativeCode,
      );
      if (pdParent) {
        currentCode = pdParent;
        depth += 1;
        continue;
      }

      const operationalParent = await this.userModel
        .findOne({
          role: UserRole.MASTER_PARTNER,
          operationalRepresentativeCodes: currentCode,
        })
        .select('partnerCode')
        .exec();

      currentCode = normalizePartnerCode(operationalParent?.partnerCode) || null;
      depth += 1;
    }

    // Also block if owner already appears in target's linked descendant network
    const targetSubtree = await this.findNetworkUsersForViewer(target);
    const descendantIds = new Set(
      targetSubtree.representatives.map((member) => member._id.toString()),
    );
    if (descendantIds.has(owner._id.toString())) {
      throw new BadRequestException(
        `Circular link not allowed. ${ownerCode} is already in ${targetCode}'s network, so ${targetCode} cannot be added under ${ownerCode}.`,
      );
    }
  }

  async searchRepresentativeForLinking(
    query: string,
    viewer: UserDocument,
    options?: { allowAdmin?: boolean },
  ) {
    const trimmed = query?.trim();
    if (!trimmed) {
      throw new BadRequestException('Please enter a Partner ID or email address.');
    }
    if (
      !options?.allowAdmin &&
      (viewer.role !== UserRole.MASTER_PARTNER || !viewer.partnerCode)
    ) {
      throw new ForbiddenException('Only Representatives can search for other Representatives.');
    }
    if (viewer.role !== UserRole.MASTER_PARTNER) {
      throw new BadRequestException('Owner must be a Representative.');
    }

    const normalizedQuery = trimmed.toUpperCase();
    const isEmailQuery = trimmed.includes('@');

    const target = await this.userModel.findOne(
      isEmailQuery
        ? { email: { $regex: new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }, role: UserRole.MASTER_PARTNER }
        : { partnerCode: normalizedQuery, role: UserRole.MASTER_PARTNER },
    );

    if (!target) {
      throw new BadRequestException('No active Representative found with that Partner ID or email.');
    }
    if (target.status === UserStatus.BLOCKED) {
      throw new BadRequestException('This Representative account is blocked.');
    }
    if (
      normalizePartnerCode(target.referredByPartnerCode) ===
      normalizePartnerCode(viewer.partnerCode)
    ) {
      throw new BadRequestException('This Representative is already linked to your network.');
    }

    const targetCode = normalizePartnerCode(target.partnerCode);
    const existingOperational = (viewer.operationalRepresentativeCodes || []).map(
      (code) => normalizePartnerCode(code),
    );
    if (targetCode && existingOperational.includes(targetCode)) {
      throw new BadRequestException(
        'This Representative is already linked for operational support.',
      );
    }

    await this.assertRepresentativeNetworkLinkAllowed(target, viewer);

    return {
      _id: target._id,
      firstName: target.firstName,
      lastName: target.lastName,
      email: target.email,
      partnerCode: target.partnerCode,
      referredByPartnerCode: target.referredByPartnerCode,
      city: target.city,
      country: target.country,
      status: target.status,
    };
  }

  async linkRepresentativeToViewer(query: string, viewer: UserDocument) {
    return this.linkRepresentativeToOwner(viewer._id.toString(), query, viewer);
  }

  async adminGetNetworkLinks(ownerId: string) {
    const owner = await this.userModel.findById(ownerId);
    if (!owner) {
      throw new BadRequestException('Network owner not found.');
    }

    const repCodes = (owner.operationalRepresentativeCodes || [])
      .map((code) => normalizePartnerCode(code))
      .filter(Boolean) as string[];
    const promoterCodes = (owner.operationalPromoterCodes || [])
      .map((code) => normalizePartnerCode(code))
      .filter(Boolean) as string[];

    const linkedRepresentatives = repCodes.length
      ? await this.userModel
          .find({ partnerCode: { $in: repCodes }, role: UserRole.MASTER_PARTNER })
          .select('firstName lastName email partnerCode city country status role')
          .lean()
      : [];
    const linkedPromoters = promoterCodes.length
      ? await this.userModel
          .find({ partnerCode: { $in: promoterCodes }, role: UserRole.REGIONAL_PARTNER })
          .select('firstName lastName email partnerCode city country status role')
          .lean()
      : [];

    return {
      owner: {
        _id: owner._id,
        firstName: owner.firstName,
        lastName: owner.lastName,
        email: owner.email,
        partnerCode: owner.partnerCode,
        role: owner.role,
      },
      linkedRepresentatives,
      linkedPromoters,
      operationalRepresentativeCodes: repCodes,
      operationalPromoterCodes: promoterCodes,
    };
  }

  async adminSearchNetworkMember(
    ownerId: string,
    role: 'master_partner' | 'regional_partner',
    query: string,
  ) {
    const owner = await this.userModel.findById(ownerId);
    if (!owner) {
      throw new BadRequestException('Network owner not found.');
    }
    if (role === 'master_partner') {
      if (owner.role !== UserRole.MASTER_PARTNER) {
        throw new BadRequestException('Owner must be a Representative.');
      }
      return this.searchRepresentativeForLinking(query, owner, { allowAdmin: true });
    }
    if (owner.role !== UserRole.REGIONAL_PARTNER) {
      throw new BadRequestException('Owner must be a Main Promoter.');
    }
    return this.searchPromoterForLinking(query, owner, { allowAdmin: true });
  }

  async adminLinkNetworkMember(
    ownerId: string,
    role: 'master_partner' | 'regional_partner',
    query: string,
  ) {
    if (role === 'master_partner') {
      return this.linkRepresentativeToOwner(ownerId, query);
    }
    return this.linkPromoterToOwner(ownerId, query);
  }

  async adminUnlinkNetworkMember(
    ownerId: string,
    role: 'master_partner' | 'regional_partner',
    partnerCode: string,
  ) {
    const owner = await this.userModel.findById(ownerId);
    if (!owner) {
      throw new BadRequestException('Network owner not found.');
    }
    const normalizedCode = normalizePartnerCode(partnerCode);
    if (!normalizedCode) {
      throw new BadRequestException('Partner ID is required.');
    }

    if (role === 'master_partner') {
      if (owner.role !== UserRole.MASTER_PARTNER) {
        throw new BadRequestException('Owner must be a Representative.');
      }
      await this.userModel.findByIdAndUpdate(owner._id, {
        $pull: { operationalRepresentativeCodes: normalizedCode },
      });
      return {
        message: `Representative ${normalizedCode} removed from ${owner.firstName} ${owner.lastName}'s linked network.`,
      };
    }

    if (owner.role !== UserRole.REGIONAL_PARTNER) {
      throw new BadRequestException('Owner must be a Main Promoter.');
    }
    await this.userModel.findByIdAndUpdate(owner._id, {
      $pull: { operationalPromoterCodes: normalizedCode },
    });
    return {
      message: `Promoter ${normalizedCode} removed from ${owner.firstName} ${owner.lastName}'s linked network.`,
    };
  }

  async linkRepresentativeToOwner(
    ownerId: string,
    query: string,
    actingViewer?: UserDocument,
  ) {
    const owner = await this.userModel.findById(ownerId);
    if (!owner) {
      throw new BadRequestException('Network owner not found.');
    }
    if (owner.role !== UserRole.MASTER_PARTNER) {
      throw new BadRequestException('Only Representatives can own representative network links.');
    }
    if (
      actingViewer &&
      actingViewer.role === UserRole.MASTER_PARTNER &&
      actingViewer._id.toString() !== owner._id.toString()
    ) {
      throw new ForbiddenException('You can only manage your own representative links.');
    }

    const targetPreview = await this.searchRepresentativeForLinking(
      query,
      owner,
      { allowAdmin: !actingViewer },
    );
    const target = await this.userModel.findById(targetPreview._id);
    if (!target) {
      throw new BadRequestException('Representative not found.');
    }

    const ownerSubtree = await this.findNetworkUsersForViewer(owner);
    const subtreeIds = new Set(
      [
        ...ownerSubtree.representatives,
        ...ownerSubtree.promoters,
        ...ownerSubtree.subPromoters,
        ...ownerSubtree.shops,
      ].map((member) => member._id.toString()),
    );
    if (subtreeIds.has(target._id.toString())) {
      throw new BadRequestException('This Representative is already in the network.');
    }

    const targetCode = normalizePartnerCode(target.partnerCode);
    const ownerCode = normalizePartnerCode(owner.partnerCode);
    if (!targetCode || !ownerCode) {
      throw new BadRequestException('Partner ID is required to link Representatives.');
    }

    const existingOperational = (owner.operationalRepresentativeCodes || []).map(
      (code) => normalizePartnerCode(code),
    );
    if (existingOperational.includes(targetCode)) {
      throw new BadRequestException('This Representative is already linked for operational support.');
    }

    await this.assertRepresentativeNetworkLinkAllowed(target, owner);

    await this.userModel.findByIdAndUpdate(owner._id, {
      $addToSet: { operationalRepresentativeCodes: targetCode },
    });

    // Rep1 becomes Rep2's Partner Development parent (immutable once set).
    // Every shop under Rep2 then pays Rep1 5% + Rep2 5% on that shop's first order.
    if (!target.partnerDevelopmentRepresentativeCode) {
      await this.userModel.findByIdAndUpdate(target._id, {
        partnerDevelopmentRepresentativeCode: ownerCode,
      });
    }

    const refreshedTarget = await this.userModel.findById(target._id);
    if (refreshedTarget) {
      await this.backfillShopEarningAssignmentsForRepresentative(refreshedTarget);
    }

    return {
      message: `${target.firstName} ${target.lastName} linked to ${owner.firstName} ${owner.lastName}'s network. Each of their shops' first orders will split 5% Partner Development to the parent and 5% Shop Introduction to the linked Representative.`,
      linkType: 'operational',
      representative: targetPreview,
    };
  }

  async searchPromoterForLinking(
    query: string,
    viewer: UserDocument,
    options?: { allowAdmin?: boolean },
  ) {
    const trimmed = query?.trim();
    if (!trimmed) {
      throw new BadRequestException('Please enter a Partner ID or email address.');
    }
    if (
      !options?.allowAdmin &&
      (viewer.role !== UserRole.REGIONAL_PARTNER || !viewer.partnerCode)
    ) {
      throw new ForbiddenException('Only Main Promoters can search for other Promoters.');
    }
    if (viewer.role !== UserRole.REGIONAL_PARTNER) {
      throw new BadRequestException('Owner must be a Main Promoter.');
    }

    const normalizedQuery = trimmed.toUpperCase();
    const isEmailQuery = trimmed.includes('@');
    const target = await this.userModel.findOne(
      isEmailQuery
        ? {
            email: {
              $regex: new RegExp(
                `^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
                'i',
              ),
            },
            role: UserRole.REGIONAL_PARTNER,
          }
        : { partnerCode: normalizedQuery, role: UserRole.REGIONAL_PARTNER },
    );

    if (!target) {
      throw new BadRequestException('No active Main Promoter found with that Partner ID or email.');
    }
    if (target._id.toString() === viewer._id.toString()) {
      throw new BadRequestException('You cannot add yourself to your network.');
    }
    if (target.status === UserStatus.BLOCKED) {
      throw new BadRequestException('This Promoter account is blocked.');
    }

    const targetCode = normalizePartnerCode(target.partnerCode);
    const existingOperational = (viewer.operationalPromoterCodes || []).map(
      (code) => normalizePartnerCode(code),
    );
    if (targetCode && existingOperational.includes(targetCode)) {
      throw new BadRequestException('This Promoter is already linked to the network.');
    }
    if (
      normalizePartnerCode(target.referredByPartnerCode) ===
      normalizePartnerCode(viewer.partnerCode)
    ) {
      throw new BadRequestException('This Promoter is already linked to your network.');
    }

    return {
      _id: target._id,
      firstName: target.firstName,
      lastName: target.lastName,
      email: target.email,
      partnerCode: target.partnerCode,
      referredByPartnerCode: target.referredByPartnerCode,
      city: target.city,
      country: target.country,
      status: target.status,
    };
  }

  async linkPromoterToOwner(ownerId: string, query: string) {
    const owner = await this.userModel.findById(ownerId);
    if (!owner) {
      throw new BadRequestException('Network owner not found.');
    }
    if (owner.role !== UserRole.REGIONAL_PARTNER) {
      throw new BadRequestException('Only Main Promoters can own promoter network links.');
    }

    const targetPreview = await this.searchPromoterForLinking(query, owner, {
      allowAdmin: true,
    });
    const target = await this.userModel.findById(targetPreview._id);
    if (!target) {
      throw new BadRequestException('Promoter not found.');
    }

    const ownerSubtree = await this.findNetworkUsersForViewer(owner);
    const subtreeIds = new Set(
      [
        ...ownerSubtree.promoters,
        ...ownerSubtree.subPromoters,
        ...ownerSubtree.shops,
      ].map((member) => member._id.toString()),
    );
    if (subtreeIds.has(target._id.toString())) {
      throw new BadRequestException('This Promoter is already in the network.');
    }

    const targetCode = normalizePartnerCode(target.partnerCode);
    if (!targetCode) {
      throw new BadRequestException('Partner ID is required to link Promoters.');
    }

    const existingOperational = (owner.operationalPromoterCodes || []).map(
      (code) => normalizePartnerCode(code),
    );
    if (existingOperational.includes(targetCode)) {
      throw new BadRequestException('This Promoter is already linked to the network.');
    }

    await this.userModel.findByIdAndUpdate(owner._id, {
      $addToSet: { operationalPromoterCodes: targetCode },
    });

    return {
      message: `${target.firstName} ${target.lastName} linked to ${owner.firstName} ${owner.lastName}'s network. Their Sub-Promoters and Shops are now visible in the owner's network.`,
      linkType: 'operational',
      promoter: targetPreview,
    };
  }

  async assignPartner(shopId: string, partnerCode: string) {
    // 1. Verify Partner exists
    const partner = await this.userModel.findOne({
      partnerCode,
      role: {
        $in: [
          UserRole.MASTER_PARTNER,
          UserRole.REGIONAL_PARTNER,
          UserRole.DISTRIBUTOR,
          UserRole.PARTNER,
        ],
      }
    });
    if (!partner) throw new BadRequestException('Invalid Partner Code');

    // 2. Update Shop with partner's code
    const shop = await this.userModel.findByIdAndUpdate(
      shopId,
      {
        referredByPartnerCode: partnerCode
      },
      { new: true }
    );
    if (!shop) throw new BadRequestException('Shop not found');

    return shop;
  }

  private normalizeCustomCommissionRate(
    role: UserRole,
    payload: { customCommissionRate?: number | null },
  ): void {
    if (payload.customCommissionRate === undefined) return;

    if (!isCommissionEligibleRole(role)) {
      payload.customCommissionRate = null;
      return;
    }

    if (payload.customCommissionRate === null) return;

    const rate = Number(payload.customCommissionRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new BadRequestException(
        'Commission rate must be a number between 0 and 100',
      );
    }
    payload.customCommissionRate = rate;
  }

  /** Walk parent links upward and return true if partnerCode appears in viewer's upline. */
  private async isPartnerCodeInViewerAncestry(
    viewer: UserDocument,
    partnerCode: string,
  ): Promise<boolean> {
    const targetCode = normalizePartnerCode(partnerCode);
    if (!targetCode) return false;

    let current: UserDocument | null = viewer;
    const visited = new Set<string>();

    for (let depth = 0; depth < 25 && current; depth++) {
      const parentCode = current.referredByPartnerCode?.trim();
      if (!parentCode) return false;

      const normalizedParent = normalizePartnerCode(parentCode);
      if (!normalizedParent || visited.has(normalizedParent)) return false;
      visited.add(normalizedParent);

      if (normalizedParent === targetCode) return true;

      const parent = await this.findByPartnerCode(normalizedParent);
      if (!parent) return false;
      if (parent._id.toString() === current._id.toString()) return false;
      current = parent;
    }

    return false;
  }

  private async collectNetworkDescendants(
    rootCodes: string[],
    collected: UserDocument[],
    seenIds: Set<string>,
  ): Promise<void> {
    let frontier = rootCodes
      .map((code) => normalizePartnerCode(code))
      .filter(Boolean);

    for (let depth = 0; depth < 20 && frontier.length > 0; depth++) {
      const batch = await this.userModel
        .find({ referredByPartnerCode: { $in: frontier } })
        .exec();

      const nextFrontier: string[] = [];
      for (const user of batch) {
        const id = user._id.toString();
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        collected.push(user);

        if (user.partnerCode && canTraverseNetwork(user.role)) {
          nextFrontier.push(normalizePartnerCode(user.partnerCode));
        }
      }
      frontier = nextFrontier;
    }
  }

  private async validateHierarchyLink(
    role: UserRole,
    referredByPartnerCode?: string | null,
    excludeUserId?: string,
  ): Promise<void> {
    if (!requiresParentLink(role)) {
      return;
    }

    const code = referredByPartnerCode?.trim();
    if (!code) {
      throw new BadRequestException(`${getParentLinkLabel(role)} is required`);
    }

    const parent = await this.findByPartnerCode(code);
    if (!parent) {
      throw new BadRequestException(
        `${getParentLinkLabel(role)} is invalid: partner code not found`,
      );
    }

    const roleError = validateParentRole(role, parent.role);
    if (roleError) {
      throw new BadRequestException(roleError);
    }

    if (role === UserRole.SUB_PROMOTER) {
      await this.assertMainPromoterCanAcceptSub(code, excludeUserId);
    }
  }

  private async assertMainPromoterCanAcceptSub(
    mainPartnerCode: string,
    excludeUserId?: string,
  ): Promise<void> {
    const main = await this.findByPartnerCode(mainPartnerCode);
    if (!main || main.role !== UserRole.REGIONAL_PARTNER) {
      throw new BadRequestException(
        'Sub-Promoter must be linked to a Main Promoter (Promoter role)',
      );
    }

    const existingSub = await this.userModel.findOne({
      role: UserRole.SUB_PROMOTER,
      referredByPartnerCode: mainPartnerCode,
      ...(excludeUserId ? { _id: { $ne: excludeUserId } } : {}),
    });

    if (existingSub) {
      throw new BadRequestException(
        'This Main Promoter already has a Sub-Promoter assigned',
      );
    }
  }

  private async getNextCertificateNumber(): Promise<number> {
    const lastUser = await this.userModel
      .findOne({ certificateNumber: { $exists: true } })
      .sort({ certificateNumber: -1 })
      .exec();
    
    if (lastUser && lastUser.certificateNumber) {
      return lastUser.certificateNumber + 1;
    }
    return 14943212; // Starting number
  }
}

