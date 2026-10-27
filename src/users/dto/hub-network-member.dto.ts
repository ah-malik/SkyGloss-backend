import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { UserRole, UserStatus } from '../entities/user.entity';

/** Roles a Hub may create / manage under its own Partner ID. */
export const HUB_MANAGED_ROLES = [
  UserRole.DISTRIBUTOR,
  UserRole.MASTER_PARTNER,
  UserRole.REGIONAL_PARTNER,
] as const;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Profile fields a Hub may set on its own Distributor / Representative /
 * Promoter. Everything else (rates, parent link, payment, agreement) stays
 * Admin-only; the global ValidationPipe strips unknown fields.
 */
export class HubNetworkMemberProfileDto {
  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(100)
  firstName?: string;

  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(100)
  lastName?: string;

  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(40)
  phoneNumber?: string;

  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(150)
  companyName?: string;

  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(300)
  address?: string;

  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(100)
  state?: string;

  @Transform(trim)
  @IsString()
  @IsOptional()
  @MaxLength(20)
  zipCode?: string;
}

/** POST /users/hub/network-members — the parent link is always the Hub. */
export class CreateHubNetworkMemberDto extends HubNetworkMemberProfileDto {
  @IsIn(HUB_MANAGED_ROLES)
  role: (typeof HUB_MANAGED_ROLES)[number];

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  /** Network ID (Partner ID) of the new member. */
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  partnerCode: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city: string;
}

/** PATCH /users/hub/network-members/:id */
export class UpdateHubNetworkMemberDto extends HubNetworkMemberProfileDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @MaxLength(100)
  country?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @MaxLength(100)
  city?: string;

  /** Block / unblock (an Admin block cannot be lifted by the Hub). */
  @IsIn([UserStatus.ACTIVE, UserStatus.BLOCKED])
  @IsOptional()
  status?: UserStatus.ACTIVE | UserStatus.BLOCKED;
}
