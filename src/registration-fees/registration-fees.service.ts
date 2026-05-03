import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RegistrationFeeGroup, RegistrationFeeGroupDocument } from './entities/registration-fee-group.entity';
import { CreateRegistrationFeeGroupDto, UpdateRegistrationFeeGroupDto } from './dto/registration-fee-group.dto';

@Injectable()
export class RegistrationFeesService {
  constructor(
    @InjectModel(RegistrationFeeGroup.name)
    private feeGroupModel: Model<RegistrationFeeGroupDocument>,
  ) {}

  async create(dto: CreateRegistrationFeeGroupDto): Promise<RegistrationFeeGroup> {
    if (dto.isDefault) {
      await this.feeGroupModel.updateMany({}, { isDefault: false });
    }
    const created = new this.feeGroupModel(dto);
    return created.save();
  }

  async findAll(): Promise<RegistrationFeeGroup[]> {
    return this.feeGroupModel.find().exec();
  }

  async findOne(id: string): Promise<RegistrationFeeGroup> {
    const group = await this.feeGroupModel.findById(id).exec();
    if (!group) throw new NotFoundException('Fee group not found');
    return group;
  }

  async update(id: string, dto: UpdateRegistrationFeeGroupDto): Promise<RegistrationFeeGroup> {
    if (dto.isDefault) {
      await this.feeGroupModel.updateMany({ _id: { $ne: id } }, { isDefault: false });
    }
    const updated = await this.feeGroupModel.findByIdAndUpdate(id, dto, { new: true }).exec();
    if (!updated) throw new NotFoundException('Fee group not found');
    return updated;
  }

  async remove(id: string): Promise<any> {
    const deleted = await this.feeGroupModel.findByIdAndDelete(id).exec();
    if (!deleted) throw new NotFoundException('Fee group not found');
    return deleted;
  }

  async findByCountry(country: string): Promise<RegistrationFeeGroup | null> {
    const normalizedCountry = country.toLowerCase().trim();
    const groups = await this.feeGroupModel.find({ isActive: true }).exec();
    
    // Exact match in countries array
    const match = groups.find(g => 
      g.countries.map(c => c.toLowerCase().trim()).includes(normalizedCountry)
    );

    if (match) return match;

    // Fallback to default group
    return groups.find(g => g.isDefault) || null;
  }
}
