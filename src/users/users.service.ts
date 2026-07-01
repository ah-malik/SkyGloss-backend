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
import { isCommissionEligibleRole, resolveShopCommissionChain } from '../common/commission-distribution';
import {
  GLOBAL_HUB_PARTNER_CODE,
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
    return createdUser.save();
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
      return { ...empty, shops, subPromoters };
    }

    const collected: UserDocument[] = [];
    const seenIds = new Set<string>();
    let frontier = [partnerCode];

    for (let depth = 0; depth < 20 && frontier.length > 0; depth++) {
      const batch = await this.userModel
        .find({ referredByPartnerCode: { $in: frontier } })
        .exec();

      const nextFrontier: string[] = [];
      for (const u of batch) {
        const id = u._id.toString();
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        collected.push(u);

        if (u.partnerCode && canTraverseNetwork(u.role)) {
          nextFrontier.push(u.partnerCode);
        }
      }
      frontier = nextFrontier;
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
    shopId: string,
    isVisibleOnMap: boolean,
    viewer: UserDocument,
  ): Promise<UserDocument | null> {
    const inNetwork = await this.isUserInViewerNetwork(viewer, shopId);
    if (!inNetwork) return null;

    const shop = await this.userModel.findOne({
      _id: shopId,
      role: UserRole.CERTIFIED_SHOP,
    });

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
      role: {
        $in: [
          UserRole.MASTER_PARTNER,
          UserRole.REGIONAL_PARTNER,
          UserRole.DISTRIBUTOR,
          UserRole.PARTNER,
        ],
      },
    }).select('firstName lastName partnerCode email status role').sort({ firstName: 1 });
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

  async searchRepresentativeForLinking(
    query: string,
    viewer: UserDocument,
  ) {
    const trimmed = query?.trim();
    if (!trimmed) {
      throw new BadRequestException('Please enter a Partner ID or email address.');
    }
    if (viewer.role !== UserRole.MASTER_PARTNER || !viewer.partnerCode) {
      throw new ForbiddenException('Only Representatives can search for other Representatives.');
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
    if (target._id.toString() === viewer._id.toString()) {
      throw new BadRequestException('You cannot add yourself to your network.');
    }
    if (target.status === UserStatus.BLOCKED) {
      throw new BadRequestException('This Representative account is blocked.');
    }
    if (target.referredByPartnerCode === viewer.partnerCode) {
      throw new BadRequestException('This Representative is already linked to your network.');
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

  async linkRepresentativeToViewer(query: string, viewer: UserDocument) {
    const targetPreview = await this.searchRepresentativeForLinking(query, viewer);
    const target = await this.userModel.findById(targetPreview._id);
    if (!target) {
      throw new BadRequestException('Representative not found.');
    }

    const viewerSubtree = await this.findNetworkUsersForViewer(viewer);
    const subtreeIds = new Set(
      [...viewerSubtree.representatives, ...viewerSubtree.promoters, ...viewerSubtree.subPromoters, ...viewerSubtree.shops]
        .map((member) => member._id.toString()),
    );
    if (subtreeIds.has(target._id.toString())) {
      throw new BadRequestException('This Representative is already in your network.');
    }

    if (viewer.partnerCode) {
      const targetNetwork = await this.findNetworkUsersForViewer(target);
      const targetSubtreeIds = new Set(
        [
          target._id.toString(),
          ...targetNetwork.representatives,
          ...targetNetwork.promoters,
          ...targetNetwork.subPromoters,
          ...targetNetwork.shops,
        ].map((member) => (typeof member === 'string' ? member : member._id.toString())),
      );
      if (targetSubtreeIds.has(viewer._id.toString())) {
        throw new BadRequestException('Cannot link a Representative who is above you in the network.');
      }
    }

    target.referredByPartnerCode = viewer.partnerCode;
    await this.validateHierarchyLink(
      UserRole.MASTER_PARTNER,
      viewer.partnerCode,
      target._id.toString(),
    );
    await target.save();

    return {
      message: `${target.firstName} ${target.lastName} has been added to your network.`,
      representative: {
        _id: target._id,
        firstName: target.firstName,
        lastName: target.lastName,
        email: target.email,
        partnerCode: target.partnerCode,
        referredByPartnerCode: target.referredByPartnerCode,
        city: target.city,
        country: target.country,
        status: target.status,
      },
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

