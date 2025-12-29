import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateSupportDto } from './dto/create-support.dto';
import { UpdateSupportDto } from './dto/update-support.dto';
import { SupportTicket, SupportTicketDocument } from './entities/support.entity';

@Injectable()
export class SupportService {
  constructor(
    @InjectModel(SupportTicket.name) private supportTicketModel: Model<SupportTicketDocument>,
  ) { }

  async create(createSupportDto: CreateSupportDto): Promise<SupportTicket> {
    const createdTicket = new this.supportTicketModel(createSupportDto);
    return createdTicket.save();
  }

  async findAll(): Promise<SupportTicket[]> {
    return this.supportTicketModel.find().sort({ createdAt: -1 }).exec();
  }

  async findOne(id: string): Promise<SupportTicket | null> {
    return this.supportTicketModel.findById(id).exec();
  }

  update(id: number, updateSupportDto: UpdateSupportDto) {
    return `This action updates a #${id} support`;
  }

  remove(id: number) {
    return `This action removes a #${id} support`;
  }
}
